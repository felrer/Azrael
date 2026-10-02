# Stage 8–10 code map

This map supplements the Stage 1–7 map. It names durable owners and the hardening
evidence boundary. The final offline packaged probes passed on 2026-09-02.

| Area | Entry points / data | Owner and boundary |
| --- | --- | --- |
| Goals | `src/core/goals/`, `migrations/006-goals-resources.sql` | Core owns goal revisions, conditions, checkpoints, status journal and one-active-goal-per-session invariant. `achieved` requires a user transition. |
| Goal delivery | `src/pi-host/goal-bridge/` | Pi Host receives the compact objective/conditions/constraints capsule on session start or revision change. It does not receive the checkpoint journal on every prompt. |
| Resources | `src/core/resources/`, `src/pi-host/resource-loader-bridge/` | Core normalizes scope, precedence, shadow and trust metadata; Pi Host owns Pi loader discovery. Third-party code is never enabled by discovery alone. |
| Workspace layout | `src/core/ui-state/`, `migrations/007-ui-state.sql` | Core owns versioned/revisioned layout persistence. Unknown panels recover to a default layout without modifying sessions. |
| Markdown file | `src/core/markdown-files/`, `src/main/file-dialogs/` | Core owns checksum/conflict decisions; Main owns native selection and canonical path access. Markdown bytes stay in the file, not layout state. |
| Workspace renderer | `src/renderer/workspace/`, `src/renderer/features/markdown/`, `src/renderer/features/composer/` | Renderer owns the bounded panel model, native drag-to-split, source editor/read-only rendered preview and composer formatting UI. Durable success is decided by Core commands, not by optimistic UI state. |
| Diagnostic export | `src/main/diagnostics/export.ts` | Main creates a metadata-only JSON bundle by copying an explicit allowlist. There is no prompt, credential, file path/content, arbitrary message, or raw error field in the output schema. |
| Acceptance tracking | `src/main/diagnostics/acceptance.ts`, `tests/e2e/critical-path.test.ts` | A dependency-neutral 14-row manifest combines deterministic results with separate packaged manual observations. Deterministic results alone cannot mark acceptance complete. |
| Migration recovery | `src/core/migrations/runner.ts`, `tests/integration/migration-recovery.test.ts` | Core checkpoints WAL, creates a timestamped backup, runs migrations transactionally, restores after failure, removes stale WAL sidecars, and reopens read-only for UI recovery. |

## Message and data flow

```text
Renderer command
  -> narrow preload command
  -> Main coordinator / native file boundary
  -> Core (goal, resource projection, layout, Markdown conflict decision)
     or Pi Host (goal capsule, Pi resource discovery)

Runtime failure metadata
  -> Main diagnostic input
  -> explicit metadata allowlist
  -> diagnostic JSON (no raw object traversal)

Migration failure
  -> transaction rollback -> close writable SQLite handle
  -> restore pre-migration backup -> remove WAL/SHM sidecars
  -> read-only SQLite handle + recovery metadata
```

Pi JSONL remains the transcript source of truth. SQLite owns app-durable goal,
queue, capsule, archive, draft and UI metadata. Diagnostic exports own neither and
must not become an alternate content store.

## Acceptance evidence boundary

The manifest has exactly these rows: chat fork, compaction transparency, session
deduplicate/resume, partial context transfer, queue stability, goal lifecycle,
file drag context, archive prior question, edit old question, clear input
formatting, snippet insertion, crash recovery, Markdown edit view, and chat layout
move. Each row points to deterministic tests and also requires a packaged manual
observation. The offline package suite covers these routes across the Stage 3–10
probes; real-provider authentication remains opt-in and production signing remains
out of scope.
