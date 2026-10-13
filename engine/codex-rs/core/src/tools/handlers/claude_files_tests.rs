use super::*;
use crate::session::step_context::StepContext;
use crate::session::tests::make_session_and_context;
use crate::tools::context::ToolCallSource;
use crate::turn_diff_tracker::TurnDiffTracker;

async fn invocation(path: &std::path::Path, offset: usize, limit: usize) -> ToolInvocation {
    let (session, turn) = make_session_and_context().await;
    invocation_with_context(session.into(), Arc::new(turn), path, offset, limit)
}

fn invocation_with_context(
    session: Arc<crate::session::Session>,
    turn: Arc<crate::session::turn_context::TurnContext>,
    path: &std::path::Path,
    offset: usize,
    limit: usize,
) -> ToolInvocation {
    ToolInvocation {
        session,
        step_context: StepContext::for_test(Arc::clone(&turn)),
        turn,
        cancellation_token: tokio_util::sync::CancellationToken::new(),
        tracker: Arc::new(tokio::sync::Mutex::new(TurnDiffTracker::new())),
        call_id: "claude-read".into(),
        tool_name: ToolName::plain("Read"),
        source: ToolCallSource::Direct,
        payload: ToolPayload::Function { arguments: serde_json::json!({ "file_path": path.to_string_lossy(), "offset": offset, "limit": limit }).to_string() },
    }
}

async fn native_write_context(
    approval: codex_protocol::protocol::AskForApproval,
) -> (
    Arc<crate::session::Session>,
    Arc<crate::session::turn_context::TurnContext>,
    async_channel::Receiver<codex_protocol::protocol::Event>,
) {
    crate::session::tests::make_session_and_context_with_auth_and_config_and_rx(
        codex_login::CodexAuth::from_api_key("Test API Key"),
        Vec::new(),
        |config| {
            config
                .permissions
                .set_permission_profile(codex_protocol::permissions::PermissionProfile::Disabled)
                .unwrap();
            config.permissions.approval_policy = crate::config::Constrained::allow_any(approval);
        },
    )
    .await
}

#[tokio::test]
async fn accepted_read_edit_and_reread_write_use_native_exact_bytes() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("space Unicode 한글.txt");
    std::fs::write(&path, "안녕\r\n世界\r\n").unwrap();
    let (session, turn, _events) =
        native_write_context(codex_protocol::protocol::AskForApproval::Never).await;
    let call = invocation_with_context(session, turn, &path, 1, 10);
    let state = Arc::new(ClaudeFileState::default());
    let read = ClaudeFileHandler::new(ClaudeFileOperation::Read, state.clone(), false);
    let edit = ClaudeFileHandler::new(ClaudeFileOperation::Edit, state.clone(), false);
    let write = ClaudeFileHandler::new(ClaudeFileOperation::Write, state.clone(), false);
    let output = read.handle(call.clone()).await.unwrap();
    read.on_tool_result_accepted(&call, output.as_ref());
    let mut edit_call = call.clone();
    edit_call.tool_name = ToolName::plain("Edit");
    edit_call.payload = ToolPayload::Function {
        arguments: serde_json::json!({"file_path": path.to_string_lossy(), "old_string": "世界", "new_string": "수정"}).to_string(),
    };
    assert!(edit.handle(edit_call).await.unwrap().success_for_logging());
    assert_eq!(std::fs::read(&path).unwrap(), "안녕\r\n수정\r\n".as_bytes());
    assert!(state.reads.lock().unwrap().is_empty());

    let mut write_call = call.clone();
    write_call.tool_name = ToolName::plain("Write");
    write_call.payload = ToolPayload::Function {
        arguments:
            serde_json::json!({"file_path": path.to_string_lossy(), "content": "완료\r\n終"})
                .to_string(),
    };
    assert!(write.handle(write_call.clone()).await.is_err());
    let output = read.handle(call.clone()).await.unwrap();
    read.on_tool_result_accepted(&call, output.as_ref());
    assert!(
        write
            .handle(write_call)
            .await
            .unwrap()
            .success_for_logging()
    );
    assert_eq!(std::fs::read(&path).unwrap(), "완료\r\n終".as_bytes());
    assert!(state.reads.lock().unwrap().is_empty());
}

