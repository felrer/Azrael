# Instruction and source distribution

Status: `partial`. Instruction packaging, backend, service and settings integration
are implemented, source-tested and included in the installed integrated host.
Public repository/release publication is held, and
live GitHub release acquisition has not been verified against a published Azrael
release. Existing integrated UI redistribution permission remains a release gate.

Development uses the private `felrer/Azrael` repository. This visibility choice
does not replace third-party license conditions or establish redistribution
permission. App release versions and authorized local upload automation are owned by [Local app release](app-release.md). Instruction publication follows its independent workflow below.

## Personal resource library

Status: `partial` in source; the new personal-resource flow has Windows offline host/protocol, native skill-root isolation and isolated rendered UI evidence. It has not replaced the installed application, contacted a real instruction repository or passed final installed task lifecycle acceptance. The [architecture](../architecture/instructions.md#personal-skill-management) owns sharing and activation semantics; the [work record](../../work/BA-01-instruction-skill-sharing/01-plan.md) owns execution evidence.

Open Instruction documents in Azrael settings. Create a resource or import its complete folder, edit its files and save locally. Save does not apply or upload it. New personal resources default to collaborators; Playbooks default to local-only. The checkout uses ignored `instruction-library/`; other installations use a separate `<CODEX_HOME>-instruction-library` directory. Configure `azrael.instructions.libraryRoot` only to an untracked, Git-ignored directory when it resides within another repository.

Apply previews installation changes and conflicts before writing. Existing identical files can be adopted and their originals remain recoverable. A task profile instead prepares an immutable model/resource recipe and opens its selected new conversation. Inspect the effective model, package digests and persistent context before starting. Unknown models, missing pinned packages, role conflicts or incompatible harness choices stop activation. Other conversations and project defaults are preserved.

For sharing, create separate public and private GitHub repositories with an initialized branch through GitHub's normal setup, grant the fixed collaborator group access and connect each destination in settings. Azrael checks actual visibility and read/write capability. Host GitHub sessions or a token kept in SecretStorage supply authentication; credentials are not editor fields or exported resource files. Review a publication version and selected inventory, then publish explicitly. The baseline release protocol remains independent.

After an interrupted operation, inspect its displayed phase and use Recover. A source-committed publication is already shared even when Release creation fails; its known destination remains in publication history. Recovery uses the original approved bytes. A sharing change before any source commit blocks continuation at the previous destination. An interrupted local Apply protects other installers' locks and external edits.

Run the maintained source tests with `node --test scripts/test-instruction-settings.cjs scripts/tests/instruction-library.test.cjs scripts/tests/instruction-publisher.test.cjs scripts/tests/task-profile-runtime.test.cjs scripts/tests/inject-task-profile.test.cjs scripts/tests/instruction-module-packaging.test.cjs scripts/test-instruction-library-host.cjs scripts/tests/instruction-package.test.cjs`. Set `AZRAEL_PRESERVATION_UI_ROOT` when verifying another pinned pristine native UI candidate, and set `AZRAEL_INSTRUCTION_TEST_ENGINE` to the absolute verified engine executable for host baseline tests (`azrael.exe` in current Windows releases). Host baseline tests use the existing generated instruction release fixture and isolated native validator; they do not use network or change the active installation.

Instruction runtime packages, including `yazl`, belong in the account extension's production dependencies and lockfile. Windows and portable host preparation run `node scripts/check-instruction-modules.cjs <absolute-account-ui-directory>` on the staged payload, including resumed Windows preparation. The fresh child loads the real instruction modules and rejects dependency resolution outside that payload. The production-closure fixture also verifies missing direct and transitive dependencies cannot be supplied by ancestor directories or `NODE_PATH`.

Run native scope/cache regressions with `node scripts/check-task-profile-skills.cjs <absolute-engine-source-root>`. Semantic extension checking uses the installed TypeScript compiler with `--noEmit`. Application packaging/install follows the [build playbook](../playbooks/build.md), including its separate full-build authorization and final package acceptance gates.

## Catalog and project Playbooks

The catalog searches the personal library, explicit installed/built-in resource roots and connected repositories. Search filters cached metadata; Refresh library explicitly refreshes connected release metadata. A repository failure leaves other sources usable. Resource content is verified and cached when previewed or acquired; cached previews remain available offline. Listing alone does not import or install resources.

Use resource kind, source, sharing and destination filters in the list, or switch to cards. Expand Versions and differences to compare two snapshots or actual destination files. Preview version opens the chosen content; the primary detail action prepares installation of that exact version. Review the destination and changes before confirming. Library-only acquisition is available in detail management.

Choose a local project for Playbooks. Download writes `docs/playbooks/<resource-id>/PLAYBOOK.md` and support files. Download status compares document identity and version; it does not imply runtime activation. A new Playbook starts at `0.1.0`; valid content changes increment the patch version. Local edits and unmanaged destination files stop updates until resolved.

Source verification uses `node scripts/check-instruction-library.cjs backend`, `host` and `types`. Set `AZRAEL_INSTRUCTION_TEST_ENGINE` to an existing verified validator for host tests. These runners isolate fixtures under their recorded artifact run. `node scripts/verify-instruction-library-render.mjs` checks the actual renderer and client with fixture host responses in light/dark desktop and narrow layouts; it does not exercise the installed application or live repository authentication. See [execution evidence](../../work/CM-01-instruction-library-experience/01-plan.md).

## Source ownership

`engine/` is an immutable verified snapshot selected by the user. Its `SOURCE.json`
records the upstream commit, complete inventory, content hashes, inherited missing
tracked paths and snapshot time. Later changes in the original development
worktree do not invalidate this selected snapshot. Engine Apache-2.0 LICENSE and
NOTICE are retained; the root MIT license applies to Azrael-owned material.
The selected inventory includes the committed provider compaction changes.
`localChanges` retains their original and current metadata and the original
inventory digest, so these local changes remain distinct from upstream bytes.
An import with `--upstream-tag` records a reviewed integration separately in
`upstreamIntegration`: actual ancestor and selected release tags/commits, a
digest of both complete Git object inventories, and the imported inventory
digest. `head` and `baseTag` continue to describe actual Git ancestry. The
integration record does not claim a commit, conflict-free merge or runtime
acceptance. Latest-source checks revalidate the release refs and digest;
snapshot-only checks validate the metadata bound to the frozen inventory.
On Windows, inventory, copying and verification use extended filesystem paths
while receipt and Git identities retain canonical ordinary paths. Existing files
with long paths must be copied and hashed; they are not inherited missing paths.
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

The fixed source recipes also reproduce the local `gpt-6-astra` Ultrafast service tier, its routing override and the matching protocol/core tests. Preserved `.upstream` originals retain their recorded hashes and notices; `SOURCE.json` records the exact adapted bytes while keeping the original inventory and upstream integration metadata. Arbitrary catalog, routing or test changes still fail source verification.
`instructions/` contains the complete maintained shared library. Its `SOURCE.json`
retains the original import from `C:/Users/felre/codex-efficient-subagents-share`.
The five current skill directories come from the active installed Azrael skills;
`SKILLS-SOURCE.json` records their source-relative paths, original and copied hashes,
adaptations and exclusions. Environment-specific instructions
remain maintained copies, rather than filesystem links. Root project working
agreements are not overwritten by downloading a package.

`felrer/codex-efficient-subagents` is archived. Maintain new instruction changes
in Azrael's `instructions/` directory; the former checkout and `SOURCE-*`
documents are historical import evidence. Do not refresh automatically from or
mirror new changes to the archived repository. Review instruction version and
release metadata when changing the maintained library.

Verify the frozen engine before packaging:

```powershell
python -B scripts/import-engine-source.py --destination engine --check --snapshot-only
python -B scripts/import-instructions.py --check
```

Read the importers' `--help` before refreshing either source. Refreshing instructions
from an explicit historical source must include review of local adaptations.
The source-free instruction check validates the maintained skill hashes, component
mappings and current document links without requiring the archived checkout.
Refreshing engine creates a new selected
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
node scripts/build-instruction-release.cjs --output artifacts/instructions/release-1.1.0 --repository felrer/Azrael
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
Integrated development packages use their established development runtime paths;
the [app release installer](app-release.md#package-and-installation-contract) prepares
installation-specific paths from a portable distribution. Full clean-machine acceptance
and public UI/runtime redistribution permission remain separate release gates.
