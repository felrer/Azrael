# Azrael UI presentation

## Composer and feature surface

Status: `partial` — pinned source transforms, scoped runtime fixtures, packaged host acceptance and actual webview startup are verified; full presentation and theme comparisons remain pending.

The independent Azrael distribution uses the pinned upstream UI as an input to its own guarded preparation transforms. The upstream snapshot and the original Codex extension remain separate product inputs.

The empty composer displays the cat text emoticon `^•⩊•^` in every composer mode. This placeholder change is source-only until the next build and installation. Its accessible input identity remains available. The add menu offers existing file/folder attachments and supported integration entry points. Goal setting and Plan mode registration, selection handlers and their composer mounts are excluded from the Azrael UI. Sketch registration, selection handlers and composer mounts are preserved, including the slash/mention drawing action and shared composer creation capability. Sketch restoration is source-only until the next build and installation. Native engine tools and session protocols retain their own contracts.

The slash command menu excludes Model, Fork chat, Initialize, Reasoning level and Code review. Their dedicated registrations and mounts are removed, including both code-review variants. Composer toolbar model/reasoning selectors and the shared underlying services remain available through their separate entry points. This additional menu change is source-only until the next build and installation.

Pets integration entries, settings and dedicated UI/host paths are excluded from the Azrael distribution. This presentation boundary does not delete personal skills or saved user data. Generic connector and account/avatar behavior keep their existing contracts.

Shared bundle imports retain disabled empty query/state adapters and empty module exports; these perform no Pets RPC, persistence, subscription or selection mutation. Inert preload metadata, shared avatar/render utilities and built-in artwork remain in the pinned bundle graph. Existing thread-goal state and image/sketch attachment rendering keep the handlers required to display and recover persisted conversations.

Full access uses the same foreground tokens as Request approval in the permission selector and the selected composer control. Permission values, selection behavior and native approvals retain their existing contracts; the display change does not imply that the two modes grant the same authority.

## Identity and session links

Backend HTTP protocol identifiers keep their upstream names, including `OAI-*` and `x-openai-*`. The `OAI-App-Brand` value remains `codex`; it must not be derived from the display brand.

The host and conversation UI identify the distribution as Azrael. Theme names, embedded VS Code command titles and the Devin model-picker notification also use Azrael; these additional labels are source-only until the next build and installation. Actual service usage and model names retain their service identity. Local conversation links use `azrael://local/<UUID>`; original Codex links remain accepted for migration. The session-link injector is registered in the preservation manifest, and prepared assets must report `sessionLinkEdits` before package verification succeeds.

## Settings module contracts

Azrael settings use the OpenAI native page layout, heading hierarchy, settings rows, switches, buttons, spacing and semantic theme tokens. Reuse the pinned bundle's actual components and verified exports. Rendered light/dark layout and interaction checks are required for presentation acceptance.

Settings injectors import the bridge through the pinned bundle export `A3t`; internal aliases are not module exports. Settings navigation reuses initialized platform icon assets. Retired Pets registry entries retain an inert `{ visible: false, pending: false }` visibility result so shared navigation never dereferences an undefined result.

## Design settings

Status: `current` in source — native settings presentation and single-photo random preview.

The production component was rendered with the pinned native modules and styles in a local browser fixture in light and dark themes. Toggle, random draw, empty roster, retry and unavailable-photo interactions passed. Packaging and installed-profile verification were intentionally omitted for this change.

The Design page has a native settings row for using student photos on newly created subagents. Its switch defaults to off for unset preferences and persists changes through the existing host-owned student service. Turning it on affects future authoritative subagent creation events; previous photo assignments and recorded off decisions remain stable when toggling or reopening the page.

The preview shows one randomly selected student photo and name at a time, with a button to draw another. Preview is available while the switch is off and does not change saved preferences or subagent assignments. Loading, save failure and unavailable-photo states remain visible and accessible. Images use the bundled roster and local webview resource URLs.

## Student avatar initialization

Student subscriptions retain webview options when an existing resource root already authorizes the avatar directory. Adding a redundant descendant root reloads the webview and loses the active settings route.

Student avatar preferences use one store per webview. Initialize its bridge and subscribe when the first avatar or design settings hook renders. The pinned UI initializes shared dependencies lazily across cyclic module imports, so the injected module must not call bundle initialization functions during module evaluation. A webview closed before the store is used must also dispose safely.

## Recent-chat header initialization

Recent-chat filtering subscribes to the history menu's persisted type and environment atoms through the pinned atom and environment query hooks. Initialize the atom owner when this hook first renders and reuse the upstream task merge hook. Preserve the header's existing local bindings so injected variables cannot shadow hooks already called in the same render. Authenticated header and persisted conversation rendering use the same packaged module graph.

## Typography boundary

Status: `target` — dynamic typefaces selected; fixed UI typeface selection pending.

Fixed headings, menu labels, button text and instructions have a separate candidate typeface selection. Dynamic content, including user names, email addresses, chat titles, messages, typed input, model names, account values and durations, uses Consolas for Latin text/numbers and Gyeonggi Millennium Batang (경기천년바탕) for Korean. Keep existing font sizes and line heights. A root/body font replacement cannot satisfy this boundary.

Resolve Consolas from installed system fonts. Bundle unchanged official Gyeonggi Batang Regular/Bold webfonts with their source/use-condition notice and verified hashes. Fonts load from local webview assets, without runtime network requests or system-wide installation. Preserve system fallbacks for unsupported characters and emoji.

Localized visible labels and visible string labels require separate rendering boundaries. Accessibility strings stay strings. Rich text and interpolated values must preserve dynamic spans; applying a font to an entire interpolated message is insufficient. The selected typeface must have a defined local fallback for Korean and Latin text.

Dynamic prose and typed input use half-width spaces through `word-spacing: -0.5ch`, relative to the space advance of the leading Consolas face. Chat Markdown roots and their paragraph, heading, list-item and table classes require explicit spacing rules because they set the content font without a `.font-content` wrapper; preparation checks the pinned prose CSS anchor. Character spacing and font sizes remain unchanged. Code/preformatted text keeps normal spacing for alignment, and nested fixed UI controls reset word spacing. This rule also covers dynamic account/usage values. It is source-only until the next build and installation.

## Icon policy candidates

Status: `draft` — candidate comparison, no selected product style.

Compare a simple line family, an angular geometric family and a soft curved family at actual 16, 20 and 24 pixel sizes. Each family covers add, search, history, settings, new chat, account, permissions and send. Candidate generation is owned by `scripts/create-ui-design-preview.cjs`; its local HTML and individual SVG outputs are review artifacts under `artifacts/visualizations/azrael-ui-identity/`.

The candidate system uses a 24×24 coordinate grid, `currentColor`, consistent strokes within each family and equivalent light/dark shapes. Use 20px for ordinary controls and 16px for supporting icons. Size the interactive target separately from the visible glyph. Avoid vendor emblems for generic account/settings actions. Pair status colors with text or shape. Select one family before integrating product replacements; semantic meaning and small-size legibility determine acceptance.
