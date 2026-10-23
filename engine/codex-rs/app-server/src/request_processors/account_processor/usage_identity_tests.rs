use super::*;
use app_test_support::ChatGptIdTokenClaims;
use app_test_support::encode_id_token;
use codex_backend_client::RateLimitsWithResetCredits;
use pretty_assertions::assert_eq;
use serde_json::json;

fn auth(account: &str, user: &str, restricted: bool) -> CodexAuth {
    let mut claims = ChatGptIdTokenClaims::new()
        .chatgpt_account_id(account)
        .chatgpt_user_id(user);
    claims.chatgpt_account_is_fedramp = restricted;
    let token = encode_id_token(&claims).unwrap();
    CodexAuth::from_external_chatgpt_tokens(&token, account, Some("team")).unwrap()
}

fn backend(allowed: Option<bool>) -> RateLimitsWithResetCredits {
    RateLimitsWithResetCredits {
        rate_limits: vec![
            serde_json::from_value(json!({
                "limit_id": "codex",
                "primary": {"used_percent": 0, "window_minutes": 300, "resets_at": 2000000000}
            }))
            .unwrap(),
        ],
        ordinary_usage_allowed: allowed,
        rate_limit_reset_credits: None,
        account_id: Some("profile-account".into()),
        user_id: Some("profile-user".into()),
        rate_limit_upsell: Some(json!({"banner_type": "selected_model_limit"})),
    }
}

#[test]
fn inactive_profile_usage_permission_does_not_depend_on_selected_account() {
    let profile = auth("profile-account", "profile-user", false);
    let selected = auth("selected-account", "selected-user", false);
    for active in [None, Some(&selected)] {
        let response = AccountRequestProcessor::account_rate_limits_response_for_auth(
            Some(&profile),
            active,
            backend(Some(true)),
            None,
        )
        .unwrap();
        assert_eq!(response.ordinary_usage_allowed, Some(true));
        assert_eq!(response.rate_limit_upsell, None);
        assert_eq!(response.account_id.as_deref(), Some("profile-account"));
    }
}

#[test]
fn selected_account_read_retains_current_identity_and_upsell_checks() {
    let profile = auth("profile-account", "profile-user", false);
    let selected = auth("selected-account", "selected-user", false);
    for (active, expected) in [
        (None, None),
        (Some(&selected), None),
        (Some(&profile), Some(true)),
    ] {
        let response = AccountRequestProcessor::account_rate_limits_response_for_auth(
            None,
            active,
            backend(Some(true)),
            None,
        )
        .unwrap();
        assert_eq!(response.ordinary_usage_allowed, expected);
        assert_eq!(response.rate_limit_upsell.is_some(), expected.is_some());
    }
}

#[test]
fn profile_permission_preserves_backend_denial_and_missing_permission() {
    let profile = auth("profile-account", "profile-user", false);
    for allowed in [None, Some(false), Some(true)] {
        let response = AccountRequestProcessor::account_rate_limits_response_for_auth(
            Some(&profile),
            Some(&profile),
            backend(allowed),
            None,
        )
        .unwrap();
        assert_eq!(response.ordinary_usage_allowed, allowed);
        assert!(response.rate_limit_upsell.is_some());
    }
}

#[test]
fn profile_permission_requires_matching_workspace_user_and_unrestricted_auth() {
    let selected = auth("profile-account", "profile-user", false);
    for profile in [
        auth("other-account", "profile-user", false),
        auth("profile-account", "other-user", false),
        auth("profile-account", "profile-user", true),
    ] {
        let response = AccountRequestProcessor::account_rate_limits_response_for_auth(
            Some(&profile),
            Some(&selected),
            backend(Some(true)),
            None,
        )
        .unwrap();
        assert_eq!(response.ordinary_usage_allowed, None);
    }
    for missing_account in [true, false] {
        let mut data = backend(Some(true));
        if missing_account {
            data.account_id = None;
        } else {
            data.user_id = None;
        }
        let response = AccountRequestProcessor::account_rate_limits_response_for_auth(
            Some(&selected),
            Some(&selected),
            data,
            None,
        )
        .unwrap();
        assert_eq!(response.ordinary_usage_allowed, None);
        assert_eq!(response.rate_limit_upsell, None);
    }
}

#[test]
fn usage_conversion_still_rejects_missing_snapshots() {
    let profile = auth("profile-account", "profile-user", false);
    let mut data = backend(Some(true));
    data.rate_limits.clear();
    assert!(
        AccountRequestProcessor::account_rate_limits_response_for_auth(
            Some(&profile),
            None,
            data,
            None,
        )
        .is_err()
    );
}
