use anyhow::Context;
use anyhow::Result;
use anyhow::anyhow;
use codex_protocol::config_types::ReasoningSummary;
use codex_protocol::openai_models::ApplyPatchToolType;
use codex_protocol::openai_models::ConfigShellToolType;
use codex_protocol::openai_models::InputModality;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::openai_models::ModelVisibility;
use codex_protocol::openai_models::ReasoningEffort;
use codex_protocol::openai_models::ReasoningEffortPreset;
use codex_protocol::openai_models::TruncationPolicyConfig;
use serde::Deserialize;
use std::collections::HashSet;
use tracing::warn;

const DEVIN_PREFIX: &str = "devin/";
pub(super) const GROUP_PREFIX: &str = "devin/@group/";

#[derive(Debug, Deserialize)]
pub(super) struct DevinCatalog {
    families: Vec<DevinFamily>,
}

#[derive(Debug, Deserialize)]
struct DevinFamily {
    family_label: String,
    family_uid: String,
    slug: String,
    variants: Vec<DevinVariant>,
}

#[derive(Debug, Clone, Deserialize)]
struct DevinVariant {
    model_uid: String,
    label: String,
    max_context_tokens: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct GroupIdentity {
    family_uid: String,
    tier_label: String,
    max_context_tokens: i64,
}

#[derive(Debug)]
struct GroupMember<'a> {
    variant: &'a DevinVariant,
    effort: ReasoningEffort,
    index: usize,
}

#[derive(Debug)]
struct Group<'a> {
    family: &'a DevinFamily,
    identity: GroupIdentity,
    members: Vec<GroupMember<'a>>,
}

pub(super) fn parse_catalog(bytes: &[u8], max_bytes: usize) -> Result<DevinCatalog> {
    if bytes.len() > max_bytes {
        return Err(anyhow!("Devin model catalog exceeds size limit"));
    }
    let catalog: DevinCatalog =
        serde_json::from_slice(bytes).context("invalid Devin model catalog")?;
    let mut model_ids = HashSet::new();
    for variant in catalog
        .families
        .iter()
        .flat_map(|family| family.variants.iter())
    {
        if variant.model_uid.is_empty() {
            return Err(anyhow!("Devin model catalog contains an empty model_uid"));
        }
        if variant.label.is_empty() {
            return Err(anyhow!(
                "Devin model catalog contains an empty label for {}",
                variant.model_uid
            ));
        }
        if variant.max_context_tokens.is_some_and(|limit| limit <= 0) {
            return Err(anyhow!(
                "Devin model {} has an invalid context limit",
                variant.model_uid
            ));
        }
        if !model_ids.insert(variant.model_uid.clone()) {
            return Err(anyhow!(
                "Devin model catalog contains duplicate model_uid {}",
                variant.model_uid
            ));
        }
    }
    Ok(catalog)
}

/// `image_models` holds cloud model ids verified to accept prompt images; all
/// other models, and groups with any unverified member, remain text-only.
pub(super) fn models_from_catalog(
    bytes: &[u8],
    image_models: &HashSet<String>,
) -> Result<Vec<ModelInfo>> {
    let catalog = parse_catalog(bytes, super::MAX_CATALOG_BYTES)?;
    let groups = groups(&catalog);
    let exact_keys = exact_keys(&catalog);
    let mut result = Vec::new();
    let mut emitted_groups = HashSet::new();
    let mut index = 0;

    for family in &catalog.families {
        for variant in &family.variants {
            let Some(max_context_tokens) = variant.max_context_tokens else {
                warn!(
                    model_uid = %variant.model_uid,
                    "omitting Devin model without a known context limit"
                );
                index += 1;
                continue;
            };
            if let Some(group) = groups.iter().find(|group| {
                group
                    .members
                    .iter()
                    .any(|member| member.variant.model_uid == variant.model_uid)
            }) {
                if emitted_groups.insert(group.identity.clone()) {
                    let mut info = group_model_info(group, &exact_keys)?;
                    let images = group
                        .members
                        .iter()
                        .all(|member| image_models.contains(&member.variant.model_uid));
                    info.input_modalities = input_modalities(images);
                    result.push(info);
                }
                let images = image_models.contains(&variant.model_uid);
                result.extend(
                    exact_aliases(variant, index, max_context_tokens)?
                        .into_iter()
                        .map(|model| with_input_modalities(model, images)),
                );
            } else {
                let images = image_models.contains(&variant.model_uid);
                result.extend(
                    exact_models(variant, index, max_context_tokens)?
                        .into_iter()
                        .map(|model| with_input_modalities(model, images)),
                );
            }
            index += 1;
        }
    }
    Ok(result)
}

