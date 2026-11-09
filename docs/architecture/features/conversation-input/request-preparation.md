# Conversation Input request preparation

<!-- architecture: {"id":"arch.conversation-input.request-preparation","feature":"conversation-input","layers":["ui","host","engine"]} -->

## Request preparation

Status: `current` in source and the Windows isolated installed-host request path; measured latency effects and other acceptance limits are recorded in [request latency work](../../../../work/EH-01-sol-medium-latency/03-plan.md). Preservation feature: `ui.request-preparation`.

After submission, request parameters and feature overrides are resolved before shell-environment and dynamic-tool reads start concurrently. Their results are applied in the native shell-policy and tool-registration order; developer instructions receive the resolved tool capabilities. Missing optional readers and shell-environment fallback retain native behavior. Both asynchronous reads have rejection handlers, and a failed tool read prevents request dispatch.

The host shares overlapping saved-configuration reads only within the same native connection. The frontend shares overlapping option-free account-list reads within one request client. Settled results and failures are removed immediately; the next read starts a new request. Writes and account mutation requests invalidate the corresponding pending entries; host account notifications and client version initialization also invalidate their owner's entries. An older read finishing cannot remove a newer entry. The existing cwd-effective configuration and option-sensitive request memoizer remain separate from saved configuration.

Sharing must not introduce a persistent account/configuration cache, weaken native account admission, omit instructions, or create native sessions while editing drafts. Account changes, configuration writes, cancellation and uncertain delivery retain their owning guards.
