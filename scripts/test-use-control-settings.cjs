"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { createSettingsOwner, normalizeExecutable } = require("./use-control-settings.cjs");
const { createOwner } = require("./window-use-approvals.cjs");
// The invoking verification owner registers and cleans this complete test root.
function fixture() {
  const root = process.env.AZRAEL_WINDOW_SETTINGS_TEST_ROOT;
  if (!root || !path.isAbsolute(root)) throw new Error("Set an owned absolute AZRAEL_WINDOW_SETTINGS_TEST_ROOT before filesystem tests");
  fs.mkdirSync(root, { recursive: true });
  const home = fs.mkdtempSync(path.join(root, "settings-"));
  return { home, settings: createSettingsOwner(home), approvals: createOwner(home) };
}
const app = "C:\\Apps\\Example.exe", key = app.toLowerCase();
function ask(owner, id, permission = "control", persist = ["session", "always"], threadId = "thread") {
  let sent, shown;
  owner.receive({ id, method: "mcpServer/elicitation/request", params: { serverName: "azrael_window", threadId, _meta: { connector_id: "window-use", tool_params: { ...(permission === "desktop" ? {} : { app }), permission }, persist } } }, (_id, answer) => { sent = answer; }, request => { shown = request; });
  return { sent, shown };
}
const accept = persist => ({ action: "accept", content: { persist } });

test("schema3 normalizes exact EXE lists, rejects retired authority, and enforces CAS", () => {
  const { settings } = fixture();
  assert.deepEqual(settings.getSettings(), { schema: 3, revision: 0, windowUseEnabled: true, observationBlockedApps: [], controlAllowedApps: [], windowUseGeneration: 0 });
  const state = settings.updateSettings({ controlAllowedApps: [app, key], observationBlockedApps: [app] }, 0);
  assert.deepEqual(state.controlAllowedApps, [key]); assert.deepEqual(state.observationBlockedApps, [key]); assert.equal(state.windowUseGeneration, 1);
  assert.throws(() => settings.updateSettings({ windowUseEnabled: false }, 0), { code: "REVISION_CONFLICT" });
  for (const patch of [{ windowUseAllowAll: true }, { stage1Enabled: true }, { windowUseEnabled: 1 }, { controlAllowedApps: ["Example"] }, { observationBlockedApps: ["C:\\Apps\\*.exe"] }]) assert.throws(() => settings.updateSettings(patch, 1));
  assert.throws(() => normalizeExecutable("C:\\Apps\\?.exe"));
  assert.equal(settings.updateSettings({ controlAllowedApps: [app] }, 1).windowUseGeneration, 1);
  settings.updateSettings({ windowUseEnabled: false }, 2); assert.throws(() => settings.assertEnabled(), /disabled/);
  fs.writeFileSync(settings.file + ".lock", ""); assert.throws(() => settings.updateSettings({}, 3), { code: "EEXIST" }); fs.unlinkSync(settings.file + ".lock");
});

test("schema2 keeps its master and schema1 keeps implicit Window Use enablement without importing retired grants", () => {
  const { settings } = fixture(); fs.mkdirSync(path.dirname(settings.file), { recursive: true });
  for (const enabled of [false, true]) {
    fs.writeFileSync(settings.file, JSON.stringify({ schema: 2, revision: 7, windowUseEnabled: enabled, stage1Enabled: true, stage2Enabled: true, stage3Enabled: true, stage4Enabled: true, windowUseAllowAll: true, computerUseGeneration: 5, windowUseGeneration: 3 }));
    const state = settings.getSettings(); assert.equal(state.schema, 3); assert.equal(state.windowUseEnabled, enabled); assert.equal(state.revision, 7); assert.equal(state.windowUseGeneration, 4);
    assert.deepEqual(state.controlAllowedApps, []); assert.deepEqual(state.observationBlockedApps, []);
    settings.updateSettings({}, 7); assert.equal(JSON.parse(fs.readFileSync(settings.file)).schema, 3);
    fs.writeFileSync(settings.file, JSON.stringify({ schema: 1, revision: 7, computerUseEnabled: enabled, windowUseAllowAll: true, computerUseGeneration: 5, windowUseGeneration: 3 }));
    assert.equal(settings.getSettings().windowUseEnabled, true); assert.deepEqual(settings.getSettings().controlAllowedApps, []);
  }
});

test("control approvals never authorize Security App observation; session grants expire on settings and stop", () => {
  const { settings, approvals } = fixture();
  assert.equal(approvals.hasAppApproval(app, "thread", "observation"), true);
  assert.equal(approvals.hasAppApproval(app, "thread"), false);
  settings.updateSettings({ observationBlockedApps: [app] }, 0);
  const blocked=ask(approvals,"control");assert.equal(blocked.sent.content.windowError.code,"security_app_blocked");assert.equal(blocked.shown,undefined);
  assert.equal(approvals.hasAppApproval(app, "thread"), false); assert.equal(approvals.hasAppApproval(app, "thread", "observation"), false);
  assert.deepEqual(ask(approvals, "observation", "observation").shown.params._meta.persist, ["session"]);
  assert.equal(approvals.response("observation", accept("session")).action, "accept"); assert.equal(approvals.hasAppApproval(app, "thread", "observation"), true);
  assert.deepEqual(approvals.getAppApprovals().approvedApps.map(a => a.permission).sort(), ["observation"]);
  settings.updateSettings({ controlAllowedApps: [] }, 1);
  assert.equal(approvals.hasAppApproval(app, "thread"), false); assert.equal(approvals.hasAppApproval(app, "thread", "observation"), false);
  ask(approvals, "stopped", "observation"); approvals.stop("thread"); assert.equal(approvals.response("stopped", accept("session")).action, "cancel");
  ask(approvals, "stale", "observation"); settings.updateSettings({ windowUseEnabled: false }, 2); assert.equal(approvals.response("stale", accept("session")).action, "cancel");
  assert.deepEqual(approvals.getPersistentAppApprovals().approvedApps, []);
});

