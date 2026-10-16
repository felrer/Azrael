<a id="작업-문서"></a>

# Work Documents

The `Work directory: work` setting in the [documentation guide](../docs/README.md#work-artifacts) owns the storage location for work plans. Resolve relative paths from the project root.

Store new work plans in this folder. Create `01-plan.md`, `02-plan.md` and subsequent documents in a subfolder for each target and session, and update the current plan with that task's requirements, decisions, progress and verification results. Do not accumulate task lists or progress history in this README.

After the common entry guidance establishes current intent and authority, choose `design-collaboration` when linked choices need discussion, or `development-workflow` when investigation can produce a plan and questions. Keep shared understanding, differences from the current design, recommendations and impacts, preservation criteria and verification in the same work record. A short plan is enough for small work; changing skills does not add a separate document or approval stage. Put questions in the document and briefly announce its link and the key decision in the conversation.

Allocate folders and plan numbers using `work_artifacts.py` from the active `development-workflow` skill. Use the tool's default allocation rules unless the user specifies a category. Reuse the session path when continuing an existing session.

Preserve work records in earlier external storage locations at their existing paths. Changing the location for new plans does not move existing records. Keep original links when referencing existing documents.

Keep design, architecture and operational documents in their existing `docs/` categories. Use the locations defined by the project playbooks for build outputs and temporary execution logs.
