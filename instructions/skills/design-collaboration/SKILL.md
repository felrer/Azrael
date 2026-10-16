---
name: design-collaboration
description: Start work that needs multiple turns of discussion because the user's answers change the direction of subsequent choices. Explain recommendations and impacts while developing the design in the same work record. Use development-workflow when the goal is clear enough to produce a plan and questions directly.
---

# Design Collaboration

Use this skill to explore product and system direction and detailed behavior with the user and complete the full design for the agreed scope in documents. It applies to designing from scratch or resolving open design for features added to or changed in an existing project. Do not apply the full procedure to simple wording edits in an already settled design.

The goal extends beyond answering the user's listed items: help them understand necessary decisions and find missing topics to produce a connected design. The full design scope is defined by agreed goals and use cases, not every possible feature.

Read [Team Lead guidance](references/team-lead.md) only when the current session is explicitly created or designated as a Team **Lead**. Ordinary design sessions and execution workers do not acquire the Lead role through inherited conversation or merely reading that reference. A Lead reuses the common design principles below and follows that reference for execution handoff and role boundaries.

<a id="1-기존-작업과-연결"></a>

## 1. Connect with existing work

- Start design-only requests with this skill and make the completed design documents the deliverable. Do not first demand an implementation plan that cannot yet be settled.
- For ongoing development, carry forward existing goals, constraints, decisions, authority, and records. Do not add a separate plan or approval stage or restart the work.
- Common work-entry guidance first establishes the conversation's goal, requested deliverable, permitted actions, settled decisions, and open questions. Mentioning a skill or a needed change does not switch the work into execution. Interpret "please improve this" during design as improving the design, and the same wording during approved implementation as improving that implementation within scope. Clarify only when context cannot resolve ambiguity that changes scope or authority.
- Choose this skill based on how choices are linked, rather than technical size. If one answer changes the next design choice, narrow the design through discussion; if investigation can establish an approach and questions together, `development-workflow` writes the plan directly. Continue in the same record if that judgment changes along the way.
- Use `design-documentation` to structure and maintain design documents. This skill owns what to decide together and which missing topics to address next.
- Distinguish agreement on design from authority to implement or deploy it. If implementation was requested and necessary decisions are settled, continue into implementation and verification of the existing work; `implementation` owns code execution rules.
- Use the existing owning locations in the project's documentation system for lasting design and the current work's open questions. Do not assume a particular folder or work record format.

<a id="2-시작할-때-전체-범위를-잡기"></a>

## 2. Establish the full scope at the start

First, briefly establish the user's goal, main users and use cases, constraints, and scope to complete this time. Reuse decisions already settled in conversation and documents, and do not ask the user for facts that investigation can establish. When designing changes to an existing product, first distinguish current behavior from the intended changes.

Maintain the following in the existing work record as needed. In development work using a work plan, record design choices there too; once the direction is settled, `development-workflow` develops that same record into an executable plan. Design-only work or short discussions may use an existing design record or authorized conversation. Follow project rules for record locations; do not create a separate preliminary shared-understanding document or empty design file.

- **Completion criteria:** Which use cases and boundaries must be explained for this design to be complete.
- **Design topics and owning documents:** Where settled portions, discussion topics, and portions depending on other decisions belong.
- **Open questions and next topics:** Questions requiring user judgment, facts to investigate, and the next important gaps to address.

If scope is still unclear, recommend a scope based on the user's goal and settle important boundaries together. Label temporary explanatory assumptions as assumptions; do not turn them into confirmed requirements because no answer arrived.

If a request about an existing project is clear enough to investigate, do not begin by asking the user to reconfirm the settled direction. Check the relevant implementation, reusable features, obtainable data, and constraints, then use that evidence to discuss the remaining choices. If an unresolved choice instead changes the investigation's direction, address it first. Move between investigation and design discussion as needed.

Distinguish agreed architecture contracts from draft proposals and compare them with existing code, tests, and actual behavior. Record the features, constraints, and authority to preserve after the change in the same record; include undocumented features in preservation checks. If the implementation must differ from the stated design or functionality must be reduced, have the reasons, alternatives, and impacts reviewed before the related implementation. Do not treat deletion, hiding, disabling, or reduced verification to avoid errors as internal implementation choices.

<a id="3-사용자가-결정할-사항을-먼저-드러내기"></a>

## 3. Expose decisions the user must make first

Treat choices that change user experience, feature scope, priorities, data meaning and retention, access permissions, costs, or operational burden as matters requiring user judgment. Even if described technically, a choice with these effects is not an implementation detail to settle arbitrarily.

Distinguish the following:

| Category | Handling |
|---|---|
| Facts discoverable from existing material | Investigate directly and distinguish confirmed scope from uncertainty. |
| Internal structure that does not affect the agreed result | Check existing structure and reuse opportunities, then handle it. |
| Design choices requiring user judgment | Explain a recommendation and its impact, receive an answer, then finalize dependent design. |
| Choices explicitly delegated by the user | Decide within the delegated criteria and scope, and report the result and important reasons. |

Do not mix a recommendation into the text as settled behavior or finalize several subsequent decisions that assume it. While waiting for an answer, independent investigation, documentation of existing agreements, and option comparisons may continue. Present conditional drafts if needed, keeping them in proposal status.

<a id="4-방향을-제시하며-한-주제씩-논의하기"></a>

