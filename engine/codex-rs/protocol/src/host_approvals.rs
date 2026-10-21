//! Host-owned approval receipts. These records never authorize engine tools.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
pub enum HostApprovalState {
    Pending,
    Accepted,
    Declined,
    Cancelled,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
pub enum HostApprovalDecision {
    Accept,
    Decline,
    Cancel,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
pub enum HostApprovalPersistence {
    Session,
    Always,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
pub enum HostApprovalResumeState {
    None,
    Pending,
    Claimed,
    Resumed,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct HostApprovalRecord {
    pub request_id: String,
    pub scope_key: String,
    pub payload: serde_json::Value,
    pub state: HostApprovalState,
    pub persistence: Option<HostApprovalPersistence>,
    pub original_turn_id: Option<String>,
    pub original_root_turn_id: Option<String>,
    pub waiter_detached: bool,
    pub resume_state: HostApprovalResumeState,
    pub resume_turn_id: Option<String>,
}
/// Private persisted owner binding. Never returned by host approval RPCs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct StoredHostApproval {
    pub owner_hash: String,
    pub request: HostApprovalRecord,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct HostApprovalLedgerEvent {
    pub thread_id: crate::ThreadId,
    pub updates: Vec<StoredHostApproval>,
}

impl HostApprovalRecord {
    /// Archiving must not preserve a usable receipt or an undispatched wake.
    pub fn requires_invalidation(&self) -> bool {
        matches!(
            self.state,
            HostApprovalState::Pending | HostApprovalState::Accepted
        ) || matches!(
            self.resume_state,
            HostApprovalResumeState::Pending | HostApprovalResumeState::Claimed
        )
    }
}
impl HostApprovalLedgerEvent {
    pub fn apply_to(
        &self,
        thread_id: crate::ThreadId,
        ledger: &mut std::collections::BTreeMap<String, StoredHostApproval>,
    ) {
        if self.thread_id != thread_id {
            return;
        }
        for update in &self.updates {
            ledger.insert(update.request.request_id.clone(), update.clone());
        }
    }
}
