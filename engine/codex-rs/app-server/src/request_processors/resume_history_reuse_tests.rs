use super::*;
use codex_protocol::models::PermissionProfile;
use codex_protocol::protocol::AskForApproval;
use codex_protocol::protocol::SessionSource;
use std::cell::Cell;

fn stored_thread() -> StoredThread {
    StoredThread {
        originator: None,
        thread_id: ThreadId::from_string("00000000-0000-0000-0000-000000000123").unwrap(),
        extra_config: None,
        rollout_path: Some(PathBuf::from("rollout.jsonl")),
        forked_from_id: None,
        parent_thread_id: None,
        preview: "preview".into(),
        name: None,
        model_provider: "openai".into(),
        model: None,
        reasoning_effort: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        recency_at: chrono::Utc::now(),
        archived_at: None,
        section: None,
        section_position: None,
        section_entered_at: None,
        project_id: None,
        daybreak_enabled: None,
        cwd: PathBuf::from("."),
        cli_version: "0.0.0".into(),
        source: SessionSource::Cli,
        history_mode: ThreadHistoryMode::Paginated,
        thread_source: None,
        agent_nickname: None,
        agent_role: None,
        agent_path: None,
        git_info: None,
        approval_mode: AskForApproval::OnRequest,
        permission_profile: PermissionProfile::read_only(),
        token_usage: None,
        first_user_message: None,
        history: None,
    }
}

fn history(stored: &StoredThread, revision: Option<&str>) -> InitialHistory {
    InitialHistory::Resumed(ResumedHistory {
        conversation_id: stored.thread_id,
        rollout_path: stored.rollout_path.clone(),
        history_revision: revision.map(str::to_owned),
        history: Arc::new(Vec::new()),
    })
}

#[tokio::test]
async fn unchanged_revision_reuses_history_without_loader_and_keeps_fresh_metadata() {
    for mode in [ThreadHistoryMode::Paginated, ThreadHistoryMode::Legacy] {
        let mut stored = stored_thread();
        stored.history_mode = mode;
        let initial = history(&stored, Some("revision"));
        let prepared = PreparedResumeHistory::new(&stored, &initial);
        stored.name = Some("fresh name".into());
        let (reused, fresh) = load_resume_history_with_prepared(
            stored,
            prepared,
            |path, revision| async move {
                assert_eq!(path, PathBuf::from("rollout.jsonl"));
                assert_eq!(revision, "revision");
                Ok(true)
            },
            |_| async { panic!("unchanged history must not call the loader") },
        )
        .await
        .unwrap();
        let (InitialHistory::Resumed(initial), InitialHistory::Resumed(reused)) = (initial, reused)
        else {
            panic!("expected resumed history");
        };
        assert!(Arc::ptr_eq(&initial.history, &reused.history));
        assert_eq!(fresh.name.as_deref(), Some("fresh name"));
        assert_eq!(reused.history_revision.as_deref(), Some("revision"));
    }
}

#[tokio::test]
async fn changed_or_unverifiable_revision_falls_back_to_loader() {
    for validation in [
        Ok(false), // Changed, absent, or unrecognized store revision.
        Err(ThreadStoreError::Internal {
            message: "revision lookup failed".into(),
        }),
    ] {
        let stored = stored_thread();
        let prepared = PreparedResumeHistory::new(&stored, &history(&stored, Some("revision")));
        let loads = Cell::new(0);
        let (loaded, _) = load_resume_history_with_prepared(
            stored,
            prepared,
            |_, _| async move { validation },
            |stored| async {
                loads.set(loads.get() + 1);
                Ok((history(&stored, Some("fresh")), stored))
            },
        )
        .await
        .unwrap();
        assert_eq!(loads.get(), 1);
        let InitialHistory::Resumed(loaded) = loaded else {
            panic!("expected loaded history");
        };
        assert_eq!(loaded.history_revision.as_deref(), Some("fresh"));
    }
}

#[tokio::test]
async fn changed_id_path_or_mode_bypasses_validation_and_loads_fresh_history() {
    for change in 0..4 {
        let mut stored = stored_thread();
        let prepared = PreparedResumeHistory::new(&stored, &history(&stored, Some("revision")));
        match change {
            0 => {
                stored.thread_id =
                    ThreadId::from_string("00000000-0000-0000-0000-000000000456").unwrap();
            }
            1 => stored.rollout_path = Some(PathBuf::from("other.jsonl")),
            2 => stored.rollout_path = None,
            _ => stored.history_mode = ThreadHistoryMode::Legacy,
        }
        let loads = Cell::new(0);
        load_resume_history_with_prepared(
            stored,
            prepared,
            |_, _| async { panic!("different source must not validate old revision") },
            |stored| async {
                loads.set(loads.get() + 1);
                Ok((history(&stored, Some("fresh")), stored))
            },
        )
        .await
        .unwrap();
        assert_eq!(loads.get(), 1);
    }
}

#[tokio::test]
async fn absent_prepared_revision_loads_fresh_history() {
    let stored = stored_thread();
    let prepared = PreparedResumeHistory::new(&stored, &history(&stored, None));
    assert!(prepared.is_none());
    let loads = Cell::new(0);
    load_resume_history_with_prepared(
        stored,
        prepared,
        |_, _| async { panic!("missing revision must not be validated") },
        |stored| async {
            loads.set(loads.get() + 1);
            Ok((history(&stored, Some("fresh")), stored))
        },
    )
    .await
    .unwrap();
    assert_eq!(loads.get(), 1);
}
