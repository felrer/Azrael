# Work Orchestration UI

<!-- architecture: {"id":"arch.work-orchestration.ui","feature":"work-orchestration","layers":["ui"]} -->

## Team groups and Lead entry

Status: `current` in source — native recent-list and menu interactions verified in light and dark themes on Windows; packaging and installed-host acceptance remain pending. Evidence and runtime scope are tracked in [Team UI work](../../../../work/AZ-01-team-lead-ui/01-plan.md). The Team runtime and instruction contract is owned by [Team UI and Lead creation](README.md#team-ui와-lead-생성).

The recent-chat popup reuses its existing native menu and rows. Team-owned loaded sessions form a collapsible group named from the Lead's title, with `Team` as the fallback. The Lead row has a small `Lead` label beside the existing metadata; flags, activity, timestamps, archive and navigation retain their native behavior. Standalone conversations remain ordinary rows. Groups follow the first member's position in the native filtered order; collapse preference is persisted by host and Team identity. Type, environment, title and flag filters apply before grouping. A group does not imply that every Team member has been loaded. The home recent preview retains its native layout with the same Lead label.

Ordinary activation of the native New chat button retains its existing action. Right-click, the keyboard context-menu action and a stationary long press open a native menu offering **New Lead** (**새 Lead** in Korean). A long press suppresses the following ordinary click. Movement, pointer cancellation and unmount cancel pending gesture timers. Selecting New Lead establishes its pending role intent and invokes the native new-chat action once. Failure is visible and does not become an ordinary chat creation. Existing model, provider, permission and draft ownership remain in their owning services.

Preservation feature: `ui.team-lead`. Light/dark interaction acceptance must cover disclosure persistence, Lead display, member navigation, filters/flags, menu gestures and creation failure. Native first-submission admission and role restoration are separate runtime checks; renderer fixtures do not establish actual model behavior or installed-host acceptance.

`scripts/verify-team-ui-render.mjs` exercises the transformed native recent-menu and merge functions, native row/new-chat components, preference atom and CSS. Host queries, transport and localization are fixture adapters. Its 36 light/dark checks cover both direct Team rendering and the owning recent-list route, including All/Local/Cloud, title and flag filters. Creation transport currently supports the verified local host; other hosts fail explicitly. Native panel-opening failure uses the host's error notification, while draft preparation and submission failures retain their owning UI errors.
