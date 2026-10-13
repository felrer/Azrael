//! Final helper projection admission; estimated prefixes never replace observed usage.
use super::session::Session;
use super::step_context::StepContext;
use codex_protocol::config_types::AutoCompactTokenLimitScope;
use std::sync::Mutex;

pub(super) fn uses_final_budget(model: &str) -> bool {
    !model.starts_with("api/")
        && (crate::managed_catalog::is_managed(model)
            || (crate::devin::catalog::is_devin(model) && crate::devin::native_runtime::enabled()))
}

#[derive(Default)]
struct PrefixBaseline(Mutex<Option<(String, String, i64)>>);

fn prefix_tokens(
    baseline: &mut Option<(String, String, i64)>,
    window: String,
    model: &str,
    input: i64,
) -> i64 {
    if baseline
        .as_ref()
        .is_none_or(|(id, slug, _)| id != &window || slug != model)
    {
        *baseline = Some((window, model.to_owned(), input));
    }
    baseline.as_ref().map_or(input, |(_, _, tokens)| *tokens)
}

pub(super) fn compaction_exhausted(
    attempts: usize,
    previous: Option<i64>,
    current: Option<i64>,
) -> bool {
    attempts >= 2
        || previous
            .zip(current)
            .is_some_and(|(previous, current)| current >= previous)
}

pub(super) async fn limit_reached(sess: &Session, step: &StepContext, input_tokens: i64) -> bool {
    let config = &step.turn.config;
    let model = &step.settings.model_info;
    let full_limit = model
        .resolved_context_window()
        .map(|window| window.saturating_mul(model.effective_context_window_percent) / 100);
    let scope_limit = codex_protocol::context_policy::resolve_auto_compact(
        model,
        &config.provider_auto_compact,
        config.model_auto_compact_token_limit,
        super::context_window::subscription_auth(sess),
    )
    .0;
    let window = sess.current_window_id().await;
    let baselines = sess
        .services
        .thread_extension_data
        .get_or_init(PrefixBaseline::default);
    let baseline = {
        let mut baseline = baselines
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        prefix_tokens(&mut baseline, window, &format!("{}#{}", model.slug, step.harness_profile.fingerprint), input_tokens)
    };
    let scope_tokens = match config.model_auto_compact_token_limit_scope {
        AutoCompactTokenLimitScope::Total => input_tokens,
        AutoCompactTokenLimitScope::BodyAfterPrefix => input_tokens.saturating_sub(baseline),
    };
    let buffer = step
        .token_budget
        .as_ref()
        .map_or(0, crate::config::TokenBudgetConfig::fallback_buffer_tokens);
    exceeds_limits(
        input_tokens,
        scope_tokens,
        full_limit,
        scope_limit.map(|n| n.saturating_add(buffer)),
    )
}

fn exceeds_limits(input: i64, body: i64, full: Option<i64>, scope: Option<i64>) -> bool {
    full.is_some_and(|limit| input >= limit) || scope.is_some_and(|limit| body >= limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prefix_is_fixed_until_window_or_model_changes() {
        let mut baseline = None;
        assert_eq!(
            prefix_tokens(&mut baseline, "window1".into(), "managed/a/m", 200),
            200
        );
        assert_eq!(
            prefix_tokens(&mut baseline, "window1".into(), "managed/a/m", 450),
            200
        );
        assert_eq!(
            prefix_tokens(&mut baseline, "window2".into(), "managed/a/m", 100),
            100
        );
        assert_eq!(
            prefix_tokens(&mut baseline, "window2".into(), "managed/b/m", 120),
            120
        );
    }
    #[test]
    fn no_progress_and_repeat_bounds_are_terminal() {
        assert!(compaction_exhausted(1, Some(2000), Some(2000)));
        assert!(compaction_exhausted(1, Some(2000), Some(2001)));
        assert!(!compaction_exhausted(1, Some(2000), Some(1500)));
        assert!(compaction_exhausted(2, None, None));
        assert!(!compaction_exhausted(0, None, None));
    }
    #[test]
    fn full_input_cap_is_independent_of_body_scope() {
        assert!(exceeds_limits(1000, 0, Some(1000), Some(100)));
        assert!(exceeds_limits(900, 100, Some(1000), Some(100)));
        assert!(!exceeds_limits(900, 99, Some(1000), Some(100)));
        assert!(!uses_final_budget("api/connection/model"));
        assert!(!uses_final_budget("gpt-6"));
    }
}
