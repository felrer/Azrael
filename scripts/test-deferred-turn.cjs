"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { rewriteJavaScript, transformAsset } = require("./namespace-azrael-host.cjs");
const patch = require("./inject-deferred-turn.cjs");
const waitHelpers = require("./root-resume-wait.cjs");

const root = process.env.AZRAEL_PINNED_HOST_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.930.61225");
const inputs = [
  [patch.DEFERRED_REDUCER_ASSET, patch.injectDeferredTurn, 9],
  [patch.DEFERRED_PRESENTATION_ASSET, patch.injectDeferredPresentation, 9],
  ["out/extension.js", patch.injectDeferredHostNotification, 1],
  [patch.DEFERRED_WAIT_RENDERER_ASSET, patch.injectDeferredWaitRenderer, 2],
  [patch.DEFERRED_THREAD_ASSET, patch.injectDeferredThread, 4],
  [patch.DEFERRED_TURN_ASSET, patch.injectDeferredTurnView, 3],
  [patch.DEFERRED_COLLAPSED_ASSET, patch.injectDeferredCollapsed, 2],
].map(([asset, inject, count]) => {
  const file = path.join(root, asset);
  const source = rewriteJavaScript(fs.readFileSync(file, "utf8"), file, ts).text;
  return { file, source, result: inject(source), inject, count };
});

