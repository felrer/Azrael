# Conversation Input diagnostics

<!-- architecture: {"id":"arch.conversation-input.diagnostics","feature":"conversation-input","layers":["ui","host"]} -->

## Submitted-input diagnostics

Status: `partial` — source fixtures exercise the actual instrumented state, queue and renderer boundaries; installed-host acceptance is separate.

Diagnostics track a submitted input's thread/client identity across parameter input, user message, steering message, queue consumption and render suppression. They distinguish representation changes from complete removal and record whether a queue receipt was accepted and persisted. Suppression reason changes can be observed without changing native render eligibility or submission behavior. Invalid identities and malformed snapshots are skipped; failures in instrumentation cannot replace the native result or error.

Records include bounded identifiers, representation counts, reason flags and history invalidation kind. Message content, attachment paths, model payloads and credentials are excluded. Snapshot scanning, event rate and deduplication state are bounded without background timers. Enablement follows [diagnostic logging](../../shared/diagnostics.md); the registered owner is `ui.input-diagnostics`.

The same preservation owner includes content-free Webview health diagnostics. The bootstrap reports JavaScript exceptions, unhandled rejections, script/link/image load failures, CSP violations, drag starts/blocked starts/terminal events, visibility and a 10-second heartbeat. The extension host assigns a random `webviewRef`, records HTML generation, startup phases/timeouts, disposal and intentional idle blank/restore boundaries, and validates the renderer's fixed fields before using the existing native logger. UI records are limited to 30/minute plus six reserved heartbeat records and host records to 60/minute per Webview; subsequent records expose lost-record counts. No content, URLs, paths, raw exceptions or stacks are added. A visible Webview with no signal for over 30 seconds is `signal_lost`, explicitly with `rendererExitConfirmed:false`; a host timer gap over 30 seconds is `host_observer_delayed`. Missing drag termination is evidence of an unfinished observed drag, not confirmation of iframe pointer blocking. These diagnostics do not alter input, reload or recover a view. Source fixtures establish the named paths; packaged/live and non-Windows acceptance remain separate. Retrieval and interpretation are owned by [Webview health diagnostics](../../../ops/webview-health.md).
