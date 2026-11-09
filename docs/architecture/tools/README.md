# Architecture retrieval tools

Project-local Node tools; no server, embedding model, database, installation or native Azrael registration is required. The [retrieval contract](../architecture-search.md) owns behavior and boundaries; the [work record](../../../work/GM-01-architecture-section-search/01-plan.md) owns measured efficiency and actual platform verification.

## Search and read

Run from the repository root, or pass `--root` explicitly:

```powershell
node docs/architecture/tools/architecture.cjs search "compaction"
node docs/architecture/tools/architecture.cjs search "모델 목록"
node docs/architecture/tools/architecture.cjs read "docs/architecture/queued-compaction.md#queued-context-compaction"
node docs/architecture/tools/architecture.cjs related "ui.queued-compaction"
node docs/architecture/tools/architecture.cjs check --changed scripts/provider-model-picker.cjs
```

Use the returned section ID for `read` and `related`. `search` returns short excerpts, source bounds, state and matching terms. `read --offset N --limit N` continues a long unit; `--sha` optionally requires the digest returned by the selection. Source modification can invalidate an ID or digest; search again rather than treating old positions as current. Inspect children and related sections for relevant conditions before concluding that an excerpt covers the complete contract.

`--limit`/`--offset` paginate search, related and diagnostic results. See `--help` for the implemented defaults and accepted bounds. Successful command execution does not mean a diagnostic result is clean; inspect its findings and coverage. `rg`, declaration search and ordinary source reads remain available and can be better for an already known implementation.

The parser covers this project's ATX headings, fenced code, explicit HTML anchors and inline Markdown links. It does not implement Setext headings, reference-style links or a complete Markdown/HTML syntax tree; diagnostics do not claim coverage of those forms. Read pagination counts UTF-16 code units, as reported by the CLI.

## Terms and maintenance

[terms.json](terms.json) is a small vocabulary rather than a second architecture. A concept has an ID, label, equivalent `aliases`, distinct `legacy` names, existing `features` and `related` concept IDs. Feature relationships resolve through the existing inventory; do not duplicate implementation lists. Add an alias when an authorized change introduces a useful alternate name. Avoid ambiguous generic terms, and do not classify related actions as equivalent merely because they often appear together.

For an authorized code or contract change, use the changed paths to identify owning contracts and review relevant sections and terms. `check` produces candidates, not truth judgments or permission to modify unrelated features. A missing historical work file does not prove obsolete behavior. Keep execution logs, audit findings and historical explanations in the work record; edit enduring contracts in place. State changes require evidence for their actual source/package/installed/platform scope.

## Verification

Run the retained tests with `node --test docs/architecture/tools/architecture.test.cjs`. During managed project work, set `ARCHITECTURE_SEARCH_TEST_ROOT` to an owned disposable run directory so its owner can retire filesystem fixtures after review. Follow the project testing and artifact lifecycle guidance. Do not extrapolate Windows results to other platforms or local tool checks to model efficiency.
