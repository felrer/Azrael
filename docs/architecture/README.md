# Architecture

Each document or owning section labels its own state (see [document states](../README.md#document-state-and-ownership)). This index groups contracts by responsibility. Source implementation, native execution, package and installed-host acceptance have distinct scopes; the owning section determines preservation requirements.

## Host, storage and recovery

- [azrael-ex host and storage](azrael-ex.md): single-extension host, private state, local history import, session links, recent chats, native conversation/file actions and integration inputs.
- [Reload and resume recovery](reload-recovery.md): startup admission, pending input identity, connection recovery and durable resume behavior.

## Conversation execution and collaboration

- [Queued context compaction](queued-compaction.md): ordered compaction, execution thresholds, queue receipt ownership and progress.
- [Root resume scheduling](root-resume.md): durable reservations, completion signals, defer clocks and work-segment presentation.
- [Root coordination](root-coordination.md): root-only investigation, scheduling, resource ownership, waiting and intervention policy.
- [Task work time](task-work-time.md): continuous turn groups, user-wait exclusions, work boundaries and partial-history display.
- [Side questions with /btw](side-questions.md): tool-free side execution, main-task isolation and explicit result delivery.
- [Work orchestration](work-orchestration.md): draft/target Lead and Team design, isolated worktrees and handoff boundaries.

## Accounts, providers and models

- [Accounts and usage](accounts.md): authentication, account switching/retirement, usage windows, manual actions and multi-window leases.
- [Project usage value](project-usage.md): daily API-equivalent totals, model detail, contribution calendar and project comparisons.
- [Devin and mixed-provider agents](devin.md): native inference, tool contracts, catalog/agent selection and provider continuity.
- [Managed providers and provider switching](managed-providers.md): inference projection, model/reasoning controls, bounded tool discovery and handoff.
- [Provider context policy](context-policy.md): context capacities, compaction thresholds, pricing tiers and settings/gauge behavior.
- [Custom API models](custom-api-models.md): user-owned endpoints/models, protocol and tool discovery, picker/subagent selection and failure boundaries.
- [Provider brand assets](provider-brand-assets.md): original assets, provider identities, theme variants and refresh constraints.

## UI and prompt media

- [UI presentation](ui-presentation.md): native presentation, composer cleanup, drafts/flags, speed controls, settings, photos, typography and input diagnostics.
- [Prompt image preparation](prompt-image-preparation.md): shared image sizing, format/transparency preservation and provider preparation boundaries.

## Tools, authority and diagnostics

- [Computer Use backend](computer-use.md): package-owned desktop runtime, selected-window backend, tool ceiling, consent and lifetime.
- [Window Use](window-use.md): staged product authority, current-window/whole-desktop requirements, app approvals, capture, task macros and concurrency boundaries.
- [Window Use visualization](window-use-visualization.md): overlays, visible stop/recovery and target-specific observation/control presentation.
- [Auto-Review](auto-review.md): OpenAI permission policy, turn admission and reviewer boundary.
- [Diagnostic logging](diagnostic-logging.md): default-on diagnostic controls, optional instrumentation and mandatory evidence preservation.

## Runtime, distribution and preservation

- [Multi-platform runtime and maintenance](multi-platform.md): platform identity, OS/ABI boundaries, release maturity and environment-specific acceptance.
- [Instruction distribution and settings](instructions.md): maintained library, acquisition/integrity, application conflicts and protected settings.
- [Azrael runtime and providers](azrael-runtime.md): target runtime/provider architecture; existing implementation owners remain authoritative until each replacement boundary is accepted.
- [Upstream feature preservation](upstream-preservation.md): architecture-to-inventory connection, upgrade scope review and candidate-specific acceptance.

## Reference

- [Restart ideas](restart-ideas.md): historical candidate lessons; each requires current evidence before adoption.
- [Lightweight boards](../boards/README.md): separately maintained request/design input programs and their contracts.
- [Retired designs](../archive/2026-09-12-pi-harness/docs/architecture/README.md): historical contracts and provenance, separate from current product behavior.

## Ownership

Keep system boundaries, behavior, data contracts, constraints, quality attributes and design decisions here. Organize by independently changing features, and give each durable contract one owner that other documents link to. Implementation order and task progress belong in [work artifacts](../README.md#work-artifacts), code locations in [maps](../maps/README.md), and supported procedures and verification scope in [operations](../ops/README.md). Do not create detailed designs or empty component directories solely to fill this structure.

## Feature maintenance

Architecture is the authoritative source for agreed product behavior. Update the existing owning section when a feature changes; keep the current contract in place and use Git and work records for change history. A new independent feature gets a document only when its ownership and maintenance justify one, and its document is linked from this index.

A feature section describes the behavior and relevant failure/recovery conditions, data and permission boundaries, applicable environments and exclusions. Label its state at document or section level; separate implemented behavior from target/draft behavior when they share a document. State the verified scope separately from package, installed-host, live-service and other-platform acceptance. A navigation group or a `current` source section does not establish complete release acceptance.

Use stable headings so implementation and verification references can identify the owning section. Link shared policy to its existing owner; cross-layer features keep one behavior contract with links to the UI, host and engine boundaries. UI presentation owns appearance and interaction; provider/request or storage semantics remain with their behavior owners.

The [feature inventory](../../scripts/azrael-feature-contracts.json) connects preservation feature IDs to contract documents, implementation owners and executable checks. Identify the corresponding feature IDs or link the inventory from the owning section so the mapping can be reviewed in both directions. Keep registry `contract` values as repository file paths supported by the current runner; section links belong in documentation. Executable checks and detailed code locations remain with their existing owners, and repeated commands and execution evidence remain in operations and work records.

Feature maintenance and upstream acceptance follow [the Work playbook](../playbooks/work.md#기능-변경과-업데이트-보존) and [upstream preservation](upstream-preservation.md). Missing coverage remains explicit until registered and verified; documenting a feature does not register or test it automatically.
