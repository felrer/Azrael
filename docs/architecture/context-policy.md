# Provider context policy

Status: `partial`. Model-specific settings and native policy are implemented in source. Scoped policy tests and production settings rendering with pinned native components/CSS pass on Windows in light, dark and narrow layouts. Packaging, installation, changed-engine RPC acceptance and real-account long-context admission remain separate.

## Context and automatic compaction

The engine resolves model context capacity, safe usable context and automatic compaction separately. Native OpenAI subscription routes (Chatgpt or ChatgptAuthTokens authentication, excluding managed routes) use their actual resolved context capacity as the percentage baseline and target an exact 300,000-token default: 30% at 1M, 75% at 400K. Smaller models and lower remote/configured limits keep their actual capacity, with the default capped by safe usable context; no model is promoted to 1M solely for this policy. Other routes default to 95% of their no-length-surcharge input capacity. Anthropic models with a resolved context window of at least 1,000,000 tokens use an exact 600,000-token default; smaller Anthropic models use the ordinary 95% rule. All defaults are capped by the model's safe usable context. An exclusive pricing boundary uses its threshold as the baseline; an inclusive boundary uses one token below the threshold. The baseline cannot exceed model capacity. Models with no length surcharge use model capacity; models with unknown pricing also use capacity, with the uncertainty disclosed in settings. Headroom is a safety cap rather than another multiplication of the baseline. Thus an OpenAI API route with a 272,000-token price boundary defaults to 258,400 tokens even with 1M capacity. Existing scope and output reservation behavior remains authoritative. The existing native compaction executor owns admission, summaries, errors and history replacement for managed providers and OpenAI. Devin retains explicit context-limit failures because native compaction is unavailable for Devin threads.

`provider_auto_compact` is keyed by inference provider ID. Each provider entry may contain positive integer `percentage` or `token_limit` fields and a `models` map keyed by the exact catalog model ID, including the full `managed/<provider>/<model>` slug. Each model entry contains optional positive integer `percentage` or `token_limit` fields. Percentage takes precedence over tokens, computes `floor(baseline × percentage / 100)` and is capped to safe usable context; values above 100 are supported. An empty model entry explicitly selects that model's dynamic default. Resolution precedence is a model entry, a provider's explicit fields or empty default entry, a configured global token limit, then the model default. A provider containing only model entries allows unconfigured siblings to inherit the global limit. Existing provider settings and explicit token limits are preserved. Saving or resetting a model replaces only its nested entry and leaves siblings and provider settings intact. Configuration rejects zero, negative and noninteger values.

The selected model is resolved at each turn boundary. Saving and rereading settings updates the next turn of an existing thread; an active turn retains its captured policy. Child agents inherit the provider map with its model entries and resolve their own provider/model. Resume, fork, provider handoff and model downshift use the same resolver. Existing handoff ordering and compaction queue semantics are preserved.

Bundled exact OpenAI models whose documented routes support 1M resolve their advertised maximum up to 1,000,000 tokens rather than treating a catalog's ordinary context window as the maximum. A lower remote maximum and an explicit configured context window remain authoritative. A local catalog limit does not prove that a particular account accepts 1M input, and output reservations can reduce the safe input budget.

## Pricing and usage

### Per-thread automatic compaction

Status: `partial` — implemented in source. Windows scoped native tests verify thread defaults, isolation, durable settings, resume, disabled automatic admissions and preserved manual compaction. Pinned native UI source/render tests pass in light and dark modes. Changed-engine RPC acceptance, packaging, installation and Linux/macOS execution remain unverified.

The usage card exposes a native **Automatic compaction** switch scoped to the selected thread. Every new thread, including forks and subagents, starts enabled. Resuming an existing thread restores its own saved value. Toggling a parent does not affect children, siblings or provider/model defaults. Disabling prevents automatic threshold, rollover, model-change and context-error compaction; manual and queued manual compaction remain available. Quota recovery that requires compacting public history retains the original quota error while disabled, preserving history and account binding. Full context and provider request limits remain authoritative. The native thread settings owner persists the value and acknowledges changes; failed reads or writes expose a retryable error without claiming a successful change. Changes apply to subsequent automatic admissions in the active thread and do not cancel a compaction already admitted.

