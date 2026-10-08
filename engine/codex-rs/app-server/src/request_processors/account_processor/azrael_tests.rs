use super::super::azrael_state::SELECTED_STATE_FILE;
use super::super::azrael_state::read_selected_state;
use super::super::azrael_state::read_window_selection_with_default;
use super::super::azrael_state::write_selected_state;
use super::super::azrael_state::write_selected_states;
use super::*;
use crate::error_code::INTERNAL_ERROR_CODE;
use crate::error_code::INVALID_REQUEST_ERROR_CODE;
use http::StatusCode;
use pretty_assertions::assert_eq;

#[test]
fn usage_errors_report_http_status_without_exposing_response_body() {
    for status in [
        StatusCode::UNAUTHORIZED,
        StatusCode::FORBIDDEN,
        StatusCode::TOO_MANY_REQUESTS,
        StatusCode::BAD_GATEWAY,
    ] {
        let error = BackendRequestError::UnexpectedStatus {
            method: "GET".to_string(),
            url: "https://example.test/private/path?secret=token".to_string(),
            status,
            content_type: "text/plain".to_string(),
            body: "private response body".to_string(),
        };
        let message = azrael_usage_error(&anyhow::Error::new(error));
        assert!(message.contains(&status.as_u16().to_string()), "{message}");
        assert!(!message.contains("private response body"), "{message}");
        assert!(!message.contains("secret=token"), "{message}");
    }
}

#[test]
fn usage_errors_distinguish_timeout_and_transport_failure() {
    assert_eq!(
        azrael_usage_error(&anyhow::Error::new(RouteAwareRequestError::Timeout)),
        "OpenAI usage request timed out"
    );

    let transport = azrael_usage_error(&anyhow::Error::new(RouteAwareRequestError::Build(
        "private route details".to_string(),
    )));
    assert!(transport.contains("transport"), "{transport}");
    assert!(!transport.contains("private route details"), "{transport}");

    let wrapped_timeout =
        BackendRequestError::Other(anyhow::Error::new(RouteAwareRequestError::Timeout));
    assert_eq!(
        azrael_usage_error(&anyhow::Error::new(wrapped_timeout)),
        "OpenAI usage request timed out"
    );
}

#[test]
fn usage_errors_identify_invalid_json_without_exposing_response() {
    let error = anyhow::anyhow!("Decode error for https://example.test/private: secret body");
    let message = azrael_usage_error(&error);
    assert_eq!(message, "OpenAI usage response was not valid JSON");
    assert!(!message.contains("secret body"));
}

#[test]
fn usage_errors_identify_unavailable_network_policy() {
    let denied = codex_http_client::NetworkPolicyDenied::Unavailable;
    let expected = "OpenAI usage request blocked: application network policy is unavailable";
    assert_eq!(
        azrael_usage_error(&anyhow::Error::new(RouteAwareRequestError::Policy(denied))),
        expected
    );
    assert_eq!(
        azrael_usage_error(&anyhow::Error::new(BackendRequestError::Policy(denied))),
        expected
    );
}

#[tokio::test]
async fn pending_switch_can_be_cancelled_without_waiting_for_active_work() {
    let admission = Arc::new(codex_login::AzraelAuthAdmission::default());
    let active_work = admission.enter_task().await;
    let request = admission.begin_switch().expect("switch should begin");
    let cancel = CancellationToken::new();
    let wait_cancel = cancel.clone();
    let waiting = tokio::spawn(async move {
        let result = wait_for_switch_guard(&request, wait_cancel).await;
        drop(request);
        result.map(drop)
    });

    cancel.cancel();
    let error = waiting
        .await
        .expect("wait task should finish")
        .expect_err("cancel should interrupt the pending switch");

    assert_eq!(error.kind(), io::ErrorKind::Interrupted);
    assert!(!admission.is_pending());
    drop(active_work);
}

#[tokio::test]
async fn no_candidate_retirement_stays_settled_across_ticks_and_allows_explicit_recovery() {
    let admission = Arc::new(codex_login::AzraelAuthAdmission::default());
    let retirement = admission.begin_retirement();
    let guard = retirement.try_commit().unwrap();
    assert!(account_switch_in_progress(&admission, false));
    drop(guard);
    drop(retirement);
    for _ in 0..32 {
        tokio::task::yield_now().await;
        assert!(!account_switch_in_progress(&admission, false));
        assert!(admission.requires_recovery());
        assert!(admission.admit_request().await.is_err());
    }
    let recovery = admission.begin_explicit_recovery().unwrap();
    assert!(account_switch_in_progress(&admission, false));
    let verified_replacement = recovery.try_commit().unwrap();
    admission.complete_retirement(&verified_replacement);
    drop(verified_replacement);
    drop(recovery);
    assert!(!account_switch_in_progress(&admission, false));
    assert!(admission.admit_request().await.is_ok());
    // An unrelated failed manual rollback still exposes its retained writer.
    assert!(account_switch_in_progress(&admission, true));
}

