"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require(path.resolve("extensions/azrael-ex/node_modules/typescript/lib/typescript.js"));
const {
  PAGINATED_HISTORY_ASSET: asset,
  PAGINATED_HISTORY_MARKER: marker,
  injectPaginatedHistory,
} = require("./inject-paginated-history.cjs");
const pristine = fs.readFileSync(path.resolve(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve("artifacts/upstream-ui/26.1007.21434"), asset), "utf8");
const transformed = injectPaginatedHistory(pristine, asset);

function declarations(source) {
  const ast = ts.createSourceFile(asset, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, "pinned bundle parses");
  const found = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) found.set(node.name.text, node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);

  return found;
}
const originalDeclarations = declarations(pristine);
const patchedDeclarations = declarations(transformed.text);
const originalDeclaration = originalDeclarations.get("CDn");
const patchedDeclaration = patchedDeclarations.get("CDn");

function harness(declaration = patchedDeclaration) {
  const flags = [];
  const context = { Te: config => config, On(config, name) { flags.push(name); return config?.[name] === true; } };
  vm.createContext(context);
  vm.runInContext(declaration, context);
  return { create: context.CDn, flags };
}
test("actual native persistent creation forces paginated for legacy, default, and paginated callers", () => {
  for (const mode of ["legacy", undefined, "paginated"]) {
    for (const enabled of [false, true]) {
      for (const ephemeral of [undefined, false]) {
        const h = harness();
        const input = Object.freeze({ conversationId: "new", historyMode: "legacy", ephemeral, config: Object.freeze({ custom: "kept" }) });
        const before = structuredClone(input);
        const result = h.create(input, { approvalPolicy: "on-request" }, mode, { defaultPaginatedHistory: enabled });
        assert.equal(result.historyMode, "paginated");
        assert.equal(result.conversationId, "new");
        assert.equal(result.config, input.config);
        assert.notEqual(result, input);
        assert.deepEqual(input, before);
        assert.deepEqual(h.flags, [], "creation no longer depends on the rollout flag");
      }
    }
  }
  const original = harness(originalDeclaration);
  const input = { historyMode: "legacy" };
  assert.equal(original.create(input, { approvalPolicy: "on-request" }, "legacy", { defaultPaginatedHistory: false }), input);
});

test("actual native ephemeral inputs preserve their history mode and identity", () => {
  for (const historyMode of [undefined, "legacy", "paginated"]) {
    for (const callerMode of [undefined, "legacy", "paginated"]) {
      const input = Object.freeze({ ephemeral: true, historyMode, config: Object.freeze({ custom: "kept" }) });
      const before = structuredClone(input);
      assert.equal(harness().create(input, { approvalPolicy: "on-request" }, callerMode, { defaultPaginatedHistory: true }), input);
      assert.deepEqual(input, before);
    }
  }
});

test("actual native permission-tool config remains identical to upstream for persistent and ephemeral creation", () => {
  for (const policy of [undefined, { approvalPolicy: { granular: {} } }, { approvalPolicy: "on-request" }]) {
    for (const ephemeral of [false, true]) {
      const input = Object.freeze({ ephemeral, historyMode: "legacy", config: Object.freeze({ custom: "kept", "features.request_permissions_tool": false }) });
      const before = structuredClone(input);
      const upstream = harness(originalDeclaration).create(input, policy, "legacy", {});
      const result = harness().create(input, policy, "legacy", {});
      assert.deepEqual(JSON.parse(JSON.stringify(result.config)), JSON.parse(JSON.stringify(upstream.config)));
      assert.equal(result.historyMode, ephemeral ? "legacy" : "paginated");
      assert.deepEqual(input, before);
    }
  }
});

