use crate::function_tool::FunctionCallError;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolPayload;
use crate::tools::context::boxed_tool_output;
use crate::tools::handlers::parse_arguments;
use crate::tools::registry::CoreToolRuntime;
use crate::tools::registry::ToolExecutor;
use codex_protocol::items::AgentMessageContent;
use codex_protocol::items::AgentMessageDelivery;
use codex_protocol::items::AgentMessageItem;
use codex_protocol::items::AsyncUserInputQuestion;
use codex_protocol::items::TurnItem;
use codex_protocol::models::MessagePhase;
use codex_tools::JsonSchema;
use codex_tools::ResponsesApiTool;
use codex_tools::ToolName;
use codex_tools::ToolSpec;
use serde::Deserialize;
use std::collections::BTreeMap;

const TOOL_NAME: &str = "request_user_input_async";

pub struct RequestUserInputAsyncHandler {
    pub description: String,
    pub parameters: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestUserInputAsyncArgs {
    questions: Vec<AsyncUserInputQuestion>,
}

impl ToolExecutor<ToolInvocation> for RequestUserInputAsyncHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain(TOOL_NAME)
    }

    fn spec(&self) -> ToolSpec {
        let mut options = JsonSchema::array(
            JsonSchema::string(/*description*/ None),
            Some("Suggested answers, in display order. Put the recommended answer first; the first option is preselected by default. The user can select one option or enter a free-text answer. Do not include an Other option or a free-text placeholder; the UI provides free-text input automatically. Omit options for a free-text-only question.".to_string()),
        );
        options.min_items = Some(1);
        let question = JsonSchema::object(
            BTreeMap::from([
                ("title".to_string(), JsonSchema::string(Some("The complete question shown to the user, including any context needed to answer it.".to_string()))),
                ("options".to_string(), options),
            ]),
            Some(vec!["title".to_string()]),
            /*additional_properties*/ Some(false.into()),
        );
        let mut questions = JsonSchema::array(
            question,
            Some(
                "One or more self-contained questions to present together, in display order."
                    .to_string(),
            ),
        );
        questions.min_items = Some(1);
        let properties = BTreeMap::from([("questions".to_string(), questions)]);
        let mut parameters = JsonSchema::object(
            properties,
            Some(vec!["questions".to_string()]),
            /*additional_properties*/ Some(false.into()),
        );
        if let Some(parameters_override) = &self.parameters {
            match crate::tools::catalog_parameters::parse(parameters_override) {
                Ok(schema) => parameters = schema,
                Err(reason) => tracing::warn!(
                    tool = TOOL_NAME,
                    reason,
                    "Invalid catalog tool parameters; using bundled parameters"
                ),
            }
        }

        ToolSpec::Function(ResponsesApiTool {
            name: TOOL_NAME.to_string(),
            description: format!(
                "{}\nIf a question becomes unnecessary during subsequent work, withdraw it with withdraw_user_questions.",
                self.description
            ),
            strict: false,
            defer_loading: None,
            parameters,
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
                payload,
                ..
            } = invocation;
            let ToolPayload::Function { arguments } = payload else {
                return Err(FunctionCallError::RespondToModel(format!(
                    "{TOOL_NAME} handler received unsupported payload"
                )));
            };
            let args: RequestUserInputAsyncArgs = parse_arguments(&arguments)?;
            if args.questions.is_empty() {
                return Err(FunctionCallError::RespondToModel(
                    "questions must not be empty".to_string(),
                ));
            }
            let mut messages = Vec::with_capacity(args.questions.len());
            for question in &args.questions {
                if question.title.trim().is_empty() {
                    return Err(FunctionCallError::RespondToModel(
                        "question titles must not be empty".to_string(),
                    ));
                }
                let mut lines = vec![question.title.clone()];
                if let Some(options) = &question.options {
                    if options.is_empty() || options.iter().any(|option| option.trim().is_empty()) {
                        return Err(FunctionCallError::RespondToModel(
                            "options must contain at least one non-empty answer".to_string(),
                        ));
                    }
                    lines.extend(options.iter().map(|option| format!("- {option}")));
                }
                messages.push(lines.join("\n"));
            }

            if args.questions.iter().any(|q| q.withdrawn) {
                return Err(FunctionCallError::RespondToModel(
                    "new questions cannot be withdrawn".into(),
                ));
            }
            let _guard = session.root_resume_submission_guard().await;
            let message_id = uuid::Uuid::now_v7().to_string();
            let question_ids: Vec<_> = (0..args.questions.len())
                .map(|index| crate::session::user_questions::question_id(&message_id, index))
                .collect();
            let item = TurnItem::AgentMessage(AgentMessageItem {
                id: message_id,
                content: vec![AgentMessageContent::Text {
                    text: messages.join("\n\n"),
                }],
                phase: Some(MessagePhase::FinalAnswer),
                memory_citation: None,
                delivery: Some(AgentMessageDelivery::Async),
                questions: Some(args.questions),
            });
            session.observe_user_question_event(
                &codex_protocol::protocol::EventMsg::ItemCompleted(
                    codex_protocol::protocol::ItemCompletedEvent {
                        thread_id: session.thread_id,
                        turn_id: turn.sub_id.clone(),
                        item: item.clone(),
                        started_at_ms: None,
                        completed_at_ms: 0,
                    },
                ),
            );
            session.emit_turn_item_started(turn.as_ref(), &item).await;
            session.emit_turn_item_completed(turn.as_ref(), item).await;
            session
                .flush_rollout()
                .await
                .map_err(|e| FunctionCallError::RespondToModel(e.to_string()))?;
            session.notify_question_state_changed().await;

            Ok(boxed_tool_output(FunctionToolOutput::from_text(
                serde_json::json!({"accepted": true, "question_ids": question_ids}).to_string(),
                /*success*/ Some(true),
            )))
        })
    }
}

