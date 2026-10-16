# Delegation and Integration (Parent Only)

Follow the root's common instructions for Azrael task assignment, execution order, waiting and intervention. This document owns the specific role and handoff contracts; it does not expand delegation modes or execution authority. It does not authorize children to delegate further.

- Always set `agent_type` explicitly on `spawn_agent`; never rely on the default role, which inherits the parent model and full history and has been observed crashing the inference helper. Use `luna_explorer` (GPT-6 Luna, xhigh) for read-only evidence retrieval within named boundaries and `sol_executor` (GPT-6.1 Sol, medium) for settled implementation and validation in Codex and Azrael. Preserve role-owned model and reasoning defaults; use supported overrides only for a concrete need. Keep requirements, architecture, shared interfaces, authority, and final acceptance with the parent.
- Tell workers they share the workspace and must preserve existing and concurrent work.
- Include agreed platform applicability and exclusions, implementation ownership, regression impact and required verification in each relevant handoff. Keep requested targets separate from actually tested environments; return consequential unresolved scope changes to the parent.
- Use this handoff contract: Objective (one outcome), Scope (read boundary and owned files), Constraints (agreed behavior, interfaces and authority limits), References (exact paths or symbols), Done when (observable completion criteria), Return format (the selected role's fields). Pass decisions and references rather than full conversations or copied documents. State these requirements together in natural language when delegating. When useful for communicating requirements efficiently, optionally include short code snippets, evaluation algorithms, input/output examples, or references to existing tests.
- For a materially different independent objective that warrants delegation, create a fresh child with `fork_turns="none"`. If unsupported, use the smallest supported history scope and disclose the limitation. Reuse the same child for corrections and validation of its objective; send only the delta. Completion alone does not require another child. Do not split coupled unfinished work merely to refresh context.

<a id="조사-질문의-우선순위와-첫-인계"></a>
## Research Question Priorities and the First Handoff

- Prioritize the questions blocking the next implementation in research requests. Set the initial research scope to establish
  the minimum contract needed for subsequent execution, and hand off evidence, confirmed conditions and remaining uncertainty.
- Establish the behavioral meaning needed for the next implementation as well as API shapes. Defer only the parts that depend on unsettled contracts,
  distinguishing them from work possible under confirmed contracts. Do not fill unsettled behavior with arbitrary defaults or empty implementations.
- Assign additional research to the same owner as follow-up scope when needed. Divide the initial scope into completable units;
  do not assume ordinary progress reports alone resume a waiting root. Do not create a new agent for every small question.

<a id="후속-작업-연결과-결과-보고"></a>
## Connecting Downstream Work and Reporting Results

- When handing off expensive work, include downstream consumers, required artifacts, settings, environments and paths, readiness conditions and
  final completion conditions. Pass only necessary information within the existing role's return fields.
- Distinguish completion of the entire task from artifact readiness. Readiness reports must include paths and identifying information for artifacts
  that remain unchanged while in use, satisfied conditions for downstream execution and remaining checks. Creating a path or writing some files does not establish readiness.
- Prepare verification environments that can be prepared without final results in parallel within existing authority, and check them with a small actual execution.
  Distinguish successful environment preparation from final product verification; preparing fixtures does not authorize changes to real user accounts or external services.
- Do not assume ordinary progress or readiness messages wake a waiting root. If the current runtime supports staged completion events,
  use separate identifying information for actually completed stages, and have root wait only for the stage needed for its next work.
  Do not include unrelated targets in an all_terminal condition. Do not mark the entire task complete early or replace events with repeated polling.
  Source implementation alone does not establish availability in the current runtime and provider; check result status after resuming.
- For long executions or work involving multiple owners, briefly report start and end times, reasons for dependency and resource waits, and
  whether execution was repeated and why in existing logs and work records. Evaluate performance by total elapsed time; do not sum overlapping execution time.
  Distinguish expected time savings from measured savings. Small changes do not require detailed schedules or separate time-management documents.

<a id="부모-결정-요청과-응답"></a>
## Parent Decision Requests and Responses

- Batch currently known related follow-up instructions, questions and correction requests from parent to child. Do not frequently send small requests to a running child, and do not delay decisions blocking current work or reports of confirmed errors.
- Batch currently known related questions, evidence and recommendations at meaningful work boundaries. Do not delay a currently blocked decision request while waiting for questions that have not arisen or unrelated work.
- When provided in the actual session, request parent judgment or coordination through `request_parent` and retain the returned `request_id`. Acknowledgment or a scheduled resumption does not guarantee an answer. Defer only affected work and continue independent work; when no further work is possible, use `await_parent_response` for the same request. This neither completes the assignment nor creates a new request.
- The parent records each request's `resolved`, `cancelled` or `deferred` status, decision and reason through `respond_to_request`. Specify a `retry_condition` for deferral. Ordinary messages do not replace structured responses. Handle pending requests before waiting again to avoid a cycle in which the parent waits only for completion of a child awaiting its answer.
- Lack of a response, completion of independent work, elapsed time and checkpoints do not constitute approval or grounds for a new request. Use the same `request_key` for uncertain retries; the engine automatically records wait measurements and checkpoints. Do not add sleeps for logging, repeated polling or duplicate wakes. Preserve user stop/cancel instructions.
- If the new tools are unavailable, request decisions through `send_message` and proceed with independent work. When no further progress is possible, state the completed scope, required decision and conditions for the next execution in a `PARTIAL` final. Ordinary messages do not guarantee immediate parent resumption; do not mark an incomplete assignment DONE.
