"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { injectRecovery } = require("./inject-recovery.cjs");

const projectRoot = path.resolve(__dirname, "..");
const originalBundle = path.join(projectRoot, "artifacts", "deployments", "original-official-26.908.40401", "out", "extension.js");
const toolRoot = path.join(projectRoot, "artifacts", "build", "root-resume-validation", "companion");
const typescriptPath = path.join(toolRoot, "node_modules", "typescript", "lib", "typescript.js");

function owningClass(ts, source, filename) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let owner;
  const visit = node => {
    if (ts.isMethodDeclaration(node) && node.name?.text === "sendProviderRequest") owner = node.parent;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(owner, "pinned bundle must contain the recovery bridge owner");
  return { ast, owner };
}

test("pinned bridge transform executes its owning class and preserves ordinary routing", async () => {
  assert.equal(fs.existsSync(originalBundle), true, `missing pinned original bundle: ${originalBundle}`);
  assert.equal(fs.existsSync(typescriptPath), true, `missing staged TypeScript: ${typescriptPath}`);
  const ts = require(typescriptPath);
  const original = fs.readFileSync(originalBundle, "utf8");
  const transformed = injectRecovery(original, originalBundle, ts);
  assert.equal(transformed.count, 3);
  assert.equal(ts.createSourceFile(originalBundle, transformed.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0);

  const { ast, owner } = owningClass(ts, transformed.text, originalBundle);
  const classText = transformed.text.slice(owner.getStart(ast), owner.end);
  const recovery = require("./azrael-recovery.cjs");
  const disposed = [];
  const logRecords = [];
  const contextValue = {
    storageUri: { scheme: "file" },
    workspaceState: { get(_key, fallback) { return fallback; }, async update() {} },
    subscriptions: [],
  };
  recovery.initialize(contextValue, {
    StatusBarAlignment: { Left: 1 },
    window: {
      createOutputChannel() { return { info(record) { logRecords.push(record); }, dispose() { disposed.push("output"); } }; },
      createStatusBarItem() { return { hide() {}, show() {}, dispose() { disposed.push("status"); } }; },
      async showQuickPick() {}, async showErrorMessage() {},
    },
    commands: { registerCommand() { return { dispose() { disposed.push("command"); } }; } },
  });
  const context = vm.createContext({
    require(specifier) {
      assert.equal(specifier, "./azrael-recovery.cjs");
      return recovery;
    },
    clearTimeout,
    oG: method => method === "turn/start",
    _f: params => params?.threadId,
  });
  const Bridge = new vm.Script(`(${classText})`, { filename: "pinned-bridge-owner.js" }).runInContext(context);
  const bridge = Object.create(Bridge.prototype);
  const delivered = [];
  const deliveryEvents = [];
  bridge.providers = new Map([["client", {
    onResult: message => delivered.push(message),
    onRequestDelivery: event => deliveryEvents.push(event),
  }]]);
  bridge.registerProvider = (name, provider) => {
    bridge.providers.set(name, provider);
    return { dispose() { bridge.providers.delete(name); } };
  };
  bridge.pendingRequests = new Map();
  bridge.pendingTurnStartRequestIds = new Set();
  bridge.pendingPrewarmedThreadStartRequestIds = new Set();
  bridge.prewarmedThreads = { trackThread() {}, stopTrackingThread() {}, publishThreadStarted() {}, clear() {} };
  const nativeCleanup = [];
  const abandonRequest = bridge.abandonRequest.bind(bridge);
  bridge.abandonRequest = (provider, id) => {
    nativeCleanup.push({ type: "abandon", provider, id });
    abandonRequest(provider, id);
  };
  bridge.turnCwds = {
    observeResponse(key, method, response) { nativeCleanup.push({ type: "cwd", key, method, response }); },
    track() {}, clear() {},
  };
  bridge.recordLastOutboundMethod = () => {};
  const sent = [];
  const deliveryCallbacks = new Map();
  let stallRecovery = false;
  let failRecovery = false;
  bridge.isMcpResponseMessage = () => true;
  bridge.sendMessage = (message, deliveryCallback) => {
    sent.push(message);
    if (deliveryCallback) deliveryCallbacks.set(message.id, deliveryCallback);
    const separator = message.id.indexOf(":");
    const provider = message.id.slice(0, separator);
    if (provider.startsWith("azrael-recovery-") && !stallRecovery) {
      queueMicrotask(() => bridge.routeIncomingMessage(failRecovery ?
        { id: message.id, error: { code: -32042, message: "fixture input is too large", data: { limit: 10 } } } :
        { id: message.id, result: { turn: { id: "turn-engine" } } }, false));
    }
    return true;
  };

  const intercepted = bridge.sendProviderRequest("client", "resume-1", "turn/start", { threadId: "thread-1", input: [{ type: "text", text: "new work" }] }, false, true);
  assert.equal(intercepted, undefined);
  for (let attempt = 0; attempt < 20 && delivered.length === 0; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].id, "resume-1");
  assert.ok(delivered[0].result, JSON.stringify(delivered[0]));
  assert.equal(delivered[0].result.turn.id, "turn-engine");
  bridge.sendProviderRequest("client", "steer-1", "turn/steer", {
    threadId: "thread-1", expectedTurnId: "turn-engine", clientUserMessageId: "follow-up",
    input: [{ type: "text", text: "follow-up instruction" }],
  }, false, true);
  for (let attempt = 0; attempt < 20 && !delivered.some(message => message.id === "steer-1"); attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(delivered.find(message => message.id === "steer-1")?.result);
  assert.equal(sent.filter(message => message.method === "turn/steer").length, 1);
  assert.ok(sent.find(message => message.method === "turn/steer").id.startsWith("azrael-recovery-"));
  const ordinary = bridge.sendProviderRequest("client", "list-1", "thread/list", { limit: 1 }, false, true);
  assert.equal(ordinary, undefined);
  assert.equal(sent.some(message => message.method === "thread/list" && message.id === "client:list-1"), true);

  const routed = bridge.routeIncomingMessage({ id: "client:reply-1", result: { ok: true } }, false);
  assert.equal(routed.routeKind, "response");
  assert.equal(delivered.length, 3);
  assert.equal(delivered[2].id, "reply-1");
  assert.equal(delivered[2].result.ok, true);

  failRecovery = true;
  bridge.sendProviderRequest("client", "error-1", "turn/start", { threadId: "thread-1", input: [{ type: "text", text: "oversized fixture" }] }, false, true);
  for (let attempt = 0; attempt < 20 && delivered.length < 4; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(delivered[3].id, "error-1");
  assert.equal(delivered[3].error.code, -32042);
  assert.equal(delivered[3].error.message, "fixture input is too large");
  assert.equal(delivered[3].error.data.limit, 10);

  bridge.failPendingRequests = () => {};
  bridge.requestUserInputAutoResolutionCoordinator = { clearPendingRequests() {} };
  bridge.proc = null;
  bridge.resetIncomingLineState = () => {};
  bridge.internalNotificationHandlers = new Set();
  bridge.ephemeralThreadTimeouts = new Map();
  failRecovery = false;
  stallRecovery = true;
  const sentBeforeStall = sent.length;
  bridge.sendProviderRequest("client", "stalled-1", "turn/start", { threadId: "thread-1", input: [{ type: "text", text: "later work" }] }, false, true);
  for (let attempt = 0; attempt < 20 && sent.length === sentBeforeStall; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(sent.length, sentBeforeStall + 1);
  const stalledMessage = sent.at(-1);
  assert.equal(typeof deliveryCallbacks.get(stalledMessage.id), "function");
  deliveryCallbacks.get(stalledMessage.id)("outcome-unknown");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(deliveryEvents.length, 1);
  assert.equal(deliveryEvents[0].type, "outcome-unknown");
  assert.equal(deliveryEvents[0].delivery.requestId, "stalled-1");
  assert.equal(deliveryEvents[0].delivery.method, "turn/start");
  bridge.teardownProcess();
  contextValue.subscriptions[0].dispose();
  const logsAfterDispose = logRecords.length;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nativeCleanup.filter(entry => entry.type === "abandon").length, 1);
  assert.equal(nativeCleanup.filter(entry => entry.type === "cwd" && entry.method === "turn/start" && entry.response.error?.code === -32001).length, 1);
  assert.equal(logRecords.length, logsAfterDispose);
  assert.deepEqual(disposed.sort(), ["command", "output", "status"]);
});

test("runtime adapter initializes against VS Code APIs and disposes every resource", () => {
  const modulePath = require.resolve("./azrael-recovery.cjs");
  delete require.cache[modulePath];
  const recovery = require(modulePath);
  const disposed = [];
  const status = {
    dispose() { disposed.push("status"); }, hide() {}, show() {},
  };
  const output = {
    info() {}, dispose() { disposed.push("output"); },
  };
  const command = { dispose() { disposed.push("command"); } };
  const workspaceState = { get(_key, fallback) { return fallback; }, async update() {} };
  const context = { storageUri: { scheme: "file" }, workspaceState, globalState: null, subscriptions: [] };
  const vscode = {
    StatusBarAlignment: { Left: 1 },
    window: {
      createOutputChannel(name, options) { assert.equal(name, "Azrael Recovery"); assert.deepEqual(options, { log: true }); return output; },
      createStatusBarItem(alignment, priority) { assert.equal(alignment, 1); assert.equal(priority, 30); return status; },
      async showQuickPick() {}, async showErrorMessage() {},
    },
    commands: {
      registerCommand(name, callback) { assert.equal(name, "azrael.recoveryStatus"); assert.equal(typeof callback, "function"); return command; },
    },
  };

  const disposable = recovery.initialize(context, vscode);
  assert.equal(context.subscriptions.includes(disposable), true);
  disposable.dispose();
  assert.deepEqual(disposed.sort(), ["command", "output", "status"]);

  const secondContext = { ...context, subscriptions: [] };
  const second = recovery.initialize(secondContext, vscode);
  second.dispose();
});

test("Windows path casing aliases share one recovery runtime", { skip: process.platform !== "win32" }, () => {
  const registryKey = Symbol.for("azrael-ex.recovery-runtimes.v1");
  const physical = fs.realpathSync.native(path.join(__dirname, "azrael-recovery.cjs"));
  const alternate = physical[0] === physical[0].toUpperCase() ? physical[0].toLowerCase() + physical.slice(1) : physical[0].toUpperCase() + physical.slice(1);
  delete globalThis[registryKey];
  delete require.cache[require.resolve(physical)];
  const first = require(physical);
  delete require.cache[require.resolve(physical)];
  const aliased = require(alternate);

  assert.equal(aliased, first);
  assert.equal(globalThis[registryKey].size, 1);
  assert.equal(globalThis[registryKey].get(physical.toLowerCase()), first);
});

function recoveryVscodeStub(logRecords, { failingOutput = false } = {}) {
  const disposed = [];
  const vscode = {
    StatusBarAlignment: { Left: 1 },
    window: {
      createOutputChannel() {
        return {
          info(record) {
            if (failingOutput) throw new Error("output sink unavailable");
            logRecords.push(JSON.parse(record));
          },
          dispose() { disposed.push("output"); },
        };
      },
      createStatusBarItem() { return { hide() {}, show() {}, dispose() { disposed.push("status"); } }; },
      async showQuickPick() {},
      async showErrorMessage() {},
    },
    commands: { registerCommand() { return { dispose() { disposed.push("command"); } }; } },
  };
  const context = {
    storageUri: { scheme: "file" },
    workspaceState: { get(_key, fallback) { return fallback; }, async update() {} },
    subscriptions: [],
  };
  return { context, disposed, vscode };
}

function fakeRecoveryHost(delivered, deliveryEvents = []) {
  const host = {
    providers: new Map(),
    pendingTurnStartRequestIds: new Set(),
    turnCwds: { observeResponse() {} },
    abandonRequest() {},
    registerProvider(name, provider) {
      host.providers.set(name, provider);
      return { dispose() { host.providers.delete(name); } };
    },
  };
  host.providers.set("client", {
    onResult: message => delivered.push(message),
    onRequestDelivery: event => deliveryEvents.push(event),
  });
  return host;
}

test("lost start response returns native accepted turn through the original bridge request", async t => {
  const recovery = require("./azrael-recovery.cjs");
  const logRecords = [], delivered = [], deliveryEvents = [], calls = [];
  const { context, vscode } = recoveryVscodeStub(logRecords);
  const disposable = recovery.initialize(context, vscode);
  const host = fakeRecoveryHost(delivered, deliveryEvents);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const acceptedTurn = { id: "accepted-after-lost-ack", status: "completed", items: [
    { type: "userMessage", id: "native-item", clientId: "queued-client-id", content: [] },
  ] };
  const raw = (provider, id, method, params) => {
    calls.push({ method, params });
    if (method === "thread/turns/list") queueMicrotask(() => host.providers.get(provider)?.onResult({
      id, result: { data: [acceptedTurn], nextCursor: null },
    }));
  };
  try {
    recovery.dispatch(host, ["client", "original-queued-request", "turn/start", {
      threadId: "thread-accepted", clientUserMessageId: "queued-client-id",
      input: [{ type: "text", text: "normal new instruction" }],
    }, false, true], raw);
    for (let attempts = 0; attempts < 40 && !calls.length; attempts++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls[0].method, "turn/start");
    t.mock.timers.tick(20000);
    await untilDelivered(delivered, 1);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].id, "original-queued-request");
    assert.equal(delivered[0].result.turn.id, acceptedTurn.id);
    assert.equal(delivered[0].result.turn.status, "completed");
    assert.equal(calls.filter(call => call.method === "turn/start").length, 1);
    assert.equal(calls.filter(call => call.method === "thread/turns/list").length, 1);
    assert.equal(deliveryEvents[0].delivery.requestId, "original-queued-request");
    const matched = logRecords.find(record => record.event === "recovery.send_reconciliation" && record.outcome === "matched");
    assert.equal(matched.turnId, acceptedTurn.id);
    assert.ok(logRecords.some(record => record.event === "recovery.request_result" && record.outcome === "accepted"));
    assert.equal(logRecords.some(record => record.event === "recovery.request_failed"), false);
  } finally {
    disposable.dispose();
    t.mock.timers.reset();
  }
});

