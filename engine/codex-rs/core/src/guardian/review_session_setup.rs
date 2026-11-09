//! Captures action-time parent context and starts or recovers its Guardian reviewer.
//! Checkpoint recovery allows one fresh attempt under the original review deadline.
//! Both attempts share captured context and use separate recovery flags.

use std::sync::atomic::AtomicBool;

use super::*;
use crate::guardian::input_budget::CheckpointRecovery;
use codex_guardian_reviewer::ReviewerPool;
use codex_guardian_reviewer::ReviewerRequest;
use codex_protocol::protocol::TurnEnvironmentSelection;

/// Controls whether selection may reuse a session or must start from the parent checkpoint.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ReviewerSelection {
    ReuseIfAvailable,
    FreshParentCheckpoint,
}

#[derive(Clone)]
pub struct PreparedGuardianContext {
    parent: Arc<Session>,
    context: GuardianReviewContext,
    config: Config,
    service_reviewer: Option<Arc<super::super::reviewer_config::ServiceReviewer>>,
    context_policy: ReviewContextPolicy,
    key: GuardianReviewSessionReuseKey,
    parent_compaction: Option<ResponseItem>,
    reviewer_selection: ReviewerSelection,
    pub history_reset: CancellationToken,
}

impl PreparedGuardianContext {
    async fn prepare(
        parent: Arc<Session>,
        context: GuardianReviewContext,
        config: Config,
        history: &ContextManager,
        node_repl_policy: &GuardianNodeReplPolicy,
        service_reviewer: Option<Arc<super::super::reviewer_config::ServiceReviewer>>,
    ) -> anyhow::Result<Self> {
        let (reset_version, history_reset) = parent.history_reset().await;
        // Preparation may have raced with a history reset before capturing the reviewer context.
        if reset_version != history.reset_version {
            history_reset.cancel();
        }
        let context_mode =
            GuardianContextMode::from_history(history.conversation_history_snapshot().as_ref());
        let context_policy = ReviewContextPolicy::for_context(context_mode, &config.features);
        let root_review_version = context_policy.root_review_version(&parent).await;
        let parent_compaction = if service_reviewer.is_some() {
            None
        } else {
            context_policy.parent_compaction(history)?
        };
        let mut key = GuardianReviewSessionReuseKey::from_spawn_config(
            &config,
            parent.inherited_instructions().await,
            history.history_version(),
            context_mode,
        )
        .with_environments(context.environments())
        .with_node_repl_policy_eligibility(context.model_info.computer_use_review_required())
        .with_node_repl_policy(node_repl_policy);
        key.root_review_version = root_review_version;
        key.parent_reset_version = history.reset_version;
        key.service_identity = service_reviewer.as_ref().map(|service| {
            (
                service.binding.profile.id().to_owned(),
                service.binding.selection.revision,
            )
        });
        Ok(Self {
            parent,
            context,
            config,
            service_reviewer,
            context_policy,
            key,
            parent_compaction,
            reviewer_selection: ReviewerSelection::ReuseIfAvailable,
            history_reset,
        })
    }
}

impl PreparedGuardianContext {
    pub fn reuse_key(
        &self,
        previous: Option<&GuardianReviewSession>,
    ) -> GuardianReviewSessionReuseKey {
        let mut key = self.key.clone();
        if self.context_policy != ReviewContextPolicy::ThreadOwned
            && self.parent_compaction.is_none()
            && let Some(previous) = previous
        {
            // Without a decryptable summary, the existing reviewer may hold the
            // only remaining authorization or restriction from parent history.
            key.parent_history_version = previous.reuse_key.parent_history_version;
        }
        key
    }

