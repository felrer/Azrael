//! Regression tests for cloud cache generation isolation and late completion.

use super::*;
use crate::catalog::SkillResourceId;
use crate::catalog::SkillSearchResult;
use crate::provider::SkillProvider;
use crate::provider::SkillProviderFuture;
use crate::provider::SkillReadContext;
use crate::provider::SkillSearchRequest;
use codex_mcp::McpRuntime;
use pretty_assertions::assert_eq;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::Ordering;
use tokio::sync::Notify;

#[derive(Default)]
struct Provider {
    reads: AtomicUsize,
    lists: AtomicUsize,
    fail_list: AtomicBool,
    pause_read: AtomicBool,
    pause_list: AtomicBool,
    entered: Notify,
    resume: Notify,
}

impl SkillProvider for Provider {
    fn list(&self, _query: SkillListQuery) -> SkillProviderFuture<'_, SkillCatalog> {
        Box::pin(async move {
            self.lists.fetch_add(1, Ordering::SeqCst);
            if self.pause_list.swap(false, Ordering::SeqCst) {
                self.entered.notify_one();
                self.resume.notified().await;
            }
            if self.fail_list.load(Ordering::SeqCst) {
                return Err(SkillProviderError::new("discovery unavailable"));
            }
            Ok(SkillCatalog {
                warnings: vec!["account catalog".into()],
                ..Default::default()
            })
        })
    }

    fn read<'a>(
        &'a self,
        request: SkillReadRequest<'a>,
    ) -> SkillProviderFuture<'a, SkillReadResult> {
        let revision = self.reads.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            if self.pause_read.swap(false, Ordering::SeqCst) {
                self.entered.notify_one();
                self.resume.notified().await;
            }
            Ok(SkillReadResult {
                resource: request.resource,
                contents: format!("contents {revision}"),
            })
        })
    }

    fn search(&self, _request: SkillSearchRequest) -> SkillProviderFuture<'_, SkillSearchResult> {
        Box::pin(async { Ok(SkillSearchResult::default()) })
    }
}

fn state() -> SkillsThreadState {
    SkillsThreadState::new(
        SkillsExtensionConfig {
            include_instructions: true,
            max_context_tokens: None,
            bundled_skills_enabled: false,
            cloud_skill_enabled: true,
            shadow_selection_enabled: false,
        },
        /*cloud_skills_available*/ true,
    )
}

fn client() -> Arc<McpResourceClient> {
    Arc::new(McpResourceClient::new(Arc::new(McpRuntime::empty(
        /*prefix_mcp_tool_names*/ false,
    ))))
}

fn query(client: Option<Arc<McpResourceClient>>) -> SkillListQuery {
    SkillListQuery {
        turn_id: "turn".into(),
        executor_roots: Vec::new(),
        resolved_executor_roots: Vec::new(),
        host_snapshot: None,
        include_host_skills: false,
        include_bundled_skills: false,
        include_cloud_skills: true,
        mcp_resources: client,
        executor_capability_discovery: None,
    }
}

fn request(client: Option<Arc<McpResourceClient>>) -> SkillReadRequest<'static> {
    SkillReadRequest {
        authority: SkillAuthority::new(SkillSourceKind::Cloud, "codex_apps"),
        package: SkillPackageId("skill://demo".into()),
        resource: SkillResourceId::new("skill://demo/SKILL.md"),
        context: SkillReadContext::Cloud {
            mcp_resources: client,
        },
    }
}

#[tokio::test]
async fn late_read_cannot_return_or_populate_a_replaced_cache() {
    for replacement in [Some(client()), None] {
        let state = state();
        let provider = Arc::new(Provider::default());
        let providers = SkillProviders::new().with_cloud_provider(provider.clone());
        let original = Some(client());
        // None here exercises a successful per-turn refresh on the SAME generation.
        let replacement = replacement.or_else(|| original.clone());
        provider.pause_read.store(true, Ordering::SeqCst);
        let (late, ()) = tokio::join!(state.read_skill(&providers, request(original)), async {
            provider.entered.notified().await;
            state
                .refresh_cloud_catalog(
                    &providers,
                    query(replacement.clone()),
                    &ExtensionData::new("turn"),
                )
                .await
                .unwrap();
            provider.resume.notify_one();
        });
        assert!(late.is_err());
        assert_eq!(
            state
                .read_skill(&providers, request(replacement))
                .await
                .unwrap()
                .contents,
            "contents 1"
        );
    }
}

