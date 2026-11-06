# Switched multi-pointer prototype

Status: source prototype. Native compilation, desktop input, rendering and app
effects require separate Windows x64 acceptance. This is an independent Win32
implementation, with no target DLL, injection hook, MouseMux patch or installation.

## Scope and authority

Windows x64, MSVC/C++17, same-user non-elevated local processes in the broker's
session, interactive `WinSta0\\Default` desktop only. Linux, macOS, remote/isolated
desktops and elevated targets are unsupported. The process requires per-monitor-v2
DPI awareness; coordinates are physical screen pixels, including negative origins.
Absolute input uses the center of each pixel's normalized 16-bit bin and requires
virtual desktop width and height of at most 32,768 pixels each. Larger dimensions
return `screen_precision` before movement. The observed OS cursor must still equal
the exact requested pixel; there is no tolerance or direct `SetCursorPos` fallback.

The absolute `--targets` JSON file is the complete startup authority. The caller
must independently approve and freshly resolve every target. Tools cannot add or
rebind targets. File changes after startup are ignored. Example shape (values must
be replaced with real identities):

```json
{"schema":1,"targets":[{"id":"paint-1","pid":1234,"createdFileTime":"0x1db000000000000","hwnd":"0x12345","executable":"C:/Windows/System32/mspaint.exe"}]}
```

Startup pins process handles, creation FILETIME, executable path, same user,
non-elevated token, session, root HWND and owning thread. Every ordinary request
revalidates all pinned targets, including window availability; stop/shutdown always
attempt cleanup even when identities fail. Window-destruction events invalidate
the pinned HWND for the broker lifetime. File identities cannot encode a window
generation before the broker starts: callers must create the file immediately
before launch. There remains an unavoidable user-mode check/input race if windows
or the desktop change between the last check and Windows consuming an event.

An approved main root also includes its currently visible, enabled, same-process
top-level `WS_POPUP` surfaces whose `GW_OWNER` chain reaches that exact pinned main
within 16 owner edges. Every chain window must remain a live top-level window of
the pinned process on the Default desktop; threads and ownership edges are checked
again before acceptance. Null/unrelated owners, cycles, changed identities and
over-depth chains fail explicitly. An unowned same-process sibling is excluded.
Main-root visibility/enabled checks remain required, so a modal surface that
disables the main root does not pass this prototype's current availability gate.
Input coordinates remain inside the main root's client rectangle even when the
actual hit is on an owned popup. No popup becomes a new target or allows input
outside those bounds. An accepted foreground popup is preserved during preparation
instead of activating away its menu. Preparatory caption activation still requires
the exact main root and excludes popup captions.

## Build and launch

