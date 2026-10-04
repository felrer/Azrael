---
name: planning
description: Align user and agent goals for code changes, maintain a code-grounded work plan, and carry the agreed work through design, implementation, and verification.
---

# Planning

This skill defines the process for aligning the user's and agent's goals in code-change work and completing the work according to the agreed goal.

## Work Plan Document

When user confirmation is required, manage the task's requirements through its implementation and verification results in a single work plan document. Name the work plan document `nn-plan.md`.

Write work plan documents in Korean. Keep code identifiers, file paths, and commands in their original form where needed.

Incorporate feedback and investigation findings about the same task into the current plan document instead of creating a new document. Create a new folder for a new target or a separate work session, and create the next numbered plan document for a distinct follow-up task in the same session. Store work plan documents in the location specified by the project, and use the [document creation tool](references/task-artifacts.md) to allocate new folders and file numbers.

Begin the document with a one-line status stating the current stage and what the user is expected to do next, such as awaiting requirement confirmation, awaiting plan approval, implementing, or completed with its verified scope. Update the status whenever the stage changes.

The core items of a work plan document are user requirements, questions or decisions needed, and each success criterion with its verification method. Place questions that require the user's answer near the beginning of the document and word them so the user can answer them directly. The agent checks facts that can be established by examining code or other sources instead of asking the user. Integrate matters settled by the user's answer into the relevant requirements or plan, and remove the resolved questions.

A decision is any choice that affects user-visible behavior, scope, compatibility, limits, resources, or authority. Present such a choice as a decision with the recommended option and its trade-off, even when the agent has a clear recommendation. Do not settle it by describing it as part of the implementation approach.

Keep only currently valid content in the work plan document, and do not record user responses or the revision process as a separate history. Keep investigation evidence only to the extent needed for decisions in the plan, and refer to detailed logs or materials when needed instead of copying them into the document. Before appending new content, check whether an existing section can be revised or replaced, and remove duplicate or no longer valid statements.

## 1. Requirements

Identify the desired outcome, constraints, and priorities from the user's request and prior conversation, and write the success criteria. When the work changes an existing feature, first read the design documents that own it and write the requirements as changes from the current design, so that unchanged behavior remains explicit. Connect each success criterion to a verification method; when project or user instructions limit verification scope to improve work speed, choose methods within that scope. If there is not yet enough evidence to choose a method, complete it after code investigation. Surface decisions that require the user's input as questions, and do not settle requirements arbitrarily before receiving the answer.

If an open question could change the goal, scope, or direction enough to redirect the investigation, present the requirements and questions and wait for the user's answers before an in-depth feasibility investigation. Limit earlier investigation to what is needed to understand the request and write precise questions. Otherwise, continue to the investigation and confirm the requirements together with the plan.

## 2. Feasibility Investigation

Inspect the actual code's call paths, owners, data and state contracts, and relevant tests to determine how the requirements could be implemented in the current structure. Review existing code, platform features, installed dependencies, and reusable libraries to determine what to change and what to reuse. When inspection cannot resolve a material uncertainty, use a narrowly scoped experiment and distinguish experimental findings from behavior verified in the product. Record established facts, unverified assumptions, and blocking conditions separately in the same plan document.

If the requirements cannot be met as stated, or only at a cost the user may not accept, present the feasible options and their trade-offs as a decision instead of choosing a compromise.

## 3. Confirm The Work Plan

Use the code investigation to add the implementation approach, main work sequence, migration and cleanup scope, and verification methods to the plan document. Use [execution preparation](references/implementation-plans.md) for the parts relevant to the change. Before presenting the plan, move choices in the approach that meet the definition of a decision into the decisions section. If the findings require a change to the user's goal, scope, constraints, or success criteria, ask the user and revise the plan.

Present the plan with its requirements and implementation approach to the user for confirmation before changing design documents or product code. Answers to questions settle those decisions but do not by themselves approve implementation. If an answer materially changes the plan, present the revised plan for confirmation.

## 4. Update Design Documents

When the confirmed plan changes product behavior, structure, or contracts, use the `designing` skill to update the owning design documents before implementing the change. If no design document needs to change, state the reason in the plan document. Reflect the agreed target design without copying the plan's investigation process or user-response history.

## 5. Implement, Verify, And Complete

Implement against the plan and relevant design documents, following the project's work and verification instructions. When implementation requires a departure from the plan, update the plan first. If the departure affects a decision, success criterion, or user-visible result, ask the user before continuing, and keep the design documents consistent with the confirmed result. Check each success criterion using the agreed method, and remove code, tests, and temporary paths made unnecessary by the change.

The work is complete when the success criteria have been checked, design documents match the implemented result, and the plan's status and final results are recorded. In the report, distinguish the scope and results actually verified from remaining unknowns.
