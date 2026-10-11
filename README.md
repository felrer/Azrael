# Azrael

**English** | [한국어](README.ko.md)

Azrael is an independent VS Code host for working on code and projects with AI agents. It builds on a Codex-based engine and interface and adds what long, multi-agent work needs in practice: a root agent that coordinates bounded subagents, a scheduled resume that lets the root stop spending tokens while builds and renders run, many accounts and providers behind one picker, queued context compaction, Window Use for working alongside an agent on the same desktop, and flags for getting back to important conversations.

Azrael runs as one integrated extension. Its accounts, conversations and settings live in `~/.azrael-ex`, separate from ordinary Codex state, and installation preserves existing Codex extensions, other extensions and VS Code settings.

> [!NOTE]
> Azrael is under active development and each feature has its own verified scope. This README states those limits next to each feature; the [architecture documents](docs/architecture/README.md) are the authoritative source.

## Contents

- [Highlights](#highlights)
- [How agents collaborate](#how-agents-collaborate)
- [Built for the person at the keyboard](#built-for-the-person-at-the-keyboard)
- [Window Use](#window-use-work-alongside-the-agent)
- [Session flags](#session-flags)
- [Platform support](#platform-support)
- [Installation](#installation)
- [Usage](#usage)
- [Development](#development)
- [License and provenance](#license-and-provenance)

## Highlights

| Feature | What it gives you |
| --- | --- |
| **Root and subagent collaboration** | One root agent owns decisions and acceptance; workers get narrow, file-owned assignments and run in parallel. |
| **Scheduled root resume** | The root parks until selected subagents *and* external jobs such as builds or renders finish, instead of polling them with model requests. |
| **Accounts and usage** | Connect several accounts per provider, see remaining quota and reset times, and switch in one click. |
| **Models across providers** | OpenAI, Devin, Anthropic, Google, xAI, OpenRouter and your own API endpoints in one searchable picker; switch mid-conversation. |
| **Context compaction** | Per-provider automatic thresholds plus a manual compaction you can queue without interrupting the running turn. |
| **Window Use** *(Windows, experimental)* | The agent captures and operates one approved window while your mouse, keyboard and clipboard stay with you. |
| **Session flags** | Pin a red flag on a conversation so it stands out in the Chats list. |
| **Recovery and queues** | Queued inputs survive reloads; accepted turns are reconciled instead of replayed. |

UI screenshots in this README are captured from Azrael's production components with the project's development renderers. Every account, conversation, quota and model catalog in them is **synthetic** — no personal account or session was opened. The collaboration, token and Window Use pictures are explanatory illustrations. See [image sources and reproduction](docs/images/README.md).

## How agents collaborate

### Two roles, one owner of the outcome

Azrael gives the **root agent** a native coordination prompt (maintained with the engine, not copied into project `AGENTS.md` files) and keeps **subagents** narrow on purpose.

| | Root agent | Subagent (worker) |
| --- | --- | --- |
| **Owns** | Requirements, scope, shared interfaces, write-set assignment, execution order, integration and final acceptance | One assigned outcome and the files it was given |
| **Receives** | The user's request and project guidance | A handoff: *Objective, Scope, Constraints, References, Done when, Return format* |
| **May delegate** | Yes | No — children cannot re-delegate |
| **Reports** | To the user, only after every success criterion and cleanup is met | Actual scope, exit codes, log paths and anything left unverified |

The shipped instruction library defines two worker roles, each with its own model so cheap work stays cheap:

- **`luna_explorer`** — read-only evidence retrieval inside named files or directories. It cannot edit, build or decide architecture.
- **`sol_executor`** — implementation and validation once behaviour and scope are settled, restricted to its assigned files.

Handoffs pass decisions and exact paths instead of whole conversations, and a fresh child starts without the parent's history. Supported models from other providers — including user-registered API models and Devin models — can also run as subagents, each with its own thread and account binding.

### Waiting without spending: `defer_root`

The expensive part of supervising long work is usually not the work but the waiting. A root that keeps asking "is the build done yet?" pays for a full model request — the whole conversation re-sent — every time, and almost every answer is "not yet".

Azrael replaces that loop with a root-only tool, **`azrael_agents.defer_root`**:

- The root names what it is waiting for — `wake_on.agent_paths` (subagents) and/or `wake_on.work_ids` (external jobs) with `condition: all_terminal` — plus a fallback deadline (`resume_after_ms` up to 12 hours, or a UTC `resume_at`).
- The reservation is persisted, then the root **parks**: no inference, no status calls, no file or log polling. Subagents keep running untouched.
- The engine wakes the root **once**, when every selected target has reached a terminal state (success, failure or cancellation) or the deadline arrives, whichever is first. Ordinary progress messages are saved but do not wake it.

### External jobs: the completion flag

Builds, renders and test suites are not subagents, so Azrael gives them their own completion flag, **`azrael_agents.work_completion`**:

1. The root calls `work_completion` with `action: create` and gets back a `workId` and a thread-owned `signalPath`.
2. It starts the job so that the job publishes its real outcome to that path when it ends — for example with the bundled helper:

   ```sh
   node scripts/complete-work.cjs --signal-path <signalPath> --state succeeded --exit-code 0 --summary "render finished"
   ```

3. It defers with `wake_on.work_ids: [workId]`. While parked, the **host** checks the signal file about once a second — no model call is involved.
4. On resume the root reads the recorded state before anything that depends on it. Terminal results are immutable, and a timer or manual resume never counts as completion.

![Root plans, assigns subagents and external jobs, defers, parks and resumes once](docs/images/agent-collaboration.svg)

Example: the root starts an eight-minute video render, hands a subagent the release notes, finishes its own independent edits, and then defers on both. Nothing is spent while the render runs; the root wakes once, checks the output and integrates.

Pending reservations appear on the **Root resume reservations** page (`루트 재개 예약`) with the reason, local resume time and the children being waited on, along with resume-now and cancel actions. The chat shows the waited-on subagents' avatars next to a native resume action, and the turn timer freezes at the defer boundary. Cancelling a reservation never cancels the subagents or the external job.

> **Scope.** `defer_root` is exposed only on providers with a verified native tool transport — currently the **native OpenAI root path**. External work signals are verified in Windows native source; installed-package and other-platform acceptance are separate steps. Ordinary subagent collaboration on other providers does not include this tool. The engine must be running with the root loaded for an automatic resume.

### Why the whole process is faster and lighter

![Nine model requests while polling versus two with a deferred resume](docs/images/token-efficiency.svg)

- **Parallel by default.** Independent assignments overlap instead of queuing, and the root starts the work on the critical path first.
- **No duplicate effort.** Disjoint write sets avoid conflicting edits; the root never starts a second copy of a build that is already running.
- **Smaller requests.** Workers receive references and decisions, not the parent's conversation, and read-only exploration runs on a lighter model.
- **No idle polling.** A parked root performs no inference. The saving comes from removing repeated wake-ups and status checks, **not** from the elapsed time itself.
- **Fewer round trips in desktop work.** Window Use task macros execute up to 32 mechanical steps in one tool call instead of one model turn per click.

The figure illustrates request counts, not a measured benchmark. A resumed turn is a fresh request built from retained conversation state, so a provider prompt-cache miss can raise its input cost; prefer waking on completion with a sensible fallback deadline over short timers meant to keep a cache warm.

Details: [root coordination](docs/architecture/root-coordination.md), [root resume scheduling](docs/architecture/root-resume.md), [instruction library](instructions/README.md).

## Built for the person at the keyboard

### Many accounts, one page

Open **Accounts and usage** (`계정 및 사용량`) from the profile menu. Every provider's accounts are listed in one place, grouped under the provider's logo, each with a remaining-quota gauge, its reset time and a badge on the active one.

![Accounts and usage page with synthetic accounts across providers](docs/images/accounts-usage.png)

- **Switch in one click.** Sign in once per account and move between them as quotas run down or projects change.
- **Independent windows.** Each VS Code window can use any account, including one another window is using.
- **Remembered per provider.** A conversation remembers which account it used for each provider, so moving OpenAI → Anthropic → OpenAI returns to the same OpenAI account.
- **Optional automatic switching.** Enable **Allow automatic switching** (`자동 전환 허용`) in an account's details and Azrael can recover from a *confirmed* quota-exhaustion response by moving to another healthy account of the same provider, keeping the model and reasoning setting. It is off by default.
- **Typing keeps working.** Messages sent while a switch is pending enter the durable queue and are marked as waiting for the switch.

Credentials stay out of Webviews and logs, and a running request is never silently redirected to another account.

### Any model, mid-conversation

The model picker groups models by provider, with a count per section, and one search box matches display names and model IDs across all of them.

<p align="center"><img src="docs/images/model-picker.png" alt="Model picker with OpenAI and Anthropic sections" width="420"></p>

Supported sources: native **OpenAI** and **Devin**, managed **Anthropic** (subscription OAuth), **Google AI Studio**, **Google Antigravity**, **xAI** and **OpenRouter**, plus your own **Chat Completions** or **Responses** endpoints. Available models, reasoning levels and limits depend on each connection.

A model change applies at the next turn boundary; the running turn keeps its provider, model and account. When the conversation crosses providers, the previous model writes a bounded plain-text handoff summary that becomes a compaction checkpoint, so the next model starts with context and without the other provider's encrypted reasoning. The same picker sets the model a subagent runs on.

### Context compaction that waits its turn

The context gauge shows usage against both the automatic-compaction threshold and the model's full capacity. Click **Compact context** in its card — or type `/compact` — and the request joins the conversation queue instead of interrupting the current turn.

<p align="center"><img src="docs/images/context-compaction.png" alt="Context usage card with the Compact context button" width="460"></p>

- Compaction is an engine operation, not a prompt asking the model to summarize itself.
- When it reaches the front of the queue it re-checks usage and **skips** if the context is under 15% full.
- Automatic thresholds are set **per provider** in Azrael settings: Anthropic defaults to 600,000 tokens, other providers to 95% of the model's input capacity, all capped at the model's safe usable context. Subagents resolve the policy for their own provider.

Compaction keeps a bounded summary, not every original detail. Combined with reload recovery, queued work survives a **Developer: Reload Window** without blindly re-sending accepted messages.

Details: [accounts](docs/architecture/accounts.md), [managed providers](docs/architecture/managed-providers.md), [custom API models](docs/architecture/custom-api-models.md), [context policy](docs/architecture/context-policy.md), [queued compaction](docs/architecture/queued-compaction.md), [reload recovery](docs/architecture/reload-recovery.md).

## Window Use: work alongside the agent

Classic **Computer Use** drives the whole desktop: it moves your cursor, types into whatever has focus and needs the screen to itself, so you stop working while the agent works. **Window Use** is a separate Windows feature built so that both of you can work at the same time.

![The agent controls an occluded spreadsheet window while the person keeps typing in an editor](docs/images/window-use.svg)

| | Computer Use | Window Use |
| --- | --- | --- |
| **Target** | The whole desktop | One window the agent selected |
| **Seeing** | Screenshots of the visible screen | Windows Graphics Capture of the target's own content, even when other windows cover it and without raising it |
| **Acting** | Shared mouse and keyboard | UI Automation actions on the target; no cursor movement, no shared keyboard stream, no clipboard use |
| **Your input** | Interrupted | Designed to stay with you |
| **Approval** | Its own app list | A separate app list — Computer Use approval grants no Window Use authority |

How a session runs:

1. The agent lists open windows. Each candidate shows whether another Azrael session already holds it (`available`, `occupied` or `unknown`).
2. It selects one window. The first time an app is used you approve it — for this conversation, always, or deny — in an in-chat card, also announced with a Windows notification. Allow-all is off and the approved-app list starts empty.
3. A soft glow spreads inward from the selected window's corners, and when that window is in the foreground a translucent hint reminds you that **Esc** stops control.
4. The agent inspects UI elements and acts on them — invoke, set value, toggle, select, expand, scroll — or runs a saved **task macro** (up to 32 steps, 20 seconds) in a single call. A minimized target pauses and can be restored without stealing focus.

> [!WARNING]
> **Window Use is experimental and partially verified.** Capture, inspection and status have passed on real Firefox and File Explorer windows, including an Explorer window 27.94% covered by a foreground window, and some Explorer actions have been verified. *Not* yet accepted: isolation of your physical input during simultaneous use, installed GUI/tool availability, approval notifications, the overlay, and macros on real windows. Some actions can activate the target, and background key delivery is experimental. It depends on the application exposing usable UI Automation controls, and a failure never widens authority to the whole desktop.

Details: [Window Use](docs/architecture/window-use.md), [Computer Use](docs/architecture/computer-use.md).

## Session flags

Long-running projects produce many conversations. Hover a row in **Chats** and click the flag before its timestamp to mark it; flagged rows show a **filled red flag** at all times, including the new-chat screen's recent-chat preview. Enable **Flagged only** inside the history menu's chat-type dropdown to show marked chats plus the current chat within the current filters and search. The current chat stays visible even without a flag. Click a flag again to clear it. Flagging never opens, closes or archives anything, works from the keyboard, and is stored per host and conversation.

<p align="center"><img src="docs/images/session-flags.png" alt="Chats list row with a red flag" width="576"></p>

## Platform support

Azrael targets local VS Code on **Windows x64**, **glibc Linux x64** and **Apple Silicon macOS**. Their states differ:

| Platform | Package | Verified scope |
| --- | --- | --- |
| **Windows x64** | [2026.0.5](https://github.com/felrer/Azrael/releases/tag/azrael-v2026.0.5) (latest) | Baseline platform for every feature in this README. |
| **Linux x64 (glibc)** | [2026.0.1](https://github.com/felrer/Azrael/releases/tag/azrael-v2026.0.1) | Package and installed host accepted on Ubuntu 24.04 / glibc 2.39 with native Linux VS Code through WSLg. |
| **macOS (Apple Silicon)** | Not published | Partial internal acceptance only; public distribution is deferred. |

### Not available on Linux and macOS

Unix packages ship without the Windows desktop-control payload and never start its backend; the related routes report *unavailable*. Specifically:

- **Window Use** — window discovery, background capture, UI Automation control, task macros, session occupancy, the corner-glow overlay and the Esc hint
- **Computer Use**
- **Windows approval notifications** for desktop-control consent
- **Windows native integrations** under [`native/`](native/)

Native desktop control for Unix (macOS capture/accessibility, Linux X11/Wayland) is a later candidate, not current scope.

### Verified only on Windows so far

These are part of the shared product but have no Linux or macOS acceptance yet:

- External work completion signals for scheduled root resume
- Live provider sign-in and inference, and switching between real accounts (Linux acceptance used synthetic accounts)
- Standalone Linux desktops and distributions older than Ubuntu 24.04

The Linux package was built from release 2026.0.1, earlier than the current Windows release, so features added since may be missing from it. Linux needs **glibc 2.39+, OpenSSL 3**, a desktop **Secret Service** for stored accounts and CJK fonts for Korean labels. Intel Macs, Linux ARM64, Alpine/musl, WSL as a product target, Remote SSH and containers are follow-up targets.

Details: [multi-platform contract](docs/architecture/multi-platform.md), [platform operations](docs/ops/multi-platform.md).

## Installation

### Windows

1. Install VS Code and PowerShell 7, and make sure the `code` command works.
2. From the [2026.0.5 release](https://github.com/felrer/Azrael/releases/tag/azrael-v2026.0.5) download `Azrael-2026.0.5-windows-x64.zip` and `SHA256SUMS.txt`.
3. Verify and extract into a new directory, then run the installer from PowerShell 7:

   ```powershell
   Get-FileHash .\Azrael-2026.0.5-windows-x64.zip -Algorithm SHA256   # compare with SHA256SUMS.txt
   Expand-Archive .\Azrael-2026.0.5-windows-x64.zip -DestinationPath .\Azrael-2026.0.5
   cd .\Azrael-2026.0.5
   ./install.ps1
   ```

4. In VS Code run **Developer: Reload Window**. The installer never closes or reloads windows itself.

The package carries its own runtime dependencies and Node. Runtimes go to `%LOCALAPPDATA%/azrael-ex/releases/<version>` and state to `%USERPROFILE%/.azrael-ex`; existing sign-ins and conversations are preserved. Useful options: `-ReleasesRoot`, `-StateRoot`, `-CodePath`, `-DevinExecutable` and `-PrepareOnly` (prepare without invoking VS Code). A different `-StateRoot` does not migrate existing accounts. See [app release installation](docs/ops/app-release.md#package-and-installation-contract).

### Linux

Download all four Linux assets from the [2026.0.1 release](https://github.com/felrer/Azrael/releases/tag/azrael-v2026.0.1) into one directory — `.tar.gz`, `.manifest.json`, `.SHA256SUMS.txt` and `Azrael-2026.0.1-linux-x64.INSTALL.md` — then:

```sh
sha256sum -c Azrael-2026.0.1-linux-x64.SHA256SUMS.txt
mkdir Azrael-2026.0.1-linux-x64
tar -xzf Azrael-2026.0.1-linux-x64.tar.gz -C Azrael-2026.0.1-linux-x64
cd Azrael-2026.0.1-linux-x64
./runtime/runtime/node/node install-platform-release.cjs \
  --package "$PWD" \
  --install-root "$HOME/.local/share/azrael/releases" \
  --state-root "$HOME/.azrael-ex" \
  --code "$(command -v code)"
```

Close existing Azrael sessions first and restart VS Code afterwards. The downloaded `INSTALL.md` covers Secret Service setup, prepare-only installation and recovery.

### macOS

No public package yet. Developers preparing an internal candidate should follow [platform operations](docs/ops/multi-platform.md).

## Usage

### First run

1. Reload VS Code and open the Azrael sidebar.
2. Profile menu → **Accounts and usage** → connect one or more accounts.
3. Pick a model in the composer and describe the outcome you want and any constraints.
4. Adjust compaction thresholds, instruction components and desktop-control settings in **Azrael settings**.

Provider requirements are in [provider account operations](docs/ops/provider-accounts.md); Devin setup is in [Devin operations](docs/ops/devin-native.md).

### Everyday tasks

| To… | Do this |
| --- | --- |
| Split a large task | Ask for it directly — e.g. *"Investigate the three failing modules in parallel, then fix them."* The root assigns subagents and integrates their results. |
| Wait on a long build or render | Ask the agent to run it and continue when it finishes. On the native OpenAI root path it registers a completion flag and defers instead of polling. Check or cancel the wait on **Root resume reservations**. |
| Change account | Click another account in **Accounts and usage**, or enable **Allow automatic switching** on it. |
| Change model or provider | Pick another model in the composer; it applies from the next turn. |
| Free up context | Click **Compact context** in the gauge card or type `/compact`. |
| Let the agent use an app beside you | Enable Window Use in settings, ask the agent to work in that app, approve it when asked, and press **Esc** to stop. *(Windows only.)* |
| Find a conversation later | Flag its row in **Chats**. |

## Development

### Project structure

| Path | Responsibility |
| --- | --- |
| [`engine/`](engine/) | Codex-based Azrael engine (Rust) and its source provenance |
| [`extensions/azrael-ex/`](extensions/azrael-ex/) | Accounts, usage, settings and UI integration module embedded in the integrated host |
| [`providers/`](providers/) | Provider authentication and inference integrations |
| [`native/`](native/) | Windows native features such as window control |
| [`plugins/`](plugins/) | Plugins with their skills and tools |
| [`instructions/`](instructions/) | Coordination guidance, agent roles (`agents/`), skills and examples |
| [`scripts/`](scripts/) | Build, package, render-verification, install and release tooling |
| [`docs/`](docs/) | Architecture, code maps, operations and playbooks; README images in [`docs/images/`](docs/images/) |
| `artifacts/` | Git-ignored build outputs, release inputs, packages and logs |

### Build and verify from source

Cloning alone does not supply every build input. Windows development needs PowerShell 7, Git, Node/npm, Python 3.11+, the pinned Rust toolchain and MSVC Build Tools, VS Code, the pinned official UI snapshot, a compatible `codex-code-mode-host.exe`, and matching official Codex extension and audio inputs. Devin needs Node 22.18+, and managed providers use the pinned Bun runtime. See [development prerequisites](docs/ops/development.md#prerequisites).

```powershell
./scripts/deploy-azrael.ps1 -ReleaseName '<new-release-name>' `
  -SourceRoot "$PWD/engine" `
  -EngineTargetDirectory '<absolute-rust-cache-path>' `
  -CodeModeHostPath '<absolute-path-to-codex-code-mode-host.exe>' `
  -OriginalExtensionPath '<official-codex-extension-path>' `
  -OriginalAudioPath '<matching-official-audio-extension-path>' `
  -VerifyOnly
```

`-VerifyOnly` builds, checks sources, prepares the package and verifies it in an isolated host. To install into your profile, run again with a fresh release name and without `-VerifyOnly`; the deployment already includes the build. `azrael-ex.vsix` is an intermediate package — install the verified integrated host, not the module. Linux and macOS candidates use the portable `scripts/*-platform-*.cjs` tools described in [platform operations](docs/ops/multi-platform.md); [`scripts/azrael-platforms.json`](scripts/azrael-platforms.json) owns per-platform targets and desktop-control availability.

### Contributing

Read [`AGENTS.md`](AGENTS.md) and the applicable [project playbooks](docs/playbooks/README.md) first. Freeze build inputs, keep source provenance, verify the scope you actually changed, and preserve active and rollback runtimes. Source changes, packaging, installed-host acceptance and public release are separate stages, and an untested platform is never reported as accepted.

### Documentation

- [Documentation guide](docs/README.md) — routes, ownership and status conventions (`current`, `partial`, `target`, `draft`)
- [Architecture](docs/architecture/README.md) — feature behaviour and contracts
- [Code maps](docs/maps/README.md) — where things are implemented
- [Operations](docs/ops/README.md) — development, installation, accounts and diagnosis
- [Playbooks](docs/playbooks/README.md) — verification, cleanup and work rules
- [Instruction library](instructions/README.md) — redistributable roles, skills and coordination guidance

## License and provenance

Azrael's own code and instructions are under the [MIT license](LICENSE). The Codex-based engine keeps its [Apache-2.0 license](engine/LICENSE) and [NOTICE](engine/NOTICE), with source identity in [`engine/SOURCE.json`](engine/SOURCE.json). Other imported components keep their own terms; provider integrations, runtimes, fonts and official UI redistribution conditions are listed in [third-party notices](THIRD_PARTY_NOTICES.md).
