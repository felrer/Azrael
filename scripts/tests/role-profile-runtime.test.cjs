"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { RoleProfileRuntime, nativePolicy, materializePolicy } = require("../role-profile-runtime.cjs");

function capture(mode = "direct") {
  return { mode, leadProfileId: "lead", rootProfileId: "root", rootProfileIds: ["root"], subagentProfileIds: ["worker"], profiles: [
    { id: "lead", name: "Lead", allowedRoles: ["lead"], model: "lead-model", provider: "openai", reasoningEffort: "high", instructions: "Lead-only guidance" },
    { id: "root", name: "Root", allowedRoles: ["root"], model: "root-model", provider: "openai", reasoningEffort: "medium", instructions: "Root-only guidance" },
    { id: "worker", name: "Worker", allowedRoles: ["subagent"], model: "worker-model", provider: "openai", instructions: "Worker-only guidance" },
  ] };
}

test("unified role admission materializes resource pins while absent models inherit", async () => {
  const selected = capture("team"); selected.revision = 2;
  const root = selected.profiles.find(p => p.id === "root");
  delete root.model; root.optionalSelection = "selected-only"; root.mcpServerIds = ["selected-server"]; root.components = [];
  let calls = 0;
  const policy = await materializePolicy(selected, "Common", async (snapshot, options) => {
    calls++; assert.equal(snapshot.profile.id, "root"); assert.equal(snapshot.roleProfile, true);
    assert.equal(options.cwd, "project"); return { digest: "a".repeat(64), revision: snapshot.revision };
  }, { cwd: "project" });
  assert.equal(calls, 1);
  const native = policy.profiles.find(p => p.id === "root");
  assert.equal(native.model, undefined); assert.deepEqual(native.profile_extension.mcpServerIds, ["selected-server"]);
  assert.equal(native.profile_extension.agentProfile.digest, "a".repeat(64));
  root.diagnostics = [{ code: "missing" }];
  await assert.rejects(materializePolicy(selected, "Common", () => { throw Error("must not materialize invalid resources"); }), /diagnostics/);
});

// Retained: host forwarding edits must not restore caller policy/model bypasses or
// apply current defaults on resume; Team creation must retain its captured choice.
test("fresh Direct admission uses trusted profiles and preserves common context separately", async () => {
  const modes = [];
  const runtime = new RoleProfileRuntime({ capture: async mode => { modes.push(mode); return capture(); }, createTeamConfiguration: () => { throw Error("Direct cannot create Team configuration"); } });
  const params = { model: "caller-model", modelProvider: "caller-provider", developerInstructions: "Project rules", approvalPolicy: "on-request", config: { keep: true, role_profile: { profile_id: "attacker" }, model_reasoning_effort: "low" } };
  const result = await runtime.prepare("local", "thread/start", params);
  assert.deepEqual(modes, ["direct"]);
  assert.equal(result.model, "root-model"); assert.equal(result.modelProvider, "openai");
  assert.equal(result.config.model_reasoning_effort, "medium"); assert.equal(result.config.keep, true);
  assert.equal(result.approvalPolicy, "on-request");
  assert.equal(result.developerInstructions, "Project rules\n\nRoot-only guidance");
  const policy = result.config.role_profile;
  assert.equal(policy.role, "root"); assert.equal(policy.profile_id, "root");
  assert.equal(policy.base_developer_instructions, "Project rules");
  assert.deepEqual(policy.subagent_profile_ids, ["worker"]);
  assert.equal(policy.profiles.find(p => p.id === "worker").instructions, "Worker-only guidance");
  assert.equal(params.config.role_profile.profile_id, "attacker");
  const resume = { threadId: "existing", model: "saved-manual-model", config: { model_reasoning_effort: "low" } };
  assert.equal(await runtime.prepare("local", "thread/resume", resume), resume);
  assert.equal(await runtime.prepare("remote", "thread/start", params), params);
  assert.equal(modes.length, 1);
});

test("Team admission uses the captured preset and native configuration without recapturing Direct", async () => {
  const saved = capture("team"), common = "Shared project rules";
  let configurationCalls = 0;
  const runtime = new RoleProfileRuntime({ capture: () => { throw Error("Must not recapture Team"); }, createTeamConfiguration: async (selected, base) => {
    configurationCalls++; assert.equal(selected, saved); assert.equal(base, common);
    return { ...nativePolicy(selected, base), configuration_path: "native-config" };
  } });
  const result = await runtime.prepare("local", "thread/start", { developerInstructions: common, config: { role_profile: { role: "root" } } }, saved);
  assert.equal(configurationCalls, 1);
  assert.equal(result.model, "lead-model"); assert.equal(result.config.role_profile.role, "lead");
  assert.equal(result.config.role_profile.configuration_path, "native-config");
  assert.equal(result.developerInstructions, common + "\n\nLead-only guidance");
  assert.equal(result.config.role_profile.base_developer_instructions, common);
  await assert.rejects(runtime.prepare("remote", "thread/start", {}, saved), /native local host/);
  const incompatible = capture(); incompatible.rootProfileId = "worker";
  assert.throws(() => nativePolicy(incompatible, common), /cannot serve this role/);
  const broken = new RoleProfileRuntime({ capture: async () => { throw Error("profile unavailable"); } });
  await assert.rejects(broken.prepare("local", "thread/start", {}), /profile unavailable/);
});
