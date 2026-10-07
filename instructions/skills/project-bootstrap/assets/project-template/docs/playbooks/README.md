# Project Playbooks

Select the applicable guidance for the current work type. Read the router's short applicability entries first, then only the matching playbooks. Open linked owner sections only when the task needs their detail; do not preload references. Reuse guidance already read in the current task unless it changes or a concrete gap requires another section.

Playbooks define work principles, maintenance expectations, verification choices, and completion or cleanup requirements. Supported commands and repeatable operational procedures remain in [Operations](../ops/README.md) or their established owners.

## Using And Maintaining Playbooks

For each registered playbook, describe when it applies and link its document. Individual playbooks contain only useful guidance: applicability, work principles, relevant procedures, verification evidence, and closeout.

Determine suitable verification for each task using applicable project guidance. Verification may be a targeted test, document comparison, visual inspection, data check, or experiment evaluation. If no playbook applies, use established project practice and the smallest relevant evidence; missing guidance does not automatically block ordinary work.

Record common-source provenance and revision or date when importing a playbook, adapt it to the project, and link verified operational procedures. Maintain local adaptations deliberately; do not automatically overwrite them when a common source changes.

Improve guidance from demonstrated needs. Promote reusable lessons to common sources only in an authorized task, excluding project-specific assumptions. Define retention or cleanup for temporary artifacts when applicable.

## Installed Skill Owners

Use the installed `development-workflow` skill to lead complex code work and final acceptance, `design-collaboration` for unresolved design choices, `design-documentation` for agreed design documents, and `implementation` for execution preparation, implementation, verification, and cleanup. These are responsibilities selected as needed, not mandatory sequential stages. Clear, small changes can use `implementation` directly. Reuse existing decisions, records, and authority without a separate plan or approval stage.

Common implementation rules belong to the installed `implementation` skill; do not import a duplicate Work body. Preserve and register existing project-specific Work or design-discussion guidance as local constraints.

## Project Playbook Registration

No project playbooks are registered yet. During bootstrap, register the imported or existing app logging owner and any existing project-specific owners here, then remove this empty-registration notice. App logging applies to a new app's initial implementation, logging changes, and diagnosis where missing logs prevent tracing a cause; other work checks existing logs on changed paths and follows the approved plan for improvements.
