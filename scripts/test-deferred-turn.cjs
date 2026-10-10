"Voe strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const xm = require("node:vm");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { rewriteJavaScript, transformAsset } = require("./namespace-azrael-host.cjs");
const patch = require("./inject-deferred-turn.cjs");
const waitHelpers = require("./root-resume-wait.cjs");

const root = process.env.AZRAEL_PRESERVATION_UI_ROOT ?? process.env.AZRAEL_PINNED_HOST_ROOT ?? path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434"));
const inputs = [
  [patch.DEFERRED_REDUCER_ASSET, patch.injectDeferredTurn, 11],
  [patch.DEFERRED_PRESENTATION_ASSET, patch.injectDeferredPresentation, 9],
  ["out/extension.js", patch.injectDeferredHostNotification, 1],
  [patch.DEFERRED_WAIT_RENDERER_ASSET, patch.injectDeferredWaitRenderer, 2],
  [patch.DEFERRED_THREAD_ASSET, patch.injectDeferredThread, 8],
  [patch.DEFERRED_TURN_ASSET, patch.injectDeferredTurnView, 3],
  [patch.DEFERRED_COLLAPSED_ASSET, patch.injectDeferredCollapsed, 2],
  [patch.DEFERRED_NOTIFICATION_ASSET, patch.injectDeferredRendererNotification, 1],
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
  return xm.runInNewContext(`(${functionNamed(moduleSource, exported.propertyName?.text ?? exported.name.text)})`);
}
const nativeConverter = inputs[0].source.match(/let\{threadId:s,turn:c\}=t\.params,l=([A-Za-z_$][\w$]*)\(s\);if\(!o\.threadStore\.conversations\.has\(l\)\)/)[1];
const reducerBindings = { [nativeConverter]: importedReducerFunction(nativeConverter), _e: importedReducerFunction("_e") };
const nativeLookup = xm.runInNewContext(["Sg", "yg", "vg"].map(name => functionNamed(inputs[0].source, name)).join("\n") + "\nvg");
reducerBindings.vg = nativeLookup;

function recoveryFixture(canonical = false, includeOld = true) {
  const source = inputs[0].result.text;
  const bindings = xm.runInNewContext(["Sg", "yg", "vg", "gg", "$le", "pg", "_g", "bg", "s$"]
    .map(name => functionNamed(source, name)).join("\n") + "\n({vg,gg,_g,bg,s$})");
  const reducer = xm.runInNewContext(`(${functionContaining(source, "case\u0060turn/deferred\u0060:")})`,
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
    updateTurnState: (id, turnId, update) => { const turn = bindings.vg(conversation, t => t.turnId === turnId); if (turn) update(turn); },
  };
  const manager = {
    getConversation: id => id === "thread" ? conversation : null,
    logger: { info: (event, fields) => logs.push(fields), error: () => assert.fail("unexpected error") },
    updateConversationState: (id, update) => update(conversation),
    listThreadTurns: async (id, options) => { requests.push({ id, options }); const page = pages.shift(); if (page instanceof Error) throw page; return page; },
    broadcastConversationSnapshot: xm.runInNewContext("(function(e){" +
      "azraelFlushDeferred(this,e);return this.streamState.broadcastConversationSnapshot(e)})", waitHelpers),
    streamState: { broadcastConversationSnapshot: id => broadcasts.push(id) },
  };
  // Execute the exact injected native manager method, including its flush hook.
  const method = source.match(/broadcastConversationSnapshot\(e\)\{azraelFlushDeferred\(this,e\);return this\.streamState\.broadcastConversationSnapshot\(e\)\}/)[0];
  manager.broadcastConversationSnapshot = xm.runInNewContext(`({${method}}).broadcastConversationSnapshot`, waitHelpers);
  const emit = (wait, id = "old-turn") => reducer({ manager, notificationContext: context },
    { method: "turn/rootResumeWait/updated", params: { threadId: "thread", turnId: id, wait } });
  const start = () => reducer({ manager, notificationContext: context },
    { method: "turn/started", params: { threadId: "thread", turn: { id: "new-turn", status: "inProgress", durationMs: null, error: null } } }, null, 66000);
  const settle = async () => {
    const journal = waitHelpers.azraelDeferredJournals.get(manager);
    if (journal == null) return;
    await Promise.all([journal.trailing, ...journal.restorations.values(), ...[...journal.records.values()].map(record => record.inFlight)]);
  };
  return { old, fresh, conversation, loadOld, manager, emit, start, pages, requests, logs, broadcasts, settle, reducer, context };
}

