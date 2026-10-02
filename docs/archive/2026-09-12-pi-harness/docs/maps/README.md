# Code Maps

This is the entry point for documents that describe codebase areas, major entry points, and relationships between components.

## Stage 1-7 code map

| Area | Entry points | Responsibility |
| --- | --- | --- |
| Electron main | `src/main/index.ts`, `src/main/coordinator.ts` | Window policy, renderer authorization, utility supervision, event forwarding |
| Process supervisor | `src/main/process-supervisor/` | Core/Pi Host lifecycle, heartbeat, request/reply tracking, crash isolation |
| IPC boundary | `src/main/ipc/`, `src/preload/` | Fixed channels and command-specific renderer API; raw execute/utility ports remain private |
| Shared wire contract | `src/shared/contracts/`, `src/shared/errors/` | Protocol v1 Zod schemas, stable envelopes, error redaction |
| Core utility | `src/core/entry.ts`, `src/core/storage/`, `src/core/migrations/` | Main-owned userData SQLite location, migration/recovery, durable Core commands |
| Workspace registry | `src/core/workspaces/`, `migrations/005-workspace-registry.sql`, `src/main/index.ts`, `src/main/coordinator.ts` | Canonical identity, saved list/trust/active selection, non-destructive tombstone, native directory picker and runtime-safe switching |
| Session catalog | `src/core/sessions/`, `src/core/drafts/`, `migrations/001-initial.sql` | Workspace-ID-filtered Pi JSONL projection/dedupe/conflict, archive metadata, revisioned drafts; discovery uses Pi's cwd-derived default root |
| Durable queue | `src/core/queue/`, `migrations/002-queue.sql`, `src/main/coordinator.ts` | Transactional queue ledger, append-only lifecycle events, revision conflicts, dispatch orchestration, abort/draft recovery |
| Host recovery | `src/main/recovery/`, `src/core/queue/recovery.ts` | Main-side heartbeat/tool-risk tracking and Core-side crash/reconcile state; uncertain dispatches are never auto-resend |
| Pi Host utility | `src/pi-host/native-bootstrap.mjs`, `src/pi-host/pi-adapter/`, `src/pi-host/runtime/`, `src/pi-host/event-normalizer/` | Native Pi SDK ESM boundary, session/model runtime ownership, normalized event stream |
| Pi queue/context bridge | `src/pi-host/queue-bridge/`, `src/pi-host/context-renderer/` | Queue acceptance/delivery evidence and user-visible `<transferred_context>`/image-content composition |
| Context transfer | `src/core/context-capsules/`, `src/core/attachments/`, `migrations/003-context-capsules.sql` | Ordered capsule sources, provenance/checksum/token estimate, snapshot/reference attachments, shelf consumption |
| File access boundary | `src/main/file-access/`, `src/preload/` | Canonical path and scope policy, exact external approval, drift detection, bounded directory manifests, opaque one-time file tokens |
| Permission/auth | `src/pi-host/permission/`, `src/main/credential-vault/`, `src/main/external-url-policy/` | Tool approval policy, encrypted credentials, provider login URL authorization |
| Compaction bridge | `src/pi-host/compaction-bridge/`, `src/pi-host/native-bootstrap.mjs`, `src/pi-host/runtime/index.ts` | Pi-owned pressure/cut-point and JSONL lifecycle; public checkpoint validation, reasoning-aware capability gate, portable/fallback generation, hidden extension and sanitized events |
| Context snapshot | `src/pi-host/context-snapshot/`, `src/core/compaction-records/context-snapshots.ts`, `migrations/004-compaction.sql` | Provider total and local component measurements with explicit exact/estimate/unavailable labels |
| Compaction projection | `src/core/compaction-records/`, `src/core/entry.ts` | Public `CheckpointV1`/details, lifecycle attempts, Pi `pi_entry_id` idempotent upsert, JSONL reindex and recovery |
| Main compaction routing | `src/main/coordinator.ts`, `src/preload/`, `src/shared/contracts/` | Renderer command routing, Core/Pi snapshot merge, public event allowlist, hidden/provider payload redaction |
| Renderer shell | `src/renderer/app-shell/`, `src/renderer/features/session-catalog/`, `src/renderer/features/queue/`, `src/renderer/features/recovery/`, `src/renderer/features/context-shelf/`, `src/renderer/features/context-capsule-editor/` | Saved Workspace selector and stale-scan guard, stream gap recovery, chat/model/auth/permission, session catalog/tree/draft UI, durable queue/recovery cards, context shelf/editor |
| Renderer compaction UI | `src/renderer/features/compaction/`, `src/renderer/features/context-inspector/` | Manual/milestone preview and confirmation, policy controls, compaction cards, source/first-kept/recent-tail display, restore navigation/fork, token labels |
| Packaging runtime | `scripts/run-forge.mjs` | Runs Forge package/make with pinned Node 22 while the development shell remains on Node 26 |
| Validation | `tests/probes/`, `tests/contracts/`, `tests/integration/` | Runtime risk gates, protocol regression tests, process isolation tests; Stage 7 reasoning, records, inspector, coordinator and packaged smoke |

Dependency direction is Renderer → Preload → Main → utility. Core and Pi Host communicate only through Main's versioned protocol. Renderer never receives raw Electron IPC, utility ports, login URLs, or credentials. Pi SDK types/imports and Pi JSONL writes remain behind the Pi Host boundary.

## Stage 7 protocol flow

```text
Renderer
  │ preload: shell.compaction.compact / policy.set / context.snapshot / navigate / fork
  ▼
MainCoordinator
  ├─ Pi Host: compact, policy, snapshot, tree action
  │    └─ AgentSession.compact → session_before_compact →
  │       public CheckpointV1 → CompactionEntry/current context → lifecycle event
  └─ Core: record/upsert/list/rebuild, context.snapshot.record/list
       └─ SQLite public projection; Pi JSONL remains canonical
```

Main forwards only an explicit public allowlist. The reasoning-aware bridge keeps
encrypted reasoning opaque through the same-provider/model request and drops returned
hidden reasoning. Provider transport, credential and hidden payload fields are rejected
before events, Core records, context snapshots or renderer cards. `Navigate` and `Fork`
call Pi tree actions and leave the original branch/entry intact.

## Stage 8–10

Goal/resource, Markdown/workspace, diagnostics and packaging ownership is recorded in
[Stage 8–10 code map](stage8-10-code-map.md).

## azrael-ex

VS Code extension PoC의 module owner, host/Webview bridge, ordered transcript와 inference data flow,
live/fixture runtime 경계는 [azrael-ex code map](azrael-ex-code-map.md)에 기록한다.
