use super::*;
use pretty_assertions::assert_eq;

fn notification(update: Value) -> ServerNotification {
    ServerNotification {
        method: "session/update".to_string(),
        params: json!({"sessionId":"session-1", "update": update}),
    }
}

fn dynamic(lifecycle: &Lifecycle) -> &DynamicToolCallItem {
    match lifecycle {
        Lifecycle::Started(TurnItem::DynamicToolCall(item))
        | Lifecycle::Completed(TurnItem::DynamicToolCall(item)) => item,
        _ => panic!("expected dynamic tool lifecycle item"),
    }
}

#[test]
fn titleless_rejection_uses_content_and_keeps_error_in_content_items() {
    let mut tracker = ToolTracker::new("session-1", "turn-1");
    let events = tracker
        .ingest(&notification(json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": "exec:0",
                "status": "failed",
                "content": [{
                    "type": "content",
                    "content": {
                        "type": "text",
                        "text": "Tool execution was rejected: User skipped this tool call"
                    }
                }],
                "_meta": {"cognition.ai/rejected": true}
        })))
        .unwrap();
    assert_eq!(events.len(), 2);
    let mut item = dynamic(&events[1]).clone();
    assert!(item.duration.is_some());
    item.duration = None;
    insta::assert_snapshot!(serde_json::to_string_pretty(&item).unwrap(), @r###"
    {
      "id": "devin:turn-1:exec:0",
      "namespace": "devin",
      "tool": "Devin tool",
      "arguments": {
        "kind": null
      },
      "status": "failed",
      "content_items": [
        {
          "type": "inputText",
          "text": "Tool execution was rejected: User skipped this tool call"
        }
      ],
      "success": false,
      "error": "Tool execution was rejected: User skipped this tool call"
    }
    "###);
}

#[test]
fn permission_request_merges_partial_observation_metadata() {
    let mut tracker = ToolTracker::new("session-1", "turn-1");
    tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call", "toolCallId":"exec:permission",
            "kind":"execute", "rawInput":{"command":"Get-ChildItem"},
            "scope":{"cwd":"C:/work"}
        })))
        .unwrap();
    let merged = tracker
        .permission_params(&json!({
            "sessionId":"session-1",
            "toolCall":{"toolCallId":"exec:permission"},
            "options":[]
        }))
        .unwrap();
    assert_eq!(
        merged,
        json!({
            "sessionId":"session-1",
            "toolCall":{
                "toolCallId":"exec:permission",
                "kind":"execute",
                "rawInput":{"command":"Get-ChildItem"},
                "scope":{"cwd":"C:/work"}
            },
            "options":[]
        })
    );
}

#[test]
fn permission_request_correlates_bounded_non_execute_tool_metadata_once() {
    let mut tracker = ToolTracker::new("session-1", "turn-1");
    tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call", "toolCallId":"edit:permission",
            "kind":"edit", "rawInput":{"path":"C:/work/file.txt", "patch":"opaque"},
            "scope":{"cwd":"C:/work"}
        })))
        .unwrap();
    let request = json!({
        "sessionId":"session-1",
        "toolCall":{"toolCallId":"edit:permission"},
        "options":[{"kind":"allow_once", "optionId":"once"}]
    });
    assert_eq!(
        tracker.permission_params(&request).unwrap(),
        json!({
            "sessionId":"session-1",
            "toolCall":{
                "toolCallId":"edit:permission", "kind":"edit",
                "rawInput":{"path":"C:/work/file.txt", "patch":"opaque"},
                "scope":{"cwd":"C:/work"}
            },
            "options":[{"kind":"allow_once", "optionId":"once"}]
        })
    );
    assert!(tracker.permission_params(&request).is_err());
}

#[test]
fn permission_request_rejects_session_mismatch_conflicts_and_replay() {
    let mut tracker = ToolTracker::new("session-1", "turn-1");
    tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call", "toolCallId":"exec:permission",
            "kind":"execute", "rawInput":{"command":"safe"}, "scope":"workspace"
        })))
        .unwrap();
    assert!(
        tracker
            .permission_params(&json!({
                "sessionId":"session-2", "toolCall":{"toolCallId":"exec:permission"}
            }))
            .is_err()
    );
    assert!(
        tracker
            .permission_params(&json!({
                "sessionId":"session-1", "toolCall":{
                    "toolCallId":"exec:permission", "rawInput":{"command":"changed"}
                }
            }))
            .is_err()
    );
    let request = json!({
        "sessionId":"session-1", "toolCall":{
            "toolCallId":"exec:permission", "kind":"execute",
            "rawInput":{"command":"safe"}, "scope":"workspace"
        }
    });
    assert!(tracker.permission_params(&request).is_err());

    tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call", "toolCallId":"exec:replay",
            "kind":"execute", "rawInput":{"command":"safe"}
        })))
        .unwrap();
    let replay = json!({
        "sessionId":"session-1", "toolCall":{"toolCallId":"exec:replay"}
    });
    assert!(tracker.permission_params(&replay).is_ok());
    assert!(tracker.permission_params(&replay).is_err());
}