function restoreFixture(canonical = false, includeOld = true) {
  const f = recoveryFixture(canonical, includeOld);
  f.manager.notificationContext = f.context;
  // Execute the injected lifecycle call with the native converter and Fh.
  const hook = inputs[0].result.text.match(/azraelReconcileDeferredRestoration\(e,e\.notificationContext,vg,[\w$]+\(\$e\.thread\.id\),\$e\.thread\.id\);/)[0];
  f.restore = xm.runInNewContext(`(function(e,$e){return ${hook}})`, { ...waitHelpers, ...reducerBindings }).bind(null, f.manager, { thread: { id: "thread" } });
  return f;
}

for (const canonical of [false, true]) {
  test(`new turn started recovers lost defer and wait notices in ${canonical ? "canonical" : "legacy"} history`, async () => {
    const f = recoveryFixture(canonical);
    f.pages.push({ response: { data: [
      { id: "new-turn", status: "inProgress", durationMs: 999999 },
      { id: "old-turn-prefix", status: "deferred", durationMs: 1, rootResumeWait: reservation({ reservationId: "unrelated" }) },
      { id: "old-turn", status: "deferred", durationMs: 560903, startedAt: 12,
        rootResumeWait: reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 }) },
    ], nextCursor: null } });
    f.start();
    await f.settle();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].id, "thread");
    assert.deepEqual(f.requests[0].options, { cursor: null, limit: 100, itemsView: "notLoaded", sortDirection: "desc" });
    assert.equal(f.old.status, "deferred");
    assert.equal(f.old.durationMs, 560903);
    assert.equal(f.old.rootResumeWait.state, "resumed");
    assert.equal(f.old.finalAssistantStartedAtMs, null);
    assert.equal(f.fresh.status, "inProgress");
    assert.equal(f.fresh.durationMs, null);
    assert.equal(f.fresh.rootResumeWait, undefined);
    for (let i = 0; i < 10; i++) f.manager.broadcastConversationSnapshot("thread");
    assert.equal(f.requests.length, 1);
  });
}

test("new turn started scans only with an older loaded active suspect and coalesces restoration", async () => {
  for (const canonical of [false, true]) {
    for (const includeOld of [false, true]) {
      const f = recoveryFixture(canonical, includeOld);
      f.old.status = "completed";
      f.start();
      await f.settle();
      assert.equal(f.requests.length, 0);
      assert.equal(f.fresh.status, "inProgress");
    }
  }
  const f = restoreFixture();
  let resolve;
  f.manager.listThreadTurns = (id, options) => { f.requests.push({ id, options }); return new Promise(r => { resolve = r; }); };
  const restoration = f.restore();
  f.start();
  assert.equal(waitHelpers.azraelDeferredJournals.get(f.manager).restorations.get("thread"), restoration);
  await Promise.resolve();
  assert.equal(f.requests.length, 1);
  resolve({ response: { data: [{ id: "old-turn", status: "deferred", durationMs: 8000,
    rootResumeWait: reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 }) }], nextCursor: null } });
  await restoration;
  assert.equal(f.requests.length, 1);
  assert.equal(f.old.status, "deferred");
  assert.equal(f.fresh.status, "inProgress");
  assert.equal(f.fresh.rootResumeWait, undefined);
});