test("injector owns one fail-closed, idempotent transformation of both pinned anchors", () => {
  assert.equal(transformed.count, 1);
  assert.deepEqual(injectPaginatedHistory(transformed.text, asset), { text: transformed.text, count: 0 });
  assert.deepEqual(injectPaginatedHistory(pristine, "other.js"), { text: pristine, count: 0 });
  assert.throws(() => injectPaginatedHistory(transformed.text + marker, asset), /Duplicate/);
  assert.throws(() => injectPaginatedHistory(transformed.text.replace(marker, "/*azrael-paginated-history-v1*/"), asset), /Previous/);
  for (const [name, original] of [["CDn", originalDeclaration], ["yOn", originalDeclarations.get("yOn")]]) {
    assert.throws(() => injectPaginatedHistory(pristine.replace(original, ""), asset), /anchor/);
    assert.throws(() => injectPaginatedHistory(pristine + original, asset), /anchor/);
    assert.throws(() => injectPaginatedHistory(transformed.text.replace(patchedDeclarations.get(name), original), asset), /Damaged/);
  }
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const plain = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));

// Execute pinned native orchestration/paging; adapters below supply manager,
// workspace and mapping boundaries without implementing another history loader.
function resumeHarness({ timeline = false, source = patchedDeclarations, pageGate } = {}) {
  const resume = deferred(), reachedResume = deferred(), requests = [], mapped = [], published = [];
  const permissions = { sandboxPolicy: { type: "dangerFullAccess" }, runtimeWorkspaceRoots: ["/repo"] };
  const thread = { id: "thread", cwd: "/repo", historyMode: "paginated", status: { type: "idle" }, turns: [] };
  const state = { id: "thread", cwd: "/repo", historyMode: "paginated", resumeState: "needs_resume", workspaceKind: "project", updatedAt: 0, turnHistory: [], shellEnvironmentPolicy: {} };
  let current = true;
  const manager = {
    isCloudHost: false, logger: { info() {}, warning() {} },
    getConversation: () => state, getConversationOrThrow: () => state,
    getHostId: () => "local", getWindowActivity: () => ({}), getStreamRole: () => null,
    useTailHydration: () => true, supportsPaginatedThreadHistory: () => true,
    supportsThreadTimeline: () => timeline, getConversationTurnItemLimit: () => 1000,
    getThreadWorkspaceState: () => ({ applied: { cwd: "/repo", runtimeWorkspaceRoots: ["/repo"] } }),
    updateConversationState: (_, update) => update(state),
    readThread: async (_, options) => { requests.push({ method: "readThread", params: options }); return { thread }; },
    beginResumeNotificationBuffer() {}, releaseResumeNotificationBuffer() {},
    addThreadUnarchivedListener: () => () => {}, ensureRecentConversationId() {},
    setConversationStreamRole() {}, acceptConversationHistory() {}, broadcastConversationSnapshot() {},
    async sendRequest(method, params) {
      requests.push({ method, params });
      if (method === "thread/resume") { reachedResume.resolve(); return resume.promise; }
      if (method === "thread/goal/get") return { goal: null };
      if (pageGate) await pageGate.promise;
      if (method === "thread/timeline/list") return {
        data: [{ type: "turnStarted", turnId: "new" }, { type: "item", turnId: "new", item: { id: "new-item" } }], nextCursor: null,
      };
      if (method === "thread/turns/list") return {
        data: (timeline ? ["new"] : ["new", "old"]).map(id => ({ id, status: "completed" })), nextCursor: "older-turns",
      };
      if (method === "thread/items/list") return {
        data: [{ turnId: params.turnId, item: { id: `${params.turnId}-item` }, completedAtMs: 1 }], nextCursor: null,
      };
      throw Error(`Unexpected request ${method}`);
    },
  };
  const context = {
    Error, Ce: "durable", JZ: 1000, B: value => value, SQ: () => false, w1: { default: Object.is },
    $Z: conversation => conversation.turnHistory, eQ: conversation => conversation.turnHistory, iQ: () => undefined,
    wOn: async () => [], SOn: () => "/repo", De: () => permissions,
    b1: roots => roots, y1: sandbox => sandbox, s1: () => null,
    dOn: (_, roots) => roots, pDn: () => null, v1: () => permissions,
    iwn: { parse: value => value }, r$: () => false, b$: () => ({}),
    v$: () => ({ createdAt: 0, updatedAt: 1, recencyAt: 1 }),
    y$: () => 1, C$: () => ({ threadStartKind: null }), C1: () => "test", TOn: () => "test",
    _1: ({ requestedCwd }) => requestedCwd,
    og: (_, incoming) => incoming, DQ() {}, q$() {}, gTn: () => ({}), _Tn: () => ({}),
    mg(conversation, turns) { conversation.turnHistory = turns; published.push(plain(turns)); },
    gOn: error => error.message === "writer conflict", Ut: error => error.message,
  };
  vm.createContext(context);
  for (const name of ["AQ", "jQ", "Jvn", "rwn", "nwn", "_On", "yOn"]) {
    assert.ok(source.get(name), `pinned ${name} declaration exists`);
    vm.runInContext(source.get(name), context);
  }
  const product = {
    workspace: { projectlessPathSentinel: "projectless", getCwd: ({ cwd }) => cwd, getSandboxPolicy: ({ sandboxPolicy }) => sandboxPolicy },
    prepare: async () => ({
      start: { cwd: "/repo", runtimeWorkspaceRoots: ["/repo"] }, canReuseRunningThread: true,
      requestOptions: {}, backgroundRequestOptions: {}, completeRequest: value => value,
      getResult: async () => ({ model: "model" }),
    }),
    history: { mapResumeResponse: () => [] },
  };
  const result = context.yOn({
    manager, hostMode: "local", workspace: { load: async () => false }, product,
    params: { conversationId: "thread", workspaceRoots: ["/repo"], permissions, showThreadGoalResumeConfirmation: true },
    historyPolicy: {
      turnMergePolicy: "test",
      mapThreadTurns(input) {
        mapped.push(plain(input));
        return input.turns.map(turn => ({ turnId: turn.id, items: turn.items, status: "completed", params: {} }));
      },
    },
    canAcquireOwnership: () => true, isCurrentResumeAttempt: () => current,
    setHydrationCleanup() {}, schedule() { throw Error("Unexpected resume retry"); },
  });
  // Attach immediately so intentional rejection cannot become unhandled.
  result.catch(() => {});
  return { context, manager, state, thread, result, resume, reachedResume, requests, mapped, published, cancel() { current = false; } };
}