impl CoreToolRuntime for RequestUserInputAsyncHandler {
    fn is_builtin_control_tool(&self) -> bool {
        true
    }
}

pub struct WithdrawUserQuestionsHandler;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WithdrawUserQuestionsArgs {
    question_ids: Vec<String>,
}

impl ToolExecutor<ToolInvocation> for WithdrawUserQuestionsHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain("withdraw_user_questions")
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec::Function(ResponsesApiTool {
            name: "withdraw_user_questions".into(),
            description: "Withdraw questions that are no longer needed, using question_ids returned by request_user_input_async.".into(),
            strict: false,
            defer_loading: None,
            parameters: JsonSchema::object(BTreeMap::from([("question_ids".into(), JsonSchema::array(JsonSchema::string(None), None))]), Some(vec!["question_ids".into()]), Some(false.into())),
            output_schema: None,
        })
    }

    fn handle<'a>(&'a self, invocation: ToolInvocation) -> codex_tools::ToolExecutorFuture<'a>
    where
        ToolInvocation: 'a,
    {
        Box::pin(async move {
            let ToolPayload::Function { arguments } = invocation.payload else {
                return Err(FunctionCallError::RespondToModel(
                    "withdraw_user_questions requires function arguments".into(),
                ));
            };
            let args: WithdrawUserQuestionsArgs = parse_arguments(&arguments)?;
            invocation
                .session
                .withdraw_user_questions(&args.question_ids)
                .await
                .map_err(|e| FunctionCallError::RespondToModel(e.to_string()))?;
            Ok(boxed_tool_output(FunctionToolOutput::from_text(
                serde_json::json!({"accepted": true}).to_string(),
                Some(true),
            )))
        })
    }
}

impl CoreToolRuntime for WithdrawUserQuestionsHandler {
    fn is_builtin_control_tool(&self) -> bool {
        true
    }
}