const astCache = new Map();
function sourceAst(source) {
  if (!astCache.has(source)) astCache.set(source, ts.createSourceFile("fixture.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
  return astCache.get(source);
}

function functionContaining(source, marker) {
  const ast = sourceAst(source);
  const position = source.indexOf(marker);
  assert.notEqual(position, -1);
  let found;
  function visit(node) {
    if (node.pos <= position && node.end >= position) {
      if (ts.isFunctionDeclaration(node)) found = node;
      ts.forEachChild(node, visit);
    }
  }
  visit(ast);
  assert.ok(found);
  return source.slice(found.getStart(ast), found.end);
}

function functionNamed(source, name) {
  const ast = sourceAst(source);
  const found = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(found, name);
  return source.slice(found.getStart(ast), found.end);
}

// Resolve the pinned module's real export. Replacing a converter with an
// identity stub would hide a mistaken import of the error classifier.
function importedReducerFunction(alias) {
  const ast = sourceAst(inputs[0].source);
  const declaration = ast.statements.find(node => ts.isImportDeclaration(node) &&
    node.importClause?.namedBindings?.elements?.some(item => item.name.text === alias));
  assert.ok(declaration, alias);
  const binding = declaration.importClause.namedBindings.elements.find(item => item.name.text === alias);
  const modulePath = path.resolve(path.dirname(inputs[0].file), declaration.moduleSpecifier.text);
  const moduleSource = fs.readFileSync(modulePath, "utf8"), moduleAst = sourceAst(moduleSource);
  const exportedName = binding.propertyName?.text ?? binding.name.text;
  const exportDeclaration = moduleAst.statements.find(node => ts.isExportDeclaration(node) &&
    node.exportClause?.elements?.some(item => item.name.text === exportedName));
  assert.ok(exportDeclaration, exportedName);
  const exported = exportDeclaration.exportClause.elements.find(item => item.name.text === exportedName);
  return vm.runInNewContext(`(${functionNamed(moduleSource, exported.propertyName?.text ?? exported.name.text)})`);
}
const nativeConverter = inputs[0].source.match(/let\{threadId:s,turn:c\}=t\.params,l=([A-Za-z_$][\w$]*)\(s\);if\(!o\.threadStore\.conversations\.has\(l\)\)/)[1];
const reducerBindings = { [nativeConverter]: importedReducerFunction(nativeConverter), m: importedReducerFunction("m") };
const nativeLookup = vm.runInNewContext(["zh", "Ih", "Fh"].map(name => functionNamed(inputs[0].source, name)).join("\n") + "\nFh");
reducerBindings.Fh = nativeLookup;

function recoveryFixture(canonical = false, includeOld = true) {
  const source = inputs[0].result.text;
  const bindings = vm.runInNewContext(["zh", "Ih", "Fh", "Nh", "Aue", "Ah", "Ph", "Lh", "uQ"]
    .map(name => functionNamed(source, name)).join("\n") + "\n({Fh,Nh,Ph,Lh,uQ})");
  const reducer = vm.runInNewContext(`(${functionContaining(source, "case\u0060turn/deferred\u0060:")})`,
    { ...reducerBindings, ...waitHelpers, ...bindings });
  const old = { turnId: "old-turn", status: "inProgress", durationMs: 777777, items: [], params: {}, turnStartedAtMs: 12000 };
  const fresh = { turnId: "new-turn", status: "inProgress", durationMs: null, items: [], params: {}, turnStartedAtMs: 66000 };
  const conversation = { id: "thread", turns: [], requests: [] };
  function loadOld() {
    if (canonical) {
      conversation.turnHistory.history.entitiesByKey.old = old;
      conversation.turnHistory.history.islands[0].entries.unshift({ key: "old", value: "old" });
    } else conversation.turns.unshift(old);
  }
  if (canonical) conversation.turnHistory = { kind: "canonical", history: {
    islands: [{ entries: [{ key: "new", value: "new" }], newerBoundary: { status: "exhausted" } }], entitiesByKey: { new: fresh },
  } };
  else conversation.turns.push(fresh);
  if (includeOld) loadOld();
  const logs = [], requests = [], pages = [], broadcasts = [];
  const context = {
    itemStreamState: { drainBefore: () => false }, threadStore: { conversations: new Map([["thread", conversation]]) },
    updateTurnState: (id, turnId, update) => { const turn = bindings.Fh(conversation, t => t.turnId === turnId); if (turn) update(turn); },
  };
  const manager = {
    getConversation: id => id === "thread" ? conversation : null,
    logger: { info: (event, fields) => logs.push(fields), error: () => assert.fail("unexpected error") },
    updateConversationState: (id, update) => update(conversation),
    listThreadTurns: async (id, options) => { requests.push({ id, options }); const page = pages.shift(); if (page instanceof Error) throw page; return page; },
    broadcastConversationSnapshot: vm.runInNewContext("(function(e){" +
      "azraelFlushDeferred(this,e);return this.streamState.broadcastConversationSnapshot(e)})", waitHelpers),
    streamState: { broadcastConversationSnapshot: id => broadcasts.push(id) },
  };
  // Execute the exact injected native manager method, including its flush hook.
  const method = source.match(/broadcastConversationSnapshot\(e\)\{azraelFlushDeferred\(this,e\);return this\.streamState\.broadcastConversationSnapshot\(e\)\}/)[0];
  manager.broadcastConversationSnapshot = vm.runInNewContext(`({${method}}).broadcastConversationSnapshot`, waitHelpers);
  const emit = (wait, id = "old-turn") => reducer({ manager, notificationContext: context },
    { method: "turn/rootResumeWait/updated", params: { threadId: "thread", turnId: id, wait } });
  const start = () => reducer({ manager, notificationContext: context },
    { method: "turn/started", params: { threadId: "thread", turn: { id: "new-turn", status: "inProgress", durationMs: null, error: null } } }, null, 66000);
  const settle = async () => {
    const journal = waitHelpers.azraelDeferredJournals.get(manager);
    await Promise.all([...journal.records.values()].map(record => record.inFlight));
  };
  return { old, fresh, conversation, loadOld, manager, emit, start, pages, requests, logs, broadcasts, settle, reducer, context };
}

for (const canonical of [false, true]) {
  test(`wait-only recovery uses native ${canonical ? "canonical" : "legacy"} lookup and native started reducer`, async () => {
    const f = recoveryFixture(canonical);
    let resolve;
    f.manager.listThreadTurns = async (id, options) => {
      f.requests.push({ id, options });
      if (options.cursor == null) return { response: { data: [{ id: "new-turn", status: "inProgress" }], nextCursor: "older" } };
      return new Promise(done => { resolve = done; });
    };
    f.emit(reservation());
    assert.equal(f.old.status, "deferred");
    assert.equal(f.old.durationMs, null);
    f.emit(reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 }));
    f.start();
    assert.equal(f.fresh.status, "inProgress");
    assert.equal(f.fresh.durationMs, null);
    await Promise.resolve();
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].options.cursor, "older");
    resolve({ response: { data: [{ id: "old-turn", status: "deferred", durationMs: 8000, startedAt: 12, rootResumeWait: reservation() }], nextCursor: null } });
    await f.settle();
    assert.equal(f.old.status, "deferred");
    assert.equal(f.old.durationMs, 8000);
    assert.equal(f.old.rootResumeWait.state, "resumed");
    assert.equal(f.old.rootResumeWait.waitEndedAtMs, 66000);
    assert.equal(f.fresh.status, "inProgress");
    f.emit(reservation({ reservationId: "wrong", revision: 99 }));
    f.emit(reservation());
    assert.equal(f.requests.length, 2);
    assert.equal(f.old.durationMs, 8000);
  });

  test(`missing ${canonical ? "canonical" : "legacy"} old history waits for normal load without tail append`, async () => {
    const f = recoveryFixture(canonical, false);
    f.pages.push({ response: { data: [{ id: "old-turn", status: "deferred", durationMs: 8000, startedAt: 12 }], nextCursor: null } });
    f.emit(reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 }));
    await f.settle();
    assert.equal(nativeLookup(f.conversation, t => t.turnId === "old-turn"), null);
    assert.equal(f.fresh.status, "inProgress");
    const hydrate = vm.runInNewContext(`(${functionNamed(inputs[0].result.text, "Nyn")})`, {
      ...waitHelpers, Pyn: x => x, Iyn: x => x == null ? null : x * 1000, s: () => ({}), Ve: () => [],
    });
    Object.assign(f.old, hydrate({ threadId: "thread", turns: [{ id: "old-turn", items: [],
      status: "inProgress", startedAt: 12, completedAt: null, durationMs: 777777 }], permissions: {} })[0]);
    f.loadOld();
    f.manager.broadcastConversationSnapshot("thread");
    assert.equal(f.old.status, "deferred");
    assert.equal(f.old.durationMs, 8000);
    assert.equal(f.old.rootResumeWait.state, "resumed");
    const ordered = canonical ? f.conversation.turnHistory.history.islands[0].entries.map(entry => f.conversation.turnHistory.history.entitiesByKey[entry.value].turnId) : f.conversation.turns.map(turn => turn.turnId);
    assert.deepEqual(ordered, ["old-turn", "new-turn"]);
    assert.equal(waitHelpers.azraelDeferredJournals.get(f.manager).records.size, 0);
  });
}

