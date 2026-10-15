---
name: project-bootstrap
description: "Create or align project documentation entry points, configurable work locations, and guidance routing to the installed implementation skill with app logging and artifact lifecycle/migration playbooks included by default. Use when explicitly bootstrapping or normalizing a project. Do not generate application scaffolding, detailed designs, or task plans."
---

# Project Bootstrap

Create or align the minimum documentation structure that helps users review work and agents find applicable project guidance. Infer project facts from evidence; do not assume a stack or workflow.

Use [the copy-ready template](assets/project-template/) as the canonical tree:
- `AGENTS.md` and `docs/README.md`.
- `docs/architecture/README.md`, `docs/maps/README.md`, and `docs/ops/README.md`.
- `docs/playbooks/README.md` and `docs/work/README.md`.

## Copy Or Align

Inspect existing project instructions, all seven target paths, and their parent paths before writing. If no target exists and all parents are absent or directories, copy the template tree preserving relative paths. Otherwise preserve existing content and add only missing files or routing information. Do not bulk-overwrite, move existing documents, or replace conflicting structures without the required scope decision.

Use English for templates and new routing guidance; preserve existing prose and tone. Reuse existing category owners through links. Preserve architecture organization by independently evolving target and architectural concern, and its exclusion of implementation plans. Use `maps` and `ops` in new structures.

Routers must have meaningful purposes and link only existing documents. Keep commands, runtime state, and detailed contracts in their owners. Do not fabricate content to fill categories.

## Work Documents

For new projects, configure exactly one `Work directory: docs/work` bullet under `## Work Artifacts` in `docs/README.md`. This setting is the location authority: relative paths are project-root-relative, and absolute external paths are allowed. Markdown links are navigation and are resolved relative to their containing document.

Create the work README during bootstrap but no tasks or example categories. It owns category meanings and usage rules, not a task/document index. Each classified folder such as `AA-08-title/` holds one work session for a specific target, with one evolving numbered plan (`01-plan.md`, `02-plan.md`, …) per task; categories can advance independently to `AB-01`. Plan content, work progress, decisions, and final acceptance belong to the development-workflow skill; do not restate them in project documents.

Use [the work utility](../development-workflow/scripts/work_artifacts.py) for deterministic creation, reuse, resolution, and configured location changes. Read [its compact usage contract](../development-workflow/references/task-artifacts.md) only when invoking it. Do not reproduce allocation logic in the skill or manually calculate paths.

When a new project requests a different work location, place the work README there and configure that location, updating navigation links accordingly. The default template can be staged before configuration; leave no competing unused default work README. For an existing project, the utility's configure operation changes the setting and work-README navigation links only; it does not move task history. Preserve existing destinations and legacy conventions unless changing them is authorized. Clarify whether moving existing files is in scope separately from changing where new work goes.

## Project Playbooks

The playbook router gives short applicability descriptions so agents select only matching guidance by work type. Read linked ops sections only when the chosen work needs them; do not preload every playbook or its references. Root instructions should route to it, not inline every playbook. Applicable guidance covers how work is performed, verified, and finished; exact supported commands remain in `ops/` or established owners and are linked.

Route common execution preparation, implementation, verification, and cleanup guidance to the installed [implementation skill](../implementation/SKILL.md). Do not copy a common Work body into new projects. Preserve existing project-specific Work rules and their owners. Common work-entry guidance chooses `design-collaboration` for linked choices needing iterative discussion or `development-workflow` to write a plan with questions and recommendations. `design-documentation` records enduring agreed design; `implementation` executes the resulting plan within existing authority. Small work uses a proportionate short plan, and transitions retain the same record without extra approval stages. Include architecture and existing-behavior preservation in the routing instead of duplicating the common procedure.

Include the [App logging and error diagnosis playbook](assets/playbooks/app-logging.md) by default when bootstrapping or aligning a project, unless the user explicitly limits the task to exclude playbook content. Read the bundled source; no personal Vault or external source is required. This default is part of bootstrap scope; do not request separate import approval.

Also include the [Artifact lifecycle and migration playbook](assets/playbooks/artifact-lifecycle.md) by default under the same scope rule. Read the bundled source and import it as `docs/playbooks/artifact-lifecycle.md`, or merge missing applicable guidance into an existing equivalent owner. Preserve valid local policies and configured paths; register that owner without creating a duplicate body. Record the source identifier `Azrael/instructions/skills/project-bootstrap/assets/playbooks/artifact-lifecycle.md`, revision or import date and meaningful local adaptations in the playbook maintenance section.

The lifecycle owner covers generated work/run, version and shared groups, registration before commands, raw-log/release-evidence ownership, model delete/defer review, and phased migration of existing producers/readers. Make the relevant document and playbook routers discover it. Document paths as defaults or verified configured equivalents; do not imply existing writers already use them. Bootstrap creates no runtime directories, manifests, application code or management configuration, and does not bulk-move existing artifacts. Actual adoption/migration follows the playbook within the current task's authority, without a new approval stage for already authorized steps.

Without an equivalent logging owner, import its source as `docs/playbooks/app-logging.md` and adapt it to verified project constraints and existing documentation, testing, and deployment owners. If equivalent guidance exists, compare it with the common source, preserve valid local constraints, and integrate only missing applicable guidance into the existing owner. Do not create a duplicate body or silently replace conflicting project policy; resolve material conflicts within the user's authorized scope.

Register both default owners and any preserved project-specific guidance in `docs/playbooks/README.md`. App logging applies to a new app's initial implementation, logging changes, and diagnosis where missing logs prevent tracing a cause. General implementation only checks whether existing logs trace failures in changed paths; apply logging improvements only within the approved plan. Preserve or adapt existing local Work links to the resulting logging owner. Update the template's empty-registration notice when registering the owners. Record the source identifier `codex-efficient-subagents/skills/project-bootstrap/assets/playbooks/app-logging.md`, source revision or import date, and meaningful local adaptations in the project's playbook maintenance section. Runtime diagnostic-log retention remains with the logging owner; generated test/build logs follow the lifecycle owner. Do not fabricate operational links or commands when a project has no corresponding owner.

Import other common playbooks only when relevant and in scope. Project copies are locally maintained; do not automatically overwrite them from common sources or write project-specific changes back upstream. On subsequent bootstrap runs, compare before editing and avoid duplicate rules, registrations, or provenance entries.

Improve common sources only within an authorized editing task, extracting reusable lessons without carrying project-specific assumptions. If a source is unavailable, report that limitation and complete independent bootstrap work.

## Verification And Completion

Check that all seven entry points exist or route through agreed existing equivalents, links resolve, configured destinations agree, and empty-registration notices match reality. Verify that work-document rules describe one evolving numbered plan per task, consistent with the development-workflow skill, and that playbooks route to operational owners without duplicating commands.

Verify that the router identifies the installed implementation skill as the common execution owner, preserves project-specific Work guidance, and contains no duplicate common Work import. Verify that app logging and artifact lifecycle/migration guidance are present in their imported files or equivalent existing owners; check their registrations, relevant router links, provenance and local adaptations. Preserve any existing local Work logging links. Check the lifecycle playbook's new-project and existing-adoption cases as documentation acceptance; report actual writer/reader migration separately. Report explicit scope exclusions, unavailable sources, or unresolved policy conflicts instead of claiming the default inclusion is complete.

Do not create application code, runtime configuration, detailed architecture, code maps, operational procedures, task artifacts, or placeholder files just to complete bootstrap. Use applicable existing documentation checks; do not add a validator solely for bootstrap.

Report changed entry points, preserved conventions, any imported playbooks and adaptations, validation results, and unresolved decisions.
