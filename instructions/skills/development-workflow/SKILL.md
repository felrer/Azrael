---
name: development-workflow
description: Coordinate code-change work that needs requirements, feasibility investigation, design decisions, or multiple phases. Maintain one work plan and carry the goal through implementation and final acceptance; use implementation directly for a small, clearly scoped change.
---

# Development Workflow

Own the goal, scope, success criteria, unresolved decisions, work sequence, and final acceptance of a code-change task. Keep the work moving across investigation, design, and implementation without restarting the task at each transition.

Use `design-collaboration` for unresolved design choices, `design-documentation` to maintain the agreed design, and `implementation` for execution preparation, code changes, verification, and cleanup. These are responsibilities used when needed, not mandatory sequential stages. A design-only request can start with `design-collaboration`; a small change with clear scope and authority can use `implementation` directly. Do not create a work plan merely to route either request through this skill.

## Work Plan Document

When user confirmation is required, manage the task's requirements through its implementation and verification results in a single work plan document. Name the work plan document `nn-plan.md`.

Write work plan documents in Korean. Keep code identifiers, file paths, and commands in their original form where needed.

Incorporate feedback and investigation findings about the same task into the current plan document instead of creating a new document. Create a new folder for a new target or a separate work session, and create the next numbered plan document for a distinct follow-up task in the same session. Store work plan documents in the location specified by the project, and use the [document creation tool](references/task-artifacts.md) to allocate new folders and file numbers.

Begin the document with a one-line status stating the current stage and what the user is expected to do next, such as awaiting requirement confirmation, awaiting plan approval, implementing, or completed with its verified scope. Update the status whenever the stage changes.

The core items of a work plan document are user requirements, questions or decisions needed, and each success criterion with its verification method. Place questions that require the user's answer near the beginning of the document and word them so the user can answer them directly. The agent checks facts that can be established by examining code or other sources instead of asking the user. Integrate matters settled by the user's answer into the relevant requirements or plan, and remove the resolved questions.

A decision is any choice that affects user-visible behavior, scope, compatibility, limits, resources, or authority. Carry forward choices the user has already made and resolve explicitly delegated choices within their stated bounds. Present remaining choices with the recommended option and its trade-off, even when the agent has a clear recommendation. Do not settle them by describing them as part of the implementation approach, and do not treat silence or lack of background knowledge as delegation.

Keep only currently valid content in the work plan document, and do not record user responses or the revision process as a separate history. Keep investigation evidence only to the extent needed for decisions in the plan, and refer to detailed logs or materials when needed instead of copying them into the document. Before appending new content, check whether an existing section can be revised or replaced, and remove duplicate or no longer valid statements.

## 1. Requirements

Identify the desired outcome, constraints, and priorities from the user's request and prior conversation, and write the success criteria. When the work changes an existing feature, first read the design documents that own it and write the requirements as changes from the current design, so that unchanged behavior remains explicit. Connect each success criterion to a verification method; when project or user instructions limit verification scope to improve work speed, choose methods within that scope. If there is not yet enough evidence to choose a method, complete it after code investigation. Surface decisions that require the user's input as questions, and do not settle requirements arbitrarily before receiving the answer.

If an open question could change the goal, scope, or direction enough to redirect the investigation, explain the choice and ask before pursuing dependent investigation. Continue independent work where useful. Otherwise, investigate the existing system first to ground the next decisions; do not require an initial questionnaire when the request already gives enough direction.

## 2. Feasibility Investigation

Inspect the actual code's call paths, owners, data and state contracts, and relevant tests to determine how the requirements could be implemented in the current structure. Review existing code, platform features, installed dependencies, and reusable libraries to determine what to change and what to reuse. When inspection cannot resolve a material uncertainty, use a narrowly scoped experiment and distinguish experimental findings from behavior verified in the product. Record established facts, unverified assumptions, and blocking conditions separately in the same plan document.

If the requirements cannot be met as stated, or only at a cost the user may not accept, present the feasible options and their trade-offs as a decision instead of choosing a compromise.

Use `design-collaboration` for unresolved product or system design choices within this work. Pass the existing goal, constraints, settled choices, delegated authority, relevant evidence, and remaining questions. Reuse the same plan and design owners without restarting requirements gathering or adding an approval stage. Investigation and design discussion may alternate as each exposes the next necessary question.

As meaningful topics are settled, use `design-documentation` to update their owning sections within the authorized documentation scope, even while other design topics remain open. Keep unresolved questions in the existing plan and detailed design in its owner; link them rather than copying either. Recommendations and dependent drafts remain proposals until settled. Complete the agreed design scope and check cross-document consistency before treating the implementation approach as ready.

## 3. Confirm The Work Plan

Use the code investigation to add the implementation approach, main work sequence, applicable transition scope, and a verification method for each success criterion to the plan document. The `implementation` skill owns detailed execution preparation and verification choices; reference its applicable work rather than reproducing its procedures in this plan. Before presenting the plan, move unsettled choices in the approach that meet the definition of a decision into the decisions section. If the findings require a change outside the agreed goal, scope, constraints, success criteria, or delegated authority, ask the user and revise the plan.

Before implementation, check that the requirements, implementation approach, and success criteria are settled and execution is authorized. Present the concrete plan for confirmation when that authority is missing or the approach introduces a consequential choice outside the existing agreement. Carry forward authorization already given; do not request the same decisions or permission again merely because work moves from design to implementation. A design-only request or an answer to a design question does not itself authorize implementation. Reflect material changes in the same plan and confirm only the changed decisions or additional authority needed.

## 4. Update Design Documents

When the work changes product behavior, structure, or contracts, ensure the owning design documents reflect the agreed design before implementing the change. Use `design-documentation` for any remaining updates and reuse sections already completed during discussion. If no design document needs to change, state the reason in the plan document. Reflect the agreed target design without copying the plan's investigation process or user-response history.

## 5. Carry Execution Through Final Acceptance

Use `implementation` with the current plan, owning design documents, authorized scope, success criteria, and sufficient investigation evidence. It owns implementation, verification, cleanup, and execution evidence. This skill retains responsibility for the overall goal and final acceptance; using another skill does not hand off the user to a separate task or require a subagent.

If execution reveals a departure, update the same plan and resolve only choices or authority outside the existing agreement. Continue independent authorized work, and use the design skills when a revised contract needs discussion or documentation. Do not repeat completed investigation or verification unless changed inputs, insufficient coverage, conflicting evidence, or integration risk warrants it.

Compare the execution results with every success criterion and the approved scope. Keep required cleanup, documentation consistency, and remaining uncertainty visible in the same plan. Report completion only when the agreed goal is met and required work is finished; a successful implementation check alone does not establish whole-task completion. Record the final state and evidence links without copying detailed logs.