With automatic compaction disabled, the first gauge lap is input / automatic threshold. At or above that threshold, the gauge turns muted yellow and starts a second lap with (input − automatic threshold) / (full context capacity − automatic threshold), clamped to 0–100%. The second lap is zero at the threshold and full at total capacity. The card and accessible description identify the extra capacity so color is not the sole signal. Invalid or unavailable positive limits retain native usage fallback. Enabling restores the ordinary first-lap display and compaction policy. Independent pricing warnings remain visible.

Pricing policy is independent of compaction. The native resolver binds each rule to provider, exact remote model and billing route, preserving the threshold operator. Its states distinguish confirmed pricing, an API reference for a subscription route, confirmed absence of a length surcharge, and unknown pricing. Unknown pricing does not mean free long context. Rules carry an official source URL; broad model-name prefixes do not establish eligibility.

With automatic compaction enabled, the chat gauge uses full input tokens divided by the effective automatic compaction threshold, clamped to 0–100%. Disabled threads use the two-lap policy above. When input tokens or a positive threshold are unavailable, it retains the native usage/capacity ratio. Muted yellow is based on separate full input tokens, including system instructions, tools and cached input, compared with the pricing threshold. Output or clamped display usage cannot establish the pricing tier. Normal sampling and compaction capture the policy for their actual request model and projected input. Projected counts carry an estimate flag; reported input replaces the estimate while retaining the request's provider/model identity. Cached input is already included in reported input and is counted once. Legacy usage without provenance cannot establish an exact price input for a newly selected model. Compaction below the threshold restores the ordinary color.

Native OpenAI subscription policy has no length-surcharge threshold, so it does not use the API boundary for the baseline or pricing color. This is the requested product policy, not a verification of every account's actual billing. OpenAI's verified exact API models cross the API boundary strictly above 272,000 input tokens. Verified Gemini Pro models cross strictly above 200,000. Verified xAI models use their documented inclusive 200,000 boundary. Verified exact Claude 4.6 and later Opus, Sonnet and Fable models have no length surcharge; Claude Haiku 5.5 crosses strictly above 100,000 input tokens. Exact Gemini Flash routes with confirmed flat rates use their full capacity as the baseline. OpenRouter and unverified routes remain unknown unless their selected route provides a verified rule. Subscription reference pricing is labelled as a reference, without asserting extra billing.

## Settings and presentation

Azrael's Personalization page uses native OpenAI-style settings rows, cards and buttons. Provider and model selectors expose every returned catalog policy. The selected model shows context capacity, the pricing boundary (including its operator and API reference status), and its default compaction threshold. Unknown pricing remains visibly unknown. A synchronized percentage input and range slider control the model's own baseline; a live token value shows the effective threshold, with requested and safe-limit values only when capped. Saving replaces that model's setting and rereads configuration. Reset writes an empty model entry to select the dynamic default regardless of provider/global settings. Untouched token-based defaults save as explicit default entries: native OpenAI subscriptions retain exactly 300,000 tokens or their lower safe cap, and 1M Anthropic models retain exactly 600,000 tokens rather than a rounded percentage. The displayed subscription percentage reflects the model capacity; editing it selects a percentage override. An untouched explicit token setting previews its exact token value. Drafts are keyed by provider and exact model identity and survive selector changes; saved, unsaved, inherited, loading, empty and failed states remain visible. Host changes invalidate late reads and mutations. Settings apply from the next turn. Official pricing links use short labels; duplicated model/status prose and unknown current-chat usage are omitted. The chat context tooltip retains the independent usage presentation below.

Settings titles and labels use Azrael in English and localized UI. Native RPC identifiers, configuration keys and external Codex links retain their meanings. The chat gauge uses the automatic compaction ratio and retains the separate pricing color. The tooltip presents the usage bases and pricing reference below; accessible text conveys the same information as color. Muted yellow must remain readable in light, dark and high-contrast themes.

