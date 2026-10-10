use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use ts_rs::TS;

use crate::openai_models::ModelInfo;

/// A present empty entry selects the dynamic default, independently of global settings.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
pub struct ProviderAutoCompact {
    #[serde(default, deserialize_with = "positive_token_limit")]
    #[schemars(range(min = 1))]
    #[ts(type = "number | null")]
    pub percentage: Option<i64>,
    #[serde(default, deserialize_with = "positive_token_limit")]
    #[schemars(range(min = 1))]
    #[ts(type = "number | null")]
    pub token_limit: Option<i64>,
}

fn positive_token_limit<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
    let value = Option::<i64>::deserialize(d)?;
    if value.is_some_and(|value| value <= 0) {
        return Err(serde::de::Error::custom(
            "auto-compaction values must be positive integers",
        ));
    }
    Ok(value)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
pub enum AutoCompactSource {
    Provider,
    Global,
    Default,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "kebab-case")]
pub enum PricingStatus {
    Confirmed,
    Reference,
    NoSurcharge,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct ContextPricing {
    pub status: PricingStatus,
    #[ts(type = "number | null")]
    pub input_token_threshold: Option<i64>,
    pub inclusive: bool,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct ContextPolicy {
    pub provider_id: String,
    pub model_id: String,
    #[ts(type = "number | null")]
    pub context_window: Option<i64>,
    #[ts(type = "number | null")]
    pub safe_context_window: Option<i64>,
    #[ts(type = "number | null")]
    pub auto_compact_base_tokens: Option<i64>,
    #[ts(type = "number | null")]
    pub auto_compact_token_limit: Option<i64>,
    pub auto_compact_source: AutoCompactSource,
    pub pricing: ContextPricing,
    #[ts(type = "number | null")]
    pub input_tokens: Option<i64>,
    pub input_tokens_estimated: bool,
}

pub fn policy_provider_id(model: &ModelInfo) -> &str {
    model
        .slug
        .strip_prefix("managed/")
        .and_then(|key| key.split_once('/'))
        .map_or(model.model_provider.as_str(), |(provider, _)| provider)
}

pub fn resolve_auto_compact(
    model: &ModelInfo,
    entries: &BTreeMap<String, ProviderAutoCompact>,
    global: Option<i64>,
) -> (Option<i64>, AutoCompactSource) {
    let base = auto_compact_base_tokens(model);
    let (custom, source) = match entries.get(policy_provider_id(model)) {
        Some(entry) => (
            entry.percentage.map_or(entry.token_limit, |percentage| {
                base.map(|base| percentage_tokens(base, percentage))
            }),
            if entry.percentage.is_some() || entry.token_limit.is_some() {
                AutoCompactSource::Provider
            } else {
                AutoCompactSource::Default
            },
        ),
        None => (
            global,
            if global.is_some() {
                AutoCompactSource::Global
            } else {
                AutoCompactSource::Default
            },
        ),
    };
    let desired = custom.or_else(|| {
        if policy_provider_id(model) == "anthropic" {
            Some(400_000)
        } else {
            base.map(|base| percentage_tokens(base, /*percentage*/ 95))
        }
    });
    (
        desired.map(|limit| {
            model
                .usable_context_window()
                .map_or(limit, |safe| limit.min(safe))
        }),
        source,
    )
}

fn percentage_tokens(base: i64, percentage: i64) -> i64 {
    (i128::from(base) * i128::from(percentage) / 100).clamp(1, i128::from(i64::MAX)) as i64
}

fn resolve_pricing(model: &ModelInfo, subscription: bool) -> ContextPricing {
    let subscription = subscription
        && policy_provider_id(model) == "openai"
        && !model.slug.starts_with("managed/");
    let mut pricing = ContextPricing {
        status: PricingStatus::Unknown,
        input_token_threshold: None,
        inclusive: false,
        source_url: None,
    };
    let id = model
        .slug
        .strip_prefix("managed/")
        .and_then(|key| key.split_once('/'))
        .map_or(model.slug.as_str(), |(_, model)| model);
    let rule = match (policy_provider_id(model), id) {
        ("openai", "gpt-6.1-sol" | "gpt-6-astra" | "gpt-6-luna") => Some((
            272_000,
            false,
            format!("https://developers.openai.com/api/docs/models/{id}"),
        )),
        ("google", "gemini-2.5-pro" | "gemini-3.1-pro-preview") => Some((
            200_000,
            false,
            "https://ai.google.dev/gemini-api/docs/pricing".into(),
        )),
        (
            "xai",
            "grok-4.7"
            | "grok-build-0.1"
            | "grok-4.6"
            | "grok-4.5"
            | "grok-4.3"
            | "grok-4.20-multi-agent-0309"
            | "grok-4.20-0309-reasoning"
            | "grok-4.20-0309-non-reasoning",
        ) => Some((200_000, true, "https://docs.x.ai/developers/pricing".into())),
        ("anthropic", "claude-opus-4-6" | "claude-sonnet-4-6") => {
            pricing.status = if subscription || model.slug.starts_with("managed/anthropic/") {
                PricingStatus::Reference
            } else {
                PricingStatus::NoSurcharge
            };
            pricing.source_url = Some(
                "https://platform.claude.com/docs/en/about-claude/pricing#long-context-pricing"
                    .into(),
            );
            None
        }
        _ => None,
    };
    if let Some((threshold, inclusive, url)) = rule {
        pricing = ContextPricing {
            status: if subscription {
                PricingStatus::Reference
            } else {
                PricingStatus::Confirmed
            },
            input_token_threshold: Some(threshold),
            inclusive,
            source_url: Some(url),
        };
    }
    pricing
}

fn auto_compact_base_tokens(model: &ModelInfo) -> Option<i64> {
    let pricing = resolve_pricing(model, /*subscription*/ false);
    let boundary = pricing.input_token_threshold.map(|threshold| {
        if pricing.inclusive {
            threshold.saturating_sub(1)
        } else {
            threshold
        }
    });
    model.resolved_context_window().map(|capacity| {
        boundary
            .map_or(capacity, |boundary| capacity.min(boundary))
            .max(1)
    })
}

pub fn resolve_context_policy(
    model: &ModelInfo,
    entries: &BTreeMap<String, ProviderAutoCompact>,
    global: Option<i64>,
    subscription: bool,
) -> ContextPolicy {
    let (auto_compact_token_limit, auto_compact_source) =
        resolve_auto_compact(model, entries, global);
    ContextPolicy {
        provider_id: policy_provider_id(model).to_string(),
        model_id: model.slug.clone(),
        context_window: model.resolved_context_window(),
        safe_context_window: model.usable_context_window(),
        auto_compact_base_tokens: auto_compact_base_tokens(model),
        auto_compact_token_limit,
        auto_compact_source,
        pricing: resolve_pricing(model, subscription),
        input_tokens: None,
        input_tokens_estimated: true,
    }
}
