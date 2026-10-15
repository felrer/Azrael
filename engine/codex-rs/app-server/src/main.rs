#![recursion_limit = "256"]

use clap::Parser;
use clap::{CommandFactory, FromArgMatches};
use codex_app_server::AppServerCodeModeHostArgs;
use codex_app_server::AppServerRuntimeOptions;
use codex_app_server::AppServerTransport;
use codex_app_server::PluginStartupTasks;
use codex_app_server::run_main_with_transport_options;
use codex_arg0::Arg0DispatchPaths;
use codex_arg0::arg0_dispatch_or_else;
use codex_config::LoaderOverrides;
use codex_protocol::protocol::SessionSource;
use codex_utils_cli::CliConfigOverrides;
use codex_websocket_auth::WebsocketAuthArgs;
use std::path::PathBuf;

#[cfg(all(
    target_os = "linux",
    target_env = "musl",
    any(target_arch = "x86_64", target_arch = "aarch64")
))]
#[global_allocator]
static ALLOCATOR: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

// Debug-only test hook: lets integration tests point the server at a temporary
// managed config file without writing to /etc.
const MANAGED_CONFIG_PATH_ENV_VAR: &str = "CODEX_APP_SERVER_MANAGED_CONFIG_PATH";
const DISABLE_MANAGED_CONFIG_ENV_VAR: &str = "CODEX_APP_SERVER_DISABLE_MANAGED_CONFIG";

#[derive(Debug, Parser)]
#[command(version)]
struct AppServerArgs {
    #[command(flatten)]
    config_overrides: CliConfigOverrides,

    #[command(flatten)]
    code_mode_host: AppServerCodeModeHostArgs,

    /// Transport endpoint URL. Supported values: `stdio://` (default),
    /// `unix://`, `unix://PATH`, `ws://IP:PORT`, `off`.
    #[arg(
        long = "listen",
        value_name = "URL",
        default_value = AppServerTransport::DEFAULT_LISTEN_URL
    )]
    listen: AppServerTransport,

    /// Session source used to derive product restrictions and metadata.
    #[arg(
        long = "session-source",
        value_name = "SOURCE",
        default_value = "vscode",
        value_parser = SessionSource::from_startup_arg
    )]
    session_source: SessionSource,

    #[command(flatten)]
    auth: WebsocketAuthArgs,

    /// Fail if config.toml contains unknown configuration fields.
    #[arg(long = "strict-config", default_value_t = false)]
    strict_config: bool,

    /// Hidden debug-only test hook used by integration tests that spawn the
    /// production app-server binary.
    #[cfg(debug_assertions)]
    #[arg(long = "disable-plugin-startup-tasks-for-tests", hide = true)]
    disable_plugin_startup_tasks_for_tests: bool,

    /// Enable remote control for this app-server process without changing persistence.
    #[arg(
        long = "remote-control",
        hide = true,
        conflicts_with = "azrael_shared_windows"
    )]
    remote_control: bool,

    /// Save loaded threads during managed daemon shutdown.
    #[arg(long, hide = true)]
    managed_daemon: bool,

    #[arg(long, hide = true)]
    azrael_shared_windows: bool,

    #[arg(long)]
    analytics_default_enabled: bool,
}

fn parse_azrael_args(
    args: impl IntoIterator<Item = std::ffi::OsString>,
) -> Result<AppServerArgs, clap::Error> {
    let mut args: Vec<_> = args.into_iter().collect();
    let value_flags = [
        "-c",
        "--config",
        "--code-mode-host",
        "--listen",
        "--session-source",
        "--ws-auth",
        "--ws-token-file",
        "--ws-token-sha256",
        "--ws-shared-secret-file",
        "--ws-issuer",
        "--ws-audience",
        "--ws-max-clock-skew-seconds",
    ];
    if let Some(index) = args.iter().enumerate().skip(1).find_map(|(index, arg)| {
        (arg == "app-server" && !value_flags.iter().any(|flag| args[index - 1] == *flag))
            .then_some(index)
    }) {
        args.remove(index);
    }
    let matches = AppServerArgs::command()
        .name("azrael")
        .try_get_matches_from(args)?;
    AppServerArgs::from_arg_matches(&matches)
}

fn remote_control_startup_mode(
    shared_windows: bool,
    remote_control: bool,
    disabled: bool,
) -> codex_app_server::RemoteControlStartupMode {
    if shared_windows {
        return codex_app_server::RemoteControlStartupMode::DisabledEphemeral;
    }
    match (remote_control, disabled) {
        (true, _) => codex_app_server::RemoteControlStartupMode::EnabledEphemeral,
        (false, true) => codex_app_server::RemoteControlStartupMode::DisabledEphemeral,
        (false, false) => codex_app_server::RemoteControlStartupMode::ResolvePersisted,
    }
}

fn main() -> anyhow::Result<()> {
    run_entry(false)
}

