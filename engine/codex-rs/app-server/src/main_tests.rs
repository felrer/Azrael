use super::AppServerArgs;
use clap::Parser;
use codex_app_server::AppServerTransport;
use pretty_assertions::assert_eq;
use toml::Value as TomlValue;
use url::Url;

#[test]
fn azrael_accepts_native_host_and_daemon_launch_arguments() {
    for optional_command in [false, true] {
        let mut args = vec!["azrael", "-c", "features.code_mode_host=true"];
        if optional_command {
            args.push("app-server");
        }
        args.extend([
            "--analytics-default-enabled",
            "--azrael-shared-windows",
            "--managed-daemon",
            "--listen",
            "unix://",
        ]);
        let parsed =
            super::parse_azrael_args(args.into_iter().map(std::ffi::OsString::from)).unwrap();
        assert!(parsed.analytics_default_enabled);
        assert!(parsed.azrael_shared_windows);
        assert!(parsed.managed_daemon);
        assert_eq!(
            parsed.config_overrides.raw_overrides,
            vec!["features.code_mode_host=true"]
        );
    }
}

#[test]
fn shared_windows_disable_persisted_remote_control_and_reject_explicit_remote_control() {
    assert!(matches!(
        super::remote_control_startup_mode(true, false, false),
        codex_app_server::RemoteControlStartupMode::DisabledEphemeral
    ));
    let error =
        AppServerArgs::try_parse_from(["azrael", "--azrael-shared-windows", "--remote-control"])
            .expect_err("shared Azrael daemon must remain local only");
    assert_eq!(error.kind(), clap::error::ErrorKind::ArgumentConflict);
}

#[test]
fn azrael_proxy_preserves_global_startup_options_and_rejects_listener_changes() {
    let parsed = super::parse_azrael_args(
        [
            "azrael",
            "-c",
            "features.code_mode_host=true",
            "app-server",
            "--analytics-default-enabled",
        ]
        .into_iter()
        .map(std::ffi::OsString::from),
    )
    .unwrap();
    assert_eq!(
        parsed.azrael_startup_args().unwrap(),
        vec![
            "-c",
            "features.code_mode_host=true",
            "--session-source",
            "vscode",
            "--analytics-default-enabled"
        ]
    );
    let parsed = super::parse_azrael_args(
        [
            "azrael",
            "-c",
            "model=\"fixture\"",
            "--code-mode-host",
            "https://example.test",
            "--strict-config",
            "--session-source",
            "cli",
        ]
        .into_iter()
        .map(std::ffi::OsString::from),
    )
    .unwrap();
    assert_eq!(
        parsed.azrael_startup_args().unwrap(),
        vec![
            "-c",
            "features.code_mode_host=true",
            "-c",
            "model=\"fixture\"",
            "--code-mode-host",
            "https://example.test/",
            "--strict-config",
            "--session-source",
            "cli"
        ]
    );
    let parsed =
        AppServerArgs::try_parse_from(["azrael", "--listen", "ws://127.0.0.1:9999"]).unwrap();
    assert!(parsed.azrael_startup_args().is_err());
}

#[test]
fn app_server_accepts_cli_config_overrides() {
    let args = AppServerArgs::try_parse_from([
        "codex-app-server",
        "-c",
        "model=\"gpt-5-codex\"",
        "--config",
        "sandbox_mode=\"read-only\"",
        "--listen",
        "off",
    ])
    .expect("parse app-server args");

    let parsed_overrides = args
        .config_overrides
        .parse_overrides()
        .expect("parse config overrides");

    assert_eq!(
        parsed_overrides,
        vec![
            (
                "model".to_string(),
                TomlValue::String("gpt-5-codex".to_string()),
            ),
            (
                "sandbox_mode".to_string(),
                TomlValue::String("read-only".to_string()),
            ),
        ]
    );
}

#[test]
fn app_server_accepts_process_scoped_grpc_code_mode_host() {
    let args = AppServerArgs::try_parse_from([
        "codex-app-server",
        "--code-mode-host",
        "https://example.test",
        "--listen",
        "off",
    ])
    .expect("parse gRPC app-server args");

    assert_eq!(
        args.code_mode_host.code_mode_host,
        Some(Url::parse("https://example.test").expect("test endpoint should parse"))
    );
    assert_eq!(args.listen, AppServerTransport::Off);
}

#[test]
fn app_server_rejects_invalid_code_mode_host() {
    for endpoint in [
        "ftp://127.0.0.1:8765",
        "ws://",
        "ws://127.0.0.1:8765",
        "wss://example.test/code-mode",
        "ws://alice:secret@example.test/code-mode",
        "wss://alice:secret@example.test/code-mode",
        "wss://example.test/code-mode#fragment",
        "http://",
        "https://example.test/#fragment",
        "https://example.test/code-mode",
        "http://alice:secret@example.test",
        "https://alice:secret@example.test",
        "http://example.test/?token=secret",
    ] {
        let error =
            AppServerArgs::try_parse_from(["codex-app-server", "--code-mode-host", endpoint])
                .expect_err("invalid code-mode host endpoint should fail startup argument parsing");

        assert_eq!(error.kind(), clap::error::ErrorKind::ValueValidation);
        let rendered_error = error.to_string();
        assert!(!rendered_error.contains("alice"));
        assert!(!rendered_error.contains("secret"));
    }
}
