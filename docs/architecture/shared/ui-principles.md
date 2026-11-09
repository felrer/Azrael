# Azrael UI presentation

<!-- architecture: {"id":"arch.shared.ui-principles","feature":null,"layers":["ui"]} -->

## UI change guidance

Design Azrael UI in the OpenAI style. Reuse the pinned UI’s existing native components, page layouts, settings rows, switches, buttons, typography, spacing and semantic theme tokens. Verify the actual rendered page and its interactions in light and dark themes; plain unstyled controls or source-only tests do not establish visual acceptance.

## Settings module contracts

Plugins is the single integration-management navigation entry when the native Plugins capability is available. It retains plugin, app, MCP and skill management plus Add and Browse directory actions. The redundant MCP servers entry is filtered using that same capability; environments without Plugins retain native MCP access. Existing MCP settings links render the full Plugins component rather than its reduced manage-only wrapper. This shared settings-navigation behavior is maintained by `scripts/inject-instruction-settings.cjs` and the existing `ui.instruction-settings` preservation checks. It does not delete MCP configuration, servers or permissions.

Azrael settings use the OpenAI native page layout, heading hierarchy, settings rows, switches, buttons, spacing and semantic theme tokens. Reuse the pinned bundle's actual components and verified exports. Rendered light/dark layout and interaction checks are required for presentation acceptance.

Settings injectors import the bridge through the pinned UI `26.1007.21434` export `X9t` (`vm` internally); internal aliases are not module exports. Native ReactDOM root creation uses `XAt`; the separate legacy ReactDOM export does not supply `createRoot`. Settings navigation reuses initialized platform icon assets. Retired Pets registry entries retain an inert `{ visible: false, pending: false }` visibility result so shared navigation never dereferences an undefined result.

Account and usage surfaces, including shadow-root settings panels, inherit the native semantic palette and color scheme with VS Code and light/dark fallbacks. Cards, ticket rows, buttons and switches use theme surfaces. Both standalone and embedded presentations must show readable foregrounds and distinct light/dark backgrounds while preserving native geometry and interaction.

Instruction documents and Design use the native React Intl context for the active app language, including navigation labels, accessible text and page states. Korean language variants select Korean; other languages select English. Changing the app language updates presentation. Student names remain English in either language, while source document content and external diagnostics retain their original text. The standalone instruction surface follows the VS Code display language. Instruction navigation, accessible names and native page titles read “Presets” in English or “프리셋” in Korean, covering instructions, profiles and Team configuration. The existing `computer-use` route uses “Window use” for those same labels; the not-implemented notice appears only in the page heading.

## Typography boundary

Status: `partial` — dynamic-font preparation and persisted chat-font selection are implemented in source; full installed presentation acceptance is separate.

Dynamic content, including user names, email addresses, chat titles, messages, typed input, model names, account values and durations, uses Gyeonggi Millennium Title Light (경기천년제목 Light) for Korean. On Windows, Latin text/numbers use installed Consolas, falling back to bundled Cascadia Mono when unavailable. Other desktop platforms default to Cascadia Mono even if Consolas is installed. Selection follows the webview OS, independently of package-generation OS. Keep existing font sizes and line heights. A root/body font replacement cannot satisfy this boundary. Preservation feature: `ui.content-fonts`.

Bundle unchanged official Cascadia Mono upright/italic variable WOFF2 files and Gyeonggi Title Light WOFF with source/use-condition notices, Cascadia's OFL license and verified hashes. Retained Batang assets are not selected. Fonts load from local webview assets, without runtime network requests or system-wide installation. Preserve system fallbacks for unsupported characters and emoji. The shared policy applies to chat/composer and standalone or embedded account/usage surfaces; shadow DOM inherits the same platform font variables. Windows Chromium rendering and simulated OS branches are distinct from native Linux/macOS and installed-host acceptance.

Localized visible labels and visible string labels require separate rendering boundaries. Accessibility strings stay strings. Rich text and interpolated values must preserve dynamic spans; applying a font to an entire interpolated message is insufficient. The selected typeface must have a defined local fallback for Korean and Latin text.