Pinned assets are transformed by feature-owned injection scripts, with anchor checks, idempotence and cache fingerprints. Pristine upstream assets remain the source input. The engine owns the policy calculation and exposes it in initial configuration reads and turn usage notifications; the UI formats the result rather than maintaining another pricing resolver.

## Context tooltip presentation

Status: `partial` — source implementation; packaged and installed rendering remain unverified.

The tooltip uses a left-aligned layout with labels and right-aligned values. Under Usage, two rows show the same full input-token count divided by the effective automatic compaction threshold and by full model capacity, respectively. Each row includes the token count, denominator and percentage rounded to one decimal place. The donut follows the per-thread first/second-lap policy above, clamped to 0–100%; tooltip ratios are not clamped at 100%. Estimated input is marked on both rows; missing input or a missing/nonpositive denominator yields an unknown percentage.

A Model row shows provider and model identity. The Pricing reference section describes the length-surcharge threshold with its inclusive/exclusive operator, known absence of a length surcharge or unknown pricing. API reference rules retain the API label. The official source appears as a short Official documentation link rather than a raw URL. Context, Auto-compaction and Model information section titles, settings/source labels, a separate model-capacity row and subscription-billing explanatory text are omitted. The upstream tooltip summary is replaced rather than repeated. Accessible text includes both usage rows, model and pricing status, including the active pricing-boundary state.

