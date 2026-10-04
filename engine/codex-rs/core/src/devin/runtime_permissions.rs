use super::cancel;
use super::fatal;
use super::tool_observations::bounded_redacted;
use crate::exec_policy::ExecApprovalRequest;
use crate::sandboxing::SandboxPermissions;
use crate::session::session::Session;
use crate::session::turn_context::TurnContext;
use crate::shell::Shell;
use crate::shell::ShellType;
use crate::tools::sandboxing::ExecApprovalRequirement;
use codex_devin::AcpClient;
use codex_devin::ServerRequest;
use codex_protocol::approvals::ExecApprovalKind;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::Result as CodexResult;
use codex_protocol::items::ModelInvocationContext;
use codex_protocol::models::PermissionProfile;
use codex_protocol::protocol::AskForApproval;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::ReviewDecision;
use codex_protocol::protocol::WarningEvent;
use codex_shell_command::is_dangerous_command::DangerousCommandPlatform;
use codex_shell_command::powershell::parse_powershell_script_into_plain_commands;
use codex_tools::UnifiedExecShellMode;
use serde_json::Value;
use serde_json::json;
use std::time::Instant;
use tokio_util::sync::CancellationToken;

const MAX_COMMAND_BYTES: usize = 40 * 1024;

pub(super) async fn handle_request(
    client: &AcpClient,
    sess: &Session,
    ctx: &TurnContext,
    session_id: &str,
    request: ServerRequest,
    permission_params: Result<Value, &'static str>,
    cancellation: &CancellationToken,
    dropped: &CancellationToken,
) -> CodexResult<()> {
    let started = Instant::now();
    let call_id = request
        .params
        .pointer("/toolCall/toolCallId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= 256)
        .unwrap_or("unknown");
    tracing::info!(event = "devin_permission_requested", session_id, turn_id = %ctx.sub_id, tool_call_id = call_id);
    let decision = async {
        if cancellation.is_cancelled() || dropped.is_cancelled() {
            return Err("request_cancelled");
        }
        if request.method != "session/request_permission" {
            return Err("unsupported_method");
        }
        if call_id == "unknown" {
            return Err("invalid_tool_call_id");
        }
        if request.params.get("sessionId").and_then(Value::as_str) != Some(session_id) {
            return Err("session_mismatch");
        }
        if !matches!(ctx.permission_profile(), PermissionProfile::Disabled) {
            return Err("unsupported_restricted_profile");
        }
        let params = permission_params.as_ref().map_err(|reason| *reason)?;
        let option_id = allow_once_option(params).ok_or("missing_or_ambiguous_allow_once")?;
        // Full access with no approval UI delegates tool execution to Devin.
        // Command classification belongs only to the interactive policy path;
        // CLI shell/cwd choices are not additional restrictions in this mode.
        if ctx.approval_policy() == AskForApproval::Never {
            return Ok((option_id, "full_access_never"));
        }
        let command = permission_command(params)?;
        let environment = ctx.initial_environments.primary().ok_or("missing_environment")?;
        // The observed request explicitly selects PowerShell. Reject syntax outside
        // the native literal parser; never treat an opaque script as an executable.
        let shell = Shell { shell_type: ShellType::PowerShell, shell_path: "powershell.exe".into() };
        let argv = shell.derive_exec_args(command, /*use_login_shell*/ false);
        let requirement = sess.services.exec_policy.create_exec_approval_requirement_for_shell(
            ExecApprovalRequest {
                command: &argv,
                approval_policy: ctx.approval_policy(),
                permission_profile: ctx.permission_profile(),
                environment_policy: environment.config().exec_policy.as_ref(),
                windows_sandbox_level: environment.config().windows_sandbox_level,
                sandbox_permissions: SandboxPermissions::UseDefault,
                prefix_rule: None,
                allow_prefix_rules: ctx.allow_prefix_rules(),
            },
            &shell,
            &UnifiedExecShellMode::Direct,
            DangerousCommandPlatform::Windows,
        ).await;
        match automatic_requirement_decision(&requirement) {
            Some(Ok(reason)) => Ok((option_id, reason)),
            Some(Err(reason)) => Err(reason),
            None => {
                tracing::info!(event = "devin_permission_waiting", session_id, turn_id = %ctx.sub_id, tool_call_id = call_id);
                let approval = sess.request_command_approval(
                    ctx, ExecApprovalKind::Command,
                    ModelInvocationContext {
                        model_slug: ctx.model_info().slug.clone(),
                        reasoning_effort: ctx.effective_reasoning_effort().map(|effort| effort.to_string()),
                    },
                    call_id.to_string(), None, None,
                    vec![bounded_redacted(command, 4096)], environment.cwd().clone(),
                    Some("Devin requests one-time command permission".to_string()),
                    None, None, None, Some(vec![ReviewDecision::Approved, ReviewDecision::Abort]), None,
                );
                tokio::pin!(approval);
                tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => Err("request_cancelled"),
                    _ = dropped.cancelled() => Err("approval_disconnected"),
                    decision = &mut approval => {
                        if decision == ReviewDecision::Approved { Ok((option_id, "user_approved")) }
                        else { Err("user_denied_or_disconnected") }
                    }
                }
            }
        }
    }.await;
    // A cancellation observed before dispatch must never become a grant.
    let decision = if cancellation.is_cancelled() || dropped.is_cancelled() {
        Err("request_cancelled")
    } else {
        decision
    };
    let (outcome, reason) = match decision {
        Ok((option_id, reason)) => (json!({"outcome":"selected","optionId":option_id}), reason),
        Err(reason) => {
            sess.send_event(ctx, EventMsg::Warning(WarningEvent {
                message: format!("Devin tool permission denied ({reason}). No execution was approved by Azrael."),
            })).await;
            (json!({"outcome":"cancelled"}), reason)
        }
    };
    let response = client.respond(request.id, json!({"outcome":outcome}));
    tokio::pin!(response);
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => {
            cancel(client, session_id).await;
            return Err(CodexErr::new(CodexErrorDetails::Interrupted));
        }
        _ = dropped.cancelled() => {
            cancel(client, session_id).await;
            return Err(CodexErr::new(CodexErrorDetails::Interrupted));
        }
        result = &mut response => {
            if result.is_err() {
                cancel(client, session_id).await;
                return Err(fatal("failed to answer Devin permission request"));
            }
        }
    }
    // Once a grant has reached the external process it cannot be retracted;
    // subsequent cancellation requests stop that prompt rather than undo tools.
    tracing::info!(event = "devin_permission_decided", session_id, turn_id = %ctx.sub_id,
        tool_call_id = call_id, reason, elapsed_ms = started.elapsed().as_millis() as u64);
    if cancellation.is_cancelled() || dropped.is_cancelled() {
        cancel(client, session_id).await;
        return Err(CodexErr::new(CodexErrorDetails::Interrupted));
    }
    Ok(())
}

