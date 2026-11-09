# Conversation Branching contract

<!-- architecture: {"id":"arch.conversation-branching.contract","feature":"conversation-branching","layers":["ui","host","engine"]} -->

Status: `current` for the single-extension host, storage and environment contracts below; `partial` where a section says so. The replacement target for the engine and provider layer is [Azrael runtime and providers](../../system/runtime-target.md). Supported commands and verification scope are owned by [development operations](../../../ops/development.md).

## Conversation branching

Status: `partial` — pinned source fixtures verify branch selection and UI eligibility; packaged/live-host acceptance is pending.

The pinned UI's completed-response branch action uses the native `thread/fork` boundary for OpenAI, managed and Devin-native conversations, including a completed response in a source whose later turn is still running. Branch eligibility keeps read-only, supported host and canonical-turn checks. Provider selection and continuity follow [conversation branching](../managed-providers/README.md#conversation-branching). The host supplies a guarded, version-pinned UI transform; the original UI snapshot and the running installed extension are preserved.
