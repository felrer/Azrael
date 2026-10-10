# Multi-platform runtime and maintenance

Status: `partial` — platform identity, shared runtime/build contracts and Windows-preserving migration are implemented. Native Unix core checks have partial acceptance; Linux x64 and macOS ARM64 remain product targets until installed-host and release acceptance passes. Windows local execution retains its existing acceptance evidence. macOS public distribution is deferred.

## Product scope

The initial scope is local VS Code execution on Windows x64, glibc Linux x64 and Apple Silicon macOS. Shared chat, account/provider management, native development tools, collaboration, queues and recovery remain one product. Computer Use and Window Use retain their Windows backend; native Unix desktop control is a later scope. Intel Mac, Linux ARM64, Alpine/musl user environments, WSL product support, Remote SSH and containers are separate follow-up targets.

`scripts/azrael-platforms.json` owns selected runtime descriptors, Cargo and VSIX targets, executable suffixes, desktop-control availability and acceptance maturity. An entry permits preparing a candidate; it is not proof of support. Minimum OS/ABI and desktop guarantees must be established by native dependency and installed-host acceptance before release. A Linux Rust target alone does not determine the compatibility of Node, Bun, keyring or PTY.

## Requirement applicability

Every feature addition, fix, refactor, dependency update and build/install change determines whether its requested behavior is common, environment-scoped, mixed or unresolved. Common refers to a named supported set; mixed separates common policy from platform implementations and exceptions. Scoped requirements identify the relevant OS, architecture, version/ABI, local/remote execution and desktop conditions, as well as excluded environments.

The task record distinguishes four scopes: requested behavior, code ownership, regression impact and actually verified environments. An OS-specific implementation may affect a shared contract; a shared implementation can require separate native verification. Missing platform information does not imply current-host-only scope. Support reductions, divergent product meaning and permission changes are product decisions; ascertainable technical facts are investigated rather than delegated to the user. The planning and execution skills own this procedure; the Work playbook routes to this contract.

## Shared and platform responsibilities

Shared services own conversation and provider state, queues, agent coordination, recovery, settings, approval policy and user-visible semantics. Existing native UI and account services are reused; complete services, UI views or install policies are not copied for each OS.

Platform responsibilities include native executable and dependency selection, case-sensitive path identity, executable permissions, process lifetime, credentials, private socket transport, file opening and host launch. Native desktop backends own capture, window enumeration/identity and input. Common authorization never becomes weaker when a backend is unavailable.

`scripts/platform-runtime.cjs` consumes the descriptor owner and provides common identity, executable naming and installation-path rules. Build staging copies the same module and policy bytes into prepared host and account payloads; it does not maintain independent validators in the TypeScript and JavaScript hosts.

## Runtime and release identity

A new runtime manifest identifies `platform` with `{os, arch, target, libc?}` using Node OS/architecture names. It is validated against the host before native launch. Existing Windows-only manifests without an identity remain accepted only on Windows x64 during the recorded migration. A manifest naming another OS/CPU/Cargo target is rejected. Linux candidates declare glibc; ABI minimum and actual binary/dependency compatibility remain release gates.

Existing absolute runtime schemas and bundle-relative inventory validation retain their state-isolation, containment and hash contracts. Relative public templates are resolved once against the selected installation root. The runtime configuration cannot select ordinary Codex state. Unix files intended for execution must also be executable. JavaScript helper files need integrity and file checks but are not treated as native executable files.

Source content identity, target, protocol-compatible engine/bridge/code-mode host and their hashes are bound in provenance. An imported code-mode host retains its explicit original path and hash; a source-built host has a different, explicit origin. A source-built claim requires a real source build. Native dependencies, runtime interpreter versions, artifact architecture, executable mode and licenses are part of the selected distribution inputs.

An imported Windows source receipt remains unchanged when materialized on Unix. Native validation checks identical bytes, Git modes and contained relative link targets, then records the actual Unix file, directory and link metadata in a separate materialization digest. Only the documented Windows file-mode and Git-link representations may be translated; the original importer still validates its original representation.

## Private management transport

Chat and account management share the same native engine. Windows keeps its current-user, non-elevated peer validation. Unix local-daemon admission checks that the socket parent is private, the directory/socket belong to the effective user and the connected peer credential matches before WebSocket/session bytes are sent. Explicit remote endpoint transport is a different authority boundary and does not bypass this local admission.