test("new turn started reconciles restored waiting or unmeasured deferred origins without reopening ended clocks", async () => {
  for (const state of ["waiting", "claimed", "resumed"]) {
    const f = recoveryFixture();
    Object.assign(f.old, { status: "deferred", durationMs: state === "resumed" ? null : 8000,
      rootResumeWait: reservation({ state, revision: state === "waiting" ? 1 : 2,
        waitEndedAtMs: state === "waiting" ? null : 66000 }), finalAssistantStartedAtMs: null });
    f.pages.push({ response: { data: [{ id: "old-turn", status: "deferred", durationMs: 8000,
      rootResumeWait: reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 }) }], nextCursor: null } });
    f.start();
    await f.settle();
    assert.equal(f.requests.length, 1);
    assert.equal(f.old.status, "deferred");
    assert.equal(f.old.durationMs, 8000);
    assert.equal(f.old.rootResumeWait.state, "resumed");
    assert.equal(f.old.rootResumeWait.waitEndedAtMs, 66000);
    assert.equal(f.fresh.status, "inProgress");
    assert.equal(f.fresh.rootResumeWait, undefined);
    f.start();
    await f.settle();
    assert.equal(f.requests.length, 1);
  }
  for (const status of ["deferred", "completed", "interrupted", "failed"]) {
    const f = recoveryFixture();
    Object.assign(f.old, { status, durationMs: 8000,
      rootResumeWait: reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 }) });
    f.start();
    await f.settle();
    assert.equal(f.requests.length, 0);
    assert.equal(f.old.status, status);
    assert.equal(f.old.durationMs, 8000);
  }
});

test("new turn retains one trailing refresh when an older query returns stale waiting metadata", async () => {
  for (const fullScan of [false, true]) {
    const f = restoreFixture();
    let resolve;
    f.manager.listThreadTurns = (id, options) => {
      f.requests.push({ id, options });
      if (f.requests.length === 1) return new Promise(r => { resolve = r; });
      return Promise.resolve({ response: { data: [{ id: "old-turn", status: "deferred", durationMs: 8000,
        rootResumeWait: reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 }) }], nextCursor: null } });
    };
    if (fullScan) { f.restore(); await Promise.resolve(); } else f.emit(reservation());
    f.start();
    f.start();
    assert.equal(f.requests.length, 1);
    resolve({ response: { data: [{ id: "old-turn", status: "deferred", durationMs: 8000,
      rootResumeWait: reservation() }], nextCursor: null } });
    await f.settle();
    assert.equal(f.requests.length, 2);
    assert.equal(f.old.rootResumeWait.state, "resumed");
    assert.equal(f.old.rootResumeWait.waitEndedAtMs, 66000);
    assert.equal(f.old.durationMs, 8000);
    assert.equal(f.fresh.rootResumeWait, undefined);
    f.start();
    await f.settle();
    assert.equal(f.requests.length, 2);
  }
});

for (const canonical of [false, true]) {
  test(`fresh manager restores ended wait before ${canonical ? "canonical" : "legacy"} origin hydration without notification replay`, async () => {
    for (const state of ["waiting", "cancelled", "resumed"]) {
      const f = restoreFixture(canonical, false);
      const wait = reservation({ state, revision: 3, waitEndedAtMs: state === "waiting" ? null : 66000 });
      f.pages.push({ response: { data: [{ id: "new-turn", status: "inProgress" },
        { id: "old-turn", status: "deferred", durationMs: 8000, startedAt: 12, rootResumeWait: wait }], nextCursor: null } });
      await f.restore();
      assert.equal(f.requests.length, 1);
      assert.equal(f.fresh.status, "inProgress");
      assert.equal(f.fresh.rootResumeWait, undefined);
      assert.equal(waitHelpers.azraelDeferredJournals.get(f.manager).records.size, 1);
      f.loadOld();
      f.manager.broadcastConversationSnapshot("thread");
      assert.equal(f.old.status, "deferred");
      assert.equal(f.old.durationMs, 8000);
      assert.equal(f.old.rootResumeWait.state, state);
      assert.equal(f.old.rootResumeWait.waitEndedAtMs, wait.waitEndedAtMs);
      assert.equal(f.requests.length, 1);
    }
  });
}

test("restoration freezes authoritative active origin boundaries without inventing duration or completion", async () => {
  for (const state of ["waiting", "cancelled", "resumed"]) {
    const f = restoreFixture();
    const wait = reservation({ state, revision: 3, waitEndedAtMs: state === "waiting" ? null : 66000 });
    f.pages.push({ response: { data: [{ id: "old-turn", status: "inProgress", durationMs: 999999, rootResumeWait: wait }], nextCursor: null } });
    await f.restore();
    assert.equal(f.old.status, "deferred");
    assert.equal(f.old.durationMs, null);
    assert.equal(f.old.finalAssistantStartedAtMs, null);
    assert.equal(f.old.completedAt, undefined);
    assert.equal(f.old.rootResumeWait.state, state);
    for (let i = 0; i < 10; i++) f.manager.broadcastConversationSnapshot("thread");
    assert.equal(f.requests.length, 1);
  }
});

