# Azrael selected-window Computer Use

This is a mode of the existing Computer Use skill. It applies only to a native conversation whose `computerUseMode` is `selectedWindow`. Ordinary foreground Computer Use continues to follow the Sky instructions.

Use only the `azrael_window` MCP tools in this mode. The user selects the target through Azrael; a saved app approval does not select a window. Start with `status` to obtain the opaque target ID. Do not enumerate other windows, supply a HWND, rebind by title, import Sky, launch a helper yourself, or substitute a shell, browser or desktop tool. A missing selection requires the user to select a target.

`capture` returns the selected window's fresh image and accessibility elements. Inspect that result before an action. Use only supported Invoke, Value, Toggle, Selection, ExpandCollapse or Scroll patterns with the current `observationId` and `elementId`. Element indices and coordinates from older observations cannot be reused. An action, resize or macro invalidates the observation; capture again before another element action. Unsupported patterns are errors, not permission to inject mouse or keyboard input.

The host may restore an initially minimized target without activating it, then wait for a new frame. If the target becomes minimized again while running, or the mode pauses after interference, stop and wait for the user to resume. Do not repeatedly restore or bring it forward. Separate top-level dialogs require user selection. Closed or replaced windows require a new selection. Never treat a cached or unavailable frame as a live screenshot.

`resize` uses outer-window dimensions in DIP units and preserves position. Named macros from `status` contain bounded size steps. `run_size_macro` applies only a user-defined macro to the selected target. Report actual size or an error; do not change another window, display settings, pointer settings or Z order to force success. A rejected size stops the macro. Already-delivered application actions are not guaranteed reversible.

Stop, revoked approval, changed window identity and stale observation invalidate ongoing work. Do not use a late response after cancellation. Tool errors about permissions retain the native permission profile; do not elevate or change it to full access. The restricted tool surface does not authorize credential, security or destructive actions beyond the user's task.

An app can cause focus changes even when no-activate APIs are used. If the host reports interference, stop rather than stealing focus back. Users may work with their own mouse in other applications, but concurrent editing of the selected target must be treated as a conflict. Capture, UI Automation, restore and resize support are capability-specific; a tool's presence is not evidence that an application has passed native acceptance.
