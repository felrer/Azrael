use super::*;
use codex_config::types::McpServerConfig;
use codex_protocol::models::ManagedFileSystemPermissions;
use codex_protocol::models::PermissionProfile;
use codex_protocol::permissions::NetworkSandboxPolicy;
use codex_utils_path_uri::PathUri;
use pretty_assertions::assert_eq;
use serde_json::json;

#[test]
fn selected_window_direct_calls_only_accept_hidden_ui_token_requests() {
    let args = json!({"requestToken":"one-use-host-token"});
    assert!(validate_ui_request(SERVER, UI_TOOL, Some(&args)).is_ok());
    for tool in [
        "status",
        "capture",
        "invoke",
        "exec",
        "exec_command",
        "ui_operation_extra",
    ] {
        assert!(validate_ui_request(SERVER, tool, Some(&args)).is_err());
    }
    assert!(validate_ui_request("sky", UI_TOOL, Some(&args)).is_err());
    assert!(validate_ui_request(SERVER, UI_TOOL, None).is_err());
    for args in [
        json!({}),
        json!({"requestToken":1}),
        json!({"requestToken":""}),
        json!({"requestToken":"token", "hwnd":"123"}),
    ] {
        assert!(validate_ui_request(SERVER, UI_TOOL, Some(&args)).is_err());
    }
}

#[test]
fn selected_window_ui_registration_requires_configured_stdio() {
    let stdio: McpServerConfig =
        serde_json::from_value(json!({"command":"unused-test-command"})).unwrap();
    let http: McpServerConfig =
        serde_json::from_value(json!({"url":"https://example.invalid/mcp"})).unwrap();
    assert!(validate_owned_server(&McpServerSource::Config, &stdio.transport).is_ok());
    assert!(validate_owned_server(&McpServerSource::Config, &http.transport).is_err());
    assert!(
        validate_owned_server(
            &McpServerSource::Extension {
                id: "spoofed".to_string(),
                host_owned_apps: false
            },
            &stdio.transport
        )
        .is_err()
    );
}

#[test]
fn selected_window_ui_metadata_replaces_spoofs_without_collapsing_managed_authority() {
    for profile in [
        PermissionProfile::Disabled,
        PermissionProfile::Managed {
            file_system: ManagedFileSystemPermissions::Unrestricted,
            network: NetworkSandboxPolicy::Enabled,
        },
    ] {
        let state = SandboxState {
            permission_profile: profile,
            codex_linux_sandbox_exe: None,
            sandbox_cwd: PathUri::parse("file:///selected-window-tests").unwrap(),
            use_legacy_landlock: false,
            use_mxc: false,
        };
        let expected_state = serde_json::to_value(&state).unwrap();
        let meta = ui_request_meta(
            Some(json!({
                "threadId":"spoofed-thread", "sessionId":"spoofed-session",
                "x-codex-turn-metadata":{"sandbox_mode":"danger-full-access"},
                "codex/sandbox-state-meta":{"permissionProfile":{"type":"disabled"}},
                "diagnostic":"preserved"
            })),
            "real-thread",
            "real-session",
            state,
        )
        .unwrap();
        assert_eq!(
            meta,
            json!({
                "threadId":"real-thread", "sessionId":"real-session",
                "codex/sandbox-state-meta":expected_state,
                "diagnostic":"preserved"
            })
        );
    }
}
