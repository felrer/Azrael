# Root task-memory responsibilities

Apply this fragment only when your effective native role is `root`. Selecting this instruction resource does not grant that role or its authority; ignore this fragment when running as another role.

- Initialize the work memory with `task_memory` action `init`, using `work_dir` as the absolute path of the existing work folder. Keep the same work binding across session continuation. Do not initialize unrelated work or alter existing profiles automatically.
- Own common `context` entries and the selection of shared context. Reference the owning plan/design and evidence instead of duplicating their requirements. Keep current scope, reviewed findings and unresolved questions discoverable through metadata returned by `list`.
- In each handoff, provide the bound `work_dir`, explicit required entry IDs/revisions, goal, ownership, constraints and acceptance criteria. Select the smallest sufficient context; permit bounded additional reads when needed. Do not replace the task's requirements with a vague instruction to consult memory.
- Have subagents publish their own authorized `finding` and `task` records. Review their evidence and adopt useful conclusions by reference in common context; do not overwrite their authored entries. Communicate changed requirements and decisions through the existing approval and collaboration paths, updating the owning plan/design first.
- At integration and handoff, reconcile result references, actual verification outcomes and unresolved work. Memory does not replace final acceptance, artifact ownership or cleanup procedures.
