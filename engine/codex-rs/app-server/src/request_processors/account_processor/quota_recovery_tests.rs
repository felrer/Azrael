use super::*;

#[test]
fn policy_excludes_source_and_exhausted_aliases() {
    let mut info = codex_login::AzraelProfileInfo {
        id: "profile-b".into(),
        email: None,
        workspace_account_id: "workspace-b".into(),
        user_id: "user".into(),
        plan_type: None,
        auto_switch_allowed: false,
    };
    let mut context = AzraelQuotaRecoveryContext {
        previous_account_id: Some("workspace-a".into()),
        previous_user_id: Some("user".into()),
        excluded_profile_ids: vec![],
    };
    assert!(!eligible(&info, &context));
    info.auto_switch_allowed = true;
    assert!(eligible(&info, &context));
    context
        .excluded_profile_ids
        .push(serde_json::to_string(&(&info.workspace_account_id, &info.user_id)).unwrap());
    assert!(!eligible(&info, &context));
    context.excluded_profile_ids.clear();
    context.excluded_profile_ids.push(info.id.clone());
    assert!(!eligible(&info, &context));
    context.excluded_profile_ids.clear();
    context.previous_account_id = Some(info.workspace_account_id.clone());
    assert!(!eligible(&info, &context));
}

#[test]
fn unfinished_commit_fails_closed_but_completed_commit_reopens() {
    let admission = Arc::new(codex_login::AzraelAuthAdmission::default());
    drop(CommitCompletion {
        admission: admission.clone(),
        completed: true,
    });
    assert!(!admission.is_pending());
    drop(CommitCompletion {
        admission: admission.clone(),
        completed: false,
    });
    assert!(admission.is_pending());
    assert!(admission.admit_queued_request().is_err());
}

#[test]
fn stale_source_cannot_authorize_recovery() {
    let manager = codex_login::AuthManager::from_auth_for_testing(
        codex_login::CodexAuth::from_api_key("test"),
    );
    let context = AzraelQuotaRecoveryContext {
        previous_account_id: Some("previous".into()),
        previous_user_id: Some("user".into()),
        excluded_profile_ids: vec![],
    };
    assert!(!source_matches(&manager, &context));
    assert!(!source_matches(
        &manager,
        &AzraelQuotaRecoveryContext::default()
    ));
}

#[test]
fn exhausted_identity_excludes_aliases_but_allows_another_user_in_same_workspace() {
    let mut info = codex_login::AzraelProfileInfo {
        id: "different-profile-alias".into(),
        email: None,
        workspace_account_id: "shared-workspace".into(),
        user_id: "exhausted-user".into(),
        plan_type: None,
        auto_switch_allowed: true,
    };
    let context = AzraelQuotaRecoveryContext {
        previous_account_id: Some("other-source".into()),
        previous_user_id: Some("source-user".into()),
        excluded_profile_ids: vec![
            "original-profile".into(),
            serde_json::to_string(&("shared-workspace", "exhausted-user")).unwrap(),
        ],
    };
    assert!(!eligible(&info, &context));
    info.user_id = "other-user".into();
    assert!(eligible(&info, &context));
}

#[test]
fn source_workspace_can_recover_to_a_different_user() {
    let info = codex_login::AzraelProfileInfo {
        id: "destination".into(),
        email: None,
        workspace_account_id: "shared-workspace".into(),
        user_id: "destination-user".into(),
        plan_type: None,
        auto_switch_allowed: true,
    };
    let context = AzraelQuotaRecoveryContext {
        previous_account_id: Some("shared-workspace".into()),
        previous_user_id: Some("source-user".into()),
        excluded_profile_ids: vec![
            serde_json::to_string(&("shared-workspace", "source-user")).unwrap(),
        ],
    };
    assert!(eligible(&info, &context));
}