#[test]
fn changed_observation_scope_invalidates_permission_and_terminal_is_stale() {
    let mut tracker = ToolTracker::new("session-1", "turn-1");
    for scope in ["workspace", "system"] {
        tracker
            .ingest(&notification(json!({
                "sessionUpdate":"tool_call_update", "toolCallId":"exec:scope",
                "kind":"execute", "rawInput":{"command":"safe"}, "scope":scope
            })))
            .unwrap();
    }
    assert!(
        tracker
            .permission_params(&json!({
                "sessionId":"session-1", "toolCall":{"toolCallId":"exec:scope"}
            }))
            .is_err()
    );

    tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call_update", "toolCallId":"exec:done",
            "kind":"execute", "rawInput":{"command":"safe"}, "status":"completed"
        })))
        .unwrap();
    assert!(
        tracker
            .permission_params(&json!({
                "sessionId":"session-1", "toolCall":{"toolCallId":"exec:done"}
            }))
            .is_err()
    );
}

#[test]
fn changed_observation_command_or_kind_invalidates_permission() {
    for changed in [
        json!({"kind":"execute", "rawInput":{"command":"changed"}}),
        json!({"kind":"edit", "rawInput":{"command":"safe"}}),
    ] {
        let mut tracker = ToolTracker::new("session-1", "turn-1");
        tracker
            .ingest(&notification(json!({
                "sessionUpdate":"tool_call", "toolCallId":"exec:changed",
                "kind":"execute", "rawInput":{"command":"safe"}
            })))
            .unwrap();
        let mut update = changed;
        update["sessionUpdate"] = json!("tool_call_update");
        update["toolCallId"] = json!("exec:changed");
        tracker.ingest(&notification(update)).unwrap();
        assert!(
            tracker
                .permission_params(&json!({
                    "sessionId":"session-1", "toolCall":{"toolCallId":"exec:changed"}
                }))
                .is_err()
        );
    }
}

#[test]
fn oversized_edit_payload_does_not_abort_observation_or_enter_permission_cache() {
    let mut tracker = ToolTracker::new("session-1", "turn-1");
    let observed = tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call", "toolCallId":"edit:large", "kind":"edit",
            "rawInput":{"content":"x".repeat(80 * 1024)}
        })))
        .unwrap();
    assert_eq!(observed.len(), 1);
    assert!(
        tracker
            .permission_params(&json!({
                "sessionId":"session-1", "toolCall":{"toolCallId":"edit:large"}
            }))
            .is_err()
    );
}

#[test]
fn complete_request_without_observation_is_valid_once_and_bounded() {
    let mut tracker = ToolTracker::new("session-1", "turn-1");
    let request = json!({
        "sessionId":"session-1", "toolCall":{
            "toolCallId":"exec:request-only", "kind":"execute",
            "rawInput":{"command":"safe"}, "scope":"workspace"
        }
    });
    assert_eq!(tracker.permission_params(&request).unwrap(), request);
    assert!(tracker.permission_params(&request).is_err());

    assert!(
        tracker
            .permission_params(&json!({
                "sessionId":"session-1", "toolCall":{
                    "toolCallId":"exec:oversized", "kind":"execute",
                    "rawInput":{"command":"x".repeat(40 * 1024)}
                }
            }))
            .is_err()
    );
    assert!(
        tracker
            .permission_params(&json!({
                "sessionId":"session-1", "toolCall":{
                    "toolCallId":"exec:oversized", "kind":"execute",
                    "rawInput":{"command":"safe"}
                }
            }))
            .is_err()
    );
}

#[test]
fn partial_updates_preserve_title_kind_and_terminal_state() {
    let mut tracker = ToolTracker::new("session-1", "turn-1");
    let started = tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call", "toolCallId":"read:1",
            "title":"Read file"
        })))
        .unwrap();
    assert_eq!(started.len(), 1);
    assert!(
        tracker
            .ingest(&notification(json!({
                "sessionUpdate":"tool_call_update", "toolCallId":"read:1", "kind":"read"
            })))
            .unwrap()
            .is_empty()
    );
    let completed = tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call_update", "toolCallId":"read:1", "status":"completed"
        })))
        .unwrap();
    let item = dynamic(&completed[0]);
    assert_eq!(item.tool, "Read file");
    assert_eq!(item.arguments, json!({"kind":"read"}));

    assert!(
        tracker
            .ingest(&notification(json!({
                "sessionUpdate":"tool_call_update", "toolCallId":"read:1",
                "title":"regressed", "status":"failed"
            })))
            .unwrap()
            .is_empty()
    );
    assert!(tracker.finish_items("prompt ended").is_empty());
}

