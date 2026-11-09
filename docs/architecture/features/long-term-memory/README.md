# Long Term Memory contract

<!-- architecture: {"id":"arch.long-term-memory.contract","feature":"long-term-memory","layers":["host","engine"]} -->

Status: `partial`. The source library, release builder, download/install backend,
service and settings integration are implemented and covered by local tests.
Public release publication and live GitHub acquisition are pending the distribution
hold. Installed native settings acceptance and a portable integrated public package
are separate release gates. See [operations](../../../ops/instruction-distribution.md).

## Automatic long-term memories

Status: `partial`. The source policy disables automatic long-term memories in the Azrael runtime; native, packaged and installed-host acceptance remains pending. Preservation owner: `engine.shared-engine` in the [feature inventory](../../../../scripts/azrael-feature-contracts.json).

`Config::long_term_memories_enabled()` combines the existing Azrael management-socket runtime identity with the memory feature gate. Azrael always rejects this capability even when user settings enable `MemoryTool`, memory generation, use or dedicated tools. The write startup entry returns before extraction, consolidation, pruning or layout creation. The memories extension applies the same gate on thread start and configuration changes, so summary/instruction injection and dedicated memory tools remain absent on startup, resume and child sessions.

This policy preserves stored memory files and databases. Ordinary shared CLI execution without the Azrael runtime marker retains its configured memory behavior; a CLI process inheriting that marker is treated as Azrael. Conversation compaction, provider handoff summaries and local [task memory](../task-memory/README.md) keep their existing owners and behavior. The policy has common meaning on Windows x64, glibc Linux x64 and macOS ARM64; source inspection alone does not establish native acceptance on those targets.
