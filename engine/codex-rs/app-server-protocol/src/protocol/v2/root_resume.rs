use crate::JsonSchema;
use crate::TS;
use codex_protocol::root_resume::RootResumeReservation;
use serde::Deserialize;
use serde::Serialize;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub enum RootResumeAction {
    List,
    Resume,
    Cancel,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct RootResumeParams {
    pub action: RootResumeAction,
    #[ts(optional = nullable)]
    pub reservation_id: Option<String>,
    #[ts(optional = nullable)]
    pub revision: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct RootResumeResponse {
    pub reservations: Vec<RootResumeReservation>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn root_resume_response_exposes_completion_tasks_and_work_completed() {
        let value = json!({
            "reservations": [{
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
                "state": "claimed",
                "agentTasks": [],
                "completionTasks": ["d640335a-f9b8-4f44-8b78-76932200bad0"],
                "reason": "wait",
                "wakeReason": "work_completed",
                "lastError": null
            }]
        });
        let response: RootResumeResponse =
            serde_json::from_value(value).expect("root resume response should deserialize");
        let encoded = serde_json::to_value(&response).expect("response should serialize");
        assert_eq!(
            encoded["reservations"][0]["completionTasks"],
            json!(["d640335a-f9b8-4f44-8b78-76932200bad0"])
        );
        assert_eq!(
            encoded["reservations"][0]["wakeReason"],
            json!("work_completed")
        );
        assert_eq!(
            serde_json::from_value::<RootResumeResponse>(encoded)
                .expect("response should round trip"),
            response
        );
    }

    #[test]
    fn root_resume_params_use_bounded_camel_case_shape() {
        let params: RootResumeParams = serde_json::from_value(json!({
            "action": "resume",
            "reservationId": "reservation-1",
            "revision": 3
        }))
        .expect("root resume params should deserialize");

        assert_eq!(params.action, RootResumeAction::Resume);
        assert_eq!(params.reservation_id.as_deref(), Some("reservation-1"));
        assert_eq!(params.revision, Some(3));
        assert_eq!(
            serde_json::to_value(params).expect("root resume params should serialize"),
            json!({
                "action": "resume",
                "reservationId": "reservation-1",
                "revision": 3
            })
        );
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct RootResumeWaitUpdatedNotification {
    pub thread_id: String,
    pub turn_id: String,
    pub wait: codex_protocol::root_resume::RootResumeWait,
}
