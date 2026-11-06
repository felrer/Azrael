use crate::JsonSchema;
use crate::TS;
use serde::Deserialize;
use serde::Serialize;

/// Revisioned engine-owned user response wait measurements for a turn.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct UserWaitTimingUpdatedNotification {
    pub thread_id: String,
    pub turn_id: String,
    pub timing: codex_protocol::user_wait::UserWaitTiming,
}
