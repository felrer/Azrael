use crate::function_tool::FunctionCallError;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolPayload;
use crate::tools::context::boxed_tool_output;
use crate::tools::handlers::multi_agents_spec::AZRAEL_ROOT_DEFER_GUIDANCE;
use crate::tools::handlers::parse_arguments;
use crate::tools::registry::CoreToolRuntime;
use crate::tools::registry::ToolExecutor;
use codex_tools::JsonSchema;
use codex_tools::ResponsesApiTool;
use codex_tools::ToolName;
use codex_tools::ToolSpec;
use serde::Deserialize;
use serde::Serialize;
use serde_json::json;
use std::collections::BTreeMap;

pub(crate) const ROOT_RESUME_TOOL_NAME: &str = "defer_root";

pub(crate) struct RootResumeHandler;

impl ToolExecutor<ToolInvocation> for RootResumeHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain(ROOT_RESUME_TOOL_NAME)
    }

    fn spec(&self) -> ToolSpec {
        create_root_resume_tool()
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
            let arguments = match payload {
                ToolPayload::Function { arguments } => arguments,
                _ => {
                    return Err(FunctionCallError::RespondToModel(
                        "defer_root handler received unsupported payload".to_string(),
                    ));
                }
            };
            let args: RootResumeArgs = parse_arguments(&arguments)?;
            args.validate_schedule()?;
            let RootResumeArgs {
                resume_after_ms,
                resume_at,
                reason,
                wake_on,
            } = args;
            let agent_paths = wake_on
                .map(
                    |RootResumeWakeOn {
                         agent_paths,
                         condition: RootResumeWakeCondition::AllTerminal,
                     }| agent_paths,
                )
                .unwrap_or_default();

            let reservation = session
                .prepare_root_resume(
                    &turn,
                    &call_id,
                    resume_after_ms,
                    resume_at,
                    agent_paths,
                    reason,
                )
                .await
                .map_err(|err| FunctionCallError::RespondToModel(err.to_string()))?;
            let output = RootResumeOutput {
                reservation_id: reservation.id,
                resume_at_ms: reservation.resume_at_ms,
                state: RootResumePreparingState::Preparing,
            };
            let text = serde_json::to_string(&output).map_err(|err| {
                FunctionCallError::RespondToModel(format!(
                    "failed to serialize defer_root result: {err}"
                ))
            })?;

            Ok(boxed_tool_output(FunctionToolOutput::from_text(
                text,
                Some(true),
            )))
        })
    }
}

impl CoreToolRuntime for RootResumeHandler {
    fn is_builtin_control_tool(&self) -> bool {
        true
    }

