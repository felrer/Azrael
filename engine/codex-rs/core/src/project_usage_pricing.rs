//! Verified API-equivalent token prices, independent of subscription billing.
//!
//! Inputs include cache reads/writes; output already includes reasoning. Rates
//! are integer nanoUSD per million tokens, and requests round once to nanoUSD.
//! Unknown identities, policies and incomplete cache write splits fail closed.

use std::sync::OnceLock;

use codex_protocol::protocol::TokenUsage;
use serde::Deserialize;

#[derive(Deserialize)]
struct RateCard {
    models: Vec<ModelRates>,
}

#[derive(Deserialize)]
struct ModelRates {
    provider: String,
    model_ids: Vec<String>,
    policy: String,
    requires_cache_write_split: bool,
    bands: Vec<Band>,
    tiers: Vec<Tier>,
}

#[derive(Deserialize)]
struct Band {
    /// The band applies strictly above this inclusive-input threshold.
    over_input_tokens: i64,
    rates: Rates,
}

#[derive(Deserialize)]
struct Rates {
    input: i64,
    cache_read: i64,
    cache_write_5m: Option<i64>,
    cache_write_1h: Option<i64>,
    output: i64,
}

#[derive(Deserialize)]
struct Tier {
    names: Vec<String>,
    /// Input, read, short write, long write, output; 1000 means 1x.
    multipliers_per_mille: [i64; 5],
}

fn rate_card() -> Option<&'static RateCard> {
    static CARD: OnceLock<Option<RateCard>> = OnceLock::new();
    CARD.get_or_init(|| serde_json::from_str(include_str!("project_usage_rates.json")).ok())
        .as_ref()
}