fn input_modalities(images: bool) -> Vec<InputModality> {
    if images {
        vec![InputModality::Text, InputModality::Image]
    } else {
        vec![InputModality::Text]
    }
}

fn with_input_modalities(mut model: ModelInfo, images: bool) -> ModelInfo {
    model.input_modalities = input_modalities(images);
    model
}

pub(super) fn resolve_model(
    catalog: &DevinCatalog,
    key: &str,
    effort: Option<&ReasoningEffort>,
) -> Result<String> {
    if let Some(variant) = catalog
        .families
        .iter()
        .flat_map(|family| family.variants.iter())
        .find(|variant| {
            variant.max_context_tokens.is_some()
                && (exact_model_key(&variant.model_uid) == key
                    || legacy_model_key(&variant.model_uid) == key)
        })
    {
        return Ok(variant.model_uid.clone());
    }

    let exact_keys = exact_keys(catalog);
    let group = groups(catalog)
        .into_iter()
        .find(|group| group_key(group, &exact_keys) == key)
        .ok_or_else(|| anyhow!("unknown Devin model selection: {key}"))?;
    let requested = effort
        .cloned()
        .unwrap_or_else(|| group.members[0].effort.clone());
    group
        .members
        .iter()
        .find(|member| member.effort == requested)
        .map(|member| member.variant.model_uid.clone())
        .ok_or_else(|| {
            anyhow!("Devin model selection {key} does not support reasoning effort {requested}")
        })
}

fn groups(catalog: &DevinCatalog) -> Vec<Group<'_>> {
    let mut result = Vec::new();
    let mut index = 0;
    for family in &catalog.families {
        let mut buckets: Vec<Group<'_>> = Vec::new();
        for variant in &family.variants {
            let Some(max_context_tokens) = variant.max_context_tokens else {
                index += 1;
                continue;
            };
            let Some((effort, tier_label)) = effort_and_tier(family, variant) else {
                index += 1;
                continue;
            };
            let identity = GroupIdentity {
                family_uid: family.family_uid.clone(),
                tier_label,
                max_context_tokens,
            };
            if let Some(group) = buckets.iter_mut().find(|group| group.identity == identity) {
                group.members.push(GroupMember {
                    variant,
                    effort,
                    index,
                });
            } else {
                buckets.push(Group {
                    family,
                    identity,
                    members: vec![GroupMember {
                        variant,
                        effort,
                        index,
                    }],
                });
            }
            index += 1;
        }
        result.extend(buckets.into_iter().filter(|group| {
            group.members.len() > 1
                && group
                    .members
                    .iter()
                    .map(|member| &member.effort)
                    .collect::<HashSet<_>>()
                    .len()
                    == group.members.len()
        }));
    }
    result
}