    fn matches_kind(&self, payload: &ToolPayload) -> bool {
        matches!(payload, ToolPayload::Function { .. })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RootResumeArgs {
    resume_after_ms: Option<u64>,
    resume_at: Option<String>,
    reason: String,
    wake_on: Option<RootResumeWakeOn>,
}

impl RootResumeArgs {
    fn validate_schedule(&self) -> Result<(), FunctionCallError> {
        if self.resume_after_ms.is_some() == self.resume_at.is_some() {
            return Err(FunctionCallError::RespondToModel(
                "provide exactly one of `resume_after_ms` or `resume_at`".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RootResumeWakeOn {
    agent_paths: Vec<String>,
    condition: RootResumeWakeCondition,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RootResumeWakeCondition {
    AllTerminal,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RootResumeOutput {
    reservation_id: String,
    resume_at_ms: i64,
    state: RootResumePreparingState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum RootResumePreparingState {
    Preparing,
}

pub(crate) fn create_root_resume_tool() -> ToolSpec {
    let wake_on_properties = BTreeMap::from([
        (
            "agent_paths".to_string(),
            JsonSchema::array(
                JsonSchema::string(Some(
                    "Canonical child-agent path selected for terminal-state wakeup.".to_string(),
                )),
                Some("Child agents that must all become terminal to wake root early.".to_string()),
            ),
        ),
        (
            "condition".to_string(),
            JsonSchema::string_enum(
                vec![json!("all_terminal")],
                Some("Wake only after every selected child reaches a terminal state.".to_string()),
            ),
        ),
    ]);
    let properties = BTreeMap::from([
        (
            "resume_after_ms".to_string(),
            JsonSchema::integer(Some(
                "Delay in milliseconds before resuming root, from 1 through 43,200,000. Use exactly one scheduling field."
                    .to_string(),
            )),
        ),
        (
            "resume_at".to_string(),
            JsonSchema::string(Some(
                "Future UTC timestamp at which to resume root. Use exactly one scheduling field."
                    .to_string(),
            )),
        ),
        (
            "reason".to_string(),
            JsonSchema::string(Some(
                "Short reason shown while the root is deferred.".to_string(),
            )),
        ),
        (
            "wake_on".to_string(),
            JsonSchema::object(
                wake_on_properties,
                Some(vec!["agent_paths".to_string(), "condition".to_string()]),
                Some(false.into()),
            ),
        ),
    ]);
    let mut parameters = JsonSchema::object(
        properties,
        Some(vec!["reason".to_string()]),
        Some(false.into()),
    );
    parameters.one_of = Some(vec![
        JsonSchema {
            required: Some(vec!["resume_after_ms".to_string()]),
            ..Default::default()
        },
        JsonSchema {
            required: Some(vec!["resume_at".to_string()]),
            ..Default::default()
        },
    ]);

    ToolSpec::Function(ResponsesApiTool {
        name: ROOT_RESUME_TOOL_NAME.to_string(),
        description: format!(
            "Defer the root task while sub-agents continue. {AZRAEL_ROOT_DEFER_GUIDANCE}"
        ),
        strict: false,
        defer_loading: None,
        parameters,
        output_schema: Some(
            json!({
                "type": "object",
                "properties": {
                    "reservationId": { "type": "string" },
                    "resumeAtMs": { "type": "integer" },
                    "state": { "type": "string", "enum": ["preparing"] }
                },
                "required": ["reservationId", "resumeAtMs", "state"],
                "additionalProperties": false
            })
            .into(),
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use codex_tools::AdditionalProperties;

    #[test]
    fn defer_root_schema_requires_reason_and_exactly_one_schedule() {
        let ToolSpec::Function(tool) = create_root_resume_tool() else {
            panic!("expected function tool")
        };
        assert_eq!(tool.name, ROOT_RESUME_TOOL_NAME);
        assert_eq!(tool.parameters.required, Some(vec!["reason".to_string()]));
        assert_eq!(
            tool.parameters.additional_properties,
            Some(AdditionalProperties::Boolean(false))
        );
        let choices = tool.parameters.one_of.expect("schedule alternatives");
        assert_eq!(choices.len(), 2);
        assert_eq!(
            choices[0].required,
            Some(vec!["resume_after_ms".to_string()])
        );
        assert_eq!(choices[1].required, Some(vec!["resume_at".to_string()]));
    }

    #[test]
    fn defer_root_arguments_reject_unknown_fields_and_ambiguous_schedules() {
        assert!(
            parse_arguments::<RootResumeArgs>(
                r#"{"resume_after_ms":10,"reason":"waiting","extra":true}"#
            )
            .is_err()
        );

        for arguments in [
            r#"{"reason":"waiting"}"#,
            r#"{"resume_after_ms":10,"resume_at":"2099-01-01T00:00:00Z","reason":"waiting"}"#,
        ] {
            let args = parse_arguments::<RootResumeArgs>(arguments).expect("parse arguments");
            assert!(args.validate_schedule().is_err());
        }

        assert!(parse_arguments::<RootResumeArgs>(
            r#"{"resume_after_ms":10,"reason":"waiting","wake_on":{"agent_paths":[],"condition":"any_terminal"}}"#
        )
        .is_err());
    }

    #[test]
    fn defer_root_arguments_accept_timed_and_agent_terminal_wakes() {
        let timed =
            parse_arguments::<RootResumeArgs>(r#"{"resume_after_ms":10,"reason":"waiting"}"#)
                .expect("timed arguments");
        timed.validate_schedule().expect("valid timed schedule");

        let terminal = parse_arguments::<RootResumeArgs>(
            r#"{"resume_at":"2099-01-01T00:00:00Z","reason":"waiting","wake_on":{"agent_paths":["/root/research"],"condition":"all_terminal"}}"#,
        )
        .expect("agent wake arguments");
        terminal
            .validate_schedule()
            .expect("valid terminal wake schedule");
        assert_eq!(
            terminal.wake_on.expect("wake_on").agent_paths,
            vec!["/root/research"]
        );
    }

    #[test]
    fn defer_root_output_is_minimal_preparing_json() {
        let output = RootResumeOutput {
            reservation_id: "reservation-1".to_string(),
            resume_at_ms: 42,
            state: RootResumePreparingState::Preparing,
        };
        assert_eq!(
            serde_json::to_value(output).expect("serialize output"),
            json!({
                "reservationId": "reservation-1",
                "resumeAtMs": 42,
                "state": "preparing"
            })
        );
    }
}
