# Charts and data graphics

Read this reference for plots, statistical graphics, comparisons, timelines, and
compact analytical dashboards.

## Select the form from the question

- Use position on a common scale for precise comparison: dots, bars, or intervals.
- Use lines for ordered change when continuity between observations is meaningful.
- Use scatterplots for relationships and distributions or small multiples for
  variation that aggregates would conceal.
- Use stacked bars or areas for part-to-whole change over time. Do not replace the
  requested allocation view with totals-only bars or duplicate it as both a heatmap
  and a stacked chart.
- Use aligned lanes on one time axis for phases, waits, concurrency, or resource
  contention. Annotate totals and bottlenecks on the lanes or axis.
- Use a compact table when exact lookup matters more than visual comparison.

## Axes, domains, and labels

- Derive domains from all relevant observations, uncertainty, and reference values.
  Add padding for marker radii and labels; do not crop endpoints or uncertainty.
- Bar and area encodings normally require a meaningful zero baseline. If a truncated
  axis is necessary, make the break explicit and use a mark type that does not imply
  magnitude from area.
- Show concise axis titles and units. Format ticks for the data scale and locale.
- Measure or inspect label bounds after rendering. Anchor edge labels inward, wrap or
  reduce optional annotations first, and never solve collisions by making essential
  text unreadably small.
- Directly label important values and series when possible. Add a legend only when
  direct labels would be ambiguous or crowded.

## Multiple series and uncertainty

- Use stable semantic colors and no more distinct hues than readers can reliably
  distinguish. Keep axes, grids, and inactive structure neutral.
- Pair series color with a visible label and, where practical, shape or line style.
- Use bands for dense uncertainty and whiskers or intervals for isolated estimates.
- In interactive multi-series time plots, use one shared tooltip at the pointer's
  exact x-coordinate. Interpolate visible series when the chart semantics permit it;
  otherwise disclose that values snap to observations.
- Make legend toggles real buttons with `aria-pressed`. Toggling a series must update
  its marks, direct labels, and tooltip entry together.
- For dense scatterplots, use a nearest-point search or spatial index rather than a
  separate oversized DOM target for every point.

## Composition and responsive layout

- Start with the plot. Do not add a KPI row, filters, or decorative cards unless the
  question requires them.
- Use shared-scale small multiples for distributions and multi-metric comparisons.
  Keep requested dimensions visible instead of hiding them behind a mode toggle.
- Size each SVG or canvas from its actual container and redraw with a resize observer
  when needed. Use a matching SVG `viewBox`; do not scale down a fixed desktop canvas.
- At narrow widths, stack panels, reduce tick count, and remove optional annotation.
  Preserve the marks, axis meaning, units, and primary takeaway.

## Styling and motion

- Define semantic CSS custom properties for background, foreground, muted text,
  structure, focus, and series colors. Provide light and dark values when both themes
  are supported.
- Keep large-area fills subtle and structural lines thin. Do not add decorative
  outlines to filled quantitative marks.
- Animate transitions only when they explain a state change. Do not animate initial
  appearance, use fade-only transitions as the sole cue, loop motion, or ignore
  reduced-motion preferences.
- Give every chart an accessible title and short description that states its purpose
  and the variables encoded.