    /// Moves fork history into startup options and retains only its context bookkeeping.
    /// Guardian selects the agent's identity and lifecycle.
    pub async fn thread_options(
        &self,
        snapshot: Option<GuardianReviewForkSnapshot>,
    ) -> (crate::StartThreadOptions, GuardianReviewState) {
        let snapshot = snapshot.filter(|_| {
            self.service_reviewer.is_none()
                && self.reviewer_selection == ReviewerSelection::ReuseIfAvailable
        });
        let (mut conversation, mut history) = snapshot.map(ConversationState::fork).unzip();
        if self.parent_compaction.is_some()
            && conversation
                .as_ref()
                .is_some_and(|state| state.cursor().is_none())
        {
            // A compacted fork has no valid transcript progress. Prefer the
            // captured parent checkpoint to its lossy reviewer summary.
            conversation = None;
            history = None;
        }
        let state = GuardianReviewState {
            conversation: conversation.unwrap_or_default(),
            fresh_parent_checkpoint: history.is_none() && self.parent_compaction.is_some(),
            transcript_history_version: 0,
            transcript_source: history
                .as_ref()
                .and_then(|history| history.transcript_source),
            last_admitted_node_repl_response_sequence: history.as_ref().map_or(0, |history| {
                history.last_admitted_node_repl_response_sequence
            }),
            pending_node_repl_evidence_admission: None,
        };
        let initial_history = history.map(|history| history.initial_history).or_else(|| {
            self.parent_compaction
                .clone()
                .map(|item| InitialHistory::Forked(vec![RolloutItem::ResponseItem(item.into())]))
        });
        let mut config = self.config.clone();
        if self.service_reviewer.is_none() {
            config.model_provider.supports_websockets &= self
                .parent
                .services
                .model_client
                .responses_websocket_enabled();
        }
        let options = crate::StartThreadOptions {
            models_manager: self
                .service_reviewer
                .as_ref()
                .map(|service| Arc::clone(&service.models)),
            history_mode: Some(codex_protocol::protocol::ThreadHistoryMode::Paginated),
            internal_parent: Some(crate::thread_manager::InternalSessionParent {
                thread_id: self.parent.thread_id(),
                auth_manager: self.service_reviewer.as_ref().map_or_else(
                    || Arc::clone(&self.parent.services.auth_manager),
                    |service| service.binding.manager(),
                ),
                agent_control: crate::agent::control::AgentControlInit::Provided {
                    control: Arc::clone(&self.parent.services.agent_control),
                    runtime: self.parent.services.local_agent_runtime.clone(),
                },
                originator: self.context.turn().originator.clone(),
                // Review the same applied instructions captured by the reuse key.
                // A live provider could advance independently while reviewing this action.
                inherited_instructions: Some(SessionInstructions {
                    user: self.key.user_instructions.clone(),
                    thread: self.key.thread_instructions.clone(),
                    ..Default::default()
                }),
            }),
            initial_history: initial_history.unwrap_or(InitialHistory::New),
            environments: Some(
                self.context
                    .environments()
                    .to_selections()
                    .into_iter()
                    .map(TurnEnvironmentSelection::into_request)
                    .collect(),
            ),
            inherited_environments: Some(self.context.environments().clone()),
            client_mcp_extensions: self.parent.services.client_mcp_extensions.clone(),
            ..crate::StartThreadOptions::new(config)
        };
        (options, state)
    }

    /// Binds context bookkeeping to an agent that Guardian has already started.
    pub async fn bind_thread(
        &self,
        thread: &crate::CodexThread,
        context: GuardianReviewSessionReuseKey,
        mut state: GuardianReviewState,
        cancellation: CancellationToken,
    ) -> GuardianReviewSession {
        let session = Arc::clone(&thread.session);
        let io = SessionIo {
            tx_sub: thread.io.tx_sub.clone(),
            rx_event: thread.io.rx_event.clone(),
            agent_status: thread.io.agent_status.clone(),
            session_loop_termination: thread.io.session_loop_termination.clone(),
        };
        let inherited = session.inherited_instructions().await;
        {
            let history = session.clone_history().await;
            state.transcript_history_version = history.history_version();
            state.fresh_parent_checkpoint &= self
                .parent_compaction
                .as_ref()
                .zip(codex_history::CompactionCheckpoint::latest(
                    history.annotated_items(),
                ))
                .is_some_and(|(parent, loaded)| parent == loaded.item);
        }
        let context = GuardianReviewSessionReuseKey {
            user_instructions: inherited.user,
            thread_instructions: inherited.thread,
            ..context
        };
        crate::session::emit_subagent_session_started(
            &self.parent.services.analytics_events_client,
            self.parent.app_server_client_metadata().await,
            session.session_id(),
            session.thread_id(),
            Some(self.parent.thread_id()),
            session.thread_config_snapshot().await,
            SubAgentSource::Other(GUARDIAN_REVIEWER_NAME.to_owned()),
            /*resumed_created_at*/ None,
        );
        GuardianReviewSession {
            session,
            io,
            cancel_token: cancellation,
            reuse_key: context,
            state: Mutex::new(state),
        }
    }
}