Use an authorized frozen source/build owner. CMake requires Windows MSVC x64 and
produces the console executable `azrael-multi-pointer.exe` with `/W4 /utf-8`.
It reuses `../virtual-input/vendor/json/single_include/nlohmann/json.hpp`
(nlohmann/json 3.11.3, MIT; license at that vendor's `LICENSE.MIT`). Other libraries
are Windows system libraries, including user32, gdi32, GDI+, ole32, advapi32, bcrypt
and Magnification. There is no
dependency download or product installation.

## Cursor presentation

The layered overlays use premultiplied per-pixel alpha and antialiased vectors.
The white user arrow preserves the approximate Windows silhouette using straight
edges and rounded corners. The model uses the adopted 90%-width Fluent-derived
rounded arrow with a white outline, default LAIO Sky Blue Bright `#38BDF8`.
`create_pointer.color` can select any of the 72 registered palette colors; the
label uses the matching family's Pastel/Clear colors. Custom HEX still works.
Vector and palette data live in `cursor-assets.hpp`; attribution and the complete
upstream license are in `CURSOR-NOTICES.md` and copied to runtime notices.

`사용자` and `모델` labels remain unchanged. A user gesture waiting in the real
FIFO queue adds a save badge without changing white fill. Model actuation makes
the model opaque; dragging fades/shrinks it in place into a dot. Idle is 32%
opacity. Explicit logical moves change coordinates immediately and leave a soft,
body-only 180ms ghost at the prior position. Removal fades/shrinks for 220ms;
stop/shutdown destroy overlays immediately. Proven cooperation activation
crossfades from the native arrow and grows the user arrow from a dot. Physical
tracking is not interpolated or delayed for animation. Reduced Windows client-area
animation settings skip transitions and ghosts. These visual states never submit
input, alter targets or change FIFO admission.

`node scripts/check-multi-pointer-native.cjs --render-only` freezes source and
compiles the runtime for non-actuating native verification without a target
allowlist. It runs source, raw-origin, visibility-guard and cursor rendering checks.
The guard check temporarily tests system-pointer visibility and restores it.
The rendering test writes light/dark frames, checks alpha and motion, and uploads
to a hidden click-through window at 96/144/192 DPI. It does not establish live
mouse collaboration or installed availability. Output belongs to its managed
run and follows the same owner-based cleanup procedure as target preparation.

```text
azrael-multi-pointer.exe --targets C:\absolute\targets.json
```

The parent should launch with `windowsHide: true`, drain stdout and stderr, and keep
stdin open until responses arrive. Send `stop`, then `shutdown` (or EOF) to finish.
EOF cancels active and queued operations; an unterminated final line never runs.
The broker never starts or kills target applications.

## JSONL protocol

One request/response per line. Stdout contains JSON only; no startup banner.
Requests have `{id,method,params}`; `params` defaults to `{}`. IDs are null, integer
or strings of at most 128 UTF-8 bytes. Responses are `{id,result}` or
`{id,error:{code,message,actionExecuted,partial?}}`. Invalid requests do not replay.
Line limit: 65,536 bytes. Shared input queue limit: 16; separate logical-move mailbox
limit: 16. Oversize/overflow errors use a null ID. Input operations execute FIFO;
logical moves are serviced at safe operation boundaries without taking an input
turn. For real-app acceptance, send one model request at a time and observe its
effect; physical mouse operations can still arrive during that model request.

| Method | Parameters / effect |
| --- | --- |
| `hello`, `status` | Observe targets, logical pointers, system cursor and foreground. |
| `create_pointer` | `{pointerId,targetId,x,y,color?}`; at most eight cursors. Color is `#RRGGBB`. |
| `move` | `{pointerId,x,y}`; move the logical state/overlay only. No OS cursor move or foreground activation. |
| `click` | `{pointerId,button}`; button is `left`, `right` or `middle`. |
| `drag` | `{pointerId,x,y,durationMs?}`; left drag to absolute screen end; duration 1–2000ms, default 300ms. |
| `scroll` | `{pointerId,delta}`; nonzero signed Windows wheel units, -12000 to 12000. |
| `key` | `{pointerId,vk,down}`; concrete Windows virtual key (8–254), boolean down. |
| `press` | `{pointerId,keys}`; atomic 1–8 unique concrete VKs, down in order/up in reverse, fully released. |
| `text` | `{pointerId,text}`; UTF-8 converted to Unicode input; 1–4096 bytes and at most 1024 UTF-16 units. |
| `collaboration` | `{enabled:boolean}`; explicit mouse-only opt-in/probe or routing release; see below. |
| `remove_pointer` | `{pointerId}`; release that pointer's own synthetic state, remove overlay. |
| `stop` | Release all own synthetic state and destroy every overlay; permits creating new pointers afterward. |
| `shutdown` | Successful stop followed by normal exit. Cleanup failure leaves the broker alive for retry. |

Pointer and target IDs: 1–32 ASCII letters, digits, `_` or `-`. Coordinates are
bounded to +/-1,000,000 and must lie inside the bound root's client rectangle and
the current virtual screen. Generic modifier VKs (`SHIFT`, `CONTROL`, `MENU`),
`VK_PACKET` and `VK_PROCESSKEY` are rejected; use left/right modifier VKs. Key-up
can release only an owned synthetic down. There is no automatic repeated key-down.
Windows keys, both Alt keys, application-menu, screenshot, browser, media and
app-launch keys are unsupported. This excludes Win shortcuts and Alt+Tab/Escape/F4.
Ctrl+Escape and Ctrl+Shift+Escape are rejected in either key order using the active
pointer's tracked modifier state. Physical modifiers are separately rejected by
the actuation gate. App commands and third-party global remapping of otherwise
permitted keys can still have effects beyond their default key meaning.
While collaboration is requested, `key` returns `unsupported_atomicity`; use
`press`. With collaboration off, legacy cross-request key behavior is preserved.

## Mouse collaboration and capability probe

Collaboration starts disabled. `collaboration({enabled:true})` registers only this
EXE for mouse Raw Input using `RIDEV_INPUTSINK`, creates the white, dark-outlined
`사용자` overlay,
and returns `requested:true,enabled:false,capability_pending:true`. No model input
is allowed until capability is ready. The user has at most ten seconds to provide
ordinary relative mouse motion without held buttons/modifiers. The first relative
motion starts a probe that suppresses legacy physical motion for at most 250ms.
Two distinct suppressed low-level motion observations must pair by Windows event
time with nonzero relative Raw Input received during that suppression. Only then
does `enabled:true,phase:"ready"` become available. Failure releases suppression
immediately and exposes `failed:true` and `lastFailure`; it never silently claims
that Raw Input survives the hook. The probe emits no synthetic input. It does not
use `RIDEV_NOLEGACY` as a global-routing claim. Event-time matching is bounded
capability evidence for this runtime/device path; actual cursor isolation and app
effects still require manual acceptance.

Held physical buttons/modifiers in the initial ten-second awaiting phase do not
start suppression or fail readiness immediately. The unchanged original deadline
continues while `deviceDiagnostics.preparationWaitReason` reports only a category
(`physical_buttons_held`, `physical_modifiers_held`, `physical_mouse_event` or
`relative_motion_required`). Fresh plain relative motion after release starts the
probe. Its non-movement/keyboard/timeout protections remain active once probing.

Immediately before Raw Input registration, enable snapshots at most 256 existing
raw-device entries and verifies every mouse through `RIDI_DEVICEINFO`. Within the
first second after that snapshot, a first `GIDC_ARRIVAL` for an already known mouse
is accepted only when its queried mouse information still matches. This bounded
exception permits initial matching-device notifications; it is not a general
hotplug allowance. Removal, unknown handles/types, changed device information,
duplicate/late arrival and Raw Input from a device outside that snapshot keep the
fail-open policy. The device-list/query itself can fail enable rather than assume
a stable topology. Native `collaboration.deviceDiagnostics` keeps only snapshot
status/count/reason, allowed/rejected counts, one latest device-change sample
(category, opaque device handle, type, phase, known/info-verified flags and reason)
and one latest raw sample (type/handle, mouse/button flags and reason). Device paths,
names, vendor/product IDs and keyboard packet contents are never collected for
these diagnostics. Public projections should omit opaque handles when unnecessary.
With collaboration off, late device-change messages are observation-only; disable
sets phase off and clears the current failure reason without increasing the
lifetime failure counter. Stop/disconnect signals cannot turn an unrequested
collaboration session into a failed one.

Raw packets produced by this EXE's own `SendInput` do not advance the user pointer,
become human gestures, satisfy the probe or trip the physical absolute-device gate
when a strict own-origin correlation succeeds. The low-level mouse hook records
at most 64 fixed receipts only after exact full-`ULONG_PTR` tag equality and an
injected flag. Raw classification additionally requires a null device, matching
positive-31-bit marker in `RAWMOUSE.ulExtraInformation`, an unconsumed receipt no
older than 100ms, event times within two milliseconds and the matching mouse
message/button transition/wheel delta. An own absolute move must decode to exactly
the receipt's physical point on the same virtual desktop. Each receipt consumes
only one raw packet. No raw/private extra-info value is exposed. Unknown, stale,
foreign, physical-device or absolute packets that do not meet these predicates
still follow the existing fail-open guards. Marker correlation is not an
authentication boundary or a claim about the component producing an event.

`deviceDiagnostics.ignoredOwnRawPackets` counts these excluded packets;
`lastRaw.ownExtraInfoLow32` and `lastRaw.ownReceiptMatched` expose only boolean
classifier observations.

`lastRaw.receiptMismatches` retains at most eight newest trusted receipts when
an own-marker/null-device raw packet fails correlation. Each entry contains only
`kind`, first-rejection `reason`, independent `shapeReason`, signed `timeDeltaMs`,
`ageMs` (`-1` for a future receipt), and `consumed`. Shape diagnostics distinguish
relative nonzero deltas, button kind and button data even when a consumed/stale
receipt was rejected first. Diagnostic copies do not change input admission.
The acceptance predicate and its time, age, tag and consumption limits are unchanged.

The pure classifier is retained in `raw-origin.hpp` with
`raw-origin-selftest.cpp` to catch future edits that broaden the exception to all
zero-device/absolute packets, accept stale/consumed receipts, or hide physical
packets. The optional CMake target `azrael-multi-pointer-raw-origin-selftest` is
excluded from the default build and takes no arguments. It has no input/device
operations; its exit code and check summary validate only deterministic predicate
cases. Actual LL/Raw ordering and metadata preservation remain manual runtime gates.

`hello`/`status` check connection, desktop and pinned target identity independently
of model mutation/routing-failure gates. A failed collaboration session remains
inspectable without calling the mutation boundary or processing logical moves as
part of that query. Request errors retain `partial.collaboration` before synthetic
cleanup so the original raw failure is not concealed by cleanup input. Permission/
identity failures remain errors and retain required held-state safety cleanup.

Ordinary native user input passes through while no input participant owns a turn.
During a model operation or an admitted human gesture, supported physical mouse
legacy events are suppressed, relative Raw Input updates the independent user
overlay, and user down/wheel events enter the same FIFO as model input requests.
A click does not cancel the model or end collaboration. A down admits a position
and target before up completes that same ticket, so subsequent model requests
cannot overtake an incomplete human gesture. The recording must finish in two
seconds, contains at most 128 points, and supports left/right/middle click/drag or
a single vertical wheel event. Replay preserves its bounded duration and recorded
path. Queued human intent expires after five seconds rather than becoming an
unbounded stale click. A model click/drag/chord/text request remains atomic once application input
starts. No model task lease is held while observing, waiting on another tool call
or between completed input requests. Logical moves use a separate mailbox and do
not change the coordinates frozen for the current action.

Human intent pins the exposed window/control, PID/process creation/executable,
user/integrity/session/desktop, thread, focus and window geometry at submission.
It is revalidated before input; unavailable/covered/replaced controls, changed
focus/geometry or paths leaving the original window are skipped without replay.
Human actions can target ordinary same-user non-elevated processes outside the
model allowlist, through this separate physical-user route. They do not add model
targets. Titlebar drags that change window geometry, cross-window drag/capture,
changed application content undetectable from these identity/focus/geometry checks,
absolute mice, touch/pen, horizontal wheel and multiple-button gestures are not
accepted as verified collaboration. Native idle input remains available for those
operations. On turn completion the broker restores the latest user position only
over a freshly verified same-user, non-higher-integrity default-desktop process;
unsafe or failed restoration fails open and may leave the OS cursor at its last
model position. Handback retries only while revalidating the latest user position,
for at most 200ms of cooperative handback time; it does not retain an input lease
indefinitely while the model is idle.

Physical keyboard/IME is outside this first mouse-only routing scope. It is never
suppressed: physical keyboard input during a captured turn fails mouse routing
open and stops further model input, releasing tracked synthetic state. Model
`press` and `text` remain supported when physical keyboard input is absent. Foreign
injection, unsupported devices/targets, queue overflow and missing Raw Input fail
open in the same way. Own tagged input must be observed by its hook within 20ms;
unmatched suppressed/raw motion has bounded watchdog checks. A silently removed
hook can leak input before its loss is detected; this EXE has no driver-level
guarantee. Other apps consuming Raw Input can receive raw data despite legacy-hook
suppression, and their registrations cannot be reliably inferred here. Such app
compatibility is explicitly unverified, with `rawConsumerAppsVerified:false`.
Relative counts are mapped directly to user pixels while captured; Windows pointer
acceleration is not emulated. Both routing limits require actual device/app tests.

`result.collaboration` exposes `requested`, `enabled`, `capability_pending`,
`failed`, `phase`, `probeRemainingMs`, `suppression`, `modelActive`, `user:{x,y}`,
queue sizes, raw/suppression-pair counters and bounded failure/completion statistics.
There is no hidden auto-enable. Disable, emergency stop, explicit stop and EOF
release routing and synthetic held state. The hook itself contains only bounded
atomic updates and suppression decisions; Raw Input processing, target pinning,
queueing and overlay rendering run outside low-level callbacks.

## Operation identity and bounded recovery

`click`, `drag`, `scroll`, `key`, `press` and `text` accept optional positive safe
integer `operationId` (1–9007199254740991). The MCP assigns a new increasing ID for
each new intended mutation and reuses it only to query/reissue that same operation.
Native code retains the last 64 operation outcomes/budgets and an admitted high
watermark. A duplicate ID returns the stored outcome with `duplicateOperation:true`
or `operation_pending`; it never repeats application input. Changed parameters
return `operation_conflict`. Evicted IDs at/below the watermark return
`retired_operation`, rather than becoming replayable. Without an explicit ID,
native uses a positive-safe-integer request ID or generates an increasing local
one; string/null legacy correlation IDs alone do not identify a cross-call intent.
Cached observations are historical; obtain status separately for current state.

An intended operation gets at most three fresh preparation rounds and five seconds
of active preparation. Foreground/occlusion failures with zero accepted application
input can re-enter the back of the FIFO with the same operation and counters.
Already waiting human operations run before that recovery continuation. Queue
waiting, captures and status do not reset its budget. Readiness checks use current
identity, main-client geometry and exposed hit/foreground surface; they do not prove
unchanged application content or focus meaning. Existing exact-target activation
is permitted, including at most one caption input attempt per intended operation.
Unrelated covering windows are never moved/closed or clicked through, and minimized
windows are not restored under implicit authority.

After any accepted application button/wheel/key/text input, failures release own
held state and return `observeRequired:true`; the old mutation/path is not retried.
Identity changes, explicit stop/revocation, cleanup uncertainty, routing failure
and physical-keyboard interruption are not preparation recovery conditions. A new
ID after a failed operation is a new explicit intended action, whose prior failure
remains retained; native does not infer that a fresh screenshot makes replay safe.

`result.recovery` / `error.partial.recovery` report operation ID, round/active-time
budget, accepted application inputs, last blocker, exhausted/observe-required/
uncertain-delivery/completed flags. Preparation cursor moves/caption selection are
counted separately from application mutations; total delivery counts cover all
preparation rounds. Exhaustion stops that operation and leaves native physical
input available. Budgets and gesture deadlines are cooperative; Win32 calls and
scheduling can add latency. Successful SendInput remains delivery evidence only.

During proven mouse cooperation, a separate same-executable guard hides the
system cursor using `MagShowSystemCursor`; logical user/model overlays remain
visible. Hiding follows the ready cooperative mode, including idle periods,
and requires a visible replacement user overlay. Preparation or a missing user
overlay does not hide the native pointer. The broker waits for the initial hide
acknowledgment before positional input. Subsequent health checks are nonblocking;
unchanged acknowledged visibility does not issue another guard command. The
`visibilityCommands` counter reports actual control commands, not compositor
observations. At handoff it restores the user position,
then drains and revalidates before a final position restore and nonblocking
capture release while the system pointer remains hidden. The bounded
drain is not a global hardware-input barrier. Routing failure,
disable, stop and shutdown request display restoration. The guard also restores
display on broker exit or a two-second UI heartbeat timeout; a separate broker
heartbeat detects a stalled input worker. No cursor theme, registry settings or
target process are modified. Legacy collaboration-OFF input is unchanged.

`collaboration.systemCursor` reports `supported`, `hidden`, `restorePending`,
`guardReady` and `lastError`. Hide failure stops cooperative input rather than
silently falling back to another cursor-hiding mechanism. The guard holds an
exclusive session/desktop lease until broker destruction after its first use.
Whole-process-tree termination or a hung visibility API can prevent recovery;
the independent guard must remain runnable. Visibility does not establish input
isolation or fix coordinate jumps. Native API/lifecycle checks and real desktop
visual acceptance are distinct.

Successful results include `mode:"switched"`, `globalInput:true`,
`appEffectVerified:false`, `actionExecuted`, `deliveredInputs`, `targets`, `pointers`,
`physicalCursorObserved`, optional `physicalCursor:{x,y}`, `foregroundHwnd`,
`foregroundRootHwnd`, `syntheticOwner`, `cleanupPending`, and
`emergencyHotkey:{chord:"Ctrl+Alt+Pause",registered:boolean}`. Per-request
`activationPath` is `none`, `already_foreground`, `set_foreground_window`,
`caption_scan` or `caption_click`; `activationDeliveredInputs` counts accepted
caption activation inputs. `deliveredInputs` includes those activation inputs;
cleanup releases are separate. Error partial records also include activation path
and count, so a failed client action never conceals a preparatory caption click.
Target records use `targetId,pid,createdFileTime,hwnd,executable`; pointer records
use `pointerId,targetId,x,y`. Handles/FILETIMEs are hex strings.
For `hello`/`status`, each pointer also has `hitObservation:{worker,ui}`: read-only
`WindowFromPoint` observations taken sequentially on the broker worker and overlay
UI thread. Each contains the point, observer PID/thread/tick, expected target
PID/root/thread, observed HWND/PID/root/thread/visible/enabled/broker-owned flag,
foreground HWND/root/PID/thread, and exact-hit/foreground match flags. These are
bounded to the existing eight pointers and include no window titles or unrelated
executable paths. The snapshots may differ because of caller-thread behavior or
changes between samples; they do not authorize input or prove app effects.
`hitSurface` and `foregroundSurface` describe the same main-or-owned-popup decision
used by input checks, including accepted/owned-popup flags, a stable rejection
reason and at most 17 HWND/thread entries in `ownerChain`.

Client hit/foreground rejection errors include the exact guard's observed snapshot
as `error.partial.hitObservation`, captured before cleanup. They preserve the same
strict hit and foreground predicates; observation does not bypass an occluder.

Results include `interference`, and ordinary errors include
`error.partial.interference` captured before synthetic-release cleanup. It reports
request `baselineEpoch`, atomic `currentEpoch`, `epochChanged`, cumulative
`ownTaggedMouseEvents`, `ownTaggedKeyboardEvents`, `foreignMouseEvents`,
`foreignKeyboardEvents`, `targetWindowDestroyEvents`, `emergencyRequested`, and
`disconnected`. `lastForeign` contains at most one latest mouse, keyboard or
target-window-destroy sample: kind/message category, capture `observedAtTick64`,
and Windows `eventTime`. Mouse/keyboard samples also include `injected`,
`lowerIntegrityInjected`, `extraInfoZero`, `low32MatchesOwnTag` and
`extraInfoUpper32Zero`; only mouse samples include a point. The two width flags
compare bits without exposing either extra-info value; they are diagnostics only
and never make a mismatched full-width tag count as an own event.
It never exposes private own-tag values, foreign extra-info values, keyboard
virtual keys/scancodes/text or event history. Hook callbacks only update lock-free
atomics, with no allocation, logging, waiting or locks. Snapshot reads try at most
three times: `snapshotCoherent:false` means the latest sample is omitted and
counters are individual atomic observations. Epoch/disconnect/emergency fields
are separate atomic observations and may advance during sampling. A later foreign
event can replace the event that first caused interruption before the error is
sampled. An untagged event is not proof of human input: these fields distinguish
observed tags/flags and cannot identify its originating process or prove that an
injected tag was preserved or transformed. All interruption guards and pass-through
behavior remain unchanged.

Errors after actuation include partial delivery count, foreground activation
attempt and synthetic release outcome where available. `actionExecuted` also
becomes true after successful foreground activation, even if later input fails.
The logical drag position commits at completion; after interruption it remains at
its pre-drag position while the OS cursor may be partway along the path. Query
status for the observed cursor; do not replay the failed action automatically.

## Input and interference limits

Switched mode intentionally changes the real foreground window and system cursor.
It is global OS input, not simultaneous application-local independent input. Each
pointer retains a separate logical position; actuation from one never changes
another pointer's state. No invisible global fallback exists behind `move`.

Before actuation the broker refuses physical buttons/modifiers already held,
activates the bound root with `SetForegroundWindow`, verifies actual OS foreground,
and checks that the visible hit window belongs to that exact process and bound
main-or-owned-popup surface. An accepted foreground owned popup needs no activation.
Every subsequent input event rechecks identity, client point, hit and foreground.
If the ordinary activation attempt does not make the exact root foreground, the
only preparatory input exception is one natural click on that bound root's exposed
nonclient caption. This is explicit global Switched input, outside the client
rectangle; it never substitutes a client or another window's click. At most 64
candidate points are scanned in the top strip from the outer window top to
`ClientToScreen(0,0).y`, within one cooperative 750ms scan/input budget.
Near-edge offsets of 48/64 pixels and center/quarter positions across four rows
are tried before the remaining coarse grid, with clamping and deduplication under
the same 64-point cap, to cover narrow exposed caption strips. Occluded
points are skipped before sending `WM_NCHITTEST`. The exact root must return
`HTCAPTION` within a timeout of at most 100ms; system-menu, resize, min/max and close
hit codes are excluded. Coordinates outside the message's signed 16-bit range are
not candidates. Identity, desktop, geometry, visible exact process/root hit,
physical-held state, interference generation and exact `HTCAPTION` are rechecked
before each of the tagged absolute move, left-down and left-up events. The button
is tracked for ordinary interruption cleanup. This exception requires no synthetic
keys/buttons already held, so modifiers cannot alter the preparatory click.

After the click, foreground is observed for at most 200ms before proceeding to the
ordinary client hit gate and requested input. If no exposed caption is found, no
activation clicks are sent; if checks fail after delivery, the partial error
reports accepted inputs and does not replay. There is no key/Alt emulation,
Z-order manipulation, setting change, timeout reset or thread-attachment bypass.
Custom titlebars extending entirely into the client area and occluded captions
therefore cannot use this exception. Caption scan/wait budgets are cooperative;
OS calls and scheduling add latency, and check/input races remain possible.

Failed activation, occlusion, target disappearance, desktop change or short
`SendInput` delivery returns an error. It does not use `AttachThreadInput`,
`SetKeyboardState`, PostMessage input, or APIs in a target process.

WH_MOUSE_LL / WH_KEYBOARD_LL run in this EXE on the original responsive message
thread. With collaboration off, callbacks pass physical input through; explicit
collaboration suppression is described above. A per-process `dwExtraInfo` marker is
generated with `BCryptGenRandom` into a DWORD, masked to a positive 31-bit value,
rejected if zero, stored as `ULONG_PTR`, and sent unchanged. The positive 31-bit
width is intended to preserve the value across common 32/64-bit zero/sign-extension
paths; compatibility still requires actual transport evidence. Own-event detection
continues to require exact full-width callback equality. The marker is a correlation
hint, not an authentication boundary; target identity and authority gates remain
independent. A mismatch does not identify the component that changed or originated
an event, and no responsible transport or third-party product is established by
the marker alone. With collaboration off, physical and foreign injected
events increment an interruption generation; active drag/text stop at the next
checked event boundary and release tracked own held keys/buttons. Idle held state
also releases on interference. Changing the active input pointer releases the
previous owner's state first. Text has a cooperative two-second deadline; drag
duration is capped at two seconds. Win32 validation/dispatch and scheduling may
add latency, so neither is a hard real-time guarantee.

Ctrl+Alt+Pause stops input and clears overlays if OS hotkey registration succeeds.
Status reports actual registration, which may fail if the chord is reserved.
Outside explicit supported mouse suppression, physical input passes through.
There is no guaranteed physical/synthetic key
ownership separation in Windows: a human pressing the same key during a synthetic
hold can overlap a cleanup release. Mouse collaboration does not establish keyboard
ownership isolation.
Hooks may be removed by Windows after an OS timeout; installation success is not
continuous hook-health proof. The small callbacks avoid blocking work, but this
prototype requires actual interference and emergency-stop tests.

Cleanup sends up events only for tracked own synthetic downs. Cleanup may occur
after a physical foreground change; releases still act globally
on the current OS input state and may be observed by the new foreground window.
A failed release
sets `cleanupPending`, blocks new actions, is retried while idle, and makes stop or
shutdown return `cleanup_failed`; a failed final disconnect cleanup exits with code
2. A successful stop clears all cursors and allows recreation. A process crash or
forced termination cannot guarantee release. SendInput acceptance never proves
the target application changed; all results keep `appEffectVerified:false`.

## Overlay and diagnostics

Tiny colored cursor triangles with neutral native-font ID labels use topmost,
layered, transparent, no-activate tool windows, color-key transparency and
`HTTRANSPARENT`. They neither intentionally intercept clicks nor steal focus.
They are visible on the active desktop only. Actual click-through, focus, multi-DPI,
light/dark visibility and app behavior remain visual/runtime acceptance gates.

Stderr emits bounded structured startup/shutdown, operation-name and stable error
code records with UTC timestamps, prototype version and platform. It does not log
raw requests, text, executable paths or request IDs. The parent owns capture,
storage limits and lifecycle of these diagnostic streams; this EXE creates no log
files, caches, target-file backups or app-state fixtures. Exit 1 means startup or
broker failure; exit 2 means final synthetic cleanup failed.
