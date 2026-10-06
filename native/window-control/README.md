# Azrael selected-window native backend

Independent Windows Rust crate, outside the engine workspace. Build from the project root with
`powershell -File scripts/build-window-control.ps1`; `-Test` runs deterministic unit tests, and
`-Configuration debug` selects a debug build. Cargo.lock pins the dependency graph. Logs go to
`artifacts/logs/window-control-native/`, compiler output to `artifacts/build/window-control-native/target/`.

The trusted Azrael host owns authorization, executable launch/identity, request deadlines and killing
only its own backend after identity verification. This executable processes one newline JSON request
at a time. No desktop API is called merely by starting the executable: COM/UIA initialization is lazy.
`shutdown` needs no native initialization. The request line limit is 16 MiB; oversized lines are drained.

Internal requests are `{id,method,params}`. Results are `{id,result}` or `{id,error:{code,message}}`.
Methods: `listWindows`, `observe`, `inspect`, `status`, `restore`, `resize`, `act`, `shutdown`.
Window descriptors returned by `listWindows` contain `hwnd`, `pid`, `processCreated`, `executable`,
`title`, `minimized`, `widthPx`, `heightPx`, `dpi`. HWND and FILETIME are lowercase hexadecimal without
`0x`. Each targeted method takes the full descriptor as `params.window`; mutable title/state/size do
not determine identity. Identity is HWND + PID + process creation FILETIME + executable path.
Only exact top-level HWNDs qualify; titles never rebind targets.
An out-of-context read-only WinEvent watcher retires destroyed HWNDs for the lifetime of this backend,
including same-process handle reuse. A queue barrier brackets requests. Retired HWNDs are excluded from
new listings and remain stale until the host starts a new owned backend session. Event delivery and
Win32 identity checks still cannot make an OS API operation atomic with window destruction.

`observe` returns the descriptor, `observationId`, `frameTimestamp`, physical PNG dimensions and target
DPI, `{image:{mimeType:'image/png',data:<base64>}}`, and UIA `elements` with `id`, `name`, `controlType`,
`patterns`, `automationId`, `parentId` (observation-local ID or null), `enabled`, and `isPassword`.
Optional provider-readable properties are `value`, `selected`, `toggleState` (`off`, `on`,
`indeterminate`) and `expandState` (`collapsed`, `expanded`, `partial`, `leaf`). Missing properties
are unavailable, not false. Password values are never read or returned, and password names remain
redacted. Read-only Value patterns do not advertise `setValue`. Timestamp is WGC SystemRelativeTime, decimal monotonic 100ns units, not UTC. The host should
validate PNG/frame dimensions separately from descriptor outer-window dimensions, which can differ.
Observation checks outer dimensions, DPI and minimized state again after capture and rejects changes;
it returns the post-capture descriptor without cropping or fabricating frame geometry. The host should
track receipt time separately. Captures use only WGC CreateForWindow, including when the window is behind
another window. A fresh session and monotonic timestamp barrier reject buffered/unchanged timestamps.
There is no desktop/monitor capture, cropping, PrintWindow or foreground activation fallback.
Cursor capture is disabled on the session; the actual user cursor is never hidden or configured.
Explicit nonzero capture affinity rejects protected HWNDs. The query is documented to succeed only
for layered windows; unavailable affinity remains `captureProtection:'unknown'` while capture proceeds
through standard WGC only, respecting its OS protection/errors. `noneDetected` is a zero affinity query
result, not proof that all protected content can be detected. No protection override or alternate path
exists. See [GetWindowDisplayAffinity](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowdisplayaffinity).
Minimized/zero-size windows cannot be observed. WGC frames have a three-second deadline and bounded
dimensions (16384 per edge, 32 million pixels total); UIA trees are limited to 2048 nodes/depth 128.

`inspect` returns `{window,observationId,elements,elementsTruncated}` using the same bounded accessibility tree
and retained action references, with identity, geometry and lifetime checks. It makes no WGC request
and does not require an image or desktop ownership. It replaces the previous observation; the host
must use its new observation ID for subsequent actions. Minimized targets may expose accessibility
state if their provider supports it; inspection does not restore them.

