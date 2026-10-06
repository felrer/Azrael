//! Verify bounded transport, Unicode roundtrips, and child-environment cleanup.

use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::Result;
use codex_protocol::models::PermissionProfile;
use codex_windows_sandbox::environment_transport;
use pretty_assertions::assert_eq;

use crate::CreateMxcCommandArgsParams;
use crate::MxcCommand;
use crate::create_command_args;

use super::decode;
use super::encode;

fn command(args: Vec<String>) -> MxcCommand {
    MxcCommand {
        permissions: PermissionProfile::read_only(),
        sandbox_policy_cwd: PathBuf::from("workspace"),
        managed_network: None,
        command: args,
        command_environment: HashMap::new(),
    }
}

#[test]
fn large_unicode_launch_roundtrips_and_never_reaches_child_environment() -> Result<()> {
    let args = vec![
        "codex-windows-mxc".to_owned(),
        "🧊".repeat(20_000),
        "a\"\\b".to_owned(),
    ];
    let expected_env = HashMap::from([
        ("CUSTOM".to_owned(), "value".to_owned()),
        ("UNICODE".to_owned(), "🧊".repeat(8_000)),
    ]);
    let mut env = expected_env.clone();
    environment_transport::encode("stale", &mut env)?;
    let mut request = command(args);
    request.command_environment = expected_env.clone();
    encode(&request, &mut env)?;
    assert!(
        env.values()
            .all(|value| value.encode_utf16().count() < 32_767)
    );
    assert_eq!(
        serde_json::to_value(decode(&mut env)?)?,
        serde_json::to_value(request)?
    );
    assert_eq!(env, expected_env);
    Ok(())
}

#[test]
fn wrapper_captures_exact_command_environment_before_runtime_overrides() -> Result<()> {
    for expected in [
        HashMap::new(),
        HashMap::from([
            ("sYsTeMdRiVe".to_owned(), "Z:".to_owned()),
            ("localappdata".to_owned(), "caller-local".to_owned()),
            ("SYSTEMROOT".to_owned(), "caller-root".to_owned()),
            ("MixedCase".to_owned(), "🧊=value".to_owned()),
            ("EMPTY".to_owned(), String::new()),
        ]),
    ] {
        let mut env = expected.clone();
        env.insert("codex_sandbox_launch_0".to_owned(), "stale".to_owned());
        let permissions = PermissionProfile::read_only();
        create_command_args(CreateMxcCommandArgsParams {
            command: vec!["program.exe".to_owned()],
            permission_profile: &permissions,
            sandbox_policy_cwd: &PathBuf::from("workspace"),
            managed_network: None,
            env: &mut env,
        })?;
        let decoded = decode(&mut env)?;
        assert_eq!(decoded.command_environment, expected);
        #[cfg(windows)]
        let mut expected_wrapper = expected;
        #[cfg(not(windows))]
        let expected_wrapper = expected;
        #[cfg(windows)]
        super::add_launcher_environment(&mut expected_wrapper, |key| std::env::var_os(key))?;
        assert_eq!(env, expected_wrapper);
    }
    Ok(())
}

#[test]
fn launcher_uses_only_allowlisted_executor_values_and_preserves_command_snapshot() -> Result<()> {
    let executor = HashMap::from([
        ("SystemDrive", "C:"),
        ("LOCALAPPDATA", r"C:\executor\AppData\Local"),
        ("SystemRoot", r"C:\Windows"),
        ("SECRET_TOKEN", "parent-secret"),
        ("HTTPS_PROXY", "parent-proxy"),
    ]);
    let command_env = HashMap::from([
        ("sYsTeMdRiVe".to_owned(), "Z:".to_owned()),
        ("SYSTEMDRIVE".to_owned(), "Y:".to_owned()),
        ("localappdata".to_owned(), "caller-local".to_owned()),
        ("SYSTEMROOT".to_owned(), "caller-root".to_owned()),
        ("CUSTOM".to_owned(), "caller-value".to_owned()),
    ]);
    let mut request = command(vec!["program.exe".to_owned()]);
    request.command_environment = command_env.clone();
    let mut wrapper = command_env.clone();
    super::add_launcher_environment(&mut wrapper, |key| {
        executor
            .get(key)
            .map(|value| std::ffi::OsString::from(*value))
    })?;
    encode(&request, &mut wrapper)?;
    let decoded = decode(&mut wrapper)?;
    assert_eq!(decoded.command_environment, command_env);
    assert_eq!(
        wrapper,
        HashMap::from([
            ("SystemDrive".to_owned(), "C:".to_owned()),
            (
                "LOCALAPPDATA".to_owned(),
                r"C:\executor\AppData\Local".to_owned()
            ),
            ("SystemRoot".to_owned(), r"C:\Windows".to_owned()),
            ("CUSTOM".to_owned(), "caller-value".to_owned()),
        ])
    );
    Ok(())
}

#[test]
fn missing_executor_values_cannot_use_caller_platform_paths() -> Result<()> {
    let mut env = HashMap::from([
        ("SYSTEMDRIVE".to_owned(), "Z:".to_owned()),
        ("LOCALAPPDATA".to_owned(), "caller-local".to_owned()),
        ("SystemRoot".to_owned(), "caller-root".to_owned()),
        ("CUSTOM".to_owned(), "value".to_owned()),
    ]);
    super::add_launcher_environment(&mut env, |_| None)?;
    assert_eq!(
        env,
        HashMap::from([("CUSTOM".to_owned(), "value".to_owned())])
    );
    Ok(())
}

#[test]
fn decoded_command_environment_scrubs_transport_namespace() -> Result<()> {
    let mut request = command(vec!["program.exe".to_owned()]);
    request.command_environment = HashMap::from([
        ("codex_sandbox_launch_0".to_owned(), "injected".to_owned()),
        ("CODEX_SANDBOX_LAUNCH_BYTES".to_owned(), "12".to_owned()),
        ("CUSTOM".to_owned(), "value".to_owned()),
    ]);
    let mut env = HashMap::new();
    encode(&request, &mut env)?;
    assert_eq!(
        decode(&mut env)?.command_environment,
        HashMap::from([("CUSTOM".to_owned(), "value".to_owned())])
    );
    assert_eq!(env, HashMap::new());
    Ok(())
}

#[test]
fn oversized_command_environment_does_not_modify_caller_environment() {
    let mut env = HashMap::from([("LARGE".to_owned(), "a".repeat(16 * 1024 * 1024))]);
    let expected = env.clone();
    let permissions = PermissionProfile::read_only();
    assert!(
        create_command_args(CreateMxcCommandArgsParams {
            command: vec!["program.exe".to_owned()],
            permission_profile: &permissions,
            sandbox_policy_cwd: &PathBuf::from("workspace"),
            managed_network: None,
            env: &mut env,
        })
        .is_err()
    );
    assert_eq!(env, expected);
}