test("preparing cancellation never freezes work; failed queries never loop; terminals remain terminal", async () => {
  for (const state of ["preparing", "cancelled", "blocked"]) {
    const f = recoveryFixture();
    f.emit(reservation({ state, waitStartedAtMs: null }));
    assert.equal(f.old.status, "inProgress");
    assert.equal(f.old.durationMs, 777777);
    assert.equal(f.requests.length, 0);
  }
  const f = recoveryFixture();
  f.pages.push(new Error("private exception"));
  f.emit(reservation());
  await f.settle();
  assert.equal(f.old.status, "deferred");
  assert.equal(f.old.durationMs, null);
  f.manager.broadcastConversationSnapshot("thread");
  f.emit(reservation());
  await f.settle();
  assert.equal(f.requests.length, 1);
  assert.equal(f.logs.find(log => log.safe.outcome === "query_failed").safe.pages, 0);
  assert.ok(!JSON.stringify(f.logs).includes("private exception"));
  for (const status of ["completed", "interrupted", "failed"]) {
    const t = recoveryFixture();
    t.old.status = status;
    t.emit(reservation());
    assert.equal(t.old.status, status);
    assert.equal(t.old.durationMs, 777777);
    assert.equal(t.requests.length, 0);
  }
});

test("empty pages and cursor cycles fail safely; explicit deferred missing turns need no query", async () => {
  for (const pages of [
    [{ response: { data: [], nextCursor: "older" } }],
    [{ response: { data: [{ id: "other" }], nextCursor: "older" } }, { response: { data: [{ id: "other" }], nextCursor: "older" } }],
  ]) {
    const f = recoveryFixture();
    f.pages.push(...pages);
    f.emit(reservation());
    await f.settle();
    assert.equal(f.requests.length, pages.length);
    assert.equal(f.old.durationMs, null);
  }
  const f = recoveryFixture(true, false);
  f.reducer({ manager: f.manager, notificationContext: f.context }, { method: "turn/deferred", params: {
    threadId: "thread", turn: { id: "old-turn", durationMs: 8000, startedAt: 12, rootResumeWait: reservation() },
  } });
  f.emit(reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 }));
  assert.equal(f.requests.length, 0);
  f.loadOld();
  f.manager.broadcastConversationSnapshot("thread");
  assert.equal(f.old.durationMs, 8000);
  assert.equal(f.old.status, "deferred");
});

test("journal clears after native-style immutable state replacement", async () => {
  const f = recoveryFixture();
  f.context.updateTurnState = (id, turnId, update) => {
    const index = f.conversation.turns.findIndex(turn => turn.turnId === turnId);
    if (index < 0) return;
    const replacement = structuredClone(f.conversation.turns[index]);
    update(replacement);
    f.conversation.turns[index] = replacement;
  };
  f.pages.push({ response: { data: [{ id: "old-turn", status: "deferred", durationMs: 8000 }], nextCursor: null } });
  f.emit(reservation());
  assert.equal(nativeLookup(f.conversation, t => t.turnId === "old-turn").durationMs, null);
  await f.settle();
  assert.equal(nativeLookup(f.conversation, t => t.turnId === "old-turn").durationMs, 8000);
  assert.equal(waitHelpers.azraelDeferredJournals.get(f.manager).records.size, 0);
});

test("authoritative metadata ends a wait when only its waiting event arrived", async () => {
  for (const canonical of [false, true]) {
    const f = recoveryFixture(canonical);
    const ended = reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 });
    f.pages.push({ response: { data: [{ id: "old-turn", status: "deferred", durationMs: 8000,
      startedAt: 12, rootResumeWait: ended }], nextCursor: null } });
    f.emit(reservation());
    assert.equal(f.old.rootResumeWait.state, "waiting");
    await f.settle();
    assert.equal(f.old.durationMs, 8000);
    assert.equal(f.old.rootResumeWait.state, "resumed");
    assert.equal(f.old.rootResumeWait.revision, 3);
    assert.equal(f.old.rootResumeWait.waitEndedAtMs, 66000);
    assert.equal(waitHelpers.azraelRootResumeWaitItem(f.old.rootResumeWait).status, "azraelWaitEnded");
    assert.equal(waitHelpers.azraelDeferredJournals.get(f.manager).records.size, 0);
    assert.equal(f.fresh.status, "inProgress");
  }
});