The interactive card includes a native compaction button for the active conversation,
with keyboard access, a pending state and request/error feedback. It uses the
[manual request isolation](queued-compaction.md#manual-request-isolation) contract:
draft text and attachments remain in the composer, and streaming conversations can
queue the operation. This entry is `current` in source with native light/dark
rendering and interaction verification using synthetic host state. Build and
installation were not performed; installed-window acceptance remains separate.

### Current response throughput

Status: `partial` — implemented in source. Windows scoped native aggregation, turn-timing, replay/notification baseline and wire-conversion tests pass. Pinned native UI tests pass in light, dark and narrow layouts. Changed-engine RPC acceptance, packaging, installation and Linux/macOS execution remain unverified; evidence and performance measurements are tracked in [the work plan](../../work/BO-01-session-tps/01-plan.md).

The context tooltip includes a left-label, right-value **Current response average TPS** row, formatted to one decimal token per second, also available through keyboard focus and the gauge's accessible description. Current response means the current native turn, including its model/tool cycles; a new turn starts a new measurement. Child conversations have independent measurements. The mean is the sum of observed output tokens divided by the sum of those requests' elapsed seconds. Request time includes provider wait, input processing and transport; tool execution and idle intervals outside requests are excluded. This is observed request throughput, rather than server-only decode speed. Reasoning tokens already included in output are not counted again.

The engine captures a monotonic clock at inference admission and completion and publishes a bounded turn snapshot through the existing token-usage notification and rollout/replay path. There is no per-token tokenizer, new polling, benchmark request or hover-triggered inference. Values update on completed model requests. Before the current turn has a valid completed observation, the row shows **Waiting for measurement**. Uninstrumented historical records show **Unavailable**. Missing/estimated output, failed or cancelled requests and invalid durations do not manufacture token counts or zero rates; the row indicates partial observations when applicable. Zero reported output over a valid duration remains a valid zero. Starting a new turn must not display the previous turn's TPS as current. The latest persisted snapshot retains turn identity on attach/reload and cannot be re-counted as new consumption.

This shared feature targets local Windows x64, glibc Linux x64 and Apple Silicon macOS, with actual verification limited to its recorded environments. No platform support or permission boundary is expanded. Preservation mapping: `engine.response-tps` and the existing `ui.provider-context` checks.

The same tooltip includes an explicitly **estimated** minute graph. Provider output totals are proportionally allocated across each completed request's overlap with minute boundaries measured from turn start. A bucket divides its allocated output by its measured request overlap, rather than by a full minute of wall time. These points describe estimated per-minute request throughput, not observed token emission timestamps. Missing/tool-only minutes break the line; zero observed output remains a zero point. A single measured bucket is a dot. In-progress unreported tokens are not extrapolated, and historical snapshots without samples do not fabricate a curve.

#### Recent request graph

Status: `implemented` — Windows source verification is recorded in [the work plan](../../work/BO-01-session-tps/02-plan.md). Product packaging and installation are separate.

The graph preserves measurements across user turns within the same conversation and shows the 40-minute span ending at the snapshot's observation time. The current-response average remains scoped to the current turn and shows waiting before its first completed observation. Turn admission publishes a new boundary immediately; replay retains the same turn identities, start times and history without accumulating duplicate observations. Boundaries use dashed vertical lines, with local start times formatted only as **HH:mm** below the graph. Different turns and missing measured minutes are never joined. Child conversations retain separate histories.

Each inference admission captures its selected service tier. Standard is blue, Fast is orange and Ultrafast uses the existing purple theme color; changing the selection does not recolor previous observations. Mode labels supplement color. Old records lacking time or mode metadata do not acquire fabricated start times or a guessed speed mode.

The native **Mode averages** toggle defaults to off for each conversation. When enabled, matching colored dashed horizontal lines and labelled values show each measured mode's output-token sum divided by its measured request-time sum within the visible window. Overlapping edge buckets are proportionally clipped as estimates. Tool execution and idle gaps remain excluded, valid zero output remains zero, and unmeasured modes produce no average line. The window affects the graph and mode means without reducing the whole-turn average. The additive snapshot fields use the existing token-usage notification, rollout and attach/reload path, with no polling or per-token processing.

## Final helper request input budget

Status: `partial`. Source implementation and Windows helper/transport fixture
checks are available; packaging, installation, other platforms and real-account
token accuracy remain unverified.

Managed OAuth and native Devin requests use a bounded, inference-free helper
estimate after the final prompt, tools and Guardian projection are prepared.
The estimate uses the same provider request transformation as inference. Managed
requests measure the built provider body; Devin measures the serializer's system
folding and sanitized tool definitions. The helper retains no prepared body across
requests, so inference repeats that transformation with the current account pin.
OpenAI native and user API requests keep their existing admission paths.

The engine applies the selected model's existing automatic compaction threshold,
scope and usable-input cap to supported estimates before generation. Compaction
uses the existing executor, then rebuilds and measures the request; bounded
attempts prevent loops when required instructions or tools alone exceed the
budget. Devin keeps an explicit limit error because its native compaction is
unavailable. Prefix accounting belongs to the current model and context window.
Authentication failures, invalid input, cancellation and transport-byte limits
keep their existing errors. An unsupported local estimate uses the existing
context estimate instead of manufacturing a complete count.

Token counts remain local estimates. Managed text reuses the existing model-aware
character/CJK estimator without clamping at capacity; Devin uses the existing
byte-based approximation on projected input. Base64 length is recorded separately
from text tokens. Images or unrecognized content prevent use of a text-only budget
for admission until their token accounting is supported. Output reservation and
model policy remain authoritative; cached tokens do not reduce context occupancy.

Optional inference diagnostics record numeric component sizes and text estimates,
image counts, a hashed model identity and the actual normalized input usage for
the same request. The observed residual is reported input minus estimated text;
it includes provider overhead and, where present, image input, so it is not proof
of tokenizer error. Estimated provider usage is marked and has no actual residual.
No text, images, tool identifiers, credentials or raw model identity enter this
evidence. Existing diagnostic controls, SQLite retention and safe export apply.
Automatic calibration remains inactive until sufficient non-estimated usage
samples justify a model-specific correction. This implementation adds a local
helper launch before inference; fixture timing does not establish installed
application latency.

## Preservation mapping

Registered features: `ui.provider-context`, `engine.provider-context`, `engine.thread-auto-compaction-integration`. The provider-context native gate runs the auto-compaction library contracts; the separate integration gate runs the `codex-core --test all auto_compaction` token-budget scenario. Full engine regression includes both. Focused deployment conservatively includes integration for engine, related verification-policy or uncertain source-impact changes, including an external engine source or an empty change list. A clearly unrelated focused change can omit that large integration harness while retaining the library contracts. This changes check selection, not compaction behavior or token-budget authority. The [contract index](upstream-preservation.md#contract-index) links to the executable inventory. Each section's stated source, native, package, installed and platform limits determine what that registered scope establishes; broader behavior is reviewed separately.