test("restoration coalesces in flight, bounds cursor loops and handles query errors without polling", async () => {
  const f = restoreFixture();
  let resolve;
  f.manager.listThreadTurns = (id, options) => { f.requests.push({ id, options }); return new Promise(r => { resolve = r; }); };
  const first = f.restore(), duplicate = f.restore();
  assert.equal(first, duplicate);
  await Promise.resolve();
  f.emit(reservation());
  assert.equal(f.requests.length, 1);
  resolve({ response: { data: [], nextCursor: "loop" } });
  await first;
  f.manager.listThreadTurns = async (id, options) => { f.requests.push({ id, options }); const page = f.pages.shift(); if (page instanceof Error) throw page; return page; };
  f.pages.push(new Error("offline"));
  await f.restore();
  assert.equal(f.old.status, "deferred");
  assert.ok(f.logs.some(log => log.safe.outcome === "restoration_query_failed"));
  f.pages.push(...[1, 2].map(() => ({ response: { data: [{ id: "unrelated" }], nextCursor: "loop" } })));
  await f.restore();
  assert.equal(f.requests.length, 4);
  for (let i = 0; i < 10; i++) f.manager.broadcastConversationSnapshot("thread");
  assert.equal(f.requests.length, 4);
  assert.equal(waitHelpers.azraelDeferredJournals.get(f.manager).restorations.size, 0);
  const bounded = restoreFixture();
  bounded.manager.listThreadTurns = async (id, options) => {
    bounded.requests.push({ id, options });
    return { response: { data: [{ id: "unrelated" }], nextCursor: `page-${bounded.requests.length}` } };
  };
  await bounded.restore();
  assert.equal(bounded.requests.length, 100);
  assert.ok(bounded.logs.some(log => log.safe.outcome === "restoration_page_limit"));
});

test("restoration preserves terminal timing and reservation/revision guards through immutable updates", async () => {
  for (const status of ["completed", "interrupted", "failed"]) {
    const f = restoreFixture();
    Object.assign(f.old, { status, durationMs: 9000, completedAt: 21, finalAssistantStartedAtMs: 21000, rootResumeWait: reservation() });
    let updates = 0;
    f.context.updateTurnState = (id, turnId, update) => {
      updates++;
      f.conversation.turns = f.conversation.turns.map(turn => { if (turn.turnId !== turnId) return turn; const draft = { ...turn }; update(draft); return draft; });
    };
    f.pages.push({ response: { data: [{ id: "old-turn", status: "deferred", durationMs: 8000,
      rootResumeWait: reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 }) }], nextCursor: null } });
    await f.restore();
    const origin = nativeLookup(f.conversation, turn => turn.turnId === "old-turn");
    assert.equal(updates, 1);
    assert.equal(origin.status, status);
    assert.equal(origin.durationMs, 9000);
    assert.equal(origin.completedAt, 21);
    assert.equal(origin.finalAssistantStartedAtMs, 21000);
    assert.equal(origin.rootResumeWait.state, "resumed");
    assert.equal(f.fresh.rootResumeWait, undefined);
  }
  const f = restoreFixture();
  Object.assign(f.old, { status: "deferred", durationMs: 8000, rootResumeWait: reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 }) });
  for (const wait of [reservation(), reservation({ reservationId: "wrong", revision: 99 })]) {
    f.pages.push({ response: { data: [{ id: "old-turn", status: "deferred", durationMs: 77777, rootResumeWait: wait }], nextCursor: null } });
    await f.restore();
    assert.equal(f.old.rootResumeWait.state, "resumed");
    assert.equal(f.old.rootResumeWait.revision, 3);
    assert.equal(f.old.durationMs, 8000);
  }
});

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
    const hydrate = xm.runInNewContext(`(${functionNamed(inputs[0].result.text, "rxn")})`, {
      ...waitHelpers, ixn: x => x, oxn: x => x == null ? null : x * 1000, gt: () => ({}), Ge: () => [],
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
  const hydrate = xm.runInNewContext(`(${functionNamed(inputs[0].result.text, "rxn")})`, {
    ...waitHelpers, ixn: x => x, oxn: x => x == null ? null : x * 1000, gt: () => ({}), Ge: () => [],
  });
  const wait = reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 });
  const turn = hydrate({ threadId: "thread", turns: [{ id: "old-turn", items: [],
    status: "inProgress", startedAt: 12, completedAt: null, durationMs: 777777, rootResumeWait: wait }], permissions: {} })[0];
  assert.equal(turn.status, "deferred");
  assert.equal(turn.durationMs, null);
  const merge = xm.runInNewContext(`(${functionNamed(inputs[0].result.text, "Lle")})`, {
    ...waitHelpers, Vle: { default: () => true }, sg: () => null,
    zle: (existing, incoming) => incoming.params, rg: (existing, incoming) => incoming,
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
    if (inject === patch.injectDeferredHostNotification || inject === patch.injectDeferredRendererNotification) {
      assert.deepEqual(inject(result.text), { text: result.text, count: 0 });
      assert.throws(() => inject(result.text.replace('"turn/rootResumeWait/updated":!0,', '')), /anchor must occur exactly once/);
    } else assert.throws(() => inject(result.text), /anchor must occur exactly once/);
    assert.throws(() => inject("anchor missing"), /anchor must occur exactly once/);
    assert.notEqual(source, result.text);
  }
});