#[tokio::test]
async fn late_discovery_cannot_publish_into_a_new_generation() {
    for fails in [false, true] {
        let state = state();
        let provider = Arc::new(Provider::default());
        let providers = SkillProviders::new().with_cloud_provider(provider.clone());
        provider.pause_list.store(true, Ordering::SeqCst);
        provider.fail_list.store(fails, Ordering::SeqCst);
        let turn = ExtensionData::new("turn");
        let (late, ()) = tokio::join!(
            state.refresh_cloud_catalog(&providers, query(Some(client())), &turn),
            async {
                provider.entered.notified().await;
                state.cloud_cache(Some(&client()));
                provider.resume.notify_one();
            }
        );
        assert!(late.is_ok(), "superseded errors are discarded too");
        let catalogs = state.skills_extension_state.lock().unwrap();
        assert!(catalogs.cloud_cache.as_ref().unwrap().catalog.is_none());
        assert!(
            catalogs.cloud_retry.is_none(),
            "old failures must not delay the new account"
        );
    }
}

/// Failure storms must be bounded across turns, while new auth and success reset the delay.
#[tokio::test(start_paused = true)]
async fn cloud_refresh_backoff_and_mid_turn_auth_reset() {
    let state = state();
    let provider = Arc::new(Provider::default());
    let providers = SkillProviders::new().with_cloud_provider(provider.clone());
    let turn = ExtensionData::new("turn");
    let next_turn = ExtensionData::new("next");
    let original = Some(client());
    provider.fail_list.store(true, Ordering::SeqCst);
    for (index, delay) in [30, 60, 120, 240, 300, 300].into_iter().enumerate() {
        assert!(
            state
                .refresh_cloud_catalog(&providers, query(original.clone()), &turn)
                .await
                .is_err()
        );
        assert_eq!(provider.lists.load(Ordering::SeqCst), index + 1);
        tokio::time::advance(std::time::Duration::from_secs(delay - 1)).await;
        assert!(
            state
                .refresh_cloud_catalog(&providers, query(original.clone()), &next_turn)
                .await
                .is_ok()
        );
        assert_eq!(provider.lists.load(Ordering::SeqCst), index + 1);
        tokio::time::advance(std::time::Duration::from_secs(1)).await;
    }
    // An auth change within the same turn bypasses the old scope's cooldown.
    let replacement = Some(client());
    assert!(
        state
            .refresh_cloud_catalog(&providers, query(replacement.clone()), &turn)
            .await
            .is_err()
    );
    let before = provider.lists.load(Ordering::SeqCst);
    tokio::time::advance(std::time::Duration::from_secs(30)).await;
    provider.fail_list.store(false, Ordering::SeqCst);
    state
        .refresh_cloud_catalog(&providers, query(replacement.clone()), &turn)
        .await
        .unwrap();
    state
        .refresh_cloud_catalog(&providers, query(replacement.clone()), &turn)
        .await
        .unwrap();
    assert_eq!(provider.lists.load(Ordering::SeqCst), before + 1);
    assert!(
        state
            .cloud_catalog_snapshot()
            .warnings
            .contains(&"account catalog".to_string())
    );
    // Warning-bearing success can refresh on the next turn, with a fresh 30-second delay.
    provider.fail_list.store(true, Ordering::SeqCst);
    assert!(
        state
            .refresh_cloud_catalog(&providers, query(replacement.clone()), &next_turn)
            .await
            .is_err()
    );
    tokio::time::advance(std::time::Duration::from_secs(30)).await;
    assert!(
        state
            .refresh_cloud_catalog(&providers, query(replacement), &next_turn)
            .await
            .is_err()
    );
    assert_eq!(provider.lists.load(Ordering::SeqCst), before + 3);
}

#[tokio::test]
async fn cloud_refresh_cancelled_writer_releases_waiters() {
    let state = state();
    let provider = Arc::new(Provider::default());
    let providers = SkillProviders::new().with_cloud_provider(provider.clone());
    let turn = ExtensionData::new("turn");
    let resources = Some(client());
    provider.pause_list.store(true, Ordering::SeqCst);
    let mut cancelled =
        Box::pin(state.refresh_cloud_catalog(&providers, query(resources.clone()), &turn));
    assert!(futures::poll!(&mut cancelled).is_pending());
    drop(cancelled);
    state
        .refresh_cloud_catalog(&providers, query(resources.clone()), &turn)
        .await
        .unwrap();
    state
        .refresh_cloud_catalog(&providers, query(resources), &turn)
        .await
        .unwrap();
    assert_eq!(provider.lists.load(Ordering::SeqCst), 2);
}
