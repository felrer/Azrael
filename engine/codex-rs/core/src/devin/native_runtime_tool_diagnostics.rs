// Bounded structural tool invocation diagnostics; contains no raw tool data.
use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Deserialize, Serialize)]
#[serde(try_from = "u64")]
struct SafeInteger(u64);
impl TryFrom<u64> for SafeInteger {
    type Error = &'static str;
    fn try_from(value: u64) -> Result<Self, Self::Error> {
        if value <= 9_007_199_254_740_991 {
            Ok(Self(value))
        } else {
            Err("invalid tool diagnostics integer")
        }
    }
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(try_from = "String")]
struct Sha256(String);
impl TryFrom<String> for Sha256 {
    type Error = &'static str;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            Ok(Self(value))
        } else {
            Err("invalid tool diagnostics hash")
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ToolDiagnostics {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    catalog_sha256: Option<Sha256>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    raw_name_sha256: Option<Sha256>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parser_name_sha256: Option<Sha256>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    declared_alias_sha256: Option<Sha256>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    catalog_tool_count: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    history_alias_count: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    call_count: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    raw_name_bytes: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parser_name_bytes: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    args_delta_count: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    args_empty_delta_count: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    args_bytes: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sse_args_delta_count: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sse_args_empty_delta_count: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sse_args_bytes: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    args_idle_ms: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    call_elapsed_ms: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    call_open: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    raw_parser_name_equal: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    call_state: Option<CallState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name_style: Option<NameStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name_match: Option<NameMatch>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    mapping_result: Option<MappingResult>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    json_result: Option<JsonResult>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum CallState {
    None,
    Started,
    ReceivingArgs,
    Ended,
    Validated,
    Rejected,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum NameStyle {
    Alias,
    PrefixedAlias,
    Original,
    Qualified,
    Missing,
    Oversized,
    Other,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum NameMatch {
    Declared,
    HistoryOnly,
    CurrentOriginal,
    CurrentQualified,
    Missing,
    Unknown,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum MappingResult {
    None,
    Declared,
    Undeclared,
    DuplicateId,
    InvalidArguments,
    InvalidCustomWrapper,
    ParallelDisabled,
    Validated,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum JsonResult {
    NotChecked,
    ValidObject,
    NotObject,
    InvalidJson,
}

#[cfg(test)]
#[path = "native_runtime_tool_diagnostics_tests.rs"]
mod tests;