impl AppServerArgs {
    fn azrael_startup_args(&self) -> anyhow::Result<Vec<String>> {
        anyhow::ensure!(
            matches!(self.listen, AppServerTransport::Stdio),
            "Azrael window proxy requires stdio; its shared daemon owns the private listener"
        );
        anyhow::ensure!(
            !self.remote_control
                && !self.managed_daemon
                && self.auth == WebsocketAuthArgs::default(),
            "Azrael window proxy does not accept remote control, managed daemon or WebSocket authentication flags"
        );
        let mut args = Vec::new();
        let overrides = self
            .config_overrides
            .parse_overrides()
            .map_err(anyhow::Error::msg)?;
        if !overrides
            .iter()
            .any(|(key, _)| key == "features.code_mode_host")
        {
            args.extend(["-c".into(), "features.code_mode_host=true".into()]);
        }
        for value in &self.config_overrides.raw_overrides {
            args.extend(["-c".into(), value.clone()]);
        }
        if let Some(endpoint) = &self.code_mode_host.code_mode_host {
            args.extend(["--code-mode-host".into(), endpoint.to_string()]);
        }
        if self.strict_config {
            args.push("--strict-config".into());
        }
        args.extend(["--session-source".into(), self.session_source.to_string()]);
        if self.analytics_default_enabled {
            args.push("--analytics-default-enabled".into());
        }
        #[cfg(debug_assertions)]
        if self.disable_plugin_startup_tasks_for_tests {
            args.push("--disable-plugin-startup-tasks-for-tests".into());
        }
        Ok(args)
    }
}

pub(crate) fn azrael_main() -> anyhow::Result<()> {
    run_entry(true)
}

fn run_entry(azrael_entry: bool) -> anyhow::Result<()> {
    let remote_control_disabled = codex_app_server::take_remote_control_disabled_env();
    arg0_dispatch_or_else(move |arg0_paths: Arg0DispatchPaths| async move {
        let args = if azrael_entry {
            parse_azrael_args(std::env::args_os()).unwrap_or_else(|error| error.exit())
        } else {
            AppServerArgs::parse()
        };
        if azrael_entry && !args.azrael_shared_windows {
            if let Some(context) = std::env::var_os("AZRAEL_EX_WINDOW_CONTEXT") {
                let registration = serde_json::from_str(&context.to_string_lossy())?;
                return codex_app_server_daemon::run_azrael_stdio_proxy_with_args(
                    &std::env::current_exe()?,
                    registration,
                    &args.azrael_startup_args()?,
                )
                .await;
            }
        }
        let AppServerArgs {
            config_overrides,
            code_mode_host,
            listen,
            session_source,
            auth,
            strict_config,
            #[cfg(debug_assertions)]
            disable_plugin_startup_tasks_for_tests,
            remote_control,
            managed_daemon,
            azrael_shared_windows,
            analytics_default_enabled,
        } = args;
        let loader_overrides = if disable_managed_config_from_debug_env() {
            LoaderOverrides::without_managed_config_for_tests()
        } else {
            managed_config_path_from_debug_env()
                .map(LoaderOverrides::with_managed_config_path_for_tests)
                .unwrap_or_default()
        };
        let transport = listen;
        let auth = auth.try_into_settings()?;
        let mut runtime_options = AppServerRuntimeOptions {
            code_mode_host_transport: code_mode_host.into(),
            managed_daemon,
            azrael_shared_windows,
            ..Default::default()
        };
        #[cfg(debug_assertions)]
        if disable_plugin_startup_tasks_for_tests {
            runtime_options.plugin_startup_tasks = PluginStartupTasks::Skip;
        }
        runtime_options.remote_control_startup_mode = remote_control_startup_mode(
            azrael_shared_windows,
            remote_control,
            remote_control_disabled,
        );

        let exit = run_main_with_transport_options(
            arg0_paths,
            config_overrides,
            loader_overrides,
            strict_config,
            analytics_default_enabled,
            transport,
            session_source,
            auth,
            runtime_options,
        )
        .await?;
        if exit == codex_app_server::AppServerExit::Forced {
            // Runtime teardown can wait forever for blocked rollout I/O.
            std::process::exit(0);
        }
        Ok(())
    })
}

fn disable_managed_config_from_debug_env() -> bool {
    #[cfg(debug_assertions)]
    {
        if let Ok(value) = std::env::var(DISABLE_MANAGED_CONFIG_ENV_VAR) {
            return matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES");
        }
    }

    false
}

fn managed_config_path_from_debug_env() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        if let Ok(value) = std::env::var(MANAGED_CONFIG_PATH_ENV_VAR) {
            return if value.is_empty() {
                None
            } else {
                Some(PathBuf::from(value))
            };
        }
    }

    None
}

#[cfg(test)]
#[path = "main_tests.rs"]
mod tests;
