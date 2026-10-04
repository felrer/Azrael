# Project Documentation

Use this router to find the documents relevant to the task. These categories are a starting point, not a required
reading sequence.

| Category | Owns | Entry |
|---|---|---|
| `architecture/` | System structure, boundaries, behavior models, and significant design decisions | [Architecture](architecture/README.md) |
| `maps/` | Code locations, execution roles, and task-specific entry points | [Work maps](maps/README.md) |
| `playbooks/` | Work-type guidance, verification choices, maintenance, and closeout | [Project playbooks](playbooks/README.md) |
| `work/` | Classified work sessions and their task plans | [Work documents](work/README.md) |
| `ops/` | Repeatable development, verification, release, and operational procedures | [Operations](ops/README.md) |

Add detailed documents when there is real content to maintain, and link them from the appropriate category router.
Extend the categories when independently maintained feature, domain, UI, or flow documentation needs its own home.

## Route By Work

| Task | Start with |
|---|---|
| Locate an implementation, caller, or execution role | [Work maps](maps/README.md), or a direct lookup when the location is already known |
| Understand or change boundaries, interfaces, data meaning, or system behavior | [Architecture](architecture/README.md) and the relevant implementation owner |
| Set up, build, verify, release, operate, or recover the project | [Operations](ops/README.md) and the applicable component quickstart |
| Perform or verify substantive work | [Project playbooks](playbooks/README.md), then applicable operational owners |
| Prepare or update a work plan | Relevant owners and [Work Artifacts](#work-artifacts) |

## Document State And Ownership

Keep current implementation, intended design, and review proposals distinguishable. Use the project's established
status terms; when none exist, use these meanings for substantive documents or sections:

| State | Meaning |
|---|---|
| `draft` | A proposal under review |
| `target` | Intended behavior that is not established as implemented; record approval separately when relevant |
| `current` | Describes verified implementation or operational behavior |
| `partial` | Contains both implemented and intended behavior, explicitly separated by section |

Approval does not prove implementation. Use verified code or operational evidence for what exists, and the approved
design for intended changes. Label state once per document or section, not per sentence. Keep verification evidence
in the work plan or operational owner and link to it; do not add dated verification notes to design documents.

Give each durable contract one body owner. Routers and other documents should link to that owner with only the
context needed to choose it. Keep exact commands and changing runtime state out of indexes. One-time task progress
belongs in work artifacts rather than current architecture or repeatable procedures.

## Work Artifacts

- Work directory: docs/work

Use [Work documents](work/README.md) for category meanings, stable session identifiers, and usage rules. Individual work documents are not indexed here. Each task keeps its requirements, decisions, implementation plan, and verification results in one evolving `nn-plan.md` inside its classified session folder. Do not place work plans in architecture or ops.

The setting is authoritative: relative values resolve from the project root, including `work` outside `docs`; absolute paths may point outside the project. Navigation links are relative to their containing document and must match the setting. Use the work-artifact utility's configure operation to update the setting and navigation together; it does not move existing tasks.
