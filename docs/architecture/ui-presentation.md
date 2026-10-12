# Azrael UI presentation

## UI change guidance

Design Azrael UI in the OpenAI style. Reuse the pinned UI’s existing native components, page layouts, settings rows, switches, buttons, typography, spacing and semantic theme tokens. Verify the actual rendered page and its interactions in light and dark themes; plain unstyled controls or source-only tests do not establish visual acceptance.

## Composer and feature surface

Status: `partial` — pinned source transforms, scoped runtime fixtures, packaged host acceptance and actual webview startup are verified; full presentation and theme comparisons remain pending.

The independent Azrael distribution uses the pinned upstream UI as an input to its own guarded preparation transforms. The upstream snapshot and the original Codex extension remain separate product inputs.

The empty composer displays the cat text emoticon `^•⩊•^` in every composer mode. Its accessible input identity remains available. The add menu offers existing file/folder attachments and supported integration entry points. Goal setting and Plan mode registration, selection handlers and their composer mounts are excluded from the Azrael UI. Sketch registration, selection handlers and composer mounts are preserved, including the slash/mention drawing action and shared composer creation capability. Native engine tools and session protocols retain their own contracts.

The slash command menu excludes Model, Fork chat, Initialize, Reasoning level and Code review. Their dedicated registrations and mounts are removed, including both code-review variants. Composer toolbar model/reasoning selectors and the shared underlying services remain available through their separate entry points.

Pets integration entries, settings and dedicated UI/host paths are excluded from the Azrael distribution. This presentation boundary does not delete personal skills or saved user data. Generic connector and account/avatar behavior keep their existing contracts.

Shared bundle imports retain disabled empty query/state adapters and empty module exports; these perform no Pets RPC, persistence, subscription or selection mutation. Inert preload metadata, shared avatar/render utilities and built-in artwork remain in the pinned bundle graph. Existing thread-goal state and image/sketch attachment rendering keep the handlers required to display and recover persisted conversations.

Full access text uses the same foreground tokens as Request approval in the permission selector and the selected composer control. Only the leading menu icons are tinted: Approve for me mixes the native sky-blue token with gray, and Full access mixes the native orange token with gray (55% accent, 45% description foreground). Permission values, selection behavior and native approvals retain their existing contracts; the display change does not imply that the two modes grant the same authority.

## Session flags

Status: `current` in source — native row rendering and interactions verified in light and dark themes; build and installation pending.

Local sessions in the recent-chat menu and the new-chat screen's recent-chat preview have a Flag toggle immediately before the time or native hover actions, with extra spacing before Archive. Unset flags show only an outlined flag, without a button background or tile border, when the row is hovered or contains keyboard focus. Keyboard focus retains its visible outline. Set flags show a filled red flag even without hover. Clicking again clears the flag; flag actions do not navigate, close the menu or archive the session.

The chat-type dropdown contains a persisted **Flagged only** checkbox item beneath All chats, Cloud chats and Local chats. It combines with the existing type, environment and title-search filters while preserving native ordering. Saved local conversations with a matching host and conversation flag are included, along with the currently open local conversation even when it is unflagged. Its current identity follows the native active-row route, including a pending local thread with that identity. Other cloud and pending items without a saved conversation are excluded. Clearing a flag immediately removes a non-current row from the filtered list; the current row remains visible without acquiring a flag. The preview shares the same flags and updates immediately.

Flags use the native persisted UI preference store, keyed by host and conversation ID. They preserve menu ordering and other hosts' flags. The button exposes its pressed state and supports keyboard activation. Native time, running indicators and Archive keep their existing behavior.

`scripts/verify-session-flags-render.mjs` exercises the production Flag helper with the pinned native React, preference atom, row components and CSS. Host services and localization are synthetic; installed VS Code and real host persistence remain separate checks.

## Missing local chat images

Status: `current` in source — native component rendering and interaction verified in light and dark themes; build and installation pending.

When a local image referenced by a chat thumbnail is absent, the thumbnail displays `파일 없음` in its existing bordered tile using native theme tokens. The missing-file tile has no image-opening action. File absence is distinguished from permission, transport and cancellation errors. Loading and available-image behavior retain their existing presentation. A change to the image source, host or conversation clears the previous missing-file identity.