test("terminal work accepts only matching newer ended wait notifications", () => {
  for (const status of ["interrupted", "completed", "failed"])
    for (const state of ["cancelled", "resumed"]) {
      const f = recoveryFixture();
      Object.assign(f.old, { status, durationMs: 8000, error: { message: "terminal" },
        rootResumeWait: reservation(), finalAssistantStartedAtMs: 20000, completedAt: 20 });
      const fields = ["status", "durationMs", "error", "turnStartedAtMs", "finalAssistantStartedAtMs", "completedAt"];
      const before = Object.fromEntries(fields.map(field => [field, f.old[field]]));
      f.emit(reservation({ state, revision: 3, waitEndedAtMs: 32000 }));
      for (const field of fields) assert.equal(f.old[field], before[field]);
      assert.equal(f.old.rootResumeWait.state, state);
      assert.equal(f.old.rootResumeWait.waitEndedAtMs, 32000);
      const clock = clockHook();
      const item = waitHelpers.azraelRootResumeWaitItem(f.old.rootResumeWait);
      assert.equal(clock.render(item).elapsedMs, 12000);
      assert.equal(clock.interval(), null);
      clock.advance(3600000);
      assert.equal(clock.render(item).elapsedMs, 12000);
      assert.equal(waitHelpers.azraelRootResumeWaitLabel(f.old.rootResumeWait, 12000),
        state === "cancelled" ? "12초 대기 후 예약 취소됨" : "12초 대기 후 재개됨");
      const ended = f.old.rootResumeWait;
      f.emit(reservation());
      f.emit(reservation({ reservationId: "wrong", state, revision: 99, waitEndedAtMs: 99999 }));
      f.emit(reservation({ revision: 99, state: "waiting", waitEndedAtMs: 99999 }));
      f.reducer({ manager: f.manager, notificationContext: f.context }, { method: "turn/deferred", params: {
        threadId: "thread", turn: { id: "old-turn", durationMs: 99999, startedAt: 99,
          rootResumeWait: reservation({ state: "resumed", revision: 99, waitEndedAtMs: 99999 }) },
      } });
      assert.equal(f.old.rootResumeWait, ended);
      for (const field of fields) assert.equal(f.old[field], before[field]);
      assert.equal(f.requests.length, 0);
    }
  const f = recoveryFixture();
  Object.assign(f.old, { status: "completed", durationMs: 8000, rootResumeWait: reservation() });
  f.reducer({ manager: f.manager, notificationContext: f.context }, { method: "turn/deferred", params: {
    threadId: "thread", turn: { id: "old-turn", durationMs: 99999, startedAt: 99,
      rootResumeWait: reservation({ state: "resumed", revision: 3, waitEndedAtMs: 32000 }) },
  } });
  assert.equal(f.old.status, "completed");
  assert.equal(f.old.durationMs, 8000);
  assert.equal(f.old.turnStartedAtMs, 12000);
  assert.equal(f.old.rootResumeWait.waitEndedAtMs, 32000);
  assert.equal(f.requests.length, 0);
});

test("pending metadata flush ends terminal waits while preserving measured terminal work", async () => {
  for (const includeOld of [true, false]) {
    const f = recoveryFixture(true, includeOld);
    const ended = reservation({ state: "resumed", revision: 3, waitEndedAtMs: 32000 });
    f.pages.push({ response: { data: [{ id: "old-turn", status: "deferred", durationMs: 99999,
      startedAt: 99, rootResumeWait: ended }], nextCursor: null } });
    f.emit(reservation());
    Object.assign(f.old, { status: "interrupted", durationMs: 8000, rootResumeWait: reservation(),
      error: { message: "terminal" }, turnStartedAtMs: 12000, finalAssistantStartedAtMs: 20000 });
    await f.settle();
    if (!includeOld) {
      f.loadOld();
      f.manager.broadcastConversationSnapshot("thread");
    }
    assert.equal(f.old.status, "interrupted");
    assert.equal(f.old.durationMs, 8000);
    assert.equal(f.old.turnStartedAtMs, 12000);
    assert.equal(f.old.finalAssistantStartedAtMs, 20000);
    assert.equal(f.old.error.message, "terminal");
    assert.equal(f.old.rootResumeWait.state, "resumed");
    assert.equal(f.old.rootResumeWait.waitEndedAtMs, 32000);
    assert.equal(waitHelpers.azraelDeferredJournals.get(f.manager).records.size, 0);
    f.manager.broadcastConversationSnapshot("thread");
    assert.equal(f.requests.length, 1);
  }
});

test("wait boundaries normalize native hydration and stale snapshots without inventing duration", () => {
  const hydrate = vm.runInNewContext(`(${functionNamed(inputs[0].result.text, "Nyn")})`, {
    ...waitHelpers, Pyn: x => x, Iyn: x => x == null ? null : x * 1000, s: () => ({}), Ve: () => [],
  });
  const wait = reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 });
  const turn = hydrate({ threadId: "thread", turns: [{ id: "old-turn", items: [],
    status: "inProgress", startedAt: 12, completedAt: null, durationMs: 777777, rootResumeWait: wait }], permissions: {} })[0];
  assert.equal(turn.status, "deferred");
  assert.equal(turn.durationMs, null);
  const merge = vm.runInNewContext(`(${functionNamed(inputs[0].result.text, "mue")})`, {
    ...waitHelpers, vue: { default: () => true }, wh: () => null,
    gue: (existing, incoming) => incoming.params, bh: (existing, incoming) => incoming,
  });
  const result = merge({ ...turn, params: {} }, { ...turn, params: {}, status: "inProgress", durationMs: 999999, rootResumeWait: null }, { isResumeSnapshot: true });
  assert.equal(result.status, "deferred");
  assert.equal(result.durationMs, null);
  assert.equal(result.rootResumeWait, wait);
});