test("renderer ingress admits both deferred methods before the native reducer", () => {
  const input = inputs.find(input => input.file.endsWith(path.basename(patch.DEFERRED_NOTIFICATION_ASSET)));
  const tableSource = source => {
    const ast = sourceAst(source);
    let table;
    function visit(node) {
      if (ts.isBinaryExpression(node) && node.left.getText(ast) === "xTt" &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isObjectLiteralExpression(node.right)) table = node.right.getText(ast);
      if (table == null) ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(table);
    return table;
  };
  const admission = source => xm.runInNewContext("const xTt=" + tableSource(source) + ";" +
    functionNamed(source, "vTt") + functionNamed(source, "yTt") + ";yTt");
  const before = admission(input.source), after = admission(input.result.text);
  const presentation = inputs[1].source;
  assert.ok(/if\(!Mwe\(e\.method\)\)return/.test(presentation));
  assert.ok(presentation.includes("MJt as Mwe"));
  assert.ok(input.source.includes("yTt as MJt"));
  for (const method of ["turn/deferred", "turn/rootResumeWait/updated"]) {
    assert.equal(before(method), false);
    assert.equal(after(method), true);
  }
  assert.equal(after("turn/completed"), true);
  assert.equal(after("unknown/notification"), false);
  assert.equal(after("thread/project/updated"), before("thread/project/updated"));
});

test("deferred updates the current turn without terminal side effects and drains before replay", () => {
  const reducer = xm.runInNewContext(`(${functionContaining(inputs[0].result.text, "case`turn/deferred`:")})`, { ...reducerBindings, ...waitHelpers });
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
  assert.equal(reducerBindings._e("thread-1"), undefined);
  const handler = functionContaining(inputs[0].result.text, "case`turn/deferred`:");
  assert.equal(handler.split(`l=${nativeConverter}(s);`).length, 4); // native completion + two added notifications
  assert.ok(!handler.includes("l=_e(s);"));
  const changed = inputs[0].source.replace(`let{threadId:s,turn:c}=t.params,l=${nativeConverter}(s);`, "let{threadId:s,turn:c}=t.params,l=s;");
  assert.throws(() => patch.injectDeferredTurn(changed), /native conversation converter anchor/);
});

test("presentation projects deferred duration and a frozen waiting divider", () => {
  const source = inputs[1].result.text;
  const status = xm.runInNewContext(`(${functionNamed(source, "Qit")})`);
  const duration = xm.runInNewContext(`(${functionNamed(source, "fyt")})`);
  const divider = xm.runInNewContext(`(${functionNamed(source, "Cyt")})`, waitHelpers);
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
  const hook = xm.runInNewContext(`(${functionNamed(inputs[1].result.text, "Vzi")})`, {
    Uzi: { c: () => slots }, le: () => ({ locale: "ko-KR" }),
    Wzi: { useState: init => { state ??= init(); return [state, value => { state = value; }]; } },
    Hzi: () => now, Date: { now: () => now },
    pMn: (fn, delay) => { callback = fn; interval = delay; }, bCi: ms => `${Math.floor(ms / 1000)}초`,
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
  const divider = xm.runInNewContext(`(${functionNamed(inputs[1].result.text, "Cyt")})`, waitHelpers);
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
  const reducer = xm.runInNewContext(`(${functionContaining(inputs[0].result.text, "case`turn/deferred`:")})`, { ...reducerBindings, ...waitHelpers });
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
  const hydrate = xm.runInNewContext(`(${functionNamed(inputs[0].result.text, "rxn")})`, {
    ...waitHelpers, ixn: x => x, oxn: x => x == null ? null : x * 1000, gt: () => ({}), Ge: () => [],
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
  const merge = xm.runInNewContext(`(${functionNamed(inputs[0].result.text, "Lle")})`, {
    ...waitHelpers, Vle: { default: () => true }, sg: () => null,
    zle: (existing, incoming) => incoming.params, rg: (existing, incoming) => incoming,
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
  const context = { ...waitHelpers, Vle: { default: () => true }, sg: () => null,
    zle: (existing, incoming) => incoming.params, rg: (existing, incoming) => incoming };
  const merge = xm.runInNewContext(`(${functionNamed(inputs[0].result.text, "Lle")})`, context);
  const original = xm.runInNewContext(`(${functionNamed(inputs[0].source, "Lle")})`, context);
  const frozen = { turnId: "old-turn", status: "deferred", items: [], params: {},
    turnStartedAtMs: 12000, durationMs: 8000, rootResumeWait: reservation() };
  const stale = { ...frozen, status: "inProgress", durationMs: 99000, rootResumeWait: null };
  // This is the race that used to reactivate a non-paginated turn after deferral.
  assert.equal(original(frozen, stale, { isResumeSnapshot: true }).status, "inProgress");
  const divider = xm.runInNewContext(`(${functionNamed(inputs[1].result.text, "Cyt")})`, waitHelpers);
  const end = xm.runInNewContext(`(${functionNamed(inputs[1].result.text, "fyt")})`);
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
  const render = xm.runInNewContext(`(${functionNamed(source, "Bzi")})`, {
    Uzi: { c: () => slots }, E7: { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    zzi: "clock-label", s6: "chat-padding", wi: (...values) => values.filter(Boolean).join(" "),
  });
  const waiting = waitHelpers.azraelRootResumeWaitItem(reservation());
  const result = render(waiting), container = result.props.children;
  assert.match(container.props.className, /text-size-chat text-secondary/);
  assert.equal(container.props.children[1].props.className, "w-full border-t border-default");
  assert.equal(container.props.children[0].props.rootResumeWait, waiting.rootResumeWait);
  const processing = { ...waiting, rootResumeWait: reservation({ revision: 2, state: "claimed", waitEndedAtMs: 32000 }) };
  assert.equal(render(processing).props.children.props.children[0].props.rootResumeWait.state, "claimed");
});

test("historical rows rematerialize when only deferred wait details change", () => {
  const input = inputs.find(input => input.file.endsWith(path.basename(patch.DEFERRED_THREAD_ASSET)));
  const sourceModule = fs.readFileSync(path.join(root, patch.DEFERRED_NOTIFICATION_ASSET), "utf8");
  assert.ok(input.source.includes("VSt as kt"));
  assert.ok(sourceModule.includes("fD as VSt"));
  const detailsSelector = sourceModule.indexOf("fD=_c(");
  assert.ok(detailsSelector >= 0);
  assert.match(sourceModule.slice(detailsSelector, detailsSelector + 190), /srn.*\.at\(e\.entityKey\)/);
  for (const [source, corrected] of [[input.source, false], [input.result.text, true]]) {
    const nativeRow = functionNamed(source, "eh");
    const start = nativeRow.indexOf("ue=C(Mt,le)"), end = nativeRow.indexOf("let he=me", start);
    assert.ok(start >= 0 && end > start);
    const slots = Array(corrected ? 103 : 102).fill(Symbol.for("react.memo_cache_sentinel"));
    const ids = [], subscriptions = new Set(), manager = {}, entry = {}, key = "turn:origin";
    let details = { turnId: "origin", status: "deferred", durationMs: 8000, rootResumeWait: reservation() }, reads = 0;
    const context = { slots, manager, entry, key, Mt: "items", Et: "id", Se: "status", kt: "details", Im: "filter", Rm: "voice",
      C(selector) { subscriptions.add(selector); return selector === "items" ? ids : selector === "id" ? details.turnId : selector === "status" ? details.status : selector === "details" ? details : null; },
      Tn() { reads++; return { ...details, items: ids }; }
    };
    const render = xm.runInNewContext("(function(){const t=slots,s=manager,te=entry,le=key,se=false,p='thread';let " + nativeRow.slice(start, end) + "return me;})", context);
    assert.equal(render().rootResumeWait.state, "waiting");
    details = { ...details, rootResumeWait: reservation({ revision: 2, state: "claimed", waitEndedAtMs: 32000 }) };
    const processing = render();
    assert.equal(processing.rootResumeWait.state, corrected ? "claimed" : "waiting");
    details = { ...details, rootResumeWait: reservation({ revision: 3, state: "resumed", waitEndedAtMs: 32000 }) };
    const resumed = render();
    assert.equal(resumed.rootResumeWait.state, corrected ? "resumed" : "waiting");
    assert.equal(resumed.durationMs, 8000);
    assert.equal(reads, corrected ? 3 : 1);
    assert.equal(subscriptions.has("details"), corrected);
    assert.equal(render(), resumed, "Unchanged details retain the native materialization cache");
  }
});

test("active activity projection cannot resurrect a deferred source turn or discard its waiting divider", () => {
  const presentation = inputs[1].result.text;
  const context = {
    ...waitHelpers, D_t: () => ({ replyItemIds: new Set() }), eot: x => x,
    OMe: () => false, Cl: () => false, $S: () => null, IDe: () => -1,
    Pyt: { default: (items, predicate) => items.findLastIndex(predicate) },
  };
  const declarations = ["Qit", "Cyt", "azraelOriginalWorkDivider", "wyt", "O_t", "Tyt", "Eyt", "Oyt", "Dyt", "fyt", "z_t", "H_t", "k_t", "nC"]
    .map(name => functionNamed(presentation, name)).join("\n");
  const project = xm.runInNewContext(`${declarations}\nnC`, context);
  const env = { ...waitHelpers, xp: () => [], up: () => false, kn: x => x,
    Ns: (turn, requests, options) => project(turn, requests, { ...options, includeAeonProjection: false, includeTurnDiff: false }) };
  const patched = xm.runInNewContext(`(${functionNamed(inputs[4].result.text, "fp")})`, env);
  const original = xm.runInNewContext(`(${functionNamed(inputs[4].source, "fp")})`, env);
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
  const divider = xm.runInNewContext(`(${functionNamed(inputs[1].result.text, "O_t")})`);
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
  const declarations = ["Cyt", "azraelOriginalWorkDivider", "wyt", "O_t", "Tyt", "Eyt", "Oyt", "Dyt"]
    .map(name => functionNamed(source, name)).join("\n");
  const divide = xm.runInNewContext(`${declarations}\nCyt`, waitHelpers);
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
  const render = xm.runInNewContext(`(${functionNamed(inputs[6].result.text, "C")})`, {
    T: { c: () => slots }, E: { jsx: (type, props) => ({ type, props }) }, p: "clock-label",
  });
  const item = waitHelpers.azraelRootResumeWaitItem(reservation());
  assert.equal(render({ workedForItem: item }).props.rootResumeWait.state, "waiting");
  const changed = { ...item, rootResumeWait: reservation({ revision: 2, state: "claimed", waitEndedAtMs: 32000 }) };
  assert.equal(render({ workedForItem: changed }).props.rootResumeWait.state, "claimed");
});
