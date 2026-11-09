# Repository architecture retrieval

Status: `partial` — the project-local CLI has source implementation and Windows verification; model efficiency and other-platform execution retain their separately recorded scope. This contract does not register an Azrael native tool or establish product/package acceptance. Implementation and the initial two-task comparison belong to the [owning work](../../work/GM-01-architecture-section-search/01-plan.md).

## Scope and authority

The local Node tool under `tools/` retrieves architecture sections and their existing implementation/verification relationships for this repository. It runs on demand without a service, vector database, embedding model or external dependency. Markdown and the existing [feature inventory](../../scripts/azrael-feature-contracts.json) remain authoritative; derived search information cannot establish that a contract is implemented or verified.

Common behavior targets local Windows x64, glibc Linux x64 and macOS ARM64. Actual verification is recorded separately. Remote execution, repository aggregation and registration as a built-in Azrael tool are outside this version.

## Retrieval units and provenance

Index the immediate architecture Markdown files, excluding tool sources and generated evidence. A unit is an ATX heading and its directly owned text until the next heading; a document preamble is also addressable. Nested headings retain their parent context and inherited state. Fenced code cannot introduce headings. Duplicate headings and explicit HTML anchors retain unambiguous identifiers.

Each result identifies the relative file, section/heading, source line range, content digest and state provenance. State may be current, partial, target, draft, a declared reference state or unknown. A document with implemented and target portions cannot be summarized as fully current. State prose and its scope remain available in the source; labels do not prove installed-host acceptance.

Search returns compact ranked candidates with matching terms and a short source excerpt. The caller can read a selected unit with bounded pagination and expand related units. Required exceptions and permissions stay discoverable through heading context and related sections. Truncation is explicit; a partial excerpt never represents complete contract coverage. An optional expected digest rejects a stale selection instead of reading a changed unit as if it were unchanged. Each invocation derives its index from current files; there is no independently maintained persistent cache.

## Terms and relationships

The small project-owned term file records concept IDs, labels, aliases, legacy names, related concept IDs and existing feature IDs. Equivalent names expand a keyword query; related concepts and legacy names remain distinguishable from synonyms. Exact feature IDs, setting keys and code identifiers remain searchable. English case and Unicode normalization cannot change source text or reported locations.

Related information comes from section links, file-level feature contracts and their registered owners/checks. The tool does not infer call graphs or invent dependencies. The inventory keeps its existing repository-file `contract` schema; section addressing belongs to this retrieval layer. Large owner lists and results are bounded and paginated. Missing source and unresolved relationships remain explicit.

## Change-driven maintenance

For changed repository paths, use existing feature owners/contracts to identify affected architecture files and report source/section links and term issues for review. Link diagnostics distinguish missing local files, missing anchors, unsafe/external references and unknown metadata. An unavailable historical work record is not proof that a product contract is obsolete.

Agents handling an authorized change review the affected owning sections, update current contract text and relevant aliases when necessary, and validate references before completion. They preserve independent current/target behavior, existing exceptions and platform boundaries. Diagnostic findings and investigation history stay in work records; only agreed enduring behavior belongs in architecture. A code/document difference is a review candidate, not authority to rewrite a contract, delete a feature or upgrade verification state.

## Faceted navigation and feature ownership

Status: `target` — this section defines the agreed document/navigation design. The current CLI still indexes immediate architecture Markdown files and returns its existing metadata and excerpts; nested discovery, facets and compact navigation are not implemented by this declaration.

A feature groups content that shares a behavior contract and tends to change together. Its boundary can widen or narrow when independent responsibilities, lifetimes, failure handling or retrieval needs justify it. A layer or a fixed document-size threshold does not determine that boundary. Each feature has one physical home and one owning end-to-end contract. Layer-specific detail is split only when it has a useful independent responsibility; short features need no empty detail files. Shared policies retain a single owner outside individual feature folders.

