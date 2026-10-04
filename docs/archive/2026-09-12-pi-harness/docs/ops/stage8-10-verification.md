# Stage 8–10 verification and handoff

Run commands from the repository root on Windows. All automated packaged probes use
temporary `userData`, Pi agent and workspace directories. They do not use a provider
credential or make a model network request.

## Verified final sequence

The following sequence passed on 2026-09-02:

```powershell
npm ci
npm run typecheck
npm test
npm run package:win
npm run test:bundle-probe
npm run test:stage34-smoke
npm run test:stage56-smoke
npm run test:stage7-smoke
npm run test:draft-smoke
npm run test:stage10-smoke
npm run audit:package
npm audit --omit=dev --audit-level=low
```

`npm ci` invokes the project `postinstall` to fetch the pinned Electron binary because
npm's dependency install-script policy can otherwise leave `node_modules/electron/dist`
empty. The final typecheck passed and Vitest reported 35 files / 110 tests.

The Stage 10 packaged probe checks a clean-profile goal create/attach/condition/checkpoint/
user-confirmed-achieved flow, exact snippet insertion, Markdown save plus external-change
conflict, split layout restart recovery and Pi Host restart count. Earlier packaged probes
cover session/draft/archive, queue crash uncertainty, recovery, ContextCapsule/file policy,
compaction projection/idempotency and the Electron Pi SDK/SQLite/safeStorage runtime gates.

## Artifacts

```text
out/Pi Harness-win32-x64/Pi Harness.exe
out/Pi Harness-win32-x64/resources/app.asar
out/make/squirrel.windows/x64/Pi Harness-0.1.0 Setup.exe
out/make/squirrel.windows/x64/pi_harness-0.1.0-full.nupkg
```

`npm run audit:package` is the source of truth for final SHA-256 values. It also verifies
the pinned Electron/Pi versions, migrations 001–007 and rejects packaged JSONL, SQLite,
credential, `.env`, log and source-map files.

Final local-evaluation checksums:

- `app.asar`: `8db25626a1814a06530d9beb22caed4a2bf9a460dddf4c8aa834b9e471acf0fd`
- unpacked `Pi Harness.exe`: `bf554bb17553fd51a6eb9bbbfed7a9b28817c02d29b4ac82edb1a90b2b140375`
- installer: `cdcc39a62baef8cda1f52106604e1f051af313df19346e1c89fb996bd346cad8`
- update package: `6356c939cb4d40eed8ecd16d4fbc0a65681ad4ff94765c8726c60879fc715e08`

The installer is unsigned and intended for local evaluation. Production signing,
reputation, publishing and auto-update remain out of scope.

## Goal/resource operation

- Goal writes require expected revision. Only one active goal can attach to a session.
- `achieved` requires an explicit user-confirmed transition. Agent tool output is stored as
  a proposal/checkpoint and cannot mark completion by itself.
- Pi Host receives only the compact objective, success conditions and constraints when the
  session starts or the goal revision changes.
- Resource resolution keeps every candidate and marks shadowed entries. Workspace/project
  resources outrank user/built-in resources according to the catalog policy.
- Discovery never enables unreviewed extension code. Reload failure becomes a row diagnostic
  and does not clear the last usable catalog.

## Markdown/workspace operation

- Stage 01-R4 selected the lossless fallback: source is editable and the MDXEditor rendered
  view is read-only. Unsupported/lossy syntax remains source-only.
- Main owns native `.md` selection. Core owns UTF-8/checksum/draft/atomic-save decisions.
  An external checksum change returns a conflict and never overwrites the current file.
- One Markdown panel is reused; opening another file replaces it explicitly.
- Session tabs support button/keyboard split and native drag-to-split. Layout state is
  revisioned in Core and restored with the same logical session identity.
- Invalid layout JSON or unknown panel types produce a diagnostic and recover to the default
  layout without changing session data.

## Recovery and diagnostics

- A migration creates a timestamped pre-migration backup when schema work is required.
  Failure rolls back/restores the DB and returns read-only recovery metadata.
- Preserve the affected DB and `*.backup-*` file. Test fixes on a copy before touching the
  profile; do not retry writes through the read-only handle.
- Utility crashes expose a scoped restart action. Active write/execute/network work and
  uncertain queue items are not automatically replayed.
- Diagnostic export copies a metadata allowlist and excludes credential, prompt body,
  workspace path/content and arbitrary raw error objects.

## Remaining opt-in checks

Real-provider authentication requires a credential, network/cost approval and an explicit
temporary-data cleanup plan. It is not part of the offline acceptance suite. Do not place
real credentials, Pi JSONL, app SQLite files, prompts or workspace content in an evidence
bundle.
