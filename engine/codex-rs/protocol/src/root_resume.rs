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
    WorkCompleted,
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
    #[serde(default)]
    pub completion_tasks: Vec<String>,
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
            can_wake_early: !record.agent_tasks.is_empty() || !record.completion_tasks.is_empty(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn reservation_json() -> serde_json::Value {
        json!({
            "id": "reservation",
            "rootThreadId": "root",
            "originatingTurnId": "origin",
            "rootTurnId": "turn",
            "callId": "call",
            "resumeTurnId": "resume",
            "resumeAtMs": 2000,
            "createdAtMs": 1000,
            "updatedAtMs": 1000,
            "revision": 0,
            "state": "waiting",
            "agentTasks": [],
            "reason": "wait",
            "wakeReason": null,
            "lastError": null
        })
    }

    #[test]
    fn old_reservation_json_defaults_completion_tasks_to_empty() {
        let record: RootResumeReservation =
            serde_json::from_value(reservation_json()).expect("old reservation should deserialize");
        assert!(record.completion_tasks.is_empty());
        assert!(!RootResumeWait::from(&record).can_wake_early);
    }

    #[test]
    fn completion_tasks_and_work_completed_round_trip() {
        let mut value = reservation_json();
        value["completionTasks"] = json!(["d640335a-f9b8-4f44-8b78-76932200bad0"]);
        value["wakeReason"] = json!("work_completed");
        let record: RootResumeReservation =
            serde_json::from_value(value).expect("completion reservation should deserialize");
        assert_eq!(
            record.wake_reason,
            Some(RootResumeWakeReason::WorkCompleted)
        );
        assert_eq!(
            serde_json::to_value(&record).expect("reservation should serialize")["completionTasks"],
            json!(["d640335a-f9b8-4f44-8b78-76932200bad0"])
        );
        let restored: RootResumeReservation = serde_json::from_str(
            &serde_json::to_string(&record).expect("reservation should serialize"),
        )
        .expect("reservation should deserialize");
        assert_eq!(restored, record);
    }

    #[test]
    fn wait_can_wake_early_for_either_task_kind() {
        let mut record: RootResumeReservation =
            serde_json::from_value(reservation_json()).expect("reservation should deserialize");
        record
            .completion_tasks
            .push("d640335a-f9b8-4f44-8b78-76932200bad0".to_string());
        assert!(RootResumeWait::from(&record).can_wake_early);
        record.completion_tasks.clear();
        record.agent_tasks.push(RootResumeAgentTask {
            thread_id: "child".to_string(),
            agent_path: "/root/child".to_string(),
            turn_id: "child-turn".to_string(),
        });
        assert!(RootResumeWait::from(&record).can_wake_early);
    }
}