test("deferred anchors match the pinned host, parse, and fail closed", () => {
  for (const { file, source, result, inject, count } of inputs) {
    assert.equal(result.count, count, file);
    assert.equal(ts.createSourceFile(file, result.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0);
    assert.throws(() => inject(result.text), /anchor must occur exactly once/);
    assert.throws(() => inject("anchor missing"), /anchor must occur exactly once/);
    assert.notEqual(source, result.text);
  }
});

test("deferred updates the current turn without terminal side effects and drains before replay", () => {
  const reducer = vm.runInNewContext(`(${functionContaining(inputs[0].result.text, "case`turn/deferred`:")})`, { ...reducerBindings, ...waitHelpers });
  const turn = { turnId: "turn-1", status: "inProgress", error: { message: "stale" }, items: [] };
  const conversation = { turns: [turn] }, conversations = new Map([["thread-1", conversation]]), calls = [];
  let draining = true, replay;
  const manager = {
    getConversation: id => conversations.get(id),
    logger: { error: () => calls.push("error") },
    broadcastConversationSnapshot: () => calls.push("snapshot"),
    onNotification: () => calls.push("replay"),
  };
  const notificationContext = {
    itemStreamState: { drainBefore: callback => { if (draining) replay = callback; return draining; } },
    threadStore: { conversations },
    updateTurnState: (_thread, _id, update) => { calls.push("update"); update(turn); },
  };
  const event = { method: "turn/deferred", params: { threadId: "thread-1", turn: { id: "turn-1", durationMs: 4250, startedAt: 12 } } };
  const environment = { manager, notificationContext };
  assert.equal(reducer(environment, event), "deferred");
  assert.deepEqual(calls, []);
  draining = false;
  replay();
  assert.deepEqual(calls, ["replay"]);
  assert.equal(reducer(environment, event), "handled");
  assert.deepEqual(calls, ["replay", "update", "snapshot"]);
  assert.equal(turn.status, "deferred");
  assert.equal(turn.durationMs, 4250);
  assert.equal(turn.turnStartedAtMs, 12000);
  assert.equal(turn.error, null);
  assert.equal(conversation.turns.length, 1);
});

test("both live notifications use the native conversation converter and reject a missing anchor", () => {
  assert.equal(reducerBindings[nativeConverter]("thread-1"), "thread-1");
  assert.equal(reducerBindings.m("thread-1"), undefined);
  const handler = functionContaining(inputs[0].result.text, "case`turn/deferred`:");
  assert.equal(handler.split(`l=${nativeConverter}(s);`).length, 4); // native completion + two added notifications
  assert.ok(!handler.includes("l=m(s);"));
  const changed = inputs[0].source.replace(`let{threadId:s,turn:c}=t.params,l=${nativeConverter}(s);`, "let{threadId:s,turn:c}=t.params,l=s;");
  assert.throws(() => patch.injectDeferredTurn(changed), /native conversation converter anchor/);
});

test("presentation projects deferred duration and a frozen waiting divider", () => {
  const source = inputs[1].result.text;
  const status = vm.runInNewContext(`(${functionNamed(source, "_it")})`);
  const duration = vm.runInNewContext(`(${functionNamed(source, "jgt")})`);
  const divider = vm.runInNewContext(`(${functionNamed(source, "Hgt")})`, waitHelpers);
  assert.equal(status("deferred"), "deferred");
  assert.equal(duration({ turnStartedAtMs: 12000, durationMs: 4250 }), 16250);
  assert.deepEqual(JSON.parse(JSON.stringify(divider({ items: [{ type: "agent-message" }], status: "deferred", workStartedAtMs: 12000, finalAssistantStartedAtMs: 16250 })[1])),
    { type: "worked-for", status: "worked", startedAtMs: 12000, completedAtMs: 16250 });
  assert.deepEqual(JSON.parse(JSON.stringify(divider({ items: [], status: "deferred", workStartedAtMs: null, finalAssistantStartedAtMs: null })[0])),
    { type: "worked-for", status: "pausedUnknown", startedAtMs: 0, completedAtMs: 0 });
  assert.match(source, /case`pausedUnknown`:l=`작업 시간 확인 불가`/);
  assert.match(source, /case`azraelWaitUnknown`:l=`재개 대기 이력 · 대기 시간 확인 불가`/);
  assert.ok(source.includes("durationMs"));
});

function reservation(overrides = {}) {
  return { reservationId: "reservation-1", revision: 1, waitStartedAtMs: 20000, waitEndedAtMs: null,
    resumeAtMs: 80000, state: "waiting", canWakeEarly: false, ...overrides };
}

function clockHook() {
  let now = 20000, state, callback, interval;
  const slots = Array(7).fill(Symbol.for("react.memo_cache_sentinel"));
  const hook = vm.runInNewContext(`(${functionNamed(inputs[1].result.text, "RFi")})`, {
    BFi: { c: () => slots }, ra: () => ({ locale: "ko-KR" }),
    VFi: { useState: init => { state ??= init(); return [state, value => { state = value; }]; } },
    zFi: () => now, Date: { now: () => now },
    Wbn: (fn, delay) => { callback = fn; interval = delay; }, eCi: ms => `${Math.floor(ms / 1000)}초`,
  });
  return {
    render: item => hook(item),
    advance: ms => { now += ms; if (interval != null) callback(); },
    interval: () => interval,
  };
}

test("waiting uses the existing clock hook, then freezes after early resume or cancellation", () => {
  const clock = clockHook(), wait = reservation({ canWakeEarly: true });
  let item = waitHelpers.azraelRootResumeWaitItem(wait);
  assert.equal(clock.render(item).elapsedMs, 0);
  assert.equal(clock.interval(), 1000);
  clock.advance(12000);
  assert.equal(waitHelpers.azraelRootResumeWaitLabel(wait, clock.render(item).elapsedMs),
    "재개까지 최대 60초 대기 · 현재 12초 대기함 · 자식 작업 완료 시 조기 재개");
  const ended = { ...wait, state: "resumed", revision: 3, waitEndedAtMs: 66000 };
  item = waitHelpers.azraelRootResumeWaitItem(ended);
  assert.equal(clock.render(item).elapsedMs, 46000);
  assert.equal(clock.interval(), null);
  clock.advance(600000);
  assert.equal(clock.render(item).elapsedMs, 46000);
  assert.equal(waitHelpers.azraelRootResumeWaitLabel(ended, 46000), "46초 대기 후 재개됨");
  assert.equal(waitHelpers.azraelRootResumeWaitLabel({ ...ended, state: "cancelled" }, 46000), "46초 대기 후 예약 취소됨");
});

test("repeated reservations have independent clocks and completed history has no running divider", () => {
  const divider = vm.runInNewContext(`(${functionNamed(inputs[1].result.text, "Hgt")})`, waitHelpers);
  const first = divider({ items: [], status: "deferred", workStartedAtMs: 12000, finalAssistantStartedAtMs: 20000,
    rootResumeWait: reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 }) });
  const secondWait = reservation({ reservationId: "reservation-2", waitStartedAtMs: 90000, resumeAtMs: 150000 });
  let second = divider({ items: [], status: "deferred", workStartedAtMs: 66000, finalAssistantStartedAtMs: 90000, rootResumeWait: secondWait });
  assert.deepEqual(Array.from(first, x => x.completedAtMs), [20000, 66000]);
  assert.deepEqual(Array.from(second, x => x.startedAtMs), [66000, 90000]);
  const workClock = clockHook();
  assert.equal(workClock.render(second[0]).elapsedMs, 24000);
  assert.equal(workClock.interval(), null);
  workClock.advance(3600000);
  assert.equal(workClock.render(second[0]).elapsedMs, 24000);
  second = divider({ items: [], status: "deferred", workStartedAtMs: 66000, finalAssistantStartedAtMs: 90000,
    rootResumeWait: { ...secondWait, revision: 3, state: "resumed", waitEndedAtMs: 100000 } });
  assert.equal(second[1].completedAtMs - second[1].startedAtMs, 10000);
  assert.ok([...first, ...second].every(x => x.completedAtMs != null && x.status !== "working" && x.status !== "azraelWaiting"));
});

