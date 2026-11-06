"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");
const [sourceRoot, ...extra] = process.argv.slice(2);
if (!sourceRoot || extra.length || !path.isAbsolute(sourceRoot) || !fs.existsSync(path.join(sourceRoot, "codex-rs/Cargo.toml"))) {
  throw new Error("Usage: check-task-profile-skills.cjs <absolute frozen engine source root>");
}
async function main() {
for (const [crate, target, filter] of [
  ["codex-config", ["--lib"], "skills_config"],
  ["codex-skills-extension", ["--lib"], "host_roots"],
  ["codex-protocol", ["--lib"], "agent_profile::tests::"],
  ["codex-login", ["--lib"], "auth::profiles::tests::profiles_remove_retires_every_cross_store_owner_even_with_active_usage"],
  ["codex-core", ["--lib"], "session::agent_profile::tests::"],
  ["codex-core", ["--lib"], "session::turn_input::tests::steering_does_not_wait_for_realtime_history"],
  ["codex-core", ["--lib"], "session::user_questions::tests::queued_reply_retains_original_profile_after_newer_turn_metadata"],
  ["codex-queue-extension", ["--test", "queue_service"], "captured_profile_survives_queue_restart_and_content_edit"],
]) {
  const result = runCargoTest(sourceRoot, ["test", "-p", crate, ...target, "--locked", "--offline", filter], { isolateHostEnvironment: true });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; return; }
}
// Exercise the real JS writer against the production Rust reader. Keeping this
// boundary in the existing native owner prevents independently valid formats
// from drifting apart during later materializer or protocol edits.
const artifacts = require("./artifact-run.cjs");
const run = artifacts.beginArtifactRun(path.resolve(__dirname, ".."), { workId: "task-profile-contract", owner: "scripts/check-task-profile-skills.cjs" });
let exitCode = 1, producerStopped = false;
try {
  const { TaskProfileRuntime } = require("./task-profile-runtime.cjs");
  const home = path.join(run.temporary, "home"), model = "contract-model", provider = "openai";
  const account = { providerId: provider, accountId: "a".repeat(32) };
  const runtime = new TaskProfileRuntime({ codexHome: home, request: async method => {
    if (method === "model/list") return { data: [{ id: model, model, modelProvider: provider, multiAgentVersion: "v2", supportedReasoningEfforts: [{ reasoningEffort: "high" }] }], nextCursor: null };
    if (method === "config/read") return { config: {} };
    throw Error(`Unexpected contract fixture request: ${method}`);
  } });
  const file = (path, content) => ({ path, content, encoding: "utf8" });
  const reference = await runtime.createWorkbench({ revision: 1, projectId: "contract-project", profile: {
    id: "contract-profile", name: "Contract", model, provider, providerAccount: account, reasoningEffort: "high",
    instructions: "Contract \ud55c\uae00 guidance", harness: { promptProfile: "builtin/azrael-default" },
  }, components: [
    { id: "skill", name: "contract-skill", kind: "skill", files: [file("SKILL.md", "---\nname: contract-skill\ndescription: Contract skill\n---\n\nRead on demand.")] },
    { id: "context", name: "Reference", kind: "context", files: [file("guide.md", "Reference \ud55c\uae00 content")] },
    { id: "role", name: "Contract worker", kind: "agent-role", files: [file("worker.toml", 'description="Contract worker"\ndeveloper_instructions="Check the selected input"')] },
  ] });
  const result = runCargoTest(sourceRoot, ["test", "-p", "codex-core", "--lib", "--locked", "--offline", "session::agent_profile::tests::materializer_snapshot_contract_fixture", "--", "--ignored", "--exact"], {
    isolateHostEnvironment: true, env: { ...process.env, TASK_PROFILE_CONTRACT_HOME: home, TASK_PROFILE_CONTRACT_DIGEST: reference.digest,
      TASK_PROFILE_CONTRACT_MODEL: model, TASK_PROFILE_CONTRACT_PROVIDER: provider, TASK_PROFILE_CONTRACT_ACCOUNT: JSON.stringify(account) },
  });
  producerStopped = !result.error && Number.isInteger(result.status);
  if (result.error) throw result.error;
  exitCode = result.status ?? 1;
  fs.writeFileSync(path.join(run.reports, "contract.json"), JSON.stringify({ digest: reference.digest, exitCode, scope: "actual JS materializer to native profile loader" }, null, 2));
  process.exitCode = exitCode;
} finally {
  artifacts.finishArtifactRun(run, { exitCode, producerStopped, reason: producerStopped ? "Synchronous native contract reader completed" : "Native contract reader termination was not confirmed" });
}
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