#[derive(Clone)]
pub(super) struct PreparedReview {
    context: Arc<PreparedGuardianContext>,
    params: Arc<GuardianReviewSessionParams>,
    recovery_requested: Arc<AtomicBool>,
}

impl ReviewerRequest for PreparedReview {
    type Session = GuardianReviewSession;

    fn setup(&self) -> Arc<PreparedGuardianContext> {
        Arc::clone(&self.context)
    }
    fn context(&self, previous: Option<&GuardianReviewSession>) -> GuardianReviewSessionReuseKey {
        self.context.reuse_key(previous)
    }
    fn requires_fresh_session(&self) -> bool {
        self.context.service_reviewer.is_some()
            || self.context.reviewer_selection == ReviewerSelection::FreshParentCheckpoint
    }
    fn deadline(&self) -> tokio::time::Instant {
        self.params.deadline
    }
    fn cancellation(&self) -> Option<&CancellationToken> {
        self.params.external_cancel.as_ref()
    }

    async fn run(
        &self,
        session: &GuardianReviewSession,
        kind: GuardianReviewSessionKind,
    ) -> ReviewSessionResult {
        // A prewarmed session can already be fresh on the initial attempt. Consume
        // this before running: even a failed review can leave new input in history.
        let fresh_parent_checkpoint =
            std::mem::take(&mut session.state.lock().await.fresh_parent_checkpoint);
        if self.context.parent_compaction.is_some() {
            session
                .session
                .services
                .thread_extension_data
                .insert(CheckpointRecovery {
                    requested: Arc::clone(&self.recovery_requested),
                    history_version: session.session.clone_history().await.history_version(),
                    fresh_parent_checkpoint,
                });
        } else {
            session
                .session
                .services
                .thread_extension_data
                .remove::<CheckpointRecovery>();
        }
        let mut result = Box::pin(run_review_on_session(
            session,
            &self.params,
            kind,
            self.params.deadline,
        ))
        .await;
        if let Some(service) = self.context.service_reviewer.as_ref() {
            // Every service review retires its private session; policy and account
            // selection are resolved anew for the next logical request.
            result.disposition = SessionDisposition::Discard;
            let unavailable = !matches!(
                service.binding.profile.status(),
                Ok(codex_login::AzraelProfileStatus::Available)
            );
            if unavailable
                || matches!(
                    &result.outcome,
                    GuardianReviewSessionOutcome::SessionFailed { .. }
                        | GuardianReviewSessionOutcome::PromptBuildFailed(_)
                        | GuardianReviewSessionOutcome::Completed(Err(_))
                )
            {
                result.outcome = GuardianReviewSessionOutcome::SessionFailed {
                    error: anyhow::anyhow!("Guardian OpenAI service review is unavailable"),
                    error_info: None,
                    retry_at: None,
                };
            }
        }
        let recovery_requested = self.recovery_requested.load(Ordering::Acquire);
        if recovery_requested {
            result.disposition = SessionDisposition::Discard;
        }
        if self.context.reviewer_selection == ReviewerSelection::FreshParentCheckpoint
            || !recovery_requested
        {
            record_failed_review(&session.session, &self.params, &result.outcome).await;
        }
        result
    }
}

pub(crate) async fn run_guardian_review_session(
    pool: Arc<ReviewerPool<GuardianReviewSession>>,
    params: GuardianReviewSessionParams,
) -> (GuardianReviewSessionOutcome, GuardianReviewAnalyticsResult) {
    let context_mode = GuardianContextMode::from_history(
        params
            .parent_history
            .conversation_history_snapshot()
            .as_ref(),
    );
    let (outcome, mut analytics) = match prepare_review(params).await {
        Ok(mut prepared) => {
            let result = pool.review(prepared.clone()).await;
            if prepared.recovery_requested.load(Ordering::Acquire) {
                // One restart only, under the original deadline. An oversized parent
                // checkpoint must fail rather than repeatedly compact and recreate.
                Arc::make_mut(&mut prepared.context).reviewer_selection =
                    ReviewerSelection::FreshParentCheckpoint;
                prepared.recovery_requested = Arc::default();
                pool.review(prepared).await
            } else {
                result
            }
        }
        Err(error) => (
            GuardianReviewSessionOutcome::PromptBuildFailed(error),
            GuardianReviewAnalyticsResult::without_session(),
        ),
    };
    // Keep the captured mode even when preparation or reviewer startup fails.
    analytics.guardian_context_mode = Some(context_mode.as_str());
    (outcome, analytics)
}