#[test]
fn failed_output_is_utf8_bounded_and_common_secrets_are_redacted() {
    let mut tracker = ToolTracker::new("session-1", "turn-1");
    let text = format!(
        "password=hunter2 Authorization: Bearer abcdef\n{}",
        "é".repeat(MAX_FAILURE_BYTES)
    );
    let events = tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call_update", "toolCallId":"exec:1",
            "status":"failed", "rawOutput":text
        })))
        .unwrap();
    let failure = dynamic(&events[1]).error.as_deref().unwrap();
    assert!(failure.len() <= MAX_FAILURE_BYTES);
    assert!(failure.ends_with(TRUNCATED));
    assert!(failure.contains("password=[REDACTED]"));
    assert!(failure.contains("Authorization: [REDACTED]"));
    assert!(!failure.contains("hunter2"));
    assert!(!failure.contains("abcdef"));
}

#[test]
fn quoted_bearer_and_openai_secrets_are_redacted_before_truncation() {
    let text = concat!(
        r#"{"token":"abc", "password":'two words'} "#,
        "bearer standalone-secret sk-1234567890abcdef"
    );
    let redacted = bounded_redacted(text, 1024);
    assert!(redacted.contains(r#""token":[REDACTED]"#));
    assert!(redacted.contains(r#""password":[REDACTED]"#));
    assert!(redacted.contains("Bearer [REDACTED]"));
    assert!(redacted.ends_with("[REDACTED]"));
    for secret in [
        "abc",
        "two words",
        "standalone-secret",
        "sk-1234567890abcdef",
    ] {
        assert!(!redacted.contains(secret));
    }

    let edge = format!(
        "{} password='secret without closing quote",
        "x".repeat(16_350)
    );
    let redacted_edge = bounded_redacted(&edge, MAX_REDACTION_SCAN_BYTES);
    assert!(!redacted_edge.contains("secret without closing quote"));
}

#[test]
fn failure_candidate_survives_partial_update_and_structured_error_wins() {
    let mut tracker = ToolTracker::new("session-1", "turn-1");
    tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call", "toolCallId":"exec:partial",
            "content":[{"type":"content", "content":{"type":"text", "text":"permission denied"}}]
        })))
        .unwrap();
    let events = tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call_update", "toolCallId":"exec:partial",
            "status":"failed"
        })))
        .unwrap();
    assert_eq!(
        dynamic(&events[0]).error.as_deref(),
        Some("permission denied")
    );

    let mut tracker = ToolTracker::new("session-1", "turn-1");
    let events = tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call_update", "toolCallId":"read:resource",
            "status":"failed",
            "content":[{"type":"resource", "resource":{"text":"private file payload"}}],
            "rawOutput":{"error":"safe failure explanation"}
        })))
        .unwrap();
    assert_eq!(
        dynamic(&events[1]).error.as_deref(),
        Some("safe failure explanation")
    );
    assert!(
        !dynamic(&events[1])
            .error
            .as_deref()
            .unwrap()
            .contains("private file")
    );
}

#[test]
fn completed_status_is_not_reclassified_from_stderr_text() {
    let mut tracker = ToolTracker::new("session-1", "turn-1");
    let events = tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call_update", "toolCallId":"exec:2",
            "status":"completed", "rawOutput":{"stderr":"command failed"}
        })))
        .unwrap();
    assert_eq!(dynamic(&events[1]).status, DynamicToolCallStatus::Completed);
    assert_eq!(dynamic(&events[1]).error, None);
}

#[test]
fn terminal_exit_metadata_distinguishes_command_result_from_transport_status() {
    let mut tracker = ToolTracker::new("session-1", "turn-1");
    let zero = tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call_update", "toolCallId":"exec:zero", "kind":"execute",
            "status":"completed", "content":[{"type":"content", "content":{
                "type":"text", "text":"error text from a successful command"
            }}],
            "_meta":{"terminal_exit":{"exit_code":0, "signal":null}}
        })))
        .unwrap();
    assert_eq!(dynamic(&zero[1]).status, DynamicToolCallStatus::Completed);
    assert_eq!(dynamic(&zero[1]).success, Some(true));
    assert_eq!(dynamic(&zero[1]).error, None);
    assert_eq!(
        dynamic(&zero[1]).arguments,
        json!({"kind":"execute", "exitCode":0, "signal":null})
    );

    let nonzero = tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call_update", "toolCallId":"exec:nonzero", "kind":"execute",
            "status":"completed", "_meta":{"terminal_exit":{"exit_code":7, "signal":null}}
        })))
        .unwrap();
    assert_eq!(dynamic(&nonzero[1]).status, DynamicToolCallStatus::Failed);
    assert_eq!(dynamic(&nonzero[1]).success, Some(false));
    assert_eq!(
        dynamic(&nonzero[1]).error.as_deref(),
        Some("Command exited with code 7.")
    );
    assert_eq!(
        dynamic(&nonzero[1]).content_items.as_ref().unwrap(),
        &vec![DynamicToolCallOutputContentItem::InputText {
            text: "Command exited with code 7.".to_string()
        }]
    );

    let missing = tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call_update", "toolCallId":"exec:missing", "kind":"execute",
            "status":"completed"
        })))
        .unwrap();
    assert_eq!(
        dynamic(&missing[1]).status,
        DynamicToolCallStatus::Completed
    );
    assert_eq!(dynamic(&missing[1]).arguments, json!({"kind":"execute"}));
}

