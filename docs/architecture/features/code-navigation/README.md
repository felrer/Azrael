# Declaration name search

<!-- architecture: {"id":"arch.code-navigation.contract","feature":"code-navigation","layers":["engine","tooling"]} -->

Status: `target` for installed product acceptance. The native implementation, registration and packaged-helper boundary have passed selected Windows checks in the [owning work](../../../../work/FI-01-serena-read-navigation-evaluation/24-plan.md). Product build, packaging and installation are excluded by the latest user instruction; installed-host acceptance and Linux/macOS execution remain unverified.

## Contract

`find_names(relative_path, query, include_signature=false)` is a read-only tool for declaration-name searches within one source file. Supported extensions are `.js`, `.jsx`, `.cjs`, `.mjs`, `.ts`, `.tsx`, `.cts` and `.mts`. A nonempty query uses Unicode case folding and literal substring matching against the declaration's own name. Parent paths, signatures, comments and bodies are not search fields.

Each result is `[id,start,end]`, with 1-based inclusive line numbers. `include_signature=true` adds a compact signature only for callable declarations. Signatures omit the repeated declaration name, preserve explicit types and defaults, and do not infer return types. Empty results are `[]`; an empty query is an error. There is no list-all, source-body or expandable-outline operation.

Functions, methods/accessors, classes, callable initializers and file-level variables/constants follow the v5 declaration selection. Parameters, ordinary locals and fields, import aliases, type/interface/enum declarations and anonymous callback entries are excluded. A named declaration may have an anonymous callback in its containing ID path. Native ID equivalence is an implementation prerequisite; the tool must not silently substitute a different ID contract.

The first product version preserves v5 provider-position behavior, including its omission of top-level exported overload implementations. Accessor siblings and method overload implementations retain their native indexed IDs. This compatibility boundary does not establish complete overload support.

## Execution and authority

The common native tool registry owns registration and Code Mode exposure. Existing tool policy, environment selection, tool-free modes, provider mappings and role restrictions remain authoritative. Prompt text does not grant tool or filesystem access.

The handler reads source through the environment filesystem and current read sandbox, rejects project-relative path escapes, and passes the authorized source text to a trusted parser helper. The helper parses source as data, does not execute it or resolve project imports, and returns only matching metadata. The handler detects a file changing during the search and returns an error rather than stale ranges.

The packaged helper and Node executable use explicit host-owned paths. Development `node_modules`, a user's global Node/Python and the experimental Serena environment are not implicit runtime dependencies. Parser/ID compatibility and the packaged dependency closure must be verified before native acceptance. Helper processes have a bounded per-call lifetime; source content is not diagnostic log material.

## Model guidance

The maintained common behavior source routes declaration-name search to `find_names`, text search to `rg`, and file discovery to `rg --files`. It leaves tool choice and read scope to the model. There is no file-size threshold, terminal restriction or prescribed call sequence. The schema/help owns option and return-format details; AGENTS and skills do not repeat this tool-routing rule. User custom behavior templates retain their existing ownership.

## Platforms and preservation

The intended local targets follow the project's multi-platform contract: Windows x64, glibc Linux x64 and macOS ARM64. Actual source, native and installed verification are recorded separately in the owning work. Other languages retain ordinary search tools.

Preservation must cover name-only matching and selection, IDs/ranges/signatures, sandbox and path boundaries, changed files, native and Code Mode exposure, shared-provider mappings, prompt-copy equality, and inclusion of the helper/runtime dependencies in installed packages. One successful prototype run does not establish universal token savings or platform acceptance.

The [feature inventory](../../../../scripts/azrael-feature-contracts.json) maps `tool.find-names` to its implementation owners and executable preservation checks.
