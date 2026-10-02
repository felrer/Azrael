# Provider context policy

Status: `partial`. Native policy and turn-boundary admission, transformed settings/gauge behavior, configuration roundtrips, synthetic Devin compaction and all six isolated packaged-host acceptance stages are verified. Real account 1M admission and rendered theme/accessibility behavior remain unverified.

## Context and automatic compaction

The engine resolves model context capacity, safe usable context and automatic compaction separately. Every provider defaults to `floor(resolved model context × 0.95)`, capped by the model's safe usable context. Headroom is a safety cap rather than another multiplication of the 95% baseline. Thus a 1,000,000-token model has a nominal 950,000-token threshold, a 272,000-token model 258,400 and a 200,000-token model 190,000. Existing scope and output reservation behavior remains authoritative. The existing native compaction executor owns admission, summaries, errors and history replacement for managed providers, OpenAI and Devin.

`provider_auto_compact` is a map keyed by inference provider ID. Each entry contains an optional positive integer `token_limit`. An entry without a token limit selects the dynamic 95% default. A custom limit applies across that provider's models and is capped for smaller models. Resolution precedence is a provider entry, an explicitly configured global limit, then the dynamic default. An explicit default provider entry overrides a legacy global limit. Configuration validation rejects zero, negative and noninteger limits; settings show the effective cap and source rather than promising an unsupported input budget.

The selected model is resolved at each turn boundary. Saving and rereading settings updates the next turn of an existing thread; an active turn retains its captured policy. Child agents inherit the provider map and resolve their own provider/model. Resume, fork, provider handoff and model downshift use the same resolver. Existing handoff ordering and compaction queue semantics are preserved.

Bundled exact OpenAI models whose documented routes support 1M may resolve up to 1,000,000 tokens. A lower remote capacity remains authoritative. A local catalog limit does not prove that a particular account accepts 1M input, and output reservations can reduce the safe input budget.

## Pricing and usage

Pricing policy is independent of compaction. The native resolver binds each rule to provider, exact remote model and billing route, preserving the threshold operator. Its states distinguish confirmed pricing, an API reference for a subscription route, confirmed absence of a length surcharge, and unknown pricing. Unknown pricing does not mean free long context. Rules carry an official source URL; broad model-name prefixes do not establish eligibility.

The gauge retains its existing usage/capacity ratio. Muted yellow is based on separate full input tokens, including system instructions, tools and cached input, compared with the pricing threshold. Output or clamped display usage cannot establish the pricing tier. Normal sampling and compaction capture the policy for their actual request model and projected input. Projected counts carry an estimate flag; reported input replaces the estimate while retaining the request's provider/model identity. Cached input is already included in reported input and is counted once. Legacy usage without provenance cannot establish an exact price input for a newly selected model. Compaction below the threshold restores the ordinary color.

OpenAI's verified exact models cross the API reference boundary strictly above 272,000 input tokens. Verified Gemini Pro models cross strictly above 200,000. Verified xAI models use their documented inclusive 200,000 boundary. Verified Claude 4.6 pricing has no length surcharge. OpenRouter and unverified routes remain unknown unless their selected route provides a verified rule. Subscription reference pricing is labelled as a reference, without asserting extra billing.

## Settings and presentation

Azrael's existing Configuration page contains provider-specific automatic compaction controls. Each provider offers dynamic default, positive integer custom tokens, save with reread and reset to default. The page displays the selected model's nominal and effective limits, source, safe cap and pricing information. Save failures remain visible. Default values recalculate when a model changes.

Settings titles and labels use Azrael in English and localized UI. Native RPC identifiers, configuration keys and external Codex links retain their meanings. The existing gauge and tooltip present pricing status, estimated-input state and automatic compaction threshold; accessible text conveys the same information as color. Muted yellow must remain readable in light, dark and high-contrast themes.

Pinned assets are transformed by feature-owned injection scripts, with anchor checks, idempotence and cache fingerprints. Pristine upstream assets remain the source input. The engine owns the policy calculation and exposes it in initial configuration reads and turn usage notifications; the UI formats the result rather than maintaining another pricing resolver.
