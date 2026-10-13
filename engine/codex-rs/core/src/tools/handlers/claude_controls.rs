//! Claude-compatible control tools backed by the current native registry.
use crate::agent::api::AgentTarget;
use crate::function_tool::FunctionCallError;
use crate::session::session::Session;
use crate::tools::context::{ToolInvocation, ToolOutput, ToolPayload};
use crate::tools::hook_names::HookToolName;
use crate::tools::registry::{
    CoreToolRuntime, PostToolUsePayload, PreToolUsePayload, ToolExecutor, ToolExposure,
    ToolTelemetryTags,
};
use codex_protocol::models::{
    FunctionCallOutputBody, FunctionCallOutputContentItem, ResponseInputItem, SearchToolCallParams,
};
use codex_tools::{JsonSchema, ResponsesApiTool, ToolName, ToolSpec};
use futures::future::BoxFuture;
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ClaudeControlKind {
    Agent,
    Skill,
    ToolSearch,
    AskUserQuestion,
}

impl ClaudeControlKind {
    fn name(self) -> &'static str {
        match self {
            Self::Agent => "Agent",
            Self::Skill => "Skill",
            Self::ToolSearch => "ToolSearch",
            Self::AskUserQuestion => "AskUserQuestion",
        }
    }
}

pub(crate) struct ClaudeControlHandler {
    kind: ClaudeControlKind,
    backend: Arc<dyn CoreToolRuntime>,
}

impl ClaudeControlHandler {
    /// The caller must copy the source's effective policy and capabilities, and
    /// must not register a replacement when its native source is unavailable.
    pub(crate) fn new(kind: ClaudeControlKind, backend: Arc<dyn CoreToolRuntime>) -> Self {
        Self { kind, backend }
    }

    pub(crate) fn ask_user_question(
        blocking: Option<Arc<dyn CoreToolRuntime>>,
        asynchronous: Option<Arc<dyn CoreToolRuntime>>,
    ) -> Option<Self> {
        let backend = blocking.or(asynchronous)?;
        Some(Self {
            kind: ClaudeControlKind::AskUserQuestion,
            backend,
        })
    }

    fn backend_for(&self, _invocation: &ToolInvocation) -> &Arc<dyn CoreToolRuntime> {
        // Prefer the allowed synchronous runtime in every mode. Only a missing
        // synchronous source selects delivery-only asynchronous semantics.
        &self.backend
    }

    fn native_parameter_exposed(&self, parameter: &str) -> bool {
        let exposes = |tool: &ResponsesApiTool| {
            tool.parameters
                .properties
                .as_ref()
                .is_some_and(|properties| properties.contains_key(parameter))
        };
        match self.backend.spec() {
            ToolSpec::Function(tool) => exposes(&tool),
            ToolSpec::Namespace(namespace) => namespace.tools.iter().any(|tool| {
                matches!(tool, codex_tools::ResponsesApiNamespaceTool::Function(function) if function.name == self.backend.tool_name().name && exposes(function))
            }),
            _ => false,
        }
    }

    fn native_model_overrides_exposed(&self) -> bool {
        self.native_parameter_exposed("model")
    }

    fn validate_native_capabilities(&self, arguments: &Value) -> Result<(), FunctionCallError> {
        if self.kind == ClaudeControlKind::Agent
            && arguments.get("model").is_some()
            && !self.native_model_overrides_exposed()
        {
            return Err(invalid(
                "Agent model overrides are unavailable in the native tool configuration; omit model to inherit the configured model",
            ));
        }
        if self.kind == ClaudeControlKind::Agent
            && !self.native_parameter_exposed("agent_type")
            && arguments
                .get("subagent_type")
                .is_some_and(|role| role.as_str() != Some("default"))
        {
            return Err(invalid(
                "Agent role overrides are unavailable in the native tool configuration; subagent_type must be default to use the configured native role",
            ));
        }
        Ok(())
    }

    fn translate_value(
        &self,
        value: Value,
        call_id: &str,
        native_name: &str,
    ) -> Result<ToolPayload, FunctionCallError> {
        self.validate_native_capabilities(&value)?;
        let mut payload = translate_arguments(self.kind, value, call_id, native_name)?;
        if self.kind == ClaudeControlKind::Agent && !self.native_parameter_exposed("agent_type") {
            let ToolPayload::Function { arguments } = &mut payload else {
                unreachable!("Agent uses native function arguments")
            };
            let mut native: Value =
                serde_json::from_str(arguments).map_err(|error| invalid(error.to_string()))?;
            native
                .as_object_mut()
                .expect("native Agent object")
                .remove("agent_type");
            *arguments = native.to_string();
        }
        Ok(payload)
    }

