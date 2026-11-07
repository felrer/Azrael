use super::*;
use crate::rollout::recorder::RolloutRecorder;
use codex_history::InitialHistory;
use codex_history::RolloutItem;
use pretty_assertions::assert_eq;
use std::ffi::OsString;
use std::path::Path;
use std::time::Duration;

// This fixture exercises the actual native subprocess protocol without opening
// credentials or contacting a provider. The selected test process must be run
// alone: the native runtime enablement flags are process-wide.
struct NativeCompactionEnv(Vec<(&'static str, Option<OsString>)>);

impl NativeCompactionEnv {
    fn new(helper: &Path, node: &Path) -> Self {
        let mut guard = Self(Vec::new());
        for (name, value) in [
            ("AZRAEL_DEVIN_NATIVE_HELPER", helper),
            ("AZRAEL_EX_DEVIN_EXECUTABLE", node),
            ("AZRAEL_PROVIDER_ACCOUNTS_HELPER", helper),
            ("AZRAEL_PROVIDER_BUN", node),
        ] {
            guard.0.push((name, std::env::var_os(name)));
            // SAFETY: this opt-in test runs alone and serializes all mutations.
            unsafe { std::env::set_var(name, value) };
        }
        guard
    }
}

impl Drop for NativeCompactionEnv {
    fn drop(&mut self) {
        for (name, previous) in self.0.iter().rev() {
            // SAFETY: the same isolation contract applies during restoration.
            unsafe {
                match previous {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
    }
}

const HELPER: &str = r#"
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const root = __dirname;
readline.createInterface({input: process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  if (request.action === 'credential') {
    console.log(JSON.stringify({id: request.id, type: 'result', value: {
      api_key: 'test-only', api_server_url: 'https://unused.invalid', account_id: 'mock-account'
    }}));
    process.exit(0);
  }
  if (request.type === 'init') return;
  fs.appendFileSync(path.join(root, 'requests.jsonl'), JSON.stringify(request) + '\n');
  let seq = 0;
  const send = (type, fields = {}) => console.log(JSON.stringify({
    protocol_version: 1, request_id: request.request_id, seq: seq++, type, ...fields
  }));
  send('created');
  const mode = fs.readFileSync(path.join(root, 'mode'), 'utf8');
  if (mode === 'tool') send('item_done', {item: {
    type: 'function_call', name: 'exec_command', call_id: 'forbidden-tool', arguments: '{}'
  }});
  else if (mode !== 'empty') send('item_done', {item: {
    type: 'message', id: 'mock-summary', role: 'assistant',
    content: [{type: 'output_text', text: 'Keep the native compaction checkpoint.'}]
  }});
  if (mode === 'failure') send('error', {code: 'provider_http_500'});
  else send('completed');
  process.exit(0);
});
"#;

// Retain this opt-in boundary test because replacing the compaction transport
// or sharing the normal tool prompt could silently reintroduce history leaks.
#[tokio::test]
#[ignore = "requires AZRAEL_DEVIN_NODE and an isolated --test-threads=1 process"]
#[serial_test::serial(azrael_native_compaction_env)]
async fn native_devin_compaction_commits_only_completed_nonempty_summary() -> anyhow::Result<()> {
    let node = std::path::PathBuf::from(
        std::env::var_os("AZRAEL_DEVIN_NODE")
            .expect("set AZRAEL_DEVIN_NODE to the absolute Node executable"),
    );
    assert!(node.is_absolute() && node.is_file());
    for mode in ["success", "empty", "failure", "tool", "cancelled"] {
        let root = tempfile::tempdir()?;
        let helper = root.path().join("compact-helper.cjs");
        std::fs::write(&helper, HELPER)?;
        std::fs::write(root.path().join("mode"), mode)?;
        let _env = NativeCompactionEnv::new(&helper, &node);
        let catalog_dir = root.path().join("azrael/devin");
        std::fs::create_dir_all(&catalog_dir)?;
        std::fs::write(
            catalog_dir.join("models.json"),
            r#"{"families":[{
            "family_label":"SWE-2","family_uid":"swe-2","slug":"swe-2","aliases":[],
            "variants":[{"model_uid":"swe-2-high","label":"High","max_context_tokens":272000}]
        }]}"#,
        )?;
        let (mut session, turn, _events) = make_session_and_context_with_auth_and_config_and_rx(
            CodexAuth::from_api_key("unused-test-key"),
            Vec::new(),
            |config| {
                config.codex_home = root.path().try_into().expect("absolute fixture home");
                config.model = Some("devin/swe-2-high".to_string());
                config.model_provider_id = "devin".to_string();
                config.model_provider.stream_max_retries = Some(0);
            },
        )
        .await;
        let rollout_path = crate::session::tests::attach_thread_persistence(
            Arc::get_mut(&mut session).expect("fixture session is uniquely owned"),
        )
        .await;
        session
            .record_conversation_items(
                &turn,
                turn.model_info(),
                &[
                    user_message("Remember the user's original requirement."),
                    serde_json::from_value(
                        json!({"type":"message", "role":"assistant", "content":[
                            {"type":"output_text", "text":"Old assistant content must be replaced."}
                        ]}),
                    )?,
                ],
            )
            .await;
        let before = session.clone_history().await.annotated_items().to_vec();
        let step = session
            .capture_step_context(
                Arc::clone(&turn),
                &tokio_util::sync::CancellationToken::new(),
            )
            .await?;
        let world_state = Arc::new(session.build_world_state_for_step(&step, true).await?);
        let result = if mode == "cancelled" {
            let cancellation = tokio_util::sync::CancellationToken::new();
            cancellation.cancel();
            let metadata = session
                .compaction_responses_metadata(
                    &turn,
                    CompactionTurnMetadata::new(
                        CompactionTrigger::Manual,
                        CompactionReason::UserRequested,
                        CompactionImplementation::Responses,
                        CompactionPhase::StandaloneTurn,
                    ),
                )
                .await;
            let mut client = session
                .services
                .model_client
                .session_for_provider(Arc::clone(&turn.provider), None);
            let result = tokio::time::timeout(
                Duration::from_secs(20),
                drain_to_completed(
                    &session,
                    &turn,
                    &mut client,
                    &metadata,
                    &Prompt {
                        input: session
                            .clone_history()
                            .await
                            .for_prompt(&turn.model_info().input_modalities),
                        ..Default::default()
                    },
                    CompactionPhase::StandaloneTurn,
                    Some(&cancellation),
                ),
            )
            .await
            .expect("cancelled mock compaction must finish promptly");
            assert!(
                matches!(&result, Err(error) if matches!(error.details(), CodexErrorDetails::Interrupted))
            );
            assert!(
                !root.path().join("requests.jsonl").exists(),
                "cancelled request launched inference"
            );
            result.map(|_| ())
        } else {
            tokio::time::timeout(
                Duration::from_secs(20),
                run_compact_task(
                    Arc::clone(&session),
                    step,
                    world_state,
                    vec![UserInput::Text {
                        text: "Summarize this conversation.".to_string(),
                        text_elements: Vec::new(),
                    }],
                ),
            )
            .await
            .expect("mock compaction must finish promptly")
        };
        let history = session.clone_history().await;
        session.flush_rollout().await?;
        let InitialHistory::Resumed(resumed) =
            RolloutRecorder::get_rollout_history(&rollout_path).await?
        else {
            panic!("expected persisted test history");
        };
        let checkpoints = resumed
            .history
            .iter()
            .filter_map(|item| match item {
                RolloutItem::Compacted(checkpoint) => Some(checkpoint),
                _ => None,
            })
            .collect::<Vec<_>>();
        if mode == "success" {
            result?;
            let summary = format!("{SUMMARY_PREFIX}\nKeep the native compaction checkpoint.");
            assert_eq!(checkpoints.len(), 1);
            assert_eq!(checkpoints[0].message, summary);
            // The persisted metadata sidecar materializes missing metadata as
            // Some(default). Compare every response item and metadata field,
            // normalizing only that serialization-equivalent empty value.
            let persisted = checkpoints[0]
                .replacement_history
                .as_deref()
                .expect("checkpoint replacement history");
            assert_eq!(
                persisted
                    .iter()
                    .map(|envelope| (
                        &envelope.item,
                        envelope.metadata.clone().unwrap_or_default(),
                    ))
                    .collect::<Vec<_>>(),
                history
                    .annotated_items()
                    .iter()
                    .map(|envelope| (
                        &envelope.item,
                        envelope.metadata.clone().unwrap_or_default(),
                    ))
                    .collect::<Vec<_>>()
            );
            assert!(history.raw_items().any(|item| matches!(item,
                ResponseItem::Message {role, content, ..} if role == "user"
                    && content_items_to_text(content).as_deref() == Some(summary.as_str())
            )));
            assert!(!history.raw_items().any(|item| matches!(item,
                ResponseItem::Message {role, ..} if role == "assistant"
            )));
            // Observe the actual next native request, rather than only checking
            // the history object which supplies it.
            let mut stream = crate::devin::native_runtime::stream(
                Arc::clone(&session),
                Arc::clone(&turn),
                Prompt {
                    input: history.for_prompt(&turn.model_info().input_modalities),
                    ..Default::default()
                },
                tokio_util::sync::CancellationToken::new(),
                turn.reasoning_effort(),
            )
            .await?;
            let mut completed = false;
            while let Some(event) = stream.next().await {
                if matches!(event?, ResponseEvent::Completed { .. }) {
                    completed = true;
                }
            }
            assert!(completed);
            let requests = captured_requests(root.path())?;
            assert_eq!(requests.len(), 2);
            assert!(requests[1]["input"].as_array().unwrap().iter().any(|item| {
                item["role"] == "user"
                    && item["content"]
                        .as_array()
                        .is_some_and(|content| content.iter().any(|part| part["text"] == summary))
            }));
        } else {
            assert!(result.is_err(), "{mode} must reject compaction");
            assert!(checkpoints.is_empty(), "{mode} persisted a checkpoint");
            assert_eq!(
                history.annotated_items(),
                before.as_slice(),
                "{mode} changed live history"
            );
            assert!(!resumed.history.iter().any(|item| matches!(item,
                RolloutItem::ResponseItem(envelope) if matches!(&envelope.item,
                    ResponseItem::Message {role, content, ..} if role == "assistant"
                        && content_items_to_text(content).as_deref() == Some("Keep the native compaction checkpoint.")
                )
            )), "{mode} persisted rejected summary output");
        }
        if mode != "cancelled" {
            let requests = captured_requests(root.path())?;
            assert!(!requests.is_empty());
            assert!(requests.iter().all(|request| request["type"] == "request"));
            assert!(requests.iter().all(|request| request["tools"] == json!([])));
        }
    }
    Ok(())
}

fn captured_requests(root: &Path) -> anyhow::Result<Vec<serde_json::Value>> {
    std::fs::read_to_string(root.join("requests.jsonl"))?
        .lines()
        .map(|line| serde_json::from_str(line).map_err(Into::into))
        .collect()
}
