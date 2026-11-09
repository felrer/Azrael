# Conversation Content UI

<!-- architecture: {"id":"arch.conversation-content.ui","feature":"conversation-content","layers":["ui","host"]} -->

## File edit summary

Status: `current` in source — native React/CSS rendering and scoped interactions pass on Windows in light/dark themes and at narrow width. Package, installed-host and native Linux/macOS acceptance remain separate; evidence is tracked in [the work plan](../../../../work/BG-01-compact-file-summary/01-plan.md).

Completed turn diffs use the native resource card with compact vertical padding, a 24px icon surface and a 16px glyph. The edited-file title and total added/removed lines share one row. The header has no Undo/Reapply or View changes buttons or hover subtitle. Multiple-file rows are 32px high and retain native diff opening, modifier-key file opening, file menus and expansion controls. A single-file header retains its accessible native diff-opening trigger. Diff data, host permissions and editor ownership retain their native contracts. This shared presentation applies to Windows x64, Linux x64 and macOS ARM64; package, installed-host and native platform acceptance are separate. Preservation feature: `ui.ui-cleanup`.

## Missing local chat images

Status: `current` in source — native component rendering and interaction verified in light and dark themes; build and installation pending.

When a local image referenced by a chat thumbnail is absent, the thumbnail displays `파일 없음` in its existing bordered tile using native theme tokens. The missing-file tile has no image-opening action. File absence is distinguished from permission, transport and cancellation errors. Loading and available-image behavior retain their existing presentation. A change to the image source, host or conversation clears the previous missing-file identity.
