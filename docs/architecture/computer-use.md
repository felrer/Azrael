# Computer Use

Status: `current` — Windows local integration is installed. Actual native capture, input, click and recovery, rendered consent and approval management are verified. Existing ordinary-profile windows require reload; genuine model-driven operation remains unverified for the tested account/model combination. Exact package and installation evidence are owned by the [work plan](<G:/내 드라이브/ObsidianVault/PARA/30 Project/pi-harness/Tasks/Task2/CL-01-computer-use-prototype/02-plan.md>).

## Runtime ownership

Azrael owns a version-pinned Windows Node REPL and Sky runtime in its local extension package. Required executables, dependency closure and Computer Use instructions carry source provenance and SHA-256 identities. Installation resolves paths from the selected package rather than another app's installation. The engine remains the selected Azrael engine with its existing provenance contract.

Computer Use uses the standard MCP Node REPL entry point and imports `@oai/sky`. Sky owns platform interaction and helper transport. Azrael does not implement a second helper protocol. The runtime starts without a copied external native-pipe endpoint. Missing payloads or hash mismatches block preparation or produce an explicit unavailable error.

The main engine retains its management socket. The Computer Use child execution boundary removes the parent's management socket address so a nested app-server cannot claim the same socket. The native MCP contract carries the actual turn metadata and user permission profile. Actual tests preserved `danger-full-access` and `read-only`; read-only process creation failed with `spawn EPERM` without escalation. A dedicated sandbox-state metadata field has not been independently verified. Runtime integration never substitutes a fixed full-access profile.

## Configuration and instructions

The selected Azrael package supplies the `node_repl` executable, Node executable, module paths, trusted Sky service and Computer Use instruction files. Environment synchronization applies those owned values transactionally, preserving other MCP servers and Azrael's native account/session state. Ordinary Codex configuration is a read-only source for its remaining allowlisted environment snapshot.

Package paths and hashes identify the runtime used by a prepared host and installation receipt. Configuration changes retain existing concurrent-change checks and recovery records. User/system environment variables and editor settings are not runtime configuration channels.

## User approval

Sky's MCP elicitation request is forwarded by the native engine to the existing app approval card. The user sees the app identity and chooses approval or refusal. The card's Cancel request sends native `cancel` and settles that request; the model turn can continue. Existing session and persistent choices use the runtime's native approval contract; Azrael does not silently persist an approval or approve requests automatically.

The Azrael host owns consent because the public native engine exposes generic elicitation forwarding without an app approval list/revoke store. Session grants stay in host memory and are scoped to a conversation. Persistent grants live in `~/.azrael-ex/azrael/computer-use/app-approvals.json`. The host correlates incoming request IDs with app identity and records only the user's offered, accepted persistence choice. An operation that offers session-only approval cannot consume a persistent grant automatically.

Computer Use settings query this owner and revoke its app approvals. Revocation increments an app generation so another host window invalidates its session grant on the next request. A revoked app must request approval again before further protected actions. A denied or cancelled request cannot perform the requested capture or input. Turn interruption clears that conversation's session grants and invalidates pending requests; a late acceptance cannot restore them. Fatal engine failure or host reload clears in-memory grants. Persistent state uses concurrent-write checks and atomic replacement; corrupt or unwritable state fails closed.

The existing Computer Use settings route is visible in Azrael. Its approval list is available for local Windows hosts so users can inspect and revoke local grants when upstream Electron Computer Use availability is false. Native availability, platform, account, rollout, browser/plugin and sound controls keep their existing gates. Listing or removing a stored grant does not authorize an app operation. Rendered acceptance verified the actual list, removal confirmation cancellation, confirmed removal and subsequent re-elicitation against the real owner.

## Observation and action

The agent identifies an exact target window, activates it before capture, observes its current state, and uses Sky APIs to click or type. It refreshes observation after each action and checks focus before typing. The supported initial scope is Windows apps visible on the user's interactive desktop. Foreground activation can change focus. Capture of an occluded window without activation is not an established capability of this integration. The agent verifies that returned images depict the selected target and removes unexpected captures. When physical user activity or another foreground work window conflicts with the test, it pauses desktop control until the desktop is available; repeated activation is not a way to override the user's input.

Synthetic fixture acceptance checks screenshots, accessibility state and app event output together. Actual package-owned native tests confirmed capture, text input and one click against the same synthetic app. Those tests used narrowly scoped harness consent. Separate rendered tests verified refusal, request cancellation, session repeat, persistent approval and revocation through the real host/native MCP contract with synthetic inference. Observation must be refreshed after a completed turn before acting again.

## Lifetime and recovery

Each host window retains its own main runtime and management channel. Computer Use child resources must not bind another window's management socket. Cancellation stops pending operations and releases owned resources. Two concurrent native CLI engines used separate child process chains. Two actual Code windows retained different main management sockets, and their native-managed MCP children did not inherit those addresses. Same-home revocation invalidated the other window's pending response and cached session grant.

An actual Sky helper crash recovered automatically on the next call. A Node REPL crash left the MCP transport closed; interrupting the turn, calling the supported `config/mcpServer/reload` API and making a fresh call restored the same engine/thread. Recovery does not replay the failed action or elevate permissions.

Installation replaces the registered extension with the exact validated package. Existing windows finish their work and reload to activate it. Rollback selects the previous verified release; native account and conversation data remain in `~/.azrael-ex`. Local integration does not establish permission for public redistribution of upstream binary components.

## Verification limits

The final package passed scoped source/extension tests, preparation, six-stage isolated host acceptance and actual rendered approval-management smoke. Native operation evidence is reusable because its engine and Computer Use runtime hashes match the tested payload. Ordinary-profile installation preserves original Codex files, unrelated extension registrations and editor settings; activation in already-running windows remains pending reload.

One genuine request with the existing ChatGPT authentication and `gpt-6.1-sol` was rejected with HTTP 400 because that model was unsupported for that account route. No tool call reached Sky. Synthetic inference in the rendered tests establishes the UI/native contract, while genuine model inference and model-driven Sky execution remain unverified for that combination.
