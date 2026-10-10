# Azrael

**[English](README.md) | [한국어](README.ko.md)**

Azrael is an independent VS Code host for working with AI agents on code and projects. It brings a Codex-based engine and interface together with multiple accounts, models from different providers, coordinated subagents, context management, and conversation recovery.

The workflow is designed for both agents and people: assign independent work, keep shared decisions with one root agent, switch accounts and models from the same interface, and return to important conversations quickly. Window Use explores letting an agent operate a selected application while you continue working elsewhere.

Azrael runs as one integrated extension. Accounts, conversations, and settings live in `~/.azrael-ex`, separate from ordinary Codex state. Installation preserves existing Codex extensions, other extensions, and VS Code settings.

## Major features

| Feature | What it helps you do |
| --- | --- |
| Chat and development tools | Edit files, run commands, and use tools from a conversation inside VS Code. |
| Root and subagent collaboration | Give workers bounded assignments while the root owns shared decisions, integration, and final acceptance. |
| Scheduled root resume | Park the root during dependent work and resume on selected completion signals or a fallback deadline. |
| Multiple accounts and providers | Connect accounts, compare available usage, switch accounts, and choose models across providers. |
| Context management | Configure provider-specific automatic compaction and queue a manual compaction request between turns. |
| Window Use | Discover, capture, and control one approved Windows application through a separate tool surface. |
| Session flags | Mark conversations with a red flag so they are easier to find in the Chats list. |
| Recovery and queues | Keep queued inputs, reconcile accepted turns, and recover conversations after a reload. |

The images below are **illustrative UI reproductions with invented accounts, conversations, models, and usage values**. They contain no private session data and do not establish that every illustrated interaction is verified in an installed release. Implementation and acceptance details remain in the linked feature documents.

## Agent collaboration with clear ownership

Azrael separates coordination from execution. The **root agent** decides the scope, shared contracts, work order, resource constraints, integration, and final acceptance. **Subagents** receive a defined outcome, owned files or read boundaries, prerequisites, authority limits, and completion criteria. Read-only exploration and implementation can use different roles and models.

Independent assignments can run in parallel. Shared files, build locks, CPU, memory, and other dependencies still determine the useful level of concurrency. The root continues useful independent work while workers execute, then waits for their completion at a dependency boundary. Completion reports carry the actual scope, exit codes, evidence paths, and remaining uncertainty, reducing repeated investigation and unnecessary status exchanges.

![Root coordinating independent subagents and external work, parking, and resuming for integration](docs/images/agent-collaboration.svg)

### Resume on subagent completion or a code completion signal

The root resume mechanism supports two kinds of selected work:

- **Subagents:** `defer_root.wake_on.agent_paths` identifies the child tasks to wait for.
- **External code work:** `azrael_agents.work_completion` registers a fresh `workId` and `signalPath`. A build, render, or other producer publishes its actual terminal result through the registered signal, for example with [`scripts/complete-work.cjs`](scripts/complete-work.cjs). `defer_root.wake_on.work_ids` selects those executions.

With `condition: all_terminal`, the root wakes early when **every selected child and external execution has ended**. Success, failure, and cancellation are terminal outcomes; the root must inspect the results before proceeding. A scheduled time or delay provides a fallback deadline. Progress updates alone do not wake it. The host checks external signal files about once a second without making model requests.

For example, the root can start a video render, assign a worker to prepare accompanying material, finish its own independent edits, and then park. Once both selected tasks end, it resumes to inspect the output and integrate the result. The render keeps running during the wait.

The **Root resume reservations** view (`azrael.rootResume`) shows pending reservations, reasons, local resume times, and available resume/cancel controls. Cancelling a reservation leaves its producers running. The engine must be running with the root loaded for automatic resume to execute; durable reservations support recovery after reload.

Scheduled deferral is exposed on verified native tool transports, currently the **native OpenAI root path**. External work signals are verified in Windows native source; their packaging, installed-host acceptance, and other-platform acceptance are separate gates. Other providers' normal subagent collaboration does not imply access to this scheduling tool.

### Why this can be faster and use fewer tokens

Independent work overlaps instead of waiting in sequence. Clear ownership reduces duplicate edits, competing builds, and re-reading another agent's investigation. At a dependency boundary, a parked root performs **no ongoing inference**: it avoids repeatedly waking a model to ask whether a render or build has finished.

![Illustrative comparison of repeated model checks with one deferred wait and resume](docs/images/token-efficiency.svg)

