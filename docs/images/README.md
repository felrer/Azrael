# README image sources

The four PNGs used by the English and Korean READMEs are browser captures of
production Azrael UI with synthetic fixture inputs. Native components, icons,
layout and pinned app styles render directly; no hand-drawn application shell is
added. Provider headers embed [official original brand assets](../architecture/provider-brand-assets.md),
preserving their shape, colors and proportions. The pinned upstream UI is
`26.1007.21434`. Agent collaboration and resume flows are localized SVGs exported
from the standalone [HTML source](agent-diagrams.html). SVG assets are explanatory illustrations,
not application screenshots. Window Use uses the original
illustration of a selected target behind a person’s foreground workspace.

| Image | Production source and capture tool | Synthetic boundary |
| --- | --- | --- |
| `accounts-usage.png` | Compiled `UsageView`; `scripts/verify-account-overview-render.mjs`, light standalone overview | Account identities, quota observations, reset times and host services |
| `model-picker.png` | Native advanced picker and provider list; `scripts/verify-astra-speed-render.mjs` with `AZRAEL_RENDER_README_CAPTURE=1` | Model catalog, selection callbacks and localization services; includes Claude Opus 5.5 |
| `context-compaction.png` | Native gauge, hover card and compaction button; `scripts/verify-context-compaction-render.mjs` with `AZRAEL_RENDER_README_CAPTURE=1` | Conversation, token counts, pricing reference and compaction service |
| `session-flags.png` | Native recent-chat row, preference atom and production flag helper; `scripts/verify-session-flags-render.mjs` | Conversation title, host services and preference state |

No personal account, credential or conversation store is opened for these
captures. Account addresses use `example.com`. Model catalogs are sample inputs,
not evidence of live model access. The Window Use illustration explains the
intended workflow; native desktop execution and physical input isolation require
their separate acceptance checks.

## Reproduce

### Product demo placeholder

`readme-demo-placeholder-ko.svg` is an original, editable vector placeholder for
the Korean README's future product video. It is not a screenshot or a playable
video and has no external asset dependency. Edit the SVG directly to change its
copy or appearance. Replace the image block marked `PRODUCT_DEMO` in
`README.ko.md` with the real video or a linked thumbnail once available; remove
the adjacent preparation caption at the same time.

### Korean harness guide and cursor motion

The rewritten Korean README uses four diagrams from
[`harness-guide-ko.html`](harness-guide-ko.html): `harness-flow-ko.svg`,
`execution-modes-ko.svg`, `work-memory-ko.svg`, and `artifact-lifecycle-ko.svg`.
The HTML is the editable source. It uses inline SVG, local system fonts and
keyboard-focusable figure scrolling on narrow screens; no network dependency is
required. These are explanatory diagrams, not screenshots or measurements.

[`window-use-cursor-ko.html`](window-use-cursor-ko.html) is the self-contained
cursor-motion source and interactive demo. It preserves the adopted A3 model
cursor and motion study, adds pause/restart, speed, theme and state controls, and
respects reduced-motion preferences. Its inert `cursor-poster` block owns the
static `window-use-cursor-ko.svg` shown in the README. The white user cursor and
sky-blue model cursor illustrate motion only: the page sends no OS input and
does not establish independent-input support in an application. The Fluent-derived
geometry's pinned source attribution and MIT license are embedded in both assets.

```sh
node scripts/export-readme-harness-diagrams.cjs
node scripts/export-readme-harness-diagrams.cjs --check
node scripts/export-readme-cursor.cjs
node scripts/export-readme-cursor.cjs --check
```

Open the HTML files locally for the interactive views. GitHub displays the SVG
posters in Markdown; an HTML link on GitHub opens its source, so download/open the
HTML to run it. Export needs only Node and does not read work records or user
profiles. The English README retains its existing assets.

### Agent diagrams

Edit `agent-diagrams.html`, then run:

```sh
node scripts/export-readme-agent-diagrams.cjs
node scripts/export-readme-agent-diagrams.cjs --check
```

The HTML owns the layout, shared styles and Korean/English labels. The exporter
copies the four inline SVGs with their styles into `agent-roles-{ko,en}.svg` and
`agent-resume-{ko,en}.svg`. No renderer, external font or network dependency is
needed for export. Open the HTML to review the layout; `--check` verifies that
the README images match the source. These are explanatory diagrams, not product
screenshots or performance measurements.

### UI screenshots

Run the named renderer from the repository root with the pinned UI assets,
compiled account module and installed renderer dependencies. These tools use
isolated headless Chrome profiles on Windows and retain light/dark verification
results. They do not build or install the application.

Set `AZRAEL_RENDER_FIXTURE_ROOT` to a fresh descendant of
`artifacts/verification/` and `AZRAEL_RENDER_LOG_ROOT` to a task-specific descendant
of `artifacts/logs/`. The tools validate containment and clean their owned browser
fixtures after exit. Use the optional variables in the table for focused README
captures.
Set `AZRAEL_RENDER_PROVIDER_BRAND_CAPTURE=1` on the account renderer to also
capture all registered official provider logos in both themes.

Select a reviewed output and copy its original PNG bytes into this directory.
Focused captures use Chrome's native screenshot clip rather than replacing or
painting application pixels. Keep renderer summaries and command logs in the
selected log directory. Review any future fixture data before publishing; real
accounts and sessions are outside this screenshot workflow.
