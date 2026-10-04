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
Methods: `listWindows`, `observe`, `status`, `restore`, `resize`, `act`, `shutdown`.
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
`patterns`. Timestamp is WGC SystemRelativeTime, decimal monotonic 100ns units, not UTC. The host should
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

`resize` takes positive finite `widthDip`/`heightDip`, interpreted as outer-window dimensions at target
DPI. It checks normal/resizable state, app min/max constraints and current monitor work area, preserves
x/y and uses no-activation/no-Z-order flags. App rejection returns an explicit error with actual size.
`restore` uses SW_SHOWNOACTIVATE and preserves the previous Z-order neighbor when that HWND still exists.
Both return a fresh descriptor. `status` returns a descriptor, `state`, `foregroundHwnd` and
`cursorVisible`. Foreground/cursor information is diagnostic; it does not enable desktop input.

`act` takes `observationId`, `elementId`, `action`, and optional `value`. Supported actions are exactly
`invoke`, `setValue`, `toggle`, `select`, `expand`, `collapse`, `scroll`, through UIA patterns only.
`setValue` takes a string, max 65536 UTF-8 bytes, no NUL. `scroll` takes
`{horizontal,vertical}` integers -2..2: large decrement, small decrement, no amount, small increment,
large increment. Other actions take no value. Before acting, the retained element must still be a
descendant of the exact HWND root. Each action consumes the observation even when it fails and returns
`{window,acted:true,requiresObservation:true}` on success. The host must request another observation.
Restore/resize also invalidate element references. No SetFocus, SendInput, clipboard or close APIs exist.

Every capture/mutation compares foreground HWND and cursor visibility before and after and reports
`interference` if they change, including provider errors. It never takes focus back. UIA providers may
hang; the host process deadline is the isolation boundary. Between-call checks cannot prove that a
provider never transiently changed focus, nor eliminate OS handle races during one API call.
Live Windows capture, restore, resize, and provider behavior require isolated native verification;
compilation and deterministic tests do not establish those runtime behaviors.
