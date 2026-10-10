# Local app release

Status: `current` — local packaging, relocated runtime, isolated trusted-workspace host acceptance and private/public GitHub publication are verified. Public repositories require an explicit publication option. Full clean-machine acceptance and third-party redistribution evidence remain separate.

Current published app: [Azrael 2026.0.3](https://github.com/felrer/Azrael/releases/tag/azrael-v2026.0.3), Windows x64, from verified source build `codex_latest_20261010_r15_isolated` (engine 0.162.0, official UI 26.1007.21434). Packaging reused those runtime binaries from fixed inputs; later concurrent development was excluded. Exact ZIP relocation and six isolated host acceptance stages passed using the official Windows archive VS Code runtime, and uploaded asset sizes and SHA-256 hashes matched. The release tag identifies source commit `795ac950cafc07f045006d47ee1ab79d3c693821`; binary provenance separately identifies engine source `43964513e69adc0c215c259a932cdd98b97decc9`. Publication evidence: `artifacts/logs/app-publication-2026.0.3/publish-receipt.json`; package certification: `artifacts/logs/app-release-2026.0.3/verification-r3/verification.json`.

## Version and source ownership

[`scripts/azrael-app-release.json`](../../scripts/azrael-app-release.json) owns the app release version and destination repository. The integrated host, release manifest, ZIP filename and `azrael-v<version>` tag use that version. Internal engine, pinned UI and account payload versions remain independent. Instruction releases retain their separate version owner in [instruction distribution](instruction-distribution.md#instruction-release-assets).

Each release identifies its source build and engine source fingerprint. The build's engine, bridge, code-mode host and provider binaries are reused with their recorded hashes. Packaging does not claim that those binaries were rebuilt or that their source is fully represented by the GitHub tag commit. Local source changes remain identified by provenance. A published version's bytes are immutable; changed distributions require a new version.

## Package and installation contract

The Windows x64 ZIP contains the integrated host template, runtime dependency closure, bundled Node, file inventory, provenance and available licenses/NOTICE files. It excludes user accounts, conversations, settings and build caches. The installer verifies the complete inventory before copying runtime files and preparing a VSIX whose runtime settings resolve to the selected installation location. Runtime and provider code bytes retain their original hashes; installation-specific settings are recorded separately.

The installer accepts `-PrepareOnly`, `-InstallRoot`, `-ReleasesRoot`, `-StateRoot`, `-CodePath` and `-DevinExecutable`. It resolves paths from the recipient's environment and saves the resolved locations in the installed configuration and receipt. The public host template retains relative runtime paths and the `@STATE@` placeholder; build-machine paths in provenance are historical evidence, not runtime locations to resolve on the recipient's PC.

| Setting | Explicit option | User environment variable | Default |
| --- | --- | --- | --- |
| Parent of versioned runtime installations | `-ReleasesRoot` | `AZRAEL_RELEASES_ROOT` | `%LOCALAPPDATA%/azrael-ex/releases` |
| Accounts, conversations and settings | `-StateRoot` | `AZRAEL_STATE_ROOT` | `%USERPROFILE%/.azrael-ex` |
| VS Code CLI command or path | `-CodePath` | `AZRAEL_CODE_PATH` | `code` |
| Optional existing Devin CLI executable | `-DevinExecutable` | `AZRAEL_DEVIN_EXECUTABLE` | Unset |

Explicit options take precedence over their environment variables. The installer appends the release version to the selected releases root. `-InstallRoot` instead selects the exact version directory and takes precedence over both `-ReleasesRoot` and `AZRAEL_RELEASES_ROOT`. Directory overrides and the optional Devin executable must be absolute paths. The Devin executable must exist; Node remains the verified bundled runtime. `-PrepareOnly` does not require a VS Code CLI. Variables are read at installation, so later environment changes do not redirect an existing installation or its state.

For example, set these process variables in the recipient's PowerShell session before running the extracted installer. User-level Windows environment variables with the same names may also be set for future installer processes.

```powershell
$env:AZRAEL_RELEASES_ROOT = Join-Path $env:LOCALAPPDATA 'azrael-ex/releases'
$env:AZRAEL_STATE_ROOT = Join-Path $env:USERPROFILE '.azrael-ex'
./install.ps1
```

Existing installation destinations are refused. Runtime, extracted package and state directories must be separate, and ordinary `.codex` state is prohibited. A preparation failure removes only the newly created destination; a failed VS Code installation retains runtime paths because the extension may already reference them. Preserve those paths until the partial installation has been assessed. Installation preserves existing authentication and state and does not close or reload active windows. Changing the state path does not migrate existing accounts or conversations.

## Local publication flow

### Linux assets on an existing release

Status: `current` for the published Linux x64 `2026.0.1` assets. The exact archive passed native/package and actual Linux VS Code acceptance on Ubuntu 24.04/glibc 2.39 through WSLg, including light/dark UI, synthetic secure account persistence, chat/tools, queued turns and reload recovery. The additive publisher verified all four remote asset hashes and preserved existing Windows assets, notes, tag and latest selection. The Windows release version owner and its publication flow remain separate.

Download from [Azrael 2026.0.1](https://github.com/felrer/Azrael/releases/tag/azrael-v2026.0.1). Follow the Linux `INSTALL.md` asset: glibc 2.39 or newer and OpenSSL 3 are required; managed account storage requires a desktop Secret Service, and Korean labels require CJK fonts. Standalone desktop hardware, older distributions, live provider authentication/inference, switching between distinct accounts, full OS reboot and destructive rollback remain unverified. Acceptance and publication receipts belong to `artifacts/logs/linux-release-2026.0.1`; immutable public assets and their bound verification are in `artifacts/app-releases/2026.0.1-linux-x64`.

For the requested Linux `2026.0.1` publication, add new platform names to the already published `azrael-v2026.0.1` release in public `felrer/Azrael`. Preserve the existing Windows ZIP, generic manifest, checksums and their bytes. Preserve the existing release notes, tag target and latest release selection. The existing tag can identify a different source commit from the Linux build; the Linux verification and publication receipts identify the build source and frozen inputs separately. Adding a platform distribution does not permit replacing previously published bytes.

[`publish-platform-release.cjs`](../../scripts/publish-platform-release.cjs) accepts a directory containing exactly `Azrael-2026.0.1-linux-x64.tar.gz`, `Azrael-2026.0.1-linux-x64.manifest.json`, `Azrael-2026.0.1-linux-x64.SHA256SUMS.txt` and `Azrael-2026.0.1-linux-x64.INSTALL.md`. Checksums cover the archive, manifest and installation instructions, excluding the checksum file itself. The manifest must be schema 2 with version and platform `{os: "linux", arch: "x64", target: "x86_64-unknown-linux-gnu", libc: "glibc"}` and a host template hash matching its inventory and the verification receipt.

The caller supplies a schema 1 verification receipt with `kind: "platform-release-verification"`, `status: "passed"`, `version`, `platform`, `sourceCommit` (40 hexadecimal characters), `inputSha256` and `hostTemplateSha256` (64 hexadecimal characters), and an `assets` array containing exactly the four names, sizes and SHA-256 hashes. Its `checks` array must contain passed records with `exitCode: 0` for every exported `REQUIRED_CHECK_SCOPES` value: `input-stability`, `package-integrity`, `relocation-install`, `native-engine-provider`, `installed-host` and `rendered-ui`. All additional checks must also pass. This receipt is the acceptance gate; creating matching hashes alone does not establish those checks.

```powershell
node scripts/publish-platform-release.cjs --version 2026.0.1 --repo felrer/Azrael --verification <verification.json> --asset-directory <immutable-assets-directory> --receipt <new-publication-receipt.json>
# After package acceptance, add --publish to upload the four assets.
```

Without `--publish`, the script checks local identities and repository write access, snapshots the existing stable release and latest release, and proves existing asset hashes without uploading. With `--publish`, it uses `gh release upload` without replacement, proves all uploaded sizes and SHA-256 hashes, and compares the original assets, release fields, tag reference and latest release before reporting success. GitHub SHA-256 asset digests are used when available; otherwise asset downloads are streamed through SHA-256. The tool never creates a release, edits notes or tags, changes visibility, selects latest, deletes assets or overwrites collisions. Any existing platform asset name blocks the run, including a matching asset from an earlier partial run.

The new publication receipt records `preflight-passed`, `published` or `failed`, the publisher script hash, verification and manifest hashes, host and input identity, source commit, local asset inventory, uploaded names and remote snapshots. On failure, preserve partial remote assets and the receipt for review; the script attempts read-only inspection and records any inspection failure. Receipt paths must be new. Store compact receipts and command logs under `artifacts/logs/linux-release-2026.0.1/publisher`; retain immutable assets until publication or recovery is resolved. Local tests do not establish remote CI or clean-machine support.

Select an existing build through `-ReleaseDirectory` or the configured `artifacts/latest.json` pointer. That pointer identifies packaging success, so validation of the release package remains mandatory. `prepare-app-release.ps1` reads the version owner, prepares an integrated host at that version and packages the selected runtime. A supplied `-PreparedHostReceipt` must bind the selected build, version and host SHA-256. Output paths must be new.

`publish-app-release.ps1` requires a verification receipt bound to the exact release manifest and asset hashes. It checks the existing repository's access, confirms the selected remote target commit, and refuses an existing release or tag. Public repositories additionally require `-AllowPublicRepository`; the script never changes repository visibility and records the destination's visibility in its receipt. It creates a draft, verifies every uploaded asset's size and SHA-256, then publishes only when `-Publish` is specified. `-PreflightOnly` performs validation and access checks without creating a release. On an upload or verification failure, preserve the reported draft/tag state for recovery; do not replace files under the same version.

The GitHub tag identifies the specified remote commit; binary provenance identifies the reused build independently. Remote branch pushes and repository visibility changes are separate actions. Apply `-AllowPublicRepository` when the user's publication request covers the existing public destination. Missing third-party redistribution evidence remains explicit in package provenance; successful publication does not establish that evidence.

Run from the project root in PowerShell 7 after updating the version owner. These commands prepare and verify the selected local build, then upload its certified files. Supply available matching third-party notices through `-LicenseDirectory` when packaging.

```powershell
$releaseConfig = Get-Content scripts/azrael-app-release.json -Raw | ConvertFrom-Json
$releaseOutput = Join-Path $PWD "artifacts/app-releases/$($releaseConfig.version)"
$verificationOutput = Join-Path $PWD "artifacts/logs/app-release-$($releaseConfig.version)"
./scripts/prepare-app-release.ps1 -OutputDirectory $releaseOutput
./scripts/verify-app-release.ps1 -ManifestPath "$releaseOutput/assets/release-manifest.json" -OutputDirectory $verificationOutput
$releaseTarget = gh api "repos/$($releaseConfig.repository)/commits/master" --jq .sha
./scripts/publish-app-release.ps1 -ManifestPath "$releaseOutput/assets/release-manifest.json" -VerificationPath "$verificationOutput/verification.json" -NotesFile ./release-notes.txt -Repository $releaseConfig.repository -TargetCommit $releaseTarget -AllowPublicRepository -Publish
```

Create the release notes file before publication; its location is caller-selected. Omit `-Publish` to retain a verified draft. Preparation and verification outputs must be new on retry. To verify outside the development checkout, pass an absolute `-FixtureRoot` under a unique temporary owner's `artifacts/verification/<new-name>` directory. Inspect `verification.json` for `fixtureRoot` and `cleanupProjectRoot`, then remove the reviewed fixture with `clean-verification-artifacts.ps1 -ProjectRoot <cleanupProjectRoot> -FixtureRoot <fixtureRoot> -IncludeDiagnosedFixtures -Apply`. The cleanup checks process and installation references before deletion.

## Verification and retention

Verify relocation outside the development checkout, provider runtime integrity, engine startup, the exact customized host package and isolated host acceptance before certifying the uploaded manifest. The host checks run in a fixture-owned trusted workspace using the VS Code [workspace trust CLI switch](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust); they do not alter user trust settings or certify restricted-mode activation. Unit tests cover tampered files, unsafe paths, version mismatches, occupied destinations and failed or duplicate publication. Retain compact verification and publication receipts in the owning task log directory and work plan.

After verification, remove extracted packages, isolated VS Code profiles and temporary installation copies using the [build cleanup rules](../playbooks/build.md). Preserve the original build, current/previous installed releases and the actual release assets needed for publication or recovery. Record every temporary retention reason and its removal condition.
