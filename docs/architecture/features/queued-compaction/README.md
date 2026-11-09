# Queued Context Compaction

<!-- architecture: {"id":"arch.queued-compaction.contract","feature":"queued-compaction","layers":["ui","host","engine"]} -->

Status: `current`, verified in scoped source and host-function tests; live
compaction UI behavior is user-verified. Procedure and verification scope are in
[operations](../../../ops/development.md#queue-and-compaction).

Manual compaction from the context gauge card or chat composer enters the durable server queue alongside
user messages. Items execute in queue order without interrupting the current turn.
An idle thread may immediately consume the head. Compaction is a distinct operation,
never a prompt instructing the model to compress its context. The existing queue
owns persistence, cancellation, reordering, cross-window notifications and pause
after interruption. Repeated requests remain individually cancelable items.

## Manual request isolation

Status: `current` in source, verified with scoped pinned-function fixtures and
native context-card rendering/interactions in light and dark themes. Build and
installation were not performed; installed-window acceptance remains separate.

The card's compaction button invokes the existing queue operation for the active
conversation without reading or submitting the composer. Draft text and all
attachments remain editable. Pending requests prevent duplicate button activation;
success acknowledges the request, and a failure exposes a retryable error.
An active response does not prevent enqueueing compaction.

An inline `/compact` selection owns its composer action until the host request
finishes. A concurrent ordinary submit cannot serialize the remaining draft or
attachments during that action. An ordinary local submit beginning with the
standalone `/compact` command is handled before context construction or message
submission. It sends only the conversation identity to the existing compaction
entry point. Success removes only the command prefix when the editor still matches
the submitted text, preserving remaining text and every attachment. Failure and
newer editor changes preserve the draft. Literal prompt submissions retain their
ordinary message meaning.

## Compaction progress

The Responses parser forwards `response.compaction.compacting` as internal
progress. Remote v2 compaction reaffirms its context-compaction item once per
response attempt, keeping the item ID and original start time; repeated
heartbeats are coalesced. Completion is emitted only after the completed response
is validated and the compacted history installed. When compaction progress
starts, the host removes only same-turn transient `willRetry: true` error rows;
terminal errors, other turns and other items stay. Repeated starts keep the
existing manual/automatic source without consuming a later pending manual request.
No public protocol or stored context format changes.

### Local compaction completion (target)

Each local compaction response attempt buffers output until `response.completed`.
Failed, incomplete or disconnected attempts leave no partial summary in live or
persisted conversation history; retries and resumed sessions retain the original
messages and tool results. Successful non-post-turn output retains compaction
metadata and emits raw item notifications before the response-completed
notification. Post-turn summaries keep their existing success-only installation.
This shared contract applies to Windows x64, Linux x64 and macOS ARM64; native
verification remains separate for each target.

A cached Responses WebSocket connection counts as closed when its command channel
closes or its background pump terminates, even if the stream wrapper still exists;
the client then reconnects, clearing connection-local continuation state and
sending the full next input. Healthy connections are reused. A peer closing after
the health check still goes through the existing bounded retry path.

Verification must cover message/compaction ordering, cancellation and reordering,
fresh usage at execution, below/equal/above threshold, absent usage, busy admission,
restart persistence, skipped-head continuation, queue refresh races and host routing.
Runtime installation and real compaction UI acceptance are separate from source and
controlled-transport verification.

## Preservation mapping

Registered features: `ui.compaction-progress`, `ui.queue-refresh`, `ui.queue-consumption`, `ui.queued-compaction`. The [contract index](../../shared/feature-preservation.md#contract-index) links to the executable inventory. Each section's stated source, native, package, installed and platform limits determine what that registered scope establishes; broader behavior is reviewed separately.

## Related design owners

- [Unanswered asynchronous questions](../input-queue/execution.md)
- [Locally accepted submission results](../input-queue/ui.md)
