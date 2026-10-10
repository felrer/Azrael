//! Observed API value, persisted only as daily project aggregates.
use crate::environment_selection::TurnEnvironmentSnapshot;
use crate::session::session::Session;
use crate::session::step_settings::ResolvedStepSettings;
use crate::session::turn_context::TurnContext;
use chrono::DateTime;
use chrono::FixedOffset;
use chrono::Utc;
use codex_protocol::ResponseUsageMetadata;
use codex_protocol::protocol::TokenUsage;
use codex_state::ProjectUsageDelta;
use codex_utils_path_uri::PathUri;
use sha2::Digest;
use sha2::Sha256;
use std::collections::HashSet;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;

const RECENT_RESPONSES: usize = 4096;
#[derive(Default)]
struct RecentResponses {
    keys: HashSet<(String, String)>,
    order: VecDeque<(String, String)>,
}
impl RecentResponses {
    fn admit(&mut self, key: (String, String)) -> bool {
        if !self.keys.insert(key.clone()) {
            return false;
        }
        self.order.push_back(key);
        while self.order.len() > RECENT_RESPONSES {
            if let Some(old) = self.order.pop_front() {
                self.keys.remove(&old);
            }
        }
        true
    }
    fn forget(&mut self, key: &(String, String)) {
        self.keys.remove(key);
        self.order.retain(|value| value != key);
    }
}
static RECENT: OnceLock<Mutex<RecentResponses>> = OnceLock::new();
static STORE_WARNING: AtomicBool = AtomicBool::new(false);

fn day(now: DateTime<Utc>) -> String {
    now.with_timezone(&FixedOffset::east_opt(9 * 3600).expect("valid Seoul offset"))
        .format("%Y-%m-%d")
        .to_string()
}

fn project_identity(cwd: &PathUri, roots: &[PathUri]) -> (String, String) {
    // The captured execution roots, rather than the foreground editor, own attribution.
    let root = roots
        .iter()
        .filter(|root| cwd.starts_with(root))
        .max_by_key(|root| root.to_string().len())
        .unwrap_or(cwd);
    let mut identity = root.to_string().trim_end_matches('/').to_string();
    if cfg!(windows) && root.to_abs_path().is_ok() {
        identity.make_ascii_lowercase();
    }
    let name = root.basename().unwrap_or_else(|| "Project".to_string());
    (format!("{:x}", Sha256::digest(identity.as_bytes())), name)
}

fn attribution<'a>(
    model: &'a str,
    native_provider: &'a str,
) -> (std::borrow::Cow<'a, str>, &'a str) {
    if let Ok(selection) = crate::managed_catalog::selection(model) {
        return selection;
    }
    if let Some(model) = model.strip_prefix("devin/") {
        return ("devin".into(), model);
    }
    (native_provider.into(), model)
}

pub(crate) async fn record(
    sess: &Session,
    context: &TurnContext,
    settings: &ResolvedStepSettings,
    environments: &TurnEnvironmentSnapshot,
    response_id: &str,
    usage: Option<&TokenUsage>,
    metadata: Option<&ResponseUsageMetadata>,
) {
    let Some(store) = sess.state_db() else {
        warn_store_once();
        return;
    };
    let key = (sess.thread_id.to_string(), response_id.to_string());
    // This is live-response deduplication, not a durable request journal. Restored
    // TokenCount/rollout notifications never call this collector.
    if !RECENT
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .admit(key.clone())
    {
        return;
    }
    let fallback = PathUri::from_abs_path(&context.config.cwd);
    let cwd = environments
        .primary()
        .map(|environment| environment.cwd())
        .unwrap_or(&fallback);
    let (project_id, project_name) =
        project_identity(cwd, environments.primary_workspace_root_uris());
    let (provider, model) =
        attribution(&settings.model_info.slug, &context.config.model_provider_id);
    let pricing = metadata
        .and_then(|value| value.metadata.as_ref())
        .and_then(|value| value.get("azraelPricing"));
    let estimated = pricing
        .and_then(|value| value.get("estimated"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let cache_write_1h = pricing
        .and_then(|value| value.get("cacheWrite1hInputTokens"))
        .and_then(serde_json::Value::as_i64);
    let amount_nano_usd = usage.filter(|_| !estimated).and_then(|usage| {
        crate::project_usage_pricing::estimate_nano_usd(
            &provider,
            model,
            settings.service_tier.as_deref(),
            usage,
            cache_write_1h,
        )
    });
    let delta = ProjectUsageDelta {
        date: day(Utc::now()),
        project_id,
        project_name,
        provider: provider.to_string(),
        model: model.to_string(),
        amount_nano_usd,
    };
    if store.add_project_usage(&delta).await.is_err() {
        RECENT
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .forget(&key);
        warn_store_once();
    }
}

fn warn_store_once() {
    if !STORE_WARNING.swap(true, Ordering::Relaxed) {
        tracing::warn!("project daily usage storage unavailable; observed usage may be incomplete");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    #[test]
    fn korean_day_changes_at_local_midnight() {
        assert_eq!(
            day(Utc.with_ymd_and_hms(2026, 10, 8, 14, 59, 59).unwrap()),
            "2026-10-08"
        );
        assert_eq!(
            day(Utc.with_ymd_and_hms(2026, 10, 8, 15, 0, 0).unwrap()),
            "2026-10-09"
        );
    }
    #[test]
    fn same_name_projects_are_distinct_and_subdirectories_share_root() {
        let a: PathUri = "file:///workspace/a/project".parse().unwrap();
        let b: PathUri = "file:///workspace/b/project".parse().unwrap();
        let sub: PathUri = "file:///workspace/a/project/src".parse().unwrap();
        assert_ne!(project_identity(&a, &[]).0, project_identity(&b, &[]).0);
        assert_eq!(
            project_identity(&a, &[]).0,
            project_identity(&sub, &[a.clone()]).0
        );
    }
    #[test]
    fn namespaces_select_the_actual_provider() {
        assert_eq!(
            attribution("managed/anthropic/claude-sonnet-5", "openai"),
            (std::borrow::Cow::Borrowed("anthropic"), "claude-sonnet-5")
        );
        assert_eq!(
            attribution("devin/gpt-6.1-sol", "openai"),
            (std::borrow::Cow::Borrowed("devin"), "gpt-6.1-sol")
        );
        assert_eq!(
            attribution("gpt-6.1-sol", "openai"),
            (std::borrow::Cow::Borrowed("openai"), "gpt-6.1-sol")
        );
    }
    #[test]
    fn recent_completion_is_counted_once_and_memory_is_bounded() {
        let mut recent = RecentResponses::default();
        let key = ("thread-a".into(), "response-a".into());
        assert!(recent.admit(key.clone()));
        assert!(!recent.admit(key.clone()));
        recent.forget(&key);
        assert!(recent.admit(key));
        for index in 0..RECENT_RESPONSES + 2 {
            assert!(recent.admit(("thread-b".into(), index.to_string())));
        }
        assert_eq!(recent.keys.len(), RECENT_RESPONSES);
        assert_eq!(recent.order.len(), RECENT_RESPONSES);
    }
}