The eight-minute example illustrates request counts, not a measured benchmark or a promised token reduction. A render takes the same time in both rows. Savings come from removing unnecessary model requests and status exchanges. Resume makes a fresh request from retained conversation state; provider prompt-cache reuse is independent and a cache miss can increase its input cost.

See [root coordination](docs/architecture/root-coordination.md), [root resume scheduling](docs/architecture/root-resume.md), and the maintained [instruction library](instructions/README.md).

## A smoother workflow for people

### Accounts and usage in one place

Open **Accounts and usage** (`계정 및 사용량`) from the profile menu to connect, switch, or remove accounts and review provider-specific usage. Multiple saved accounts let you choose the account appropriate to the next task without repeating setup. Available quotas and reset windows depend on the provider; unavailable observations are shown explicitly.

![Illustrative account groups with multiple saved accounts and remaining usage](docs/images/accounts-usage.svg)

Account and usage controls share one page. Credentials stay out of Webviews and logs. Account switching does not silently redirect a running request to another account, and managed thread bindings preserve their provider/account identity according to each provider's contract.

See [accounts and usage](docs/architecture/accounts.md) and [provider account operations](docs/ops/provider-accounts.md).

### Choose models across providers

Azrael combines native OpenAI and Devin paths with managed provider integrations, including Anthropic subscription OAuth, Google Antigravity, Google AI Studio, xAI, and OpenRouter. User-configured Chat Completions and Responses API connections have a separate identity and model group. Actual model availability, reasoning settings, authentication, and account limits depend on the connection.

![Illustrative provider-grouped model picker with reasoning selection](docs/images/model-picker.svg)

Switch models from the picker and use supported models as subagents. Provider changes occur at a turn boundary, with a bounded handoff summary when earlier output or a compaction checkpoint needs to cross providers. The same engine retains tool execution, permissions, and conversation ownership through the handoff.

See [managed providers](docs/architecture/managed-providers.md), [custom API models](docs/architecture/custom-api-models.md), and [Devin integration](docs/architecture/devin.md).

### Manage context without breaking the workflow

Provider-specific automatic compaction settings resolve against the selected model's capacity and context policy. You can also queue a manual compaction request between turns, alongside queued messages, instead of interrupting active work. Subagents resolve their own provider/model policy from the inherited configuration.

![Illustrative context gauge and manual compaction control](docs/images/context-compaction.svg)

Compaction carries a bounded summary into the continuing conversation; it does not preserve every original detail. Reload recovery and accepted-input reconciliation help continue work without blindly replaying already accepted messages. Deferred work segments can be folded while their waiting and resume state remains visible.

See [context policy](docs/architecture/context-policy.md), [queued compaction](docs/architecture/queued-compaction.md), and [reload recovery](docs/architecture/reload-recovery.md).

### Window Use: collaborate around a selected application

Whole-desktop Computer Use can compete with a person's foreground applications, cursor, and keyboard. **Window Use** is a separate Windows feature designed to address that friction: the agent discovers and selects one approved window, observes that target, and uses supported application controls while you work in another application.