The primary facets are feature and layer. Layer values describe responsibilities in UI, host, engine or tooling, independently of programming language. A document may cover several layers. A section may refine its document's classification when a short mixed section does not justify another file. Stable feature/document/section identities are independent of display names and locations. Existing preservation IDs remain intact; a user-facing feature can connect several UI/engine preservation entries. The executable inventory's contract remains a repository file path; section addressing is owned by navigation metadata.

Source-local machine-readable classification owns the map. A feature folder's owning contract declares its stable feature identity and supplies the default association; identity is not inferred from the directory name. Document metadata supplies applicable layers and any explicit association overrides, without requiring a second manually maintained map. System overviews, shared policies and references can explicitly have no single feature owner; this is distinct from unknown classification, and their feature connections come from declared associations or source links. Status and platform scope remain separately queryable attributes, not mandatory top-level navigation choices. Additional concern facets require an actual retrieval need. Default navigation returns only identity, name and classification with bounded pagination; summary, excerpt, score, parent context, state details and relations can be requested separately. Contract reads and change review expose state and applicable scope even when discovery is compact.

Outgoing and incoming document/section links are derived from source. File-only links remain file-level and cannot claim an exact target section. Default relation discovery is bounded, identifies its source/coverage and permits explicit expansion; it neither returns the entire connected graph nor invents semantic dependencies. Missing targets and unclassified content remain explicit. The map is a navigation view, not another authoritative architecture or proof that all affected behavior was found.

## Design precedence and conflict state

Status: `target` — conflict metadata and navigation behavior require implementation. The existing CLI does not yet recognize conflict as a first-class state.

Agreed design governs intended behavior. Implementation observations cannot authorize changing that design. When applicable contracts contradict each other, or observed implementation contradicts an applicable agreed contract, the affected unit's effective state becomes `conflict`; retain its prior declared implementation state and scope separately. Preserve both claims and their source links in the owning work record, and link that conflict from the affected unit. A known conflict is visible even in compact navigation and cannot be hidden by inherited parent state. This does not make every unaffected section of the document conflicted.

Conflicts remain pending user discussion. Neither code inspection, search rank, a passing test nor a document's newer modification date chooses a winning claim. A user resolution identifies the intended contract and the affected implementation/documentation work; it does not by itself establish implementation or platform acceptance. An unimplemented target, different platform/installed-version scopes or missing evidence alone is not a semantic conflict. Those retain their existing target, partial or unknown scope.

Unambiguous path/anchor repairs and removal of semantically identical duplication are permitted within an authorized edit. Different permissions, exceptions or lifetimes must not be deduplicated as formatting. Durable behavior stays in the owning contract; conflict evidence and resolution discussion stay in work records. Reclassification or relocation never silently changes behavior or verification status.

## Filesystem and output boundaries

The caller selects one repository root. Input files and inventory paths are resolved within it; traversal and linked-file escapes are rejected. No source content is executed, no user state is searched, and the tool makes no network requests or source modifications. The search process does not run the inventory's executable checks. Inputs changing during a read invalidate that observation.

Machine-readable results separate successful operation from a clean diagnostic result. A completed `check` with findings is not a passing validation. Invalid arguments and unsafe reads produce explicit errors. CLI usage and invocation examples are maintained with the [tool](tools/README.md).

## Preservation and evaluation

Local tests preserve fenced/duplicate/Unicode headings, inherited state, aliases versus related concepts, exact identifiers, source bounds and pagination, changed/missing files, relationship ownership and path containment. They exercise actual temporary files where filesystem behavior matters. The initial comparison uses fresh gpt-6.1-sol/medium threads for a read-only cross-contract question and a documentation-maintenance task, with frozen original inputs and separate per-response usage, tool output and wall time. Tool guidance and glossary input count toward cost. Passing source checks do not establish model efficiency; a lower-token answer that loses required contract coverage is not accepted as an improvement.
