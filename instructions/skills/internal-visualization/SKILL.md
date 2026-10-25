---
name: internal-visualization
description: Create or revise report-style charts, maps, interactive explainers, and analytical artifacts as local HTML, SVG, PNG, or PDF files. Use when seeing or exploring information materially improves understanding; do not use for ordinary tables, static node-edge diagrams, or full application and website implementation.
---

# Internal Visualization

Create a durable visualization that can be opened without Codex's conversation-only
Visualize surface. Preserve the user's data and intent, choose the smallest useful
composition, and verify the rendered result before delivery. Unless the user asks
for a dashboard, product page, or app-like interface, design the artifact as an
edited analytical report rather than a website.

## Decide whether to visualize

- Use a normal Markdown table when the user only needs exact rows and columns.
- Use Mermaid when labeled nodes and edges fully explain a static structure.
- Use a visualization artifact when spatial relationships, distributions, trends,
  comparisons, uncertainty, interaction, or a proposed interface need to be seen.
- A full product page, website, or application is project implementation rather than
  this skill's standalone visualization workflow. Follow the project's own build
  conventions for those requests.

## Choose the deliverable

- Use SVG for a simple static figure that benefits from crisp scaling and direct
  labels.
- Use a complete standalone HTML document for responsive, interactive, or
  multi-panel work. Make its first render read like a complete report; interaction
  should support inspection rather than serve as the primary navigation.
- Export PNG or PDF only when requested or when the consuming workflow requires a
  fixed artifact. Keep the editable HTML or SVG source alongside the export.
- Prefer an installed project dependency or a mature library already available in
  the environment. Handwrite SVG for simple figures; do not add a charting framework
  when native HTML, CSS, and SVG are sufficient.

## Route detailed guidance

Read only the references needed for the current deliverable:

- For plots, statistical graphics, comparisons, timelines, or dashboards, read
  [references/charts.md](references/charts.md).
- For standalone HTML, interaction, local dependencies, renderer verification, or
  PNG/PDF export, read
  [references/standalone-html.md](references/standalone-html.md).
- For layout, typography, surfaces, tables, and accessible color treatment in a
  polished standalone artifact, read
  [references/visual-design.md](references/visual-design.md).
- For geographic maps, dense categorical grids, simulations, or UI mockups, read
  [references/specialized-visuals.md](references/specialized-visuals.md).
- For a DOCENTO benchmark result, read
  [references/docento-benchmark.md](references/docento-benchmark.md), then reuse the
  DOCENTO template and renderer it identifies instead of starting from a blank page.

## Preserve data meaning

- Treat supplied data, labels, units, denominators, uncertainty, and missing values
  as source facts. Never invent observations, qualitative scores, status labels, or
  benchmark conclusions to fill space.
- Make non-obvious filtering, aggregation, normalization, interpolation, or derived
  metrics inspectable in the source or in a concise note near the visualization.
- Keep category colors and ordering stable across related views. Pair color with
  text, shape, pattern, or line style so meaning never depends on color alone.
- Show uncertainty and limitations when they materially affect interpretation.

## Compose for the question

- Start with the visual that answers the user's question. Add controls, summary
  metrics, legends, annotations, and panels only when they help interpret or explore
  the data.
- Default to report hierarchy: document identity and date, title and scope, concise
  findings, numbered analytical sections, methods or limitations, and provenance.
  Prefer a paper-like main surface, ruled sections, compact tables, figure captions,
  and print-stable spacing over hero banners, dashboard tiles, navigation chrome,
  floating cards, or decorative gradients.
- Prefer direct labels over separate legends when they remain readable. Do not
  duplicate the same values in KPI cards, a chart, and a table without a stated need.
- Minimize repeated content across titles, summaries, charts, tables, captions, and
  interactive detail regions. Let each occurrence add a distinct function: overview,
  visual comparison, exact lookup, definition, interpretation, limitation, or source.
  A detail region should add context rather than restate the selected label, value,
  direction, and description already visible beside the mark.
- Keep one dominant visual or a small set of aligned comparisons. Use shared scales
  for comparisons and small multiples when every requested dimension should remain
  visible.
- Make the first render useful before any interaction. Keep presentation-only state
  local to the artifact.

## Produce a portable artifact

- Write to the user-specified path. Otherwise use a task-owned output directory in
  the current project, such as `artifacts/visualizations/`, when that fits project
  conventions; use a durable temporary directory only for one-time previews.
- Use concise ASCII lowercase-hyphenated filenames unless project conventions or the
  user require another name.
- Do not emit Codex Visualize content references, depend on `window.openai`, assume
  sandbox-provided CSS utilities or icons, or rely on conversation-host globals.
- Do not make network or external API calls unless the user authorized them and the
  visualization genuinely requires live data. Prefer embedded data or adjacent local
  assets for reproducibility.
- Preserve existing project files and dependencies. Do not publish or host the result
  unless the user explicitly requests it.

## Accessibility and responsive behavior

- Use semantic HTML and native controls. Give charts, SVGs, canvases, and interactive
  regions concise accessible names or descriptions.
- Keep native tab order and visible focus styles. Announce meaningful dynamic results
  with `aria-live="polite"` and validation failures with `role="alert"`.
- Label axes and quantities with units. Keep essential text at least 11 screen pixels
  and reserve room for the longest formatted label.
- Support widths down to 320px. Reflow or simplify annotations instead of shrinking a
  fixed desktop layout, clipping text, or adding page-level horizontal scrolling.
- Honor `prefers-reduced-motion`; never require animation to understand the result.

## Verify before delivery

- For standalone HTML, render temporary PNG previews with
  `scripts/render_html_preview.py`, inspect the images, and clean up the renderer's
  marked temporary directory in the same turn. Do not retain review-only images.
- Use browser interaction testing in addition to renderer previews only when the
  artifact's meaning depends on controls, keyboard behavior, runtime network access,
  or console state.
- Check that data marks, labels, legends, tooltips, controls, and exports reflect the
  supplied values. Include desktop and narrow renderings when responsive layout is
  material.
- Fix overlaps, clipping, blank maps, failed imports, inaccessible interactions, and
  broken local paths before responding.
- Report the artifact path, format, important dependencies, and what was verified.
  Keep the handoff concise and do not repeat all values already visible in the result.