#[test]
fn terminal_exit_metadata_waits_for_explicit_terminal_status() {
    let mut tracker = ToolTracker::new("session-1", "turn-1");
    let metadata_only = tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call_update", "toolCallId":"exec:later-failed",
            "_meta":{"terminal_exit":{"exit_code":9, "signal":null}}
        })))
        .unwrap();
    assert_eq!(metadata_only.len(), 1);
    assert_eq!(
        dynamic(&metadata_only[0]).status,
        DynamicToolCallStatus::InProgress
    );
    let failed = tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call_update", "toolCallId":"exec:later-failed",
            "status":"failed"
        })))
        .unwrap();
    assert_eq!(dynamic(&failed[0]).status, DynamicToolCallStatus::Failed);
    assert_eq!(
        dynamic(&failed[0]).error.as_deref(),
        Some("Command exited with code 9.")
    );

    let empty_metadata = tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call", "toolCallId":"exec:empty",
            "_meta":{"terminal_exit":{}}
        })))
        .unwrap();
    assert_eq!(empty_metadata.len(), 1);
    assert_eq!(
        dynamic(&empty_metadata[0]).status,
        DynamicToolCallStatus::InProgress
    );
    assert!(
        tracker
            .ingest(&notification(json!({
                "sessionUpdate":"tool_call_update", "toolCallId":"exec:empty",
                "_meta":{"terminal_exit":{"signal":null}}
            })))
            .unwrap()
            .is_empty()
    );
    let completed = tracker
        .ingest(&notification(json!({
            "sessionUpdate":"tool_call_update", "toolCallId":"exec:empty",
            "status":"completed"
        })))
        .unwrap();
    assert_eq!(
        dynamic(&completed[0]).status,
        DynamicToolCallStatus::Completed
    );
}

#[test]
fn cross_session_updates_and_entry_overflow_are_rejected() {
    let mut tracker = ToolTracker::new("session-1", "turn-1");
    let cross_session = ServerNotification {
        method: "session/update".to_string(),
        params: json!({"sessionId":"session-2", "update": {
            "sessionUpdate":"tool_call", "toolCallId":"exec:0"
        }}),
    };
    assert!(tracker.ingest(&cross_session).is_err());
    for index in 0..MAX_TOOLS {
        tracker
            .ingest(&notification(json!({
                "sessionUpdate":"tool_call", "toolCallId":format!("exec:{index}")
            })))
            .unwrap();
    }
    assert!(
        tracker
            .ingest(&notification(json!({
                "sessionUpdate":"tool_call", "toolCallId":"overflow"
            })))
            .is_err()
    );
}

#[test]
fn finish_closes_pending_in_observation_order_with_explicit_failure() {
    let mut tracker = ToolTracker::new("session-1", "turn-1");
    for call_id in ["exec:2", "read:1"] {
        tracker
            .ingest(&notification(json!({
                "sessionUpdate":"tool_call", "toolCallId":call_id
            })))
            .unwrap();
    }
    let events = tracker.finish_items("transport error: token=private");
    assert_eq!(events.len(), 2);
    assert_eq!(dynamic(&events[0]).id, "devin:turn-1:exec:2");
    assert_eq!(dynamic(&events[1]).id, "devin:turn-1:read:1");
    for event in &events {
        let item = dynamic(event);
        assert_eq!(item.status, DynamicToolCallStatus::Failed);
        assert_eq!(item.success, Some(false));
        assert_eq!(
            item.error.as_deref(),
            Some("transport error: token=[REDACTED]")
        );
        assert_eq!(
            item.content_items.as_ref().unwrap(),
            &vec![DynamicToolCallOutputContentItem::InputText {
                text: "transport error: token=[REDACTED]".to_string(),
            }]
        );
    }
    assert!(tracker.finish_items("duplicate finish").is_empty());
}
