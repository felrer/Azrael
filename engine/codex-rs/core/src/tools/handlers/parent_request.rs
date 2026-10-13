use crate::function_tool::FunctionCallError;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolPayload;
use crate::tools::context::boxed_tool_output;
use crate::tools::handlers::parse_arguments;
use crate::tools::registry::CoreToolRuntime;
use crate::tools::registry::ToolExecutor;
use codex_protocol::parent_request::ParentRequestStatus;
use codex_protocol::parent_request::ParentResponse;
use codex_tools::JsonSchema;
use codex_tools::ResponsesApiTool;
use codex_tools::ToolName;
use codex_tools::ToolSpec;
use serde::Deserialize;
use serde_json::json;
use std::collections::BTreeMap;

pub(crate) enum ParentRequestHandler {
    Request,
    Await,
    Respond,
}

impl ToolExecutor<ToolInvocation> for ParentRequestHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain(match self {
            Self::Request => "request_parent",
            Self::Await => "await_parent_response",
            Self::Respond => "respond_to_request",
        })
    }

    fn spec(&self) -> ToolSpec {
        let (description, fields, required) = match self {
            Self::Request => (
                "Ask your parent for a decision that blocks dependent work. Batch related questions in one request, give context and a recommendation, and advance independent work before awaiting. Reuse the same request_key for the same unresolved question. Reception is not approval. Requests and responses are logged automatically.",
                vec![
                    (
                        "request_key",
                        "Stable nonempty key for this question within your task; reuse it on retries.",
                    ),
                    (
                        "question",
                        "Nonempty decision question; batch related questions.",
                    ),
                    (
                        "context",
                        "Nonempty evidence and context needed by the parent.",
                    ),
                    (
                        "recommendation",
                        "Nonempty recommended decision and its impact.",
                    ),
                    (
                        "blocked_action",
                        "Nonempty dependent action that must wait for a decision.",
                    ),
                ],
                vec![
                    "request_key",
                    "question",
                    "context",
                    "recommendation",
                    "blocked_action",
                ],
            ),
            Self::Await => (
                "Park this child at the persisted tool-result boundary until its parent request changes. Call as the final sequential action after independent work is exhausted. Wait on the same request_id; do not resend the question or repeatedly poll the model. This preserves the child task and does not mark it complete. Inspect the response before dependent work: reception alone is not approval, and deferred responses require their retry condition.",
                vec![(
                    "request_id",
                    "Exact request ID returned by request_parent; keep using the same ID.",
                )],
                vec!["request_id"],
            ),
            Self::Respond => (
                "Record a decision for a request you own. Resolve, cancel, or defer it with an explicit decision and reason. Deferred responses require a nonempty retry_condition. Ownership and requester identity are checked by the backend; responses are logged automatically. Receipt of a question does not grant approval.",
                vec![
                    ("request_id", "Exact ID of a request owned by you."),
                    (
                        "status",
                        "Response status: resolved, cancelled, or deferred.",
                    ),
                    (
                        "decision",
                        "Nonempty explicit decision for the requested action.",
                    ),
                    ("reason", "Nonempty reason supporting the decision."),
                    (
                        "retry_condition",
                        "Required and nonempty when status is deferred; condition allowing reconsideration.",
                    ),
                ],
                vec!["request_id", "status", "decision", "reason"],
            ),
        };
        let mut properties = fields
            .into_iter()
            .map(|(name, description)| {
                (
                    name.to_string(),
                    JsonSchema::string(Some(description.to_string())),
                )
            })
            .collect::<BTreeMap<_, _>>();
        if matches!(self, Self::Respond) {
            properties.insert(
                "status".to_string(),
                JsonSchema::string_enum(
                    vec![json!("resolved"), json!("cancelled"), json!("deferred")],
                    Some("Explicit parent decision status.".to_string()),
                ),
            );
        }
        ToolSpec::Function(ResponsesApiTool {
            name: self.tool_name().name,
            description: description.to_string(),
            strict: false,
            defer_loading: None,
            parameters: JsonSchema::object(
                properties,
                Some(required.into_iter().map(str::to_string).collect()),
                Some(false.into()),
            ),
            output_schema: None,
        })
    }

    fn handle<'a>(&'a self, invocation: ToolInvocation) -> codex_tools::ToolExecutorFuture<'a>
    where
        ToolInvocation: 'a,
    {
        Box::pin(async move {
            let ToolInvocation {
                session,
                turn,
                call_id,
                payload,
                ..
            } = invocation;
            let ToolPayload::Function { arguments } = payload else {
                return Err(invalid(
                    "parent request handler received unsupported payload",
                ));
            };
            let output = match self {
                Self::Request => {
                    let args: RequestArgs = parse_arguments(&arguments)?;
                    let request = session
                        .request_parent(
                            &turn,
                            args.request_key,
                            args.question,
                            args.context,
                            args.recommendation,
                            args.blocked_action,
                        )
                        .await
                        .map_err(|error| invalid(&error.to_string()))?;
                    serde_json::to_value(request).map_err(|error| invalid(&error.to_string()))?
                }
                Self::Await => {
                    let args: AwaitArgs = parse_arguments(&arguments)?;
                    session
                        .prepare_parent_response_wait(&turn, &call_id, &args.request_id)
                        .await
                        .map_err(|error| invalid(&error.to_string()))?
                }
                Self::Respond => {
                    let args: RespondArgs = parse_arguments(&arguments)?;
                    args.validate()?;
                    let request = session
                        .respond_to_parent_request(
                            &turn,
                            &args.request_id,
                            ParentResponse {
                                status: match args.status {
                                    ResponseStatus::Resolved => ParentRequestStatus::Resolved,
                                    ResponseStatus::Cancelled => ParentRequestStatus::Cancelled,
                                    ResponseStatus::Deferred => ParentRequestStatus::Deferred,
                                },
                                decision: args.decision,
                                reason: args.reason,
                                retry_condition: args.retry_condition,
                            },
                        )
                        .await
                        .map_err(|error| invalid(&error.to_string()))?;
                    serde_json::to_value(request).map_err(|error| invalid(&error.to_string()))?
                }
            };
            Ok(boxed_tool_output(FunctionToolOutput::from_text(
                serde_json::to_string(&output).map_err(|error| invalid(&error.to_string()))?,
                Some(true),
            )))
        })
    }
}

