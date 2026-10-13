use std::sync::Arc;

use super::run_auto_compact;
use crate::session::session::SessionSettingsUpdate;
use crate::session::step_context::StepContext;
use crate::session::tests::build_world_state_from_turn_context;
use crate::session::tests::make_session_and_context_with_rx;
use crate::session::tests::make_session_configuration_for_tests;
use crate::session::tests::test_model_client_session;
use crate::session::thread_settings::initial_auto_compaction_enabled;
use codex_analytics::CompactionPhase;
use codex_analytics::CompactionReason;
use codex_features::Feature;
use codex_history::InitialHistory;
use codex_history::ResumedHistory;
use codex_history::RolloutItem;
use codex_protocol::ThreadId;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::ThreadSettingsAppliedEvent;
use codex_protocol::protocol::ThreadSettingsOverrides;

#[tokio::test]
async fn auto_compaction_defaults_and_sparse_updates_preserve_thread_setting() {
    let configuration = make_session_configuration_for_tests().await;
    assert!(configuration.auto_compaction_enabled);
    let update = crate::session::thread_settings::prepare_update(
        ThreadSettingsOverrides {
            auto_compaction_enabled: Some(false),
            ..Default::default()
        },
        &[],
    );
    let disabled = configuration
        .apply(&update, &configuration.environments)
        .unwrap();
    assert!(!disabled.auto_compaction_enabled);
    let unchanged = disabled
        .apply(&SessionSettingsUpdate::default(), &disabled.environments)
        .unwrap();
    assert!(!unchanged.auto_compaction_enabled);
    let enabled = unchanged
        .apply(
            &SessionSettingsUpdate {
                auto_compaction_enabled: Some(true),
                ..Default::default()
            },
            &unchanged.environments,
        )
        .unwrap();
    assert!(enabled.auto_compaction_enabled);
}

#[tokio::test]
async fn auto_compaction_resume_restores_only_own_latest_setting_and_forks_default_on() {
    let configuration = make_session_configuration_for_tests().await;
    let mut snapshot = configuration.thread_settings_snapshot(&configuration.environments);
    snapshot.auto_compaction_enabled = false;
    let owner = ThreadId::new();
    let foreign = ThreadId::new();
    let owned = RolloutItem::EventMsg(EventMsg::ThreadSettingsApplied(
        ThreadSettingsAppliedEvent {
            thread_id: Some(owner),
            thread_settings: snapshot.clone(),
        },
    ));
    let foreign_item = RolloutItem::EventMsg(EventMsg::ThreadSettingsApplied(
        ThreadSettingsAppliedEvent {
            thread_id: Some(foreign),
            thread_settings: snapshot.clone(),
        },
    ));
    let resumed = |items| {
        InitialHistory::Resumed(ResumedHistory {
            conversation_id: owner,
            history: Arc::new(items),
            history_revision: None,
            rollout_path: None,
        })
    };
    assert!(initial_auto_compaction_enabled(&InitialHistory::New));
    assert!(initial_auto_compaction_enabled(&InitialHistory::Cleared));
    assert!(initial_auto_compaction_enabled(&resumed(vec![])));
    assert!(initial_auto_compaction_enabled(&resumed(vec![
        foreign_item.clone()
    ])));
    assert!(!initial_auto_compaction_enabled(&resumed(vec![
        owned.clone(),
        foreign_item
    ])));
    assert!(initial_auto_compaction_enabled(&InitialHistory::Forked(
        vec![owned.clone()]
    )));
    snapshot.auto_compaction_enabled = true;
    let enabled = RolloutItem::EventMsg(EventMsg::ThreadSettingsApplied(
        ThreadSettingsAppliedEvent {
            thread_id: Some(owner),
            thread_settings: snapshot,
        },
    ));
    assert!(initial_auto_compaction_enabled(&resumed(vec![
        owned, enabled
    ])));
}

#[tokio::test]
async fn auto_compaction_legacy_snapshot_defaults_on_and_explicit_off_round_trips() {
    let configuration = make_session_configuration_for_tests().await;
    let snapshot = configuration.thread_settings_snapshot(&configuration.environments);
    let mut json = serde_json::to_value(snapshot).unwrap();
    json.as_object_mut()
        .unwrap()
        .remove("auto_compaction_enabled");
    let legacy: codex_protocol::protocol::ThreadSettingsSnapshot =
        serde_json::from_value(json.clone()).unwrap();
    assert!(legacy.auto_compaction_enabled);
    json["auto_compaction_enabled"] = serde_json::json!(false);
    let off: codex_protocol::protocol::ThreadSettingsSnapshot =
        serde_json::from_value(json).unwrap();
    assert!(!off.auto_compaction_enabled);
    assert_eq!(
        serde_json::to_value(off).unwrap()["auto_compaction_enabled"],
        false
    );
}

