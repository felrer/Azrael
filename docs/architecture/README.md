# Architecture

Each document labels its own state (see [document states](../README.md#document-state-and-ownership)).

## Current implementation

- [azrael-ex host and storage](azrael-ex.md): single-extension host, pinned UI and engine provenance, installation, native storage, Codex and shared environment snapshots, recent-chat list, chat content handling.
- [Accounts and usage](accounts.md): unified account/usage page, OpenAI profiles and multi-window leases, switching, provider accounts, quota semantics.
- [Project usage value](project-usage.md): daily API-equivalent project totals, contribution calendar and monthly comparisons in Settings Usage.
- [Devin and mixed-provider agents](devin.md): catalog and model selection, native inference with Codex tools and sessions, permissions, storage/resume, legacy ACP threads, collaboration tool contract.
- [Managed providers and provider switching](managed-providers.md): managed inference, provider-grouped picker, reasoning controls, turn bindings, history projection and handoff.
- [Root resume scheduling](root-resume.md): deferring the root while subagents run, durable reservations and deferred-turn timing.
- [Queued context compaction](queued-compaction.md): ordered compaction queue, execution-time threshold, queue presentation and compaction progress.
- [Reload and resume recovery](reload-recovery.md): host recovery states, native state reconciliation and durable resume admission.

- [Provider context policy](context-policy.md): provider-specific 95% compaction defaults, context capacity, pricing tiers and settings/gauge contracts.

## Partial implementation

- [Prompt image preparation](prompt-image-preparation.md): shared QHD long-edge cap, conditional high-quality JPEG conversion, transparency and metadata preservation, and JPEG passthrough.
- [Root coordination](root-coordination.md): common root-only scheduling, delegation, resource decisions, waiting and intervention across projects.
- [Multi-platform runtime and maintenance](multi-platform.md): shared platform identity, OS-specific runtime/build boundaries and requirement applicability; local Linux x64/macOS ARM64 acceptance is separate, macOS public distribution is deferred.

- [사용자 API 모델](custom-api-models.md): 빈 초기 연결 목록, 사용자 endpoint·모델 등록, API picker 그룹과 native subagent 실행. 설치·실서버 수용은 별도 검증한다.

- [Side questions with /btw](side-questions.md): independent tool-free questions using the main task's live context and the native Side chat panel; source and rendered controls verified, Rust and installed acceptance pending.

- [Auto-Review](auto-review.md): OpenAI-only native permission selection and turn submission guard; existing Guardian binary verified separately from new package and installed acceptance.

## Target

- [UI presentation](ui-presentation.md): composer surface cleanup, fixed/dynamic typography boundary and icon style candidates.

- [Computer Use](computer-use.md): package-owned Windows Node REPL/Sky runtime, native app approvals, settings, child environment isolation and recovery.
- [Window Use](window-use.md): distinct window discovery/control requirements, occluded-window capture, task macro proposal and concurrent-use acceptance boundaries.
- [Window Use visualization](window-use-visualization.md): native corner glow, translucent click-through Escape hint and foreground-target stop with scoped fixture acceptance; draft detailed macro visualization.
- [Instruction distribution and settings](instructions.md): complete instruction releases, GitHub downloads, version selection, protected application and settings UI.
- [Azrael runtime and providers](azrael-runtime.md): one Azrael-owned engine for subscription providers, dynamic model discovery, recovery and independent VS Code chat. Replaces parts of the current implementation as each boundary is verified.

## Reference

- [Restart ideas](restart-ideas.md): candidate lessons from the retired implementations, with Codex contracts to verify before adoption.
- [Retired designs](../archive/2026-09-12-pi-harness/docs/architecture/README.md): historical Pi Harness and azrael-ex design documents; not current contracts.

## Ownership

Keep system boundaries, behavior, data contracts, constraints, quality attributes and design decisions here. Organize by independently changing features, and give each durable contract one owner that other documents link to. Implementation order and task progress belong in [work artifacts](../README.md#work-artifacts), code locations in [maps](../maps/README.md), and supported procedures and verification scope in [operations](../ops/README.md). Do not create detailed designs or empty component directories solely to fill this structure.
