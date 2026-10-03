use super::context::checkpoint;
use super::*;
use codex_protocol::models::AgentMessageInputContent;
use codex_protocol::models::ImageReference;
use pretty_assertions::assert_eq;
use std::path::Path;

fn context(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

fn sidecar(model: &str, cwd: &Path, values: &[&str], item_count: usize) -> SessionSidecar {
    let context = context(values);
    SessionSidecar {
        external_session_id: "external-1".to_string(),
        provider: "devin".to_string(),
        model_uid: model.to_string(),
        cwd: cwd.to_path_buf(),
        checkpoint: checkpoint(&context, item_count),
    }
}

#[test]
fn matching_checkpoint_resumes_with_only_context_delta() {
    let cwd = Path::new("C:/work");
    let values = context(&["prefix", "old", "new"]);
    let prior = sidecar("swe-2-high", cwd, &["prefix", "old"], 2);
    assert_eq!(
        reconcile(Some(&prior), "swe-2-high", cwd, &values),
        Reconcile::Resume { delta_start: 2 }
    );
}

#[test]
fn completed_assistant_output_is_part_of_the_resume_checkpoint() {
    let cwd = Path::new("C:/work");
    let prior_context = context(&["prefix", "user"]);
    let prior = SessionSidecar {
        external_session_id: "external-1".to_string(),
        provider: "devin".to_string(),
        model_uid: "swe-2-high".to_string(),
        cwd: cwd.to_path_buf(),
        checkpoint: checkpoint_with_assistant_items(&prior_context, &["answer".to_string()]),
    };
    let next = context(&[
        "prefix",
        "user",
        "[Codex context item 2; source role: assistant]\nanswer",
        "next user",
    ]);
    assert_eq!(
        reconcile(Some(&prior), "swe-2-high", cwd, &next),
        Reconcile::Resume { delta_start: 3 }
    );
}

#[test]
fn changed_context_prefix_creates_a_fresh_session() {
    let cwd = Path::new("C:/work");
    let prior = sidecar("swe-2-high", cwd, &["prefix", "old"], 2);
    assert_eq!(
        reconcile(
            Some(&prior),
            "swe-2-high",
            cwd,
            &context(&["prefix", "changed"])
        ),
        Reconcile::New {
            reason: "context mismatch"
        }
    );
}

#[test]
fn provider_model_and_cwd_mismatches_never_resume() {
    let cwd = Path::new("C:/work");
    let values = context(&["prefix"]);
    let mut prior = sidecar("swe-2-high", cwd, &["prefix"], 1);
    assert_eq!(
        reconcile(Some(&prior), "swe-2-max", cwd, &values),
        Reconcile::New {
            reason: "model mismatch"
        }
    );
    prior.provider = "openai".to_string();
    assert_eq!(
        reconcile(Some(&prior), "swe-2-high", cwd, &values),
        Reconcile::New {
            reason: "provider mismatch"
        }
    );
    prior.provider = "devin".to_string();
    assert_eq!(
        reconcile(Some(&prior), "swe-2-high", Path::new("C:/other"), &values),
        Reconcile::New {
            reason: "cwd mismatch"
        }
    );
}

#[test]
fn model_readback_requires_exact_current_value() {
    let exact = json!({"configOptions":[{"id":"model","currentValue":"swe-2-high"}]});
    let mismatch = json!({"configOptions":[{"id":"model","currentValue":"swe"}]});
    assert!(verify_model(&exact, "swe-2-high").is_ok());
    assert!(verify_model(&mismatch, "swe-2-high").is_err());
}

#[test]
fn context_transfer_preserves_roles_and_enforces_item_bound() {
    let items = vec![ResponseItem::Message {
        id: None,
        role: "developer".to_string(),
        content: vec![ContentItem::InputText {
            text: "effective AGENTS instructions".to_string(),
        }],
        phase: None,
        internal_chat_message_metadata_passthrough: None,
    }];
    let encoded = encode_context(&items).unwrap();
    assert_eq!(
        encoded[1],
        "[Codex context item 1; source role: developer]\neffective AGENTS instructions"
    );

    let oversized = vec![ResponseItem::Message {
        id: None,
        role: "user".to_string(),
        content: vec![ContentItem::InputText {
            text: "x".repeat(41 * 1024),
        }],
        phase: None,
        internal_chat_message_metadata_passthrough: None,
    }];
    assert!(encode_context(&oversized).is_err());

    let image = vec![ResponseItem::Message {
        id: None,
        role: "user".to_string(),
        content: vec![ContentItem::InputImage {
            image: ImageReference::Inline {
                image_url: "data:image/png;base64,AA==".to_string(),
            },
            detail: None,
        }],
        phase: None,
        internal_chat_message_metadata_passthrough: None,
    }];
    assert!(encode_context(&image).is_err());
}

#[test]
fn astra_opaque_reasoning_and_tool_schemas_do_not_block_plaintext_transfer() {
    let items = vec![
        ResponseItem::Reasoning {
            id: None,
            summary: Vec::new(),
            content: None,
            encrypted_content: Some("opaque-astra-bytes".to_string()),
            internal_chat_message_metadata_passthrough: None,
        },
        ResponseItem::AdditionalTools {
            id: None,
            role: "developer".to_string(),
            tools: vec![json!({"name":"native-only"})],
        },
        ResponseItem::Message {
            id: None,
            role: "developer".to_string(),
            content: vec![ContentItem::InputText {
                text: "AGENTS and activated skill instructions".to_string(),
            }],
            phase: None,
            internal_chat_message_metadata_passthrough: None,
        },
    ];
    let encoded = encode_context(&items).unwrap();
    assert_eq!(encoded.len(), 2);
    assert!(encoded[0].contains("deliberately excluded"));
    assert!(!encoded.join("\n").contains("opaque-astra-bytes"));
    assert!(encoded[1].contains("AGENTS and activated skill instructions"));
}

#[test]
fn encrypted_agent_payload_is_omitted_but_adjacent_plaintext_is_preserved() {
    let items = vec![ResponseItem::AgentMessage {
        id: None,
        author: "parent".to_string(),
        recipient: "child".to_string(),
        content: vec![
            AgentMessageInputContent::InputText {
                text: "delegated task context".to_string(),
            },
            AgentMessageInputContent::EncryptedContent {
                encrypted_content: "opaque-agent-bytes".to_string(),
            },
            AgentMessageInputContent::InputText {
                text: "activated skill instructions".to_string(),
            },
        ],
        internal_chat_message_metadata_passthrough: None,
    }];
    let encoded = encode_context(&items).unwrap();
    assert_eq!(encoded.len(), 2);
    assert!(encoded[1].contains("delegated task context"));
    assert!(encoded[1].contains("activated skill instructions"));
    assert!(!encoded.join("\n").contains("opaque-agent-bytes"));
}
