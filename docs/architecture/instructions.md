# Instruction distribution and settings

Status: `partial`. The source library, release builder, download/install backend,
service and settings integration are implemented and covered by local tests.
Public release publication and live GitHub acquisition are pending the distribution
hold. Installed native settings acceptance and a portable integrated public package
are separate release gates. See [operations](../ops/instruction-distribution.md).

## Sources and releases

The Azrael repository owns the complete instruction library in `instructions/`, including agent roles, skill reference material and scripts, project playbooks, examples and documentation. Its `azrael-environment.json` declares independent semantic version `instructionVersion`, schema version 1, minimum compatible Azrael version and installable components. Source files retain their upstream provenance; Azrael-owned code and instructions use MIT, while imported engine and dependency notices retain their original conditions.

The skill components are `development-workflow`, `design-collaboration`, `design-documentation`, `implementation` and `project-bootstrap`, all selected by default with their support resources. Their source-relative paths, original and copied hashes and distribution adaptations are recorded in `SKILLS-SOURCE.json`; `SOURCE.json` retains the historical library import. Common execution guidance belongs to `implementation`. The optional workspace playbook component applies app logging guidance, while project-specific Work guidance remains under its existing owner.

An instruction release uses tag `instructions-vX.Y.Z` and three assets: `azrael-instructions-X.Y.Z.zip`, `azrael-instructions-X.Y.Z-manifest.json` and `azrael-instructions-X.Y.Z-documents.json`. The external manifest identifies the repository, source commit and source content digest, archive and document asset sizes/hashes, every archive file's relative path/size/hash, and component definitions. The document asset maps listed text-document paths to their content for browsing before downloading the complete package. The archive contains the entire instruction source tree; selecting components affects application, not download completeness.

Components have unique `id`, `title`, `kind`, `default`, `scope` (`home` or `workspace`) and `files` with `source` and `target`. Home targets are confined to `AGENTS.md`, named `agents/*.toml`, named `skills/` directories and the separately merged agent configuration. Workspace playbooks target `docs/playbooks/`. A configuration component reads `config.example.toml` and merges only the declared agent configuration keys into the existing `[agents]` table; credentials, root model, sandbox and unrelated settings stay under their existing owners. Preview and planning expose differences and unmanaged or locally edited target conflicts before application.

## Version acquisition and integrity

The host downloads through bounded HTTPS requests to GitHub's API and release-asset hosts. The configured repository defaults to `felrer/Azrael` and can be changed in Azrael settings. It queries instruction tags, excludes drafts/prereleases from latest compatible selection, validates schema/version/app compatibility and binds all asset selections to that release. Git is not needed. A pinned version remains authoritative until explicitly unpinned. Activation does not silently download or replace instructions.

Caches live at `CODEX_HOME/azrael/instructions/versions/<version>/`. Each contains a verified manifest, complete extracted package and document preview data. The installer state at `CODEX_HOME/azrael/instructions/state.json` records applied version, repository, pinned version, selected component IDs and managed original hashes. Version cache entries are immutable for their recorded repository and content; a different release claiming the same version cannot replace them silently.
Reopening settings restores downloaded versions and document previews from the
verified local cache without a network request. Missing or corrupt cached
documents cause an error; initial page loading does not repair them over the network.

Archive extraction rejects absolute paths, `..`, backslashes, Windows aliases/reserved names, symlinks, duplicates, case collisions, unexpected files, excessive entry sizes and total size. Actual file bytes must match the external manifest. A checksum from the same release establishes content integrity, not an independent publisher signature. Downloads and validation complete before active files are changed. Cancellation and network or validation failures preserve the current installation.

## Application and recovery

The application plan uses the selected components and hashes from the last successful installation. Existing unmanaged files whose content differs from the proposed file and files differing from the managed originals are conflicts. An identical unmanaged file can be adopted without rewriting; its original bytes are retained for restoration. Conflicts are shown with current/proposed content and stop mutation; they are never overwritten automatically. Removing a component or a file restores the recorded original or deletes an unchanged newly managed file. Unrelated files in a skill directory are preserved.

Application takes an exclusive lock, captures source and destination states, stages complete output, validates the staged native agent configuration using the selected engine, rechecks for concurrent edits, and records backups and a recovery journal before replacing files. It commits the state receipt last. Handled failures restore the affected files and receipt; interrupted commits leave explicit recovery data and require recovery before another mutation. Pin/unpin uses the same state lock and preserves applied file state. Rollback selects a previously verified cached version and follows the same conflict and compatibility checks as an update. Running threads retain their captured instructions; new threads use the applied instruction files.

## Settings surface

The integrated `Azrael 설정` command opens the existing native settings panel at its general settings section through the private host command `azrael.openSettingsPanel`. The command reuses the panel's settings navigation and does not substitute VS Code's configuration picker. Standalone instruction settings retain their owned renderer and service. Source routing is tested; rendered installed acceptance is separate.

The existing settings navigation has an Instruction documents / 지침 문서 entry with a thin monochrome document icon after personalization. Its labels, controls and generated status messages follow the active app language in English or Korean; the standalone surface follows VS Code's display language. The content follows the existing neutral typography, spacing, rounded gray selection, setting rows, buttons and focus styles in light/dark themes. It shows the source, applied/latest/pinned versions, compatible versions and changes, a categorized document list and scrollable plain-text preview, plus context-appropriate check, download, apply, update, pin/unpin and rollback controls. It distinguishes downloaded from applied state and exposes progress, retryable errors, incompatibility and local conflicts in the page. Source release notes, document content and external diagnostics retain their original text.

The host owns networking, filesystem operations and version state. Webview requests use `azrael-instructions` with a mount `clientId`, request ID, locale and validated action. The host keeps locale per mount and renders shared state for each language independently. Responses use `azrael-instructions-state` and retain those IDs. A mount releases its subscription on navigation/close or language change; late responses cannot update a new mount. Opening a page reads the persistent host state and can recover visibility of operations completed while the page was closed. An Azrael-owned standalone settings surface uses the same renderer and service as the integrated settings entry. Imported UI assets do not acquire new redistribution rights from this visual design.