## Astra response speed

Status: `current` in source — native control rendering and interaction verified; build and installation pending.

For the exact OpenAI model `gpt-6-astra`, the model picker's lightning button cycles Standard → Fast → Ultrafast → Standard through the existing service-tier selection callback. Fast sends `priority`; Ultrafast sends `ultrafast`; Standard uses the existing explicit standard selection. Ultrafast uses the native purple theme token for the icon and a tinted button background in both light and dark themes. The tooltip identifies the active mode, and the accessible label identifies the next mode. Loading and the native unavailable state disable selection. Other models retain their native speed controls.

The engine advertises Ultrafast in Astra's bundled catalog and permits its request value for Astra when account-discovered metadata omits it. The UI discovery adapter also supplies missing Astra Ultrafast metadata so the native selected-tier resolver retains the choice. Other model slugs retain their existing catalog-based support checks. Source routing tests exist; Rust execution and live account support remain unverified. The control and callback were exercised using the pinned native React/menu/CSS modules with synthetic host state, including mouse selection and keyboard return to Standard. This source change has not been built or installed.

## Identity and session links

Backend HTTP protocol identifiers keep their upstream names, including `OAI-*` and `x-openai-*`. The `OAI-App-Brand` value remains `codex`; it must not be derived from the display brand.

The host and conversation UI identify the distribution as Azrael. Theme names, embedded VS Code command titles and the Devin model-picker notification also use Azrael. Actual service usage and model names retain their service identity. Local conversation links use `azrael://local/<UUID>`; original Codex links remain accepted for migration. The session-link injector is registered in the preservation manifest, and prepared assets must report `sessionLinkEdits` before package verification succeeds.

## Settings module contracts

Azrael settings use the OpenAI native page layout, heading hierarchy, settings rows, switches, buttons, spacing and semantic theme tokens. Reuse the pinned bundle's actual components and verified exports. Rendered light/dark layout and interaction checks are required for presentation acceptance.

Settings injectors import the bridge through the pinned UI `26.1007.21434` export `X9t` (`vm` internally); internal aliases are not module exports. Native ReactDOM root creation uses `XAt`; the separate legacy ReactDOM export does not supply `createRoot`. Settings navigation reuses initialized platform icon assets. Retired Pets registry entries retain an inert `{ visible: false, pending: false }` visibility result so shared navigation never dereferences an undefined result.

Account and usage surfaces, including shadow-root settings panels, inherit the native semantic palette and color scheme with VS Code and light/dark fallbacks. Cards, ticket rows, buttons and switches use theme surfaces. Both standalone and embedded presentations must show readable foregrounds and distinct light/dark backgrounds while preserving native geometry and interaction.

Instruction documents and Design use the native React Intl context for the active app language, including navigation labels, accessible text and page states. Korean language variants select Korean; other languages select English. Changing the app language updates presentation. Student names remain English in either language, while source document content and external diagnostics retain their original text. The standalone instruction surface follows the VS Code display language. Instruction navigation reads “Instruction Documents” in English or “지침 문서” in Korean; the not-implemented notice appears only in the page heading.

## Window Use settings

Status: `target` for unified presentation.

Window Use is the single settings, panel, consent and notification identity for observation, isolated execution, current-window control and whole-desktop control. The page has a product enable switch and describes the four stages, individual app approvals and all-app approval. Observation needs no per-app/window consent when enabled. App grants apply from isolated execution onward, while task-stage requests identify scope, execution location, reason and user impact. The all-app setting is described as skipping app consent rather than authorizing every stage.