In custom typography, Windows dynamic prose, titles, account values and typed input use half-width spaces when Consolas is available. Cascadia Mono uses its natural space width on every platform. A local Consolas font face restricted to U+0020 uses `size-adjust: 50%` with ascent, descent and line-gap overrides that restore Consolas's full Windows vertical metrics. The half-width advance preserves full-height input carets and the model-name baseline, while visible characters retain their original metrics. Model selection keeps the native effort label and arrow layout. When Consolas is unavailable, the normal fallback space is preserved; subtracting `0.5ch` from a fallback face can erase its narrower space glyph. Chat Markdown roots and their paragraph, heading, list-item and table classes require explicit spacing rules because they set the content font without a `.font-content` wrapper; preparation checks the pinned prose CSS anchor. OpenAI mode excludes chat and composer from these custom font, weight and spacing overrides. Character spacing, font sizes and line heights remain unchanged. Code/preformatted text keeps normal spacing for alignment, and nested fixed UI controls reset word spacing. Dynamic account/usage values retain their independent custom typography in either mode, including shadow DOM panels.

### Fixed UI typeface

Status: `target` — fixed UI typeface selection is pending.

Fixed headings, menu labels, button text and instructions require a separate candidate selection and presentation comparison. The dynamic-font implementation does not select a new fixed-label font.

## Icon policy candidates

Status: `draft` — candidate comparison, no selected product style.

Compare a simple line family, an angular geometric family and a soft curved family at actual 16, 20 and 24 pixel sizes. Each family covers add, search, history, settings, new chat, account, permissions and send. Candidate generation is owned by `scripts/create-ui-design-preview.cjs`; its local HTML and individual SVG outputs are review artifacts under `artifacts/visualizations/azrael-ui-identity/`.

The candidate system uses a 24×24 coordinate grid, `currentColor`, consistent strokes within each family and equivalent light/dark shapes. Use 20px for ordinary controls and 16px for supporting icons. Size the interactive target separately from the visible glyph. Avoid vendor emblems for generic account/settings actions. Pair status colors with text or shape. Select one family before integrating product replacements; semantic meaning and small-size legibility determine acceptance.

## Preservation mapping

Registered features: `ui.submit-only-thread`, `ui.session-flags`, `ui.student-design`, `ui.project-drafts`, `ui.file-open-menu`, `ui.image-file-open`, `ui.missing-image`, `ui.local-file-drop`, `ui.composer-draft`, `ui.ui-cleanup`, `ui.pets-cleanup`, `ui.content-fonts`, `ui.command-drag-block`, `ui.scroll-fade`, `ui.thread-branch`, `ui.paginated-history`, `ui.recent-chat-filter`, `ui.session-links`, `ui.input-diagnostics`. The [contract index](feature-preservation.md#contract-index) links to the executable inventory. Each section's stated source, native, package, installed and platform limits determine what that registered scope establishes; broader behavior is reviewed separately.

## Related design owners

- [Approval waiting time](../features/task-work-time/ui.md)
- [Withdrawn questions and queue waiting](../features/input-queue/ui.md)
- [Team and Direct role profiles](../features/agent-profiles/ui.md)
- [Composer and feature surface](../features/conversation-input/ui.md)
- [Sketch on an attached image](../features/prompt-images/ui.md)
- [Parent decision request activity](../features/parent-requests/ui.md)
- [Missing local chat images](../features/conversation-content/ui.md)
- [Conversation error messages](../features/conversation-errors/ui.md)
- [Capacity retry controls](../features/managed-providers/ui.md)
- [Session creation at submission](../features/conversation-input/drafts.md)
- [Request preparation](../features/conversation-input/request-preparation.md)
- [Team groups and Lead entry](../features/work-orchestration/ui.md)
- [Session flags](../features/conversation-input/session-flags.md)
- [Astra and Sol response speed](../features/model-selection/ui.md)
- [Scroll fades and renderer compatibility](../features/conversation-rendering/ui.md)
- [Hidden conversation webviews](../features/conversation-rendering/host.md)
- [Recent-chat header initialization](../features/conversation-history/ui.md)
- [Submitted-input diagnostics](../features/conversation-input/diagnostics.md)
- [Implementation and acceptance boundary](../features/window-use/ui.md)
- [Design settings](../features/agent-appearance/README.md)
- [Student avatar initialization](../features/agent-appearance/host.md)

## Feature-specific presentation contracts

`ui.ui-cleanup` also preserves the [composer surface](../features/conversation-input/ui.md), [file-edit summary](../features/conversation-content/ui.md) and [model controls](../features/model-selection/ui.md). Those documents own their behavior; this shared contract owns common presentation and integration constraints.
