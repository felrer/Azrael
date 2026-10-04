export const OPENROUTER_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type CatalogReasoning = { supported_efforts: string[]; default_effort?: string; mandatory: boolean; default_enabled?: boolean };
export type OpenRouterReasoning = CatalogReasoning;

// Verified 2026-09-17 against GET /api/v1/models and the OpenRouter reasoning
// guide. Match exact versions/variants; new families must establish support.
const glm53 = new Set(['z-ai/glm-5.3', 'z-ai/glm-5.3:batch', 'z-ai/glm-5.3-flash', 'z-ai/glm-5.3-flash:batch']);
const allowed = (value: unknown): value is string => typeof value === 'string' && (OPENROUTER_EFFORTS as readonly string[]).includes(value);

export function validateCatalogReasoning(value: any): value is CatalogReasoning {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    && typeof value.mandatory === 'boolean'
    && (value.default_enabled === undefined || typeof value.default_enabled === 'boolean')
    && Array.isArray(value.supported_efforts) && value.supported_efforts.every(allowed)
    && new Set(value.supported_efforts).size === value.supported_efforts.length
    && (!value.mandatory || (!value.supported_efforts.includes('none') && value.default_enabled !== false))
    && (value.default_effort === undefined || value.supported_efforts.includes(value.default_effort));
}
export const validateOpenRouterReasoning = validateCatalogReasoning;

// A provider adapter may publish exact per-model effort ladders. Keep catalog
// choices limited to those declared rungs; an unknown model has no slider.
export function configuredModelReasoning(provider: { modelReasoningEfforts?: Record<string, string[]>; modelDefaultReasoningEfforts?: Record<string, string> }, modelId: string): CatalogReasoning {
  const declared = provider.modelReasoningEfforts?.[modelId];
  const supported_efforts = OPENROUTER_EFFORTS.filter(effort => Array.isArray(declared) && declared.includes(effort));
  const declaredDefault = provider.modelDefaultReasoningEfforts?.[modelId];
  return { supported_efforts, mandatory: false,
    ...(declaredDefault && supported_efforts.includes(declaredDefault as typeof OPENROUTER_EFFORTS[number])
      ? { default_effort: declaredDefault } : {}) };
}

export function normalizeOpenRouterReasoning(item: any): OpenRouterReasoning {
  const empty: OpenRouterReasoning = { supported_efforts: [], mandatory: false };
  const raw = item?.reasoning;
  if (raw !== undefined && (raw == null || typeof raw !== 'object' || Array.isArray(raw))) return empty;
  if (raw && ((raw.mandatory !== undefined && typeof raw.mandatory !== 'boolean')
    || (raw.default_enabled !== undefined && typeof raw.default_enabled !== 'boolean'))) return empty;
  const fallback = glm53.has(item?.id);
  const mandatory = raw?.mandatory ?? fallback;
  if (mandatory && raw?.default_enabled === false) return { supported_efforts: [], mandatory };
  const hasStages = raw && Object.hasOwn(raw, 'supported_efforts');
  let stages: string[];
  if (hasStages) {
    if (raw.supported_efforts === null) stages = [...OPENROUTER_EFFORTS];
    else if (Array.isArray(raw.supported_efforts) && raw.supported_efforts.every(allowed)
      && new Set(raw.supported_efforts).size === raw.supported_efforts.length) stages = raw.supported_efforts;
    else return { supported_efforts: [], mandatory };
  } else stages = fallback ? ['low', 'high', 'max'] : [];
  stages = OPENROUTER_EFFORTS.filter(effort => stages.includes(effort) && (!mandatory || effort !== 'none'));
  const defaultEnabled = raw?.default_enabled ?? (fallback ? true : undefined);
  let defaultEffort = raw?.default_effort ?? (fallback ? 'max' : undefined);
  if (!stages.includes(defaultEffort)) defaultEffort = undefined;
  if (defaultEnabled === false && !mandatory) defaultEffort = stages.includes('none') ? 'none' : undefined;
  return { supported_efforts: stages, mandatory,
    ...(defaultEffort === undefined ? {} : { default_effort: defaultEffort }),
    ...(defaultEnabled === undefined ? {} : { default_enabled: defaultEnabled }) };
}
