# Window Use

Status: `partial` — app-based permissions, retirement, selected-window UIA control and conversation-scoped desktop control are implemented in source. Host/policy tests, rendered UI and Windows native compilation have passed. Live desktop input and installed-package acceptance remain unverified. Evidence: [owning work record](../../work/EZ-01-window-use-multipointer-review/01-plan.md).

<a id="platform-availability"></a>
<a id="linux-selected-window-backend"></a>
## Product and platform scope

Window Use is a built-in MCP capability with brief host-provided guidance. It has one enable switch, no numbered stages, and no separately installed Window Use or Computer Use skill. The host enforces permissions independently of instruction loading. Product availability remains Windows-only under the [multi-platform contract](multi-platform.md); retained Linux backend source does not activate Linux or macOS product support.

## Control modes and permission lifetime

The host registers persistent conversations for Window Use and restores their durable approvals before publishing a successful start/resume response. Native `thread.ephemeral` metadata excludes hidden helper conversations, including automatic title generation, from rendezvous publication and approval restoration. The exclusion follows the owning engine connection across thread/turn notifications and ends on thread closure or disconnection; it grants no Window Use authority. Persistent conversations retain fail-closed registration and approval restoration. Preservation feature: `ui.window-control`.

Implemented in source: selected-window UI Automation control and separate whole-screen coordinate input. Desktop control is an explicit per-conversation, session-only grant. It includes individual control under that same authority. User Stop, revocation and thread closure revoke it and inherited operations; ordinary turn completion does not. Process recreation cannot recreate it from an old accepted receipt. Installed-runtime and live desktop input acceptance remain separate from source verification.

Security App (시큐리티 앱) is the displayed name for the existing observation-protection list and now also excludes the app from control; whitelist (화이트리스트) remains the app control exception list. Security Apps cannot be controlled through individual or desktop authority, including when whitelisted or previously approved. There is no additional control exception approval. Observation approval never removes this control block or unmasks screenshots. The app whitelist never manufactures a global grant.

Selected-window semantic operations show the adopted model cursor at the actual element location without duplicating physical input. Whole-screen input can choose another verified app between operations. Each gesture remains pinned to its authorized root/popup; cross-app drag is not claimed. Same-user/session/desktop/integrity and Stop checks remain effective.

### Input modes and virtualization boundaries

| Mode | Input and authority | Boundary |
| --- | --- | --- |
| Selected-window semantic control | App control approval, or inherited conversation desktop authority; fresh references inside the explicit `windowId` | Supported UI Automation patterns; a cursor overlay does not inject a second physical action |
| Selected-window Switched input | App control authority with shared-foreground effects disclosed; exact process lifetime and selected root revalidated | Physical screen coordinates inside the root client; explicit collaboration preparation before claiming isolated relative-mouse motion |
| Whole-screen coordinate input | Explicit conversation-only desktop authority; live hit target and occupancy checked per operation | Shared Windows input stream across verified apps; Security Apps remain blocked |

Switched collaboration virtualizes logical user/model pointer positions and schedules bounded gestures over one physical input stream. It may activate the authorized target and recover permitted foreground/occlusion changes. It is not independent background input, simultaneous OS keyboard streams, or a grant to manipulate unrelated covering windows. Physical user keyboard/IME input stops model input; unsupported mouse routing fails open. The [multi-pointer contract](multi-pointer.md) owns capability preparation, FIFO ordering, cursor presentation and bounded recovery. Dedicated selected-window conversations retain their immutable tool ceiling; neither an app approval nor a backend failure expands it.

