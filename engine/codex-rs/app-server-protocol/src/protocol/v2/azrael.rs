use super::Account;
use super::ConsumeAccountRateLimitResetCreditOutcome;
use super::GetAccountRateLimitsResponse;
use crate::JsonSchema;
use crate::TS;
use serde::Deserialize;
use serde::Serialize;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub enum AzraelAccountAction {
    List,
    CaptureCurrent,
    LoginStart,
    LoginCancel,
    Remove,
    Switch,
    CancelSwitch,
    Usage,
    ConsumeResetCredit,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct AzraelAccountParams {
    pub action: AzraelAccountAction,
    #[ts(optional = nullable)]
    pub profile_id: Option<String>,
    #[ts(optional = nullable)]
    pub login_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub idempotency_key: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub include_details: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct AzraelProfile {
    pub id: String,
    pub email: Option<String>,
    pub workspace_account_id: String,
    pub user_id: String,
    pub plan_type: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct AzraelAccountState {
    pub instance_id: String,
    pub revision: u32,
    pub codex_home: String,
    pub profiles: Vec<AzraelProfile>,
    pub current_account: Option<Account>,
    pub active_profile_id: Option<String>,
    pub pending_profile_id: Option<String>,
    pub is_switching: bool,
    pub has_active_turns: bool,
    pub login_pending: bool,
    pub last_error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct AzraelLogin {
    pub login_id: String,
    pub auth_url: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct AzraelAccountResponse {
    #[cfg_attr(test, schemars(schema_with = "account_state_schema"))]
    pub state: AzraelAccountState,
    pub login: Option<AzraelLogin>,
    #[cfg_attr(test, schemars(schema_with = "nullable_usage_schema"))]
    pub usage: Option<GetAccountRateLimitsResponse>,
    pub usage_profile_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub reset_credit_outcome: Option<ConsumeAccountRateLimitResetCreditOutcome>,
}

#[cfg(test)]
fn account_state_schema(
    generator: &mut schemars::r#gen::SchemaGenerator,
) -> schemars::schema::Schema {
    <AzraelAccountState as schemars::JsonSchema>::json_schema(generator)
}

// A response root is also exported on its own. Inline this occurrence so the
// exporter's root-title normalization does not conflict with a nested definition.
#[cfg(test)]
fn nullable_usage_schema(
    generator: &mut schemars::r#gen::SchemaGenerator,
) -> schemars::schema::Schema {
    use schemars::schema::Schema;
    use schemars::schema::SchemaObject;
    use schemars::schema::SubschemaValidation;
    Schema::Object(SchemaObject {
        subschemas: Some(Box::new(SubschemaValidation {
            any_of: Some(vec![
                <GetAccountRateLimitsResponse as schemars::JsonSchema>::json_schema(generator),
                generator.subschema_for::<()>(),
            ]),
            ..Default::default()
        })),
        ..Default::default()
    })
}

#[cfg(test)]
mod reset_credit_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reset_credit_action_and_optional_fields_serialize() {
        let params: AzraelAccountParams = serde_json::from_value(json!({
            "action": "consumeResetCredit", "profileId": "profile",
            "idempotencyKey": "0197cf1d-2703-7e00-b8fd-941428628c43"
        }))
        .unwrap();
        assert_eq!(params.action, AzraelAccountAction::ConsumeResetCredit);
        assert_eq!(
            serde_json::to_value(&params).unwrap()["idempotencyKey"],
            "0197cf1d-2703-7e00-b8fd-941428628c43"
        );
        let old_params: AzraelAccountParams =
            serde_json::from_value(json!({"action": "list"})).unwrap();
        assert!(old_params.idempotency_key.is_none());
        assert!(
            serde_json::to_value(old_params)
                .unwrap()
                .get("idempotencyKey")
                .is_none()
        );

        let value = json!({
            "state": {"instanceId": "engine", "revision": 0, "codexHome": ".",
                "profiles": [], "currentAccount": null, "activeProfileId": null,
                "pendingProfileId": null, "isSwitching": false, "hasActiveTurns": false,
                "loginPending": false, "lastError": null},
            "login": null, "usage": null, "usageProfileId": null
        });
        let mut response: AzraelAccountResponse = serde_json::from_value(value).unwrap();
        assert!(response.reset_credit_outcome.is_none());
        assert!(
            serde_json::to_value(&response)
                .unwrap()
                .get("resetCreditOutcome")
                .is_none()
        );
        response.reset_credit_outcome =
            Some(ConsumeAccountRateLimitResetCreditOutcome::AlreadyRedeemed);
        assert_eq!(
            serde_json::to_value(response).unwrap()["resetCreditOutcome"],
            "alreadyRedeemed"
        );
    }

    #[test]
    fn reset_credit_schema_exposes_action_and_optional_fields() {
        let params = serde_json::to_value(schemars::schema_for!(AzraelAccountParams)).unwrap();
        assert!(params["properties"].get("idempotencyKey").is_some());
        assert!(
            !params["required"]
                .as_array()
                .unwrap()
                .contains(&json!("idempotencyKey"))
        );
        assert!(params.to_string().contains("consumeResetCredit"));
        let response = serde_json::to_value(schemars::schema_for!(AzraelAccountResponse)).unwrap();
        assert!(response["properties"].get("resetCreditOutcome").is_some());
        assert!(
            !response["required"]
                .as_array()
                .unwrap()
                .contains(&json!("resetCreditOutcome"))
        );
    }
}