test("late and duplicate reservation notifications cannot restart a finished wait or change its endpoints", () => {
  const reducer = vm.runInNewContext(`(${functionContaining(inputs[0].result.text, "case`turn/deferred`:")})`, { ...reducerBindings, ...waitHelpers });
  const turn = { turnId: "old-turn", status: "deferred", durationMs: 8000, rootResumeWait: reservation() };
  const env = {
    manager: { getConversation: () => ({ turns: [turn] }), broadcastConversationSnapshot: () => {} },
    notificationContext: { itemStreamState: { drainBefore: () => false },
      threadStore: { conversations: new Map([["thread", { turns: [turn] }]]) },
      updateTurnState: (_thread, id, update) => { assert.equal(id, turn.turnId); update(turn); } },
  };
  const emit = wait => reducer(env, { method: "turn/rootResumeWait/updated", params: { threadId: "thread", turnId: "old-turn", wait } });
  emit(reservation({ revision: 2, state: "claimed", waitEndedAtMs: 66000 }));
  emit(reservation({ revision: 3, state: "resumed", waitStartedAtMs: 21000, waitEndedAtMs: 67000 }));
  assert.equal(turn.rootResumeWait.waitStartedAtMs, 20000);
  assert.equal(turn.rootResumeWait.waitEndedAtMs, 66000);
  emit(reservation());
  emit(reservation({ revision: 4 }));
  emit(reservation({ reservationId: "unrelated", revision: 9 }));
  assert.equal(turn.rootResumeWait.state, "resumed");
  assert.equal(turn.rootResumeWait.revision, 3);
  turn.status = "interrupted";
  reducer(env, { method: "turn/deferred", params: { threadId: "thread", turn: { id: "old-turn", durationMs: 1, startedAt: 99 } } });
  assert.equal(turn.status, "interrupted");
  assert.equal(turn.durationMs, 8000);
});

test("history hydration retains wait metadata including missing historical boundaries", () => {
  const hydrate = vm.runInNewContext(`(${functionNamed(inputs[0].result.text, "Nyn")})`, {
    ...waitHelpers, Pyn: x => x, Iyn: x => x == null ? null : x * 1000, s: () => ({}), Ve: () => [],
  });
  const wait = reservation({ revision: 3, state: "resumed", waitEndedAtMs: 66000 });
  const history = hydrate({ threadId: "thread", turns: [{ id: "old-turn", items: [], status: "deferred", startedAt: 12,
    completedAt: null, durationMs: 8000, rootResumeWait: wait }], permissions: {} });
  assert.equal(history[0].rootResumeWait, wait);
  const item = waitHelpers.azraelRootResumeWaitItem(history[0].rootResumeWait);
  const clock = clockHook();
  assert.equal(clock.render(item).elapsedMs, 46000);
  assert.equal(clock.interval(), null);
  const unknown = reservation({ state: "resumed", waitStartedAtMs: null, waitEndedAtMs: null });
  assert.equal(waitHelpers.azraelRootResumeWaitLabel(unknown, 0), "재개됨 · 대기 시간 확인 불가");
  assert.equal(waitHelpers.azraelRootResumeWaitItem(unknown).status, "azraelWaitEnded");
});