![Illustrative Window Use demo showing a selected target behind a person's foreground workspace](docs/images/window-use.svg)

The demo reproduction shows the intended collaboration: one selected target, a separate human workspace, and visible control state. Windows Graphics Capture can obtain the target's content while another window covers it. Structured actions reuse UI Automation where supported, with app approvals, occupancy information, pause/recovery controls, and reusable task macros.

**Window Use is experimental and partially verified.** Actual Firefox and File Explorer observation and some Explorer actions have been checked. General concurrent physical-input isolation, installed GUI/tool acceptance, approval notifications, overlays, and real-window macros still have open acceptance work. Some actions can activate a target; background key delivery is experimental. Availability and reliability depend on the application exposing usable controls. Selected-window failures do not automatically expand authority to the whole desktop.

Computer Use remains a separate feature with its own authorization. Neither desktop-control backend is included in Linux or macOS core packages.

See [Window Use](docs/architecture/window-use.md) and [Computer Use](docs/architecture/computer-use.md).

### Flag conversations to find them again

Use a conversation row's flag button in **Chats** to add or remove a red flag. The marker stays visible on flagged conversations and is stored by host and conversation identity. Combine the visible markers with chat search to return to an important task quickly.

![Illustrative Chats list with flagged conversations and search](docs/images/session-flags.svg)

## Platforms and current limits

The local runtime targets **Windows x64, glibc Linux x64, and Apple Silicon macOS**. Their distribution and acceptance states differ:

| Platform | Distribution and verified scope | Unavailable or outside the accepted scope |
| --- | --- | --- |
| Windows x64 | Published [2026.0.3](https://github.com/felrer/Azrael/releases/tag/azrael-v2026.0.3); existing Windows acceptance is the baseline. | Window Use retains the experimental limits described above. |
| Linux x64 / glibc | Published [2026.0.1](https://github.com/felrer/Azrael/releases/tag/azrael-v2026.0.1); accepted on Ubuntu 24.04 / glibc 2.39 using native Linux VS Code through WSLg. | Computer Use, Window Use, and Windows desktop-control approval notifications are unavailable. Standalone desktops, older distributions, and live provider authentication/inference remain unverified. |
| macOS ARM64 | Partial internal acceptance; public distribution is deferred. | Computer Use, Window Use, and Windows desktop-control approval notifications are unavailable. Public installation, signing, and notarization are outside the released scope. |

Linux requires **glibc 2.39 or newer and OpenSSL 3** for the published package. Managed account storage requires a desktop Secret Service; Korean labels require CJK fonts. Intel Macs, Linux ARM64, Alpine/musl, general WSL product support, remote extension hosts, and containers are separate follow-up targets. WSLg acceptance does not establish those additional targets.

Shared chat, provider management, development tools, collaboration, queues, and recovery have common product contracts. Source tests, native execution, installed-host UI checks, and real-provider inference are distinct evidence; support for a target does not establish every feature on it. Full upstream `codex-core` and workspace regression acceptance is not established.

See the [multi-platform contract](docs/architecture/multi-platform.md), [platform operations](docs/ops/multi-platform.md), and [current development state](docs/ops/development.md#current-state).

## Installation

### Windows: install the published package

1. Install VS Code and PowerShell 7, and make the VS Code `code` command available.
2. Download `Azrael-2026.0.3-windows-x64.zip` and `SHA256SUMS.txt` from the [Windows release](https://github.com/felrer/Azrael/releases/tag/azrael-v2026.0.3). Check the archive's SHA-256 against the checksum file, then extract it into a new directory.
3. In PowerShell 7, open the extracted package directory and run:

   ```powershell
   ./install.ps1
   ```

4. In VS Code, run **Developer: Reload Window** to activate the installed host.

The package includes its verified runtime dependencies and bundled Node. The installer checks its inventory, creates a versioned runtime installation, and prepares the integrated VSIX. It preserves existing authentication and conversations and does not close or reload active windows automatically.

Default runtime releases live under `%LOCALAPPDATA%/azrael-ex/releases`; state lives under `%USERPROFILE%/.azrael-ex`. `-ReleasesRoot`, `-StateRoot`, and `-CodePath` override the locations. `-PrepareOnly` prepares the installation without invoking VS Code. Changing the state path does not migrate existing accounts or conversations. Follow [app release installation](docs/ops/app-release.md#package-and-installation-contract) for options and recovery.

### Linux: use the platform package instructions

Download all four Linux assets from the [Linux release](https://github.com/felrer/Azrael/releases/tag/azrael-v2026.0.1): the `.tar.gz` archive, `.manifest.json`, `.SHA256SUMS.txt`, and **`Azrael-2026.0.1-linux-x64.INSTALL.md`**. Keep them in the same directory. After satisfying the dependencies above, verify and extract the package:

```sh
sha256sum -c Azrael-2026.0.1-linux-x64.SHA256SUMS.txt
mkdir Azrael-2026.0.1-linux-x64
tar -xzf Azrael-2026.0.1-linux-x64.tar.gz -C Azrael-2026.0.1-linux-x64
cd Azrael-2026.0.1-linux-x64
```

Close existing Azrael sessions before selecting a new runtime, then use the bundled Node installer:

```sh
./runtime/runtime/node/node install-platform-release.cjs \
  --package "$PWD" \
  --install-root "$HOME/.local/share/azrael/releases" \
  --state-root "$HOME/.azrael-ex" \
  --code /usr/bin/code
```

Replace `/usr/bin/code` with the absolute path to your local VS Code CLI, then restart VS Code after installation. Use a new runtime directory and a separate Azrael state directory. Follow the downloaded `INSTALL.md` for Secret Service setup, prepare-only installation, and recovery details.

macOS has no public installation package yet. Developers preparing an internal candidate should use [platform operations](docs/ops/multi-platform.md) and retain its partial acceptance status.

## First use

1. Open the Azrael sidebar after reloading VS Code.
2. Connect an account from **Accounts and usage** (`계정 및 사용량`) in the profile menu.
3. Select an available model and request a task. Explain the desired outcome and relevant constraints; independent work can be assigned to subagents where enabled.
4. Adjust context policy, instruction components, and applicable desktop-control settings in **Azrael settings**.
5. Flag important Chats rows. For a scheduled root, inspect its reservation and use the available resume/cancel controls as needed.

For Windows Window Use, enable it and approve the intended application before selecting a window. Read its experimental limits before relying on simultaneous desktop work. Provider-specific connection requirements remain in [provider account operations](docs/ops/provider-accounts.md); Devin setup is described in [Devin operations](docs/ops/devin-native.md).

## Development

### Project structure

| Path | Responsibility |
| --- | --- |
| [`engine/`](engine/) | Codex-based Azrael engine and source provenance. |
| [`extensions/azrael-ex/`](extensions/azrael-ex/) | Account, usage, and settings module embedded in the integrated host. |
| [`providers/`](providers/) | Provider authentication and inference integrations. |
| [`native/`](native/) | Windows native functionality. |
| [`plugins/`](plugins/) | Plugins and associated skills/tools. |
| [`instructions/`](instructions/) | Maintained coordination guidance, roles, skills, and examples. |
| [`scripts/`](scripts/) | Build, package, verification, installation, and release tools. |
| [`docs/`](docs/) | Architecture, code maps, operations, and project playbooks. |
| `artifacts/` | Ignored build outputs, immutable release inputs, packages, and logs. |

### Build and verify from source

Cloning the repository alone does not supply all build inputs. Windows development requires PowerShell 7, Git, Node/npm, Python 3.11+, the pinned Rust toolchain and MSVC Build Tools, VS Code, the pinned official UI snapshot, a compatible code-mode host, and matching official extension/audio inputs. Devin requires the specified Node runtime; managed integrations use the pinned Bun runtime. Exact requirements and provenance rules live in [development operations](docs/ops/development.md#prerequisites).

From the project root, replace the placeholders with real absolute paths and a fresh release name:

```powershell
./scripts/deploy-azrael.ps1 -ReleaseName '<new-release-name>' `
  -SourceRoot "$PWD/engine" `
  -EngineTargetDirectory '<absolute-rust-cache-path>' `
  -CodeModeHostPath '<absolute-compatible-code-mode-host.exe>' `
  -OriginalExtensionPath '<official-extension-path>' `
  -OriginalAudioPath '<matching-official-audio-extension-path>' `
  -VerifyOnly
```

`-VerifyOnly` builds, prepares the package, and performs isolated host verification. Installing into a user profile is a separate invocation with a fresh release name and without `-VerifyOnly`. The full deployment already includes its build; a separate full build is unnecessary. The account module's `azrael-ex.vsix` is an intermediate package; install the verified integrated host.

Read [AGENTS.md](AGENTS.md) and select the applicable [project playbooks](docs/playbooks/README.md) before contributing. Freeze inputs, retain source provenance, verify the actual changed scope, and preserve active and rollback runtime paths. For Linux/macOS candidate builds, use [platform operations](docs/ops/multi-platform.md). Source changes, packaging, installed-host acceptance, and public release certification remain separate stages.

### Documentation

- [Documentation guide](docs/README.md): routes, document ownership, and state conventions.
- [Architecture](docs/architecture/README.md): feature behavior and system contracts.
- [Code maps](docs/maps/README.md): implementation owners and entry points.
- [Operations](docs/ops/README.md): development, installation, accounts, and diagnosis.
- [Project playbooks](docs/playbooks/README.md): verification, cleanup, and work requirements.
- [Instruction library](instructions/README.md): redistributable roles, skills, and coordination guidance.

## License and provenance

Azrael's own code and instructions use the [MIT license](LICENSE). Imported components retain their individual licenses and terms. The Codex-based engine retains its [Apache-2.0 license](engine/LICENSE) and [NOTICE](engine/NOTICE), with source identity in [`engine/SOURCE.json`](engine/SOURCE.json). Provider integrations, runtimes, fonts, and official UI redistribution conditions are covered by [third-party notices](THIRD_PARTY_NOTICES.md).
