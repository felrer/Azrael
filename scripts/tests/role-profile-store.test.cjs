"use strict";
// Retain these boundary checks: future profile/admission wiring must keep frozen
// configuration copies, native model identity and safe persistence/migration.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { RoleProfileStore } = require("../role-profile-store.cjs");
const { buildDefaultProfiles } = require("../role-profile-defaults.cjs");
const projectRoot = path.resolve(__dirname, "../..");
const run = process.env.AZRAEL_WORKBENCH_TEST_ROOT ? { temporary: process.env.AZRAEL_WORKBENCH_TEST_ROOT } : require("../artifact-run.cjs").beginArtifactRun(projectRoot, { workId: "FH-01-team-direct-profiles", owner: "scripts/tests/role-profile-store.test.cjs" });
const defaults = [
  { id: "azrael-lead", name: "Lead", allowedRoles: ["lead"], model: "main", provider: "openai", reasoningEffort: "medium", instructions: "lead", builtin: true },
  { id: "azrael-root", name: "Root", allowedRoles: ["root"], model: "main", provider: "openai", reasoningEffort: "medium", instructions: "root", builtin: true },
  { id: "sol_executor", name: "Sol", allowedRoles: ["subagent"], model: "worker", provider: "openai", reasoningEffort: "medium", instructions: "bounded", builtin: true },
  { id: "luna_explorer", name: "Luna", allowedRoles: ["subagent"], model: "luna", provider: "openai", reasoningEffort: "high", instructions: "read only", builtin: true },
];
const modelRows = ["main", "worker", "luna"].map(model => ({ id: model, modelProvider: "openai", supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }] }));
async function fixture() {
  const codexHome = await fs.mkdtemp(path.join(run.temporary, "profiles-"));
  const options = { codexHome, defaults, models: async () => modelRows };
  return { options, store: new RoleProfileStore(options) };
}
const custom = (extra = {}) => ({ ...defaults[1], builtin: undefined, id: "custom", name: "Custom", ...extra });

