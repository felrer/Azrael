# Webview health diagnostics

Status: `partial` — source/runtime fixtures cover the production diagnostic paths. A matching packaged host/UI and a new window are required for installed use. Windows is the verified source-test host; Linux/macOS and full installed renderer-crash acceptance are separate.

The events use Azrael's existing native extension logger, the same sink as `Webview renderer did not become ready`. Use **Developer: Open Logs Folder**, select the affected window/extension-host log directory, and search its Azrael/Codex extension logs for `ui_health.` or `Azrael Webview health`. The platform owns log rotation and retention; this change adds no log database, export service or new persistent files. Save the narrow time interval promptly before VS Code rotates it. Share the `ui_health` records after review, rather than raw surrounding logs that may contain other sensitive data.

Each structured record includes UTC `observedAt`, level supplied by the logger, `component`, `webviewRef`, extension version, role, OS/architecture, last startup phase and dropped-record count. The random reference identifies one Webview lifetime, not a user/thread. Idle restore remains in the same lifetime; close/reopen gets a new reference. Correlate by reference and time within the same window's log directory. Renderer fields are allowlisted again at the host; command text, DOM content, URLs, paths, credentials, exception messages and stacks are not included in these records.

| Event suffix (`ui_health.` prefix) | Established observation and interpretation |
| --- | --- |
| `html_generation_failed` | Host could not prepare UI HTML; original failure still propagates. |
| `startup_phase`, `startup_timeout` | Last observed readiness phase and existing guard timeout. `signalObserved` distinguishes some UI telemetry from no observed signal; this is not process-crash proof. |
| `javascript_error`, `unhandled_rejection` | UI observed a JS failure; fixed `errorKind` only. This does not establish a native renderer exit. |
| `resource_load_failed`, `csp_violation` | Browser observed a script/link/image load failure or CSP violation. No failing URL is collected. |
| `drag_started`, `drag_blocked`, `drag_terminated` | Drag start, cancellation of its default action, and observed drop/dragend/blur. A blocked drag is kept separate from an active drag. |
| `drag_end_unobserved` | A heartbeat still reports dragging after 30 seconds. A long legitimate drag is also possible. Confirm stuck host `pointer-events` separately; this event does not prove it. |
| `signal_lost`, `signal_resumed` | Visible UI stopped/started reporting for over 30 seconds. `rendererExitConfirmed:false` means crash, freeze, overload and message-path failure are unresolved alternatives. |
| `host_observer_delayed` | Host's own check was delayed over 30 seconds, including OS sleep; that interval is not attributed to the renderer. |
| `visibility_changed`, `page_hidden`, `disposed` | Visibility/navigation/lifetime boundary. Hidden views do not trigger signal-loss warnings. |
| `idle_suspended`, `idle_restore_started`, `idle_restored`, `idle_restore_failed` | Intentional idle blanking and HTML reassignment, or restore failure. `idle_restored` means HTML assigned, not proof of a painted/ready UI. |

For a true native crash, correlate these observations with VS Code `main.log`/the affected window's `renderer.log`, process termination reports and Crashpad dumps. On Windows the usual user-data root is `%APPDATA%/Code`; isolated/portable hosts can use a different root. A `render-process-gone`/crashed process record or matching dump is independent evidence; no event from an older or different process should be joined merely because it is nearby in time. The extension API does not supply a renderer-exit event, so a renderer crash can prevent its final telemetry from being sent. Missing diagnostics are not proof of normal operation.

Detailed collection defaults on. Set `AZRAEL_DIAGNOSTICS_UI_HEALTH=off` before launching the host to disable UI health listeners/heartbeats and normal diagnostic records; `on` overrides the master `AZRAEL_DIAGNOSTICS` policy. Restart the relevant host to apply the environment. Host HTML-generation/startup failures retain their minimal error records. The UI admits at most 30 ordinary records/minute plus six reserved heartbeats, keeping liveness available during event storms; the host admits at most 60/minute and suppresses ordinary heartbeat output. Overflow or sink failures are counted for the next admitted record, which may itself be lost on abrupt exit. These limits bound overhead but cannot guarantee delivery.

Source regression bundle: `source-ui-health`. It covers production serializers, host classification/output, startup guards, strict pinned transforms, idle lifecycle, rate/disable controls, cleanup and secret canaries. It does not replace installed-host reproduction.