test("terminal merge preserves state and timing against active or deferred wait snapshots", () => {
  const merge = vm.runInNewContext(`(${functionNamed(inputs[0].result.text, "mue")})`, {
    ...waitHelpers, vue: { default: () => true }, wh: () => null,
    gue: (existing, incoming) => incoming.params, bh: (existing, incoming) => incoming,
  });
  for (const status of ["interrupted", "completed", "failed"])
    for (const incomingStatus of ["inProgress", "deferred"])
      for (const state of ["waiting", "resumed"])
        for (const isResumeSnapshot of [false, true])
          for (const preserveExistingTerminalState of [false, true]) {
            const existing = { turnId: "old-turn", status, items: [], params: {}, error: { message: "terminal" },
              durationMs: 8000, turnStartedAtMs: 12000, firstTurnWorkItemStartedAtMs: 13000,
              finalAssistantStartedAtMs: 19000, completedAt: 20 };
            const incoming = { ...existing, status: incomingStatus, error: null, durationMs: 999999,
              turnStartedAtMs: 999, firstTurnWorkItemStartedAtMs: 999,
              finalAssistantStartedAtMs: 999, completedAt: 999, rootResumeWait: reservation({ state }) };
            const result = merge(existing, incoming, { isResumeSnapshot, preserveExistingTerminalState });
            for (const field of ["status", "error", "durationMs", "turnStartedAtMs", "firstTurnWorkItemStartedAtMs", "finalAssistantStartedAtMs", "completedAt"])
              assert.equal(result[field], existing[field], `${status}/${incomingStatus}/${state}/${isResumeSnapshot}/${preserveExistingTerminalState}/${field}`);
          }
});

test("pending unknown duration skips unchanged snapshot updates", async () => {
  const f = recoveryFixture();
  let updates = 0;
  const original = f.context.updateTurnState;
  f.context.updateTurnState = (...args) => { updates++; return original(...args); };
  f.pages.push({ response: { data: [], nextCursor: null } });
  f.emit(reservation());
  await f.settle();
  assert.equal(updates, 1);
  for (let i = 0; i < 10; i++) f.manager.broadcastConversationSnapshot("thread");
  assert.equal(updates, 1);
  f.emit(reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 }));
  await f.settle();
  assert.equal(updates, 2);
});

test("late active snapshots cannot restart a deferred work clock on resume or refresh", () => {
  const context = { ...waitHelpers, vue: { default: () => true }, wh: () => null,
    gue: (existing, incoming) => incoming.params, bh: (existing, incoming) => incoming };
  const merge = vm.runInNewContext(`(${functionNamed(inputs[0].result.text, "mue")})`, context);
  const original = vm.runInNewContext(`(${functionNamed(inputs[0].source, "mue")})`, context);
  const frozen = { turnId: "old-turn", status: "deferred", items: [], params: {},
    turnStartedAtMs: 12000, durationMs: 8000, rootResumeWait: reservation() };
  const stale = { ...frozen, status: "inProgress", durationMs: 99000, rootResumeWait: null };
  // This is the race that used to reactivate a non-paginated turn after deferral.
  assert.equal(original(frozen, stale, { isResumeSnapshot: true }).status, "inProgress");
  const divider = vm.runInNewContext(`(${functionNamed(inputs[1].result.text, "Hgt")})`, waitHelpers);
  const end = vm.runInNewContext(`(${functionNamed(inputs[1].result.text, "jgt")})`);
  for (const isResumeSnapshot of [false, true]) {
    const turn = merge(frozen, stale, { isResumeSnapshot });
    assert.equal(turn.status, "deferred");
    assert.equal(turn.durationMs, 8000);
    assert.equal(turn.rootResumeWait, frozen.rootResumeWait);
    const work = divider({ items: [], status: turn.status, workStartedAtMs: turn.turnStartedAtMs,
      finalAssistantStartedAtMs: end(turn), rootResumeWait: turn.rootResumeWait })[0];
    const clock = clockHook();
    assert.equal(clock.render(work).elapsedMs, 8000);
    assert.equal(clock.interval(), null);
    clock.advance(3600000);
    assert.equal(clock.render(work).elapsedMs, 8000);
  }
  const stopped = merge(frozen, { ...stale, status: "interrupted", durationMs: 8000 }, {});
  assert.equal(stopped.status, "interrupted");
  assert.equal(stopped.durationMs, 8000);
});

test("blocked and processing reservations freeze elapsed time independently of the scheduled deadline", () => {
  for (const state of ["claimed", "blocked", "cancelled"]) {
    const wait = reservation({ state, waitEndedAtMs: 32000 });
    const clock = clockHook(), item = waitHelpers.azraelRootResumeWaitItem(wait);
    assert.equal(clock.render(item).elapsedMs, 12000);
    assert.equal(clock.interval(), null);
    clock.advance(3600000);
    assert.equal(clock.render(item).elapsedMs, 12000);
  }
  assert.equal(waitHelpers.azraelRootResumeWaitLabel(reservation(), 12000), "60초 대기 예정 · 현재 12초 대기함");
  assert.equal(waitHelpers.azraelRootResumeWaitLabel(reservation({ state: "blocked", waitEndedAtMs: 32000 }), 12000), "재개 차단됨 · 12초 대기");
});

