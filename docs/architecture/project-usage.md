# Project usage value

Status: `current` — source accounting, storage, pricing and protocol tests plus rendered light/dark interactions are verified. Installed-host and live-provider billing acceptance are outside this source change.

## Daily project value

Usage is expressed as API-equivalent monetary value using the applicable provider/model rate policy. This value is distinct from an account quota percentage and from subscription payments. Actual response input, output, cache reads and cache writes must remain distinct during calculation; reasoning tokens already included in output must not be charged twice. Published context bands and request service tiers affect the per-response calculation before daily aggregation. Rate changes must not reprice money already recorded for an earlier day.

Currency is USD. Asia/Seoul midnight defines the day. Each observed completed response immediately updates a daily project/provider/model aggregate in the existing SQLite state database; transaction UPSERT serializes writers across windows and child sessions. Amounts are stored as integer nanoUSD, with priced and unpriced counts. There is no end-of-day buffer.

The new accounting store retains daily project aggregates, without adding request histories, message content or credentials. Existing native conversation and recovery records keep their owning contracts. Multiple windows and child agents must contribute to the same project totals without merging unrelated projects that have the same display name. Project comparisons use the execution project's identity, not the currently visible editor when a background request completes.

## Settings presentation

Settings' Usage page places project usage below its existing content. The first view is a calendar of day squares in the style of GitHub contributions; each day's color represents the aggregate amount across all projects. Hovering or focusing a day reveals its date and a comparison of that day's project amounts. No project is selected by default.

Below the calendar, the selected month's project totals appear as descending horizontal bars. The project with the largest monetary amount occupies 100% of the bar's available width; every other width is its amount divided by that maximum. Zero totals do not produce division errors. Hovering or focusing a bar reveals its amount. Month navigation uses compact existing-style buttons. Calendar and ranking layout adapt to the available width.

Visible text is limited to essential date navigation, project identification and values needed for comparison. Detailed values and accounting status belong in hover/focus details. Native theme tokens and typography boundaries apply to light and dark themes. Keyboard focus exposes the same information as hover, and accessible names preserve date and project/value identity despite the minimal visible text.

## Calculation and delivery boundaries

Context-window token estimates and replayed usage notifications are not new consumption. The collector must receive observed response usage with the effective request model and provider attribution before UI delivery. A missing observation or unverified rate cannot establish a zero monetary cost. Delivery failures, cancellation and requests with incomplete pricing dimensions require an explicit accounting status rather than an invented precise amount.

The actual-response hook covers sampling, supported compaction, handoff and child sessions where a completed usage observation reaches it. Integration must identify unobserved charged requests and avoid claiming billing completeness beyond those observations. A bounded process-memory response identity set suppresses duplicate live completion delivery. Restored token snapshots and conversation replay do not invoke the collector. No durable response identities are stored; exactly-once accounting across process crashes or duplicate delivery from separate engine processes is not guaranteed by daily-only storage. Committed aggregates survive normal restarts.

The rate card records verified official source URLs and verification dates. Unsupported identities or tiers, estimated usage, missing authoritative Claude cache TTL splits and session-wide pricing without the required session band increment an unpriced count. Devin has no verified public token tariff and remains unpriced. Gemini cache storage, external tools, image-dependent charges and regional processing premiums not carried by observed request fields are outside this token-value estimate. Malformed billing-only cache metadata marks the observation estimated/unpriced while preserving a valid chat completion. The UI exposes these incomplete observations with compact hover/focus status instead of invented zero amounts.

The read-only `azrael/projectUsage` request accepts a year and returns USD daily project totals across providers/models. The Usage view refreshes only while visible, rejects stale requests after year changes, retains same-year data on query failure and displays a compact error indicator. No historical conversation backfill is performed.
