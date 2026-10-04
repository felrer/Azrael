"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require(process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH ?? require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const { DESIGN_ASSETS, injectStudentDesign, createDesignStore, AzraelStudentAvatar, AzraelDesignSettings, observeStudentCreated } = require("./inject-student-design.cjs");
const { injectInstructionSettings } = require("./inject-instruction-settings.cjs");
const { injectAccountSettings } = require("./inject-account-settings.cjs");
const root = (process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname, "../artifacts/upstream-ui/26.930.31730"));

test("pinned composed assets parse, preserve settings, reject drift and remain idempotent", () => {
  for (const asset of DESIGN_ASSETS) {
    const source = fs.readFileSync(path.join(root, asset), "utf8");
    const composed = injectInstructionSettings(injectAccountSettings(source, asset).text, asset).text;
    const result = injectStudentDesign(composed, asset);
    assert.equal(result.count, 1);
    assert.equal(ts.createSourceFile(asset, result.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
    assert.equal(injectStudentDesign(result.text, asset).text, result.text);
    assert.equal(injectStudentDesign(result.text, asset).count, 0);
    assert.throws(() => injectStudentDesign("", asset), /anchor changed|requires instruction/);
    if (asset === DESIGN_ASSETS[2]) {
      for (const value of ["AzraelAccountSettings", "AzraelInstructionSettings", "AzraelDesignSettings", ".azrael-instructions.azrael-design.pets.", 'defaultMessage:`디자인`']) assert(result.text.includes(value));
    }
    if (asset === DESIGN_ASSETS[1]) {
      assert(result.text.includes('{slug:`azrael-instructions`},{slug:`azrael-design`}'));
      assert(result.text.includes('case`azrael-design`:case`azrael-instructions`'));
    }
    if (asset === DESIGN_ASSETS[0]) {
      assert(result.text.includes('function azraelOriginalAvatar(e)'));
      assert(result.text.includes('export{azraelDesignStore,useAzraelDesignState}'));
    }
  }
  assert.equal(injectStudentDesign("other", "other").count, 0);
});

function harness(timing) {
  let receive, unsubscribed = false;
  const sent = [];
  const bridge = { subscribe(type, callback) { assert.equal(type, "azrael-design-state"); receive = callback; return () => { unsubscribed = true; }; },
    dispatchMessage(type, message) { sent.push({ type, ...message }); } };
  const store = createDesignStore(bridge, "client", timing);
  return { store, sent, receive: message => receive(message), unsubscribed: () => unsubscribed };
}

test("bootstrap, broadcast, off request and disposal keep assignment authority on host", () => {
  const h = harness();
  assert.deepEqual(h.sent, [{ type: "azrael-design", clientId: "client", action: "subscribe" }]);
  assert.equal(h.store.getSnapshot().enabled, false);
  h.store.setEnabled(true); assert.equal(h.sent.length, 1);
  let renders = 0;
  const unmount = h.store.subscribe(() => renders++);
  h.receive({ clientId: "other", enabled: true, students: [], assignments: {} }); assert.equal(renders, 0);
  const assignments = { "thread-1": "student-1" };
  h.receive({ clientId: "client", enabled: true, students: [], assignments });
  assert.equal(renders, 1); assert.equal(h.store.getSnapshot().assignments, assignments);
  h.store.setEnabled(false);
  assert.deepEqual(h.sent[1], { type: "azrael-design", clientId: "client", action: "setEnabled", enabled: false });
  assert.equal(h.store.getSnapshot().saving, true);
  h.store.setEnabled(true); assert.equal(h.sent.length, 2);
  h.receive({ clientId: "client", enabled: false, students: [], assignments, error: "save failed" });
  assert.equal(h.store.getSnapshot().error, "save failed");
  assert.equal(h.store.getSnapshot().saving, false);
  assert.deepEqual(assignments, { "thread-1": "student-1" });
  unmount(); const before = renders;
  h.receive({ clientId: "client", enabled: false, students: [], assignments }); assert.equal(renders, before);
  h.store.dispose(); assert.equal(h.sent[2].action, "unsubscribe"); assert(h.unsubscribed());
});

test("lost replies time out, retry only reads host state, and disposal cancels pending work", () => {
  let sequence = 0;
  const timers = new Map();
  const timing = { setTimeout: (callback, delay) => { assert.equal(delay, 10000); timers.set(++sequence, callback); return sequence; }, clearTimeout: id => timers.delete(id) };
  const expire = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); };
  const h = harness(timing);
  assert.equal(timers.size, 1);
  expire();
  assert.equal(h.store.getSnapshot().loading, false);
  assert.match(h.store.getSnapshot().error, /다시 불러오기/);
  h.store.retry();
  assert.equal(h.sent[1].action, "subscribe");
  assert.equal(h.store.getSnapshot().loading, true);
  const assignments = { thread: "student" };
  h.receive({ clientId: "client", enabled: true, students: [], assignments });
  assert.equal(timers.size, 0);
  h.store.setEnabled(false);
  expire();
  assert.equal(h.store.getSnapshot().saving, false);
  assert.equal(h.store.getSnapshot().enabled, true);
  assert.equal(h.store.getSnapshot().assignments, assignments);
  h.store.retry();
  assert.deepEqual(h.sent.map(message => message.action), ["subscribe", "subscribe", "setEnabled", "subscribe"]);
  assert.equal(h.sent[3].enabled, undefined);
  const snapshot = h.store.getSnapshot();
  h.store.dispose();
  assert.equal(timers.size, 0);
  h.receive({ clientId: "client", enabled: false, students: [], assignments: {} });
  h.store.retry(); h.store.setEnabled(false); h.store.dispose();
  assert.equal(h.store.getSnapshot(), snapshot);
  assert.equal(h.sent.length, 5);
  assert.equal(h.sent[4].action, "unsubscribe");
});

