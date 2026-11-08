# Session MCP reload and incremental tool context

Status: implemented; selected native checks are accepted on Windows x64. Verification and cleanup are tracked in [GL-01](../../work/GL-01-mcp-session-reload/01-plan.md). This contract does not establish installed-host, live-provider cache-hit or non-Windows acceptance. Preservation feature: `tool.mcp-reload` in the [feature inventory](../../scripts/azrael-feature-contracts.json).

## Agent reload

The built-in `reload_mcp_servers` tool reloads MCP declarations for the calling session, including sessions with no configured MCP servers. It does not invoke the app-server API that refreshes every loaded thread. Existing tool policy, profile selection, execution-environment eligibility, authentication and managed restrictions still apply.

The tool rereads only `mcp_servers` from already admitted, enabled local user/profile and project configuration files. It retains other settings, disabled/untrusted layers, session overrides and managed-policy bindings. It does not discover new project layers, fetch a new enterprise policy, write configuration, install servers, grant authority, perform OAuth login, compact history or switch threads. Invalid configuration does not publish a replacement. Policy rejection and concurrent publication failures return failure rather than claiming readiness.

An empty `reconnect_servers` list reuses unchanged connections. Named enabled, eligible servers are explicitly excluded from connection reuse for their next publication, allowing development code/schema changes with unchanged configuration. Other connections and already captured in-flight bindings remain intact. Agent callers should finish active calls to a selected server before requesting its reconnect. Cancellation preserves unconsumed reconnect requests.

The result reports readiness per enabled, registered server and the discovered tool count. Readiness waits are bounded; failure, cancellation or timeout cannot be reported as successful application. Configuration may already have been published before an interrupted readiness wait. New tools become available on the next model step; the calling Code Mode cell retains its captured catalog. Resource caches may be invalidated by configuration refresh, but saved conversation content is not deleted.

## Incremental model context

`incremental_tools` is stable and enabled by default. It operates only for model routes whose catalog declares `use_responses_lite`; explicit opt-out and non-Lite request behavior remain supported. Existing context windows retain their recorded mode until window replacement, preventing a default change from rewriting legacy prompt prefixes.

In incremental windows, initial tool definitions are recorded in history. Changes append only new or changed definitions and explicit withdrawal notices; the current registry remains authoritative for execution. Unchanged definitions are not repeated. Other instruction projection and provider changes can independently affect prompt caching; this feature does not guarantee a server cache hit or particular cost/latency.

Compaction constructs a fresh full declaration from the replacement step's current registry and records its comparison baseline. Removed tools must not reappear, and old tool deltas are not the source of truth for the new window. Changes after the captured replacement snapshot are handled by the subsequent step's normal diff.

## Platform and verification boundary

The behavior contract is common to intended native Windows, macOS and Linux targets; server process launch and filesystem access remain owned by their existing platform/environment implementations. Local configuration reloading does not add remote configuration-file discovery. Verification must distinguish scripted model-loop request-prefix preservation from real provider cache-token measurements.

Mandatory checks cover native same-turn reload and MCP execution, unchanged-connection reuse, named reconnect and fresh schemas, prefix preservation, tool removal, compaction/resume, disabled local layers, cancellation restoration and explicit feature opt-out. Commands are registered through the existing selected-native checker rather than a second runtime implementation.

The selected Windows verification covers 20 state/policy cases and seven scripted model-loop cases. These assert input prefix preservation, declaration changes and withdrawal order directly; five previous whole-context snapshots were retired after their replacement checks passed. This intentionally does not retain incidental whole-prompt wording or unrelated tool inventories. Tests use isolated temporary project boundaries. Broader agent-namespace and service-auth manifest failures remain separately recorded in GL-01.
