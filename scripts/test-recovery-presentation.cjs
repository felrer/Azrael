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
const errorOwners = new Map();
function locate(node) {
  if (ts.isVariableDeclaration(node) && node.name.text === "labels") labels = node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.text === "recoveryErrors") errorOwners.set(node.name.text, `const ${node.getText(ast)};`);
  if (ts.isFunctionDeclaration(node) && ["rpcCode", "structuredCategory", "knownMessageCategory", "errorCategory", "recoveryErrorMessage"].includes(node.name?.text))
    errorOwners.set(node.name.text, node.getText(ast));
  if (ts.isFunctionDeclaration(node) && node.name?.text === "initialize") initialize = node;
  ts.forEachChild(node, locate);
}
locate(ast);

const locals = new Map();
for (const statement of initialize.body.statements) {
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) locals.set(declaration.name.text, declaration);
  }
}

const textOf = node => source.slice(node.getStart(ast), node.end);

test("recovery errors expose only established guards and classify evidence without keyword inference", () => {
  assert.equal(errorOwners.size, 6);
  const actual = new vm.Script([...errorOwners.values(), "({ errorCategory, recoveryErrorMessage })"].join("\n"))
    .runInNewContext();
  for (const message of ["login failed", "not a quota error", 'quoted "connection timeout"',
    "tool execution succeeded", "invalid params are not involved", "unavailable",
    "Fatal error: native inference helper failed (provider_headers_timeout) injected",
    "SECRET (provider_connection_dns)",
    "미분류 오류: native inference helper failed (provider_http_400)",
    "Fatal error: native inference helper failed (provider_failure)",
    "Fatal error: native inference helper failed (provider_http_503)"]) {
    assert.equal(actual.recoveryErrorMessage({ message }), "정의되지 않은 오류");
    for (const code of [401, 403, 408, 429, 502, 503, 504, -32001])
      assert.equal(actual.errorCategory({ code, message }, "tool/call"), "unknown");
  }
  for (const code of [-32700, -32600, -32601, -32602])
    assert.equal(actual.errorCategory({ code, message: "SECRET" }), "protocol");
  for (const [codexErrorInfo, category] of [["unauthorized", "auth"], ["usageLimitExceeded", "usage_rate_limit"],
    ["rateLimitExceeded", "usage_rate_limit"], [{ responseStreamDisconnected: {} }, "connection"], ["sandboxError", "tool"]])
    assert.equal(actual.errorCategory({ codexErrorInfo, message: "SECRET" }), category);
  for (const message of ["연결이 변경되었습니다. 상태를 다시 확인해주세요.",
    "재개 기록 저장에 실패했습니다. 저장소를 확인한 뒤 다시 시도해주세요.",
    "Fatal error: native inference helper failed (provider_headers_timeout)",
    "rate limit exceeded: 모델 요청 수 제한에 도달했습니다."]) {
    assert.equal(actual.recoveryErrorMessage({ message }), message);
    assert.equal(actual.recoveryErrorMessage({ message: `${message}\n` }), "정의되지 않은 오류");
    assert.equal(actual.recoveryErrorMessage({ message: `not true: ${message}` }), "정의되지 않은 오류");
    assert.equal(actual.recoveryErrorMessage({ message, codexErrorInfo: "unauthorized" }), "정의되지 않은 오류");
  }
  assert.equal(actual.errorCategory({ codexErrorInfo: "unauthorized", message: "rate limit exceeded: 모델 요청 수 제한에 도달했습니다." }), "auth");
  assert.equal(actual.errorCategory({ codexErrorInfo: { unauthorized: {}, sandboxError: {} }, message: "SECRET" }), "unknown");
  const legacy = { codexErrorInfo: "rateLimitExceeded", message: "rate limit exceeded: Provider request rate limit reached. Try again later." };
  assert.equal(actual.errorCategory(legacy), "unknown");
  assert.equal(actual.recoveryErrorMessage(legacy), "정의되지 않은 오류");
  const unsupported = "The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account.";
  assert.equal(actual.recoveryErrorMessage({ message: unsupported, codexErrorInfo: "badRequest" }), unsupported);
  for (const codexErrorInfo of ["unauthorized", "rateLimitExceeded", "unknownCategory", { badRequest: {}, unauthorized: {} }])
    assert.equal(actual.recoveryErrorMessage({ message: unsupported, codexErrorInfo }), "정의되지 않은 오류");

});

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
