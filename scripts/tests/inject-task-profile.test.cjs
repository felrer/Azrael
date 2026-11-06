"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const team = require("../inject-team-runtime.cjs");
const task = require("../inject-task-profile.cjs");
const source = asset => fs.readFileSync(path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT || path.join(__dirname, "../../artifacts/upstream-ui/26.1007.21434"), asset), "utf8");
test("pinned native transforms compose after Team and remain idempotent", () => {
  for (const asset of task.TASK_PROFILE_ASSETS) {
    const upstream = source(asset), lead = team.injectTeamRuntime(upstream, asset), result = task.injectTaskProfile(lead.text, asset);
    assert.equal(result.count, 1); assert.equal(task.injectTaskProfile(result.text, asset).count, 0);

    assert.throws(() => task.injectTaskProfile(result.text.replace(task.MARKER, task.MARKER + task.MARKER), asset), /Damaged/);
    const namespaced = task.injectTaskProfile(team.injectTeamRuntime(upstream.replaceAll("chatgpt.", "azrael."), asset).text, asset);
    assert.equal(namespaced.count, 1);
  }
  assert.throws(() => task.injectTaskProfile(source(task.HOST_ASSET), task.HOST_ASSET), /Pinned/);
});
test("application only forwards an opaque frozen token on one selected new local thread", async () => {
  let listener; const calls = [], globalThis = { addEventListener: (_name, fn) => { listener = fn; } };
  const context = { globalThis, azraelSendLeadDraft: async (_client, method, request, hostId) => { calls.push({ method, request, hostId }); return { thread: { id: "native" } }; } };
  vm.runInNewContext(task.APP_HELPER, context);
  const input = { cwd: "project" }; await context.azraelSendTaskDraft({}, "thread/start", input, "local", {}, {}); assert.equal(calls[0].request, input);
  listener({ data: { type: "persisted-atom-sync", state: { __azraelTaskProfileDraft: { token: "host-frozen", model: "attacker", files: ["untrusted"] } } } });
  await assert.rejects(context.azraelSendTaskDraft({}, "thread/resume", input, "local", {}, {}), /new local/);
  await context.azraelSendTaskDraft({}, "thread/start", input, "local", {}, {});
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].request.__azraelTaskProfileDraft)), { token: "host-frozen", project: null });
  assert.equal(globalThis.__azraelPendingTaskProfile, null);
  await context.azraelSendTaskDraft({}, "thread/start", input, "local", {}, {}); assert.equal(calls[2].request, input);
});