Existing grants and disabled scopes survive settings conversion without implicit elevation. Current stage, execution location, pending elevation, user stop and recoverable failures remain visible. Browser tasks use the existing Chrome route. Child-session capability and prerequisite failures are shown from actual evidence; Home support is not assumed. The page, requests and remote-view ownership controls reuse native OpenAI-style components, tokens and accessible keyboard behavior, with light/dark rendered acceptance required. The policy owner is [Window Use](window-use.md#stage-authority-and-recovery).

### Current settings implementation

Status: `partial` — the production settings section passes actual pinned React/component/CSS light/dark rendering and interaction checks, and the exact package passes host acceptance and installation. Full installed VS Code navigation after reload remains separate.

The existing Computer Use page contains separate Computer Use and Window Use sections. Computer Use has an enabled switch, initially on. Window Use has an allow-all switch, initially off, and an always-approved app list with add-from-running-window and remove actions. Settings use the pinned native rows, switches, buttons, spacing and semantic theme tokens. Loading, saving, empty-list and failed-save states are visible; a failed save does not display the proposed value as saved. User actions supersede quiet background reads; late replies cannot replace the acknowledged result. Keyboard interaction and both themes require actual rendered acceptance.

Window Use settings use its separate approval owner. The existing Computer Use approval-management surface remains available. The runtime authorization contract is owned by [Window Use](window-use.md#app-authorization-settings) and [Computer Use](computer-use.md#control-enable-setting).

Window Use consent reuses the native in-conversation elicitation card with the app name, Window Use identity and existing permission scopes. The dedicated Window Use panel presents consent within its own view using semantic theme tokens. Waiting, expiry, denial and cancellation remain visible states; a terminal request cannot retain active approval buttons. Source light/dark rendering and interaction acceptance pass at normal and narrow widths. The exact package passed six isolated host acceptance stages and is installed; real-user consent after reload remains unverified. Its authority and model-visible result contract is owned by [in-app consent](window-use.md#in-app-consent).

## Design settings

Status: `current` in source — custom photo sets and single-photo random preview verified on Windows with host tests and native light/dark rendering; packaging, installed-profile and Linux/macOS acceptance pending.

Presentation acceptance uses the production component and pinned native modules/styles with a synthetic host in light and dark themes. Source tests and browser fixtures do not establish packaged or installed-profile acceptance.

The Design page has a native **Use custom photos for new subagents** settings row. Its switch defaults to off for unset preferences and persists changes through the host-owned photo service. Turning it on affects future authoritative subagent creation events; previous photo assignments and recorded off decisions remain stable when toggling or reopening the page.

The chat and input font row uses the native segmented control to select `OpenAI default` or `Gyeonggi + Consolas` together for message text and the composer. Unset and existing preferences default to `gyeonggi-consolas`; `openai` restores the pinned UI's native content, composer and code typography and normal word spacing. The host stores `chatFont` alongside student preferences, serializes changes and broadcasts confirmed snapshots to open webviews. Failed saves retain the previous font and expose the existing retry/error state. Native bridge initialization subscribes even when no settings page or subagent avatar renders, so reopening a chat restores its saved font. Other dynamic labels retain their existing typography.

The host observes `item/completed` notifications for both `subAgentActivity` with `kind: started` (v2 creation) and successful `collabAgentToolCall` with `tool: spawnAgent`. Both paths use the same per-thread saved decision, so duplicate notifications do not redraw a photo. Later activity and history reads do not allocate photos.

The Photo preview section selects the persisted image set through a native segmented control, then shows one randomly selected photo and its display name, with a button to draw another. Blue Archive is the bundled default set, containing 200 distinct student/costume IDs: the original 100 base portraits and 100 additional portraits (44 base appearances and 56 costume variants). Existing numeric IDs are retained; image replacements use the exact generated PNGs confirmed by the user, with hashes and approval provenance updated together. Unselected image bytes are retained; displayed names distinguish costumes. Roster validation checks nonempty records, unique IDs, complete identity fields, safe filenames and PNG integrity. Selecting a set changes future subagent assignments and the preview; existing assignments, including saved off decisions, remain stable. Each side of the photo box is one third of the native `size-20` box, using the same spacing token; image alternative text also uses the English name. Preview is available while the switch is off and does not change saved preferences or subagent assignments. Loading, save failure and unavailable-photo states remain visible and accessible. Images use bundled assets or copied user assets through local webview resource URLs.

**Add image set** opens a native multi-file chooser and a set-name prompt. PNG, JPEG, WebP and GIF imports allow up to 200 regular raster files, 1 MiB each and 20 MiB total. The host checks format signatures and stores copies beneath extension global storage `subagent-photos/<set-id>/`, so source files can be moved after import. File stems supply display names. Successful import persists metadata and selects the new set. Cancellation and validation/storage failures preserve the previous selection and assignments and clear the busy state. Native dialogs do not hold the mutation queue or expire on the short bridge-response timer. There is no archive extraction or runtime network request.

Snapshots carry all photos so old assignments can still render when another set is selected. Bundled photo IDs remain numeric; imported IDs include their immutable set identity. Existing preferences default to Blue Archive while preserving enabled/font values and saved decisions.

## Student avatar initialization

Photo subscriptions authorize the bundled avatar directory and custom storage root at initial subscription, retaining webview options when existing resource roots already cover both. Imports do not add new resource roots. Adding a redundant descendant root reloads the webview and loses the active settings route.

Design preferences use one store per webview. Subscribe in a microtask after the native bridge initializes, or when the first avatar or design settings hook renders, whichever comes first. The pinned UI initializes shared dependencies lazily across cyclic module imports, so the injected module must not call bundle initialization functions during module evaluation. A webview closed before the store is used must also dispose safely.

## Recent-chat header initialization

Recent-chat filtering subscribes to the history menu's persisted type and environment atoms through the pinned atom and environment query hooks. Initialize the atom owner when this hook first renders and reuse the upstream task merge hook. Preserve the header's existing local bindings so injected variables cannot shadow hooks already called in the same render. Authenticated header and persisted conversation rendering use the same packaged module graph.

## Typography boundary

Status: `target` — dynamic typefaces selected; fixed UI typeface selection pending.

Fixed headings, menu labels, button text and instructions have a separate candidate typeface selection. Dynamic content, including user names, email addresses, chat titles, messages, typed input, model names, account values and durations, uses Consolas for Latin text/numbers and Gyeonggi Millennium Batang (경기천년바탕) for Korean. Keep existing font sizes and line heights. A root/body font replacement cannot satisfy this boundary.

Resolve Consolas from installed system fonts. Bundle unchanged official Gyeonggi Batang Regular/Bold webfonts with their source/use-condition notice and verified hashes. Fonts load from local webview assets, without runtime network requests or system-wide installation. Preserve system fallbacks for unsupported characters and emoji.

Localized visible labels and visible string labels require separate rendering boundaries. Accessibility strings stay strings. Rich text and interpolated values must preserve dynamic spans; applying a font to an entire interpolated message is insufficient. The selected typeface must have a defined local fallback for Korean and Latin text.

With Gyeonggi + Consolas selected, dynamic prose and typed input use half-width spaces through `word-spacing: -0.5ch`, relative to the space advance of the leading Consolas face. Chat Markdown roots and their paragraph, heading, list-item and table classes require explicit spacing rules because they set the content font without a `.font-content` wrapper; preparation checks the pinned prose CSS anchor. OpenAI mode excludes chat and composer from these custom font, weight and spacing overrides. Character spacing and font sizes remain unchanged. Code/preformatted text keeps normal spacing for alignment, and nested fixed UI controls reset word spacing. Dynamic account/usage values retain the custom spacing in either mode.

## Icon policy candidates

Status: `draft` — candidate comparison, no selected product style.

Compare a simple line family, an angular geometric family and a soft curved family at actual 16, 20 and 24 pixel sizes. Each family covers add, search, history, settings, new chat, account, permissions and send. Candidate generation is owned by `scripts/create-ui-design-preview.cjs`; its local HTML and individual SVG outputs are review artifacts under `artifacts/visualizations/azrael-ui-identity/`.

The candidate system uses a 24×24 coordinate grid, `currentColor`, consistent strokes within each family and equivalent light/dark shapes. Use 20px for ordinary controls and 16px for supporting icons. Size the interactive target separately from the visible glyph. Avoid vendor emblems for generic account/settings actions. Pair status colors with text or shape. Select one family before integrating product replacements; semantic meaning and small-size legibility determine acceptance.