test("native local resume keeps metadata early and hydrates current cursor pages once after success", async () => {
  const h = resumeHarness();
  await h.reachedResume.promise;
  await settle();
  assert.deepEqual(h.requests.map(request => request.method), ["readThread", "thread/resume"]);
  assert.equal(h.requests[0].params.includeTurns, false);
  assert.equal(h.requests[1].params.excludeTurns, true);
  assert.equal(h.mapped.length, 0);
  assert.equal(h.published.length, 0);
  h.resume.resolve({ thread: h.thread, turnsBackwardsCursor: "current-turns", itemsBackwardsCursor: "current-items" });
  assert.equal((await h.result).status, "ready");
  const pages = h.requests.filter(request => request.method.endsWith("/list"));
  assert.deepEqual(pages.map(request => [request.method, request.params.cursor]), [
    ["thread/turns/list", "current-turns"], ["thread/items/list", "current-items"], ["thread/items/list", "current-items"],
  ]);
  assert.equal(h.mapped.length, 1);
  assert.deepEqual(h.mapped[0].turns.map(turn => [turn.id, turn.items.map(item => item.id)]), [["old", ["old-item"]], ["new", ["new-item"]]]);
  assert.deepEqual(h.mapped[0].completedItemIdsByTurnId, { new: { "new-item": true }, old: { "old-item": true } });
  assert.equal(h.state.turnsPagination.olderCursor, "older-turns");
});

