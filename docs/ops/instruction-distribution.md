# Instruction and source distribution

Status: `partial`. Instruction packaging, backend, service and settings integration
are implemented, source-tested and included in the installed integrated host.
Public repository/release publication is held, and
live GitHub release acquisition has not been verified against a published Azrael
release. Existing integrated UI redistribution permission remains a release gate.

## Source ownership

`engine/` is an immutable verified snapshot selected by the user. Its `SOURCE.json`
records the upstream commit, complete inventory, content hashes, inherited missing
tracked paths and snapshot time. Later changes in the original development
worktree do not invalidate this selected snapshot. Engine Apache-2.0 LICENSE and
NOTICE are retained; the root MIT license applies to Azrael-owned material.
The selected inventory includes the committed provider compaction changes.
`localChanges` retains their original and current metadata and the original
inventory digest, so these local changes remain distinct from upstream bytes.
The distributed `.gitignore` has a narrow recorded adaptation so inherited
tracked IDE settings are visible to the parent repository. Original ignore-file
bytes are retained in `.gitignore.upstream`; provenance verifies both versions.
Root Git attributes preserve imported bytes. A recorded nested attribute overlay
also keeps the accepted-input SQL migration in LF despite the upstream CRLF rule.
The snapshot's TUI replay omitted the new `root_resume_wait` field in a pattern
and reconstructed turn. A narrow recorded source correction carries that field
through replay; the original file is preserved as `replay.rs.upstream`.
The snapshot also assigned version 56 to both creator identity and local root-wait
state migrations. The distributed root-wait migration uses version 60 with
unchanged SQL bytes. State startup repairs only a successful legacy version-56
receipt matching the exact root-wait checksum, and rejects an occupied version
60. Repair and migration run in one SQLite writer transaction. Creator identity
and unknown receipts are preserved; original source files remain in recorded
`.upstream` copies. `SOURCE.json` binds each corrected and preserved path.

`instructions/` contains the complete maintained shared library imported from
`C:/Users/felre/codex-efficient-subagents-share`. Its `SOURCE.json` records every
source mapping, hash, adaptation and exclusion. Environment-specific instructions
remain maintained copies, rather than filesystem links. Root project working
agreements are not overwritten by downloading a package.

Verify the frozen engine before packaging:

```powershell
python -B scripts/import-engine-source.py --destination engine --check --snapshot-only
python -B scripts/import-instructions.py --check
```

Read the importers' `--help` before refreshing either source. Refreshing instructions
must include review of local adaptations; refreshing engine creates a new selected
snapshot. Build caches and deployment artifacts are excluded from source distribution.

`scripts/build-engine-source-release.py --output <new ZIP path>` creates a
snapshot source archive and file/hash manifest. It validates the source before
and after packaging and compares every archived file's bytes with its inventory.
The original missing tracked paths remain explicitly recorded in provenance.

## Instruction release assets

`instructions/azrael-environment.json` owns `instructionVersion`, minimum app
version and component definitions. Update that version and the current
`instructions/CHANGELOG.md` when releasing changed instructions. Do not reuse a
published version with different bytes.

```powershell
node scripts/build-instruction-release.cjs --output artifacts/instructions/release-1.0.0 --repository felrer/Azrael
```

The builder creates a ZIP of the entire library, a file/hash manifest and a text
document preview asset. It rejects dirty release sources by default; `--allow-dirty`
creates explicitly marked local review assets. Files are checked again after
packaging. App packaging and GitHub upload are separate operations.

`.github/workflows/instructions-release.yml` prepares artifacts on manual dispatch
and publishes instruction assets on `instructions-vX.Y.Z` tags. The tag must match
the declared version. No workflow was triggered by this implementation. The user
manages publishing through GitHub Desktop. Do not publish while the distribution
hold applies.

## Settings and installation

Open **설정 → 지침 문서** or run `Azrael: Instructions`. The repository setting
`azrael.instructions.repository` defaults to `felrer/Azrael`. Check for releases,
select a compatible version, browse its documents, and download the complete
package. Select components before applying; optional workspace playbooks require
an open workspace. Git is not required for these downloads.
After restarting Azrael, cached versions and documents remain available offline.
Checking for new releases is an explicit network operation; reopening the page
reads cached documents and does not silently fetch missing or corrupt data.

State and immutable version caches live under
`CODEX_HOME/azrael/instructions/`. Applying changes records originals and hashes,
merges only the declared agent configuration keys, validates with the selected
engine and stops on local conflicts. Pinning prevents changing to another version
until unpinned. Rollback uses a previously verified cached version and the same
conflict checks. A repository change retains installed-source provenance.
Workspace selections and applied versions are recorded per root. Updating the
current workspace or home preserves other workspace receipts and never reads or
changes their files. The page reports a differing current workspace version and
retained workspace installations instead of implying that every workspace updated.

Interrupted commits retain a recovery journal. Do not delete a lock or recovery
journal without inspecting its owner and affected files. The backend provides
explicit `recover()`; the current settings page does not offer a recovery button.
Running conversations retain their captured instructions; new conversations use
applied files.

## Verification scope

Backend tests cover generated release assets, archive validation, conflict
protection, semantic configuration merge, pinning, rollback and recovery. Service
tests exercise actual assets and isolated native engine configuration validation.
Extension tests cover the renderer, host contract and portable runtime schema.
Pinned-source injection tests cover the native settings navigation and bridge.
Renderer previews in light/dark and narrow layouts are separate from installed
native settings acceptance. Test counts, exact logs and artifact hashes belong to
the external work plan.

The standalone host understands relative runtime schema 3 with binary hashes.
The existing integrated local package still uses its established development
runtime paths. A redistributable integrated portable installer and clean-machine
acceptance remain release work, alongside UI/runtime permission.
