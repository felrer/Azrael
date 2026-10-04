# Reload and resume recovery

Status: `current`, verified with automated state, bridge, native crash/restart and isolated-host checks; manual reload of a live session is user-verified. Procedure and verification scope are in [operations](../ops/development.md#reload-recovery).

## Behaviour and ownership

The integrated host owns recovery presentation and admission for resume requests. The native engine remains the authority for live thread/turn state, thread writer ownership and interruption. Its existing `thread/read` and `thread/resume` normalization marks historical in-progress turns interrupted when no live turn exists; the host does not rewrite rollout files or invent engine state.

The host records a bounded resume receipt in VS Code workspace state before dispatch. It records an operation identifier, a hash of request parameters, client message identity when supplied, dispatch state and acknowledged turn identifier, never prompt or tool contents. The write must finish before dispatch. Concurrent identical resume attempts share one promise. A standalone continue request or the native empty-input resume action attaches to an already active turn instead of injecting another continue. Ordinary new instructions retain native steering behaviour.

### Persisted delivery reconciliation

Status: `partial`: host state and bridge regressions verified; installation and user-window acceptance pending.

An inactive thread's unresolved receipt can be reconciled against at most 20 native turns using its saved client message identity. Only an exact user-message identity on a completed, interrupted or failed turn confirms acceptance. The receipt becomes finished and a retry returns that existing turn without sending new input. Missing identity, absent or malformed history, changed connection and failed storage preserve the unresolved guard. Legacy receipts without identity require the existing explicit reviewed recovery action. The error names the Command Palette path `azrael: 실행 상태 및 복구` and its reviewed new-continuation action.

For an idle thread, the native UI's empty-input play action becomes a canonical `continue` text input while preserving its other parameters. The selected engine rejects an empty turn input, so this conversion is performed only after live-state admission; it is never injected into an already active turn.

A `systemError` thread may also admit an explicit continuation when its latest turn is `failed` with error category `other` and an exact known native inference timeout message: legacy helper idle, legacy no-output-frames for 120 seconds, engine request deadline, or helper failure with `provider_headers_timeout`, `provider_stream_idle` or `provider_request_deadline`. These errors have no dedicated protocol category, so admission matches only these engine-generated messages, not arbitrary text containing “timeout”. The same allowlist owns safe diagnostic classification and applies after loading a thread. Failures outside the timeout, usage-exhaustion and provider-rejection rules remain blocked. Active-turn attachment, persisted outcome-unknown guards and concurrent-request coalescing still apply; there is no automatic retry or tool replay.

### Manual continuation after an unclassified provider rejection

Status: `current` for state, pinned bridge and send integration regressions; installed user-window acceptance requires an updated host and reload.

A failed `systemError` turn with category `other` and the exact native message `미분류 오류: native inference helper failed (provider_http_400)` admits an explicit continuation or play action. This supports previously recorded provider rejections without rewriting their history or asserting that the underlying cause was quota exhaustion. Diagnostics classify the outcome as `provider_request_rejected`. The current selected account/model remains engine-owned, and live-turn attachment, unresolved delivery guards and duplicate-request coalescing apply. Automatic retries and tool replay are not authorized by this rule.

### Continuation after usage exhaustion

Status: `current`, verified with host state and bridge regression tests. Installed user-window inference is outside this verification scope.

A `systemError` thread whose latest turn is `failed` with structured error category `usageLimitExceeded` admits a user's explicit continuation, including the play action, after an account switch or a quota reset. The engine uses its current account selection and determines whether inference can proceed; the host does not require account-change evidence or infer available quota. Account updates alone do not dispatch a continuation. The category is classified as `usage_limit_exceeded` in diagnostics without recording the message. Message text alone cannot admit a usage-limit failure. This rule also applies after loading a thread, with the same active-turn attachment, outcome-unknown receipt guards and concurrent-request coalescing as other continuations.

After reconnect, resume reads native live state. An acknowledged turn can be reattached by identity. A receipt left dispatching without an acknowledged result is outcome-unknown: no automatic replay. Live work can be reattached without claiming that it was caused by the uncertain request. When the engine is idle and the result remains unknown, the user must inspect the history and explicitly choose a fresh continuation. A protocol error alone is not proof that a mutation never executed. A dedicated account-admission marker emitted before request dispatch confirms rejection and finishes the continuation receipt; generic RPC and transport errors retain the outcome-unknown guard. This account-admission receipt handling is source-verified; installed-host acceptance is pending.

The receipt is a host recovery guard, not a distributed exactly-once tool executor. Other clients remain subject to native writer ownership. Tool replay, daemon lifetime separation and cross-client transaction protocols are outside this change.

## Visible states and recovery actions

A VS Code status item shows the most recently observed thread state. Its menu lists tracked threads and offers status refresh and interrupt-then-resume. Evidence comes from native notifications: recovery/start acceptance, agent output, tool activity, approval/input wait, completed/interrupted/error, and connection loss. Recovery shows `서버 연결 중 · 세션 확인`; pending engine admission shows `전송 대기 중`. Both use an animated status icon. After acceptance, initial silence shows `응답 대기 중` rather than claiming a new server connection is being established.

RPC acknowledgement is bounded at 20 seconds. A turn with no observable progress for 90 seconds is shown as delayed, not dead; human input waits are exempt. Silence does not automatically cancel model or tool work. Interruption recovery waits for a live idle snapshot before admitting a new continuation; timeout leaves the operation stopped at the recovery boundary. It never kills an extension host or a shared engine.

## Storage, lifetime and observability

Receipts use the extension workspace Memento (global Memento for an empty window), with a versioned key and at most 64 tracked threads. Unresolved receipts are not evicted to admit new work. Storage failure fails resume admission closed. The host logs only operation/thread identifiers, phases and safe error categories through a VS Code log output channel. VS Code owns log rotation and storage access. No conversation or tool payload is logged.

The packaging transform locates the pinned bridge methods structurally and refuses changed anchors. A small runtime module wraps the existing request boundary and observes normalized incoming messages; the official source copy stays unchanged. Runtime resources and timers are disposed with the integrated extension.

## Acceptance

### Accepted input durability

Status: `current`, verified with local journal tests and isolated native normal,
interrupt, warm-resume and crash/restart scenarios. User-window acceptance is
outside this automated scope.

A successful user-input acknowledgement transfers custody to durable native
storage before the response is returned. Input awaiting tool completion carries
its full payload, thread identity, client message identity and acceptance order;
in-memory pending input alone is insufficient custody. Storage failure rejects
admission without claiming acceptance. Retries of the same client message do not
create a second accepted input; a new identity with the same text is independent.

Consumption records the message in ordinary history and retires its pending
receipt only after that history is durable. Recovery reconciles receipts by
identity so a crash between history persistence and receipt retirement cannot
duplicate the message. SQLite and rollout-file writes are separate persistence
boundaries. Interruption, process restart and root handoff preserve unconsumed
accepted input. Explicit thread resume reconciles pending receipts with raw user
history before bounded reconstruction, then records missing inputs through the
existing input hooks. A loaded, idle session performs the same reconciliation on
explicit thread resume, serialized against input admission. Resuming a session
with an active turn leaves its pending input with that turn. If a raw user message
is durable but its message identity or attachment events are incomplete, recovery
repairs those events before retiring the receipt, without adding a second model
input. A blocked hook leaves its receipt pending. This recovery does not sample
the model; execution waits for explicit continuation.

The journal extends the existing local SQLite queue store. Pending records retain
the serialized input and its context; consumed records retain identity and payload
digest for retry reconciliation. Local media uses the protocol's existing input
snapshot operation. Custom and ephemeral thread stores retain their existing
semantics and are outside this local durability contract.

### Session dispatch ordering

Status: `current` in host state and bridge regression tests. Installed
user-window interaction is outside this automated scope.

The host orders `thread/resume`, `turn/start` and `turn/steer` requests per
thread. New input arriving during recovery waits for that recovery attempt to
succeed before reaching the engine; failure completes the waiting request with
the recovery error. Duplicate identical resume
requests share one attempt; distinct user inputs retain independent message
identities and dispatches. Other threads remain independent. Disconnect cancels
work admitted against the old connection generation. Native steering rejection
and the UI's existing state-based start fallback remain authoritative; the host
does not retry an uncertain mutation.

### Composer snapshot ownership

Status: `current`, verified with submission and attachment fixtures executing the
pinned host's transformed functions. Live user-window interaction is outside
this automated scope.

Submission captures the editable draft before asynchronous preparation. Clearing
the composer after message admission or queue registration applies only to that
captured draft. Text, selected files, images, comments and app context entered
while preparation or a response is pending remain in the editor. Acceptance and
failure recovery own the submitted message separately from a newer draft, and
must not restore old text or clear attachments over that draft. The same snapshot
check applies to early message-added callbacks and final queued/sent results.
Normal submission and failure restoration of an unchanged draft retain their
existing behavior. Snapshot checks reuse the pinned host's draft state and
comparison facilities; they do not disable typing during preparation.

### Send acknowledgement reconciliation

Status: `current`, verified with the pinned request client and queue coordinator and the isolated native engine's accepted-response and persisted message identity.

The host emits valid JSON for successful fetch routes with no return value by serializing their result as `null`. Native RPC rejection remains an error. A missing turn-start acknowledgement is reconciled with bounded native history polling only when the request has a `clientUserMessageId`: the user-message item's `clientId` must match exactly. Acceptance can precede message-history visibility, so readback waits within a five-second budget instead of treating the first empty snapshot as rejection. Each read loads at most the latest 20 turns. A matching item returns its actual owning turn through the normal success path, allowing the queue coordinator to consume that request. No input is replayed. Missing identity, failed readback, changed connection, or no matching item by the bounded end preserves the uncertain result; an active thread or equal prompt text is not acceptance evidence.

Execution observations and request delivery outcomes are distinct. A missing acknowledgement does not erase an already observed live or completed turn. Receipts may remain outcome-unknown while the execution state remains observable. The existing log channel correlates the original UI request, client message, internal RPC and acknowledged turn identifiers without storing prompt or tool content.

Fault-injection tests cover duplicate resumes, persisted dispatch without response, restart with live or interrupted work, delayed acknowledgements, stage silence, storage failure, interruption before resume, timeout and usage-limit continuation admission, and preservation of ordinary steering. The pinned bridge transform is parsed and executed in a fixture, and a real engine is crashed and restarted with a synthetic interrupted history and a stalled local provider. Packaging must include the runtime modules. These checks establish the selected engine/host combination, not arbitrary upstream versions or replay of external tool side effects; user-window reload is outside automated acceptance.