test("webview command forwarding cannot invoke trusted role-profile host commands", () => {
  const output = task.injectTaskProfile(team.injectTeamRuntime(source(task.HOST_ASSET), task.HOST_ASSET).text, task.HOST_ASSET).text;
  const guard = output.match(/case"open-vscode-command":\{(if\(\[.*?\]\.(?:includes)\(r.command\)\)throw Error\("Task profile commands require the native host"\);)/)?.[1];
  assert.ok(guard, "native command forwarding guard is present");
  for (const command of ["azrael.captureRoleProfile", "azrael.roleProfileSettings", "azrael.prepareTeamProfile", "azrael.attachTeamProfile", "azrael.discardTeamProfile"]) {
    assert.throws(() => vm.runInNewContext(guard, { r: { command } }), /require the native host/);
  }
});
test("project Orr transfer retains initial draft, forwards an opaque token once, and Drr cancels it", () => {
  const context = { globalThis: { __azraelPendingTaskProfile: { token: "host-token" } }, jy: {}, dP: value => value };
  vm.runInNewContext(task.BRIDGE_HELPER, context);
  context.azraelTaskProject({ get: () => null }, { type: "local", projectId: "project" });
  assert.equal(context.globalThis.__azraelPendingTaskProfile.token, "host-token");
  const args = JSON.parse(JSON.stringify(context.azraelTaskCommandArgs([], false))); assert.deepEqual(args, [{ __azraelTaskProfileDraft: "host-token", project: { type: "local", projectId: "project" } }]);
  assert.throws(() => context.azraelTaskCommandArgs([], false), /already used/);
  context.globalThis.__azraelPendingTaskProfile = { token: "cancelled" }; assert.deepEqual(context.azraelTaskCommandArgs([], true), []); assert.equal(context.globalThis.__azraelPendingTaskProfile, null);
});
test("full namespace chain reports task edits and matching hashes", () => {
  const { transformAsset } = require("../namespace-azrael-host.cjs"), crypto = require("node:crypto"), ts = require("../../extensions/azrael-ex/node_modules/typescript");
  const sha = value => crypto.createHash("sha256").update(value).digest("hex");
  for (const asset of task.TASK_PROFILE_ASSETS) {
    const input = source(asset), output = transformAsset(input, asset, asset, ts);
    assert.equal(output.asset.taskProfileEdits, 1); assert.equal(output.asset.sourceSha256, sha(input)); assert.equal(output.asset.sha256, sha(output.text));
  }

});
test("native host route binds token to exactly one panel URI and exposes no resource bytes", async () => {
  const drafts = new Map([["token", {}]]), bootstrap = [], runtime = { drafts, bind: (token, view) => { bootstrap.push({ token, view }); }, discard() {} };
  const context = { URLSearchParams, rF: route => ({ toString: () => route }), require };
  vm.runInNewContext(`globalThis.Host=class { ${task.HOST_METHODS} }`, context);
  const host = new context.Host(); host.azraelTaskRuntime = runtime; host.azraelTaskHome = "home";
  host.azraelLeadPanelRoute = () => "/ordinary";
  const route = host.azraelTaskPanelRoute({ __azraelTaskProfileDraft: "token" }); assert.equal(route, "/extension/panel/new?azraelTaskProfile=token");
  assert.throws(() => host.azraelTaskPanelRoute({ __azraelTaskProfileDraft: "token" }), /already transferred/);
  assert.throws(() => host.azraelBindTaskPanel({ query: "azraelTaskProfile=token", toString: () => "/wrong" }, {}), /URI changed/);
  const view = {}; host.azraelBindTaskPanel({ query: "azraelTaskProfile=token", toString: () => route }, view); assert.equal(bootstrap[0].view, view);
  assert.equal(host.azraelTaskPanelRoute({}), "/ordinary");
});

// Retained: creation transport edits must keep all fresh local starts behind
// trusted role admission, including Team pending state and caller-policy removal.
test("native Task host admits fresh Direct and Team profiles before sending and preserves resume", async () => {
  const { nativePolicy } = require("../role-profile-runtime.cjs");
  const profile = { id: "root", name: "Root", allowedRoles: ["root"], model: "root-model", provider: "openai", reasoningEffort: "high", instructions: "Root guidance" };
  const direct = { mode: "direct", rootProfileId: "root", rootProfileIds: ["root"], subagentProfileIds: [], profiles: [profile] };
  const calls = [];
  const context = { __dirname, require: name => name.endsWith("role-profile-runtime.cjs") ? require("../role-profile-runtime.cjs") : require(name), Mt: { commands: { executeCommand: async (command, ...args) => {
    calls.push({ command, args });
    if (command === "azrael.captureRoleProfile") return structuredClone(direct);
    if (command === "azrael.prepareTeamProfile") return { ...nativePolicy(args[0], args[1]), configuration_path: "saved-team-path" };
    throw Error("Unexpected command: " + command);
  } } } };
  vm.runInNewContext(`globalThis.Host=class { ${task.HOST_METHODS} }`, context);
  const host = new context.Host();
  host.azraelTaskRuntime = { prepare: async (_view, _host, _id, _method, params) => params, registry: async () => ({ threads: {} }) };
  const input = { model: "caller-model", developerInstructions: "Project rules", agentProfile: { digest: "caller-profile" }, config: { role_profile: { role: "lead", profile_id: "caller" } } };
  const admitted = await host.azraelPrepareTaskRequest({}, "local", "direct-start", "thread/start", input);
  assert.equal(admitted.model, "root-model"); assert.equal(admitted.agentProfile, undefined);
  assert.equal(admitted.config.role_profile.role, "root");
  assert.equal(admitted.config.role_profile.base_developer_instructions, "Project rules");
  assert.equal(admitted.developerInstructions, "Project rules\n\nRoot guidance");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)), [{ mode: "direct" }]);
  direct.profiles[0].model = "later-model";
  const next = await host.azraelPrepareTaskRequest({}, "local", "next-start", "thread/start", {});
  assert.equal(next.model, "later-model"); assert.equal(admitted.model, "root-model");
  const teamCapture = { mode: "team", leadProfileId: "lead", rootProfileIds: ["root"], subagentProfileIds: [], profiles: [profile, { ...profile, id: "lead", allowedRoles: ["lead"], model: "lead-model", instructions: "Lead guidance" }] };
  host.azraelTeamRequests = new Map([["team-start", { profileConfiguration: teamCapture }]]);
  const lead = await host.azraelPrepareTaskRequest({}, "local", "team-start", "thread/start", { developerInstructions: "Project rules" });
  assert.equal(lead.model, "lead-model"); assert.equal(lead.developerInstructions, "Project rules\n\nLead guidance");
  assert.equal(host.azraelTeamRequests.get("team-start").configurationPath, "saved-team-path");
  assert.equal(calls.length, 3); assert.equal(calls[2].command, "azrael.prepareTeamProfile");
  const resume = { threadId: "existing", model: "manual-model" };
  assert.equal(await host.azraelPrepareTaskRequest({}, "local", "resume", "thread/resume", resume), resume);
  assert.equal(calls.length, 3);
});