test("builtin sources preserve maintained workers and exact root instructions", async () => {
  const profiles = await buildDefaultProfiles(projectRoot);
  assert.equal(profiles.find(p => p.id === "sol_executor").model, "gpt-6.1-sol");
  assert.equal(profiles.find(p => p.id === "luna_explorer").reasoningEffort, "xhigh");
  assert.ok(profiles.find(p => p.id === "azrael-root").instructions.startsWith("Goals and responsibilities\n"));
  assert.match(profiles.find(p => p.id === "azrael-lead").instructions, /# Team Lead/);
  assert.deepEqual(profiles.map(p => p.allowedRoles), [["lead"], ["root"], ["subagent"], ["subagent"]]);
});

test("persistent settings and full frozen captures isolate edits and deletion", async () => {
  const { store, options } = await fixture();
  const initial = await store.snapshot(); assert.equal(initial.version, 1); assert.equal(initial.direct.rootProfileId, "azrael-root");
  await store.action("saveProfile", { profile: custom({ providerAccount: { token: "secret" }, apiKey: "secret" }) });
  await store.action("saveTeamPreset", { preset: { id: "custom-team", name: "Team", leadProfileId: "azrael-lead", rootProfileIds: ["custom"], subagentProfileIds: ["luna_explorer"] } });
  const selectedDirect = { rootProfileId: "custom", subagentProfileIds: ["sol_executor"] };
  await store.action("saveDirect", { direct: selectedDirect });
  assert.deepEqual((await store.snapshot()).direct, selectedDirect);
  const team = await store.capture("team", "custom-team"), direct = await store.capture("direct");
  assert.equal(team.profiles.find(p => p.id === "custom").instructions, "root");
  assert.ok(Object.isFrozen(team.profiles[0].allowedRoles)); assert.ok(Object.isFrozen(direct));
  assert.equal(team.profiles.find(p => p.id === "custom").apiKey, undefined);
  assert.equal(team.profiles.find(p => p.id === "custom").providerAccount, undefined);
  await store.action("saveProfile", { profile: custom({ instructions: "edited" }) });
  assert.equal(team.profiles.find(p => p.id === "custom").instructions, "root");
  assert.equal(direct.rootProfileId, "custom");
  assert.equal(direct.profiles.find(p => p.id === "custom").instructions, "root");
  assert.deepEqual(direct.subagentProfileIds, ["sol_executor"]);
  await assert.rejects(store.action("deleteProfile", { id: "custom" }), /referenced/);
  await store.action("deleteTeamPreset", { id: "custom-team" });
  // The selected Direct root reference still protects the profile.
  await assert.rejects(store.action("deleteProfile", { id: "custom" }), /referenced/);
  await store.action("saveProfile", { profile: custom({ id: "unreferenced" }) });
  await store.action("deleteProfile", { id: "unreferenced" });
  assert.equal(team.profiles.find(p => p.id === "custom").instructions, "root");
  const reopened = await new RoleProfileStore(options).snapshot(); assert.equal(reopened.profiles.find(p => p.id === "custom").instructions, "edited"); assert.ok(!reopened.profiles.some(p => p.id === "unreferenced")); assert.deepEqual(reopened.direct, selectedDirect); assert.ok(reopened.revision > initial.revision);
});

test("native provider/effort admission fails without substitution while reads retain unavailable profiles", async () => {
  const { store, options } = await fixture(); await store.snapshot();
  await assert.rejects(store.action("saveProfile", { profile: custom({ model: "absent" }) }), /Unavailable/);
  await assert.rejects(store.action("saveProfile", { profile: custom({ reasoningEffort: "ultra" }) }), /Unsupported reasoning/);
  await assert.rejects(store.action("saveProfile", { profile: custom({ provider: "account-id" }) }), /Unavailable/);
  const ambiguous = new RoleProfileStore({ ...options, models: async () => [...modelRows, { ...modelRows[0], modelProvider: "other" }] });
  await assert.rejects(ambiguous.action("saveProfile", { profile: custom({ provider: undefined }) }), /ambiguous/);
  const unavailable = new RoleProfileStore({ ...options, models: async () => [] });
  assert.equal((await unavailable.snapshot()).profiles.length, 4);
  await assert.rejects(unavailable.capture("direct"), /Unavailable/);
  await assert.rejects(unavailable.capture("team"), /Unavailable/);
  await assert.rejects(unavailable.action("saveDirect", { direct: (await store.snapshot()).direct }), /Unavailable/);
  const selected = new RoleProfileStore({ ...options, models: async () => modelRows.map(r => ({ ...r, id: "not-the-model", model: r.id })) });
  assert.equal((await selected.capture("direct")).profiles[0].model, "main");
});

test("builtin immutability, role lists, deletion references and failed writes preserve state", async () => {
  const { store } = await fixture(); const before = await store.snapshot();
  await assert.rejects(store.action("saveProfile", { profile: defaults[0] }), /read-only/);
  await assert.rejects(store.action("deleteProfile", { id: "sol_executor" }), /read-only/);
  await assert.rejects(store.action("saveDirect", { direct: { rootProfileId: "sol_executor", subagentProfileIds: [] } }), /role-incompatible/);
  await assert.rejects(store.action("saveDirect", { direct: { rootProfileId: "azrael-root", subagentProfileIds: ["azrael-root"] } }), /role-incompatible/);
  await assert.rejects(store.action("saveTeamPreset", { preset: { id: "bad", name: "Bad", leadProfileId: "azrael-root", rootProfileIds: ["azrael-root"], subagentProfileIds: [] } }), /role-incompatible/);
  await assert.rejects(store.action("saveProfile", { profile: custom({ allowedRoles: ["root", "root"] }) }), /Invalid/);
  assert.deepEqual(await store.snapshot(), before);
  await store.action("saveProfile", { profile: custom({ id: "duplicate-lead", allowedRoles: ["lead"] }) });
  assert.ok((await store.snapshot()).profiles.some(p => p.id === "duplicate-lead" && !p.builtin));
});

test("first creation safely migrates only named agent model, reasoning and instructions once", async () => {
  const { store, options } = await fixture();
  await fs.writeFile(path.join(options.codexHome, "agent.toml"), 'model="worker"\nmodel_reasoning_effort="high"\ndeveloper_instructions="migrated"\napi_key="secret"\nsandbox_mode="danger-full-access"\n');
  await fs.writeFile(path.join(options.codexHome, "config.toml"), '[agents.custom_worker]\nconfig_file="agent.toml"\ndescription="worker"\n[agents]\nmax_threads=12\n');
  const s = await store.snapshot(), migrated = s.profiles.find(p => p.id === "custom_worker");
  assert.deepEqual(migrated, { id: "custom_worker", name: "custom_worker", allowedRoles: ["subagent"], model: "worker", reasoningEffort: "high", instructions: "migrated" });
  assert.ok(!JSON.stringify(s).includes("secret"));
  await fs.writeFile(path.join(options.codexHome, "config.toml"), "invalid toml [");
  assert.deepEqual(await new RoleProfileStore(options).snapshot(), s);
  const conflict = await fixture(); await fs.writeFile(path.join(conflict.options.codexHome, "config.toml"), '[agents.sol_executor]\nmodel="main"\ndeveloper_instructions="changed"\n');
  await assert.rejects(conflict.store.snapshot(), /migration conflicts/);
  await assert.rejects(fs.access(conflict.store.file), { code: "ENOENT" });
});

test("exclusive writer lock is never stolen, concurrent commits serialize and temp files vanish", async () => {
  const { store, options } = await fixture(); await store.snapshot(); const lock = path.join(store.root, "writer.lock");
  await fs.writeFile(lock, "external-owner", { flag: "wx" });
  await assert.rejects(store.snapshot(), /locked/); assert.equal(await fs.readFile(lock, "utf8"), "external-owner"); await fs.unlink(lock);
  await Promise.all([store.action("saveProfile", { profile: custom() }), store.action("saveProfile", { profile: custom({ id: "second" }) })]);
  const s = await new RoleProfileStore(options).snapshot(); assert.ok(s.profiles.some(p => p.id === "custom")); assert.ok(s.profiles.some(p => p.id === "second"));
  assert.deepEqual(await fs.readdir(store.root), ["state.json"]);
});

test("path aliases and linked state files/ancestors fail closed", async () => {
  const { store, options } = await fixture(); await store.snapshot();
  const alias = new RoleProfileStore({ ...options, codexHome: options.codexHome.toUpperCase() });
  await assert.rejects(alias.snapshot(), /alias/);
  const linkedHome = path.join(run.temporary, "linked-home");
  await fs.symlink(options.codexHome, linkedHome, "junction");
  await assert.rejects(new RoleProfileStore({ ...options, codexHome: linkedHome }).snapshot(), /Linked/);
  await fs.unlink(linkedHome);
  const linkedState = await fixture(); await linkedState.store.snapshot();
  const actual = path.join(linkedState.options.codexHome, "state-copy.json"); await fs.rename(linkedState.store.file, actual); await fs.link(actual, linkedState.store.file);
  await assert.rejects(linkedState.store.snapshot(), /Hardlinked/); await fs.unlink(linkedState.store.file);
});

test("corrupt persisted builtin roles cannot change worker authority", async () => {
  const { store } = await fixture(); const s = await store.snapshot();
  s.profiles.find(p => p.id === "sol_executor").allowedRoles = ["root"];
  await fs.writeFile(store.file, JSON.stringify(s)); await assert.rejects(store.snapshot(), /builtin role/);
});

test("Team instances persist independent editable copies and preserve native envelope identity", async () => {
  const { store, options } = await fixture();
  const captured = await store.capture("team");
  const first = await store.createTeamConfiguration(captured, "common runtime guidance");
  const second = await store.createTeamConfiguration(captured, "other runtime guidance");
  assert.notEqual(first.configuration_path, second.configuration_path);
  assert.equal(first.role, "lead"); assert.equal(first.profile_id, "azrael-lead");
  assert.deepEqual((await store.snapshot()).teams, []);
  let s = await store.attachTeamConfiguration(first.configuration_path, "lead-one");
  s = await store.attachTeamConfiguration(second.configuration_path, "lead-two");
  const team = s.teams.find(t => t.leadThreadId === "lead-one");
  assert.ok(team); assert.equal(team.configurationPath, undefined);
  assert.ok(!JSON.stringify(s).includes(first.configuration_path));
  await assert.rejects(store.attachTeamConfiguration(first.configuration_path, "another-lead"), /already attached/);
  await assert.rejects(store.attachTeamConfiguration(path.join(store.root, "unknown.json"), "lead-three"), /Unknown/);
  const worker = team.profiles.find(p => p.id === "sol_executor");
  const before = JSON.parse(await fs.readFile(first.configuration_path, "utf8"));
  await store.action("saveTeamProfile", { teamId: team.id, profile: { ...worker, name: "Team-only worker", model: "luna", reasoningEffort: "high", instructions: "new Team worker instructions", providerAccount: { token: "secret" } } });
  const after = JSON.parse(await fs.readFile(first.configuration_path, "utf8"));
  assert.deepEqual({ ...after, profiles: [] }, { ...before, profiles: [] });
  assert.equal(after.profiles.find(p => p.id === "sol_executor").instructions, "new Team worker instructions");
  assert.equal(after.profiles.find(p => p.id === "sol_executor").model, "luna");
  assert.ok(!JSON.stringify(after).includes("secret"));
  assert.deepEqual(JSON.parse(await fs.readFile(second.configuration_path, "utf8")), second);
  assert.equal((await store.snapshot()).profiles.find(p => p.id === "sol_executor").instructions, "bounded");
  assert.equal(captured.profiles.find(p => p.id === "sol_executor").instructions, "bounded");
  assert.equal(first.profiles.find(p => p.id === "sol_executor").instructions, "bounded");
  const reopened = await new RoleProfileStore(options).snapshot();
  assert.equal(reopened.teams.find(t => t.id === team.id).profiles.find(p => p.id === "sol_executor").name, "Team-only worker");
  await assert.rejects(store.action("saveTeamProfile", { teamId: team.id, profile: { ...worker, allowedRoles: ["root"] } }), /immutable/);
  await assert.rejects(store.action("saveTeamProfile", { teamId: team.id, profile: { ...worker, id: "new-worker" } }), /immutable/);
  await assert.rejects(store.action("saveTeamProfile", { teamId: team.id, profile: { ...worker, model: "absent" } }), /Unavailable/);
  assert.deepEqual(JSON.parse(await fs.readFile(first.configuration_path, "utf8")), after);
  assert.deepEqual((await fs.readdir(path.dirname(first.configuration_path))).sort(), [path.basename(first.configuration_path), path.basename(second.configuration_path)].sort());
});

test("discard removes only exact unattached Team configuration and then its metadata", async () => {
  const { store, options } = await fixture();
  const captured = await store.capture("team");
  const pending = await store.createTeamConfiguration(captured);
  const attached = await store.createTeamConfiguration(captured);
  await store.attachTeamConfiguration(attached.configuration_path, "active-lead");
  await assert.rejects(store.discardTeamConfiguration(attached.configuration_path), /Attached/);
  await assert.rejects(store.discardTeamConfiguration(path.join(store.root, "foreign.json")), /Unknown/);
  await store.discardTeamConfiguration(pending.configuration_path);
  await assert.rejects(fs.access(pending.configuration_path), { code: "ENOENT" });
  await assert.rejects(store.attachTeamConfiguration(pending.configuration_path, "discarded-lead"), /Unknown/);
  const state = JSON.parse(await fs.readFile(store.file, "utf8"));
  assert.equal(state.teams.length, 1); assert.equal(state.teams[0].leadThreadId, "active-lead");
  assert.equal((await new RoleProfileStore(options).snapshot()).teams.length, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(attached.configuration_path, "utf8")), attached);
  // If payload absence was already independently established, retry may finish
  // the metadata transition without deleting another instance.
  const absent = await store.createTeamConfiguration(captured); await fs.unlink(absent.configuration_path);
  await store.discardTeamConfiguration(absent.configuration_path);
  assert.equal(JSON.parse(await fs.readFile(store.file, "utf8")).teams.length, 1);
});