`resize` takes positive finite `widthDip`/`heightDip`, interpreted as outer-window dimensions at target
DPI. It checks normal/resizable state, app min/max constraints and current monitor work area, preserves
x/y and uses no-activation/no-Z-order flags. App rejection returns an explicit error with actual size.
`restore` uses SW_SHOWNOACTIVATE and preserves the previous Z-order neighbor when that HWND still exists.
Both return a fresh descriptor. `status` returns a descriptor, `state`, `foregroundHwnd` and
`cursorVisible`. Foreground/cursor information is diagnostic; it does not enable desktop input.

`act` takes `observationId`, `elementId`, `action`, and optional `value`. Supported actions are exactly
`invoke`, `setValue`, `toggle`, `select`, `expand`, `collapse`, `scroll` through UIA patterns, plus
experimental `pressKey` through window-directed messages.
`setValue` takes a string, max 65536 UTF-8 bytes, no NUL. `scroll` takes
`{horizontal,vertical}` integers -2..2: large decrement, small decrement, no amount, small increment,
large increment. `pressKey` requires a string naming exactly one of `Return`, `Tab`, `Escape`,
`BackSpace`, `Delete`, `Left`, `Right`, `Up`, `Down`, `Home`, `End`, `PageUp`, `PageDown`, `space`.
Other actions take no value. Before acting, the retained element must still be a
descendant of the exact HWND root. Each action consumes the observation even when it fails and returns
`{window,acted:true,requiresObservation:true}` on success. The host must request another observation.
Restore/resize also invalidate element references. No SetFocus, SendInput, clipboard or close APIs exist.

`pressKey` is advertised only for enabled elements owning an exact native HWND inside the selected
window. UIA comparison with `ElementFromHandle` verifies the requested element owns that HWND;
virtual descendants cannot substitute the selected root or another ancestor. Delivery revalidates
ancestry, HWND membership and ownership and posts WM_KEYDOWN/WM_KEYUP; no external HWND, numeric key,
modifier shortcut or Unicode input is accepted. Success adds `delivery:'windowMessage'`, `verified:false`,
`experimental:true`: these fields describe queueing only, never a completed key effect. Partial
queueing reports `uncertain-delivery`; an already queued message is not rolled back or retried.
No keyboard-state changes are made; app behavior and interaction with concurrent modifier state
require live acceptance tests.

Capture and inspection permit foreground and cursor-visibility changes while preserving their
target validity checks. Mutations permit unrelated foreground switches. An observed transition into
the target or its owned popup reports `interference`, including after provider errors; the action may
already have occurred. The source of that transition is ambiguous. Cursor visibility is diagnostic
only and cannot establish target interference. The backend never takes focus back. UIA providers may
hang; the host process deadline is the isolation boundary. Endpoint checks cannot detect transient
activation between samples, prove independence from concurrent edits inside the target, or eliminate
OS handle races during one API call.
Live Windows capture, restore, resize, and provider behavior require isolated native verification;
compilation and deterministic tests do not establish those runtime behaviors.

The accessibility walker visits breadth first and preserves the existing element, depth and queue
limits. A tree beyond those bounds returns included elements and `elementsTruncated:true` rather
than rejecting capture. `observe` exposes the same required boolean; false denotes a complete
snapshot. Only returned elements retain live action references. Task macros reject incomplete
inspection before resolving selectors or evaluating conditions.

## Window Use acceptance harness

After build authorization, compile the native worker and fixture into dedicated output directories.
`scripts/build-window-control.ps1` accepts `-TargetDirectory` and `-LogDirectory`;
`scripts/test-selected-window-native.ps1 -CompileOnly` accepts `-OutputDirectory` and `-LogDirectory`.
Compilation does not run desktop operations.

In an isolated Windows test session, `scripts/test-window-use-native.cjs` takes
`--go --isolated-desktop --baseline <desktop-state.json> --runtime-directory <verified-runtime>
--fixture-executable <fixture.exe> --artifacts <new-directory>` and requires
`AZRAEL_WINDOW_NATIVE_ISOLATED=1`. Follow the project's desktop and window protection procedure
before taking the baseline. The isolation flags are operator assertions, not isolation enforcement.
The harness checks fresh fully occluded capture, image-free inspection, stale and disabled controls,
semantic actions, named-key fixture postconditions and unchanged global input/clipboard state.
It does not establish installed-host behavior, Firefox support or simultaneous physical typing;
those remain separate acceptance tasks.