The engine publishes a rendezvous alias to its protected physical Unix socket. Private management accepts one final user-owned alias only when both advertised and physical parents are user-owned 0700 directories and the target is an actual socket. It connects to the inspected physical path and rechecks entry identities and link text after peer verification. Chained links, changed aliases and public advertised directories are rejected.

Native state remains `~/.azrael-ex` or an explicitly selected, isolated absolute state path. Changing installation paths does not migrate accounts or conversations. SQL migration bytes and applied checksums are preserved. Case-insensitive Windows identity is not used to merge distinct Unix paths. Private provider temporary files also set Unix `TMPDIR` without changing other extensions' process environment.

Account selection uses VS Code's workspace/global storage paths. Local desktop storage accepts absolute `file` URIs and the file-backed `vscode-userdata` scheme with empty authority; the latter is rejected in a remote extension host. Other providers and relative paths cannot become native account-state paths.

## Desktop features

Unix core packages omit the Windows Computer Use/Window Use payload and do not initialize a Windows backend. Backend absence must not prevent core host activation. Capability, OS permission, Azrael approval and execution failure are different states. Future Unix desktop implementations must make unsupported or permission-required states consistent in UI and model tool registration.

Injected request, notification, approval and disconnect hooks check the validated runtime's Window Use availability before requiring its backend. With no backend, native core dispatch continues, desktop routes report unavailable, and reserved local consent responses remain suppressed.

macOS capture/accessibility and Linux X11/Wayland APIs are candidates requiring native experiments. A selected-window failure cannot automatically grant whole-desktop control. Window identity and process lifetime must be revalidated before input. OS-level privacy permission cannot substitute for Azrael conversation/app consent. The detailed policy remains owned by the existing Computer Use and Window Use contracts.

## Installation, update and verification

All build inputs, locks, scripts, source and explicitly selected external runtime/UI inputs are frozen at build start. The source checkout may change afterward; those changes belong to a new input identity. Native builds, packaging, installation and verification consume the same frozen inputs.

`build-platform.cjs` orchestrates native candidates; `freeze-platform-inputs.cjs` binds content, permissions and contained relative symlinks. Mutable compilation copies are separate from the immutable input tree. The existing Windows PowerShell producer remains the installed migration path until the common producer passes its Windows release acceptance. Native interpreters and dependencies must match the selected architecture; emulation is not a substitute for that identity.

Common preparation reuses the pinned UI hash/anchor checks, namespace transforms, package secret scan and account payload. Packages are target-specific, contain a complete integrity inventory and exclude user state/cache. Installation verifies inventory and identity before mutation, uses a new versioned destination, records resolved runtime/state paths and preserves active processes. Rollback selects the retained verified version; it does not overwrite a running runtime or rewrite user databases.

Windows retains its existing installed contract during migration. Unix release roots default to user-owned platform locations; the state directory remains separate. macOS candidate build and verification do not authorize public distribution, signing account changes or notarization publication.

Portable candidates use `prepare-platform-host.cjs` for pinned UI preparation, `package-platform-release.cjs` for a schema-2 inventory and `install-platform-release.cjs` for side-by-side installation. Windows uses ZIP; Unix uses TAR with explicit executable modes. The recipient first extracts into a new directory, verifies the complete inventory, and can prepare a relocated VSIX without installing it. Bundled Devin Node paths and their installed build hashes are rebound with source/output transformation receipts; the original package remains unchanged. There is no automatic database migration or replacement of running releases.

Common source/contract checks are selected by changed behavior. Native and installed-host tests run on required target environments, with light/dark rendering and actual interactions for UI changes. A WSL native-process check is recorded as Linux process evidence, not Linux desktop acceptance or WSL product support. Native build success, provider real-account success, host UI acceptance and release certification are separate gates.

`.github/workflows/platform-contracts.yml` selects Windows x64, Ubuntu x64 and macOS ARM64 runners for common platform/frozen-input/provenance contracts and native transport compilation. This workflow does not build or publish releases. Pinned UI packaging and installed-host acceptance require the selected external inputs and remain separate gates.

Detailed execution and remaining gates belong to the existing [work plan](<G:/내 드라이브/ObsidianVault/PARA/30 Project/pi-harness/Tasks/Task2/DP-01-azrael-multi-platform/01-plan.md>); repeatable commands and supported artifact contracts belong to operations documents after their implementation is available.