    fn translate(&self, invocation: &ToolInvocation) -> Result<ToolInvocation, FunctionCallError> {
        let backend = self.backend_for(invocation);
        let ToolPayload::Function { arguments } = &invocation.payload else {
            return Err(invalid(
                "compatible control tools require function arguments",
            ));
        };
        let value: Value = serde_json::from_str(arguments).map_err(|e| invalid(e.to_string()))?;
        let payload =
            self.translate_value(value, &invocation.call_id, &backend.tool_name().name)?;
        Ok(ToolInvocation {
            tool_name: backend.tool_name(),
            payload,
            ..invocation.clone()
        })
    }

    async fn try_host_skill(
        &self,
        invocation: &ToolInvocation,
    ) -> Result<Option<Box<dyn ToolOutput>>, FunctionCallError> {
        if self.kind != ClaudeControlKind::Skill {
            return Ok(None);
        }
        let ToolPayload::Function { arguments } = &invocation.payload else {
            return Err(invalid("Skill requires function arguments"));
        };
        let args: SkillArgs =
            decode(serde_json::from_str(arguments).map_err(|e| invalid(e.to_string()))?)?;
        let snapshot = invocation.turn.skills_snapshot();
        let outcome = snapshot.outcome();
        let matching = outcome
            .skills
            .iter()
            .filter(|skill| skill.name == args.skill && outcome.is_skill_enabled(skill))
            .collect::<Vec<_>>();
        if matching.is_empty() {
            return Ok(None);
        }
        if matching.len() != 1 {
            return Err(invalid(
                "Skill name is ambiguous in the current host catalog; use its native package or source locator",
            ));
        }
        let selected = [matching[0].clone()];
        // Reuse the same owning-filesystem read and typed instruction renderer
        // as an explicit skill mention. The model supplies a catalog name,
        // never a filesystem path or a replacement root.
        let prompts = snapshot.load_skill_prompts(&selected).await;
        let fragments = prompts
            .fragments
            .iter()
            .map(|fragment| fragment.render())
            .collect::<Vec<_>>();
        if invocation
            .step_context
            .settings
            .model_info
            .slug
            .starts_with("api/")
            && fragments.iter().any(|text| {
                codex_skills_extension::project_api_skill_fragment(
                    "skills.selected_skill_instructions",
                    text,
                )
                .is_none()
            })
        {
            return Err(invalid(
                "Skill is unavailable for the current model environment",
            ));
        }
        crate::skills::emit_explicit_skill_invocations(
            invocation.session.as_ref(),
            invocation.turn.as_ref(),
            &selected,
            &prompts.injected,
            codex_analytics::build_track_events_context(
                invocation.step_context.settings.model_info.slug.clone(),
                invocation.session.thread_id.to_string(),
                invocation.turn.sub_id.clone(),
                invocation.turn.originator.clone(),
                Some(invocation.turn.turn_metadata_state.clone()),
            ),
        )
        .await;
        if prompts.injected.is_empty() {
            return Err(invalid(prompts.warnings.join("\n")));
        }
        Ok(Some(Box::new(codex_tools::JsonToolOutput::new(json!({
            "skill":args.skill,"contents":fragments.join("\n"),"arguments":args.args,
            "warnings":prompts.warnings,
        })))))
    }
}

