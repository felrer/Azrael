# Provider accounts and managed inference

Procedures for provider account management, model discovery and managed inference. Designs are owned by [accounts and usage](../architecture/accounts.md) and [managed providers](../architecture/managed-providers.md).

## Verified scope

- **Deterministic engine fixtures:** all directed Google/xAI/OpenRouter transitions in one thread, A→B→A, native OpenAI and Devin boundaries, dynamic tools, restart/resume, fork, compaction with recall, partial-stream cancellation, credential exclusion, provider handoff (opaque-source summary, quota fallback, summary cancellation/retry, no tool replay), mid-tool catalog loss and refresh failure, complete picker pagination and one discovery per explicit refresh. These use loopback providers, not live inference.
- **Live:** Google Antigravity catalog discovery; `gemini-3.8-flash` text and a harmless tool/result round trip through the helper and one native engine turn. Claude reasoning selection was verified with synthetic inference only.
- **User-verified:** login, provider quota accuracy, rendered picker behavior and live inference for other providers and models. The stored Anthropic subscription login needs reauthentication before its live Models API can be checked.

## Using the page

While visible, the accounts and usage page automatically refreshes every two minutes. Opening the page and manual refresh still request an immediate update.

`azrael.manageAccounts`, `azrael.usage` and `azrael.devinAccount` open the same page. OAuth login uses the upstream provider flow, and cancelling a login stops only that operation's helper. Provider icons group account rows with always-visible remaining-usage gauges. Click a row or gauge, or use Enter/Space on a focused row, to open management details. The gray **현재 로그인** badge identifies the active OpenAI profile, connected selected provider account without a reauthentication requirement, or logged-in Devin CLI identity. For providers this describes new-chat selection, not successful inference or the account pinned to an existing chat. Connection/default-account information appears in details; automatic-switch permission remains independent. The presentation contract is owned by [Accounts and usage](../architecture/accounts.md#provider-groups-and-account-summaries).

To use a newly connected provider: reload the window after installation, open a new chat, expand the provider's section in the model picker, and use the picker's refresh action if discovery is still pending. Selecting a model never rotates accounts; the selected account becomes the binding for the provider's next new thread.

## Storage and runtime

OpenAI profiles use the native keyring under `~/.azrael-ex/azrael/accounts`. Other providers use pinned opencodex modules (`9f7397ed1582d95c6c1fcf4ae9951213b3fa2d19`) run by pinned Bun under `artifacts/tools/bun-*`, packaged with the release and selected through the host's scoped environment. `OPENCODEX_HOME` is fixed to `~/.azrael-ex/azrael/providers/opencodex`, which holds upstream's `auth.json`, config/API-key pools and `catalog/openrouter.json` (model metadata and an identity fingerprint, no key). Never include this directory in diagnostics, copy it between accounts, or treat it as build output.

The provider bundle manifest (schema 2) hashes the account helper, runtime, dependencies and the `inferenceHelper`; preparation sets `AZRAEL_PROVIDER_INFERENCE_HELPER`. A missing or modified bundle fails verification. Releases with a schema 1 bundle offer accounts only and clear any ambient inference helper.

## Discovery and caching

OpenRouter discovery includes models whose metadata supports text input, text output and tools. The catalog cache is fresh for five minutes; the picker refresh button forces a lookup. Transient failures may show a clearly marked previous roster for up to 24 hours. Authentication failure, an authoritative empty roster or a changed identity never reuses old model IDs. Adding, selecting or removing a key invalidates the provider's discovery cache. Discovery snapshots use schema 2; older snapshots are rediscovered. The app-server startup refresh worker forces an immediate refresh that can overlap a picker request, so tests that count refreshes must wait for startup to complete.

Anthropic refreshes its roster only on explicit refresh, which the UI triggers after a successful `thread/start`. Google Antigravity uses the vendored configured model list and excludes image-output models.

Discovery makes read-only metadata requests and never runs inference. Catalog failures are logged in the engine log with the provider and a closed error code, without credentials or upstream responses. The model-list response carries `providerCatalogs` separately from selectable models.

## Validation

For account-summary presentation, run `npm run build:incremental` in `extensions/azrael-ex`, then `node --test dist/test/usagePresentation.test.js dist/test/usageViewRefresh.test.js dist/test/usageTimerView.test.js dist/test/usageTicketView.test.js dist/test/resetCredit.test.js`. From the project root, run `node --test scripts/test-account-settings.cjs`, `node scripts/verify-account-overview-render.mjs` and the existing `node scripts/verify-ticket-usage-render.mjs` ticket regression check. The overview renderer exercises compiled production markup and both event-handler routes in light/dark host themes at desktop and narrow widths, with synthetic account services and pinned native CSS. It checks white surfaces, gray badges, collapsed gauges, click/keyboard expansion and provider auto-switch identity. Logs and rendered screenshots are retained under `artifacts/logs/accounts-usage-redesign/`; the owned browser fixture/profile is removed through the guarded cleanup script. These checks accept source presentation and interaction, not installed navigation or live account/quota accuracy.

```powershell
# from providers/opencodex, with the pinned Bun
bun test --timeout 30000 tests/catalog.test.ts tests/reasoning.test.ts tests/inference.test.ts
# from the project root
node --test scripts/test-provider-model-picker.cjs scripts/test-provider-accounts-host.cjs
node scripts/check-managed-native-engine.mjs <codex.exe> <fresh-run-directory>
node scripts/check-managed-native-engine.mjs <codex.exe> <fresh-run-directory> --devin-handoff-only --release-directory <release-directory>
# from the engine source's codex-rs
cargo test -p codex-core managed_catalog
```

The `--devin-handoff-only` scope uses a synthetic Devin peer and loopback OpenAI endpoint to cover normal, exhausted-quota, fork/restart, generic-400 and rate-limit boundaries. It verifies public history and exact tool results, excludes source reasoning and does not perform live inference.

The extension's own tests run with `npm test` in `extensions/azrael-ex`. Account tests use fake helper peers or original upstream functions with fresh fixture state. `check-managed-native-engine.mjs` must inject the catalog fetch seam and reject Node HTTP/socket transports, because the vendored router canonicalizes provider URLs; a run without that guard can reach real endpoints and is not isolated. `scripts/check-live-provider-turn.mjs` performs a real, paid provider turn and is run only with explicit approval, using an ephemeral, read-only thread and removing its probe binding afterwards.

## Diagnostics

The **Azrael provider accounts** output channel records request ID, action, start/completion/failure and elapsed time, without raw provider errors, stderr, credentials, login URLs or response bodies. For a report, supply the host version, timestamp, action and the matching bounded records; never attach account storage or full session history. General engine error inspection is described in [native diagnostics](native-diagnostics.md).
