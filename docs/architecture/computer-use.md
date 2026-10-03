# Computer Use

Status: `target` — approved Windows integration contract. Prototype execution establishes feasibility; installed-host acceptance is tracked in the [work plan](<G:/내 드라이브/ObsidianVault/PARA/30 Project/pi-harness/Tasks/Task2/CL-01-computer-use-prototype/02-plan.md>).

## Runtime ownership

Azrael owns a version-pinned Windows Node REPL and Sky runtime in its local extension package. Required executables, dependency closure and Computer Use instructions carry source provenance and SHA-256 identities. Installation resolves paths from the selected package rather than another app's installation. The engine remains the selected Azrael engine with its existing provenance contract.

Computer Use uses the standard MCP Node REPL entry point and imports `@oai/sky`. Sky owns platform interaction and helper transport. Azrael does not implement a second helper protocol. The runtime starts without a copied external native-pipe endpoint. Missing payloads or hash mismatches block preparation or produce an explicit unavailable error.

The main engine retains its management socket. The Computer Use child execution boundary removes the parent's management socket address so a nested app-server cannot claim the same socket. The actual engine sandbox-state metadata and user permission profile pass through the native MCP contract. Runtime integration never substitutes a fixed full-access profile.

## Configuration and instructions

The selected Azrael package supplies the `node_repl` executable, Node executable, module paths, trusted Sky service and Computer Use instruction files. Environment synchronization applies those owned values transactionally, preserving other MCP servers and Azrael's native account/session state. Ordinary Codex configuration is a read-only source for its remaining allowlisted environment snapshot.

Package paths and hashes identify the runtime used by a prepared host and installation receipt. Configuration changes retain existing concurrent-change checks and recovery records. User/system environment variables and editor settings are not runtime configuration channels.

## User approval

Sky's MCP elicitation request is forwarded by the native engine to the existing app approval card. The user sees the app identity and chooses approval or refusal. Existing session and persistent choices use the runtime's native approval contract; Azrael does not silently persist an approval or approve requests automatically.

The Azrael host owns consent because the public native engine exposes generic elicitation forwarding without an app approval list/revoke store. Session grants stay in host memory and are scoped to a conversation. Persistent grants live in `~/.azrael-ex/azrael/computer-use/app-approvals.json`. The host correlates incoming request IDs with app identity and records only the user's offered, accepted persistence choice. An operation that offers session-only approval cannot consume a persistent grant automatically.

Computer Use settings query this owner and revoke its app approvals. Revocation increments an app generation so another host window invalidates its session grant on the next request. A revoked app must request approval again before further protected actions. A denied or cancelled request cannot perform the requested capture or input. Turn interruption clears that conversation's session grants and invalidates pending requests; a late acceptance cannot restore them. Fatal engine failure or host reload clears in-memory grants. Persistent state uses concurrent-write checks and atomic replacement; corrupt or unwritable state fails closed.

## Observation and action

The agent identifies an exact target window, activates it before capture, observes its current state, and uses Sky APIs to click or type. It refreshes observation after each action and checks focus before typing. The supported initial scope is Windows apps visible on the user's interactive desktop. Foreground activation can change focus. Capture of an occluded window without activation is not an established capability of this integration. The agent verifies that returned images depict the selected target and removes unexpected captures. When physical user activity or another foreground work window conflicts with the test, it pauses desktop control until the desktop is available; repeated activation is not a way to override the user's input.

Synthetic fixture acceptance checks screenshots, accessibility state and app event output together. Approval UI acceptance uses the product route rather than prototype automatic responses.

## Lifetime and recovery

Each host window retains its own main runtime and management channel. Computer Use child resources must not bind another window's management socket. Cancellation stops pending operations and releases owned resources; helper failure becomes a visible tool error. A subsequent call can establish a fresh runtime rather than reusing a failed process.

Installation replaces the registered extension with the exact validated package. Existing windows finish their work and reload to activate it. Rollback selects the previous verified release; native account and conversation data remain in `~/.azrael-ex`. Local integration does not establish permission for public redistribution of upstream binary components.