pub(super) async fn prepare_review(
    mut params: GuardianReviewSessionParams,
) -> anyhow::Result<PreparedReview> {
    if params.service_reviewer.is_some() {
        params.parent_history = service_review_history(&params.parent_history)?;
    }
    let context = PreparedGuardianContext::prepare(
        Arc::clone(&params.parent_session),
        params.parent_context.clone(),
        params.spawn_config.clone(),
        &params.parent_history,
        &params.node_repl_policy,
        params.service_reviewer.clone(),
    )
    .await?;
    Ok(PreparedReview {
        context: Arc::new(context),
        params: Arc::new(params),
        recovery_requested: Arc::default(),
    })
}

/// Captures the same startup context used by the existing prompt builder.
/// The caller owns scheduling, cancellation, and the reviewer pool.
pub async fn prepare_review_prewarm(
    parent: &crate::CodexThread,
) -> anyhow::Result<PreparedGuardianContext> {
    let turn = parent
        .session
        .new_startup_prewarm_turn_with_sub_id(crate::session::INITIAL_SUBMIT_ID.to_owned())
        .await;
    prepare_prewarm(Arc::clone(&parent.session), turn).await
}

pub(super) fn prepare_prewarm(
    parent: Arc<Session>,
    turn: Arc<TurnContext>,
) -> BoxFuture<'static, anyhow::Result<PreparedGuardianContext>> {
    Box::pin(async move {
        let context = GuardianReviewContext::from(turn);
        let config = guardian_review_session_config(&parent, &context).await?;
        let mut history = parent.clone_history().await;
        if config.service_reviewer.is_some() {
            history = service_review_history(&history)?;
        }
        PreparedGuardianContext::prepare(
            Arc::clone(&parent),
            context,
            config.spawn_config,
            &history,
            &config.node_repl_policy,
            config.service_reviewer,
        )
        .await
    })
}

/// Reuses provider handoff's public-message/exact-call projection on a snapshot.
/// An opaque checkpoint cannot establish complete authorization across providers.
fn service_review_history(history: &ContextManager) -> anyhow::Result<ContextManager> {
    anyhow::ensure!(
        codex_history::CompactionCheckpoint::latest(history.annotated_items()).is_none(),
        "Guardian cannot safely review opaque parent context with the OpenAI service account"
    );
    let public = crate::session::public_provider_history(history.annotated_items());
    anyhow::ensure!(
        !public.is_empty(),
        "Guardian public conversation context is unavailable"
    );
    let mut projected = history.clone();
    projected.replace_annotated(public);
    // This copy changes evidence, not the parent's reset identity.
    projected.reset_version = history.reset_version;
    Ok(projected)
}

#[cfg(test)]
mod service_history_tests {
    use super::*;
    use codex_login::test_support::fixture_chatgpt_auth;

