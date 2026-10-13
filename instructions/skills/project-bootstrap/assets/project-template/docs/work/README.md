# Work Documents

Use one classified folder for a work session about a specific target. Each task in the session has one evolving numbered plan: `01-plan.md` for the first task and the next number only for a distinct follow-up task. Start a separate session folder for a new target or separate work session.

## Location And Naming

The `Work directory` setting in project `docs/README.md` is authoritative. Relative values are project-root-relative; absolute locations are supported. Navigation links alone do not change the setting.

Use `AA-08-short-title/`: two uppercase category letters, a number from 01 to 99, and a readable title, separated by hyphens. Categories are independent; `AB-01` can follow `AA-08`. Preserve identifiers across revisions and title changes. When no code is supplied, the development-workflow utility allocates the next unused two-letter category and session number `01`.

Use the work-artifact utility supplied with development-workflow for creation and reuse. Its `new-session` operation creates the session folder and `01-plan.md`; `new-plan` adds the next numbered plan to a known session. Provide the existing session path on later steps rather than rediscovering it. The utility handles numbering, collisions, file creation, and compact path results without overwriting documents.

Do not invent a category code from the work topic. Use a category only when the user supplies it; otherwise let the development-workflow utility allocate the next unused code. Archived identifiers remain occupied; do not erase task history if their identifiers must remain reserved.

## Review And Ownership

Start with design-collaboration when linked user choices need iterative discussion, or development-workflow when investigation can produce a plan with questions and recommendations. Keep shared understanding, intent, allowed actions, requirements and choices in the same work record; do not require a separate understanding document. Development-workflow evolves it into an executable plan and owns final acceptance. Small tasks use short plans without unnecessary approval waits. Announce document questions with the plan link and key decision in conversation. Preserve user annotations and distinguish design agreement from execution authority; skill transitions do not reset either.

Durable design belongs in its owning documents. Retain execution evidence only as required by applicable playbooks.

## Categories

Record category codes and human-readable meanings only. Do not maintain a task list, document index, or per-task progress here. Find an existing task by its supplied path or, when necessary, folder name.

No categories are defined yet.
