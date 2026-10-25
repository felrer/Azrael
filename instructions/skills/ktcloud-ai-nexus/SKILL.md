---
name: ktcloud-ai-nexus
description: Operate kt cloud AI Nexus accounts, sessions, SSH access, private session records, and persistent data folders using Azrael-managed instructions. Use when inspecting, creating, connecting to, recording, or terminating an AI Nexus session, or when deciding where its data should live. Do not use for unrelated cloud providers or generic SSH hosts.
---

# kt cloud AI Nexus

The loaded Azrael skill is the authority for code and instructions. Personal session records have a separate private state root and are never part of the redistributable skill.

## Resolve the canonical source

1. Run `scripts/resolve_canonical_root.ps1` from the loaded skill. It resolves that skill's code directory and validates its layout, without searching a Vault or another installation.
2. Run `scripts/resolve_state_root.ps1` separately for personal records. The Azrael repository uses `instructions/.private/ktcloud-ai-nexus/state` (Git-ignored and excluded from packages). Distributed installs use `CODEX_HOME/azrael/skills/ktcloud-ai-nexus/state`; without `CODEX_HOME`, Azrael uses `~/.azrael-ex`.
3. An explicit `AZRAEL_KTCLOUD_STATE_ROOT` must be an available absolute directory; an invalid override stops work without fallback. Missing default roots may be created only as part of authorized record work. Never infer that an empty new root contains the user's existing session history.
4. Resolve all code and references from the code root and all `sessions/active` and `sessions/archive` records from the private state root. Existing records remain private; do not add them to Git or a portable export.

Read `<state-root>/profile.json` for non-secret personal data-folder and workspace defaults before preparing an operation. The migrated profile preserves this user's approved paths. Public examples use `<persistent-folder>` and `<workspace-name>` placeholders: substitute verified profile values, never execute those placeholders literally. A missing profile requires explicit user choices for persistent destinations; do not invent a folder, migrate paths, or change accounts. Account aliases and account-switch restrictions below remain enforced; static GPU limits never replace live allocation checks.

## Read only the relevant source documents

- Account setup, login, authentication errors, or account switching: read `references/ktcloud_CLI_자동로그인_지침.md`.
- Session lookup, resource checks, naming, creation, verification, SSH, records, or termination: read `references/세션_생성_지침.md`.
- Persistent workspace layout or destination selection: read `references/data_folder_usage_guide.md`.
- Local disk versus NFS staging decisions: also read `references/data_folder_speed_reference.md`.
- Existing session work: inspect the matching private records under `<state-root>/sessions/active` and, when needed, `<state-root>/sessions/archive`; do not rely on a duplicated session index.

The source documents override this skill if they differ.

## Non-negotiable operating boundaries

- For a new session with no account specified, use `abydos`. Use `trinity` or an `ariusN` account only when the user explicitly requests that alias. Never switch accounts merely because the requested GPU count exceeds the selected account's limit.
- For an existing session, establish its owner from its record or UUID lookup. Do not create, terminate, or connect while ownership remains uncertain.
- Invoke Backend.AI through canonical `scripts/ktcloud_login.ps1` and `scripts/ktcloud_cli.ps1`. Do not call the Python helpers or `backend.ai.exe` directly during normal operation. If the managed Windows login runtime is missing or invalid, run `scripts/install_backendai_windows_runtime.ps1`; do not point the wrappers at a project-local temporary environment.
- Use `scripts/ktcloud_query.ps1` for documented bounded read contracts. The CLI wrapper supervises only allowlisted read-only queries with timeout, conservative transient-error retries, and metadata-only diagnostics. Do not apply query retry/timeout options to mutations, SSH/SCP, or app proxies. Read the CLI reference for defaults and explicit compatibility alternatives; never silently substitute different response contracts.
- Never run legacy `admin keypair info`; it may return sensitive keypair material. The wrappers reject it before Backend.AI starts. Use `v2 my resource-allocation keypair-usage` for the current user's allocation and usage.
- For concurrent SSH or SCP, use a separate wrapper invocation and a distinct free local port for every connection. The maintained runner isolates Backend.AI's fixed `id_container` staging per invocation and normalizes Windows private-key ACLs; do not reintroduce a global SSH/SCP mutex or bypass the wrapper to work around concurrency.
- Never request, print, copy, or record passwords, OTP values, cookies, credential files, login state, or private-key contents. Setup prompts are completed by the user.
- Store durable session names, UUIDs, last verified status, resource allocations, persistent paths, and handoff notes only under `<state-root>/sessions`. Never persist ephemeral SSH hosts, ports, key paths, proxy PIDs, connection command lines, or session-specific SSH/SCP macros or logs. Query fresh connection details for each invocation.
- DPAPI credentials and Backend.AI cookie/login state remain under `%LOCALAPPDATA%\ktcloud-ai-nexus` as machine-local authentication material. They are not session records and must never be copied into the repository or a portable export.
- Treat resource availability, session status, UUIDs, ports, image IDs, project IDs, vfolder IDs, and SSH details as live state. Query and verify them immediately before use rather than reusing stale values from notes.
- Perform a state-changing action only when the user's request includes that action. A request to inspect or diagnose does not authorize session creation, termination, credential removal, or file deletion.