## 4. Guide the discussion one topic at a time

Do not assume the user has background knowledge. First recommend a direction suited to the goal, then explain only the concepts needed to understand the choice in plain language and concrete situations. Do not hand design responsibility to the user by merely listing options or asking broad questions.

Proceed through each topic in this order:

1. **Problem and impact:** Explain what must be decided now and how it affects actual use.
2. **Recommended direction:** Give the recommendation and reasons in light of current goals and constraints.
3. **Alternatives and trade-offs:** Compare genuinely feasible alternatives as needed, explaining benefits and costs of each. Do not invent alternatives with no comparison value.
4. **Decision question:** Ask briefly about the differences the user needs to judge. If one answer changes another question's premise, address the earlier decision first.
5. **Incorporate the answer:** Apply the decision when the answer is clear. Clarify specifically only when ambiguity could change the outcome or the answer conflicts with an existing agreement.

For example, when discussing list sharing, explain: "To reduce accidental edits, I recommend that invited people can initially view the list and the owner grants editing access. Letting everyone edit immediately speeds up collaboration but reduces control over changes. Which fits actual use?" This is more useful than asking the user to choose a permission model. Do not record the recommendation as a confirmed permission rule before the user answers.

Address only as much as the user can judge at once. Closely related questions may be grouped, but do not require answers to the entire design's question list at once. If the user expresses limited knowledge or uncertainty, add explanations and examples and make the goal-based recommendation more concrete. Do not interpret that as delegation of the choice.

<a id="5-합의-후에는-빠진-주제를-찾아-이어가기"></a>

## 5. Find and continue with missing topics after agreement

Once a topic is settled, update its owning document and the open-question list, then raise the next important gap in the current design. Do not wait for the user to invent the next question or end every turn by asking whether anything else is needed.

Choose the next topic based on its effect on other design, whether it is a prerequisite, and the cost of getting it wrong. Explain why it needs attention now and recommend a direction. Finding a new topic does not automatically expand feature scope. Distinguish required omissions within the agreed scope from optional extensions, and propose any scope change first.

Trace use cases from start to finish and check for omissions from the perspectives below. Not every item applies to every task or needs a separate document.

- **User flow:** Entry conditions, normal processing, completion state, cancellation, editing, retrying, and user actions for empty and error states.
- **Data and state:** Creation and ownership, value meaning and lifetime, storage, changes, deletion, duplicates, concurrent changes, and recovery.
- **Responsibilities and connections:** Component roles, boundaries and interfaces, external dependencies, and failure propagation.
- **Permissions and protection:** Who can view and change what, and handling of sensitive information and dangerous actions.
- **Operations and quality:** Actually required performance, scale, cost, accessibility, observability, incident response, and transition constraints for existing products.
- **Verifiability:** Scenarios and criteria for judging intended behavior and failure handling.

If a new decision changes an earlier premise, revisit affected documents and use cases. Do not proceed to the next topic while leaving conflicting content unresolved.

<a id="6-설계-문서를-논의와-함께-완성하기"></a>

## 6. Complete design documents alongside discussion

Collect the problem, requirements, options, and decisions needed for a shared understanding in the same work record, and use `design-documentation` to put the lasting agreed design in its existing owning sections. Distinguish ownership of plans and architecture, and do not make documentation a separate approval stage. Mark unresolved choices as proposals and briefly report changed documents and the consequences of decisions. When moving into execution, pass on the same record and existing authority; do not treat writing documents or agreeing to a design as new execution approval.

Manage open questions, temporary assumptions, and next topics in the existing work record, linking to the owning documents for detailed design. Incorporate agreements directly into the text and clear out resolved questions and discarded alternatives. Do not repeat conversation timestamps, verbatim responses, or "user decision" markers. Retain minimal approval evidence or change history only in the designated record when actual retention needs or project rules require it.

Follow `design-documentation` and project guidance for document structure, splitting, ownership of common rules, status labels, and separation of verification evidence. Do not mark agreed design as actually implemented.

<a id="7-전체-설계-검토와-마무리"></a>

## 7. Review and finish the full design

Do not report design completion merely because individual questions were answered. Check the following together against the agreed scope:

- Main use cases connect from start to finish, and important exceptions and failure behavior can be explained.
- Implementers need not arbitrarily decide key user-facing behavior, data meaning, or responsibilities.
- Terminology, states, permissions, and contracts agree across documents, and the owning document and references for each design item can be found.
- Important open decisions within scope are resolved; deferred items have clear impacts and conditions for revisiting them. Do not mark completion merely by moving decisions needed for current completion criteria to a deferred list.
- Target design is distinct from confirmed implementation, and completion criteria are verifiable. Do not claim execution or performance verification is complete on the strength of design work alone.
- The design text has not accumulated conversation history, duplicate explanations, or unnecessary dates and decision markers.

Review mainly through cross-document comparison and scenario checks, adding bounded code investigation or experiments for important feasibility uncertainties. Identify unconfirmed matters as design limitations or remaining verification.

For design-only requests, finish by reporting the completed scope, links to design documents, remaining matters, and their effect on completion. If implementation was also requested, connect the agreed design, success criteria, remaining verification, and constraints to the existing work and continue into implementation and verification. Do not restart the design discussion as a separate task or request approval for the same decisions again. Clarify only the necessary portions when execution authority is absent or a choice falls outside existing agreement.
