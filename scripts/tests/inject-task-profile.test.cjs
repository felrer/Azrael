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
