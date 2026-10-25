# DOCENTO benchmark result template

Read this reference for DOCENTO Layer 1 benchmark score, release, or audit results.
It specializes the general visualization rules without changing benchmark semantics.

## Reuse these resources

- HTML template: `assets/docento-benchmark/template.html`
- Example normalized input: `assets/docento-benchmark/example-report.json`
- Deterministic renderer: `scripts/render_docento_benchmark.py`

Render a report with:

```text
python scripts/render_docento_benchmark.py INPUT.json OUTPUT.html
```

Resolve these paths from the skill directory. Copy the generated HTML to the user's
requested destination; do not edit the template only to insert one result payload.

## Required reading order

1. Run identity, shared/exclusive workload, completion state, and release/audit state.
2. Primary ranking result and its uncertainty.
3. Supporting ranking and evidence metrics.
4. Request and pool integrity.
5. Diagnostic output labels, then S0-S3 benchmark defects as a distinct concept.
6. Independent validation, checksums, calibration, guards, limitations, and
   provenance.

## Report form

- Render DOCENTO results as a technical evaluation report, not a benchmark landing
  page or monitoring dashboard.
- Use a compact document masthead, ruled execution summary, numbered sections,
  figure/table captions, visible interpretation guards, and an always-visible methods
  and provenance block.
- Keep the primary score visually dominant through typography and figure position,
  not a promotional hero, gradient panel, or oversized KPI card.
- Use one white report sheet on a quiet neutral canvas. Keep sections flat with rules
  and whitespace; reserve bounded fills for the focused metric, selected model column,
  confidence interval, and explicit status meaning.
- Preserve a useful static print view. Interactivity may change the metric annotation
  but must not be required to see any score, confidence interval, validation result,
  defect count, limitation, or source note.

## Semantic invariants

- `nDCG@10` is the primary ranking metric. Do not combine it with safety, evidence,
  calibration, integrity, or latency into a composite score.
- Render a confidence interval as an interval on the same 0-100% scale as its point
  estimate and repeat the exact endpoints in text.
- Higher-is-better metrics may share the score profile. Lower-is-better metrics such
  as ECE, Brier score, error rates, and elapsed time belong in a separate table or
  panel with their direction stated.
- `INVALID_EVIDENCE`, `UNMAPPED`, `DUPLICATE`, and `SCHEMA_ERROR` are scored diagnostic
  output labels. They are not S0-S3 benchmark defect severities.
- S0-S3 rows represent unresolved benchmark defects and release behavior. Do not
  infer those counts from diagnostic labels.
- A missing source label or an unavailable independently valid paired gold is `N/A`
  with its guard text, never zero.
- State that the v1 result uses public data and no human annotator, clinician
  specialty mix, or senior adjudicator.

## Table format

- Use the Google-style comparison matrix in the template for exact metric values.
- Keep one `focus: true` model column and shade it continuously. When several models
  are present, bold only a comparable row maximum or minimum according to
  `higher_is_better`.
- Keep metric name, description, scale, and uncertainty together. Do not put a value
  at the far edge of the page without row structure.
- If the report contains one model, retain the table for exact lookup but do not add
  empty comparator columns.

## Graph format

- Use the horizontal score profile for bounded 0-1 metrics. Give the primary metric
  the strongest blue and supporting metrics a quieter blue.
- Selecting or focusing a metric updates one nearby detail region with its exact
  value, definition, direction, and confidence interval when present.
- Keep the 0%, 50%, and 100% reference points visible. Do not interpret 100% as a
  target unless the metric definition makes it one.

## Normalized input

The renderer accepts a JSON object with these top-level fields:

- `title`, `subtitle`, `model`, and `run`
- `summary_cards`: compact run facts
- `models`: one or more comparison columns; exactly one may set `focus: true`
- `metrics`: bounded metric rows with a `values` mapping by model ID
- `secondary_metrics`: unbounded or lower-is-better rows
- `integrity`: completion and validation checks
- `diagnostics`: scored output-label counts
- `release_defects`: S0-S3 unresolved counts
- `validation`: independent audit evidence
- `guards`, `notes`, and `provenance`

Use the example input as the field-level contract. Preserve unknown facts as `null` or
omit the optional field; do not fabricate values to satisfy the layout.
