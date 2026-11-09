# Managed Providers UI

<!-- architecture: {"id":"arch.managed-providers.ui","feature":"managed-providers","layers":["ui"]} -->

## Capacity retry controls

Status: `current` in source — Windows behavior fixtures and native React/CSS rendering pass in light/dark themes. Package, installation and native Linux/macOS acceptance remain unverified.

The latest failed model-capacity response offers **Stop retrying** beside the native retry countdown. Stopping disables automatic retry submissions for that failed turn in the current webview, including remounting its card. It immediately blocks an already scheduled callback before React rerenders. The native **Retry** action remains available for explicit manual submission. A new failed turn retains its own retry policy; other hosts and conversations are unaffected. Reloading the webview restores the native retry policy. The button stops future automatic requests; an already submitted response uses the existing composer Stop control.

Stopping retries does not lock the conversation or disable new composer input. The user can send new instructions or an explicit continuation in the same session after a capacity failure; selected model/account, attachments and history retain native ownership. Structured capacity-failure continuation admission is owned by [manual continuation after a server error](../conversation-recovery/README.md#manual-continuation-after-a-server-error). Source acceptance requires both retry-stop and host/bridge input-delivery checks; an older running host still needs an updated package and reload.

Native owner eligibility, ready-state checks, retry admission, collaboration mode and submission-failure handling remain in use. Only the latest failed turn renders retry actions. Controls reuse native outline buttons, spacing and theme tokens across Windows x64, Linux x64 and macOS ARM64. Preservation feature: `ui.capacity-retry-stop`. `scripts/test-capacity-retry-stop.cjs` covers timer/admission behavior and `scripts/verify-capacity-retry-render.mjs` renders native controls with synthetic host/localization services.
