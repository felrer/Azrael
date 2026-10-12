---
name: development-workflow
description: Coordinate code-change work that needs requirements, feasibility investigation, design decisions, or multiple phases. Maintain one work plan and carry the goal through implementation and final acceptance; use implementation directly for a small, clearly scoped change.
---

# Development Workflow

Own the goal, scope, success criteria, unresolved decisions, work sequence, and final acceptance of a code-change task. Keep the work moving across investigation, design, and implementation without restarting the task at each transition.

Use `design-collaboration` for unresolved design choices, `design-documentation` to maintain the agreed design, and `implementation` for execution preparation, code changes, verification, and cleanup. These are responsibilities used when needed, not mandatory sequential stages. A design-only request can start with `design-collaboration`; a small change with clear scope and authority can use `implementation` directly. Do not create a work plan merely to route either request through this skill.

## Decide Whether A Work Plan Is Needed

When the user requests work, first inspect the relevant owning design (such as `architecture`), its document state, and the affected implementation enough to compare the requested result with the existing contract. Use this comparison, unresolved user decisions and execution dependencies to choose between a written plan and direct implementation; code size alone does not determine the route.

- Use one written work plan when applicable design must change, user review is needed, or connected phases need a shared record of scope, decisions and acceptance.
- Use `implementation` directly for a small, clearly scoped, authorized change that follows the applicable design and has no consequential unresolved user decision. Keep its concise evidence in the conversation or existing work record.
- A design-only request may remain in its existing design discussion and owning document. Do not require a separate implementation plan just to discuss design.

An implementation that differs from the owning architecture's specified behavior, structure or contracts requires user review before the affected implementation. Present the current design, proposed difference, reason, recommendation, alternatives and impact in the same plan. Do not dismiss the difference as an internal choice or silently declare the design obsolete. A detail the design does not specify is not itself a deviation; resolve consequential choices by the ordinary decision criteria below. Reuse explicit prior approval for the difference instead of requesting it again. If the user declines a plan file, retain the same review content in the conversation; this does not waive review.

## Work Plan Document

For work that needs a written plan, manage shared understanding, requirements, proposed design changes, implementation and verification results in a single `nn-plan.md`. Do not require a separate requirements, understanding or pre-plan document before this plan.

Write work plan documents in Korean. Keep code identifiers, file paths, and commands in their original form where needed.

Incorporate feedback and investigation findings about the same task into the current plan document instead of creating a new document. Create a new folder for a new target or a separate work session, and create the next numbered plan document for a distinct follow-up task in the same session. Store work plan documents in the location specified by the project, and use the [document creation tool](references/task-artifacts.md) to allocate new folders and file numbers.

Begin the document with a one-line status stating the current stage and what the user is expected to do next, such as awaiting requirement confirmation, awaiting plan approval, implementing, or completed with its verified scope. Update the status whenever the stage changes.

Include the problem and intended result, requirements and scope, applicable current design and proposed differences, unresolved decisions with recommendations and impact, the main implementation approach and dependencies, and success criteria with verification methods. These contents establish shared understanding as well as executable scope; scale detail to the task. Link to enduring design owners rather than copying their full contents. Place questions that require the user's answer near the beginning of the document and word them so the user can answer them directly. The agent checks facts that can be established by examining code or other sources instead of asking the user. Integrate matters settled by the user's answer into the relevant requirements or plan, and remove the resolved questions.

A decision is any choice that affects user-visible behavior, scope, compatibility, limits, resources, or authority. Carry forward choices the user has already made and resolve explicitly delegated choices within their stated bounds. Present remaining choices with the recommended option and its trade-off, even when the agent has a clear recommendation. Do not settle them by describing them as part of the implementation approach, and do not treat silence or lack of background knowledge as delegation.

Keep only currently valid content in the work plan document, and do not record user responses or the revision process as a separate history. Keep investigation evidence only to the extent needed for decisions in the plan, and refer to detailed logs or materials when needed instead of copying them into the document. Before appending new content, check whether an existing section can be revised or replaced, and remove duplicate or no longer valid statements.

## 1. Requirements

Identify the desired outcome, constraints, and priorities from the user's request and prior conversation, and write the success criteria. When the work changes an existing feature, first read the design documents that own it and write the requirements as changes from the current design, so that unchanged behavior remains explicit. Connect each success criterion to a verification method; when project or user instructions limit verification scope to improve work speed, choose methods within that scope. If there is not yet enough evidence to choose a method, complete it after code investigation. Surface decisions that require the user's input as questions, and do not settle requirements arbitrarily before receiving the answer.

If an open question could change the goal, scope, or direction enough to redirect the investigation, explain the choice and ask before pursuing dependent investigation. Continue independent work where useful. Otherwise, investigate the existing system first to ground the next decisions; do not require an initial questionnaire when the request already gives enough direction.

For projects with multiple supported or intended target platforms, classify each requirement as common across the support policy's platform set, scoped to named environments, mixed, or unresolved before choosing implementation scope. For scoped or mixed requirements, specify targets, exclusions and user-visible differences; separate common meaning from platform-specific implementation. Include OS, CPU architecture, version/ABI, local or remote execution, and desktop conditions only where they affect behavior. Keep intended support separate from verified current support.