#[test]
fn selected_profile_state_round_trips_only_the_sanitized_id() {
    let temp = tempfile::tempdir().expect("temporary directory");
    let state_path = temp.path().join(SELECTED_STATE_FILE);
    let selected = "0123456789abcdef0123456789abcdef".to_string();

    write_selected_state(&state_path, Some(selected.clone())).expect("state should persist");

    assert_eq!(read_selected_state(&state_path), Some(selected));
    let json: serde_json::Value = serde_json::from_slice(
        &std::fs::read(state_path).expect("persisted state should be readable"),
    )
    .expect("persisted state should be JSON");
    assert_eq!(
        json.as_object()
            .expect("state should be an object")
            .keys()
            .cloned()
            .collect::<Vec<_>>(),
        vec!["selectedProfileId".to_string()]
    );
}

#[test]
fn window_selection_uses_legacy_state_once_then_persists_independently() {
    let temp = tempfile::tempdir().expect("temporary directory");
    let root = temp.path().join("azrael");
    let legacy_path = root.join(SELECTED_STATE_FILE);
    let first_path = root.join("windows").join("first.json");
    let second_path = root.join("windows").join("second.json");
    let legacy = "11111111111111111111111111111111".to_string();
    let first = "22222222222222222222222222222222".to_string();
    let second = "33333333333333333333333333333333".to_string();
    write_selected_state(&legacy_path, Some(legacy.clone())).expect("legacy state should persist");

    assert_eq!(
        read_window_selection_with_default(&root, Some(&first_path), None),
        (first_path.clone(), None, Some(legacy.clone()))
    );
    assert_eq!(
        read_window_selection_with_default(&root, Some(&second_path), None),
        (second_path.clone(), None, Some(legacy))
    );

    write_selected_state(&first_path, Some(first.clone())).expect("first window should persist");
    write_selected_state(&second_path, Some(second.clone())).expect("second window should persist");

    assert_eq!(
        read_window_selection_with_default(&root, Some(&first_path), None),
        (first_path, None, Some(first))
    );
    assert_eq!(
        read_window_selection_with_default(&root, Some(&second_path), None),
        (second_path, None, Some(second))
    );
}

#[test]
fn existing_empty_window_selection_does_not_restore_legacy_state() {
    let temp = tempfile::tempdir().expect("temporary directory");
    let root = temp.path().join("azrael");
    let legacy_path = root.join(SELECTED_STATE_FILE);
    let window_path = root.join("windows").join("empty.json");
    write_selected_state(
        &legacy_path,
        Some("11111111111111111111111111111111".to_string()),
    )
    .expect("legacy state should persist");
    write_selected_state(&window_path, None).expect("empty window state should persist");

    assert_eq!(
        read_window_selection_with_default(&root, Some(&window_path), None),
        (window_path, None, None)
    );
}

#[test]
fn durable_default_precedes_legacy_only_when_the_session_file_is_absent() {
    let temp = tempfile::tempdir().expect("temporary directory");
    let root = temp.path().join("azrael");
    let legacy_path = root.join(SELECTED_STATE_FILE);
    let session_path = root.join("windows").join("session.json");
    let default_path = root.join("default.json");
    let legacy = "11111111111111111111111111111111".to_string();
    let durable = "22222222222222222222222222222222".to_string();
    write_selected_state(&legacy_path, Some(legacy)).expect("legacy state should persist");
    write_selected_state(&default_path, Some(durable.clone()))
        .expect("durable default should persist");

    assert_eq!(
        read_window_selection_with_default(&root, Some(&session_path), Some(&default_path)),
        (
            session_path.clone(),
            Some(default_path.clone()),
            Some(durable)
        )
    );

    write_selected_state(&session_path, None).expect("empty session state should persist");
    assert_eq!(
        read_window_selection_with_default(&root, Some(&session_path), Some(&default_path)),
        (session_path.clone(), Some(default_path.clone()), None)
    );

    std::fs::write(&session_path, b"not json").expect("invalid session should persist");
    assert_eq!(
        read_window_selection_with_default(&root, Some(&session_path), Some(&default_path)),
        (session_path, Some(default_path), None)
    );
}

#[test]
fn invalid_existing_durable_default_does_not_restore_legacy_state() {
    let temp = tempfile::tempdir().expect("temporary directory");
    let root = temp.path().join("azrael");
    let legacy_path = root.join(SELECTED_STATE_FILE);
    let default_path = root.join("default.json");
    write_selected_state(
        &legacy_path,
        Some("11111111111111111111111111111111".to_string()),
    )
    .expect("legacy state should persist");
    std::fs::create_dir_all(&root).expect("state directory should exist");
    std::fs::write(&default_path, b"not json").expect("invalid default should persist");

    assert_eq!(
        read_window_selection_with_default(&root, None, Some(&default_path)),
        (legacy_path, Some(default_path), None)
    );
}

