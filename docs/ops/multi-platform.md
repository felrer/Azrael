# Multi-platform candidates

Status: partial implementation. The [platform contract](../architecture/multi-platform.md) defines Windows x64, glibc Linux x64 and macOS ARM64 targets. macOS public distribution remains deferred. The existing Windows release procedure remains the installed production path.

## Verified scope

The common archive, inventory and prepare-only installer contracts have run on Windows, native macOS ARM64 and WSL Linux x64. Actual macOS pinned UI preparation and internal packaging use a compiled, locked companion, source-verified native debug engine binaries and native provider modules. The terminal addon, spawn helper and ripgrep have executed. Internal engine stdio, management bridge and code-mode session checks have passed. An isolated native VS Code installation also activates the corrected host, initializes its engine, receives notifications and completes provider account-list, usage, settings and refresh handlers without a Windows desktop backend. Automatic common-producer execution, provider authentication, recovery UI and rendered host acceptance remain separate gates.

WSL results establish Linux process behavior. A Linux desktop machine is not available for installation and light/dark UI acceptance. Current task results and remaining gates belong to the existing external work plan, rather than this operations document.

## Prepare a host candidate

Use an immutable release input, pristine pinned UI and the compiled account companion with its locked dependencies. The PowerShell preparation owner supplies the authoritative UI hashes and replacement anchors. Use the selected platform's native Node and ripgrep; paths below are absolute placeholders.

```sh
node scripts/prepare-platform-host.cjs \
  --release /absolute/frozen-release \
  --ui-root /absolute/frozen-pristine-ui \
  --account-ui-root /absolute/compiled-companion \
  --rg /absolute/native-rg \
  --host-version 1.2.3 \
  --output /absolute/new-preparation-directory
```

This preparation path is verified on macOS ARM64. It checks input stability and writes `preparation.json` alongside the host VSIX. The staged macOS node-pty spawn helper receives executable mode without changing its source bytes or frozen dependency tree. Namespace preparation selects the target's native payload. Unix candidates omit Windows desktop runtime configuration.

## Package and prepare an installation

The following archive and prepare-only paths are verified with platform contract fixtures. A deployable candidate additionally requires verified real engine and provider inputs.

```sh
node scripts/package-platform-release.cjs \
  --release /absolute/frozen-release \
  --host-vsix /absolute/prepared-host.vsix \
  --version 1.2.3 \
  --output /absolute/new-package-directory
```

Windows archives use ZIP; Unix archives use TAR with executable modes. Extract into a new directory before running the packaged installer. The recipient can use the bundled Node instead of a separately installed interpreter.

```sh
node install-platform-release.cjs \
  --package /absolute/extracted-package \
  --install-root /absolute/releases-root \
  --state-root /absolute/isolated-azrael-state \
  --prepare-only
```

The installer checks platform identity and the complete inventory before creating a versioned destination. It resolves host runtime paths, records approved transformations and writes `installation.json`. It rejects ordinary Codex state, overlapping paths and an existing destination. Prepare-only creates a relocated VSIX without invoking VS Code. State remains separate from installed runtime files.

Invoking VS Code, activating a version and accepting update/rollback behavior require installed-host validation. Preserve the active release and previous verified rollback release under the [build playbook](../playbooks/build.md); the portable fixture checks do not establish a completed rollback procedure.

## Native producer prerequisites

`scripts/build-platform.cjs` and `scripts/freeze-platform-inputs.cjs` define the common native producer. Full producer acceptance remains separate from the verified preparation commands above. It requires native Node, pinned Bun, Python 3.11 or newer with `tomllib` and `hashlib.file_digest`, the selected Rust/C/C++ toolchain, source provenance and the target's pinned native dependencies. The producer checks the Python prerequisite before freezing inputs or compiling. Keep immutable inputs separate from mutable compilation copies.

The source-built code-mode host requires the pinned V8 sandbox configuration. Official prebuilt availability must match the complete feature/target tuple; a pointer-compression-only archive cannot replace a sandbox archive. Source-build flags and tool settings are part of provenance. Unselected external V8 archive, mirror or binding overrides fail early. A separately verified imported code-mode host retains its explicit frozen binary origin.

The provider build checks the reviewed vendor file mapping through `provider-vendor-manifest.cjs`. Its canonical ordering is independent of the host's locale and traversal order; existing release receipts retain the original reviewed digest. Update the owning [provider provenance](../../providers/opencodex/UPSTREAM.md) and explicit manifest when reviewing a vendor change.

Run the common contracts and required native checks for the selected requirement scope. The CI matrix defines Windows, Linux and macOS contract/transport jobs; its definition is not evidence of a remote CI run or release certification.