test("Team raw policy respects native 4 MiB UTF-8 boundary on create, attach and edit", async () => {
  const { store } = await fixture(), limit = 4 * 1024 * 1024;
  const capture = JSON.parse(JSON.stringify(await store.capture("team")));
  const probe = await store.createTeamConfiguration(capture);
  await store.discardTeamConfiguration(probe.configuration_path);
  capture.profiles.forEach(p => { p.instructions = "x".repeat(950000); });
  const { nativePolicy } = require("../role-profile-runtime.cjs");
  const template = { ...nativePolicy(capture, "x"), configuration_path: probe.configuration_path };
  const contentBytes = limit - Buffer.byteLength(JSON.stringify(template, null, 2) + "\n", "utf8") + 1;
  const common = "가".repeat(Math.floor(contentBytes / 3)) + "x".repeat(contentBytes % 3);
  assert.ok(Buffer.byteLength(common, "utf8") > common.length);
  const policy = await store.createTeamConfiguration(capture, common);
  assert.equal((await fs.stat(policy.configuration_path)).size, limit);
  const original = await fs.readFile(policy.configuration_path);
  await assert.rejects(store.createTeamConfiguration(capture, common + "x"), /exceeds 4 MiB.*UTF-8/);
  assert.equal(JSON.parse(await fs.readFile(store.file, "utf8")).teams.length, 1);
  assert.deepEqual(await fs.readdir(path.dirname(policy.configuration_path)), [path.basename(policy.configuration_path)]);
  await fs.appendFile(policy.configuration_path, " ");
  await assert.rejects(store.attachTeamConfiguration(policy.configuration_path, "large-team-lead"), /exceeds 4 MiB/);
  assert.equal(JSON.parse(await fs.readFile(store.file, "utf8")).teams[0].leadThreadId, undefined);
  await fs.writeFile(policy.configuration_path, original);
  const snapshot = await store.attachTeamConfiguration(policy.configuration_path, "large-team-lead");
  const team = snapshot.teams[0], worker = team.profiles.find(p => p.id === "sol_executor");
  await assert.rejects(store.action("saveTeamProfile", { teamId: team.id, profile: { ...worker, instructions: worker.instructions + "가" } }), /exceeds 4 MiB/);
  assert.deepEqual(await fs.readFile(policy.configuration_path), original);
});

test.after(() => { if (run.lifecycleId) process.stdout.write(`ROLE_PROFILE_TEST_ARTIFACT_RUN=${run.lifecycleId}\nROLE_PROFILE_TEST_ARTIFACT_ROOT=${run.runRoot}\n`); });