test("native timeline resume performs its single history pass only after resume", async () => {
  const h = resumeHarness({ timeline: true });
  await h.reachedResume.promise;
  await settle();
  assert.deepEqual(h.requests.map(request => request.method), ["readThread", "thread/resume"]);
  h.resume.resolve({ thread: h.thread, turnsBackwardsCursor: "current-turns", itemsBackwardsCursor: "current-items" });
  assert.equal((await h.result).status, "ready");
  assert.deepEqual(h.requests.filter(request => request.method.endsWith("/list")).map(request => request.method), ["thread/timeline/list", "thread/turns/list"]);
  assert.deepEqual(h.mapped[0].turns.map(turn => [turn.id, turn.items.map(item => item.id)]), [["new", ["new-item"]]]);
});

test("native canceled resume and canceled in-flight page do not map or publish stale history", async () => {
  for (const cancelDuringPage of [false, true]) {
    const gate = deferred();
    const h = resumeHarness({ pageGate: cancelDuringPage ? gate : undefined });
    await h.reachedResume.promise;
    if (!cancelDuringPage) h.cancel();
    h.resume.resolve({ thread: h.thread, turnsBackwardsCursor: "current-turns", itemsBackwardsCursor: "current-items" });
    if (cancelDuringPage) {
      await settle();
      assert.equal(h.requests.filter(request => request.method === "thread/turns/list").length, 1);
      h.cancel();
      gate.resolve();
    }
    assert.deepEqual(plain(await h.result), { status: "not-ready", reason: "canceled" });
    assert.equal(h.mapped.length, 0);
    assert.equal(h.published.length, 0);
  }
});

test("native writer-conflict resume retains history fallback and rejects the original error", async () => {
  const h = resumeHarness();
  await h.reachedResume.promise;
  const conflict = Error("writer conflict");
  h.resume.reject(conflict);
  await assert.rejects(h.result, error => error === conflict);
  const pages = h.requests.filter(request => request.method.endsWith("/list"));
  assert.deepEqual(pages.map(request => [request.method, request.params.cursor]), [
    ["thread/turns/list", null], ["thread/items/list", null], ["thread/items/list", null],
  ]);
  assert.equal(h.mapped.length, 1);
  assert.equal(h.published.length, 1);
  assert.equal(h.state.resumeState, "needs_resume");
});

test("unchanged native paging enforces its 500-item budget and chronological mapping order", async () => {
  const requests = [];
  const context = { B: value => value };
  vm.createContext(context);
  for (const name of ["AQ", "jQ"]) {
    assert.equal(patchedDeclarations.get(name), originalDeclarations.get(name));
    vm.runInContext(patchedDeclarations.get(name), context);
  }
  const manager = {
    getConversation: () => null,
    async sendRequest(method, params) {
      requests.push({ method, params });
      if (method === "thread/turns/list") return { data: [{ id: "new" }, { id: "old" }], nextCursor: "older-turns" };
      const offset = Number(params.cursor ?? 0);
      return { data: Array.from({ length: params.limit }, (_, index) => ({ id: `item-${599 - offset - index}` })), nextCursor: String(offset + params.limit) };
    },
  };
  // Existing opening-message metadata avoids an unrelated opening-message lookup.
  manager.getConversation = () => ({ turns: ["new", "old"].map(turnId => ({ turnId, params: { input: [] }, itemsPagination: { openingUserMessageId: "opening" } })) });
  context.eQ = conversation => conversation.turns;
  const result = await context.jQ(manager, 1000, "test", "thread", "resume-turns", null, 5, {});
  const itemRequests = requests.filter(request => request.method === "thread/items/list");
  assert.equal(itemRequests.length, 5);
  assert.equal(itemRequests.reduce((sum, request) => sum + request.params.limit, 0), 500);
  assert.deepEqual(itemRequests.map(request => request.params.cursor), [null, "100", "200", "300", "400"]);
  assert.equal(result.response.data[0].items.length, 500);
  assert.equal(result.response.data[0].items[0].id, "item-100");
  assert.equal(result.response.data[0].items.at(-1).id, "item-599");
  assert.equal(result.response.data[1].items.length, 0);
  assert.equal(result.itemsPaginationByTurnId.new.hasLoadedOldest, false);
  assert.equal(result.itemsPaginationByTurnId.new.olderCursor, "500");
});
