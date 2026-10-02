# Reload and resume recovery

Status: `current`, verified with automated state, bridge, native crash/restart and isolated-host checks; manual reload of a live session is user-verified. Procedure and verification scope are in [operations](../ops/development.md#reload-recovery).

## Behaviour and ownership

The integrated host owns recovery presentation and admission for resume requests. The native engine remains the authority for live thread/turn state, thread writer ownership and interruption. Its existing `thread/read` and `thread/resume` normalization marks historical in-progress turns interrupted when no live turn exists; the host does not rewrite rollout files or invent engine state.

The host records a bounded resume receipt in VS Code workspace state before dispatch. It records an operation identifier, a hash of request parameters, dispatch state and acknowledged turn identifier, never prompt or tool contents. The write must finish before dispatch. Concurrent identical resume attempts share one promise. A standalone continue request or the native empty-input resume action attaches to an already active turn instead of injecting another continue. Ordinary new instructions retain native steering behaviour.

For an idle thread, the native UI's empty-input play action becomes a canonical `continue` text input while preserving its other parameters. The selected engine rejects an empty turn input, so this conversion is performed only after live-state admission; it is never injected into an already active turn.

A `systemError` thread may also admit an explicit continuation when its latest turn is `failed` with error category `other` and an exact known native inference timeout message: legacy helper idle, legacy no-output-frames for 120 seconds, engine request deadline, or helper failure with `provider_headers_timeout`, `provider_stream_idle` or `provider_request_deadline`. These errors have no dedicated protocol category, so admission matches only these engine-generated messages, not arbitrary text containing “timeout”. The same allowlist owns safe diagnostic classification and applies after loading a thread. Failures outside the timeout and usage-exhaustion rules remain blocked. Active-turn attachment, persisted outcome-unknown guards and concurrent-request coalescing still apply; there is no automatic retry or tool replay.

### Continuation after usage exhaustion

Status: `current`, verified with host state and bridge regression tests. Installed user-window inference is outside this verification scope.

A `systemError` thread whose latest turn is `failed` with structured error category `usageLimitExceeded` admits a user's explicit continuation, including the play action, after an account switch or a quota reset. The engine uses its current account selection and determines whether inference can proceed; the host does not require account-change evidence or infer available quota. Account updates alone do not dispatch a continuation. The category is classified as `usage_limit_exceeded` in diagnostics without recording the message. Message text alone cannot admit a usage-limit failure. This rule also applies after loading a thread, with the same active-turn attachment, outcome-unknown receipt guards and concurrent-request coalescing as other continuations.

After reconnect, resume reads native live state. An acknowledged turn can be reattached by identity. A receipt left dispatching without an acknowledged result is outcome-unknown: no automatic replay. Live work can be reattached without claiming that it was caused by the uncertain request. When the engine is idle and the result remains unknown, the user must inspect the history and explicitly choose a fresh continuation. A protocol error alone is not proof that a mutation never executed.

The receipt is a host recovery guard, not a distributed exactly-once tool executor. Other clients remain subject to native writer ownership. Tool replay, daemon lifetime separation and cross-client transaction protocols are outside this change.

## Visible states and recovery actions

A VS Code status item shows the most recently observed thread state. Its menu lists tracked threads and offers status refresh and interrupt-then-resume. Evidence comes from native notifications: recovery/start acceptance, agent output, tool activity, approval/input wait, completed/interrupted/error, and connection loss. Initial silence is labelled first-response wait rather than claiming a model request was sent.

RPC acknowledgement is bounded at 20 seconds. A turn with no observable progress for 90 seconds is shown as delayed, not dead; human input waits are exempt. Silence does not automatically cancel model or tool work. Interruption recovery waits for a live idle snapshot before admitting a new continuation; timeout leaves the operation stopped at the recovery boundary. It never kills an extension host or a shared engine.

## Storage, lifetime and observability

Receipts use the extension workspace Memento (global Memento for an empty window), with a versioned key and at most 64 tracked threads. Unresolved receipts are not evicted to admit new work. Storage failure fails resume admission closed. The host logs only operation/thread identifiers, phases and safe error categories through a VS Code log output channel. VS Code owns log rotation and storage access. No conversation or tool payload is logged.

The packaging transform locates the pinned bridge methods structurally and refuses changed anchors. A small runtime module wraps the existing request boundary and observes normalized incoming messages; the official source copy stays unchanged. Runtime resources and timers are disposed with the integrated extension.

## Acceptance

### Send acknowledgement reconciliation

Status: `current`, verified with the pinned request client and queue coordinator and the isolated native engine's accepted-response and persisted message identity.

The host emits valid JSON for successful fetch routes with no return value by serializing their result as `null`. Native RPC rejection remains an error. A missing turn-start acknowledgement is reconciled with bounded native history polling only when the request has a `clientUserMessageId`: the user-message item's `clientId` must match exactly. Acceptance can precede message-history visibility, so readback waits within a five-second budget instead of treating the first empty snapshot as rejection. Each read loads at most the latest 20 turns. A matching item returns its actual owning turn through the normal success path, allowing the queue coordinator to consume that request. No input is replayed. Missing identity, failed readback, changed connection, or no matching item by the bounded end preserves the uncertain result; an active thread or equal prompt text is not acceptance evidence.

Execution observations and request delivery outcomes are distinct. A missing acknowledgement does not erase an already observed live or completed turn. Receipts may remain outcome-unknown while the execution state remains observable. The existing log channel correlates the original UI request, client message, internal RPC and acknowledged turn identifiers without storing prompt or tool content.

Fault-injection tests cover duplicate resumes, persisted dispatch without response, restart with live or interrupted work, delayed acknowledgements, stage silence, storage failure, interruption before resume, timeout and usage-limit continuation admission, and preservation of ordinary steering. The pinned bridge transform is parsed and executed in a fixture, and a real engine is crashed and restarted with a synthetic interrupted history and a stalled local provider. Packaging must include the runtime modules. These checks establish the selected engine/host combination, not arbitrary upstream versions or replay of external tool side effects; user-window reload is outside automated acceptance.
