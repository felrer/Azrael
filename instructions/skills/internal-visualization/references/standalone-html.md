# Standalone HTML and export

Read this reference when the deliverable is interactive HTML, must work locally, or
will be exported to PNG or PDF.

## Document contract

- Produce a complete HTML document with `<!doctype html>`, a language attribute,
  UTF-8 charset, viewport metadata, and a meaningful document title.
- Scope CSS and JavaScript to a unique root element. Do not depend on
  `document.currentScript`, conversation-host globals, injected design-system
  classes, or an assumed global icon library.
- Define the document's own semantic theme variables. Use
  `prefers-color-scheme` when automatic light and dark themes are appropriate.
- Prefer inline CSS and JavaScript for a single portable artifact. Split files only
  when project conventions, maintainability, reuse, or artifact size justify it.
- Embed modest datasets as JSON. For large data, store an adjacent compact data file
  and provide a local-server command because browser `file:` security may block
  loading it. Never silently depend on a remote endpoint.

## Dependencies and reproducibility

- Reuse an installed library before introducing another dependency. Pin newly added
  versions and record the dependency in the project's established manifest or in the
  handoff when no manifest exists.
- Prefer local or vendored assets when offline use matters. If a CDN is acceptable,
  pin the exact version and verify the artifact with network access disabled or state
  the remaining online dependency explicitly.
- Keep the data transformation deterministic. If randomness is meaningful, expose or
  fix the seed and record it.
- Aggregate, bin, downsample, or reduce precision when large inline data harms load or
  interaction time, while preserving the analytical meaning and documenting the
  transformation.

## Interaction

- Use native buttons, inputs, and selects with visible labels. Keep the first render
  informative before the user changes a control.
- Use one state mechanism per behavior. Do not invent search, filters, reset controls,
  drill-downs, or autoplay.
- Make pointer interactions usable from the keyboard. Keep tooltip content concise
  and include the label, value, and unit.
- Keep dynamic status in a stable region. Announce meaningful selection or simulator
  results with `aria-live="polite"`, not every hover frame.
- Avoid fixed viewport-height layouts, page-level horizontal overflow, and internal
  scrolling that hides the primary visual.

## Fast renderer verification

- Prefer the bundled local renderer for a fast visual review of standalone HTML. It
  executes the document in an isolated headless engine, prints it to temporary pages,
  and converts those pages to PNG without controlling the user's browser:

  ```text
  python scripts/render_html_preview.py render PATH_TO_HTML
  ```

- Inspect every returned PNG with the local image viewer. Confirm that values match
  the source and that no label, legend, table, chart, focus panel, or footer is clipped
  or obscured. Render a narrow variant separately when responsive behavior is
  material and the print layout does not expose it.
- After inspection, always remove the review artifacts in the same turn:

  ```text
  python scripts/render_html_preview.py cleanup PREVIEW_DIRECTORY
  ```

- Cleanup may target only the renderer-created directory reported by the render
  command. Never delete the source HTML, user-requested exports, or images outside the
  marked temporary preview directory. If review fails after rendering, still clean up
  the temporary preview before reporting the failure.
- Add browser testing only when pointer or keyboard interaction, responsive screen
  behavior, runtime network loading, download behavior, or console errors materially
  affect correctness. Open the final document through the same mode the user will use
  and test only those behaviors that the static preview cannot establish.

## PNG and PDF export

- Keep HTML or SVG as the editable source and treat PNG/PDF as derived output.
- Prefer an available browser automation or renderer over recreating the visual in a
  second graphics stack. Wait for fonts, images, and asynchronous rendering before
  capture.
- Choose an explicit viewport and device scale for PNG. Use a transparent background
  only when the destination requires it and text remains readable.
- Add print CSS for PDF: use physical page margins, avoid clipped overflow, preserve
  contrast, and prevent important chart groups from splitting across pages.
- Open the exported file and compare it with the source. Verify page count, dimensions,
  legibility, and that interactive-only information has an equivalent static label or
  annotation.
