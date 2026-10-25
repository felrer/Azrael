# Report-first visual design for analytical artifacts

Read this reference when a standalone HTML, SVG, or exported visualization must be
visually polished. It extracts only broadly useful principles from Stripe-inspired
interface design and Google's modern data-visualization guidance; it is not a copy or
representation of either brand.

## Default visual character

- Unless the user explicitly requests a dashboard, product interface, landing page,
  or application shell, make the artifact look like an edited analytical report.
- Build a complete reading path that works without interaction: document identity,
  title and scope, concise findings, numbered figures or sections, exact tables,
  methods and limitations, then provenance.
- Use a centered paper-like content surface, restrained page margins, editorial
  typography, thin rules, and print-stable spacing. A quiet outer canvas may separate
  the report sheet from the browser, but the report itself should remain visually
  flat.
- Treat interaction as an annotation layer for definitions, exact values, or focused
  comparison. Do not make tabs, filters, hover, or disclosure controls necessary to
  obtain the core result.
- Avoid website signals by default: large promotional heroes, navigation bars,
  dashboard KPI tiles, floating or nested cards, glass effects, decorative gradients,
  oversized status badges, and repeated call-to-action styling.

## Editorial structure

- Use a compact masthead for report family, run or document identifier, completion
  date, and status. Keep the report title dominant but not promotional.
- Prefer numbered section headings and captions such as `Figure 1`, `Table 2`, or a
  local-language equivalent when the artifact contains several analytical blocks.
- Present top-line facts as a compact summary table or ruled finding strip, not a row
  of independent dashboard cards.
- Keep methods, limitations, N/A guards, notes, and source paths visible in the normal
  reading flow. Collapsible disclosure is optional for secondary detail but must not
  hide facts required to interpret the result.
- Make print and PDF output first-class: avoid awkward page breaks, preserve captions
  with their figures, repeat table headers where supported, and remove interaction-
  only decoration in print.

Sources for the design rationale:

- Stripe-inspired design analysis: <https://www.designmd.co/d/stripe>
- Google Looker modern visualization theme:
  <https://docs.cloud.google.com/looker/docs/modern-ui>
- Google Looker color collections:
  <https://docs.cloud.google.com/looker/docs/color-collections>
- Google color accessibility guidance:
  <https://codelabs.developers.google.com/color-contrast-accessibility>

## Visual hierarchy

- Establish one dominant question or result per view. Use size, weight, spacing, and
  position before adding color.
- Keep the reading order explicit: context and status, primary result, supporting
  evidence, diagnostics, then provenance and limitations.
- Use a restrained type scale and tabular numerals for values. Prefer system fonts or
  licensed project fonts; never depend on a proprietary brand font.
- Keep body and chart text at least 12px in standalone reports. Avoid ultra-light
  weights for data, Korean text, small labels, or dark backgrounds.
- Use generous section spacing but compact spacing inside tables and metric rows.
  Do not create empty expanses that separate a label from its value.

## Surfaces and structure

- Use a quiet page background, one paper-like main content surface, thin dividers, and
  only the bounded panels needed to distinguish figures or cautions. Cards must group
  a real unit of meaning, not decorate every value.
- Keep corner radii conservative, normally 4-8px. Use shadows only to distinguish
  elevation or a focused region; prefer a subtle cool shadow over a heavy neutral
  drop shadow.
- Keep chart backgrounds and dense tables visually flat. Structure them with
  alignment, whitespace, and light rules instead of nested cards.
- Reserve saturated color for selection, primary data, and actionable status.

## Analytical color system

- Define separate semantic tokens for interface neutrals, primary data, categorical
  series, sequential values, diverging values, and status. Do not use one palette for
  every role.
- For a single model or measure, use one blue family rather than assigning a rainbow
  to peer metrics. Use a stronger tone for the primary metric and a pale tone for a
  selected model column or confidence interval.
- Use categorical colors only for unordered, persistent identities; sequential tones
  for low-to-high magnitude; and diverging tones only when a meaningful midpoint
  separates two directions.
- Keep colors lower in chroma than action colors so data remains readable over time.
  Do not use red or green to imply quality unless the metric has an explicit status
  threshold.
- Verify normal text at 4.5:1 contrast and non-text data marks or focus indicators at
  3:1. Pair status colors with labels or icons and test common color-vision
  deficiencies.

## Tables

- Use a semantic table with left-aligned labels and right-aligned tabular numbers.
- Highlight only the selected or focal model column with a pale continuous fill.
  Bold a row winner only when values are comparable and the direction of better is
  known; never bold ties or unavailable values arbitrarily.
- Put metric descriptions below their labels in smaller muted text. Keep units in a
  dedicated note or column rather than repeating them inconsistently.
- Use light horizontal rules and restrained row hover. Avoid vertical gridlines
  unless they materially improve a wide matrix.
- On narrow screens, preserve the label column and allow the numeric matrix to scroll
  inside its own region. Provide an accessible caption and maintain header
  associations.

## Graphs and interaction

- Pair an overview graph with a detailed table only when they answer different needs:
  the graph for patterns and the table for exact lookup.
- Use hover or focus to reveal definitions, units, uncertainty, and sample size.
  Keep the same information reachable by keyboard and retain essential values in the
  first render.
- Use motion only to explain state change. Prefer a subtle emphasis change over
  decorative entrance animation.
- Keep tooltips dark enough for contrast, compact, and close to the selected mark.
  Do not make the pointer travel across the page to connect a label and value.

## Review questions

- Can a reader identify the run status, primary result, and largest limitation in
  five seconds?
- Would the artifact still read as a complete report if all hover, selection, and
  disclosure behavior were removed?
- Does the page resemble an analytical publication more than a product dashboard or
  marketing website?
- Are related labels and values spatially close?
- Does every color have one stable meaning?
- Does the visualization remain legible in grayscale, at 320px, and at 200% zoom?
- Does the detailed table expose every value represented graphically?