// Retain these boundaries against later permission-kind or whitelist simplification.
test("desktop consent is thread-only, nonpersistent and independent of the control whitelist", () => {
  const { home, approvals } = fixture();
  assert.equal(approvals.hasDesktopApproval("thread"), false);
  assert.equal(approvals.hasDesktopAppApproval(app, "thread"), false);
  assert.deepEqual(ask(approvals, "forged", "desktop", ["always"]).shown.params._meta.persist, ["session"]);
  assert.equal(approvals.response("forged", accept("always")).action, "cancel");
  ask(approvals, "decline", "desktop"); approvals.response("decline", { action: "decline" });
  assert.equal(approvals.hasDesktopApproval("thread"), false);
  ask(approvals, "grant", "desktop"); assert.equal(approvals.response("grant", accept("session")).action, "accept");
  assert.equal(approvals.hasDesktopApproval("thread"), true);
  assert.equal(approvals.hasDesktopAppApproval(app, "thread"), true);
  assert.equal(approvals.hasAppApproval(app, "thread", "control"), true);
  assert.equal(approvals.hasDesktopApproval("other"), false);
  assert.equal(createOwner(home).hasDesktopApproval("thread"), false);
  assert.deepEqual(approvals.getAppApprovals().approvedApps, []);
  assert.equal(fs.existsSync(path.join(home, "azrael", "window-use", "app-approvals.json")), false);
  assert.equal(ask(approvals, "already", "desktop").sent.action, "accept");
  approvals.notification("turn/completed", { threadId: "thread" }); assert.equal(approvals.hasDesktopApproval("thread"), true);
  approvals.revokeDesktopApproval("thread"); assert.equal(approvals.hasDesktopApproval("thread"), false);
});

test("Security App control is blocked before prompting despite persisted, whitelist, and global approval", () => {
  const {settings,approvals}=fixture();
  ask(approvals,"saved","control");approvals.response("saved",accept("always"));
  settings.updateSettings({observationBlockedApps:[app],controlAllowedApps:[app]},0);
  ask(approvals,"desktop","desktop");approvals.response("desktop",accept("session"));
  assert.equal(approvals.hasAppApproval(app,"thread","control"),false);assert.equal(approvals.hasDesktopAppApproval(app,"thread"),false);
  const blocked=ask(approvals,"blocked","control");assert.equal(blocked.sent.content.windowError.code,"security_app_blocked");assert.equal(blocked.shown,undefined);
  ask(approvals,"observe","observation");approvals.response("observe",accept("session"));assert.equal(approvals.hasAppApproval(app,"thread","observation"),true);assert.equal(approvals.hasAppApproval(app,"thread","control"),false);
});

test("desktop pending approvals cannot survive stop, lifecycle end, or changed policy", () => {
  const { settings, approvals } = fixture();
  for (const [hook, method] of [["outgoing", "turn/interrupt"], ["outgoing", "thread/unsubscribe"], ["outgoing", "thread/archive"], ["outgoing", "thread/delete"], ["notification", "thread/closed"], ["notification", "thread/ended"]]) {
    ask(approvals, "desktop", "desktop"); approvals.response("desktop", accept("session"));
    ask(approvals, "late", "desktop", ["session"], "pending");
    approvals[hook](method, { threadId: "thread" }); approvals[hook](method, { threadId: "pending" });
    assert.equal(approvals.hasDesktopApproval("thread"), false, method);
    assert.equal(approvals.response("late", accept("session")).action, "cancel", method);
  }
  ask(approvals, "stale", "desktop"); settings.updateSettings({ observationBlockedApps: [app] }, 0);
  assert.equal(approvals.response("stale", accept("session")).action, "cancel");
  ask(approvals, "desktop", "desktop"); approvals.response("desktop", accept("session"));
  settings.updateSettings({ controlAllowedApps: [app] }, 1); assert.equal(approvals.hasDesktopApproval("thread"), false);
});

test("persistent exact Window Use control grants survive and remain removable without changing observation", () => {
  const { home, settings, approvals } = fixture();
  const file = path.join(home, "azrael", "window-use", "app-approvals.json"); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schema: 1, revocations: {}, apps: [{ bundleIdentifier: key, displayName: "Example" }] }));
  settings.updateSettings({ observationBlockedApps: [app] }, 0);
  assert.equal(approvals.hasAppApproval(app, "thread"), false); assert.equal(approvals.hasAppApproval(app, "thread", "observation"), false);
  approvals.removeAppApproval(app); assert.equal(approvals.hasAppApproval(app, "thread"), false); assert.deepEqual(settings.getSettings().observationBlockedApps, [key]);
  settings.updateSettings({observationBlockedApps:[]},settings.getSettings().revision);
  ask(approvals, "always"); assert.equal(approvals.response("always", accept("always")).action, "accept"); assert.equal(createOwner(home).hasAppApproval(app, "other"), true);
  settings.updateSettings({observationBlockedApps:[app]},settings.getSettings().revision);
  assert.equal(approvals.hasAppApproval(app,"thread"),false);
  assert.equal(approvals.hasAppApproval(app, "thread", "observation"), false);
  ask(approvals, "observation-always", "observation"); assert.equal(approvals.response("observation-always", accept("always")).action, "cancel");
  approvals.removeAppApproval(app); assert.equal(createOwner(home).hasAppApproval(app, "thread"), false);
});