fn invalid(message: impl Into<String>) -> FunctionCallError {
    FunctionCallError::RespondToModel(message.into())
}
fn decode<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, FunctionCallError> {
    serde_json::from_value(value).map_err(|e| invalid(e.to_string()))
}
fn function(value: Value) -> ToolPayload {
    ToolPayload::Function {
        arguments: value.to_string(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentArgs {
    prompt: String,
    description: String,
    subagent_type: String,
    model: Option<String>,
    run_in_background: Option<bool>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SkillArgs {
    skill: String,
    args: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchArgs {
    query: String,
    max_results: Option<usize>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct QuestionArgs {
    questions: Vec<Question>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Question {
    question: String,
    header: String,
    options: Vec<QuestionOption>,
    #[serde(default, rename = "multiSelect")]
    multi_select: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct QuestionOption {
    label: String,
    description: String,
}

fn task_name(description: &str, call_id: &str) -> String {
    let slug = |text: &str| {
        text.chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    '_'
                }
            })
            .collect::<String>()
    };
    format!(
        "{}_{}",
        slug(description).chars().take(40).collect::<String>(),
        slug(call_id)
    )
}

fn translate_arguments(
    kind: ClaudeControlKind,
    value: Value,
    call_id: &str,
    native_name: &str,
) -> Result<ToolPayload, FunctionCallError> {
    Ok(match kind {
        ClaudeControlKind::Agent => {
            let args: AgentArgs = decode(value)?;
            if args.prompt.trim().is_empty()
                || args.description.trim().is_empty()
                || args.subagent_type.trim().is_empty()
            {
                return Err(invalid(
                    "prompt, description and subagent_type must not be empty",
                ));
            }
            if args
                .model
                .as_deref()
                .is_some_and(|m| ["sonnet", "opus", "haiku", "fable"].contains(&m))
            {
                return Err(invalid(
                    "model aliases are not available; provide the native catalog model identifier",
                ));
            }
            let mut native = json!({"message":args.prompt,"task_name":task_name(&args.description, call_id),"agent_type":args.subagent_type,"fork_turns":"none"});
            if let Some(model) = args.model {
                native["model"] = model.into();
            }
            function(native)
        }
        ClaudeControlKind::Skill => {
            let args: SkillArgs = decode(value)?;
            if args.skill.trim().is_empty() {
                return Err(invalid(
                    "skill must be a current skills.list package or alias",
                ));
            }
            function(json!({"package":args.skill}))
        }
        ClaudeControlKind::ToolSearch => {
            let args: SearchArgs = decode(value)?;
            if args.query.trim().is_empty() || args.max_results == Some(0) {
                return Err(invalid(
                    "query must be nonempty and max_results must be positive",
                ));
            }
            ToolPayload::ToolSearch {
                arguments: SearchToolCallParams {
                    query: args.query,
                    limit: args.max_results,
                },
            }
        }
        ClaudeControlKind::AskUserQuestion => {
            let args: QuestionArgs = decode(value)?;
            if args.questions.is_empty() || args.questions.len() > 3 {
                return Err(invalid("provide one to three questions"));
            }
            let mut questions = Vec::new();
            for (index, question) in args.questions.into_iter().enumerate() {
                if question.multi_select {
                    return Err(invalid(
                        "multiSelect is not supported by the native question UI",
                    ));
                }
                if question.question.trim().is_empty()
                    || question.header.trim().is_empty()
                    || !(2..=3).contains(&question.options.len())
                    || question
                        .options
                        .iter()
                        .any(|o| o.label.trim().is_empty() || o.description.trim().is_empty())
                {
                    return Err(invalid(
                        "questions require a question, header and two or three nonempty options",
                    ));
                }
                if native_name == "request_user_input_async" {
                    questions.push(json!({"title":format!("{}\n{}",question.header,question.question),"options":question.options.into_iter().map(|o|format!("{} — {}",o.label,o.description)).collect::<Vec<_>>()}));
                } else {
                    questions.push(json!({"id":format!("question_{}",index + 1),"header":question.header,"question":question.question,"options":question.options.into_iter().map(|o|json!({"label":o.label,"description":o.description})).collect::<Vec<_>>()}));
                }
            }
            function(json!({"questions":questions}))
        }
    })
}

impl ToolExecutor<ToolInvocation> for ClaudeControlHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain(self.kind.name())
    }
    fn exposure(&self) -> ToolExposure {
        self.backend.exposure()
    }
    fn supports_parallel_tool_calls(&self) -> bool {
        self.kind != ClaudeControlKind::Agent && self.backend.supports_parallel_tool_calls()
    }
    fn spec(&self) -> ToolSpec {
        let (mut description, mut properties, required) = match self.kind {
            ClaudeControlKind::Agent => (
                "Run a native Azrael agent with its configured role and permissions. Wait for its result by default; run_in_background returns its task handle. Use current role names and full native model identifiers.",
                json!({"prompt":{"type":"string"},"description":{"type":"string"},"subagent_type":{"type":"string"},"model":{"type":"string"},"run_in_background":{"type":"boolean"}}),
                vec!["prompt", "description", "subagent_type"],
            ),
            ClaudeControlKind::Skill => (
                "Load the actual SKILL.md into the conversation. Pass an enabled skill name from the current host catalog or the package/alias provided by skills.list; args are task context for applying the loaded instructions. Follow next_cursor using native skills.read if an environment-owned body is paginated.",
                json!({"skill":{"type":"string"},"args":{"type":"string"}}),
                vec!["skill"],
            ),
            ClaudeControlKind::ToolSearch => (
                "Search the current native registry and discover available tools, respecting this request's tool policy.",
                json!({"query":{"type":"string"},"max_results":{"type":"integer","minimum":1}}),
                vec!["query"],
            ),
            ClaudeControlKind::AskUserQuestion => (
                "Present one to three questions using the native user-input runtime. multiSelect is unsupported. In asynchronous mode the result confirms delivery only: wait for the user's response before dependent actions.",
                json!({"questions":{"type":"array","minItems":1,"maxItems":3,"items":{"type":"object","additionalProperties":false,"required":["question","header","options"],"properties":{"question":{"type":"string"},"header":{"type":"string"},"multiSelect":{"type":"boolean"},"options":{"type":"array","minItems":2,"maxItems":3,"items":{"type":"object","additionalProperties":false,"required":["label","description"],"properties":{"label":{"type":"string"},"description":{"type":"string"}}}}}}}}),
                vec!["questions"],
            ),
        };
        if self.kind == ClaudeControlKind::Agent && !self.native_model_overrides_exposed() {
            properties
                .as_object_mut()
                .expect("trusted Agent properties")
                .remove("model");
            description = "Run a native Azrael agent with its configured role and permissions. Wait for its result by default; run_in_background returns its task handle. Use current role names. The child inherits the configured model; model overrides are unavailable.";
        }
        let mut description = description.to_string();
        if self.kind == ClaudeControlKind::Agent && !self.native_parameter_exposed("agent_type") {
            properties["subagent_type"] = json!({"type":"string","enum":["default"],"description":"Use default; the native runtime selects its configured role. Role overrides are unavailable."});
            description.push_str(" Set subagent_type to default; the native runtime selects its configured role and role overrides are unavailable.");
        }
        let parameters: JsonSchema = serde_json::from_value(json!({"type":"object","additionalProperties":false,"properties":properties,"required":required})).expect("trusted compatible schema");
        ToolSpec::Function(ResponsesApiTool {
            name: self.kind.name().into(),
            description,
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
            if let Some(output) = self.try_host_skill(&invocation).await? {
                return Ok(output);
            }
            let translated = self.translate(&invocation)?;
            let backend = self.backend_for(&invocation);
            let native_payload = translated.payload.clone();
            let output = backend.handle(translated).await?;
            let mut note = None;
            let mut replacement = None;
            if let ToolPayload::Function { arguments } = &invocation.payload {
                if self.kind == ClaudeControlKind::Skill {
                    let args: SkillArgs = decode(
                        serde_json::from_str(arguments).map_err(|e| invalid(e.to_string()))?,
                    )?;
                    note = args
                        .args
                        .filter(|a| !a.is_empty())
                        .map(|a| format!("\nSkill invocation arguments (task context): {a}"));
                }
                if self.kind == ClaudeControlKind::Agent {
                    let args: AgentArgs = decode(
                        serde_json::from_str(arguments).map_err(|e| invalid(e.to_string()))?,
                    )?;
                    if !args.run_in_background.unwrap_or(false) && output.success_for_logging() {
                        let target = task_name(&args.description, &invocation.call_id);
                        let control = &invocation.session.services.agent_control;
                        let id = control
                            .resolve(
                                invocation.session.thread_id,
                                invocation.turn.parent_thread_id,
                                &invocation.turn.session_source,
                                &target,
                            )
                            .await
                            .map_err(|e| invalid(e.to_string()))?;
                        let task = control
                            .root_resume_agent_task(id)
                            .await
                            .map_err(|e| invalid(e.to_string()))?;
                        tokio::select! {
                            _ = invocation.cancellation_token.cancelled() => return Err(invalid("Agent wait cancelled; the spawned agent may still be running")),
                            _ = control.wait_root_resume_agent_task(&task) => {},
                        }
                        let info = control
                            .inspect(invocation.session.thread_id, AgentTarget::Id(id))
                            .await
                            .map_err(|e| invalid(e.to_string()))?;
                        if !info.status().is_some_and(crate::agent::status::is_final) {
                            return Err(invalid(
                                "The captured Agent task finished, but its final result is unavailable or a later task has started; inspect the native agent's status and messages",
                            ));
                        }
                        replacement = Some(json!({"task_name":target,"status":info.status()}));
                    }
                }
            }
            if self.kind == ClaudeControlKind::AskUserQuestion
                && backend.tool_name().name == "request_user_input_async"
            {
                note = Some("\nQuestion delivered; response pending. Wait for the user before dependent actions.".into());
            }
            Ok(Box::new(CompatibleOutput {
                original: output,
                native_payload,
                note,
                replacement,
            }) as Box<dyn ToolOutput>)
        })
    }
}

impl CoreToolRuntime for ClaudeControlHandler {
    fn is_builtin_control_tool(&self) -> bool {
        self.backend.is_builtin_control_tool()
    }
    fn wait_until_ready<'a>(&'a self, session: &'a Arc<Session>) -> Option<BoxFuture<'a, ()>> {
        self.backend.wait_until_ready(session)
    }
    fn is_third_party_tool(&self) -> bool {
        self.backend.is_third_party_tool()
    }
    fn mcp_server_name(&self) -> Option<&str> {
        self.backend.mcp_server_name()
    }
    fn matches_kind(&self, payload: &ToolPayload) -> bool {
        matches!(payload, ToolPayload::Function { .. })
    }
    fn telemetry_tags(&self, invocation: &ToolInvocation) -> ToolTelemetryTags {
        self.translate(invocation)
            .ok()
            .map(|i| self.backend_for(invocation).telemetry_tags(&i))
            .unwrap_or_default()
    }
    fn on_tool_result_accepted(&self, invocation: &ToolInvocation, result: &dyn ToolOutput) {
        if let Ok(i) = self.translate(invocation) {
            self.backend_for(invocation)
                .on_tool_result_accepted(&i, result);
        }
    }
    fn pre_tool_use_payload(&self, invocation: &ToolInvocation) -> Option<PreToolUsePayload> {
        let ToolPayload::Function { arguments } = &invocation.payload else {
            return None;
        };
        Some(PreToolUsePayload {
            tool_name: HookToolName::new(self.kind.name()),
            tool_input: serde_json::from_str(arguments).unwrap_or(Value::String(arguments.clone())),
        })
    }
    fn post_tool_use_payload(
        &self,
        invocation: &ToolInvocation,
        result: &dyn ToolOutput,
    ) -> Option<PostToolUsePayload> {
        let translated = self.translate(invocation).ok()?;
        let mut payload = self
            .backend_for(invocation)
            .post_tool_use_payload(&translated, result)?;
        payload.tool_name = HookToolName::new(self.kind.name());
        payload.tool_input = self.pre_tool_use_payload(invocation)?.tool_input;
        Some(payload)
    }
}

/// Preserve native host metadata and hook output while adapting the wire result.
struct CompatibleOutput {
    original: Box<dyn ToolOutput>,
    native_payload: ToolPayload,
    note: Option<String>,
    replacement: Option<Value>,
}
impl ToolOutput for CompatibleOutput {
    fn log_output(&self) -> String {
        self.original.log_output()
    }
    fn success_for_logging(&self) -> bool {
        self.original.success_for_logging()
    }
    fn set_handler_duration_ms(&mut self, ms: u64) {
        self.original.set_handler_duration_ms(ms);
    }
    fn contains_external_context(&self) -> bool {
        self.original.contains_external_context()
    }
    fn fallback_token_limit_override(&self) -> Option<usize> {
        self.original.fallback_token_limit_override()
    }
    fn tool_result_metadata(&self) -> Option<&Value> {
        self.original.tool_result_metadata()
    }
    fn post_tool_use_id(&self, id: &str) -> String {
        self.original.post_tool_use_id(id)
    }
    fn post_tool_use_input(&self, _: &ToolPayload) -> Option<Value> {
        self.original.post_tool_use_input(&self.native_payload)
    }
    fn post_tool_use_response(&self, id: &str, _: &ToolPayload) -> Option<Value> {
        self.original
            .post_tool_use_response(id, &self.native_payload)
    }
    fn to_response_item(&self, id: &str, _: &ToolPayload) -> ResponseInputItem {
        let mut item = self.original.to_response_item(id, &self.native_payload);
        // Retain the host-created typed search envelope for authoritative
        // current-registry discovery. The provider pairs it with this call ID.
        if let ResponseInputItem::FunctionCallOutput { output, .. } = &mut item {
            if let Some(replacement) = &self.replacement {
                output.body = FunctionCallOutputBody::Text(replacement.to_string());
            }
            if let Some(note) = &self.note {
                match &mut output.body {
                    FunctionCallOutputBody::Text(text) => text.push_str(note),
                    FunctionCallOutputBody::ContentItems(items) => {
                        items.push(FunctionCallOutputContentItem::InputText { text: note.clone() })
                    }
                }
            }
        }
        item
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compatible_agent_fixed_role_uses_native_default_without_role_override() {
        use crate::tools::handlers::multi_agents_spec::SpawnAgentToolOptions;
        for exposed in [false, true] {
            let backend = crate::tools::handlers::multi_agents_v2::SpawnAgentHandler::new(
                SpawnAgentToolOptions {
                    expose_agent_type: exposed,
                    multi_agent_version: codex_protocol::protocol::MultiAgentVersion::V2,
                    ..Default::default()
                },
                None,
            );
            let compatible = ClaudeControlHandler::new(ClaudeControlKind::Agent, Arc::new(backend));
            let ToolSpec::Function(spec) = compatible.spec() else {
                panic!()
            };
            let roles = &spec.parameters.properties.unwrap()["subagent_type"];
            let expected_roles = [json!("default")];
            assert_eq!(
                roles.enum_values.as_deref(),
                if exposed {
                    None
                } else {
                    Some(expected_roles.as_slice())
                }
            );
            let args = json!({"prompt":"inspect","description":"review","subagent_type":"default"});
            let ToolPayload::Function { arguments } = compatible
                .translate_value(args, "call", "spawn_agent")
                .unwrap()
            else {
                panic!()
            };
            let native: Value = serde_json::from_str(&arguments).unwrap();
            assert_eq!(native.get("agent_type").is_some(), exposed);
            let override_args =
                json!({"prompt":"inspect","description":"review","subagent_type":"explorer"});
            assert_eq!(
                compatible
                    .translate_value(override_args, "call", "spawn_agent")
                    .is_ok(),
                exposed
            );
        }
    }
    #[test]
    fn compatible_agent_model_capability_matches_actual_native_spawn_schema() {
        use crate::tools::handlers::multi_agents_spec::SpawnAgentToolOptions;
        for exposed in [false, true] {
            let backend = crate::tools::handlers::multi_agents_v2::SpawnAgentHandler::new(
                SpawnAgentToolOptions {
                    expose_spawn_agent_model_overrides: exposed,
                    multi_agent_version: codex_protocol::protocol::MultiAgentVersion::V2,
                    ..Default::default()
                },
                None,
            );
            let compatible = ClaudeControlHandler::new(ClaudeControlKind::Agent, Arc::new(backend));
            let ToolSpec::Function(spec) = compatible.spec() else {
                panic!()
            };
            assert_eq!(
                spec.parameters.properties.unwrap().contains_key("model"),
                exposed
            );
            assert_eq!(
                compatible
                    .validate_native_capabilities(
                        &json!({"model":"managed/anthropic/claude-opus-5-5"})
                    )
                    .is_ok(),
                exposed
            );
            assert!(
                compatible
                    .validate_native_capabilities(&json!({"prompt":"inherit"}))
                    .is_ok()
            );
        }
    }
    fn invocation(
        session: Arc<Session>,
        turn: Arc<crate::session::turn_context::TurnContext>,
        name: &str,
        arguments: Value,
    ) -> ToolInvocation {
        ToolInvocation {
            session,
            step_context: crate::session::step_context::StepContext::for_test(Arc::clone(&turn)),
            turn,
            cancellation_token: tokio_util::sync::CancellationToken::new(),
            tracker: Arc::new(tokio::sync::Mutex::new(
                crate::turn_diff_tracker::TurnDiffTracker::default(),
            )),
            call_id: "compatible-call".into(),
            tool_name: ToolName::plain(name),
            source: crate::tools::context::ToolCallSource::Direct,
            payload: function(arguments),
        }
    }
    #[tokio::test]
    async fn host_skill_loads_actual_catalog_file_with_native_renderer_and_arguments() {
        let (session, turn, _) = crate::session::tests::make_session_and_context_with_rx().await;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("SKILL.md");
        tokio::fs::write(&path, "---\nname: local-fixture\ndescription: test\n---\nActual instructions from the catalog file.\n").await.unwrap();
        let skill = codex_skills::SkillMetadata {
            name: "local-fixture".into(),
            description: "test".into(),
            short_description: None,
            interface: None,
            dependencies: None,
            policy: None,
            path_to_skills_md: codex_utils_path_uri::PathUri::from_abs_path(
                &codex_utils_absolute_path::AbsolutePathBuf::from_absolute_path(path).unwrap(),
            ),
            scope: codex_protocol::protocol::SkillScope::User,
            plugin_id: None,
            remote_plugin_id: None,
        };
        let mut catalog = codex_skills_extension::SkillLoadOutcome::default();
        catalog.skills = vec![skill.clone()];
        turn.extension_data
            .insert(codex_skills_extension::HostSkillsSnapshot::new(Arc::new(
                catalog,
            )));
        let handler = ClaudeControlHandler::new(ClaudeControlKind::Skill, Arc::new(NativeRuntime));
        let call = invocation(
            Arc::clone(&session),
            Arc::clone(&turn),
            "Skill",
            json!({"skill":"local-fixture","args":"apply to this task"}),
        );
        let result = handler.handle(call.clone()).await.unwrap();
        let ResponseInputItem::FunctionCallOutput { output, .. } =
            result.to_response_item(&call.call_id, &call.payload)
        else {
            panic!()
        };
        let text = output.body.to_text().unwrap();
        assert!(text.contains("Actual instructions from the catalog file."));
        assert!(text.contains("apply to this task"));
        assert!(text.contains("<skill"));

        let mut disabled = codex_skills_extension::SkillLoadOutcome::default();
        disabled.skills = vec![skill.clone()];
        disabled.disabled_paths.insert(skill.path_to_skills_md);
        turn.extension_data
            .insert(codex_skills_extension::HostSkillsSnapshot::new(Arc::new(
                disabled,
            )));
        assert!(handler.handle(call).await.is_err());
        let arbitrary = invocation(
            session,
            turn,
            "Skill",
            json!({"skill":directory.path().join("SKILL.md").to_string_lossy()}),
        );
        assert!(handler.handle(arbitrary).await.is_err());
    }
    #[tokio::test]
    async fn compatible_question_waits_for_actual_native_answer_in_default_mode() {
        use codex_protocol::request_user_input::{
            RequestUserInputAnswer, RequestUserInputResponse,
        };
        let (session, turn, events) =
            crate::session::tests::make_session_and_context_with_rx().await;
        *session.active_turn.lock().await = Some(crate::state::ActiveTurn::default());
        let handler = ClaudeControlHandler::ask_user_question(
            Some(Arc::new(crate::tools::handlers::RequestUserInputHandler {
                available_modes: vec![
                    codex_protocol::config_types::ModeKind::Default,
                    codex_protocol::config_types::ModeKind::Plan,
                ],
            })),
            None,
        )
        .unwrap();
        let call = invocation(
            Arc::clone(&session),
            Arc::clone(&turn),
            "AskUserQuestion",
            json!({"questions":[{
                "question":"Choose a direction","header":"Choice","options":[{"label":"A","description":"first"},{"label":"B","description":"second"}],"multiSelect":false
            }]}),
        );
        let payload = call.payload.clone();
        let request = tokio::spawn(async move { handler.handle(call).await });
        let event = tokio::time::timeout(std::time::Duration::from_secs(10), events.recv())
            .await
            .unwrap()
            .unwrap();
        let codex_protocol::protocol::EventMsg::RequestUserInput(question) = event.msg else {
            panic!("expected native question event")
        };
        assert_eq!(question.call_id, "compatible-call");
        assert_eq!(question.questions[0].id, "question_1");
        assert!(
            !request.is_finished(),
            "delivery must not be treated as an answer"
        );
        session
            .notify_user_input_response(
                &question.turn_id,
                RequestUserInputResponse {
                    answers: std::collections::HashMap::from([(
                        "question_1".into(),
                        RequestUserInputAnswer {
                            answers: vec!["A".into()],
                        },
                    )]),
                },
            )
            .await;
        let result = tokio::time::timeout(std::time::Duration::from_secs(10), request)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let ResponseInputItem::FunctionCallOutput { output, .. } =
            result.to_response_item("compatible-call", &payload)
        else {
            panic!()
        };
        let text = output.body.to_text().unwrap();
        assert!(text.contains("question_1"));
        assert!(text.contains("A"));
        assert!(!text.contains("pending"));
    }
    #[test]
    fn compatible_search_preserves_authoritative_native_discovery_envelope() {
        let output = CompatibleOutput {
            original: Box::new(crate::tools::context::ToolSearchOutput { tools: Vec::new() }),
            native_payload: ToolPayload::ToolSearch {
                arguments: SearchToolCallParams {
                    query: "native".into(),
                    limit: Some(2),
                },
            },
            note: None,
            replacement: None,
        };
        assert!(
            matches!(output.to_response_item("search", &function(json!({"query":"native"}))), ResponseInputItem::ToolSearchOutput { call_id, status, execution, tools } if call_id == "search" && status == "completed" && execution == "client" && tools.is_empty())
        );
    }
    struct NativeRuntime;
    impl ToolExecutor<ToolInvocation> for NativeRuntime {
        fn tool_name(&self) -> ToolName {
            ToolName::namespaced("skills", "read")
        }
        fn spec(&self) -> ToolSpec {
            ToolSpec::Function(ResponsesApiTool {
                name: "read".into(),
                description: "native".into(),
                strict: false,
                defer_loading: None,
                parameters: serde_json::from_value(json!({"type":"object"})).unwrap(),
                output_schema: None,
            })
        }
        fn exposure(&self) -> ToolExposure {
            ToolExposure::Deferred
        }
        fn supports_parallel_tool_calls(&self) -> bool {
            true
        }
        fn handle<'a>(&'a self, _: ToolInvocation) -> codex_tools::ToolExecutorFuture<'a>
        where
            ToolInvocation: 'a,
        {
            Box::pin(async { Err(invalid("test backend")) })
        }
    }
    impl CoreToolRuntime for NativeRuntime {
        fn is_builtin_control_tool(&self) -> bool {
            true
        }
        fn is_third_party_tool(&self) -> bool {
            true
        }
        fn mcp_server_name(&self) -> Option<&str> {
            Some("native_server")
        }
    }
    #[test]
    fn replacement_identity_schema_and_native_runtime_metadata_remain_tied() {
        let handler = ClaudeControlHandler::new(ClaudeControlKind::Skill, Arc::new(NativeRuntime));
        assert_eq!(handler.tool_name(), ToolName::plain("Skill"));
        assert_eq!(handler.spec().name(), "Skill");
        assert!(handler.exposure().is_deferred());
        assert!(handler.supports_parallel_tool_calls());
        assert!(handler.is_builtin_control_tool());
        assert!(handler.is_third_party_tool());
        assert_eq!(handler.mcp_server_name(), Some("native_server"));
        assert!(handler.immutable_spec().is_none());
        assert!(ClaudeControlHandler::ask_user_question(None, None).is_none());
    }
    #[test]
    fn agent_preserves_native_role_model_and_fresh_context() {
        let value = json!({"prompt":"inspect","description":"Review code","subagent_type":"explorer","model":"managed/anthropic/claude-opus-5-5","run_in_background":false});
        let ToolPayload::Function { arguments } =
            translate_arguments(ClaudeControlKind::Agent, value, "call-1", "spawn_agent").unwrap()
        else {
            panic!()
        };
        let native: Value = serde_json::from_str(&arguments).unwrap();
        assert_eq!(native["agent_type"], "explorer");
        assert_eq!(native["fork_turns"], "none");
        assert_eq!(native["model"], "managed/anthropic/claude-opus-5-5");
        assert_eq!(native["task_name"], "review_code_call_1");
    }
    #[test]
    fn unsupported_options_and_aliases_fail_before_execution() {
        for value in [json!({"skill":"pkg","command":"run"}), json!({"skill":""})] {
            assert!(translate_arguments(ClaudeControlKind::Skill, value, "id", "read").is_err());
        }
        assert!(
            translate_arguments(
                ClaudeControlKind::Agent,
                json!({"prompt":"p","description":"d","subagent_type":"default","model":"opus"}),
                "id",
                "spawn_agent"
            )
            .is_err()
        );
    }
    #[test]
    fn skill_loads_native_package_and_search_uses_search_payload() {
        assert_eq!(
            translate_arguments(
                ClaudeControlKind::Skill,
                json!({"skill":"r0/example","args":"task"}),
                "id",
                "read"
            )
            .unwrap(),
            function(json!({"package":"r0/example"}))
        );
        assert_eq!(
            translate_arguments(
                ClaudeControlKind::ToolSearch,
                json!({"query":"drive","max_results":2}),
                "id",
                "tool_search"
            )
            .unwrap(),
            ToolPayload::ToolSearch {
                arguments: SearchToolCallParams {
                    query: "drive".into(),
                    limit: Some(2)
                }
            }
        );
    }
    #[test]
    fn question_translation_keeps_choices_and_refuses_multi_select() {
        let mut value = json!({"questions":[{"question":"Choose?","header":"Choice","options":[{"label":"A","description":"first"},{"label":"B","description":"second"}],"multiSelect":false}]});
        let ToolPayload::Function { arguments } = translate_arguments(
            ClaudeControlKind::AskUserQuestion,
            value.clone(),
            "id",
            "request_user_input",
        )
        .unwrap() else {
            panic!()
        };
        let native: Value = serde_json::from_str(&arguments).unwrap();
        assert_eq!(native["questions"][0]["id"], "question_1");
        assert_eq!(native["questions"][0]["options"][0]["description"], "first");
        let ToolPayload::Function { arguments } = translate_arguments(
            ClaudeControlKind::AskUserQuestion,
            value.clone(),
            "id",
            "request_user_input_async",
        )
        .unwrap() else {
            panic!()
        };
        assert!(arguments.contains("first"));
        value["questions"][0]["multiSelect"] = true.into();
        assert!(
            translate_arguments(
                ClaudeControlKind::AskUserQuestion,
                value,
                "id",
                "request_user_input"
            )
            .is_err()
        );
    }
    #[test]
    fn output_retains_external_context_and_pending_is_not_an_answer() {
        let native = function(json!({}));
        let output = CompatibleOutput {
            original: Box::new(
                codex_tools::JsonToolOutput::new(json!({"accepted":true})).with_external_context(),
            ),
            native_payload: native.clone(),
            note: Some("\nresponse pending".into()),
            replacement: None,
        };
        assert!(output.contains_external_context());
        let ResponseInputItem::FunctionCallOutput { output, .. } =
            output.to_response_item("call", &native)
        else {
            panic!()
        };
        let FunctionCallOutputBody::Text(text) = output.body else {
            panic!()
        };
        assert!(text.contains("pending"));
        assert!(!text.contains("answers"));
    }
}
