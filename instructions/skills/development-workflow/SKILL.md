---
name: development-workflow
description: Start work by investigating and writing one plan with questions, recommendations and verification when the goal is clear enough to plan. Carry the agreed work through execution and acceptance; use design-collaboration when linked user choices need iterative discussion.
---

# Development Workflow

Own the goal, scope, success criteria, unresolved decisions, work sequence, and final acceptance of a code-change task. Keep the work moving across investigation, design, and implementation without restarting the task at each transition.

The common work-entry instructions choose between this skill and `design-collaboration` after identifying conversational intent and authority. Complexity or code size alone does not determine the route. Use `design-documentation` for enduring agreed design and `implementation` for execution within existing authority; these responsibilities do not create mandatory separate stages.

## Work Plan Document

Manage shared understanding, requirements, decisions, execution and verification in a single `nn-plan.md`. Small work uses a short plan with only the necessary content; a plan does not itself add an approval wait when the work is already authorized and no consequential choice needs review. Do not require a separate understanding or requirements document first.

Write work plan documents in Korean. Keep code identifiers, file paths, and commands in their original form where needed.

Incorporate feedback and investigation findings about the same task into the current plan document instead of creating a new document. Create a new folder for a new target or a separate work session, and create the next numbered plan document for a distinct follow-up task in the same session. Store work plan documents in the location specified by the project, and use the [document creation tool](references/task-artifacts.md) to allocate new folders and file numbers.

Begin the document with a one-line status stating the current stage and what the user is expected to do next, such as awaiting requirement confirmation, awaiting plan approval, implementing, or completed with its verified scope. Update the status whenever the stage changes.

Include the problem and desired outcome, requirements and scope, current design and proposed differences, choices with recommendations and impact, the approach and dependencies, and success criteria with verification methods. Record requested deliverables and allowed actions alongside settled decisions and open questions so later turns and skill transitions preserve intent. Link enduring design rather than copying it. Put user questions near the beginning; announce the plan link and the key decision briefly in conversation so the questions are discoverable without duplicating them. Check ascertainable facts yourself and incorporate answers in place, removing resolved questions.

A decision is any choice that affects user-visible behavior, scope, compatibility, limits, resources, or authority. Carry forward choices the user has already made and resolve explicitly delegated choices within their stated bounds. Present remaining choices with the recommended option and its trade-off, even when the agent has a clear recommendation. Do not settle them by describing them as part of the implementation approach, and do not treat silence or lack of background knowledge as delegation.

Keep only currently valid content in the work plan document, and do not record user responses or the revision process as a separate history. Keep investigation evidence only to the extent needed for decisions in the plan, and refer to detailed logs or materials when needed instead of copying them into the document. Before appending new content, check whether an existing section can be revised or replaced, and remove duplicate or no longer valid statements.

## 1. Requirements

Identify the desired outcome, constraints, and priorities from the user's request and prior conversation, and write the success criteria. When the work changes an existing feature, first read the design documents that own it and write the requirements as changes from the current design, so that unchanged behavior remains explicit. Connect each success criterion to a verification method; when project or user instructions limit verification scope to improve work speed, choose methods within that scope. If there is not yet enough evidence to choose a method, complete it after code investigation. Surface decisions that require the user's input as questions, and do not settle requirements arbitrarily before receiving the answer.

If an open question could change the goal, scope, or direction enough to redirect the investigation, explain the choice and ask before pursuing dependent investigation. Continue independent work where useful. Otherwise, investigate the existing system first to ground the next decisions; do not require an initial questionnaire when the request already gives enough direction.

Apply **Platform Scope** in `CODEX_HOME/AGENTS.md` and the project's support contract when recording requirements. Connect success criteria to required platform verification in the same plan; keep small changes proportionate.

## 2. Feasibility Investigation

Inspect the actual code's call paths, owners, data and state contracts, and relevant tests to determine how the requirements could be implemented in the current structure. Review existing code, platform features, installed dependencies, and reusable libraries to determine what to change and what to reuse. When inspection cannot resolve a material uncertainty, use a narrowly scoped experiment and distinguish experimental findings from behavior verified in the product. Record established facts, unverified assumptions, and blocking conditions separately in the same plan document.

