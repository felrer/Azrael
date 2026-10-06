# Window Use

Status: `partial` — Actual Firefox and File Explorer capture, inspection and status pass. Explorer capture passes with a higher foreground window geometrically overlapping 27.94% of its area. Explorer button and search-value effects pass, with foreground activation observed during mutations. Native interference guards can report uncertainty after an effective action. Physical-input routing during concurrent use, installed tool availability and GUI host acceptance remain unverified. Advisory session occupancy is implemented and covered by host and separate-process tests; installed UI acceptance remains separate. The existing selected-window boundary is described in [Computer Use](computer-use.md#selected-window-mode).

## Product requirements

Status: `target`.

Window Use is distinct from Computer Use in its product name, settings, instructions and model tools. It is available alongside coding tools in ordinary conversations. The model discovers open windows, identifies the window needed for the user's request, selects it and controls that exact target. The user's physical mouse and keyboard remain available for other work. Dedicated selectedWindow conversations retain their existing immutable native tool ceiling.

Capturing a target behind another window must return the target's own content without raising it, changing focus or including the covering window. Control must not move the user's cursor, inject into the shared keyboard stream or consume the user's clipboard. Foreground preservation is optional for control, while physical mouse and keyboard availability remains required. An accessibility action can activate a window or open a dialog; concurrent physical-input routing requires separate verification.

Task macros support both immediate execution of a supplied definition and saving a definition for reuse. The host implementation supports both paths; real-window acceptance remains pending.

## Session occupancy

Status: `current` — Source, host integration and separate-process behavior are verified. Installed UI acceptance is pending.

Window discovery in the model tools and the Azrael window picker includes the sessions that have selected each exact window. A selection retains occupancy while ready, running or paused, and releases it when cleared, replaced or disconnected. Session metadata contains a conversation identifier, workspace display name and control state; it contains no authentication tokens or conversation content. Occupancy matches HWND, PID, process creation identity and executable rather than the window title.

Public results carry `occupancy.status` as `available`, `occupied` or `unknown`, plus a `sessions` array containing `sessionId`, `workspaceName`, `state`, `isCurrentSession` and `updatedAt`. A window selected only by the current session is available to that session; any other selected session makes it occupied. The current session is determined from the authenticated conversation and host, not model-supplied identity. `running` describes an active operation; otherwise the published state follows the selection's selected, ready or paused state.

Azrael hosts in the same Windows user environment publish advisory occupancy to a shared local directory, including hosts with different Codex state homes. Each host updates its own expiring record and removes it on disposal. Readers ignore expired or dead-host records. An unavailable occupancy lookup is shown as unknown rather than a free window. The registry supplies information only; it does not confer application approval, window authority or an execution lock.

The model is instructed to defer selecting or controlling a window held by another session and refresh occupancy before resuming. The same rule applies to a previously selected target and to macros. The UI displays the other session and its state alongside the window. Selection and execution remain governed by existing authority checks; automatic cross-session queuing and exclusive execution are outside this contract. Simultaneous discovery or selection can race, and foreground effects can still interfere with other windows or Computer Use.

## Capture

Status: `target`.

Reuse the prototype's Windows Graphics Capture path, which creates a capture item for the exact selected HWND. The platform supports capture of occluded windows; see Microsoft's [window capture API](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow) and [WGC capture guidance](https://learn.microsoft.com/en-nz/windows/apps/dev-tools/winapp-cli/ui-automation#screenshot). This platform capability does not establish application-specific acceptance.

Each usable image must belong to the current target identity and carry a fresh observation and frame timestamp. A failed or unavailable frame is reported as unavailable. Desktop cropping, foreground activation and substitution of another window cannot fulfill this contract. Separate top-level popups require their own target handling; their content must not be assumed to appear in the selected parent's frame.

Occlusion and minimization are separate cases. Window Use retains the prototype's non-activating restore of a minimized target on initial use or explicit resume. Minimizing an active target pauses further control; a minimized target is not treated as a fresh capture source.

## Task macros

Status: `partial` — Host implementation and native compilation are verified; real-window acceptance is pending.

A task macro is a bounded sequence of structured operations within one selected target. It complements the existing size macros. Initial operations can reuse UI Automation Invoke, Value, Toggle, Selection, ExpandCollapse and Scroll, with explicit conditions for waiting and checking results. A typical sequence sets a search field, invokes its search button, waits for results and returns a screenshot.

The executor resolves each element again inside the selected window before acting. A macro stores semantic selectors and required patterns rather than observation-specific element IDs or screen coordinates. A selector must resolve uniquely; missing or ambiguous matches return an error. The native inspector exposes names, control types, patterns, AutomationId and parent relationships for reusable selectors; provider-specific availability still requires acceptance.

Large accessibility trees return a bounded breadth-first snapshot with `elementsTruncated: true` instead of failing the target capture. The same field is false for complete observations. Element, depth and pending traversal limits remain enforced, and only returned elements retain action references. An incomplete snapshot cannot establish selector uniqueness or absence, so macro inspection stops before evaluating conditions or issuing a mutation. A direct action can use a verified exact reference from the current partial observation.

A selector combines exact AutomationId or accessible name, control type and an optional ancestor scope. Runtime IDs identify live elements during a run and must not be treated as reusable IDs. Conditions require explicitly readable properties: presence, enabled state, non-sensitive value, selection, toggle and expansion state where the provider exposes them. Missing property support is distinct from a condition evaluating false. An off-screen accessibility flag alone must not exclude a control in an occluded window. Password values remain excluded from inspection and persisted inputs.

Each step checks target identity, authorization and cancellation, observes fresh relevant state, performs one operation and evaluates its postcondition. Waits have deadlines. A failed or uncertain mutation stops the sequence and reports completed steps, the failing step and available final state. The executor must not replay an uncertain mutation automatically. Already-delivered actions cannot be promised to roll back; interruption prevents subsequent steps.

Execution through one tool call avoids a model round trip per mechanical step. Read-only condition polls should use accessibility state without generating and transmitting a PNG each time. Images are returned when needed for a decision, at completion or failure. Internal observations and target checks remain necessary. Reusing a capture session is a possible optimization after measurement; performance is not established by this design.

The execution tool is `run_task_macro`, accepting the selected `targetId`, a supplied definition or saved definition ID, and execution parameters. It returns a run ID, overall state, per-step outcomes and final observation when available. `save_task_macro` and `list_task_macros` manage reusable definitions. `run_size_macro` retains its separate meaning. An example task has these steps:

| Step | Operation | Result condition |
| --- | --- | --- |
| 1 | Set the uniquely matched search field to the supplied query | Field value equals the query |
| 2 | Invoke the search button | Invocation delivered; completion is checked in the next step |
| 3 | Wait for the results element | Element exists and is ready before its deadline |
| 4 | Capture the selected window | A fresh target frame is returned |

The host owns bounded orchestration and per-step authorization; the native worker owns exact-window element resolution, property reads and supported operations. `inspect` provides accessibility state without PNG capture. The backend timeout disposes its owned helper; a macro must surface an uncertain action result and cannot interpret timeout as proof that the app did nothing. A stopped run must cease condition polling and skip subsequent steps even while an already-issued provider call is settling. A definition contains at most 32 steps, runs for at most 20 seconds and waits at most 10 seconds per condition, within the existing 30-second transport deadline. Longer tasks split at verified checkpoints.

Parameters supply strings at execution time. A definition contains `schema: 1`, parameter names and structured steps; saved definitions also require a stable `id` and `name`. Selectors and operations carry no live window authority or old element handles. Sensitive text belongs in runtime parameters instead of persisted definitions. Each run records the exact definition revision it executed; editing the saved macro does not alter an active run. Saved definitions confer no app authorization or window selection. The host stores them in `CODEX_HOME/azrael/computer-use/window-task-macros.json`, using a revision check, exclusive update lock and atomic replacement.

## Text, keys and concurrent use

Status: `partial` — Named message keys and a conservative interference policy are implemented. Actual Firefox address text changed, but a foreground transition with a possible user click interrupted concurrent background input verification. Firefox key and button effects remain unverified.

UI Automation Value sets a field's value; it does not reproduce key events. Invoke can activate a submit button when exposed, but is not a general replacement for Enter, Tab or shortcuts. Generic physical key injection would conflict with the user's independent keyboard use and cannot be the Window Use fallback.

The native worker provides experimental window-directed message delivery for named keys: Return, Tab, Escape, BackSpace, Delete, arrows, Home, End, PageUp, PageDown and space. The requested UIA element must own an exact native HWND within the selected window, verified by comparing it with `ElementFromHandle`. Virtual controls cannot fall back to ancestor or root HWND delivery because messages can reach another focused control. Posting a message is not evidence that the control received or processed it. Results identify `delivery: windowMessage`, `verified: false` and `experimental: true`; task macro key steps require an explicit postcondition. Microsoft's [keyboard delivery guidance](https://learn.microsoft.com/en-nz/windows/apps/dev-tools/winapp-cli/ui-automation#send-keys) describes controls that ignore posted keyboard messages. Supported adapters need application-specific tests and observable postconditions. General background key support, including Firefox, remains unresolved.

The prototype paused for any foreground-window or cursor-visibility change during an operation. Window Use permits unrelated foreground changes during capture, inspection and control while retaining target identity and capture validity checks. Mutations stop conservatively when a previously background target or its owned popup becomes foreground. Before/after checks cannot detect transient activation or attribute the cause of a foreground change, so this implementation does not establish unrestricted concurrent use. Concurrent edits by the user inside the agent's target also require conflict handling; background delivery alone cannot make those edits independent.

For capture, target identity, geometry, protection and fresh-frame checks should determine image validity. A user's foreground switch in another app does not by itself invalidate a correctly targeted WGC frame. Read-only inspection should not require desktop ownership. Mutating operations need a separate policy: capability checks and tests for provider activation, and detection of conflicts inside the target. Before/after foreground comparison alone cannot attribute a change to the user or provider. Input timing may contribute diagnostic evidence but cannot prove attribution during overlapping activity. The initial implementation must report ambiguous interference rather than claim guaranteed independence.

Expose supported operations for the observed target and element, with verified delivery paths distinguished from experimental ones. Experimental named-key delivery remains explicitly unverified until a window-directed adapter is tested for the application and its result can be checked. Modifier combinations, Unicode and application key events need separate coverage; a successful enqueue is not completion. Do not change system keyboard state to make an unverified shortcut work.

## Reuse and implementation prerequisites

Status: `draft`.

Retain the existing native WGC implementation, window identity checks, app grant store, per-observation element validation and size macro functionality. Extend the host/MCP boundary for model discovery and selection, rather than constructing native descriptors from model input. Return opaque candidate IDs tied to one conversation and validate a candidate's live identity again before binding. Ambiguous candidates require clarification. App approval remains separate from discovery and selection.

The owned MCP registration enables Window Use alongside ordinary conversation tools. The host registers exact ordinary native thread owners and publishes authenticated rendezvous state before forwarding successful thread/start or thread/resume results. Window actions still require trusted active-turn metadata, the actual Disabled permission profile and a separate app grant. Duplicate cross-engine ownership and failed publication reject initialization. Dedicated selectedWindow tool restrictions remain enforced by the engine.

The acceptance work must cover capture, semantic control, key delivery and concurrent activity separately. Begin with an isolated fixture offering readable state and actions, then Firefox with a disposable test page and a covering window. A generic CLI that falls back to physical input or foreground capture cannot satisfy Window Use's concurrency contract. Direct use of the existing platform implementations is the reusable baseline.

## Acceptance scope

Status: `target`.

Verify in an isolated Windows session under the existing [desktop and window protection procedure](../ops/development.md#computer-use-desktop-and-window-protection):

- Capture partially and fully covered targets, including an updated target with a visible frame marker. Assert target content, freshness and absence of covering-window pixels while preserving foreground and window order.
- Run a task macro while user input continues in another app. Assert correct target results, unaffected user text, cursor behavior and focus. Cover user window switching during capture and actions.
- Cover stale selectors, ambiguous elements, target closure or replacement, authorization revocation, cancellation, timeout, uncertain mutations and a provider that activates a window.
- Test supported text and key semantics separately, including Unicode and required application events. Report unsupported behavior explicitly.

Source inspection establishes reusable paths. It does not satisfy these real-window acceptance criteria.

The user explicitly authorized the current Firefox desktop for this test, overriding the isolated-session default for this run. The production backend and receipt-verified native runtime were exercised directly because this conversation did not expose `azrael_window` tools. This establishes component behavior, not a successful model/MCP call or installed-host acceptance.

| Actual Firefox operation | Result |
| --- | --- |
| Discover exact running window and restore without activation | Passed |
| Capture while another window is foreground | Passed; 1966×1432 PNGs, increasing frame timestamps, foreground and cursor preserved. Physical overlap was not recorded for this Firefox run |
| Inspect and status | Passed after fixing omitted native inspect dispatch |
| Address ValuePattern input | Text applied; foreground transition stopped the interference guard. The user reports a possible manual click, so provider activation and concurrent input acceptance are inconclusive |
| Enter, page input and button action | Not executed after the interference stop |
| Task macro on this window | Not accepted: 2,048 returned elements and `elementsTruncated: true` cannot establish selector uniqueness |

Read-only aftermath confirmed the local test URI in the address field and the blank tab still selected; no navigation was submitted. The guard cannot prove the causal source of a foreground change, and the user's possible manual click prevents attributing this event to the provider. Mozilla's [ValuePattern implementation](https://github.com/mozilla-firefox/firefox/blob/main/accessible/windows/uia/uiaRawElmProvider.cpp) routes text replacement through accessibility selection, and [selection can take focus](https://github.com/mozilla-firefox/firefox/blob/main/accessible/base/TextLeafRange.cpp). This remains a provider behavior to investigate, not proof of the installed build's precise call path or this test's foreground transition. Legacy accessibility text replacement must not be assumed to avoid activation. Firefox concurrent-input acceptance requires another controlled run; forcing foreground restoration or substituting global keys cannot satisfy it. Conditional cleanup made no mutation because subsequent physical input was detected; the typed URI and window state were preserved.

Evidence: `artifacts/verification/window-use-firefox-20261006-r4`, `window-use-firefox-20261006-r5`, and `window-use-firefox-20261006-r5-readonly`.

Actual File Explorer returns complete accessibility observations and its own captures while another window is foreground. A read-only run records a higher foreground window geometrically overlapping 27.94% of Explorer; bounds and z-order were checked across capture, without inspecting foreground pixel opacity. Refresh and the Details button can activate Explorer. Details-panel visibility changes and search-field values were verified after native interference errors, so successful effects are distinct from accepted tool completion. A repeated search-value action recorded Code-to-Explorer activation inside the native action interval while the last-input tick remained unchanged; the user reports no direct Explorer interaction. Search-value replacement can start a search without Enter. Conditional cleanup restored the empty search and initial Details panel; a transient UIA ancestry error required a subsequent read-only final-state check. These observations establish action effects and activation on these paths, not unrestricted concurrent input routing. Exact key-target ownership validation removes unsupported key capability from Explorer virtual fields. Evidence is preserved under the Explorer verification artifacts and the task plan.