    // Detect accidentally dropping the auth/catalog override in future changes to
    // Guardian setup or ThreadManager's actual session spawn argument forwarding.
    #[tokio::test]
    async fn service_reviewer_spawn_pins_account_and_catalog_across_main_switch() {
        let home = tempfile::tempdir().unwrap();
        let (parent, turn, _events) =
            crate::session::tests::make_session_and_context_with_auth_and_config_and_rx(
                codex_login::CodexAuth::from_api_key("parent-only-credential"),
                Vec::new(),
                |config| {
                    config.codex_home =
                        codex_utils_absolute_path::AbsolutePathBuf::from_absolute_path(home.path()).unwrap();
                    config.sqlite =
                        codex_state::SqliteConfig::new_for_testing(config.codex_home.clone());
                    config.model_provider_id = "anthropic".to_owned();
                    config.model_provider.name = "Anthropic".to_owned();
                },
            )
            .await;
        let parent_config = turn.config.clone();
        let parent_auth = Arc::clone(&parent.services.auth_manager);
        let parent_models = Arc::clone(&parent.services.models_manager);
        let user: ResponseItem = serde_json::from_value(serde_json::json!({
            "type":"message", "role":"user", "content":[{"type":"input_text","text":"Inspect only"}]
        }))
        .unwrap();
        parent
            .record_conversation_items(&turn, turn.model_info(), &[user])
            .await;
        let history = parent.clone_history().await;
        let accounts = codex_login::test_support::EphemeralServiceAccounts::new(home.path());
        let profile_a = accounts
            .create(&parent_auth, &fixture_chatgpt_auth("service-A"))
            .await
            .unwrap();
        let profile_b = accounts
            .create(&parent_auth, &fixture_chatgpt_auth("service-B"))
            .await
            .unwrap();
        accounts
            .selection
            .select(Some(profile_a.id().to_owned()))
            .unwrap();
        let binding_a = Arc::new(accounts.resolve(&parent_auth).await.unwrap());

        async fn prepare_bound(
            parent: Arc<Session>,
            turn: Arc<TurnContext>,
            history: &ContextManager,
            binding: Arc<codex_login::AzraelServiceAccountBinding>,
        ) -> PreparedGuardianContext {
            let mut config =
                crate::guardian::reviewer_config::openai_service_base_config(&turn.config);
            config.model = Some("service-review-only".to_owned());
            config.azrael_service_account = Some(Arc::clone(&binding));
            config = crate::guardian::test_host::build_reviewer_config(&config).unwrap();
            let models: codex_models_manager::manager::SharedModelsManager =
                Arc::new(codex_models_manager::manager::StaticModelsManager::new(
                    Some(binding.manager()),
                    codex_protocol::openai_models::ModelsResponse {
                        models: vec![codex_models_manager::model_info::model_info_from_slug(
                            "service-review-only",
                        )],
                    },
                ));
            PreparedGuardianContext::prepare(
                parent,
                GuardianReviewContext::from(turn),
                config,
                history,
                &GuardianNodeReplPolicy::from_messages(
                    codex_prompts::ResolvedModelMessages::bundled(),
                ),
                Some(Arc::new(
                    crate::guardian::reviewer_config::ServiceReviewer { binding, models },
                )),
            )
            .await
            .unwrap()
        }

        let prepared_a =
            prepare_bound(Arc::clone(&parent), Arc::clone(&turn), &history, binding_a).await;
        // Reuse the established in-memory event fixture: no model inference.
        // Switch main only after A's review turn is accepted, then deliver A's
        // result. Selection changes must neither reject nor restart that review.
        let mut params = super::super::tests::test_review_params().await;
        params.parent_session = Arc::clone(&parent);
        params.parent_context = GuardianReviewContext::from(Arc::clone(&turn));
        params.parent_history = history.clone();
        params.spawn_config = prepared_a.config.clone();
        params.service_reviewer = prepared_a.service_reviewer.clone();
        params.review_model.model = "service-review-only".to_owned();
        let active = PreparedReview {
            context: Arc::new(prepared_a.clone()),
            params: Arc::new(params),
            recovery_requested: Arc::default(),
        };
        let (mut reviewer, events, submissions) = super::super::tests::test_review_session().await;
        reviewer.reuse_key = prepared_a.key.clone();
        let review = tokio::spawn(async move {
            active
                .run(&reviewer, GuardianReviewSessionKind::TrunkNew)
                .await
        });
        let submission = submissions.recv().await.unwrap();
        let id = submission.id;
        let Op::TurnInput { reply, .. } = submission.op else {
            panic!("expected review turn");
        };
        reply
            .send(Ok(
                codex_protocol::turn_input::TurnInputSubmission::Started {
                    root_turn_id: id.clone(),
                    turn_id: id.clone(),
                },
            ))
            .unwrap();
        accounts
            .selection
            .select(Some(profile_b.id().to_owned()))
            .unwrap();
        let binding_b = Arc::new(accounts.resolve(&parent_auth).await.unwrap());
        let prepared_b =
            prepare_bound(Arc::clone(&parent), Arc::clone(&turn), &history, binding_b).await;
        events
            .send(super::super::tests::turn_complete_event(
                &id,
                Some("review-A-finished"),
                None,
            ))
            .await
            .unwrap();
        let finished = review.await.unwrap();
        assert!(
            matches!(finished.outcome, GuardianReviewSessionOutcome::Completed(Ok(Some(ref value))) if value == "review-A-finished")
        );
        assert_eq!(finished.disposition, SessionDisposition::Discard);
        assert!(
            submissions.try_recv().is_err(),
            "main switch must not resubmit A"
        );
        assert_ne!(prepared_a.key, prepared_b.key);
        let manager = crate::ThreadManager::with_models_provider_and_home_for_tests(
            codex_login::CodexAuth::from_api_key("parent-manager-credential"),
            parent_config.model_provider.clone(),
            home.path().to_path_buf(),
            Arc::new(codex_exec_server::EnvironmentManager::default_for_tests()),
        );
        for (prepared, account) in [(&prepared_a, "service-A"), (&prepared_b, "service-B")] {
            let service = prepared.service_reviewer.as_ref().unwrap();
            let (mut options, _) = prepared.thread_options(None).await;
            options.session_source = Some(SessionSource::Internal(
                codex_protocol::protocol::InternalSessionSource::Guardian,
            ));
            options.config.ephemeral = true;
            let spawned = manager.start_thread(options).await.unwrap();
            let session = &spawned.thread.session;
            assert!(Arc::ptr_eq(
                &session.services.auth_manager,
                &service.binding.manager()
            ));
            assert!(Arc::ptr_eq(
                &session.services.models_manager,
                &service.models
            ));
            assert_eq!(
                session
                    .services
                    .auth_manager
                    .auth()
                    .await
                    .unwrap()
                    .get_account_id()
                    .as_deref(),
                Some(account)
            );
            let actual = session.get_config().await;
            assert_eq!(actual.model_provider_id, "openai");
            assert!(actual.model_provider.is_openai());
            assert_eq!(actual.model.as_deref(), Some("service-review-only"));
            let catalog = session
                .services
                .models_manager
                .list_models(
                    codex_models_manager::manager::RefreshStrategy::Offline,
                    actual.http_client_factory(),
                )
                .await;
            assert!(
                catalog
                    .iter()
                    .any(|model| model.model == "service-review-only")
            );
            assert_eq!(
                service.binding.profile.status().unwrap(),
                codex_login::AzraelProfileStatus::Available
            );
            spawned.thread.shutdown_and_wait().await.unwrap();
        }
        assert!(Arc::ptr_eq(&parent.services.auth_manager, &parent_auth));
        assert!(Arc::ptr_eq(&parent.services.models_manager, &parent_models));
        assert_eq!(parent.get_config().await.model_provider_id, "anthropic");
        assert_eq!(turn.config.model_provider, parent_config.model_provider);
        assert_eq!(
            parent
                .clone_history()
                .await
                .raw_items()
                .cloned()
                .collect::<Vec<_>>(),
            history.raw_items().cloned().collect::<Vec<_>>()
        );
    }

