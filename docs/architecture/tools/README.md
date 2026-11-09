# Architecture retrieval tools

Project-local Node tools; no server, embedding model, database, installation or native Azrael registration is required. The [retrieval contract](../features/architecture-navigation/README.md) owns behavior and boundaries; the [work record](../../../work/GM-01-architecture-section-search/01-plan.md) owns the initial measured comparison; the [facet rollout record](../../../work/GM-01-architecture-section-search/02-plan.md) owns current classification and migration verification.

## Search and read

Run from the repository root, or pass `--root` explicitly:

```powershell
node docs/architecture/tools/architecture.cjs search "compaction"
node docs/architecture/tools/architecture.cjs map --feature task-work-time --layer engine
node docs/architecture/tools/architecture.cjs map --group-by feature
node docs/architecture/tools/architecture.cjs search "timing" --layer engine --detail
node docs/architecture/tools/architecture.cjs search "모델 목록"
node docs/architecture/tools/architecture.cjs read "arch.queued-compaction.contract"
node docs/architecture/tools/architecture.cjs related "ui.queued-compaction"
node docs/architecture/tools/architecture.cjs check --changed scripts/provider-model-picker.cjs
```

Use the returned ID for `read` and `related`. `map` returns document candidates; `search` returns ranked section candidates. Both default to compact `id`, `title`, `feature`, `layers` fields. Explicit shared ownership is `feature: null`; absent classification is `feature: "unknown"` with no guessed layer. `--feature null` and `--feature unknown` select those cases. Repeat `--feature` or `--layer` for OR within that facet; feature and layer filters combine with AND. Layers are `ui`, `host`, `engine`, `tooling`. `search --detail` exposes excerpts, rank, source bounds, state and matching terms. Conflict candidates additionally expose `status`, `priorStatus` and `conflict`, including compact results.

Discover available categories with `map --group-by feature` or `map --group-by layer`. Groups contain only the feature/layer value and `documents`, the distinct document count after existing facet filters and router exclusion. Feature groups preserve shared `null` separately from `"unknown"`; the layer group `null` means no declared layers. Multi-layer documents count once in each applicable layer. Groups use the same default eight-result pagination and maximum limit of 100 as document candidates.

Search sorts by match group before score: a complete query phrase or equivalent whole-query name in the section's own title/body/ID (or its exact feature owner) precedes all query words appearing separately, followed by partial-word and parent-context matches. Complete phrases preserve word boundaries, ignore case/Unicode width and allow whitespace variation. Only aliases of the entire query establish equivalent full matches; aliases of individual query words cannot promote a partial match. Existing scores order candidates within each group, so a detailed result's larger `score` does not necessarily precede a complete match. Partial candidates remain available through pagination; compact output is unchanged.

`read --offset N --limit N` continues a long unit; `--sha` optionally requires the digest from detailed search/read. Reads preserve the original directly owned body, including metadata comments and line endings. Metadata is excluded from searchable source text and excerpts; source bounds and offsets still refer to the original file. Source modification can invalidate a digest; search again rather than treating old positions as current. Inspect children and related sections for relevant conditions before concluding that an excerpt covers the complete contract.

`--limit`/`--offset` paginate search, related and diagnostic results. See `--help` for the implemented defaults and accepted bounds. Successful command execution does not mean a diagnostic result is clean; inspect its findings and coverage. `rg`, declaration search and ordinary source reads remain available and can be better for an already known implementation.

The parser covers this project's ATX headings, fenced code, explicit HTML anchors and inline Markdown links. It does not implement Setext headings, reference-style links or a complete Markdown/HTML syntax tree; diagnostics do not claim coverage of those forms. Read pagination counts UTF-16 code units, as reported by the CLI.

## Source metadata and relationships

Discovery recursively visits architecture Markdown files, excluding `tools/` directories and symbolic links. Put one single-line declaration directly after a document's H1, or in a section's directly owned body:

```html
<!-- architecture: {"id":"arch.task-work-time.contract","feature":"task-work-time","layers":["ui","host","engine"]} -->
```

The owning ancestor folder's `README.md` supplies the feature default from its declaration; a directory name never supplies identity. Document metadata overrides that default; section metadata can override feature/layers or provide an explicit stable section ID. A document ID selects its H1/entry; its other sections use `document-id#anchor` unless explicitly identified. Current `repository-file#anchor` addresses and explicit anchors remain aliases. Moved paths are never guessed. Invalid metadata, duplicate IDs and explicit folder-feature mismatches are observable through `check`.

An explicit link-only migration router may declare `"redirect":"arch.canonical.document"` alongside its own unique stable `id`, `"feature":null`, `"layers":[]` and reference status. The target must be an existing stable document ID; section targets, missing targets, self references and cycles produce diagnostics. Routers are excluded from `map` and `search` (including detailed search). Reading a router ID or its current legacy `file#anchor` returns its exact source body and links with the declared `redirect`; reads never follow it automatically. Direct relations and changed-scope checks retain actual router links without transitive expansion; relation links identify router sources through `sourceRedirect`.

Metadata may specify `status`. A conflict requires `"status":"conflict"`, `"priorStatus":"current"` (the prior state) and `"conflict":"relative-record.md#anchor"` (the source reference). Conflict remains visible in descendants even if they declare another state. A map document candidate with affected sections additionally exposes `conflicts` with a total, up to eight IDs and a truncation flag; its entry and unaffected sections retain their own state. Target/partial scope alone never becomes a conflict; the tool does not infer or resolve contradictions.

`related ID --direction incoming|outgoing|both` defaults to both. For document/section targets it returns only direct source links and parent/children in the requested direction; add `--detail` to include existing inventory/concept relationships. Selecting a feature or concept ID directly requests those inventory/concept relationships. All modes use bounded pagination. Incoming links include source section/file and line. A file-only link targets the document entry and remains `kind: local` without claiming an exact section; exact section links retain their target ID. No transitive graph is returned. `check --changed PATH` adds documents directly referencing an affected contract or changed path, reports `scope.incomingFiles` and a one-hop bound, and preserves incomplete coverage for unmapped changes. Metadata/ID validation remains global even for changed-path checks.

## Terms and maintenance

[terms.json](terms.json) is a small vocabulary rather than a second architecture. A concept has an ID, label, equivalent `aliases`, distinct `legacy` names, existing `features` and `related` concept IDs. Feature relationships resolve through the existing inventory; do not duplicate implementation lists. Add an alias when an authorized change introduces a useful alternate name. Avoid ambiguous generic terms, and do not classify related actions as equivalent merely because they often appear together.

For an authorized code or contract change, use the changed paths to identify owning contracts and review relevant sections and terms. `check` produces candidates, not truth judgments or permission to modify unrelated features. A missing historical work file does not prove obsolete behavior. Keep execution logs, audit findings and historical explanations in the work record; edit enduring contracts in place. State changes require evidence for their actual source/package/installed/platform scope.

## Verification

Run the retained tests with `node --test docs/architecture/tools/architecture.test.cjs`. During managed project work, set `ARCHITECTURE_SEARCH_TEST_ROOT` to an owned disposable run directory so its owner can retire filesystem fixtures after review. Follow the project testing and artifact lifecycle guidance. Do not extrapolate Windows results to other platforms or local tool checks to model efficiency.
