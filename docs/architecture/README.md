# Architecture
<!-- architecture: {"id":"arch.index","feature":null,"layers":[]} -->

Each document or owning section labels its own state (see [document states](../README.md#document-state-and-ownership)). This index groups contracts by responsibility. Source implementation, native execution, package and installed-host acceptance have distinct scopes; the owning section determines preservation requirements.

For section-level keyword/alias search and related contract/implementation/check discovery, use the [local retrieval tools](tools/README.md) when helpful. The [retrieval contract](features/architecture-navigation/README.md) owns their scope; ordinary source search remains available. During authorized changes, review affected owning sections and terminology, keep enduring contracts current, and leave diagnostic findings and task history in the work record.

## Navigation

Feature folders collect behavior contracts and their independently useful details. System overviews, shared policies and reference material remain separate. Source metadata provides feature/layer facets; a document may span layers. Use `node docs/architecture/tools/architecture.cjs map --feature agent-profiles --layer ui` to narrow candidates, then `read` or `related --direction incoming` for the selected stable ID. Summaries and detailed ranking are optional.

Old flat paths contain link-only migration routers for historical references. They are excluded from normal map/search results and do not duplicate active contracts. Their direct reads preserve explicit links to the current owners.

## Host, storage and recovery

- [azrael-ex host and storage](system/host.md): single-extension host, private state, local history import, session links, recent chats, native conversation/file actions and integration inputs.
- [Reload and resume recovery](features/conversation-recovery/README.md): startup admission, pending input identity, connection recovery and durable resume behavior.

## Conversation execution and collaboration

- [Queued context compaction](features/queued-compaction/README.md): ordered compaction, execution thresholds, queue receipt ownership and progress.
- [Root resume scheduling](features/root-resume/README.md): durable reservations, completion signals, defer clocks and work-segment presentation.
- [Root coordination](features/agent-coordination/README.md): root-only investigation, scheduling, resource ownership, waiting and intervention policy.
- [Task memory](features/task-memory/README.md): work-scoped root/subagent records, immutable revisions, explicit context reads and optional role-profile instruction components.
- [Task work time](features/task-work-time/README.md): continuous work time and turn count below the initial user message, user-wait exclusions and partial-history display.
- [Side questions with /btw](features/side-questions/README.md): tool-free side execution, main-task isolation and explicit result delivery.
- [Work orchestration](features/work-orchestration/README.md): draft/target Lead and Team design, Team/Direct profile-based creation and approval routing, isolated worktrees and handoff boundaries.

## Accounts, providers and models

- [Accounts and usage](features/accounts/README.md): authentication, account switching/retirement, usage windows, manual actions and multi-window leases.
- [Project usage value](features/project-usage/README.md): daily API-equivalent totals, model detail, contribution calendar and project comparisons.
- [Devin and mixed-provider agents](features/devin-inference/README.md): native inference, tool contracts, catalog/agent selection and provider continuity.
- [Managed providers and provider switching](features/managed-providers/README.md): inference projection, model/reasoning controls, bounded tool discovery and handoff.
- [Model harness profiles](features/model-harness-profiles/README.md): provider/model prompt composition, compatible tool isolation and request snapshots.
- [Declaration name search](features/code-navigation/README.md): compact JS/TS declaration-name search, native tool exposure, parser runtime and file-read boundaries.
- [Provider context policy](features/context-budget/README.md): context capacities, compaction thresholds, pricing tiers and settings/gauge behavior.
- [Custom API models](features/custom-api-models/README.md): user-owned endpoints/models, protocol and tool discovery, picker/subagent selection and failure boundaries.
- [Provider brand assets](features/provider-brand-assets/README.md): original assets, provider identities, theme variants and refresh constraints.

## UI and prompt media

- [Standalone app](features/standalone-app/README.md): agreed chat-history reuse and on-demand text/terminal detail panel, with standalone host integration and platform acceptance tracked separately.
- [UI presentation](shared/ui-principles.md): native presentation, composer cleanup, drafts/flags, speed controls, settings, photos, typography and input diagnostics.
- [Prompt image preparation](features/prompt-images/README.md): shared image sizing, format/transparency preservation and provider preparation boundaries.

## Tools, authority and diagnostics

- [Session MCP reload](features/mcp-reload/README.md): agent-initiated current-session reload, selective reconnect and incremental tool context across compaction.

- [Project maintenance](features/project-maintenance/README.md): project-owned test bundles, separate build execution, artifact/backup inventory and model-directed cleanup.

- [Computer Use retirement](features/computer-use-retirement/README.md): retired desktop/child-session routes, retained generic Node support and package transition boundaries.
- [Window Use](features/window-use/README.md): app-based observation/control permissions, masked desktop capture, current-window control, task macros and collaboration boundaries.
- [Window Use documentation](features/window-use/visualization.md): route to active input modes, permissions and multi-pointer collaboration presentation.
- [Auto-Review](features/auto-review/README.md): OpenAI permission policy, turn admission and reviewer boundary.
- [Diagnostic logging](shared/diagnostics.md): default-on diagnostic controls, optional instrumentation and mandatory evidence preservation.

## Runtime, distribution and preservation

- [Multi-platform runtime and maintenance](shared/platform.md): platform identity, OS/ABI boundaries, release maturity and environment-specific acceptance.
- [Instruction distribution and settings](features/instruction-management/README.md): maintained library, acquisition/integrity, application conflicts and protected settings.
- [Azrael runtime and providers](system/runtime-target.md): target runtime/provider architecture; existing implementation owners remain authoritative until each replacement boundary is accepted.
- [Upstream feature preservation](shared/feature-preservation.md): architecture-to-inventory connection, upgrade scope review and candidate-specific acceptance.

- [Switched multi-pointer experiment](features/multi-pointer/README.md): standalone target-bound Windows multi-cursor MCP and shared-input limits.

## Reference

- [Restart ideas](reference/restart-ideas.md): historical candidate lessons; each requires current evidence before adoption.
- [Lightweight boards](../boards/README.md): separately maintained request/design input programs and their contracts.
- [Retired designs](../archive/2026-09-12-pi-harness/docs/architecture/README.md): historical contracts and provenance, separate from current product behavior.

## Ownership

Keep system boundaries, behavior, data contracts, constraints, quality attributes and design decisions here. Organize by independently changing features, and give each durable contract one owner that other documents link to. Implementation order and task progress belong in [work artifacts](../README.md#work-artifacts), code locations in [maps](../maps/README.md), and supported procedures and verification scope in [operations](../ops/README.md). Do not create detailed designs or empty component directories solely to fill this structure.

## Feature maintenance

Architecture is the authoritative source for agreed product behavior. Update the existing owning section when a feature changes; keep the current contract in place and use Git and work records for change history. A new independent feature gets a document only when its ownership and maintenance justify one, and its document is linked from this index.

A feature section describes the behavior and relevant failure/recovery conditions, data and permission boundaries, applicable environments and exclusions. Label its state at document or section level; separate implemented behavior from target/draft behavior when they share a document. State the verified scope separately from package, installed-host, live-service and other-platform acceptance. A navigation group or a `current` source section does not establish complete release acceptance.

Use stable headings so implementation and verification references can identify the owning section. Link shared policy to its existing owner; cross-layer features keep one behavior contract with links to the UI, host and engine boundaries. Shared UI principles own common presentation constraints; feature-local UI documents own their interactions. Provider/request or storage semantics remain with their behavior owners.

The [feature inventory](../../scripts/azrael-feature-contracts.json) connects preservation feature IDs to contract documents, implementation owners and executable checks. Identify the corresponding feature IDs or link the inventory from the owning section so the mapping can be reviewed in both directions. Keep registry `contract` values as repository file paths supported by the current runner; section links belong in documentation. Executable checks and detailed code locations remain with their existing owners, and repeated commands and execution evidence remain in operations and work records.

Feature maintenance and upstream acceptance follow [the Work playbook](../playbooks/work.md#기능-변경과-업데이트-보존) and [upstream preservation](shared/feature-preservation.md). Missing coverage remains explicit until registered and verified; documenting a feature does not register or test it automatically.
