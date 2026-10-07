# Project Playbooks

Select the applicable guidance for the current work type. Read the router's short applicability entries first, then only the matching playbooks. Open linked owner sections only when the task needs their detail; do not preload references. Reuse guidance already read in the current task unless it changes or a concrete gap requires another section.

Playbooks define work principles, maintenance expectations, verification choices, and completion or cleanup requirements. Supported commands and repeatable operational procedures remain in [Operations](../ops/README.md) or their established owners.

The installed `implementation` skill owns common execution preparation, implementation, verification, and cleanup rules. Apply it together with the matching project playbooks; keep project constraints here without copying the common skill body.

## Using And Maintaining Playbooks

For each registered playbook, describe when it applies and link its document. Individual playbooks contain only useful guidance: applicability, work principles, relevant procedures, verification evidence, and closeout.

Determine suitable verification for each task using applicable project guidance. Verification may be a targeted test, document comparison, visual inspection, data check, or experiment evaluation. If no playbook applies, use established project practice and the smallest relevant evidence; missing guidance does not automatically block ordinary work.

Record common-source provenance and revision or date when importing a playbook, adapt it to the project, and link verified operational procedures. Maintain local adaptations deliberately; do not automatically overwrite them when a common source changes.

Improve guidance from demonstrated needs. Promote reusable lessons to common sources only in an authorized task, excluding project-specific assumptions. Define retention or cleanup for temporary artifacts when applicable.

- [Work](work.md): Applies to implementation, fixes, refactoring, migration, verification, and retirement cleanup; adds Azrael owner routes, project verification constraints, and task-level commits to `implementation`.
- [App logging and error diagnosis](app-logging.md): Applies to a new app's initial logging, work that adds or changes logging, and diagnosis where missing logs prevent tracing a cause.
- [Build and reinstall](build.md): Applies to project-local engine/bridge/VSIX generation, delegated validation, local installation, updates, rollback and artifact cleanup.

## Source Maintenance

Work originated from `project-playbooks/work.md`, aligned on 2026-09-29. Its common execution body is now owned by the installed `implementation` skill; the local playbook maintains Azrael constraints, owner links, and task-level commit policy. App logging is imported from `project-playbooks/app-logging.md`, aligned on 2026-09-29, and maintained locally. Local adaptations preserve the configured external work location and defer plan allocation to the active planning skill. No source-specific runtime or deployment commands are introduced.