#[tokio::test]
async fn new_file_write_uses_native_exact_bytes_without_prior_read() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("new.txt");
    let (session, turn, _events) =
        native_write_context(codex_protocol::protocol::AskForApproval::Never).await;
    let mut call = invocation_with_context(session, turn, &path, 1, 10);
    call.tool_name = ToolName::plain("Write");
    call.payload = ToolPayload::Function {
        arguments:
            serde_json::json!({"file_path": path.to_string_lossy(), "content": "新規\r\n마지막"})
                .to_string(),
    };
    let write = ClaudeFileHandler::new(
        ClaudeFileOperation::Write,
        Arc::new(ClaudeFileState::default()),
        false,
    );
    assert!(write.handle(call).await.unwrap().success_for_logging());
    assert_eq!(std::fs::read(&path).unwrap(), "新規\r\n마지막".as_bytes());
}

#[tokio::test]
async fn native_write_rejects_content_changed_while_awaiting_approval() {
    use codex_protocol::protocol::{AskForApproval, EventMsg, ReviewDecision};
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("source.txt");
    std::fs::write(&path, "before\r\n").unwrap();
    let (session, turn, events) = native_write_context(AskForApproval::UnlessTrusted).await;
    *session.active_turn.lock().await = Some(crate::state::ActiveTurn::default());
    let call = invocation_with_context(Arc::clone(&session), turn, &path, 1, 10);
    let state = Arc::new(ClaudeFileState::default());
    let read = ClaudeFileHandler::new(ClaudeFileOperation::Read, state.clone(), false);
    let output = read.handle(call.clone()).await.unwrap();
    read.on_tool_result_accepted(&call, output.as_ref());
    let mut write_call = call;
    write_call.tool_name = ToolName::plain("Write");
    write_call.payload = ToolPayload::Function {
        arguments:
            serde_json::json!({"file_path": path.to_string_lossy(), "content": "requested\r\n"})
                .to_string(),
    };
    let write = ClaudeFileHandler::new(ClaudeFileOperation::Write, state.clone(), false);
    let pending = tokio::spawn(async move { write.handle(write_call).await });
    let approval = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            if let EventMsg::ApplyPatchApprovalRequest(approval) = events.recv().await.unwrap().msg
            {
                break approval;
            }
        }
    })
    .await
    .expect("native patch approval request");
    assert!(!pending.is_finished());
    assert!(state.reads.lock().unwrap().is_empty());
    std::fs::write(&path, "external\r\n").unwrap();
    session
        .notify_approval(&approval.call_id, ReviewDecision::Approved)
        .await;
    let result = tokio::time::timeout(std::time::Duration::from_secs(10), pending)
        .await
        .unwrap()
        .unwrap();
    match result {
        Err(error) => assert!(
            error
                .to_string()
                .contains("file changed after Read or while awaiting approval")
        ),
        Ok(_) => panic!("native exact write must reject the changed preimage"),
    }
    assert_eq!(std::fs::read(&path).unwrap(), b"external\r\n");
}

#[test]
fn edit_preserves_utf8_crlf_and_rejects_ambiguous_or_empty_matches() {
    assert_eq!(
        exact_edit("안녕\r\n世界\r\n", "世界", "수정", false).unwrap(),
        "안녕\r\n수정\r\n"
    );
    assert!(exact_edit("same same", "same", "new", false).is_err());
    assert!(exact_edit("aaa", "aa", "new", false).is_err());
    assert_eq!(
        exact_edit("same same", "same", "new", true).unwrap(),
        "new new"
    );
    assert!(exact_edit("text", "", "new", true).is_err());
    assert!(exact_edit("text", "text", "text", true).is_err());
    assert!(exact_edit("text", "missing", "new", false).is_err());
}