fn automatic_requirement_decision(
    requirement: &ExecApprovalRequirement,
) -> Option<Result<&'static str, &'static str>> {
    match requirement {
        ExecApprovalRequirement::Skip { .. } => Some(Ok("policy_allowed")),
        ExecApprovalRequirement::Forbidden { .. } => Some(Err("exec_policy_denied")),
        ExecApprovalRequirement::NeedsApproval { .. } => None,
    }
}

fn permission_command(params: &Value) -> Result<&str, &'static str> {
    if params.get("scope").is_some() || params.pointer("/toolCall/scope").is_some() {
        return Err("unsupported_execution_scope");
    }
    if params.pointer("/toolCall/kind").and_then(Value::as_str) != Some("execute") {
        return Err("unsupported_tool_kind");
    }
    let input = params
        .pointer("/toolCall/rawInput")
        .and_then(Value::as_object)
        .ok_or("invalid_tool_input")?;
    if input.get("shell_flavor").and_then(Value::as_str) != Some("powershell") {
        return Err("unsupported_shell_flavor");
    }
    if ["cwd", "workdir", "workingDirectory", "shell", "executable"]
        .iter()
        .any(|key| input.contains_key(*key))
    {
        return Err("unsupported_execution_override");
    }
    let command = input
        .get("command")
        .and_then(Value::as_str)
        .ok_or("missing_command")?;
    if command.is_empty() || command.len() > MAX_COMMAND_BYTES {
        return Err("command_size_limit");
    }
    if parse_powershell_script_into_plain_commands(command)
        .is_none_or(|commands| commands.is_empty())
    {
        return Err("unsupported_powershell_syntax");
    }
    Ok(command)
}

fn allow_once_option(params: &Value) -> Option<&str> {
    let options = params.get("options")?.as_array()?;
    let mut once = options
        .iter()
        .filter(|option| option.get("kind").and_then(Value::as_str) == Some("allow_once"));
    let selected = once.next()?;
    if once.next().is_some() {
        return None;
    }
    let id = selected.get("optionId")?.as_str()?;
    if id.is_empty()
        || id.len() > 256
        || options
            .iter()
            .filter(|option| option.get("optionId").and_then(Value::as_str) == Some(id))
            .count()
            != 1
    {
        return None;
    }
    Some(id)
}

#[cfg(test)]
#[path = "runtime_permissions_tests.rs"]
mod tests;
