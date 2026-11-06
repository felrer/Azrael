//! Implements the MultiAgentV2 collaboration tool surface.

use crate::agent::AgentStatus;
use crate::agent::agent_resolver::resolve_agent_target;
use crate::agent::types::AgentMessage;
use crate::function_tool::FunctionCallError;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolOutput;
use crate::tools::context::ToolPayload;
use crate::tools::context::boxed_tool_output;
use crate::tools::handlers::multi_agents_common::*;
use crate::tools::handlers::parse_arguments;
use crate::tools::registry::CoreToolRuntime;
use crate::tools::registry::ToolExecutor;
use codex_protocol::items::CollabAgentTool;
use codex_protocol::items::CollabAgentToolCallItem;
use codex_protocol::items::CollabAgentToolCallStatus;
use codex_protocol::items::SubAgentActivityItem;
use codex_protocol::items::TurnItem;
use codex_protocol::models::ResponseInputItem;
use codex_protocol::openai_models::ReasoningEffort;
use codex_protocol::protocol::ImageAttachment;
use codex_protocol::protocol::SubAgentActivityKind;
use codex_tools::ToolName;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value as JsonValue;

pub(crate) use followup_task::Handler as FollowupTaskHandler;
pub(crate) use interrupt_agent::Handler as InterruptAgentHandler;
pub(crate) use list_agents::Handler as ListAgentsHandler;
pub(crate) use send_message::Handler as SendMessageHandler;
pub(crate) use spawn::Handler as SpawnAgentHandler;
pub(crate) use wait::Handler as WaitAgentHandler;

mod analytics;
mod followup_task;
mod interrupt_agent;
mod list_agents;
mod message_tool;
mod send_message;
mod spawn;
pub(crate) mod wait;

pub(crate) async fn emit_sub_agent_activity(
    session: &crate::session::session::Session,
    turn: &crate::session::turn_context::TurnContext,
    item: SubAgentActivityItem,
) {
    let item = TurnItem::SubAgentActivity(item);
    session.emit_turn_item_started(turn, &item).await;
    session.emit_turn_item_completed(turn, item).await;
}

fn agent_message_from_tool(
    message: String,
    source: &crate::tools::context::ToolCallSource,
) -> AgentMessage {
    if matches!(
        source,
        crate::tools::context::ToolCallSource::DirectPlaintextMessage
    ) {
        AgentMessage::Plaintext(message)
    } else {
        AgentMessage::Encrypted(message)
    }
}

fn agent_message_with_attachments(
    message: String,
    source: &crate::tools::context::ToolCallSource,
    attachments: Vec<ImageAttachment>,
) -> AgentMessage {
    let message = agent_message_from_tool(message, source);
    if attachments.is_empty() {
        message
    } else {
        AgentMessage::WithAttachments {
            message: Box::new(message),
            attachments,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct AttachmentReceipt {
    attachment_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    registration_warning: Option<String>,
}

async fn attachment_receipt(
    session: &std::sync::Arc<crate::session::session::Session>,
    attachments: &[ImageAttachment],
) -> Option<AttachmentReceipt> {
    if attachments.is_empty() {
        return None;
    }
    let registration_warning = crate::image_attachments::commit_attachments(session, attachments)
        .await.err().map(|err| format!(
            "Delivery was accepted; do not resend. Sender attachment ID registration failed: {err}"
        ));
    Some(AttachmentReceipt {
        attachment_ids: attachments
            .iter()
            .map(|image| image.attachment_id.clone())
            .collect(),
        registration_warning,
    })
}

fn validate_message_recipient(
    model: &str,
    source: &crate::tools::context::ToolCallSource,
) -> Result<(), FunctionCallError> {
    if crate::devin::catalog::is_devin(model)
        && !matches!(
            source,
            crate::tools::context::ToolCallSource::DirectPlaintextMessage
        )
    {
        return Err(FunctionCallError::RespondToModel(
            "Devin requires a plaintext task through azrael_agents; encrypted native task content cannot be transferred.".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "multi_agents_v2_tests.rs"]
mod tests;
