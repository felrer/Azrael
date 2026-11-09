# Conversation Rendering UI

<!-- architecture: {"id":"arch.conversation-rendering.ui","feature":"conversation-rendering","layers":["ui"]} -->

## Scroll fades and renderer compatibility

Status: `partial` — source transform and isolated Windows native Webview verification; packaging and installed-host acceptance are separate.

The pinned horizontal and three vertical scroll fade masks preserve their gradients, distances and keyframe stops. Their four `scroll(self x/y)` animations are replaced by a shared frame-coalesced geometry observer that writes the existing fade variables. Layout reads precede style writes; scroll, viewport resize, content changes and newly mounted scrollers refresh the fades. Non-overflowing elements have no fade. Removal and disposal restore only inline values still owned by this observer. Unrelated view timelines remain unchanged.

This common renderer policy avoids a Chromium lifecycle check failure observed on Windows x64, VS Code 1.142.0 / Electron 43.7.7 / Chromium 150.0.7871.250 when text selection, ScrollTimeline and scroll-container visibility changes overlap. The original incident and synthetic native reproduction share the exception location; exact private symbols and the user's original pointer sequence are unavailable. Linux x64 and macOS ARM64 share the implementation but have no native acceptance evidence from this task.

Preservation feature `ui.scroll-fade` owns strict pinned CSS anchors, the serialized runtime, transform cache dependencies and mandatory source checks. `scripts/verify-scroll-timeline-crash-host.cjs` provides separate isolated native crash/control experiments and production-mask measurements/screenshots in light/dark themes. Synthetic Webview acceptance does not establish installed-package acceptance or recovery from every renderer crash.
