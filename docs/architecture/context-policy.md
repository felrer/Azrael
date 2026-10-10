# Provider context policy

Status: `partial`. Percentage-based settings and native policy are implemented below. Rust compilation, native configuration RPC checks, source and transformed-function checks, and all six isolated host acceptance stages passed; the tested package is installed. Installed rendering and real account 1M admission require separate verification.

The Anthropic 600,000-token default is implemented in source; release packaging and installation are pending.

## Context and automatic compaction

The engine resolves model context capacity, safe usable context and automatic compaction separately. Anthropic defaults to 600,000 tokens; other providers default to 95% of their model's no-length-surcharge input capacity. Both defaults are capped by the model's safe usable context. An exclusive pricing boundary uses its threshold as the baseline; an inclusive boundary uses one token below the threshold. The baseline cannot exceed model capacity. Models with no length surcharge use model capacity; models with unknown pricing also use capacity, with the uncertainty disclosed in settings. Headroom is a safety cap rather than another multiplication of the baseline. Thus OpenAI with a 272,000-token price boundary defaults to 258,400 tokens even with 1M capacity. Existing scope and output reservation behavior remains authoritative. The existing native compaction executor owns admission, summaries, errors and history replacement for managed providers, OpenAI and Devin.

`provider_auto_compact` is a map keyed by inference provider ID. Each entry contains an optional positive integer `percentage`; values above 100 are supported. The engine computes `floor(baseline × percentage / 100)` and caps the effective limit to safe usable context. A 200,000-token baseline at 500% requests 1,000,000 tokens. Existing optional positive integer `token_limit` entries remain explicit token settings until replaced by a percentage save. Percentage takes precedence when both fields are present. An empty entry selects the provider default: 600,000 tokens for Anthropic, or the dynamic 95% default for other providers. A custom percentage applies across that provider's models using each model's baseline. Resolution precedence is a provider entry, an explicitly configured global token limit, then the provider default. An explicit default provider entry overrides a legacy global limit. Configuration validation rejects zero, negative and noninteger values.

The selected model is resolved at each turn boundary. Saving and rereading settings updates the next turn of an existing thread; an active turn retains its captured policy. Child agents inherit the provider map and resolve their own provider/model. Resume, fork, provider handoff and model downshift use the same resolver. Existing handoff ordering and compaction queue semantics are preserved.

Bundled exact OpenAI models whose documented routes support 1M resolve their advertised maximum up to 1,000,000 tokens rather than treating a catalog's ordinary context window as the maximum. A lower remote maximum and an explicit configured context window remain authoritative. A local catalog limit does not prove that a particular account accepts 1M input, and output reservations can reduce the safe input budget.

## Pricing and usage

Pricing policy is independent of compaction. The native resolver binds each rule to provider, exact remote model and billing route, preserving the threshold operator. Its states distinguish confirmed pricing, an API reference for a subscription route, confirmed absence of a length surcharge, and unknown pricing. Unknown pricing does not mean free long context. Rules carry an official source URL; broad model-name prefixes do not establish eligibility.

The gauge retains its existing usage/capacity ratio. Muted yellow is based on separate full input tokens, including system instructions, tools and cached input, compared with the pricing threshold. Output or clamped display usage cannot establish the pricing tier. Normal sampling and compaction capture the policy for their actual request model and projected input. Projected counts carry an estimate flag; reported input replaces the estimate while retaining the request's provider/model identity. Cached input is already included in reported input and is counted once. Legacy usage without provenance cannot establish an exact price input for a newly selected model. Compaction below the threshold restores the ordinary color.

OpenAI's verified exact models cross the API reference boundary strictly above 272,000 input tokens. Verified Gemini Pro models cross strictly above 200,000. Verified xAI models use their documented inclusive 200,000 boundary. Verified Claude 4.6 pricing has no length surcharge. OpenRouter and unverified routes remain unknown unless their selected route provides a verified rule. Subscription reference pricing is labelled as a reference, without asserting extra billing.

## Settings and presentation

Azrael's Personalization page contains provider-specific automatic compaction controls. Each provider offers a gauge with a draggable native range handle and a synchronized positive integer percentage input, initially showing the percentage equivalent of 600,000 tokens for Anthropic (rounded to an integer), or 95% for other providers. The untouched Anthropic default preview retains the exact 600,000-token request; editing or saving the percentage uses the displayed percentage. The gauge extends to the selected model's safe usable capacity; percentage input may exceed the gauge maximum while the preview and effective limit remain capped. Save with reread and reset to default appear side by side. Settings display the preview model, baseline, requested and effective token limits and safe cap, followed by the saved compaction threshold and input token status. Repeated model identity, capacity, safe cap, pricing text and source URL are omitted from this trailing summary. The context gauge tooltip presentation is specified below. Save failures remain visible. Anthropic retains its 600,000-token default request when a model changes, with the effective limit capped by that model; other provider defaults recalculate from their model baseline.

Settings titles and labels use Azrael in English and localized UI. Native RPC identifiers, configuration keys and external Codex links retain their meanings. The gauge keeps its native usage/capacity ratio and separate pricing color. The tooltip presents the usage bases and pricing reference below; accessible text conveys the same information as color. Muted yellow must remain readable in light, dark and high-contrast themes.

Pinned assets are transformed by feature-owned injection scripts, with anchor checks, idempotence and cache fingerprints. Pristine upstream assets remain the source input. The engine owns the policy calculation and exposes it in initial configuration reads and turn usage notifications; the UI formats the result rather than maintaining another pricing resolver.

## Context tooltip presentation

Status: `partial` — source implementation; packaged and installed rendering remain unverified.

The tooltip uses a left-aligned layout with labels and right-aligned values. Under Usage, two rows show the same full input-token count divided by the effective automatic compaction threshold and by full model capacity, respectively. Each row includes the token count, denominator and percentage rounded to one decimal place. Tooltip ratios are independent of the native donut's existing ratio and are not clamped at 100%. Estimated input is marked on both rows; missing input or a missing/nonpositive denominator yields an unknown percentage.

A Model row shows provider and model identity. The Pricing reference section describes the length-surcharge threshold with its inclusive/exclusive operator, known absence of a length surcharge or unknown pricing. API reference rules retain the API label. The official source appears as a short Official documentation link rather than a raw URL. Context, Auto-compaction and Model information section titles, settings/source labels, a separate model-capacity row and subscription-billing explanatory text are omitted. The upstream tooltip summary is replaced rather than repeated. Accessible text includes both usage rows, model and pricing status, including the active pricing-boundary state.

The interactive card includes a native compaction button for the active conversation,
with keyboard access, a pending state and request/error feedback. It uses the
[manual request isolation](queued-compaction.md#manual-request-isolation) contract:
draft text and attachments remain in the composer, and streaming conversations can
queue the operation. This entry is `current` in source with native light/dark
rendering and interaction verification using synthetic host state. Build and
installation were not performed; installed-window acceptance remains separate.
