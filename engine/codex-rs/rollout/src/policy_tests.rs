use super::*;
use codex_protocol::ThreadId;
use codex_protocol::items::DynamicToolCallItem;
use codex_protocol::items::DynamicToolCallStatus;
use codex_protocol::protocol::ItemCompletedEvent;
use pretty_assertions::assert_eq;

#[test]
fn provider_tool_observations_survive_legacy_without_changing_native_retention() {
    for (namespace, legacy_expected) in
        [(Some("devin"), true), (Some("other"), false), (None, false)]
    {
        let event = EventMsg::ItemCompleted(ItemCompletedEvent {
            thread_id: ThreadId::default(),
            turn_id: "turn".to_string(),
            item: TurnItem::DynamicToolCall(DynamicToolCallItem {
                id: "devin:turn:exec:0".to_string(),
                namespace: namespace.map(str::to_string),
                tool: "Ran ls".to_string(),
                arguments: serde_json::json!({"kind":"execute"}),
                status: DynamicToolCallStatus::Failed,
                content_items: None,
                success: Some(false),
                error: Some("policy_denied".to_string()),
                duration: None,
            }),
            started_at_ms: Some(0),
            completed_at_ms: 1,
        });
        assert_eq!(
            [
                should_persist_event_msg(&event, ThreadHistoryMode::Legacy),
                should_persist_event_msg(&event, ThreadHistoryMode::Paginated)
            ],
            [legacy_expected, true],
        );
    }
}
