"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { ASSETS, HOST_ASSET, FRONTEND_ASSET, injectRequestState } = require("./inject-request-state.cjs");
const { AUTH_SHELL_MARKER, SEND_REQUEST_ADMISSION_PREFIX, injectAuthShell } = require("./inject-auth-shell.cjs");
const root = process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve("artifacts/upstream-ui/26.1007.21434");
const originals = new Map(ASSETS.map(asset => [asset, fs.readFileSync(path.join(root, asset), "utf8")]));
const outputs = new Map(ASSETS.map(asset => [asset, injectRequestState(originals.get(asset), asset)]));

// Preserve exact recognition when either transform's method prefix changes.
test("request state recognizes complete auth-shell composition and rejects damaged admission", () => {
  const requestState = outputs.get(FRONTEND_ASSET).text;
  assert.deepEqual(injectRequestState(requestState, FRONTEND_ASSET), { text: requestState, count: 0 });
  const composed = injectAuthShell(requestState, FRONTEND_ASSET).text;
  assert.deepEqual(injectRequestState(composed, FRONTEND_ASSET), { text: composed, count: 0 });
  for (const damaged of [
    composed.replace(SEND_REQUEST_ADMISSION_PREFIX, "async sendRequest(e,t,n){if(this.dispatchMessage"),
    composed.replace(SEND_REQUEST_ADMISSION_PREFIX, SEND_REQUEST_ADMISSION_PREFIX.replace("if(r)throw Error(r)", "if(r)throw Error('changed')")),
    composed.replace(SEND_REQUEST_ADMISSION_PREFIX, SEND_REQUEST_ADMISSION_PREFIX + SEND_REQUEST_ADMISSION_PREFIX),
    composed.replace(AUTH_SHELL_MARKER, ""),
    composed + AUTH_SHELL_MARKER,
    requestState + AUTH_SHELL_MARKER,
  ]) assert.throws(() => injectRequestState(damaged, FRONTEND_ASSET), /Damaged request state transformation/);
});