fn effort_and_tier(
    family: &DevinFamily,
    variant: &DevinVariant,
) -> Option<(ReasoningEffort, String)> {
    if family.family_label.is_empty()
        || family.family_uid.is_empty()
        || family.slug.is_empty()
        || !variant.label.starts_with(&family.family_label)
    {
        return None;
    }
    let suffix_with_separator = &variant.label[family.family_label.len()..];
    if suffix_with_separator
        .chars()
        .next()
        .is_some_and(|separator| !separator.is_whitespace())
    {
        return None;
    }
    let suffix = suffix_with_separator.trim();
    if suffix.is_empty() || suffix.contains(['(', ')', '+']) {
        return None;
    }
    let tokens: Vec<_> = suffix.split_whitespace().collect();
    let mut matches = Vec::new();
    let mut consumed = HashSet::new();
    let mut token_index = 0;
    while token_index < tokens.len() {
        let token = tokens[token_index];
        if token.eq_ignore_ascii_case("no")
            && tokens
                .get(token_index + 1)
                .is_some_and(|next| next.eq_ignore_ascii_case("thinking"))
        {
            matches.push(ReasoningEffort::None);
            consumed.insert(token_index);
            consumed.insert(token_index + 1);
            token_index += 2;
            continue;
        }
        if let Some(effort) = known_effort(token) {
            matches.push(effort);
            consumed.insert(token_index);
            if tokens
                .get(token_index + 1)
                .is_some_and(|next| next.eq_ignore_ascii_case("thinking"))
            {
                consumed.insert(token_index + 1);
                token_index += 1;
            }
        }
        token_index += 1;
    }
    let [effort] = matches.as_slice() else {
        return None;
    };
    let tier_label = tokens
        .iter()
        .enumerate()
        .filter(|(index, _token)| !consumed.contains(index))
        .map(|(_, token)| *token)
        .collect::<Vec<_>>()
        .join(" ");
    Some((effort.clone(), tier_label))
}

fn known_effort(token: &str) -> Option<ReasoningEffort> {
    match token.to_ascii_lowercase().as_str() {
        "none" => Some(ReasoningEffort::None),
        "minimal" => Some(ReasoningEffort::Minimal),
        "low" => Some(ReasoningEffort::Low),
        "medium" => Some(ReasoningEffort::Medium),
        "high" => Some(ReasoningEffort::High),
        "xhigh" | "x-high" => Some(ReasoningEffort::XHigh),
        "max" => Some(ReasoningEffort::Max),
        "ultra" => Some(ReasoningEffort::Ultra),
        "persistent" => Some(ReasoningEffort::Persistent),
        _ => None,
    }
}

fn group_model_info(group: &Group<'_>, exact_keys: &HashSet<String>) -> Result<ModelInfo> {
    let first = &group.members[0];
    let display_name = if group.identity.tier_label.is_empty() {
        group.family.family_label.clone()
    } else {
        format!(
            "{} {}",
            group.family.family_label, group.identity.tier_label
        )
    };
    let mut info = model_info(
        group_key(group, exact_keys),
        format!("{display_name} (Devin)"),
        priority(first.index)?,
        group.identity.max_context_tokens,
        ModelVisibility::List,
    );
    info.default_reasoning_level = Some(first.effort.clone());
    let mut supported_reasoning_levels = group
        .members
        .iter()
        .map(|member| ReasoningEffortPreset {
            effort: member.effort.clone(),
            description: member.variant.label.clone(),
        })
        .collect::<Vec<_>>();
    supported_reasoning_levels.sort_by_key(|preset| effort_rank(&preset.effort));
    info.supported_reasoning_levels = supported_reasoning_levels;
    Ok(info)
}

fn exact_models(
    variant: &DevinVariant,
    index: usize,
    max_context_tokens: i64,
) -> Result<Vec<ModelInfo>> {
    let priority = priority(index)?;
    let mut models = vec![model_info(
        exact_model_key(&variant.model_uid),
        format!("{} (Devin)", variant.label),
        priority,
        max_context_tokens,
        ModelVisibility::List,
    )];
    if exact_model_key(&variant.model_uid) != legacy_model_key(&variant.model_uid) {
        models.push(model_info(
            legacy_model_key(&variant.model_uid),
            format!("{} (Devin)", variant.label),
            priority,
            max_context_tokens,
            ModelVisibility::Hide,
        ));
    }
    Ok(models)
}

fn exact_aliases(
    variant: &DevinVariant,
    index: usize,
    max_context_tokens: i64,
) -> Result<Vec<ModelInfo>> {
    let mut models = exact_models(variant, index, max_context_tokens)?;
    for model in &mut models {
        model.visibility = ModelVisibility::Hide;
    }
    Ok(models)
}

