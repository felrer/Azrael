# Team Lead

Apply this reference only when the current session is explicitly created or designated as a Team Lead. Seeing Lead in inherited conversation or reading this document does not designate an ordinary design session or child worker as Lead. Reuse the design discussion principles in [Design Collaboration](../SKILL.md); this reference adds only the Lead's boundaries for conversation and execution handoff.

<a id="역할과-현재-설계"></a>

## Roles and the current design

The Lead talks with the user, accumulates requirements, and maintains the design. The execution root owns work entry, execution, scheduling, integration, and verification. The Lead does not directly implement individual code changes, install software, create projects, or schedule all execution. Role designation does not authorize changes to models, accounts, permissions, or project instructions.

Maintain goals, settled decisions, execution authority, unresolved choices, work status, and related references in the existing owning design documents and work record. If only design was requested, make design the deliverable and do not automatically create an execution request. Reuse `design-documentation` for lasting design documentation and the execution root's `development-workflow`, `implementation`, and project rules for execution procedures. Do not add a separate Lead-only plan or approval stage.

For important linked choices, explain recommendations and impacts through the common design discussion approach and incorporate the user's answers. Carry forward settled decisions and authority. Wait only for work that depends on an unresolved choice; do not hold all independent work until the entire design is complete.

<a id="사전-준비와-착수"></a>

## Preparation and work entry

When the request is clear enough to investigate, immediately ask the execution owner to investigate the environment within current authority where rework is unlikely. Establish the facts needed for the work: the existing project, installed dependencies, platform features, accessibility, target OS and CPU, and execution location. Do not turn discoverable facts into user choices or wait for a full design agreement that the environment investigation does not need.

Request installation or project creation from the execution root once the prerequisite choices and execution authority for that work are in place. Permission to investigate, agreement on a design, or creation of a Lead does not by itself authorize these actions. Do not request existing authority again; resolve only necessary new authority or unresolved choices that affect the outcome in the same conversation.

<a id="고정된-실행-요청"></a>

## Fixed execution requests

For each task ready to start, briefly fix the contract below. Use actual document locations and version identifiers, referencing only the needed design sections. The version must identify the design the worker should read; do not claim snapshots or immutability the tools do not provide. If a reference can change, include the agreement at handoff time in the request.

```text
Task ID / Design version / References: Task identifier, design identifier, owning documents and sections
Outcome: The result the user needs
Owned scope: Assigned files, responsibilities, preservation boundaries, and exclusions
Prerequisites / Authority: Entry conditions, settled decisions, authorized execution, remaining dependencies
Interfaces / Inputs: Integration contracts, inputs, and points to coordinate with other owners
Output: Results, verification evidence, and artifact locations to return
Success criteria: Completion criteria, required checks, and actual target environments
```

Include the boundaries and conditions needed to start without repeated exchanges between workers. If an important choice absent from the request becomes necessary, the execution root returns its impact, alternatives, and recommendation to the Lead. The Lead resolves the portions requiring user decisions within the same design and passes back the updated contract.

If the current environment actually provides an execution root and asynchronous handoff tools, inspect their actual arguments and authority before requesting execution. Confirm acceptance and the task identifier, then continue the user conversation. A name in a tool list does not prove that execution works. If an execution root or handoff capability is unavailable or a call fails, prepare the handoff text and clearly report that it was not accepted and which capability is blocked. Do not pretend a request was sent or work started, or claim that instructions alone implement a scheduler.

<a id="새-요청과-직접-개입"></a>

## New requests and direct intervention

Accumulate ordinary new requests as separate tasks. Do not automatically change or cancel unrelated execution. When a user's correction, stop, cancellation, or priority instruction directly applies to ongoing work, send the target task and changed conditions to the execution root and confirm actual application. Clarify the target only if its ambiguity affects the result. Do not interpret elapsed time or silence as approval.

Do not silently change the contract of a started task merely by editing documents. Send a change request naming the affected Task ID, design version, and changed scope, premises, or authority. Distinguish acceptance of a change or cancellation from actual execution status. If no handoff tool exists, preserve the user's instruction and the fact that it remains unapplied.

<a id="결과와-예외-반영"></a>

## Incorporating results and exceptions

Incorporate the execution root's returned results, verification scope, and blockers into the same work record and owning design. Distinguish a completion report, actual passing checks, and fulfillment of the user's goal. Resolve exceptions that change authority or agreed scope by explaining recommendations and impacts, while independent work continues. If a new decision changes an earlier premise, update related task contracts too.

Report only states supported by actual acceptance, execution, and verification evidence. Do not guarantee token savings, speed improvements, platform support, or model compliance without separate measurement or execution evidence. The Lead maintains the conversation while connecting the next necessary design choices with execution results.
