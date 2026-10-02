# Reload and resume recovery

Status: current for the automated acceptance below, verified 2026-09-15. User-profile installation and a manual reload of the reported session have not been performed.

## Behaviour and ownership

The integrated host owns recovery presentation and admission for resume requests. The native engine remains the authority for live thread/turn state, thread writer ownership and interruption. Its existing `thread/read` and `thread/resume` normalization marks historical in-progress turns interrupted when no live turn exists; the host does not rewrite rollout files or invent engine state.

The host records a bounded resume receipt in VS Code workspace state before dispatch. It records an operation identifier, a hash of request parameters, dispatch state and acknowledged turn identifier, never prompt or tool contents. The write must finish before dispatch. Concurrent identical resume attempts share one promise. A standalone continue request or the native empty-input resume action attaches to an already active turn instead of injecting another continue. Ordinary new instructions retain native steering behaviour.

For an idle thread, the native UI's empty-input play action becomes a canonical `continue` text input while preserving its other parameters. The selected engine rejects an empty turn input, so this conversion is performed only after live-state admission; it is never injected into an already active turn.

Timeout continuation (implemented and unit-tested 2026-09-17; not installed): a `systemError` thread may also admit an explicit continuation when its latest turn is `failed` with error category `other` and the exact native inference idle-timeout or request-deadline error. These errors currently have no dedicated protocol category, so admission matches only the engine-generated messages, not arbitrary text containing “timeout”. Apply the same check after loading a thread. Other system errors remain blocked. Active-turn attachment, persisted outcome-unknown guards and concurrent-request coalescing still apply; no automatic retry or tool replay is introduced.

After reconnect, resume reads native live state. An acknowledged turn can be reattached by identity. A receipt left dispatching without an acknowledged result is outcome-unknown: no automatic replay. Live work can be reattached without claiming that it was caused by the uncertain request. When the engine is idle and the result remains unknown, the user must inspect the history and explicitly choose a fresh continuation. A protocol error alone is not proof that a mutation never executed.

The receipt is a host recovery guard, not a distributed exactly-once tool executor. Other clients remain subject to native writer ownership. Tool replay, daemon lifetime separation and cross-client transaction protocols are outside this change.

## Visible states and recovery actions

A VS Code status item shows the most recently observed thread state. Its menu lists tracked threads and offers status refresh and interrupt-then-resume. Evidence comes from native notifications: recovery/start acceptance, agent output, tool activity, approval/input wait, completed/interrupted/error, and connection loss. Initial silence is labelled first-response wait rather than claiming a model request was sent.

RPC acknowledgement is bounded at 20 seconds. A turn with no observable progress for 90 seconds is shown as delayed, not dead; human input waits are exempt. Silence does not automatically cancel model or tool work. Interruption recovery waits for a live idle snapshot before admitting a new continuation; timeout leaves the operation stopped at the recovery boundary. It never kills an extension host or a shared engine.

## Storage, lifetime and observability

Receipts use the extension workspace Memento (global Memento for an empty window), with a versioned key and at most 64 tracked threads. Unresolved receipts are not evicted to admit new work. Storage failure fails resume admission closed. The host logs only operation/thread identifiers, phases and safe error categories through a VS Code log output channel. VS Code owns log rotation and storage access. No conversation or tool payload is logged.

The packaging transform locates the pinned bridge methods structurally and refuses changed anchors. A small runtime module wraps the existing request boundary and observes normalized incoming messages; the official source copy stays unchanged. Runtime resources and timers are disposed with the integrated extension.

## Acceptance

2026-09-17 timeout admission regression: `node --test scripts/test-recovery-state.cjs scripts/test-recovery-bridge.cjs` passed all 27 tests (exit 0), including 10 added timeout cases. Evidence: `artifacts/logs/timeout-resume/tests.log`. This verifies source admission and bridge fixtures; no new package, user-profile installation or real-provider timeout retry was performed.

Fault-injection tests cover duplicate resumes, persisted dispatch without response, restart with live or interrupted work, delayed acknowledgements, stage silence, storage failure, interruption before resume, and preservation of ordinary steering. The pinned bridge transform is parsed and executed in a fixture. Packaging must include the runtime modules; user-window reload is not part of automated acceptance.

Verified: 14 state tests and 3 pinned-bridge/lifecycle tests; real engine crash/restart with a synthetic interrupted history and a stalled local provider; packaged module, hook and command assertions; and all six isolated host installation/activation stages. All completed with exit 0. Evidence is in `artifacts/verification/reload-recovery/`; the current-source candidate is `artifacts/releases/reload_recovery_20260915_v4/`. The native fixture made two local provider requests and no external model calls. These checks establish the selected engine/host combination, not arbitrary upstream versions or replay of external tool side effects.