fn model_info(
    slug: String,
    display_name: String,
    priority: i32,
    max_context_tokens: i64,
    visibility: ModelVisibility,
) -> ModelInfo {
    let native_tools = super::super::native_runtime::enabled();
    ModelInfo {
        guardian: None,
        slug,
        model_provider: crate::devin::PROVIDER_ID.to_string(),
        display_name,
        description: None,
        default_reasoning_level: None,
        supported_reasoning_levels: Vec::new(),
        shell_type: if native_tools {
            ConfigShellToolType::UnifiedExec
        } else {
            ConfigShellToolType::Disabled
        },
        visibility,
        supported_in_api: true,
        priority,
        additional_speed_tiers: Vec::new(),
        service_tiers: Vec::new(),
        default_service_tier: None,
        available_access_programs: None,
        availability_nux: None,
        upgrade: None,
        model_messages: None,
        include_skills_usage_instructions: true,
        include_plugin_usage_instructions: false,
        include_apps_usage_instructions: false,
        supports_reasoning_summary_parameter: false,
        supports_reasoning_effort_updates: false,
        default_reasoning_summary: ReasoningSummary::Auto,
        support_verbosity: false,
        default_verbosity: None,
        apply_patch_tool_type: native_tools.then_some(ApplyPatchToolType::Freeform),
        web_search_tool_type: Default::default(),
        truncation_policy: TruncationPolicyConfig::tokens(max_context_tokens),
        supports_image_detail_original: false,
        context_window: Some(max_context_tokens),
        max_context_window: Some(max_context_tokens),
        auto_compact_token_limit: None,
        comp_hash: None,
        effective_context_window_percent: 100,
        experimental_supported_tools: Vec::new(),
        input_modalities: vec![InputModality::Text],
        used_fallback_model_metadata: false,
        supports_search_tool: false,
        supports_experimental_context: false,
        use_responses_lite: false,
        node_repl_auto_review_required: false,
        node_repl_disabled: true,
        auto_review_model_override: None,
        model_specialty: None,
        tool_mode: None,
        multi_agent_version: None,
        multi_agent_reasoning_effort: None,
    }
}

fn priority(index: usize) -> Result<i32> {
    i32::try_from(index)
        .context("too many Devin models")?
        .checked_add(10_000)
        .context("too many Devin models")
}

pub(super) fn unavailable_template(model: &str) -> ModelInfo {
    model_info(
        model.to_string(),
        model.to_string(),
        10_000,
        1,
        ModelVisibility::Hide,
    )
}

fn exact_keys(catalog: &DevinCatalog) -> HashSet<String> {
    catalog
        .families
        .iter()
        .flat_map(|family| family.variants.iter())
        .flat_map(|variant| {
            [
                exact_model_key(&variant.model_uid),
                legacy_model_key(&variant.model_uid),
            ]
        })
        .collect()
}

fn exact_model_key(model_uid: &str) -> String {
    format!("{DEVIN_PREFIX}{}", escape_component(model_uid))
}

fn legacy_model_key(model_uid: &str) -> String {
    format!("{DEVIN_PREFIX}{model_uid}")
}

fn group_key(group: &Group<'_>, exact_keys: &HashSet<String>) -> String {
    let tier = if group.identity.tier_label.is_empty() {
        "default".to_string()
    } else {
        escape_component(&group.identity.tier_label)
    };
    let base = format!(
        "{GROUP_PREFIX}{}/{}/{}",
        escape_component(&group.identity.family_uid),
        tier,
        group.identity.max_context_tokens
    );
    if !exact_keys.contains(&base) {
        return base;
    }
    let mut suffix = 1_u64;
    loop {
        let candidate = format!("{base}/{suffix}");
        if !exact_keys.contains(&candidate) {
            return candidate;
        }
        suffix = suffix.saturating_add(1);
    }
}

fn effort_rank(effort: &ReasoningEffort) -> usize {
    match effort {
        ReasoningEffort::None => 0,
        ReasoningEffort::Minimal => 1,
        ReasoningEffort::Low => 2,
        ReasoningEffort::Medium => 3,
        ReasoningEffort::High => 4,
        ReasoningEffort::XHigh => 5,
        ReasoningEffort::Max => 6,
        ReasoningEffort::Ultra => 7,
        ReasoningEffort::Persistent => 8,
        ReasoningEffort::Custom(_) => 9,
    }
}

fn escape_component(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            escaped.push(char::from(byte));
        } else {
            escaped.push('%');
            escaped.push_str(&format!("{byte:02X}"));
        }
    }
    escaped
}