const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
test('ordinary host wrapper keeps strict mode and request state inside its process scope', () => {
  const prefix = '(function(process){\n', suffix = "\n}).call(this, require('./azrael-runtime.cjs').process);\n";
  const wrapped = prefix + originals.get(HOST_ASSET) + suffix;
  const result = injectRequestState(wrapped, HOST_ASSET, ts);
  assert.equal(result.text, prefix + outputs.get(HOST_ASSET).text + suffix);
  assert.equal(ts.createSourceFile(HOST_ASSET, result.text, 99, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
  assert.deepEqual(injectRequestState(result.text, HOST_ASSET, ts), { text: result.text, count: 0 });
  for (const damaged of [wrapped + wrapped, wrapped.replace('.process);', '.unknown);'),
    wrapped.replace('(function(process)', '(function(other)')]) {
    assert.throws(() => injectRequestState(damaged, HOST_ASSET, ts), /ordinary host process wrapper/);
  }
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Retain the actual pinned methods and inserted helper declarations. No copy of
// the pending-sharing implementation runs in the fixture.
function extract(asset) {
  const source = outputs.get(asset).text;
  const ast = ts.createSourceFile(asset, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0);
  const names = new Set(asset === HOST_ASSET
    ? ["getUserSavedConfiguration", "sendProviderRequest", "routeIncomingMessage"]
    : ["sendRequest", "setAppServerVersion"]);
  const prefix = asset === HOST_ASSET ? "__azraelHostRequestState" : "__azraelUiRequestState";
  const methods = new Map(), helpers = [];
  function visit(node) {
    if (ts.isMethodDeclaration(node) && names.has(node.name?.getText(ast))) {
      if (node.name.getText(ast) !== "sendRequest" || node.getText(ast).startsWith("async sendRequest(e,t,n){")) {
        assert.equal(methods.has(node.name.getText(ast)), false);
        methods.set(node.name.getText(ast), node.getText(ast));
      }
    } else if (ts.isFunctionDeclaration(node) && node.name?.text.startsWith(prefix)) helpers.push(node.getText(ast));
    else if (ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(ast).startsWith(prefix))) helpers.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(methods.size, names.size);
  assert.equal(helpers.length, 3);
  return { methods, prelude: helpers.join("\n") };
}
const hostSource = extract(HOST_ASSET), uiSource = extract(FRONTEND_ASSET);

function hostFixture() {
  const calls = [], gates = [];
  const context = vm.createContext({ Promise, D4: () => false, yO: () => false, bO: () => null, bf: () => null });
  const factory = vm.runInContext(`${hostSource.prelude}\n(()=>({${[...hostSource.methods.values()].join(",")}}))`, context);
  const makeConnection = () => Object.assign(factory(), {
    providers: new Map(), pendingRequests: new Map(), pendingPrewarmedThreadStartRequestIds: new Set(),
    recordLastOutboundMethod() {}, sendMessage(value) { calls.push(["send", value]); return false; },
    isMcpResponseMessage: () => false, isMcpRequestMessage: () => false, isMcpNotificationMessage: () => true,
    requestUserInputAutoResolutionCoordinator: { observeServerNotification() {} },
    internalNotificationHandlers: [], ephemeralThreadTimeouts: new Map(),
  });
  const makeReader = connection => Object.assign(factory(), {
    codexMcpConnection: connection,
    sendInternalAppServerRequest(...args) {
      calls.push(["read", ...args]);
      const gate = deferred(); gates.push(gate); return gate.promise;
    },
  });
  const connection = makeConnection(), reader = makeReader(connection);
  return { calls, gates, connection, reader, makeConnection, makeReader };
}
function uiFixture() {
  const calls = [], gates = [];
  const context = vm.createContext({ Promise, ntn: 12345 });
  const factory = vm.runInContext(`${uiSource.prelude}\n(()=>({${[...uiSource.methods.values()].join(",")}}))`, context);
  const makeClient = () => Object.assign(factory(), {
    dispatchMessage() {},
    enqueueRequest(...args) { calls.push(args); const gate = deferred(); gates.push(gate); return gate.promise; },
    sendConfigReadRequest(...args) { calls.push(["configMemoizer", ...args]); return Promise.resolve("native-config"); },
  });
  return { calls, gates, makeClient, client: makeClient() };
}
const account = client => client.sendRequest("azrael/account", { action: "list" });



test("saved config shares overlapping readers by connection, never settled results", async () => {
  const f = hostFixture(), secondReader = f.makeReader(f.connection);
  const a = f.reader.getUserSavedConfiguration(), b = secondReader.getUserSavedConfiguration();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(plain(f.calls[0]), ["read", "config/read", { includeLayers: false }]);
  f.gates[0].resolve({ config: { saved: 1 } });
  assert.deepEqual(await a, { saved: 1 }); assert.deepEqual(await b, { saved: 1 });
  const fresh = f.reader.getUserSavedConfiguration();
  assert.equal(f.calls.length, 2);
  f.gates[1].resolve({ config: { saved: 2 } });
  assert.deepEqual(await fresh, { saved: 2 });
  const other = f.makeReader(f.makeConnection()).getUserSavedConfiguration();
  const own = f.reader.getUserSavedConfiguration();
  assert.equal(f.gates.length, 4);
  f.gates[2].resolve({ config: "other" }); f.gates[3].resolve({ config: "own" });
  assert.deepEqual(await Promise.all([other, own]), ["other", "own"]);
});

test("account list shares only option-free overlapping reads on the same client", async () => {
  const f = uiFixture(), a = account(f.client), b = account(f.client);
  assert.equal(f.calls.length, 1);
  f.gates[0].resolve({ state: "one" });
  assert.deepEqual(await Promise.all([a, b]), [{ state: "one" }, { state: "one" }]);
  const fresh = account(f.client), other = account(f.makeClient());
  const options = { priority: "critical", timeoutMs: 99 };
  const explicit = f.client.sendRequest("azrael/account", { action: "list" }, options);
  const explicitAgain = f.client.sendRequest("azrael/account", { action: "list" }, options);
  assert.equal(f.calls.length, 5);
  assert.equal(f.calls[3][2], options);
  assert.equal(f.calls[4][2], options);
  for (let i = 1; i < 5; i++) f.gates[i].resolve(i);
  assert.deepEqual(await Promise.all([fresh, other, explicit, explicitAgain]), [1, 2, 3, 4]);
  assert.equal(await f.client.sendRequest("config/read", { cwd: "project", includeLayers: true }, options), "native-config");
  assert.deepEqual(f.calls.at(-1), ["configMemoizer", { cwd: "project", includeLayers: true }, options]);
  const plugin = f.client.sendRequest("plugin/list", {}, { priority: "background" });
  assert.deepEqual(plain(f.calls.at(-1)[2]), { priority: "background", timeoutMs: 12345 });
  f.gates.at(-1).resolve("plugins"); assert.equal(await plugin, "plugins");
  const pending = account(f.client), initial = f.gates.length;
  const extraParams = { action: "list", includeHidden: true };
  const extra = f.client.sendRequest("azrael/account", extraParams);
  const extraAgain = f.client.sendRequest("azrael/account", extraParams);
  assert.equal(f.gates.length, initial + 2);
  assert.equal(f.calls.at(-1)[1], extraParams);
  const nullOptions = f.client.sendRequest("azrael/account", { action: "list" }, null);
  assert.equal(f.gates.length, initial + 2, "null options share the option-free pending list");
  for (let i = initial - 1; i < initial + 2; i++) f.gates[i].resolve(i);
  assert.deepEqual(await Promise.all([pending, nullOptions, extra, extraAgain]), [initial - 1, initial - 1, initial, initial + 1]);
});

test("rejection removes pending entries and preserves the same exception for every waiter", async () => {
  for (const kind of ["host", "ui"]) {
    const f = kind === "host" ? hostFixture() : uiFixture();
    const read = () => kind === "host" ? f.reader.getUserSavedConfiguration() : account(f.client);
    const failure = new Error("read failed"), unhandled = [], listener = error => unhandled.push(error);
    process.on("unhandledRejection", listener);
    try {
      const a = read(), b = read();
      const observed = [a, b].map(pending => assert.rejects(pending, error => error === failure));
      f.gates[0].reject(failure); await Promise.all(observed); await tick();
      assert.deepEqual(unhandled, []);
      const retry = read(); assert.equal(f.gates.length, 2);
      f.gates[1].resolve(kind === "host" ? { config: "retry" } : "retry");
      assert.equal(await retry, "retry");
    } finally { process.off("unhandledRejection", listener); }
  }
});

test("synchronous native read exceptions preserve identity and allow a fresh retry", async () => {
  for (const kind of ["host", "ui"]) {
    const f = kind === "host" ? hostFixture() : uiFixture();
    const owner = kind === "host" ? f.reader : f.client;
    const method = kind === "host" ? "sendInternalAppServerRequest" : "enqueueRequest";
    const native = owner[method], error = new Error("synchronous read failure");
    owner[method] = () => { throw error; };
    const read = () => kind === "host" ? owner.getUserSavedConfiguration() : account(owner);
    await assert.rejects(read(), failure => failure === error);
    owner[method] = native;
    const retry = read(); assert.equal(f.gates.length, 1);
    f.gates[0].resolve(kind === "host" ? { config: "retry" } : "retry");
    assert.equal(await retry, "retry");
  }
});

test("host writes and confirmed notifications detach old pending reads without erasing newer ones", async () => {
  const mutations = [["config/value/write", {}], ["config/batchWrite", {}], ["config/mcpServer/reload", {}], ["azrael/account", { action: "switch" }], ["account/login/start", {}], ["account/login/cancel", {}], ["account/logout", {}], ["account/gatewayOAuth/login", {}], ["account/gatewayOAuth/cancel", {}], ["account/bedrock/setup", {}]];
  for (const [method, params] of mutations) {
    const f = hostFixture(), old = f.reader.getUserSavedConfiguration();
    f.connection.sendProviderRequest("provider", "id", method, params, false, false);
    assert.deepEqual(plain(f.calls.at(-1)), ["send", { id: "provider:id", method, params }]);
    const newer = f.reader.getUserSavedConfiguration(); assert.equal(f.gates.length, 2);
    f.gates[0].resolve({ config: "old" }); assert.equal(await old, "old");
    const overlap = f.reader.getUserSavedConfiguration(); assert.equal(f.gates.length, 2);
    f.gates[1].resolve({ config: "new" }); assert.deepEqual(await Promise.all([newer, overlap]), ["new", "new"]);
  }
  for (const method of ["account/updated", "account/login/completed", "account/gatewayOAuth/changed", "azrael/account/updated"]) {
    const f = hostFixture(), old = f.reader.getUserSavedConfiguration();
    const route = f.connection.routeIncomingMessage({ method, params: {} });
    assert.deepEqual(plain(route), { routeKind: "notification", method });
    const fresh = f.reader.getUserSavedConfiguration(); assert.equal(f.gates.length, 2);
    f.gates[0].resolve({ config: "old" }); f.gates[1].resolve({ config: "fresh" });
    await Promise.all([old, fresh]);
  }
});

test("frontend mutations and reconnect detach pending account lists; unrelated reads do not", async () => {
  for (const mutation of [client => client.sendRequest("azrael/account", { action: "switch" }), client => client.sendRequest("config/batchWrite", {}), client => client.setAppServerVersion("reconnected")]) {
    const f = uiFixture(), old = account(f.client), write = mutation(f.client), fresh = account(f.client);
    const freshIndex = f.gates.length - 1;
    assert.ok(freshIndex >= 1);
    f.gates[0].resolve("old"); assert.equal(await old, "old");
    const overlap = account(f.client); assert.equal(f.gates.length, freshIndex + 1);
    f.gates[freshIndex].resolve("fresh");
    assert.deepEqual(await Promise.all([fresh, overlap]), ["fresh", "fresh"]);
    if (write?.then) { f.gates[1].resolve("written"); await write; }
  }
  const f = uiFixture(), first = account(f.client);
  await f.client.sendRequest("config/read", { cwd: "other" });
  const second = account(f.client); assert.equal(f.gates.length, 1);
  f.gates[0].resolve("shared"); assert.deepEqual(await Promise.all([first, second]), ["shared", "shared"]);
  f.client.dispatchMessage = null;
  await assert.rejects(account(f.client), /missing a message dispatcher/);
});