/// `cache_write_1h_input_tokens` must be response-confirmed for Claude writes.
/// None with no writes is sufficient; None with Claude writes is unpriced.
/// OpenAI has one known cache write rate and ignores this optional TTL detail.
/// Gemini cache storage and provider tool fees are outside this token estimate.
pub(crate) fn estimate_nano_usd(
    provider: &str,
    model: &str,
    service_tier: Option<&str>,
    usage: &TokenUsage,
    cache_write_1h_input_tokens: Option<i64>,
) -> Option<i64> {
    let row = rate_card()?
        .models
        .iter()
        .find(|row| row.provider == provider && row.model_ids.iter().any(|id| id == model))?;
    if !matches!(
        row.policy.as_str(),
        "per_request" | "anthropic_ttl_split" | "token_only_no_cache_storage_or_tool_fees"
    ) {
        return None;
    }
    let counts = [
        usage.input_tokens,
        usage.cached_input_tokens,
        usage.cache_write_input_tokens,
        usage.output_tokens,
        usage.reasoning_output_tokens,
        usage.total_tokens,
    ];
    if counts.iter().any(|count| *count < 0) || usage.reasoning_output_tokens > usage.output_tokens
    {
        return None;
    }
    let total = usage.input_tokens.checked_add(usage.output_tokens)?;
    // Zero is used when the provider omitted its redundant total field.
    if usage.total_tokens != 0 && usage.total_tokens != total {
        return None;
    }
    let cache_total = usage
        .cached_input_tokens
        .checked_add(usage.cache_write_input_tokens)?;
    let ordinary_input = usage.input_tokens.checked_sub(cache_total)?;
    if ordinary_input < 0 {
        return None;
    }
    let long_writes = if row.requires_cache_write_split {
        match cache_write_1h_input_tokens {
            Some(count) if count >= 0 && count <= usage.cache_write_input_tokens => count,
            None if usage.cache_write_input_tokens == 0 => 0,
            _ => return None,
        }
    } else {
        0
    };
    let short_writes = usage.cache_write_input_tokens.checked_sub(long_writes)?;
    let tier_name = service_tier.unwrap_or("default");
    let tier = row
        .tiers
        .iter()
        .find(|tier| tier.names.iter().any(|name| name == tier_name))?;
    let band = row
        .bands
        .iter()
        .filter(|band| usage.input_tokens > band.over_input_tokens)
        .max_by_key(|band| band.over_input_tokens)?;
    let rates = &band.rates;
    let token_counts = [
        ordinary_input,
        usage.cached_input_tokens,
        short_writes,
        long_writes,
        usage.output_tokens,
    ];
    let token_rates = [
        Some(rates.input),
        Some(rates.cache_read),
        rates.cache_write_5m,
        rates.cache_write_1h,
        Some(rates.output),
    ];
    let mut numerator = 0_i128;
    for ((count, rate), multiplier) in token_counts
        .into_iter()
        .zip(token_rates)
        .zip(tier.multipliers_per_mille)
    {
        if multiplier <= 0 || rate.is_some_and(|rate| rate < 0) {
            return None;
        }
        if count == 0 {
            continue;
        }
        let cost = i128::from(count)
            .checked_mul(i128::from(rate?))?
            .checked_mul(i128::from(multiplier))?;
        numerator = numerator.checked_add(cost)?;
    }
    // Million-token rates and per-mille tier multipliers share this divisor.
    let rounded = numerator
        .checked_add(500_000_000)?
        .checked_div(1_000_000_000)?;
    i64::try_from(rounded).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usage(input: i64, read: i64, write: i64, output: i64) -> TokenUsage {
        TokenUsage {
            input_tokens: input,
            cached_input_tokens: read,
            cache_write_input_tokens: write,
            output_tokens: output,
            total_tokens: input + output,
            ..Default::default()
        }
    }

    #[test]
    fn inclusive_input_and_reasoning_are_not_double_counted() {
        let mut u = usage(1000, 400, 100, 200);
        u.reasoning_output_tokens = 80;
        assert_eq!(
            estimate_nano_usd("openai", "gpt-6.1-sol", None, &u, None),
            Some(3_290_000)
        );
        // GPT6 Sol's cache read is 10%, while 6.1 Sol's is 5%.
        assert_eq!(
            estimate_nano_usd("openai", "gpt-6-sol", None, &u, None),
            Some(3_330_000)
        );
    }

    #[test]
    fn long_context_is_strict_and_counts_all_input() {
        let u = usage(272_000, 272_000, 0, 100);
        assert_eq!(
            estimate_nano_usd("openai", "gpt-6.1-sol", None, &u, None),
            Some(28_200_000)
        );
        let u = usage(272_001, 272_001, 0, 100);
        assert_eq!(
            estimate_nano_usd("openai", "gpt-6.1-sol", None, &u, None),
            Some(55_900_200)
        );
        assert_eq!(
            estimate_nano_usd("openai", "gpt-6.1-sol", Some("fast"), &u, None),
            Some(111_800_400)
        );
    }

    #[test]
    fn only_published_model_tiers_apply() {
        let u = usage(1000, 0, 0, 0);
        for (tier, expected) in [
            ("fast", 4_000_000),
            ("priority", 4_000_000),
            ("ultrafast", 12_000_000),
            ("flex", 1_000_000),
            ("batch", 1_000_000),
        ] {
            assert_eq!(
                estimate_nano_usd("openai", "gpt-6.1-sol", Some(tier), &u, None),
                Some(expected)
            );
        }
        assert_eq!(
            estimate_nano_usd("openai", "gpt-6-sol", Some("ultrafast"), &u, None),
            None
        );
        assert_eq!(
            estimate_nano_usd("openai", "gpt-6.1-sol", Some("auto"), &u, None),
            None
        );
        assert_eq!(
            estimate_nano_usd("anthropic", "claude-sonnet-4-6", Some("priority"), &u, None),
            None
        );
        assert_eq!(
            estimate_nano_usd("anthropic", "claude-opus-5-5", Some("fast"), &u, None),
            Some(8_000_000)
        );
    }

    #[test]
    fn claude_requires_authoritative_write_ttl_and_supports_mixed_writes() {
        let u = usage(1000, 400, 100, 200);
        assert_eq!(
            estimate_nano_usd("anthropic", "claude-sonnet-4-6", None, &u, None),
            None
        );
        assert_eq!(
            estimate_nano_usd("anthropic", "claude-sonnet-4-6", None, &u, Some(25)),
            Some(5_051_250)
        );
        assert_eq!(
            estimate_nano_usd(
                "anthropic",
                "claude-sonnet-4-6",
                Some("batch"),
                &u,
                Some(25)
            ),
            Some(2_525_625)
        );
        for split in [-1, 101] {
            assert_eq!(
                estimate_nano_usd("anthropic", "claude-sonnet-4-6", None, &u, Some(split)),
                None
            );
        }
        let u = usage(0, 0, 0, 100);
        assert_eq!(
            estimate_nano_usd("anthropic", "claude-opus-5-5", None, &u, None),
            Some(2_000_000)
        );
    }

    #[test]
    fn haiku_prompt_band_uses_inclusive_input() {
        let u = usage(100_000, 100_000, 0, 100);
        assert_eq!(
            estimate_nano_usd("anthropic", "claude-haiku-5-5", None, &u, None),
            Some(1_050_000)
        );
        let u = usage(100_001, 100_001, 0, 100);
        assert_eq!(
            estimate_nano_usd("anthropic", "claude-haiku-5-5", None, &u, None),
            Some(5_250_050)
        );
    }

    #[test]
    fn gemini_aliases_bands_and_batch_cache_rates_are_explicit() {
        let u = usage(200_000, 100_000, 0, 100);
        for id in ["gemini-3.1-pro", "gemini-pro-agent", "gemini-3.1-pro-high"] {
            assert_eq!(
                estimate_nano_usd("google-antigravity", id, Some("batch"), &u, None),
                Some(120_600_000)
            );
        }
        let u = usage(200_001, 200_001, 0, 100);
        assert_eq!(
            estimate_nano_usd("google-antigravity", "gemini-3.1-pro", None, &u, None),
            Some(81_800_400)
        );
        let u = usage(1000, 400, 0, 200);
        assert_eq!(
            estimate_nano_usd(
                "google-antigravity",
                "gemini-3.8-flash-high",
                None,
                &u,
                None
            ),
            Some(1_230_000)
        );
        assert_eq!(
            estimate_nano_usd(
                "google-antigravity",
                "gemini-3.8-flash-high",
                Some("flex"),
                &u,
                None
            ),
            Some(615_000)
        );
        let u = usage(1000, 0, 100, 0);
        assert_eq!(
            estimate_nano_usd("google-antigravity", "gemini-3.8-flash", None, &u, None),
            None
        );
    }

    #[test]
    fn exact_matching_and_unsupported_policies_fail_closed() {
        let u = usage(1000, 0, 0, 100);
        for (provider, model) in [
            ("openai", "gpt-6.1-sol-future"),
            ("openai", "GPT-6.1-sol"),
            ("openai", "gpt-5.5"),
            ("openai", "gpt-daybreak-blue-latest"),
            ("devin", "claude-opus-5-5-medium"),
            ("unknown", "gpt-6.1-sol"),
            ("google-antigravity", "gemini-3.8-flash-max"),
        ] {
            assert_eq!(estimate_nano_usd(provider, model, None, &u, None), None);
        }
        assert_eq!(
            estimate_nano_usd("openai", "gpt-5.6", None, &u, None),
            estimate_nano_usd("openai", "gpt-5.6-sol", None, &u, None)
        );
        assert_eq!(
            estimate_nano_usd("openai", "gpt-6.1-sol", None, &TokenUsage::default(), None),
            Some(0)
        );
        assert_eq!(
            estimate_nano_usd("devin", "swe-2-free", None, &TokenUsage::default(), None),
            None
        );
    }

    #[test]
    fn invalid_counts_and_overflow_fail_closed() {
        let valid = usage(1000, 400, 100, 200);
        let mut cases = vec![usage(100, 80, 30, 0)];
        for mutate in [
            |u: &mut TokenUsage| u.input_tokens = -1,
            |u: &mut TokenUsage| u.cached_input_tokens = -1,
            |u: &mut TokenUsage| u.cache_write_input_tokens = -1,
            |u: &mut TokenUsage| u.output_tokens = -1,
            |u: &mut TokenUsage| u.reasoning_output_tokens = -1,
            |u: &mut TokenUsage| u.reasoning_output_tokens = 201,
            |u: &mut TokenUsage| u.total_tokens = 1199,
        ] {
            let mut u = valid.clone();
            mutate(&mut u);
            cases.push(u);
        }
        cases.push(TokenUsage {
            input_tokens: i64::MAX,
            output_tokens: 1,
            ..Default::default()
        });
        cases.push(TokenUsage {
            input_tokens: i64::MAX,
            ..Default::default()
        });
        for u in cases {
            assert_eq!(
                estimate_nano_usd("openai", "gpt-6.1-sol", None, &u, None),
                None
            );
        }
    }

    #[test]
    fn fractional_nano_usd_rounds_once_after_sum() {
        let u = usage(4, 0, 4, 0);
        assert_eq!(
            estimate_nano_usd("openai", "gpt-6-luna", Some("flex"), &u, None),
            Some(250)
        );
        let u = usage(1, 0, 1, 0);
        assert_eq!(
            estimate_nano_usd("openai", "gpt-6-luna", Some("flex"), &u, None),
            Some(63)
        );
    }
}