#[test]
fn selected_profile_state_writes_and_clears_session_and_durable_default() {
    let temp = tempfile::tempdir().expect("temporary directory");
    let session_path = temp.path().join("windows").join("session.json");
    let default_path = temp.path().join("default.json");
    let selected = "0123456789abcdef0123456789abcdef".to_string();

    write_selected_states(&session_path, Some(&default_path), Some(selected.clone()))
        .expect("both selections should persist");
    assert_eq!(read_selected_state(&session_path), Some(selected.clone()));
    assert_eq!(read_selected_state(&default_path), Some(selected));

    write_selected_states(&session_path, Some(&default_path), None)
        .expect("both selections should clear");
    assert_eq!(read_selected_state(&session_path), None);
    assert_eq!(read_selected_state(&default_path), None);
}

#[test]
fn selected_profile_state_attempts_both_writes_and_reports_either_failure() {
    let temp = tempfile::tempdir().expect("temporary directory");
    let blocked_parent = temp.path().join("blocked");
    std::fs::write(&blocked_parent, b"file").expect("blocking file should persist");
    let session_path = blocked_parent.join("session.json");
    let default_path = temp.path().join("default.json");
    let selected = "0123456789abcdef0123456789abcdef".to_string();

    write_selected_states(&session_path, Some(&default_path), Some(selected.clone()))
        .expect_err("the session write should fail");
    assert_eq!(read_selected_state(&default_path), Some(selected));
}

#[test]
fn current_auth_identity_marks_a_saved_profile_active_without_a_window_selection() {
    let profile = AzraelProfile {
        id: "0123456789abcdef0123456789abcdef".to_string(),
        email: Some("person@example.com".to_string()),
        workspace_account_id: "workspace-a".to_string(),
        user_id: "user-a".to_string(),
        plan_type: Some("plus".to_string()),
        auto_switch_allowed: false,
    };

    assert_eq!(
        resolve_active_profile_id(
            std::slice::from_ref(&profile),
            None,
            Some("workspace-a"),
            Some("user-a")
        ),
        Some(profile.id.clone())
    );
    assert_eq!(
        resolve_active_profile_id(
            std::slice::from_ref(&profile),
            None,
            Some("workspace-a"),
            Some("other-user")
        ),
        None
    );
}

#[test]
fn managed_active_profile_remains_authoritative() {
    let selected = "fedcba9876543210fedcba9876543210".to_string();
    assert_eq!(
        resolve_active_profile_id(&[], Some(selected.clone()), None, None),
        Some(selected)
    );
}

#[test]
fn account_mutation_errors_distinguish_busy_from_unclassified_failures() {
    assert_eq!(
        account_mutation_error(io::Error::new(
            io::ErrorKind::WouldBlock,
            "credential lease held at C:\\\\Users\\\\person\\\\.azrael-ex\\\\accounts\\\\secret",
        )),
        JSONRPCErrorError {
            code: INVALID_REQUEST_ERROR_CODE,
            message: "This account is in use by another azrael window. Switch that window to another account or close it before replacing, signing out of, or removing these credentials."
                .to_string(),
            data: None,
        }
    );

    let generic = account_mutation_error(io::Error::other(
        "failed to update credential for secret@example.com at C:\\\\Users\\\\person\\\\.azrael-ex",
    ));
    assert_eq!(
        generic,
        JSONRPCErrorError {
            code: INTERNAL_ERROR_CODE,
            message: "미분류된 오류 발생".to_string(),
            data: None,
        }
    );
    assert!(!generic.message.contains("credential"));
    assert!(!generic.message.contains("C:\\\\Users"));
    assert!(!generic.message.contains("another azrael window"));
}

#[test]
fn profile_remove_errors_explain_recoverable_causes_without_leaking_internal_details() {
    assert_eq!(
        profile_remove_error(io::Error::new(
            io::ErrorKind::WouldBlock,
            "credential lease held at C:\\Users\\person\\.azrael-ex\\accounts\\secret",
        )),
        JSONRPCErrorError {
            code: INVALID_REQUEST_ERROR_CODE,
            message: "Account profile is currently in use. Finish account operations and switch away from this account or close the azrael window using it before removing it."
                .to_string(),
            data: None,
        }
    );
    assert_eq!(
        profile_remove_error(io::Error::new(
            io::ErrorKind::NotFound,
            "missing C:\\Users\\person\\.azrael-ex\\accounts\\secret\\profile.json",
        )),
        JSONRPCErrorError {
            code: INVALID_REQUEST_ERROR_CODE,
            message: "A required account profile file was not found. Refresh the account list before trying again."
                .to_string(),
            data: None,
        }
    );
    assert_eq!(
        profile_remove_error(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "credential store denied access for secret@example.com",
        )),
        JSONRPCErrorError {
            code: INTERNAL_ERROR_CODE,
            message: "Access to account profile storage was denied while removing the profile."
                .to_string(),
            data: None,
        }
    );

    let generic = profile_remove_error(io::Error::other(
        "failed to delete credential for secret@example.com at C:\\Users\\person\\.azrael-ex",
    ));
    assert_eq!(
        generic,
        JSONRPCErrorError {
            code: INTERNAL_ERROR_CODE,
            message: "미분류된 오류 발생".to_string(),
            data: None,
        }
    );
    assert!(!generic.message.contains("credential"));
    assert!(!generic.message.contains("C:\\Users"));
    assert!(!generic.message.contains("currently in use"));
}
