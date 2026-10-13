//! Durable direct-parent decisions and runtime-measured response waits.
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ParentRequestStatus {
    Pending,
    Resolved,
    Cancelled,
    Deferred,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ParentRequestDeliveryState {
    Queued,
    ResumeScheduled,
    Delivered,
    Blocked,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ParentResponse {
    pub status: ParentRequestStatus,
    pub decision: String,
    pub reason: String,
    pub retry_condition: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ParentRequest {
    pub request_id: String,
    pub request_key: String,
    pub parent_thread_id: String,
    pub child_thread_id: String,
    pub child_task_id: String,
    pub question: String,
    pub context: String,
    pub recommendation: String,
    pub blocked_action: String,
    pub status: ParentRequestStatus,
    /// Delivery of the current leg: request before response, response after save.
    pub delivery_state: ParentRequestDeliveryState,
    /// Content-free delivery diagnostic code; never question or response text.
    pub delivery_reason: Option<String>,
    pub response: Option<ParentResponse>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ParentResponseWaitResult {
    Answered,
    Cancelled,
    Interrupted,
    WaitFailed,
}

/// Captured runtime choices for recovery; serialized policy values contain no secrets.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ParentResponseWaitSettings {
    pub model: String,
    pub provider_id: String,
    pub reasoning_effort: Option<crate::openai_models::ReasoningEffort>,
    pub final_output_json_schema: Option<serde_json::Value>,
    pub permission_profile: serde_json::Value,
    pub approval_policy: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ParentResponseWait {
    pub wait_id: String,
    pub request_id: String,
    pub child_task_id: String,
    pub child_thread_id: String,
    pub originating_call_id: String,
    pub started_at_ms: i64,
    /// First actual blocked boundary, separate from the preparation timestamp.
    #[serde(default)]
    pub parked_at_ms: Option<i64>,
    pub last_checkpoint_at_ms: i64,
    pub ended_at_ms: Option<i64>,
    /// Monotonic active duration supplied by core. Offline elapsed time is unknown.
    pub measured_active_ms: i64,
    pub result: Option<ParentResponseWaitResult>,
    pub resume_settings: Option<ParentResponseWaitSettings>,
}
