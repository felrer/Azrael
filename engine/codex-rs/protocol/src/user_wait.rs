use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use ts_rs::TS;

/// Measured human-response waits and the union of intervals that blocked work.
/// An absent timing value on an older turn is distinct from an empty measurement.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct UserWaitTiming {
    /// Exact turn origin for subtracting millisecond intervals from coarse history timestamps.
    #[serde(default)]
    #[ts(optional = nullable, type = "number | null")]
    pub started_at_ms: Option<i64>,
    #[ts(type = "number")]
    pub revision: u64,
    pub requests: Vec<UserWaitRequest>,
    pub blocked_intervals: Vec<UserWaitInterval>,
}

/// Raw request waiting time, independent of concurrent work.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct UserWaitRequest {
    pub request_id: String,
    pub call_id: String,
    pub kind: String,
    #[ts(type = "number")]
    pub started_at_ms: i64,
    #[ts(type = "number | null")]
    pub ended_at_ms: Option<i64>,
    #[ts(type = "number | null")]
    pub duration_ms: Option<i64>,
}

/// A period with pending human input and no running leaf activity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct UserWaitInterval {
    #[ts(type = "number")]
    pub started_at_ms: i64,
    #[ts(type = "number | null")]
    pub ended_at_ms: Option<i64>,
}