async function untilDelivered(delivered, count) {
  for (let attempt = 0; attempt < 40 && delivered.length < count; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

test("runtime identity record reports host configuration without environment secrets", async () => {
  const recovery = require("./azrael-recovery.cjs");
  const sentinel = "azrael-test-env-secret-9f8d7c";
  process.env.AZRAEL_TEST_SENTINEL = sentinel;
  const logRecords = [];
  const { context, vscode } = recoveryVscodeStub(logRecords);
  const disposable = recovery.initialize(context, vscode);
  try {
    const runtime = logRecords.find(record => record.event === "recovery.runtime");
    assert.ok(runtime, "initialize must emit a runtime identity record");
    assert.equal(runtime.diagnosticSchema, 1);
    assert.equal(runtime.hostModule, fs.realpathSync.native(path.join(__dirname, "azrael-recovery.cjs")));
    assert.equal(runtime.nodeVersion, process.version);
    assert.equal(typeof runtime.identitySource, "string");
    assert.equal("env" in runtime, false);
    assert.equal(JSON.stringify(runtime).includes(sentinel), false);
    assert.equal(Number.isSafeInteger(runtime.hostPid), true);
  } finally {
    disposable.dispose();
    delete process.env.AZRAEL_TEST_SENTINEL;
  }
});

test("recovery RPC diagnostics keep payload secrets out of log records", async () => {
  const recovery = require("./azrael-recovery.cjs");
  const secret = "sk-payload-secret-recovery-bridge";
  const logRecords = [];
  const { context, vscode } = recoveryVscodeStub(logRecords);
  const disposable = recovery.initialize(context, vscode);
  const delivered = [];
  const host = fakeRecoveryHost(delivered);
  try {
    let failRpc = true;
    const raw = (provider, id) => {
      queueMicrotask(() => host.providers.get(provider)?.onResult(failRpc ?
        { id, error: { code: -32042, message: `engine rejected credential ${secret}`, data: { secret } } } :
        { id, result: { turn: { id: "turn-secret", leaked: secret } } }));
    };
    recovery.dispatch(host, ["client", "req-error", "turn/start",
      { threadId: "thread-rpc-secret", input: [{ type: "text", text: "ordinary instruction" }] }, false, true], raw);
    await untilDelivered(delivered, 1);
    assert.equal(delivered[0].id, "req-error");
    assert.equal(delivered[0].error.code, -32042);
    assert.equal(delivered[0].error.message.includes(secret), true);

    const rpcResult = logRecords.find(record => record.event === "recovery.rpc_result" && record.requestId);
    assert.ok(rpcResult, "RPC failure must emit a result diagnostic");
    assert.equal(rpcResult.outcome, "rpc_error");
    assert.equal(rpcResult.rpcCode, -32042);
    assert.equal(rpcResult.method, "turn/start");
    assert.equal(rpcResult.threadId, "thread-rpc-secret");
    const failed = logRecords.find(record => record.event === "recovery.request_failed");
    assert.ok(failed, "RPC failure must emit a request_failed diagnostic");
    assert.equal(failed.method, "turn/start");
    assert.equal(failed.requestId, "req-error");
    assert.equal(failed.outcome, "rejected");
    const dispatchRecord = logRecords.find(record => record.event === "recovery.rpc_dispatch");
    assert.deepEqual(dispatchRecord.originalRequestIds, ["req-error"]);
    assert.equal(JSON.stringify(logRecords).includes(secret), false);

    failRpc = false;
    recovery.dispatch(host, ["client", "req-ok", "turn/start",
      { threadId: "thread-rpc-secret", clientUserMessageId: secret, input: [{ type: "text", text: "second instruction" }] }, false, true], raw);
    await untilDelivered(delivered, 2);
    assert.equal(delivered[1].result.turn.id, "turn-secret");
    const successRecord = logRecords.filter(record => record.event === "recovery.rpc_result").at(-1);
    assert.equal(successRecord.outcome, "success");
    assert.equal("result" in successRecord, false);
    const accepted = logRecords.find(record => record.event === "recovery.request_result" && record.requestId === "req-ok");
    assert.equal(accepted.outcome, "accepted");
    assert.equal(accepted.turnId, "turn-secret");
    assert.match(accepted.clientMessageHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(logRecords).includes(secret), false);
  } finally {
    disposable.dispose();
  }
});

test("ordinary host errors correlate bounded sanitized requests without changing delivery", () => {
  const recovery = require("./azrael-recovery.cjs");
  const secret = "sk-ordinary-host-secret-7d9c";
  const logRecords = [];
  const { context, vscode } = recoveryVscodeStub(logRecords);
  const disposable = recovery.initialize(context, vscode);
  const delivered = [];
  const host = fakeRecoveryHost(delivered);
  try {
    const sends = [];
    const raw = (...args) => { sends.push(args); return "native-return"; };
    const cases = [
      ["auth", 401, "login failed"],
      ["usage_rate_limit", 429, "quota exceeded"],
      ["timeout", 504, "deadline reached"],
      ["connection", 503, "socket disconnected"],
      ["unknown", -32001, "generic engine failure"],
      ["protocol", -32602, "invalid params"],
      ["tool", -32042, "tool call failed"],
      ["unknown", -32042, "engine failure"],
    ];
    cases.forEach(([category, code, message], index) => {
      const id = `req-${index}-${secret}`;
      const result = recovery.dispatch(host, ["client", id, "thread/list",
        { threadId: `thread-${secret}`, input: [{ text: secret }] }, false, true], raw);
      assert.equal(result, "native-return");
      const error = { code, message: `${message} ${secret}`, data: { credential: secret } };
      recovery.observe(host, { id: `client:${id}`, error });
      // The injected observer runs before the native router; it cannot consume
      // or rewrite the result subsequently delivered by that router.
      host.providers.get("client").onResult({ id, error });
      assert.equal(delivered.at(-1).error, error);
      const diagnostic = logRecords.filter(record => record.event === "host.rpc_error").at(-1);
      assert.equal(diagnostic.errorCategory, category);
      assert.equal(diagnostic.rpcCode, code);
      assert.equal(diagnostic.method, "thread/list");
      assert.equal(typeof diagnostic.requestId, "string");
      assert.equal(diagnostic.requestId.length, 16);
      assert.equal(typeof diagnostic.threadRef, "string");
      assert.equal(Number.isFinite(diagnostic.elapsedMs), true);
      assert.equal(diagnostic.requestId.includes(secret), false);
    });
    assert.equal(sends.length, cases.length);
    recovery.observe(host, { method: "turn/error", error: { code: 429, message: secret }, params: { prompt: secret } });
    const notification = logRecords.find(record => record.event === "host.notification_error");
    assert.equal(notification.errorCategory, "usage_rate_limit");
    assert.equal(notification.method, "turn/error");
    recovery.observe(host, { method: "turn/completed", params: { error: { code: -32600, message: secret }, output: secret } });
    assert.equal(logRecords.filter(record => record.event === "host.notification_error").at(-1).errorCategory, "protocol");

    // Successful responses should not fill the output channel.
    recovery.dispatch(host, ["client", "success", "thread/list", { threadId: secret }, false, true], raw);
    const beforeSuccess = logRecords.length;
    recovery.observe(host, { id: "client:success", result: { secret } });
    assert.equal(logRecords.length, beforeSuccess);

    for (let index = 0; index < 130; index++)
      recovery.dispatch(host, ["client", `pending-${index}-${secret}`, "thread/list", { threadId: secret }, false, true], raw);
    recovery.disconnect(host);
    const disconnected = logRecords.filter(record => record.event === "host.transport_disconnected");
    assert.equal(disconnected.length, 128);
    assert.equal(disconnected.every(record => record.outcome === "unknown" && record.errorCategory === "connection"), true);
    recovery.disconnect(host);
    assert.equal(logRecords.filter(record => record.event === "host.transport_disconnected").length, 128);

    const sendError = Object.assign(new Error(`socket closed ${secret}`), { code: 503 });
    assert.throws(() => recovery.dispatch(host, ["client", `send-fail-${secret}`, "thread/list",
      { threadId: secret }, false, true], () => { throw sendError; }), error => error === sendError);
    assert.equal(logRecords.filter(record => record.event === "host.rpc_send_failed").at(-1).errorCategory, "connection");
    assert.equal(JSON.stringify(logRecords).includes(secret), false);
  } finally {
    disposable.dispose();
  }
});

test("a failing output channel does not break initialization or recovery actions", async () => {
  const recovery = require("./azrael-recovery.cjs");
  const logRecords = [];
  const { context, vscode } = recoveryVscodeStub(logRecords, { failingOutput: true });
  const disposable = recovery.initialize(context, vscode);
  assert.ok(disposable, "initialize must succeed when the output channel throws");
  const delivered = [];
  const host = fakeRecoveryHost(delivered);
  try {
    const raw = (provider, id) => {
      queueMicrotask(() => host.providers.get(provider)?.onResult({ id, result: { turn: { id: "turn-ok" } } }));
    };
    recovery.dispatch(host, ["client", "req-1", "turn/start",
      { threadId: "thread-failing-log", input: [{ type: "text", text: "ordinary instruction" }] }, false, true], raw);
    await untilDelivered(delivered, 1);
    assert.equal(delivered[0].id, "req-1");
    assert.equal(delivered[0].result.turn.id, "turn-ok");
    assert.equal(logRecords.length, 0);
  } finally {
    disposable.dispose();
  }
});