    // Retain this boundary check: reusing parent history directly in a future
    // reviewer refactor would disclose private provider state or lose call IDs.
    #[test]
    fn service_history_projects_public_evidence_without_mutating_parent() {
        let items = serde_json::from_value::<Vec<ResponseItem>>(serde_json::json!([
            {"type":"message", "role":"user", "content":[{"type":"input_text", "text":"Inspect only"}]},
            {"type":"reasoning", "summary":[], "encrypted_content":"private-state"},
            {"type":"function_call", "name":"shell", "call_id":"exact-call-id", "arguments":"{\"command\":\"git status\"}", "encrypted_function_args":["private-args"]},
            {"type":"function_call_output", "call_id":"exact-call-id", "output":"clean"}
        ])).unwrap();
        let mut history = ContextManager::new();
        history.replace(items.clone());
        let projected = service_review_history(&history).unwrap();
        assert_eq!(history.raw_items().cloned().collect::<Vec<_>>(), items);
        let public = projected.raw_items().cloned().collect::<Vec<_>>();
        assert_eq!(public.len(), 3);
        assert!(matches!(&public[1], ResponseItem::FunctionCall {
            call_id, arguments, encrypted_function_args: None, ..
        } if call_id == "exact-call-id" && arguments == "{\"command\":\"git status\"}"));
        assert!(matches!(&public[2], ResponseItem::FunctionCallOutput {
            call_id: Some(call_id), ..
        } if call_id == "exact-call-id"));
        assert_eq!(projected.reset_version, history.reset_version);

        history.replace(vec![
            serde_json::from_value(serde_json::json!({
                "type":"compaction", "encrypted_content":"opaque-checkpoint"
            }))
            .unwrap(),
        ]);
        assert!(service_review_history(&history).is_err());
        assert!(service_review_history(&ContextManager::new()).is_err());
    }
}