#[tokio::test]
async fn auto_compaction_disabled_blocks_every_reason_and_phase_without_replacing_history() {
    let (session, turn, _rx) = make_session_and_context_with_rx().await;
    let step = Arc::new(StepContext::for_test(turn));
    // Capture the step first: changing a thread while its turn is active takes effect immediately.
    session
        .update_settings(SessionSettingsUpdate {
            auto_compaction_enabled: Some(false),
            ..Default::default()
        })
        .await
        .unwrap();
    let before = session.history_reset().await.0;
    let mut client = test_model_client_session();
    for reason in [
        CompactionReason::ContextLimit,
        CompactionReason::ModelDownshift,
        CompactionReason::CompHashChanged,
    ] {
        for phase in [
            CompactionPhase::PreTurn,
            CompactionPhase::MidTurn,
            CompactionPhase::PostTurn,
        ] {
            assert!(
                !run_auto_compact(
                    &session,
                    Arc::clone(&step),
                    Arc::clone(&step),
                    &mut client,
                    reason,
                    phase
                )
                .await
                .unwrap()
            );
        }
    }
    assert_eq!(session.history_reset().await.0, before);
    assert!(
        !session
            .thread_config_snapshot()
            .await
            .auto_compaction_enabled
    );
}

#[tokio::test]
async fn auto_compaction_off_preserves_manual_token_budget_compaction() {
    let (session, turn, _rx) = make_session_and_context_with_rx().await;
    session
        .update_settings(SessionSettingsUpdate {
            auto_compaction_enabled: Some(false),
            ..Default::default()
        })
        .await
        .unwrap();
    let before = session.history_reset().await.0;
    let world_state = Arc::new(build_world_state_from_turn_context(&session, &turn).await);
    let step = Arc::new(StepContext::for_test(turn));
    crate::compact_token_budget::run_manual_compact_task(Arc::clone(&session), step, world_state)
        .await
        .unwrap();
    assert!(session.history_reset().await.0 > before);
    assert!(!session.auto_compaction_enabled().await);
}

#[tokio::test]
async fn auto_compaction_off_does_not_claim_token_budget_fallback() {
    let (session, turn, _rx) = make_session_and_context_with_rx().await;
    let mut turn = turn;
    let turn = Arc::get_mut(&mut turn).expect("turn is not shared");
    let config = Arc::make_mut(&mut turn.config);
    config.features.enable(Feature::TokenBudget).unwrap();
    config.token_budget = Some(crate::config::TokenBudgetConfig {
        auto_compact_fallback_prompt: Some("save context and roll over".into()),
        ..Default::default()
    });
    session
        .update_settings(SessionSettingsUpdate {
            auto_compaction_enabled: Some(false),
            ..Default::default()
        })
        .await
        .unwrap();
    let before = session.clone_history().await.raw_items().count();
    crate::session::token_budget::maybe_record(&session, turn, Some(0), true).await;
    assert_eq!(session.clone_history().await.raw_items().count(), before);
    session
        .update_settings(SessionSettingsUpdate {
            auto_compaction_enabled: Some(true),
            ..Default::default()
        })
        .await
        .unwrap();
    crate::session::token_budget::maybe_record(&session, turn, Some(0), true).await;
    assert!(session.clone_history().await.raw_items().count() > before);
}

#[tokio::test]
async fn auto_compaction_context_policy_records_live_setting_without_changing_threshold() {
    let (session, turn, _rx) = make_session_and_context_with_rx().await;
    let prompt = crate::client_common::Prompt::default();
    session
        .record_input_context_policy(&turn, turn.model_info(), &prompt)
        .await;
    let original = session
        .state
        .lock()
        .await
        .token_info()
        .unwrap()
        .context_policy
        .unwrap();
    session
        .update_settings(SessionSettingsUpdate {
            auto_compaction_enabled: Some(false),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(
        !session
            .state
            .lock()
            .await
            .token_info()
            .unwrap()
            .context_policy
            .unwrap()
            .auto_compaction_enabled
    );
    session
        .record_input_context_policy(&turn, turn.model_info(), &prompt)
        .await;
    let disabled = session
        .state
        .lock()
        .await
        .token_info()
        .unwrap()
        .context_policy
        .unwrap();
    assert!(!disabled.auto_compaction_enabled);
    assert_eq!(
        original.auto_compact_token_limit,
        disabled.auto_compact_token_limit
    );
    assert_eq!(original.safe_context_window, disabled.safe_context_window);
}

#[tokio::test]
async fn auto_compaction_off_preserves_quota_error_without_account_recovery() {
    let (session, turn, _rx) = make_session_and_context_with_rx().await;
    session
        .update_settings(SessionSettingsUpdate {
            auto_compaction_enabled: Some(false),
            ..Default::default()
        })
        .await
        .unwrap();
    let before = session.history_reset().await.0;
    assert!(
        !crate::session::account_recovery::recover(
            &session,
            &turn,
            None,
            &tokio_util::sync::CancellationToken::new()
        )
        .await
        .unwrap()
    );
    assert_eq!(session.history_reset().await.0, before);
    assert!(turn.exhausted_accounts.lock().await.is_empty());
}