test("Team preparation failure discards owned configuration before native dispatch", async () => {
  const injected = team.injectTeamRuntime(source(task.HOST_ASSET), task.HOST_ASSET).text;
  const output = task.injectTaskProfile(injected, task.HOST_ASSET).text;
  const methods = injected.slice(injected.indexOf("async azraelPrepareTeamRequest("), injected.indexOf("async deliverMcpResponseToOrigin(e){try{e=await this.azraelFinishTeamRequest(e)}"));
  const helper = injected.slice(injected.lastIndexOf(team.MARKER) + team.MARKER.length);
  const calls = [], responses = [];
  const context = { __dirname, process, require: name => name.endsWith("role-profile-runtime.cjs") ? require("../role-profile-runtime.cjs") : require(name), Mt: { commands: { executeCommand: async (command, ...args) => {
    calls.push({ command, args });
    if (command === "azrael.prepareTeamProfile") return { configuration_path: "owned-predispatch-config" }; // Invalid native admission after successful configuration creation.
    if (command === "azrael.discardTeamProfile") return;
    throw Error("Unexpected command: " + command);
  } } }, SK: () => false, IR: "native" };
  vm.runInNewContext(helper + `\nglobalThis.Host=class { ${methods} ${task.HOST_METHODS} }`, context);
  const start = output.indexOf('case"mcp-request":{') + 'case"mcp-request":'.length;
  const end = output.indexOf('case"thread-prewarm-start"', start);
  vm.runInNewContext("globalThis.dispatch=async function(e,r)" + output.slice(start, end).replace(/break}/g, "return}"), context);
  const host = new context.Host();
  host.azraelTaskRuntime = { prepare: async (_view, _host, _id, _method, params) => params };
  host.fetchWrapper = { extensionFetchHandler: { azraelConsumeLeadDraft: async () => ({ mode: "team" }) } };
  host.postMessageToWebview = (_view, message) => responses.push(message);
  host.codexMcpConnection = { sendRequest: () => assert.fail("Failed admission must not dispatch") };
  await context.dispatch.call(host, {}, { hostId: "local", request: { id: "failed-team", method: "thread/start", params: { __azraelTeamLeadDraft: { token: "trusted" } } } });
  assert.deepEqual(calls.map(call => call.command), ["azrael.prepareTeamProfile", "azrael.discardTeamProfile"]);
  assert.deepEqual(calls[1].args, ["owned-predispatch-config"]);
  assert.equal(host.azraelTeamRequests.has("failed-team"), false);
  assert.equal(responses[0].message.id, "failed-team"); assert.equal(responses[0].message.error.code, -32602);
});