impl CoreToolRuntime for ParentRequestHandler {
    fn is_builtin_control_tool(&self) -> bool {
        matches!(self, Self::Await)
    }

    fn matches_kind(&self, payload: &ToolPayload) -> bool {
        matches!(payload, ToolPayload::Function { .. })
    }
}

fn invalid(message: &str) -> FunctionCallError {
    FunctionCallError::RespondToModel(message.to_string())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestArgs {
    request_key: String,
    question: String,
    context: String,
    recommendation: String,
    blocked_action: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AwaitArgs {
    request_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RespondArgs {
    request_id: String,
    status: ResponseStatus,
    decision: String,
    reason: String,
    retry_condition: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ResponseStatus {
    Resolved,
    Cancelled,
    Deferred,
}

impl RespondArgs {
    fn validate(&self) -> Result<(), FunctionCallError> {
        if matches!(self.status, ResponseStatus::Deferred)
            && self
                .retry_condition
                .as_deref()
                .is_none_or(|condition| condition.trim().is_empty())
        {
            return Err(invalid(
                "deferred responses require a nonempty retry_condition",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use codex_tools::AdditionalProperties;

    #[test]
    fn parent_request_schemas_require_decision_inputs_and_reject_extra_properties() {
        for (handler, expected) in [
            (
                ParentRequestHandler::Request,
                vec![
                    "request_key",
                    "question",
                    "context",
                    "recommendation",
                    "blocked_action",
                ],
            ),
            (ParentRequestHandler::Await, vec!["request_id"]),
            (
                ParentRequestHandler::Respond,
                vec!["request_id", "status", "decision", "reason"],
            ),
        ] {
            let ToolSpec::Function(tool) = handler.spec() else {
                panic!("expected function tool")
            };
            assert_eq!(
                tool.parameters.required,
                Some(expected.into_iter().map(str::to_string).collect())
            );
            assert_eq!(
                tool.parameters.additional_properties,
                Some(AdditionalProperties::Boolean(false))
            );
        }
    }

    #[test]
    fn parent_request_only_await_is_a_control_tool() {
        assert!(ParentRequestHandler::Await.is_builtin_control_tool());
        assert!(!ParentRequestHandler::Request.is_builtin_control_tool());
        assert!(!ParentRequestHandler::Respond.is_builtin_control_tool());
    }

    #[test]
    fn parent_request_arguments_reject_unknown_fields() {
        assert!(parse_arguments::<RequestArgs>(r#"{"request_key":"key","question":"q","context":"c","recommendation":"r","blocked_action":"a","extra":true}"#).is_err());
        assert!(parse_arguments::<AwaitArgs>(r#"{"request_id":"id","extra":true}"#).is_err());
        assert!(parse_arguments::<RespondArgs>(r#"{"request_id":"id","status":"resolved","decision":"d","reason":"r","extra":true}"#).is_err());
    }

    #[test]
    fn parent_request_response_requires_explicit_status_and_deferred_retry_condition() {
        for status in ["open", "received", "waiting", "approved"] {
            let arguments =
                json!({"request_id":"id","status":status,"decision":"d","reason":"r"}).to_string();
            assert!(parse_arguments::<RespondArgs>(&arguments).is_err());
        }
        for condition in [None, Some(""), Some("  ")] {
            let arguments = json!({"request_id":"id","status":"deferred","decision":"d","reason":"r","retry_condition":condition}).to_string();
            assert!(
                parse_arguments::<RespondArgs>(&arguments)
                    .unwrap()
                    .validate()
                    .is_err()
            );
        }
        for status in ["resolved", "cancelled", "deferred"] {
            let arguments = json!({"request_id":"id","status":status,"decision":"d","reason":"r","retry_condition":"required evidence arrives"}).to_string();
            assert!(
                parse_arguments::<RespondArgs>(&arguments)
                    .unwrap()
                    .validate()
                    .is_ok()
            );
        }
    }
}
