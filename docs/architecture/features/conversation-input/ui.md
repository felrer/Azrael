# Conversation Input UI

<!-- architecture: {"id":"arch.conversation-input.ui","feature":"conversation-input","layers":["ui"]} -->

## Composer and feature surface

Status: `partial` — pinned source transforms, scoped runtime fixtures, packaged host acceptance and actual webview startup are verified; full presentation and theme comparisons remain pending.

The independent Azrael distribution uses the pinned upstream UI as an input to its own guarded preparation transforms. The upstream snapshot and the original Codex extension remain separate product inputs.

The empty composer displays one of `[•ᴗ•]`, `( ˘ᵕ˘)b`, `ʕᵔᴥᵔʔ`, `ʕっ•ᴥ•ʔっ🍯`, `^•ᴗ•^`, `(づ｡◕‿‿◕｡)づ` and `(｡•̀ᴗ-)✧` in every composer mode. The choice is random on first display and stored by native composer session key and execution host in webview local storage, keeping an existing conversation stable across rerenders, mode changes, revisits and webview reloads. Unsent new-chat surfaces use the native draft key until a conversation exists. Storage failure retains the choice in the current webview memory; persistence across reloads requires available storage. This shared presentation behavior applies to all desktop platform targets; installed-host and other-platform acceptance remain separate. Preservation feature: `ui.ui-cleanup`. Its accessible input identity remains available. The add menu offers existing file/folder attachments and supported integration entry points. Goal setting and Plan mode registration, selection handlers and their composer mounts are excluded from the Azrael UI. Sketch registration, selection handlers and composer mounts are preserved, including the slash/mention drawing action and shared composer creation capability. Native engine tools and session protocols retain their own contracts.

The slash command menu excludes Model, Fork chat, Initialize, Reasoning level, Code review, Status and the Ultrafast service-tier option. Their dedicated registrations and mounts are removed, including both code-review variants; the shared service-tier registrar skips Ultrafast while preserving Fast. Composer toolbar model/reasoning and service-tier selectors, status services and the shared underlying services remain available through their separate entry points. This shared presentation policy applies to Windows x64, Linux x64 and macOS ARM64. Preservation feature: `ui.ui-cleanup`.

Pets integration entries, settings and dedicated UI/host paths are excluded from the Azrael distribution. This presentation boundary does not delete personal skills or saved user data. Generic connector and account/avatar behavior keep their existing contracts.

Shared bundle imports retain disabled empty query/state adapters and empty module exports; these perform no Pets RPC, persistence, subscription or selection mutation. Inert preload metadata, shared avatar/render utilities and built-in artwork remain in the pinned bundle graph. Existing thread-goal state and image/sketch attachment rendering keep the handlers required to display and recover persisted conversations.

Full access text uses the same foreground tokens as Request approval in the permission selector and the selected composer control. Only the leading menu icons are tinted: Approve for me mixes the native sky-blue token with gray, and Full access mixes the native orange token with gray (55% accent, 45% description foreground). Permission values, selection behavior and native approvals retain their existing contracts; the display change does not imply that the two modes grant the same authority.
