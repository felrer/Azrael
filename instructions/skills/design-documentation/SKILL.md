---
name: design-documentation
description: Turn agreed requirements and design decisions into product and system behavior and structure, and create or update the owning design documents during design discussion or implementation preparation.
---

# Design Documentation

Write design documents so that someone who did not join the conversation can understand the intended behavior and structure, required conditions, and reasons for important decisions, and can implement, review, and change them. Check related documents and the existing implementation against the currently agreed requirements and design decisions.

Design documents contain the current agreed design rather than a change log. Someone unfamiliar with its history must be able to understand the current behavior and structure directly.

Use this skill directly when only documentation updates are requested. If design choices need to be developed together, use `design-collaboration` and continue documenting the agreed portions. This skill does not own overall work coordination or code implementation and verification procedures.

The same work record owns the requirements, options, open questions, and progress needed for a shared understanding; this skill puts the lasting agreed design in its existing owning documents. Do not make a shared-understanding document a mandatory prerequisite for planning. Agreed portions within the authorized scope may be documented before the full plan is finalized, but distinguish unresolved choices as proposals and do not treat documentation itself as execution approval or an additional review stage.

<a id="설명할-내용"></a>

## What to explain

Explain the problem, desired outcome, and constraints, and describe the main use cases as concrete behavior. Connect the meaning of the data, component responsibilities, states, and interactions that enable that behavior. Include failures and conflicts that affect the result and how they are handled.

For important decisions, record why the choice fits the goals and constraints. Explain alternatives and trade-offs that actually affected the judgment only as far as needed to avoid reopening the same choice.

<a id="구체성과-분량"></a>

## Specificity and length

Write enough that implementers need not arbitrarily decide important product behavior or responsibilities and reviewers can judge whether requirements are met. Clarify abstract descriptions that allow conflicting interpretations with examples, data shapes, state changes, or conditions.

Choose a structure suited to the content and explain only what is needed. Do not repeat internal details readily visible in code, lists of edits by file, or execution procedures.

<a id="최신-설계만-유지"></a>

## Keep only the current design

When incorporating a change, edit the owning sentences and sections directly, leaving only the design that is true after the change.

- Remove replaced behavior, discarded structures, and reversed decisions. Consult version control or necessary existing work records for history, and follow the project's retention system if one exists. Do not accumulate conversation history in another document when it has no retention purpose.
- Avoid change-process wording such as "correction", "previously", "no longer", or "superseded", and paragraphs appended by date. If the relationship to existing behavior matters, express it as a condition or constraint of the current design.
- Do not copy user responses, investigation steps, work progress, or implementation order. Explain current behavior and necessary reasons directly, without attaching "user decision", "confirmed", or conversation timestamps to every sentence.

<a id="상태-표시와-검증-근거"></a>

## Status and verification evidence

Apply the project's document status system (for example, `target`, `current`, `partial`) once per document or section. If implemented and target portions are mixed, separate them into sections. Do not append dates, verification status, or versions to every sentence or paragraph. Approval does not mean implementation, so keep unconfirmed portions in the target state.

Do not put verification commands, exit codes, hashes, artifact paths, or execution dates in design documents. Keep task-specific verification results in the existing work record and repeatable verification procedures in operational documents, linking to evidence when needed. Use the project's plan document or authorized conversation record as the work record; do not create a separate plan document just for verification evidence. Once implementation and verification are complete, update the section's status to match the scope actually confirmed.

<a id="문서-구성"></a>

## Document structure

Organize folders by major feature and group related design documents. Keep content understood and changed together in one document; do not create a folder or file for every detail. Split by feature when independently changing features become difficult to find or edit in a shared document.

Update the existing document that owns the content, and create new documents within the project's documentation structure. Define rules shared by several features in one place and link to them elsewhere.

<a id="반영-후-확인"></a>

## Check after updating

Check that the document agrees with approved requirements and related documents, and follow the project's documentation validation guidance. Check that statements made false by this change do not remain in other sections or documents, and that no change-process narrative or sentence-level status or date annotations have been introduced.

<a id="새로운-결정이나-변경이-필요할-때"></a>

## When a new decision or change is needed

If developing the design reveals a new choice, present a recommendation and its impact in the ongoing design discussion. Respect the user's existing decisions and explicitly delegated judgment, and do not arbitrarily finalize other choices. While waiting for an answer, continue documenting independently agreed portions.

If actual behavior differs from the design, establish which is the agreed baseline. Do not revise architecture to fit a fix and thereby justify removing or reducing functionality. Treat existing undocumented functionality as a design gap, and update the owning section after the behavior change is agreed.

Once decisions are settled, update the related design and open-question record; if an earlier premise changed, check affected documents and use cases together. Do not request approval again merely to document an existing agreement. If a different design decision is finalized during implementation, update the owning document in the same way.
