# Azrael UI presentation

## Composer and feature surface

Status: `partial` — pinned source transforms and scoped runtime fixtures are verified; packaged and installed-host acceptance is pending.

The independent Azrael distribution uses the pinned upstream UI as an input to its own guarded preparation transforms. The upstream snapshot and the original Codex extension remain separate product inputs.

The empty composer displays the literal ASCII `-` in every composer mode. Its accessible input identity remains available. The add menu offers existing file/folder attachments and supported integration entry points. Goal setting, Plan mode and Sketch registration, selection handlers and their composer mounts are excluded from the Azrael UI. Native engine tools and session protocols retain their own contracts.

Pets integration entries, settings and dedicated UI/host paths are excluded from the Azrael distribution. This presentation boundary does not delete personal skills or saved user data. Generic connector and account/avatar behavior keep their existing contracts.

Shared bundle imports retain disabled empty query/state adapters and empty module exports; these perform no Pets RPC, persistence, subscription or selection mutation. Inert preload metadata, shared avatar/render utilities and built-in artwork remain in the pinned bundle graph. Existing thread-goal state and image/sketch attachment rendering keep the handlers required to display and recover persisted conversations.

Full access uses the same foreground tokens as Request approval in the permission selector and the selected composer control. Permission values, selection behavior and native approvals retain their existing contracts; the display change does not imply that the two modes grant the same authority.

## Typography boundary

Status: `target` — dynamic typefaces selected; fixed UI typeface selection pending.

Fixed headings, menu labels, button text and instructions have a separate candidate typeface selection. Dynamic content, including user names, email addresses, chat titles, messages, typed input, model names, account values and durations, uses Consolas for Latin text/numbers and Gyeonggi Millennium Batang (경기천년바탕) for Korean. Keep existing font sizes and line heights. A root/body font replacement cannot satisfy this boundary.

Resolve Consolas from installed system fonts. Bundle unchanged official Gyeonggi Batang Regular/Bold webfonts with their source/use-condition notice and verified hashes. Fonts load from local webview assets, without runtime network requests or system-wide installation. Preserve system fallbacks for unsupported characters and emoji.

Localized visible labels and visible string labels require separate rendering boundaries. Accessibility strings stay strings. Rich text and interpolated values must preserve dynamic spans; applying a font to an entire interpolated message is insufficient. The selected typeface must have a defined local fallback for Korean and Latin text.

## Icon policy candidates

Status: `draft` — candidate comparison, no selected product style.

Compare a simple line family, an angular geometric family and a soft curved family at actual 16, 20 and 24 pixel sizes. Each family covers add, search, history, settings, new chat, account, permissions and send. Candidate generation is owned by `scripts/create-ui-design-preview.cjs`; its local HTML and individual SVG outputs are review artifacts under `artifacts/visualizations/azrael-ui-identity/`.

The candidate system uses a 24×24 coordinate grid, `currentColor`, consistent strokes within each family and equivalent light/dark shapes. Use 20px for ordinary controls and 16px for supporting icons. Size the interactive target separately from the visible glyph. Avoid vendor emblems for generic account/settings actions. Pair status colors with text or shape. Select one family before integrating product replacements; semantic meaning and small-size legibility determine acceptance.