#[tokio::test]
async fn read_stamps_only_accepted_output_and_combines_large_file_ranges() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("source.txt");
    let text: String = (0..1200)
        .map(|index| format!("line {index}: 안녕 세계 {}\r\n", "x".repeat(48)))
        .collect();
    std::fs::write(&path, &text).unwrap();
    let state = Arc::new(ClaudeFileState::default());
    let handler = ClaudeFileHandler::new(ClaudeFileOperation::Read, state.clone(), false);
    let first = invocation(&path, 1, 300).await;
    let output = handler.handle(first.clone()).await.unwrap();
    assert!(output.log_output().starts_with("1\tline 0: 안녕 세계"));
    assert!(
        state.reads.lock().unwrap().is_empty(),
        "execution alone must not stamp a Read"
    );
    handler.on_tool_result_accepted(&first, output.as_ref());
    assert!(
        !state
            .reads
            .lock()
            .unwrap()
            .values()
            .next()
            .unwrap()
            .complete()
    );
    for offset in [301, 601, 901] {
        let call = invocation(&path, offset, 300).await;
        let output = handler.handle(call.clone()).await.unwrap();
        handler.on_tool_result_accepted(&call, output.as_ref());
    }
    let reads = state.reads.lock().unwrap();
    let accepted = reads.values().next().unwrap();
    assert!(accepted.complete());
    assert_eq!(accepted.fingerprint, fingerprint(&text));
    drop(reads);
    std::fs::write(&path, text.replace("line 0:", "changed:")).unwrap();
    let call = invocation(&path, 301, 300).await;
    let output = handler.handle(call.clone()).await.unwrap();
    handler.on_tool_result_accepted(&call, output.as_ref());
    assert!(
        !state
            .reads
            .lock()
            .unwrap()
            .values()
            .next()
            .unwrap()
            .complete(),
        "changed content resets accumulated coverage"
    );
    assert!(
        ClaudeFileState::default().reads.lock().unwrap().is_empty(),
        "a different session has no accepted reads"
    );
}

#[test]
fn truncation_never_certifies_unseen_lines() {
    let text: String = (0..1000)
        .map(|index| format!("{index} {}\n", "x".repeat(100)))
        .collect();
    let (output, start, end, total) = numbered_read(&text, 1, DEFAULT_LINES);
    assert_eq!(start, 0);
    assert!(end < total);
    assert!(output.contains("[Read truncated"));
    let mut coverage = ReadCoverage {
        fingerprint: fingerprint(&text),
        total_lines: total,
        ranges: Vec::new(),
    };
    coverage.include(start, end);
    assert!(!coverage.complete());
    assert_eq!(numbered_read("", 1, DEFAULT_LINES).0, "[File is empty]\n");
}

#[tokio::test]
async fn read_rejects_missing_directory_and_non_utf8_files() {
    let tmp = tempfile::tempdir().unwrap();
    let handler = ClaudeFileHandler::new(
        ClaudeFileOperation::Read,
        Arc::new(ClaudeFileState::default()),
        false,
    );
    assert!(
        handler
            .handle(invocation(&tmp.path().join("missing"), 1, 10).await)
            .await
            .is_err()
    );
    assert!(
        handler
            .handle(invocation(tmp.path(), 1, 10).await)
            .await
            .is_err()
    );
    let binary = tmp.path().join("binary");
    std::fs::write(&binary, [0xff, 0xfe]).unwrap();
    assert!(
        handler
            .handle(invocation(&binary, 1, 10).await)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn unaccepted_or_stale_read_does_not_authorize_edit() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("source.txt");
    std::fs::write(&path, "before\r\n").unwrap();
    let state = Arc::new(ClaudeFileState::default());
    let read = ClaudeFileHandler::new(ClaudeFileOperation::Read, state.clone(), false);
    let edit = ClaudeFileHandler::new(ClaudeFileOperation::Edit, state.clone(), false);
    let call = invocation(&path, 1, 10).await;
    let output = read.handle(call.clone()).await.unwrap();
    let mut edit_call = call.clone();
    edit_call.tool_name = ToolName::plain("Edit");
    edit_call.payload = ToolPayload::Function { arguments: serde_json::json!({ "file_path": path.to_string_lossy(), "old_string": "before", "new_string": "after" }).to_string() };
    assert!(edit.handle(edit_call.clone()).await.is_err());
    read.on_tool_result_accepted(&call, output.as_ref());
    std::fs::write(&path, "external\r\n").unwrap();
    assert!(edit.handle(edit_call).await.is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "external\r\n");
}

#[tokio::test]
async fn hook_replaced_read_output_does_not_stamp_file() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("source.txt");
    std::fs::write(&path, "text\n").unwrap();
    let state = Arc::new(ClaudeFileState::default());
    let read = ClaudeFileHandler::new(ClaudeFileOperation::Read, state.clone(), false);
    let call = invocation(&path, 1, 10).await;
    let output = read.handle(call.clone()).await.unwrap();
    let replaced = ReadOutput {
        output: FunctionToolOutput::from_text("hook feedback".into(), Some(true)),
        metadata: output.tool_result_metadata().unwrap().clone(),
    };
    read.on_tool_result_accepted(&call, &replaced);
    assert!(state.reads.lock().unwrap().is_empty());
}
