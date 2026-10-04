use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum RootResumeState {
    Preparing,
    Waiting,
    Claimed,
    Resumed,
    Cancelled,
    Blocked,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum RootResumeWakeReason {
    Deadline,
    AgentsCompleted,
    UserInput,
    Manual,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RootResumeAgentTask {
    pub thread_id: String,
    pub agent_path: String,
    pub turn_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RootResumeReservation {
    pub id: String,
    pub root_thread_id: String,
    pub originating_turn_id: String,
    pub root_turn_id: String,
    pub call_id: String,
    pub resume_turn_id: String,
    pub resume_at_ms: i64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    #[serde(default)]
    pub wait_started_at_ms: Option<i64>,
    #[serde(default)]
    pub wait_ended_at_ms: Option<i64>,
    pub revision: i64,
    pub state: RootResumeState,
    pub agent_tasks: Vec<RootResumeAgentTask>,
    pub reason: String,
    #[serde(default)]
    pub final_output_json_schema: Option<serde_json::Value>,
    pub wake_reason: Option<RootResumeWakeReason>,
    pub last_error: Option<String>,
}

/// Durable presentation metadata for the wait attached to its originating turn.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RootResumeWait {
    pub reservation_id: String,
    #[ts(type = "number")]
    pub revision: i64,
    #[ts(type = "number | null")]
    pub wait_started_at_ms: Option<i64>,
    #[ts(type = "number | null")]
    pub wait_ended_at_ms: Option<i64>,
    #[ts(type = "number")]
    pub resume_at_ms: i64,
    pub state: RootResumeState,
    pub can_wake_early: bool,
}

impl From<&RootResumeReservation> for RootResumeWait {
    fn from(record: &RootResumeReservation) -> Self {
        Self {
            reservation_id: record.id.clone(),
            revision: record.revision,
            wait_started_at_ms: record.wait_started_at_ms,
            wait_ended_at_ms: record.wait_ended_at_ms,
            resume_at_ms: record.resume_at_ms,
            state: record.state.clone(),
            can_wake_early: !record.agent_tasks.is_empty(),
        }
    }
}
