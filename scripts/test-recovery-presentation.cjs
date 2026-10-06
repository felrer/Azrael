"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { RecoveryState } = require("./recovery-state.cjs");

// Execute the product's labels and redraw closure, rather than duplicating its
// presentation logic. Resolve the installed, lockfile-backed project parser.
const ts = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const filename = path.join(__dirname, "azrael-recovery.cjs");
const source = fs.readFileSync(filename, "utf8");
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(ast.parseDiagnostics.length, 0);
let labels, initialize;
function locate(node) {
  if (ts.isVariableDeclaration(node) && node.name.text === "labels") labels = node.initializer;
  if (ts.isFunctionDeclaration(node) && node.name?.text === "initialize") initialize = node;
  ts.forEachChild(node, locate);
}
locate(ast);
assert.ok(labels && initialize, "presentation owners must exist");
const locals = new Map();
for (const statement of initialize.body.statements) {
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) locals.set(declaration.name.text, declaration);
  }
}
assert.ok(ts.isArrowFunction(locals.get("redraw")?.initializer), "redraw must be owned by initialize");
const textOf = node => source.slice(node.getStart(ast), node.end);

function presentation() {
  let now = 1000, shown = 0, hidden = 0;
  const status = { show() { shown++; }, hide() { hidden++; } };
  const controllers = new Map();
  const sandbox = vm.createContext({ controllers, status, Date: { now: () => now } });
  const render = new vm.Script([
    `const labels = ${textOf(labels)};`,
    ...["disposed", "lastRedraw"].map(name => `let ${textOf(locals.get(name))};`),
    `const redraw = ${textOf(locals.get("redraw").initializer)};`,
    "({ redraw, dispose: () => { disposed = true; } })",
  ].join("\n"), { filename: "actual-recovery-redraw.js" }).runInContext(sandbox);
  const state = new RecoveryState({
    store: { get(_key, fallback) { return fallback; }, async update() {} },
    now: () => now,
    rpc: async method => {
      if (method === "thread/read") return { thread: { status: { type: "idle" } } };
      if (method === "thread/turns/list") return { data: [] };
      if (method === "turn/start") return { turn: { id: "accepted-turn", status: "inProgress" } };
      throw Error(`Unexpected RPC: ${method}`);
    },
  });
  controllers.set("host", { state });
  return { ...render, state, status, controllers,
    advance(ms = 250) { now += ms; },
    counts() { return { shown, hidden }; },
  };
}

for (const [phase, label] of [["recovering", "서버 연결 중 · 세션 확인"], ["starting", "전송 대기 중"]]) {
  test(`${phase} shows its connection or dispatch label with a spinner`, () => {
    const ui = presentation();
    ui.state.setStage("thread", phase);
    ui.redraw();
    assert.equal(ui.status.text, `$(loading~spin) Azrael: ${label}`);
    assert.deepEqual(ui.counts(), { shown: 1, hidden: 0 });
  });
}

test("accepted start and responding notifications render static phase-specific status", async () => {
  const ui = presentation();
  await ui.state.start({ threadId: "thread", input: [{ type: "text", text: "continue" }] });
  assert.equal(ui.state.receipts.get("thread").phase, "accepted");
  ui.redraw();
  assert.equal(ui.status.text, "$(pulse) Azrael: 응답 대기 중");
  ui.state.observe({ method: "item/agentMessage/delta", params: { threadId: "thread", turnId: "accepted-turn" } });
  ui.advance();
  ui.redraw();
  assert.equal(ui.status.text, "$(pulse) Azrael: 응답 생성 중");
  assert.doesNotMatch(ui.status.text, /서버 연결|loading~spin/);
});

for (const phase of ["error", "disconnected", "completed", "interrupted", "idle", "unknown", "interrupting", "tool", "approval", "input"]) {
  test(`${phase} remains visible without an infinite spinner`, () => {
    const ui = presentation();
    ui.state.setStage("thread", "recovering");
    ui.redraw();
    ui.state.setStage("thread", phase);
    ui.advance();
    ui.redraw();
    assert.match(ui.status.text, /^\$\(pulse\) Azrael: /);
    assert.doesNotMatch(ui.status.text, /loading~spin|서버 연결|undefined/);
    assert.deepEqual(ui.counts(), { shown: 2, hidden: 0 });
  });
}

test("delayed accepted work keeps the delay explanation and a static icon", () => {
  const ui = presentation();
  ui.state.setStage("thread", "waiting", "turn");
  ui.advance(90000);
  ui.redraw();
  assert.equal(ui.status.text, "$(pulse) Azrael: 진행 지연 · 응답 대기 중");
  assert.match(ui.status.tooltip, /90초 동안 새 진행 신호가 없습니다/);
});

test("redraw still hides an empty state and preserves the 250 ms throttle", () => {
  const ui = presentation();
  ui.redraw();
  assert.deepEqual(ui.counts(), { shown: 0, hidden: 1 });
  ui.state.setStage("thread", "recovering");
  ui.advance(249);
  ui.redraw();
  assert.deepEqual(ui.counts(), { shown: 0, hidden: 1 });
  ui.advance(1);
  ui.redraw();
  assert.equal(ui.status.text, "$(loading~spin) Azrael: 서버 연결 중 · 세션 확인");
  ui.state.setStage("thread", "waiting");
  ui.advance(249);
  ui.redraw();
  assert.match(ui.status.text, /loading~spin/);
  ui.advance(1);
  ui.redraw();
  assert.equal(ui.status.text, "$(pulse) Azrael: 응답 대기 중");
  ui.controllers.clear();
  ui.advance();
  ui.redraw();
  assert.deepEqual(ui.counts(), { shown: 2, hidden: 2 });
});

test("latest session wins and disposed presentation performs no redraw", () => {
  const ui = presentation();
  ui.state.setStage("older", "recovering");
  ui.advance();
  ui.state.setStage("newer", "waiting");
  ui.redraw();
  assert.equal(ui.status.text, "$(pulse) Azrael: 응답 대기 중");
  assert.match(ui.status.tooltip, /세션 newer/);
  ui.dispose();
  ui.state.setStage("newer", "starting");
  ui.advance();
  ui.redraw();
  assert.equal(ui.status.text, "$(pulse) Azrael: 응답 대기 중");
  assert.deepEqual(ui.counts(), { shown: 1, hidden: 0 });
});
