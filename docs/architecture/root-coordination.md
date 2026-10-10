# Azrael root coordination

Status: `partial`. Root-only native context assembly, persisted-state deduplication, restoration and ordinary/compacted child-history sanitation pass focused Windows tests. A synthetic Devin request preserves the approved instruction text. Installed-host acceptance, other provider transports and non-Windows execution remain separate; instruction tests do not establish faster model scheduling. See [verification procedure](../ops/development.md#root-coordination-guidance).

## Scope and ownership

Azrael provides common coordination guidance to the root across projects. It owns delegation decisions, shared contracts, exclusive assignments, execution ordering, resource coordination, handoff, waiting, intervention, integration and final acceptance. User authorization, the effective delegation mode and project constraints remain applicable. Coordination guidance does not enable delegation or grant build, installation or publication authority.

The instruction body is maintained with the native prompt implementation, rather than copied into project or global AGENTS files. Root selection uses the actual session role, not its working directory or provider name. A child's inherited history must not activate root-only guidance. Root creation, resume and provider switching must retain the same scope. Available agent roles, tools and runtime capabilities determine usable actions; unavailable capabilities are not prescribed as available.

Workers receive their assigned outcome, owned scope, settled contracts, authority limits, prerequisites, completion criteria and reporting requirements. Shared change-preservation and evidence rules still apply to all agents. Common implementation and verification decisions remain in `implementation`; project commands, environments and required checks remain in their owning playbooks.

## Scheduling behavior

The root identifies prerequisites, inputs, outputs, exclusive writes and shared resources only as far as execution needs. It starts ready work on the path that controls total completion time and runs independent work alongside it. Small relevant preflight checks reduce avoidable rebuilds without creating a mandatory serial barrier for unrelated components. Completion of one assignment can release its dependent work before every other assignment finishes.

Concurrency follows actual process dependencies, CPU, memory, disk, network and cache locks. Separate caches or execution environments are chosen by their expected waiting reduction and preparation or duplicate-compilation cost. Already-running builds and checks are not duplicated. Fixed inputs and reusable evidence follow their owning contracts; changes invalidate affected outputs rather than automatically repeating every completed stage.

## Waiting, intervention and acceptance

The root works independently while workers execute, then waits on completion events when no useful ready work remains. It avoids repeated messages, status calls and indirect file/log/process polling. A reasonable expected duration or first-check point can be set without pretending that an uncertain completion time is guaranteed.

Targeted checks and intervention are permitted for changed user requirements, confirmed contract errors, data-loss risk, a predefined check point or time limit, newly reported execution failures or resource conflicts, and evidenced suspicion of a missing completion signal. Corrections go to the existing owner as a consolidated delta. Slow work alone does not justify duplicate assignments.

Completion reports identify actual scope, inputs and outputs, exit codes, log locations and unverified items. The root reuses sufficient evidence, verifies gaps or new integration risks, and reports completion only after all success criteria, mandatory checks and cleanup are satisfied. Product performance improvement is not established by instruction transport tests.

Root deferral and its provider/tool availability follow [root resume scheduling](root-resume.md). Instruction distribution follows [instruction ownership](instructions.md).
