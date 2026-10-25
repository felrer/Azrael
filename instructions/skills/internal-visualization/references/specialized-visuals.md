# Specialized visualizations

Read only the relevant section for maps, dense categorical grids, simulations, or UI
mockups.

## Geographic maps

- Use published GeoJSON or TopoJSON and sourced longitude/latitude with an appropriate
  projection. Never hand-draw or guess geographic outlines when the result represents
  real geography.
- Prefer official statistical, cadastral, or local open-data geometry for the required
  administrative level. Record the source and relevant version or retrieval date.
- Let the map dominate. Include at most one compact selection or detail area and only
  the controls the request requires.
- Provide enough surrounding geography to locate the marks. A blank field, lone
  administrative outline, or unprojected point cloud is not an adequate basemap.
- Join identifiers without lossy coercion: preserve leading zeroes and the source's
  string identifiers. Report unmatched regions rather than silently dropping them.
- Inspect the rendered geometry before delivery. Fix blank basemaps, failed imports,
  missing labels, inverted coordinates, projection errors, and points outside the
  expected region.

## Dense categorical grids

- Show one readable identifier per cell. Put secondary metadata in an accessible
  label, tooltip, or compact selected-item summary instead of filling each cell with
  badges.
- Use one small legend and stable category encoding. Allow only selection unless the
  user asks for filtering, reordering, or other controls.
- Keep keyboard focus and selection visible and distinguish them from hover.

## Interactive explainers and simulations

- Use compact controls and one dominant visual. Add at most one short selected-state
  detail; use summary cards only when changing metrics are central to the explanation.
- State assumptions, ranges, units, and whether the model is illustrative or derived
  from evidence. Do not present simulated values as observed facts.
- Constrain inputs to meaningful ranges and show validation errors near the control.
- For step-through explanations, update one current visual. Do not add parallel steps,
  formulas, parameter panels, or autoplay unless requested.

## UI mockups

- Match the known product and platform context. If no design system exists, create a
  small product-specific palette and type scale rather than imitating a generic
  analytics dashboard.
- Use opaque surfaces for actual product windows, dialogs, menus, and popovers. Keep
  overlays above content and show realistic states rather than filler cards or
  oversized icons.
- Put app-wide navigation and settings in the app chrome and local controls in their
  component. Omit selectors that have only one meaningful option.
- Use semantic controls and inspectable HTML for interaction. Do not fake a screenshot
  when the user needs to evaluate behavior or accessibility.
- Distinguish a contained component or mobile-screen mockup from a full-page desktop
  shell. Do not wrap a full-page mockup in another decorative application frame.
