# Multi-platform candidates

Status: partial implementation. The [platform contract](../architecture/multi-platform.md) defines Windows x64, glibc Linux x64 and macOS ARM64 targets. macOS public distribution follows the [certificate-free Mac policy](app-release.md#macos-distribution-without-a-developer-id-certificate); final package acceptance remains required. The existing Windows release procedure remains the installed production path.

## Verified scope

The macOS ARM64 2026.0.5 candidate completed native locked release engine/bridge compilation on macOS 26.6.2. Its code-mode host was separately source-built against a fresh V8 pointer-compression/sandbox release and explicitly imported with recorded origin. Corrected host preparation uses independently frozen inputs while preserving the original native producer binaries. The exact archive passed input-stability, package-integrity, relocation-install, native-engine-provider and macOS-signing checks: 39 ARM64 Mach-O signatures and 328 dependency edges were verified. Receipts and assets are retained in `artifacts/logs/mac-release-2026.0.5` and `artifacts/app-releases/2026.0.5-darwin-arm64`.

The exact archive subsequently passed installed-host and rendered-ui acceptance on macOS 26.6.2 ARM64 with VS Code 1.138.0. A dedicated Chrome 154 profile actually downloaded the archive from an owned loopback server and generated its quarantine metadata. The documented tar extraction preserved attributes on extracted files; the bundled Node installer and VSIX installation naturally produced installed native files without quarantine. No attributes were stripped or global security/privacy settings changed. All 39 installed native hashes and signatures matched. Actual native Keychain CRUD, synthetic managed account capture and usage, same-profile clean restart persistence, settings persistence, native code-mode execution, queued turns and persisted conversation reopening passed. Root reviewed seven light/dark settings, account/chat, file and terminal screenshots plus the post-restart settings capture. Code and Chrome fixture secure storage used mock keychains; the bundled provider used the real native OS Keychain. Live provider authentication/inference, voice usage, Intel Mac, other macOS versions and native Mac desktop control remain unverified. The final seven-scope verification is `artifacts/app-releases/2026.0.5-darwin-arm64/verification.json`. All four Mac assets are public on [Azrael 2026.0.5](https://github.com/felrer/Azrael/releases/tag/azrael-v2026.0.5); the publisher verified remote hashes and preserved the seven existing Windows/Linux assets, supplemented notes, tag and latest selection. The publication receipt is `artifacts/logs/mac-release-2026.0.5/publisher/publication-r1.json`.

Earlier artificial quarantine on every native helper stalled before engine initialization; its equivalence to the actual documented installation flow was not established. Those failures are retained as diagnostics rather than proof that the downloaded package cannot launch. A subsequent empty Playwright frame query was incorrectly interpreted as a blank Settings screen: the actual screenshot and selected inner-frame CDP context rendered the settings, and the persisted atom and visible switch agreed after restart. A narrow assertion passed without modifying the product or rerunning the native build; original failed receipts remain preserved.

Linux x64 2026.0.5 is publicly available through the [platform release procedure](app-release.md#linux-assets-on-an-existing-release). Its exact archive passed locked native release engine/bridge compilation, imported code-mode execution with recorded origin, provider integrity, PTY shell spawn, ELF dependencies and bundled-Node relocation. Actual native Linux VS Code 1.138.0 through WSLg passed activation, ordinary Codex coexistence, synthetic secure account persistence, settings and light/dark UI, terminal/file tools, queued turns and full host restart recovery. All six release gates passed with exit 0; the additive publisher verified four remote asset hashes while preserving existing Windows assets and release metadata. This verifies Ubuntu 24.04/glibc 2.39; a separate standalone desktop and older distributions remain unverified. Live authentication/inference and switching between distinct accounts were not exercised. Managed accounts require desktop Secret Service. Temporary build/runtime/profile copies were removed after acceptance; receipts, producer logs and reviewed screens remain in `artifacts/logs/linux-release-2026.0.5`, and bound public assets in `artifacts/app-releases/2026.0.5-linux-x64`.

The common Linux producer explicitly builds locked node-pty using frozen headers from the selected Node distribution and its npm node-gyp. It disables Python bytecode writes into frozen inputs and verifies header/runtime version equality. A selected Linux Node distribution must include native headers. Windows and macOS retain their existing dependency preparation paths.

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