## Execution shape

1. Resolve the target account and, for an existing session, its UUID and owner.
2. Log in through the account wrapper and verify `Authenticated=True` for that same account.
3. Query the selected account's full session history, user resource allocation, resource-group state, runtime presets, and vfolders required by the source guide.
4. Reconcile the request with current user-level `assignable` resources. If it cannot fit, report the exact constraint and stop; do not silently reduce resources or change accounts.
5. Before creation, verify the unique name, image, project, resource group, CPU, RAM, GPU, persistent-folder UUID, mount path, and `rw` permission. Use a temporary payload outside the repository unless the user asks to retain it.
6. After a requested mutation, verify the result by UUID and live CLI state. For a running session, validate the environment and persistent mount as prescribed by the guide.
7. Create or update the account-scoped record under `<state-root>/sessions/active/<account>/`. Move it to `<state-root>/sessions/archive/<account>/` only after CLI-confirmed termination, preserving stable handoff details and removing ephemeral connection data.
8. After any session-record change, run `scripts/validate_session_records.py`. Do not report completion while it finds a connection endpoint, key reference, direct SSH command, session macro, or connection log.

On a 4xx response, authentication mismatch, changed SSH endpoint, or missing mount, do not repeat the same command blindly. Re-read the live state and the relevant troubleshooting section, then report the blocking mismatch if it remains.

## Concurrent SSH and SCP

- Re-read the current SSH section of the session guide before connecting; session-specific instructions take precedence over remembered commands.
- Keep every terminal and transfer behind its own wrapper invocation and assign each one a distinct free local port.
- On Windows the wrapper assigns the Backend.AI proxy process tree to a kill-on-close Job Object. A hard wrapper exit therefore closes the proxy tree. Each subsequent wrapper invocation also removes only abandoned managed proxy trees, exact wrapper-generated random keys, and exact wrapper temp directories older than the safety threshold; it never sweeps arbitrary SSH files or processes.
- Preserve the caller's working directory so relative local paths in SCP commands continue to resolve where the user expects.
- For SSH exit code 255, capture the child SSH client's stderr and distinguish a live client from an orphaned `app <session> sshd -b ...` proxy. Never terminate a proxy that still has an active SSH or SCP client. Treat a proxy with no client and a dead parent as a cleanup candidate only when repair or cleanup is authorized.
- The wrapper's narrowly scoped automatic cleanup is pre-authorized for artifacts it created and can positively identify. Any broader process or file cleanup still requires the user's request.
- When changing connection behavior, validate it with two harmless read-only commands whose execution overlaps. Confirm that both exit successfully and that no temporary key or proxy artifacts remain afterward.

## Portable-copy boundary

- A portable copy may contain only `SKILL.md`, `agents/`, `references/`, and `scripts/`.
- Never include `state/`, session documents, session-specific SSH macros, credentials, cookies, login state, private keys, generated payloads, or cached CLI output.
- Use `scripts/export_portable_skill.ps1 -Destination <path>` for a portable copy. Do not copy the whole canonical skill directory.
- A portable export contains code only. Its installed private state root is separate and is never copied by the exporter. To reuse existing records, explicitly select their private root; never search another installation or silently fall back after an unavailable override.

## Data placement

- Use `/home/work/<persistent-folder>/workspaces/<workspace-name>` for workspace-owned persistent data and `/home/work/<persistent-folder>/shared` only for resources genuinely shared across workspaces.
- Keep frequently modified source, builds, and disposable intermediates on session-local `/home/work` when useful, but copy durable outputs to the canonical persistent path before a lifecycle boundary.
- Before writing persistent data, resolve the destination and verify it is under the approved workspace or shared root. Do not create new files in legacy nested paths.

## Completion report

Report the selected account, session name and UUID when applicable, verified live status, resources, persistent path, private session-record path, and any next action. Omit secrets and do not present unverified connection details as current.