Compare applicable architecture with code, tests and observed behavior, distinguishing agreed/current contracts from draft proposals. Record the existing behavior, constraints and permissions that the change must preserve, including features not yet documented. An implementation different from specified architecture behavior, structure or contracts needs review before the affected implementation unless that difference is already approved. Missing or apparently stale documentation is not authority to remove a feature or rewrite the design to justify a fix.

Before plan review, investigate the affected boundaries enough to gather related decisions reasonably discoverable now, with recommendations, impacts and verification. Avoid deferring known decisions to execution. Label remaining uncertainty.

If the requirements cannot be met as stated, or only at a cost the user may not accept, present the feasible options and their trade-offs as a decision instead of choosing a compromise.

Use `design-collaboration` for unresolved product or system design choices within this work. Pass the existing goal, constraints, settled choices, delegated authority, relevant evidence, and remaining questions. Reuse the same plan and design owners without restarting requirements gathering or adding an approval stage. Investigation and design discussion may alternate as each exposes the next necessary question.

Keep the understanding and proposed changes needed for review in the same work record. As topics are settled, use `design-documentation` to update the enduring owning sections within authorized scope. This does not require a separate understanding document or another approval stage. Recommendations remain proposals until settled; check consistency with the agreed plan before execution.

## 3. Confirm The Work Plan

Use the code investigation to add the implementation approach, main work sequence, applicable transition scope, and a verification method for each success criterion to the plan document. The `implementation` skill owns detailed execution preparation and verification choices; reference its applicable work rather than reproducing its procedures in this plan. Before presenting the plan, move unsettled choices in the approach that meet the definition of a decision into the decisions section. If the findings require a change outside the agreed goal, scope, constraints, success criteria, or delegated authority, ask the user and revise the plan.

Record the main dependencies, owners, outputs, downstream consumers and verification methods concisely in the existing plan. For long-running or connected assignments, retain concise actual timing, waiting and rerun evidence in the existing work record; do not create another plan, approval stage, detailed schedule for a small edit, or separate time-management document solely for this record. Root scheduling guidance owns execution ordering and resource coordination.

During planning, identify the authorization required for each task and when it is needed. Where sufficient information is available for the user to decide, obtain the necessary authorizations together before starting the related work, and reflect the authorized scope in the execution schedule. Confirm only new decisions or additional authority that arise from investigation.

Before implementation, check that the requirements, implementation approach, and success criteria are settled and execution is authorized. Present the concrete plan for confirmation when that authority is missing or the approach introduces a consequential choice outside the existing agreement. Carry forward authorization already given; do not request the same decisions or permission again merely because work moves from design to implementation. A design-only request or an answer to a design question does not itself authorize implementation. Reflect material changes in the same plan and confirm only the changed decisions or additional authority needed.

## 4. Update Design Documents

When the work changes product behavior, structure, or contracts, ensure the owning design documents reflect the agreed design before implementing the change. Use `design-documentation` for any remaining updates and reuse sections already completed during discussion. If no design document needs to change, state the reason in the plan document. Reflect the agreed target design without copying the plan's investigation process or user-response history.

## 5. Carry Execution Through Final Acceptance

Use `implementation` with the current plan, owning design documents, authorized scope, success criteria, and sufficient investigation evidence. It owns implementation, verification, cleanup, and execution evidence. This skill retains responsibility for the overall goal and final acceptance; using another skill does not hand off the user to a separate task or require a subagent.

If new evidence reveals an unapproved design deviation or another departure from the agreed scope, stop the affected implementation and put the evidence, alternatives and impact in the same plan for review of that difference only. Continue independent authorized work; do not restart the whole plan or reopen settled decisions. Feature deletion, hiding or disabling and weakened verification to evade an error are scope changes requiring prior review. Verify the corrected problem and preserved behavior separately, following `implementation`'s preservation guidance. Do not repeat sufficient checks without changed inputs, conflicting evidence or new risk.

Compare the execution results with every success criterion and the approved scope. Keep required cleanup, documentation consistency, and remaining uncertainty visible in the same plan. When normal-operation verification needs the user, apply implementation's [User confirmation and cleanup](../implementation/references/artifact-lifecycle.md#user-confirmation-and-cleanup): announce the minimal check/recovery bundle including backups, mark the task awaiting user confirmation with cleanup pending, and finish safe cleanup on clear confirmation without another cleanup request. Report completion only when the agreed goal is met and required work is finished; a successful implementation check alone does not establish whole-task completion. Record the final state and evidence links without copying detailed logs.
