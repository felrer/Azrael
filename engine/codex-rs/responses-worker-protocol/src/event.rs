use crate::WireError;
use codex_api::ResponseEvent;
use codex_protocol::ResponseUsageMetadata;
use codex_protocol::models::ResponseItem;
use codex_protocol::protocol::ModelVerification;
use codex_protocol::protocol::RateLimitSnapshot;
use codex_protocol::protocol::TokenUsage;
use codex_protocol::protocol::TurnModerationMetadataEvent;
use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Serialize, Deserialize)]
pub enum WireResponseEvent {
    CompactionProgress,
    Created {
        response_id: Option<String>,
    },
    SafetyBuffering {
        use_cases: Vec<String>,
        reasons: Vec<String>,
        show_buffering_ui: bool,
        faster_model: Option<String>,
    },
    OutputItemDone(ResponseItem),
    OutputItemAdded(ResponseItem),
    ServerModel(String),
    ModelVerifications(Vec<ModelVerification>),
    TurnModerationMetadata(TurnModerationMetadataEvent),
    ServerReasoningIncluded(bool),
    Completed {
        response_id: String,
        service_tier: Option<String>,
        token_usage: Option<TokenUsage>,
        usage_metadata: Option<ResponseUsageMetadata>,
        end_turn: Option<bool>,
    },
    OutputTextDelta(String),
    ToolCallInputDelta {
        item_id: String,
        call_id: Option<String>,
        delta: String,
    },
    ReasoningSummaryDelta {
        delta: String,
        summary_index: i64,
    },
    ReasoningSummaryDone {
        item_id: String,
        text: String,
        summary_index: i64,
    },
    ReasoningContentDelta {
        delta: String,
        content_index: i64,
    },
    ReasoningSummaryPartAdded {
        summary_index: i64,
    },
    RateLimits(RateLimitSnapshot),
    ModelsEtag(String),
}

// Exhaustive matches intentionally make newly added endpoint events require an
// explicit process-boundary decision instead of silently dropping their fields.
macro_rules! convert_events {
    ($value:expr, $from:ident, $to:ident, $safety:pat => $safety_expr:expr) => {
        match $value {
            $from::CompactionProgress => $to::CompactionProgress,
            $from::Created { response_id } => $to::Created { response_id },
            $from::OutputItemDone(v) => $to::OutputItemDone(v),
            $from::OutputItemAdded(v) => $to::OutputItemAdded(v),
            $from::ServerModel(v) => $to::ServerModel(v),
            $from::ModelVerifications(v) => $to::ModelVerifications(v),
            $from::TurnModerationMetadata(v) => $to::TurnModerationMetadata(v),
            $from::ServerReasoningIncluded(v) => $to::ServerReasoningIncluded(v),
            $from::Completed {
                response_id,
                service_tier,
                token_usage,
                usage_metadata,
                end_turn,
            } => $to::Completed {
                response_id,
                service_tier,
                token_usage,
                usage_metadata,
                end_turn,
            },
            $from::OutputTextDelta(v) => $to::OutputTextDelta(v),
            $from::ToolCallInputDelta {
                item_id,
                call_id,
                delta,
            } => $to::ToolCallInputDelta {
                item_id,
                call_id,
                delta,
            },
            $from::ReasoningSummaryDelta {
                delta,
                summary_index,
            } => $to::ReasoningSummaryDelta {
                delta,
                summary_index,
            },
            $from::ReasoningSummaryDone {
                item_id,
                text,
                summary_index,
            } => $to::ReasoningSummaryDone {
                item_id,
                text,
                summary_index,
            },
            $from::ReasoningContentDelta {
                delta,
                content_index,
            } => $to::ReasoningContentDelta {
                delta,
                content_index,
            },
            $from::ReasoningSummaryPartAdded { summary_index } => {
                $to::ReasoningSummaryPartAdded { summary_index }
            }
            $from::RateLimits(v) => $to::RateLimits(v),
            $from::ModelsEtag(v) => $to::ModelsEtag(v),
            $safety => $safety_expr,
        }
    };
}

impl From<ResponseEvent> for WireResponseEvent {
    fn from(value: ResponseEvent) -> Self {
        convert_events!(value, ResponseEvent, WireResponseEvent, safety @ ResponseEvent::SafetyBuffering(_) => {
            let ResponseEvent::SafetyBuffering(value) = safety else { unreachable!() };
            Self::SafetyBuffering {
                use_cases: value.use_cases,
                reasons: value.reasons,
                show_buffering_ui: value.show_buffering_ui,
                faster_model: value.faster_model,
            }
        })
    }
}

impl TryFrom<WireResponseEvent> for ResponseEvent {
    type Error = WireError;

    fn try_from(value: WireResponseEvent) -> Result<Self, Self::Error> {
        Ok(
            convert_events!(value, WireResponseEvent, ResponseEvent, safety @ WireResponseEvent::SafetyBuffering { .. } => {
                let WireResponseEvent::SafetyBuffering {
                    use_cases, reasons, show_buffering_ui, faster_model,
                } = safety else { unreachable!() };
                // SafetyBuffering's public fields are accessible through the event,
                // but its defining module is private. Its upstream Deserialize also
                // deliberately skips the presentation flag; restore it explicitly.
                let mut event = ResponseEvent::SafetyBuffering(serde_json::from_value(
                    serde_json::json!({"use_cases": use_cases, "reasons": reasons, "retry_model": faster_model})
                ).map_err(|err| WireError(err.to_string()))?);
                if let ResponseEvent::SafetyBuffering(value) = &mut event {
                    value.show_buffering_ui = show_buffering_ui;
                }
                event
            }),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reusing the API's skipped serde flag here would silently hide the UI.
    #[test]
    fn safety_buffering_preserves_presentation_flag() {
        let wire = WireResponseEvent::SafetyBuffering {
            use_cases: vec!["tools".into()],
            reasons: vec!["review".into()],
            show_buffering_ui: true,
            faster_model: Some("fast".into()),
        };
        let encoded = serde_json::to_vec(&wire).unwrap();
        let event =
            ResponseEvent::try_from(serde_json::from_slice::<WireResponseEvent>(&encoded).unwrap())
                .unwrap();
        let ResponseEvent::SafetyBuffering(value) = event else {
            panic!("expected buffering")
        };
        assert!(value.show_buffering_ui);
        assert_eq!(value.faster_model.as_deref(), Some("fast"));
        assert_eq!(value.use_cases, ["tools"]);
        assert_eq!(value.reasons, ["review"]);
    }
}
