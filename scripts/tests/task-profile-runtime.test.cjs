"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { HOST_METHODS } = require("../inject-task-profile.cjs");
const { TaskProfileRuntime, validateHarness } = require("../task-profile-runtime.cjs");
const { packageDigest, canonicalDigest } = require("../instruction-library.cjs");
const { InstructionWorkbenchRuntime } = require("../instruction-workbench-runtime.cjs");
test("profile selection snapshots preserve empty and selected optional sets with inherited models", async t => {
  const { runtime } = await fixture(t, { config: { model: "model" } });
  const capture = { revision: 1, projectId: "A", profile: { id: "custom", name: "Custom", optionalSelection: "selected-only", mcpServerIds: [] }, components: [] };
  const empty = await runtime.createWorkbench(capture), snapshot = await runtime.readSnapshot(empty.digest);
  assert.deepEqual(snapshot.resourceSelection, { mode: "selected-only", mcpServerIds: [] });
  assert.equal(snapshot.inheritModel, true); assert.equal(snapshot.model, "model");
  capture.profile.model = "model";
  capture.profile.mcpServerIds = ["selected-server"];
  const selected = await runtime.readSnapshot((await runtime.createWorkbench(capture)).digest);
  assert.deepEqual(selected.resourceSelection, { mode: "selected-only", mcpServerIds: ["selected-server"] });
  assert.equal(selected.inheritModel, undefined);
  assert.notEqual(selected.digest, empty.digest);
  capture.components = [
    { id: "second", name: "Second", kind: "context", loading: "persistent", order: 2, files: [file("guide.md", "Second persistent instruction")] },
    { id: "first", name: "First", kind: "context", loading: "persistent", order: 1, files: [file("guide.md", "First persistent instruction")] },
  ];
  const ordered = await runtime.readSnapshot((await runtime.createWorkbench(capture)).digest);
  assert(ordered.context.indexOf("First persistent instruction") < ordered.context.indexOf("Second persistent instruction"));
  capture.profile.diagnostics = [{ code: "resource-unavailable" }];
  await assert.rejects(runtime.createWorkbench(capture), /diagnostics/);
});
const catalog = [{ id: "model", model: "model", modelProvider: "openai", multiAgentVersion: "v2", defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high" }] }];
function pkg(kind, name, files, profile) { const entry = { id: name, kind, name, sharing: "local", files, ...(profile ? { profile } : {}) }; entry.digest = packageDigest(entry); return entry; }
const file = (name, content) => ({ path: name, content, encoding: "utf8" });
function value(options = {}) {
  const packages = [pkg("task-profile", "task", [], { model: "model", dependencies: [], ...(options.harness ? { harness: options.harness } : {}) }), pkg("skill", "selected", [file("SKILL.md", "---\nname: selected\ndescription: selected task skill\n---\n\nSelected")]), pkg("context", "guide", [file("guide.md", "Long reference [asset](asset.txt)"), file("asset.txt", "asset")])];
  if (options.role) packages.push(pkg("agent-role", "task_worker", [file("role.toml", options.role)]));
  const result = { profileId: "task", model: options.model ?? "model", packages, instructions: [{ id: "task", text: "Short task guidance", loading: "persistent" }, { id: "guide", text: "Long reference", loading: "on-demand" }] };
  result.digest = canonicalDigest(result); return result;
}
async function fixture(t, overrides = {}) {
  const home = await fs.mkdtemp(path.join(process.env.AZRAEL_WORKBENCH_TEST_ROOT ?? os.tmpdir(), "azrael-task-"));
  t.after(async () => { await fs.rm(home, { recursive: true }); });
  const requests = [];
  const request = async (method, params) => { requests.push({ method, params }); return method === "model/list" ? { data: overrides.models ?? catalog, nextCursor: null } : { config: { developer_instructions: "Native project rules", ...overrides.config } }; };
  return { home, requests, runtime: new TaskProfileRuntime({ codexHome: home, request, ...overrides.runtime }), request };
}

// Retained: forwarding/capture changes must keep caller-controlled refs out of admission.
test("native workbench admission freezes bytes and exposes only typed public refs", async t => {
  const { runtime } = await fixture(t), source = value();
  const capture = { revision: 4, projectId: "native-project", profile: { id: "active", name: "Active", allowedRoles: ["root"], model: "model", instructions: "Frozen guidance" }, components: source.packages.filter(p => p.kind !== "task-profile") };
  const metadata = '{"model":"must-not-apply","provider":"another-account","dependencies":[]}';
  capture.components.push({ id: "nested-profile", name: "Nested metadata", kind: "task-profile", files: [file("PROFILE.json", metadata)] });
  const original = JSON.stringify(capture), admissions = [];
  const host = new InstructionWorkbenchRuntime({ taskRuntime: runtime, capture: async input => { admissions.push(input); return capture; }, workspaceProject: async () => ({ id: "native-project" }), request: async () => ({ agentProfileMode: "direct", thread: { projectId: "native-project" } }) });
  const result = await host.prepare("local", "turn/start", { threadId: "thread", agentProfile: { digest: "untrusted" } });
  assert.deepEqual(Object.keys(result.agentProfile).sort(), ["digest", "projectId", "revision"]);
  assert.equal(result.agentProfile.projectId, "native-project"); assert.equal(result.agentProfile.revision, 4);
  assert.equal(admissions[0].threadId, "thread"); assert.equal(JSON.stringify(capture), original);
  const snapshot = await runtime.readSnapshot(result.agentProfile.digest);
  assert.match(snapshot.context, /Frozen guidance/); assert.deepEqual(snapshot.allowedRoles,["root"]); assert.equal(runtime.drafts.size, 0);
  assert.equal(snapshot.model, "model"); assert(!snapshot.context.includes("must-not-apply"));
  const metadataFile = Object.keys(snapshot.files).find(name => name.endsWith("references/PROFILE.json"));
  assert.equal(Buffer.from(snapshot.files[metadataFile], "base64").toString(), metadata);
  assert(Object.values(snapshot.files).some(data => Buffer.from(data, "base64").toString().includes("[PROFILE.json](<references/PROFILE.json>)")));
  capture.profile.instructions = "Changed guidance";
  assert.match((await runtime.readSnapshot(result.agentProfile.digest)).context, /Frozen guidance/);
  capture.components.push({ id: "role-id", name: "한국어 표시 이름", kind: "agent-role", files: [file("worker.toml", 'developer_instructions="Work independently"')] });
  const queued = await host.prepare("local", "thread/queue/add", { threadId: "thread" });
  assert.notEqual(queued.agentProfile.digest, result.agentProfile.digest);
  assert(Object.keys((await runtime.readSnapshot(queued.agentProfile.digest)).config).some(key => /^agents\.workbench_[a-f0-9]{20}\.config_file$/.test(key)));
  capture.profile = null;
  assert.equal((await host.prepare("local", "turn/start", { threadId: "thread", agentProfile: result.agentProfile })).agentProfile, undefined);
  const update = { agentProfile: result.agentProfile }; assert.equal(await host.prepare("local", "thread/queue/update", update), update); assert.equal(await host.prepare("local", "turn/steer", update), update);
  assert.deepEqual(Object.keys((await host.context()).models[0]).sort(), ["defaultReasoningEffort", "id", "model", "modelProvider", "supportedReasoningEfforts"]);
});

test("native admission requires actual association and skips capture without a project", async t => {
  const { runtime } = await fixture(t); let captureCalls = 0, response = { agentProfileMode: "direct", thread: { projectId: null } };
  const host = new InstructionWorkbenchRuntime({ taskRuntime: runtime, capture: async () => { captureCalls++; }, workspaceProject: async () => null, request: async () => response });
  assert.deepEqual(await host.prepare("local", "turn/start", { threadId: "t", agentProfile: {} }), { threadId: "t" }); assert.equal(captureCalls, 0);
  response = { thread: {} }; await assert.rejects(host.prepare("local", "turn/start", { threadId: "t" }), /association/);
  response = { thread: { projectId: "native-project" } };
  await assert.rejects(host.prepare("local", "turn/start", { threadId: "t" }), /profile mode/);
  for (const agentProfileMode of ["team", "role"]) {
    response = { agentProfileMode, thread: { projectId: "native-project" } };
    assert.deepEqual(await host.prepare("local", "turn/start", { threadId: "t", agentProfile: { digest: "caller" } }), { threadId: "t" });
  }
  assert.equal(captureCalls, 0);
});

test("captured account scope is immutable and integrity protected while legacy snapshots omit it", async t => {
  const { runtime } = await fixture(t), legacy = value();
  await runtime.create(legacy);
  const old = await runtime.readSnapshot(legacy.digest);
  assert.equal(Object.hasOwn(old, "providerAccount"), false);
  const scope = { providerId: "openai", accountId: "a".repeat(32) };
  const capture = { revision: 2, projectId: "project", profile: { id: "active", name: "Active", model: "model", providerAccount: scope }, components: [] };
  const ref = await runtime.createWorkbench(capture), snapshot = await runtime.readSnapshot(ref.digest);
  assert.deepEqual(snapshot.providerAccount, scope);
  const { integrity, ...body } = snapshot; assert.equal(integrity, canonicalDigest(body));
  scope.accountId = "b".repeat(32);
  assert.equal((await runtime.readSnapshot(ref.digest)).providerAccount.accountId, "a".repeat(32));
  snapshot.providerAccount.accountId = scope.accountId;
  await fs.writeFile(path.join(runtime.root, ref.digest, "snapshot.json"), JSON.stringify(snapshot));
  await assert.rejects(runtime.readSnapshot(ref.digest), /integrity/);
  for (const invalid of [null, [], {}, { providerId: "openai" }, { providerId: "", accountId: "account" }, { providerId: "openai", accountId: 42 }, { providerId: "openai", accountId: "account", token: "private" }]) {
    await assert.rejects(runtime.createWorkbench({ ...capture, profile: { ...capture.profile, providerAccount: invalid } }), /provider account scope/);
  }
});

test("question replies preserve native task capture while user input and compaction capture anew", async () => {
  const calls = [], ref = { digest: "captured", revision: 1 }, capture = { projectId: "project" };
  const host = new InstructionWorkbenchRuntime({ taskRuntime: { createWorkbench: async () => ref }, capture: async () => { calls.push("capture"); return capture; }, request: async () => { calls.push("thread/read"); return { agentProfileMode: "direct", thread: { projectId: "project" } }; } });
  const reply = { threadId: "thread", kind: "questionReply", input: [], agentProfile: { digest: "caller" } };
  assert.deepEqual(await host.prepare("local", "thread/queue/add", reply), { threadId: "thread", kind: "questionReply", input: [] });
  assert.deepEqual(calls, []);
  for (const kind of [undefined, null, "userInput", "contextCompaction"]) {
    const admitted = await host.prepare("local", "thread/queue/add", { threadId: "thread", kind, input: [] });
    assert.deepEqual(admitted.agentProfile, ref);
  }
  assert.equal(calls.filter(call => call === "capture").length, 4);
});

test("host retains legacy thread profiles without mixing project admission refs", async t => {
  const { runtime, home } = await fixture(t), view = {}, draft = await runtime.create(value());
  runtime.bind(draft.token, view);
  const captures = [];
  const context = { process, __dirname, require: name => name.endsWith("role-profile-runtime.cjs") ? require("../role-profile-runtime.cjs") : require(name), Mt: { commands: { executeCommand: async (command, args) => {
    assert.equal(command, "azrael.captureRoleProfile"); assert.deepEqual(JSON.parse(JSON.stringify(args)), { mode: "direct" }); captures.push(args);
    return { mode: "direct", rootProfileId: "direct-root", rootProfileIds: ["direct-root"], subagentProfileIds: [], profiles: [{ id: "direct-root", name: "Direct", allowedRoles: ["root"], model: "direct-model", provider: "openai", reasoningEffort: "high", instructions: "Direct root guidance" }] };
  } } } };
  vm.runInNewContext(`globalThis.Host = class { ${HOST_METHODS} }`, context);
  const host = new context.Host(); host.azraelTaskRuntime = runtime; host.azraelTaskHome = home;
  host.azraelWorkbenchRuntime = async () => { throw Error("Legacy profile must not capture a project profile"); };
  const started = await host.azraelPrepareTaskRequest(view, "local", 100, "thread/start", { __azraelTaskProfileDraft: { token: draft.token }, agentProfile: { digest: "attacker" } });
  assert.equal(started.agentProfile, undefined); assert.equal(started.model, "direct-model");
  assert.equal(started.config.role_profile.role, "root"); assert.equal(started.config.role_profile.profile_id, "direct-root");
  assert.match(started.config.role_profile.base_developer_instructions, /^Native project rules\n\n\[Task profile context: task\]/);
  assert.match(started.config.role_profile.base_developer_instructions, /Short task guidance/);
  assert(!started.config.role_profile.base_developer_instructions.includes("Direct root guidance"));
  assert.equal(started.developerInstructions, started.config.role_profile.base_developer_instructions + "\n\nDirect root guidance");
  assert.equal(started.config["skills.extra_roots"].length, 1);
  await runtime.finish({ id: 100, result: { thread: { id: "legacy" } } });
  const resumed = await host.azraelPrepareTaskRequest(view, "local", 101, "thread/resume", { threadId: "legacy", agentProfile: { digest: "attacker" } });
  assert.equal(resumed.agentProfile, undefined); assert.equal(resumed.model, "model");
  const first = await host.azraelPrepareTaskRequest(view, "local", 102, "turn/start", { threadId: "legacy", agentProfile: { digest: "attacker" } });
  assert.equal(first.agentProfile, undefined); assert.equal(first.model, "model");
  const queued = await host.azraelPrepareTaskRequest(view, "local", 103, "thread/queue/add", { threadId: "legacy", agentProfile: { digest: "attacker" } });
  assert.equal(queued.agentProfile, undefined);
  assert.equal(captures.length, 1); // Resume and turns keep the existing task snapshot without rebinding Direct defaults.
});

test("native project invalidation refreshes workbench context through its internal command", async () => {
  const calls = [], context = { require, process, console, Re: { LOCAL_PROJECTS: "local-projects", SELECTED_PROJECT: "selected-project" }, Mt: { commands: { executeCommand: async (...args) => { calls.push(args); } } } };
  vm.runInNewContext(`globalThis.Host = class { ${HOST_METHODS} }`, context);
  const host = new context.Host();
  host.azraelWorkbenchContextChanged({ type: "global-state-updated", keys: ["unrelated"] });
  host.azraelWorkbenchContextChanged({ type: "thread-project-memberships-updated", keys: ["selected-project"] });
  assert.equal(calls.length, 0);
  host.azraelWorkbenchContextChanged({ type: "global-state-updated", keys: ["local-projects", "selected-project"], project: { id: "untrusted" } });
  assert.deepEqual(calls, [["azrael.workbenchContextChanged"]]);
});
test("selected new conversation captures model, isolated roots, additive context, and referenced files", async t => {
  const { runtime, requests } = await fixture(t), v = value(), view = {};
  const draft = await runtime.create(v); runtime.bind(draft.token, view);
  assert.deepEqual(runtime.bootstrap(view), { token: draft.token }); assert.equal(runtime.bootstrap(view), null);
  const ordinary = { model: "other" }; assert.equal(await runtime.prepare({}, "local", 1, "thread/start", ordinary), ordinary);
  const params = await runtime.prepare(view, "local", 2, "thread/start", { __azraelTaskProfileDraft: { token: draft.token }, cwd: process.cwd(), baseInstructions: "Runtime authority", config: { retained: true } });
  assert.equal(params.baseInstructions, "Runtime authority"); assert.equal(params.model, "model"); assert.equal(params.modelProvider, "openai"); assert.equal(params.config.retained, true);
  assert.match(params.developerInstructions, /^Native project rules\n\n\[Task profile context: task\]/); assert(!params.developerInstructions.includes("Long reference"));
  assert.equal(params.config["skills.extra_roots"].length, 1); assert(!requests.some(r => r.method === "skills/extraRoots/set"));
  const snapshot = await runtime.readSnapshot(v.digest); assert(Object.keys(snapshot.files).some(p => p.endsWith("references/asset.txt")));
  assert.equal(await runtime.prepare({}, "local", 3, "thread/start", ordinary), ordinary);
});
test("view tampering, marker tampering, replay, remote activation, and expired tokens fail closed", async t => {
  let now = 0; const { runtime } = await fixture(t, { runtime: { now: () => now, ttlMs: 10 } }); const view = {};
  const draft = await runtime.create(value()); runtime.bind(draft.token, view);
  await assert.rejects(runtime.prepare({}, "local", 1, "thread/start", { __azraelTaskProfileDraft: { token: draft.token } }), /another view/);
  await assert.rejects(runtime.prepare(view, "remote", 1, "thread/start", { __azraelTaskProfileDraft: { token: draft.token } }), /Invalid/);
  await assert.rejects(runtime.prepare(view, "local", 1, "thread/start", { __azraelTaskProfileDraft: { token: draft.token, model: "other" } }), /Invalid/);
  await runtime.prepare(view, "local", 1, "thread/start", { __azraelTaskProfileDraft: { token: draft.token } });
  await assert.rejects(runtime.prepare(view, "local", 2, "thread/start", { __azraelTaskProfileDraft: { token: draft.token } }), /expired/);
  const expired = await runtime.create(value()); runtime.bind(expired.token, view); now = 11;
  await assert.rejects(runtime.prepare(view, "local", 3, "thread/start", { __azraelTaskProfileDraft: { token: expired.token } }), /expired/);
});
test("only successful selected starts persist and cold resume keeps frozen identity", async t => {
  const { runtime, home, request, requests } = await fixture(t), view = {}, v = value();
  const draft = await runtime.create(v); runtime.bind(draft.token, view);
  await runtime.prepare(view, "local", 1, "thread/start", { __azraelTaskProfileDraft: { token: draft.token }, cwd: process.cwd() });
  await runtime.finish({ id: 1, result: { thread: { id: "selected" } } });
  const cold = new TaskProfileRuntime({ codexHome: home, request });
  const resumed = await cold.prepare({}, "local", 2, "thread/resume", { threadId: "selected", developerInstructions: "Preserved" });
  assert.match(resumed.developerInstructions, /^Native project rules\n\nPreserved\n\n/); assert.equal(resumed.model, "model");
  assert.equal(requests.findLast(r => r.method === "config/read").params.cwd, process.cwd());
  const unrelated = { threadId: "other" }; assert.equal(await cold.prepare({}, "local", 3, "thread/resume", unrelated), unrelated);
  const next = await runtime.create(v); runtime.bind(next.token, view);
  await runtime.prepare(view, "local", 4, "thread/start", { __azraelTaskProfileDraft: { token: next.token } }); await runtime.finish({ id: 4, error: { message: "failure" } });
  assert.deepEqual(Object.keys((await cold.registry()).threads), ["selected"]);
});
test("unavailable models and role model overrides are rejected without substitution", async t => {
  const { runtime } = await fixture(t);
  await assert.rejects(runtime.create(value({ model: "unknown" })), /unavailable/);
  await assert.rejects(runtime.create(value({ role: 'model = "unknown"\ndeveloper_instructions = "Work"' })), /unavailable/);
  const draft = await runtime.create(value({ role: 'model = "model"\ndeveloper_instructions = "Work"' })); const view = {}; runtime.bind(draft.token, view);
  const params = await runtime.prepare(view, "local", 1, "thread/start", { __azraelTaskProfileDraft: { token: draft.token } }); assert(params.config["agents.task_worker.config_file"].endsWith("role.toml"));
});
test("declared common harness is captured, retired tools stop admission", async t => {
  const { runtime } = await fixture(t);
  await assert.rejects(runtime.create(value({ harness: { toolProfile: "builtin/claude-code-core" } })), /Unknown task tool profile/);
  const draft = await runtime.create(value({ harness: { promptProfile: "builtin/azrael-default", toolProfile: "builtin/azrael-default" } })); const view = {}; runtime.bind(draft.token, view);
  const params = await runtime.prepare(view, "local", 1, "thread/start", { __azraelTaskProfileDraft: { token: draft.token } }); assert.equal(params.config["harness.models"].model.tool_profile, "builtin/azrael-default");
});
test("changed resolved digest, package bytes, snapshot metadata, and files are rejected", async t => {
  const { runtime } = await fixture(t), v = value(); const tampered = structuredClone(v); tampered.model = "unknown";
  await assert.rejects(runtime.create(tampered), /identity/);
  const changed = value(); changed.packages[1].files[0].content += "changed"; delete changed.digest; changed.digest = canonicalDigest(changed); await assert.rejects(runtime.create(changed), /digest/);
  await runtime.create(v); const snapshot = await runtime.readSnapshot(v.digest), target = path.join(runtime.root, v.digest, Object.keys(snapshot.files)[0]); await fs.appendFile(target, "changed");
  await assert.rejects(runtime.readSnapshot(v.digest), /file changed/);
});
test("immutable snapshot metadata and existing native roles cannot be overridden", async t => {
  const { runtime } = await fixture(t); const v = value(); await runtime.create(v);
  const file = path.join(runtime.root, v.digest, "snapshot.json"), snapshot = JSON.parse(await fs.readFile(file, "utf8")); snapshot.model = "changed"; await fs.writeFile(file, JSON.stringify(snapshot));
  await assert.rejects(runtime.readSnapshot(v.digest), /integrity/);
  const other = await fixture(t, { config: { agents: { task_worker: { config_file: "existing" } } } }), view = {};
  const draft = await other.runtime.create(value({ role: 'developer_instructions = "Work"' })); other.runtime.bind(draft.token, view);
  await assert.rejects(other.runtime.prepare(view, "local", 1, "thread/start", { __azraelTaskProfileDraft: { token: draft.token } }), /conflicts/);
});
test("Team text, ambient roots and other harness bindings survive task composition without duplicate context", async t => {
  const ambient = path.join(os.tmpdir(), "ambient"), explicit = path.join(os.tmpdir(), "explicit");
  const { runtime } = await fixture(t, { config: { skills: { extra_roots: [ambient] }, harness: { models: { another: { tool_profile: "retained" }, model: { profile: "azrael-default" } } } } });
  const v = value({ harness: { toolProfile: "builtin/azrael-default" } }), view = {}, draft = await runtime.create(v); runtime.bind(draft.token, view);
  const prepared = await runtime.prepare(view, "local", 1, "thread/start", { __azraelTaskProfileDraft: { token: draft.token }, developerInstructions: "Team Lead guidance", config: { "skills.extra_roots": [ambient, explicit], "harness.models": { custom: { prompt_profile: "custom" } } } });
  assert.match(prepared.developerInstructions, /^Native project rules\n\nTeam Lead guidance/); assert.equal(prepared.config["skills.extra_roots"].length, 3);
  assert.equal(prepared.config["harness.models"].another.tool_profile, "retained"); assert.equal(prepared.config["harness.models"].custom.prompt_profile, "custom");
  assert.equal(prepared.config["harness.models"].model.profile, "azrael-default");
  await runtime.finish({ id: 1, result: { thread: { id: "thread" } } });
  const resumed = await runtime.prepare(view, "local", 2, "thread/resume", { threadId: "thread", developerInstructions: prepared.developerInstructions });
  assert.equal(resumed.developerInstructions, prepared.developerInstructions);
});
test("login/catalog changes between review and start stop admission", async t => {
  const { runtime } = await fixture(t), draft = await runtime.create(value()), view = {}; runtime.bind(draft.token, view);
  runtime.request = async method => method === "model/list" ? { data: [], nextCursor: null } : { config: {} };
  await assert.rejects(runtime.prepare(view, "local", 1, "thread/start", { __azraelTaskProfileDraft: { token: draft.token } }), /unavailable/);
  assert.equal(runtime.pending.size, 0);
});
test("first turn enforces effective model/effort through collaboration settings, preserves native text and clears only on success", async t => {
  const { runtime, home, request } = await fixture(t), view = {}, draft = await runtime.create(value()); runtime.bind(draft.token, view);
  await runtime.prepare(view, "local", 1, "thread/start", { __azraelTaskProfileDraft: { token: draft.token }, cwd: process.cwd() });
  await runtime.finish({ id: 1, result: { thread: { id: "task-thread" } } });
  const cold = new TaskProfileRuntime({ codexHome: home, request }), input = { threadId: "task-thread", model: "stale", effort: "low", collaborationMode: { mode: "plan", settings: { model: "stale", reasoning_effort: "low", developer_instructions: "Native plan instructions" } } };
  const first = await cold.prepare({}, "local", 2, "turn/start", input);
  assert.equal(first.model, "model"); assert.equal(first.effort, "high"); assert.equal(first.collaborationMode.mode, "plan"); assert.equal(first.collaborationMode.settings.model, "model"); assert.equal(first.collaborationMode.settings.reasoning_effort, "high");
  assert.match(first.collaborationMode.settings.developer_instructions, /^Native project rules\n\nNative plan instructions/); assert.match(first.collaborationMode.settings.developer_instructions, /Short task guidance/);
  await cold.finish({ id: 2, error: { message: "retry" } }); assert.equal((await cold.registry()).threads["task-thread"].firstTurnPending, true);
  await cold.prepare({}, "local", 20, "turn/start", input); await cold.finish({ id: 20, result: {} }); assert.equal((await cold.registry()).threads["task-thread"].firstTurnPending, true);
  const retry = await cold.prepare({}, "local", 3, "turn/start", { ...input, collaborationMode: { mode: "default", settings: { model: "stale", developer_instructions: null } } });
  assert.equal(retry.collaborationMode.settings.developer_instructions, null);
  await cold.finish({ id: 3, result: { turn: { id: "turn" } } }); assert.equal((await cold.registry()).threads["task-thread"].firstTurnPending, false);
  assert.equal(await cold.prepare({}, "local", 4, "turn/start", input), input);
});
test("project panel transfer is origin-bound, one-use and checked again at native submission", async t => {
  const { runtime } = await fixture(t), origin = {}, target = {}, draft = await runtime.create(value()); runtime.bind(draft.token, origin);
  await assert.rejects(async () => runtime.transfer(draft.token, {}, { type: "local", projectId: "project" }), /another origin/);
  const project = { type: "local", projectId: "project" }, next = runtime.transfer(draft.token, origin, project);
  assert.throws(() => runtime.transfer(draft.token, origin, project), /another origin/); runtime.bind(next, target);
  await assert.rejects(runtime.prepare(target, "local", 1, "thread/start", { __azraelTaskProfileDraft: { token: next, project: { type: "local", projectId: "wrong" } } }), /changed.*project/);
  await runtime.prepare(target, "local", 2, "thread/start", { __azraelTaskProfileDraft: { token: next, project } }); assert.equal(runtime.drafts.has(next), false);
});
test("roles require root spawning capability and enabled feature but permit plain child models", async t => {
  for (const multiAgentVersion of [null, "disabled", "unknown", "V2"]) {
    const rootless = await fixture(t, { models: [{ ...catalog[0], multiAgentVersion }] });
    await assert.rejects(rootless.runtime.create(value({ role: 'developer_instructions = "Work"' })), /root model/);
  }
  const child = { id: "child", model: "child", modelProvider: "openai", supportedReasoningEfforts: [] }, supported = await fixture(t, { models: [...catalog, child] }), view = {};
  const draft = await supported.runtime.create(value({ role: 'model = "child"\ndeveloper_instructions = "Work"' })); supported.runtime.bind(draft.token, view);
  await supported.runtime.prepare(view, "local", 1, "thread/start", { __azraelTaskProfileDraft: { token: draft.token } });
  const disabled = await fixture(t, { config: { features: { multi_agent: false } } }), denied = await disabled.runtime.create(value({ role: 'developer_instructions = "Work"' })); disabled.runtime.bind(denied.token, view);
  await assert.rejects(disabled.runtime.prepare(view, "local", 2, "thread/start", { __azraelTaskProfileDraft: { token: denied.token } }), /enabled.*capability/);
});
test("disabled root capability and disappearing child models stop first-turn admission without role conflict checks", async t => {
  const child = { id: "child", model: "child", modelProvider: "openai", supportedReasoningEfforts: [] };
  const { runtime } = await fixture(t, { models: [...catalog, child] }), view = {}, draft = await runtime.create(value({ role: 'model = "child"\ndeveloper_instructions = "Work"' })); runtime.bind(draft.token, view);
  await runtime.prepare(view, "local", 1, "thread/start", { __azraelTaskProfileDraft: { token: draft.token } }); await runtime.finish({ id: 1, result: { thread: { id: "selected" } } });
  runtime.request = async method => method === "model/list" ? { data: [{ ...catalog[0], multiAgentVersion: "disabled" }, child], nextCursor: null } : { config: {} };
  await assert.rejects(runtime.prepare(view, "local", 2, "turn/start", { threadId: "selected" }), /enabled.*capability/);
  runtime.request = async method => method === "model/list" ? { data: catalog, nextCursor: null } : { config: { agents: { task_worker: { config_file: "already-installed" } } } };
  await assert.rejects(runtime.prepare(view, "local", 3, "turn/start", { threadId: "selected" }), /unavailable/);
  assert.equal((await runtime.registry()).threads.selected.firstTurnPending, true);
  runtime.request = async method => method === "model/list" ? { data: [...catalog, child], nextCursor: null } : { config: { agents: { task_worker: { config_file: "already-installed" } } } };
  const first = await runtime.prepare(view, "local", 4, "turn/start", { threadId: "selected" }); assert.equal(first.model, "model");
});
test("context discovery descriptions include escaped human-readable names", async t => {
  const { runtime } = await fixture(t), v = value(); v.packages[2].name = 'Guide: "quoted"\nnext'; v.packages[2].digest = packageDigest(v.packages[2]); delete v.digest; v.digest = canonicalDigest(v);
  await runtime.create(v); const snapshot = await runtime.readSnapshot(v.digest), description = Object.entries(snapshot.files).find(([name]) => name.includes("task-context-") && name.endsWith("SKILL.md"));
  const text = Buffer.from(description[1], "base64").toString("utf8"), match = /^description: (.+)$/m.exec(text); assert.match(JSON.parse(match[1]), /Guide: "quoted"\nnext/);
});


test("Anthropic task prompts use common tools and retired profiles are rejected", () => {
  assert.deepEqual(validateHarness({ promptProfile: "builtin/anthropic", toolProfile: "builtin/azrael-default" }),
    { prompt_profile: "builtin/anthropic", tool_profile: "builtin/azrael-default" });
  assert.throws(() => validateHarness({ promptProfile: "builtin/anthropic-default" }), /Unknown task prompt profile/);
  assert.throws(() => validateHarness({ toolProfile: "builtin/claude-code-core" }), /Unknown task tool profile/);
});