The DLL-based process-hook prototype is not an active Window Use backend; its design and scoped outcomes belong to the [historical work record](../../work/EZ-01-window-use-multipointer-review/01-plan.md#중단한-dll-경로와-보존할-검증-한계). Retained adapters or older installed packages do not grant current authority. Backend failure cannot silently switch to another input path, replay ambiguous delivery or claim unverified cleanup.

## Permissions

| Capability | Default while enabled | App exception |
| --- | --- | --- |
| Discover windows, status, window capture and bounded inspection | Allowed | Security Apps require explicit observation approval |
| Whole-screen capture | Allowed | Security App areas are masked |
| Individual window control, restore/resize and input | Automatically ask for app approval, or inherit current desktop authority | Control whitelist skips individual app approval; Security Apps are blocked |
| Whole-screen coordinate input | Automatically ask for conversation-only desktop approval | Security Apps are blocked, taking precedence over the whitelist |

Lists use normalized absolute executable identities, never titles or wildcards. App grants apply to the app's windows. Individual control revalidates its selected window; desktop input revalidates the live window/process at the explicit screen point before each operation. Drag uses explicit fromX/fromY as the start and x/y as the endpoint. A fresh desktop observation is consumed once, including failed admission after its use; old images never authorize replay. Observation and control grants are independent: control whitelisting or global input authority does not authorize observing a Security App. Discovery withholds unauthorized titles.

The master switch gates every managed operation. Policy changes invalidate observations, pending approvals and further input; re-enabling never replays input or clears Stop. OS permissions, capture protection and mandatory action confirmations remain effective. App content cannot authorize actions.

Actual tool calls request missing permission and wait for the user. There are no model-facing request_permission or prepare_permissions tools. Acceptance continues only after fresh permission, target and observation validation; changed observations require a new capture/inspection before input. Explicit denial returns approval_denied, unanswered requests return approval_timeout, and excluded control targets return security_app_blocked without offering app approval. Requests identify scope, purpose and shared-foreground effects. Task identity, policy generation, cancellation and revocation bind every approval; late responses cannot restore revoked authority. release_desktop_input releases resources without manufacturing permission or clearing Stop.

Approval cards provide whitelist and Security App settings entry points bound to the trusted current request. Opening settings neither accepts nor settles the request. App requests can preselect their verified app; global requests do not fabricate one. Explicit saves revalidate request identity and current settings revision. Policy changes invalidate pending authority; adding a Security App blocks further control. Manual settings removal is required before that app can be controlled.

## Whole-screen capture and masking

The host supplies its Security App list to native `captureDesktop`; callers cannot replace it. Capture changes no focus, window state or input. Native code captures in memory, masks complete blocked-window and inherited owned-popup rectangles, then encodes the masked image. It reports physical dimensions, virtual-desktop origin and masking metadata. Unmasked images are not returned or written as capture artifacts.

Pre/post visible-window identity, geometry and stacking snapshots plus window-change monitoring reject observed capture races. Unknown visible identity, invalid geometry, protected content, failed monitoring or inconsistent snapshots return no image, with no unmasked fallback. Windows compositor updates and asynchronous events are not an atomic privacy boundary: residual transient races remain a limitation, not complete security isolation.

## Selected-window control and collaboration

Individual tools require an explicit opaque `windowId` from `list_windows`; there is no model-facing `select_window` or implicit current target. IDs remain stable across list refreshes for the same exact window lifetime and conversation. Each window retains its own observation and generation, so switching requests between windows does not discard the other window's references. Trusted manual UI may retain a default selection; selection grants no control. Cooperative screen coordinates differ from client pixels and outer-window image geometry. Capture/inspection verifies app effects; input delivery alone does not.

### Automatic window occupancy

The first control request automatically acquires the exact window for its authenticated conversation. Observation alone does not acquire control. Once owned, an owner's window-scoped observation or control request pins the lease until completion and restarts a fixed 30-second idle period. An executing request never expires, and other agents' requests do not renew the incumbent's lease. Turn completion, final responses and waiting for user replies do not release it. Internal lifecycle/resource cleanup pins unfinished cleanup for safety but never renews the idle clock. Stop and revocation cancel input independently; they do not authorize replay.

Contenders wait outside the actual input queue for at most 30 seconds, then receive `window_busy` with `actionExecuted:false`. A contender already holding another window does not wait for an occupied additional window, avoiding circular waits. Expiry or ownership transfer invalidates previous observations; control requires a fresh capture/inspection after reacquisition. Desktop coordinate input participates in the same exact-window occupancy after hit-testing and revalidates that target before input. Global physical input remains serialized separately from idle window ownership. Cross-process claims use atomic arbitration; unknown or interrupted busy ownership fails closed rather than being stolen based on a timeout or PID absence.

[Multi-pointer collaboration](multi-pointer.md) owns shared-foreground input, separate user/model cursors, queued bounded mouse gestures, cursor rendering and bounded foreground/occlusion recovery. Foreground change alone does not indicate Stop. Partial/unknown input is never automatically replayed. Physical keyboard, IME and unsupported-device limits remain explicit; switched input is not simultaneous independent desktop input.

Ordinary conversations retain their tools. Existing dedicated selected-window conversations retain the native immutable tool ceiling. Occupancy, exact identity, stale-observation, cancellation and stop checks continue to apply. Observation never activates, restores, resizes or launches apps, writes clipboard data or injects input. A failed selected-window capture does not switch to another target or an unmasked screenshot path.

Structured summary/find/read/changes remain bounded and report coverage. Partial results do not establish absence or uniqueness; password values are withheld. Semantic actions use supported UI Automation patterns and fresh in-window references. Workspace task macros retain bounded execution, explicit postconditions, no saved credentials/authority, and fresh target checks; size macros retain their separate storage scope.

Read-only geometry failures may use bounded observation recovery. Explicit Stop and the Windows stop shortcut remain user controls; ordinary Escape belongs to the app. Stop/revocation/EOF releases owned input/cursor resources without closing user apps or discarding unsaved work. Unknown delivery/termination blocks replay or unsafe replacement.

## Migration and retirement

Settings schema 3 stores the master, Security App list, control whitelist, revision and policy generation. Schema-2 master is preserved; schema 1 preserves its established implicit Window Use master. Retired stage flags and global all-app approval never become new app authority. Exact persisted Window Use approvals remain control-only; observation approval never silently removes a blacklist entry.

Windows child-session execution and Computer Use/Sky full-desktop input are retired from the active Window Use design and excluded from its active packaging scope. Generic Node REPL and shared approval UI remain separate retained responsibilities. Environment sync retires only unchanged receipt-owned legacy skills; unmanaged/edited copies require conflict resolution. Source changes neither replace the installed app nor terminate existing Windows child sessions. Package transition and installed-version scope remain owned by [Computer Use retirement](computer-use.md).