test("unavailable host reports error and exits loading", () => {
  const store = createDesignStore({ subscribe: () => () => {}, dispatchMessage: () => { throw new Error("host unavailable"); } }, "client");
  assert.equal(store.getSnapshot().loading, false);
  assert.equal(store.getSnapshot().error, "host unavailable");
});

test("host observes only completed native spawn notifications and safely preserves fanout on failures", async () => {
  const calls = [], commands = { executeCommand: (...args) => { calls.push(args); } };
  const notification = { method: "item/completed", params: { item: { type: "collabAgentToolCall", tool: "spawnAgent", status: "completed", receiverThreadIds: ["new-thread", "", null, "new-thread", " bad "] } } };
  observeStudentCreated(notification, commands);
  assert.deepEqual(calls, [["azrael.studentCreated", "new-thread"]]);
  for (const message of [
    { method: "thread/started", params: { thread: { id: "historical" } } },
    { method: "thread/list", params: { threads: [{ id: "historical" }] } },
    { ...notification, method: "item/started" },
    { ...notification, params: { item: { ...notification.params.item, tool: "resumeAgent" } } },
    { ...notification, params: { item: { ...notification.params.item, status: "failed" } } },
    { ...notification, params: { item: { ...notification.params.item, type: "other" } } },
    { ...notification, params: { item: { ...notification.params.item, receiverThreadIds: null } } },
  ]) observeStudentCreated(message, commands);
  assert.equal(calls.length, 1);
  const warnings = [];
  const observe = vm.runInNewContext("(" + observeStudentCreated.toString() + ")", { console: { warn: (...args) => warnings.push(args) }, Promise, Set });
  observe(notification, { executeCommand: () => { throw new Error("sync failure"); } });
  observe(notification, { executeCommand: () => Promise.reject(new Error("async failure")) });
  await Promise.resolve();
  assert.equal(warnings.length, 2);
});

const jsx = (type, props, key) => ({ type, props, key });
test("avatar uses exact assigned seed even when off, preserves props and falls back after image error", () => {
  let state = { enabled: false, students: [{ id: "student", url: "https://webview.local/student.png" }], assignments: { thread: "student" } }, failed = null;
  const original = () => {};
  const avatar = vm.runInNewContext("(" + AzraelStudentAvatar.toString() + ")", {
    q: () => ({ useState: () => [failed, next => { failed = next; }] }), useAzraelDesignState: () => state,
    l_i: { jsx }, ri: (...values) => values.filter(Boolean).join(" "), azraelOriginalAvatar: original,
  });
  const props = { seed: "thread", className: "custom", title: "title", alt: "ignored" };
  const image = avatar(props);
  assert.equal(image.type, "img"); assert.equal(image.props.alt, ""); assert.equal(image.props.title, "title");
  assert.equal(image.props.className, "size-3.5 shrink-0 custom");
  assert.equal(avatar({ seed: "other" }).type, original);
  assert.equal(avatar({ seed: "thread-extra" }).type, original);
  image.props.onError({}); assert.equal(avatar(props).type, original);
  state = { ...state, students: [] }; assert.equal(avatar(props).type, original);
  state = { ...state, assignments: {} }; assert.equal(avatar({ seed: "toString" }).type, original);
});

test("settings renders controlled default-off toggle, loading/saving/error and 20px roster", () => {
  const h = harness(); let state = h.store.getSnapshot();
  const settings = vm.runInNewContext("(" + AzraelDesignSettings.toString() + ")", {
    useAzraelDesignState: () => state, azraelDesignStore: h.store, $: { jsx, jsxs: jsx },
  });
  let tree = settings(); let checkbox = tree.props.children[1].props.children[0];
  assert.equal(checkbox.props.checked, false); assert.equal(checkbox.props.disabled, true);
  const students = [{ id: "s", nameKo: "학생", nameEn: "Student", url: "local" }];
  h.receive({ clientId: "client", enabled: false, students, assignments: {} }); state = h.store.getSnapshot();
  tree = settings(); checkbox = tree.props.children[1].props.children[0];
  assert.equal(checkbox.props.disabled, false);
  checkbox.props.onChange({ target: { checked: true } }); assert.equal(h.sent[1].enabled, true);
  state = h.store.getSnapshot(); assert.equal(settings().props.children[4].props.children, "저장 중…");
  h.receive({ clientId: "client", enabled: false, students, assignments: {}, error: "error" }); state = h.store.getSnapshot();
  tree = settings(); assert.equal(tree.props.children[5].props.role, "alert");
  assert.match(tree.props.children[2].props.children, /새로 생성되는 Subagent/);
  tree.props.children[5].props.children[1].props.onClick();
  assert.equal(h.sent[2].action, "subscribe");
  const sample = tree.props.children[7].props.children[0].props.children[0];
  assert.equal(sample.props.width, 20); assert.equal(sample.props.height, 20);
  h.store.dispose();
});
