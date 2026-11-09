# Model Selection UI

<!-- architecture: {"id":"arch.model-selection.ui","feature":"model-selection","layers":["ui"]} -->

## Model command drag policy

Status: `partial` — source transforms and Windows native Webview policy checks pass in light and dark themes. Full application, packaged/installed acceptance and Linux/macOS checks remain unverified.

Model command execution cards, their command/output shell blocks and dynamic `functions.exec`, `functions.exec_command` and `functions.write_stdin` results disable mouse text selection and HTML drag starts. This temporary mitigation uses a scoped CSS class plus capture cancellation of `selectstart` and `dragstart`. It does not cancel pointer-down, click, key, wheel or drop events, so the native disclosure, copy controls, focus and scrolling keep their owners. Ordinary conversation text, Markdown code blocks, other tool results and composer attachments retain their current interaction policy. Existing selected text is not globally cleared.

The policy is common to Windows x64, Linux x64 and macOS ARM64. Windows native Webview checks establish the verified environment; packaging and installation are separate. Preservation feature: `ui.command-drag-block`.

## Fast mode recommendation

Status: `partial` — the guarded source transform is checked; rendered banner suppression and installed-window acceptance remain unverified.

The home-screen Fast mode recommendation card and its personalized savings estimate are disabled through native banner eligibility. Account eligibility does not enable the card. Manual speed selection remains available in the model picker. This behavior is covered by the `ui.ui-cleanup` transformation owner; its existing structural checks do not establish a rendered recommendation-suppression test.

## Astra and Sol response speed

Status: `current` in source — native control rendering and interaction verified; build and installation pending.

For the exact OpenAI models `gpt-6-astra` and `gpt-6.1-sol`, the model picker's lightning button cycles Standard → Fast → Ultrafast → Standard through the existing service-tier selection callback. Fast sends `priority`; Ultrafast sends `ultrafast`; Standard uses the existing explicit standard selection. Account catalogs that omit Ultrafast are supplemented for these exact IDs, and the bundled catalog and native request policy preserve their explicit Ultrafast selection. Ultrafast uses the native purple theme token for the icon and a tinted button background in both light and dark themes. The tooltip identifies the active mode, and the accessible label identifies the next mode. Loading and the native unavailable state disable selection. Other models retain their native speed controls. Server-side account and workspace eligibility still applies; exposing the selection does not establish account access.

Other model slugs retain their existing catalog-based support checks. Source routing tests cover advertised and missing tiers. Live account support remains unverified. The controls and callbacks were exercised using the pinned native React/menu/CSS modules with synthetic host state, including mouse selection and keyboard return to Standard for both models. This source change has not been packaged or installed.