test("divider preserves Codex secondary text and border styling while forwarding waiting metadata", () => {
  const source = inputs[1].result.text;
  const slots = Array(14).fill(Symbol.for("react.memo_cache_sentinel"));
  const render = vm.runInNewContext(`(${functionNamed(source, "LFi")})`, {
    BFi: { c: () => slots }, k7: { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    IFi: "clock-label", J3: "chat-padding", ni: (...values) => values.filter(Boolean).join(" "),
  });
  const waiting = waitHelpers.azraelRootResumeWaitItem(reservation());
  const result = render(waiting), container = result.props.children;
  assert.match(container.props.className, /text-size-chat text-secondary/);
  assert.equal(container.props.children[1].props.className, "w-full border-t border-default");
  assert.equal(container.props.children[0].props.rootResumeWait, waiting.rootResumeWait);
  const processing = { ...waiting, rootResumeWait: reservation({ revision: 2, state: "claimed", waitEndedAtMs: 32000 }) };
  assert.equal(render(processing).props.children.props.children[0].props.rootResumeWait.state, "claimed");
});

test("active activity projection cannot resurrect a deferred source turn or discard its waiting divider", () => {
  const presentation = inputs[1].result.text;
  const context = {
    ...waitHelpers, Vmt: () => ({ replyItemIds: new Set() }), bat: x => x,
    Ihe: () => false, Ol: () => false, LS: () => null, _be: () => -1,
    $gt: { default: (items, predicate) => items.findLastIndex(predicate) },
  };
  const declarations = ["_it", "Hgt", "azraelOriginalWorkDivider", "Ugt", "Kmt", "Wgt", "Ggt", "qgt", "Kgt", "jgt", "rht", "oht", "qmt", "BS"]
    .map(name => functionNamed(presentation, name)).join("\n");
  const project = vm.runInNewContext(`${declarations}\nBS`, context);
  const env = { ...waitHelpers, vp: () => [], sp: () => false, ot: x => x,
    Yo: (turn, requests, options) => project(turn, requests, { ...options, includeAeonProjection: false, includeTurnDiff: false }) };
  const patched = vm.runInNewContext(`(${functionNamed(inputs[4].result.text, "lp")})`, env);
  const original = vm.runInNewContext(`(${functionNamed(inputs[4].source, "lp")})`, env);
  const sourceTurn = { status: "deferred", turnId: "old-turn", turnStartedAtMs: 12000, durationMs: 8000,
    firstTurnWorkItemStartedAtMs: 12000, finalAssistantStartedAtMs: null, params: { input: [], threadId: "thread" },
    items: [], rootResumeWait: reservation() };
  const segment = { key: "segment", itemIds: [], state: "active", presentation: "voice-work", startedAtMs: 12000, completedAtMs: null };
  const props = { requests: [], generatedImages: [], preserveServerUserMessages: false };
  const before = original(props, sourceTurn, segment, {}, false);
  assert.equal(before.turn.status, "inProgress");
  assert.equal(before.turn.durationMs, null);
  assert.equal(before.turnState.items.length, 0);
  const after = patched(props, sourceTurn, segment, {}, false);
  assert.equal(after.turn.status, "deferred");
  assert.equal(after.turn.durationMs, 8000);
  assert.equal(after.voiceWorkActivity, "terminal");
  assert.equal(after.turnState.items[0].status, "worked");
  assert.equal(after.turnState.items[0].completedAtMs, 20000);
  assert.equal(after.turnState.items[1].rootResumeWait, sourceTurn.rootResumeWait);
  const ended = patched(props, { ...sourceTurn, rootResumeWait: reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 }) }, segment, {}, false);
  const clock = clockHook();
  assert.equal(clock.render(ended.turnState.items[1]).elapsedMs, 46000);
  assert.equal(clock.interval(), null);
});

test("interrupted work with a native measured duration uses a fixed stopped divider", () => {
  const divider = vm.runInNewContext(`(${functionNamed(inputs[1].result.text, "Kmt")})`);
  const stopped = divider({ status: "cancelled", hasStartedWork: true, workStartedAtMs: 12000, workedCompletedAtMs: 20000 });
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.completedAtMs, 20000);
  const clock = clockHook();
  assert.equal(clock.render(stopped).elapsedMs, 8000);
  assert.equal(clock.interval(), null);
});

test("complete host transform pipeline includes every waiting asset and preserves pinned anchors", () => {
  for (const input of inputs) {
    const asset = path.relative(root, input.file).replaceAll("\\", "/");
    const transformed = transformAsset(fs.readFileSync(input.file, "utf8"), asset, input.file, ts);
    assert.ok(transformed.asset, asset);
    assert.equal(transformed.asset.deferredTurnEdits, input.count, asset);
    assert.equal(ts.createSourceFile(asset, transformed.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0, asset);
  }
});

test("final completed work has its own fixed duration alongside earlier frozen reservation history", () => {
  const source = inputs[1].result.text;
  const declarations = ["Hgt", "azraelOriginalWorkDivider", "Ugt", "Kmt", "Wgt", "Ggt", "qgt", "Kgt"]
    .map(name => functionNamed(source, name)).join("\n");
  const divide = vm.runInNewContext(`${declarations}\nHgt`, waitHelpers);
  const items = divide({ items: [{ type: "exec" }, { type: "assistant-message", phase: "final_answer" }],
    status: "complete", workStartedAtMs: 100000, finalAssistantStartedAtMs: 110000 });
  const work = items.find(x => x.type === "worked-for");
  assert.equal(work.status, "worked");
  const clock = clockHook();
  assert.equal(clock.render(work).elapsedMs, 10000);
  assert.equal(clock.interval(), null);
  clock.advance(3600000);
  assert.equal(clock.render(work).elapsedMs, 10000);
});

test("collapsed chat summary forwards waiting metadata and updates when the reservation state changes", () => {
  const slots = Array(17).fill(Symbol.for("react.memo_cache_sentinel"));
  const render = vm.runInNewContext(`(${functionNamed(inputs[6].result.text, "C")})`, {
    T: { c: () => slots }, E: { jsx: (type, props) => ({ type, props }) }, v: "clock-label",
  });
  const item = waitHelpers.azraelRootResumeWaitItem(reservation());
  assert.equal(render({ workedForItem: item }).props.rootResumeWait.state, "waiting");
  const changed = { ...item, rootResumeWait: reservation({ revision: 2, state: "claimed", waitEndedAtMs: 32000 }) };
  assert.equal(render({ workedForItem: changed }).props.rootResumeWait.state, "claimed");
});