Distinguish requested targets, implementation ownership, regression impact and actually tested environments. An unspecified platform does not imply current-host-only scope. Investigate facts first; resolve consequential unresolved changes to support, behavior or permissions with a recommendation and its impact in the existing work. Reuse settled decisions and authorization, update the same record when scope changes, and connect success criteria to required platform verification. For small changes, keep a concise record without creating another plan or approval stage solely for this check.

## 2. Feasibility Investigation

Inspect the actual code's call paths, owners, data and state contracts, and relevant tests to determine how the requirements could be implemented in the current structure. Review existing code, platform features, installed dependencies, and reusable libraries to determine what to change and what to reuse. When inspection cannot resolve a material uncertainty, use a narrowly scoped experiment and distinguish experimental findings from behavior verified in the product. Record established facts, unverified assumptions, and blocking conditions separately in the same plan document.

Before asking for plan review, investigate the affected design/implementation boundaries far enough to identify decisions reasonably discoverable at this stage, including architecture deviations and execution authority. Present related choices together in a reviewable plan instead of approving an incomplete approach and deferring known decisions to execution. An uncertainty that can redirect investigation may still need an earlier answer; continue independent investigation while awaiting it. Label remaining uncertainty rather than promising that execution cannot reveal new information.

If the requirements cannot be met as stated, or only at a cost the user may not accept, present the feasible options and their trade-offs as a decision instead of choosing a compromise.

Use `design-collaboration` for unresolved product or system design choices within this work. Pass the existing goal, constraints, settled choices, delegated authority, relevant evidence, and remaining questions. Reuse the same plan and design owners without restarting requirements gathering or adding an approval stage. Investigation and design discussion may alternate as each exposes the next necessary question.

Keep proposed changes and the understanding needed to review them in the same plan. As topics are settled, use `design-documentation` to update the enduring owning sections within the authorized documentation scope. This records agreed design without adding another understanding document or approval stage. Recommendations and dependent drafts remain proposals until settled. Check consistency between the agreed design and plan before treating the implementation approach as ready.

## 3. Confirm The Work Plan

Use the code investigation to add the implementation approach, main work sequence, applicable transition scope, and a verification method for each success criterion to the plan document. The `implementation` skill owns detailed execution preparation and verification choices; reference its applicable work rather than reproducing its procedures in this plan. Before presenting the plan, move unsettled choices in the approach that meet the definition of a decision into the decisions section. If the findings require a change outside the agreed goal, scope, constraints, success criteria, or delegated authority, ask the user and revise the plan.

Record the main dependencies, owners, outputs, downstream consumers and verification methods concisely in the existing plan. For long-running or connected assignments, retain concise actual timing, waiting and rerun evidence in the existing work record; do not create another plan, approval stage, detailed schedule for a small edit, or separate time-management document solely for this record. Root scheduling guidance owns execution ordering and resource coordination.

During planning, identify the authorization required for each task and when it is needed. Where sufficient information is available for the user to decide, obtain the necessary authorizations together before starting the related work, and reflect the authorized scope in the execution schedule. Confirm only new decisions or additional authority that arise from investigation.

Before implementation, check that the requirements, implementation approach, and success criteria are settled and execution is authorized. Present the concrete plan for confirmation when that authority is missing or the approach introduces a consequential choice outside the existing agreement. Carry forward authorization already given; do not request the same decisions or permission again merely because work moves from design to implementation. A design-only request or an answer to a design question does not itself authorize implementation. Reflect material changes in the same plan and confirm only the changed decisions or additional authority needed.

## 4. Update Design Documents

When the work changes product behavior, structure, or contracts, ensure the owning design documents reflect the agreed design before implementing the change. Use `design-documentation` for any remaining updates and reuse sections already completed during discussion. If no design document needs to change, state the reason in the plan document. Reflect the agreed target design without copying the plan's investigation process or user-response history.

## 5. Carry Execution Through Final Acceptance

Use `implementation` with the current plan, owning design documents, authorized scope, success criteria, and sufficient investigation evidence. It owns implementation, verification, cleanup, and execution evidence. This skill retains responsibility for the overall goal and final acceptance; using another skill does not hand off the user to a separate task or require a subagent.

If execution reveals a departure, stop the affected implementation, update the same plan with the new evidence and changed decision, and obtain review for an unapproved architecture deviation or other choice outside the existing agreement. Continue independent authorized work. Do not restart the whole plan or repeat settled approvals; use the design skills within the same work when the changed contract needs discussion or documentation. Do not repeat completed investigation or verification unless changed inputs, insufficient coverage, conflicting evidence, or integration risk warrants it.

Compare the execution results with every success criterion and the approved scope. Keep required cleanup, documentation consistency, and remaining uncertainty visible in the same plan. Report completion only when the agreed goal is met and required work is finished; a successful implementation check alone does not establish whole-task completion. Record the final state and evidence links without copying detailed logs.
