"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("../../extensions/azrael-ex/node_modules/typescript");
const { injectServiceAuth, MARKER, IDENTITY_ASSET, IDENTITY_EVENTS_ASSET, createServiceIdentity } = require("../inject-service-auth.cjs");
const { serviceIdentityFixture: metadata } = require("./service-identity-fixture.cjs");
const source = fs.readFileSync(path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT || path.join(__dirname, "../../artifacts/upstream-ui/26.1007.21434"), "out/extension.js"), "utf8");
const transformed = injectServiceAuth(source).text;
const parsed = ts.createSourceFile("host.js", transformed, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const classes = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ["fQ", "sF"].includes(node.name.getText(parsed))) classes.set(node.name.getText(parsed), node.initializer.getText(parsed));
  ts.forEachChild(node, visit);
}
visit(parsed);
const token = account => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account } })).toString("base64url")}.signature`;
const binding = (profileId = "main", revision = 4, authToken = token(profileId)) => ({ authMethod: "chatgpt", authToken, requiresOpenaiAuth: true, profileId, revision });

function harness(responses, statuses = [200], request = {}, brokerResults = []) {
  const calls = [], brokerCalls = [], controls = [], network = [], logs = [];
  let resultHandler;
  const context = vm.createContext({ Headers, Response, Buffer, URL, AbortController,
    q6e: { randomUUID: require("node:crypto").randomUUID }, Q6e: value => value,
    wpe: "/mutation", SQ: 3, XKt: value => !!value, w6e: async () => null,
    Nv: value => value ? { accountId: JSON.parse(Buffer.from(value.split(".")[1], "base64url"))["https://api.openai.com/auth"].chatgpt_account_id, userId: "user" } : null,
    _b: "azrael", Cpe: () => null, DH: () => "error", bQ: async () => {},
    ie: () => ({ info: (...args) => logs.push(args), error: (...args) => logs.push(args) }),
    fetch: async (url, init) => { network.push({ url, ...init, transport: "js" }); return new Response(null, { status: statuses.shift() ?? 200, headers: { authorization: "Bearer server-secret", "x-result": "retained" } }); }
  });
  vm.runInContext(`globalThis.Auth=${classes.get("fQ")};globalThis.Http=${classes.get("sF")}`, context);
  const connection = { registerProvider: (_name, handlers) => { resultHandler = handlers.onResult; return { dispose() {} }; },
    sendRequest: (_name, id, method, params) => {
      if (["azrael/service/request/end", "azrael/service/http/cancel"].includes(method)) {
        controls.push({ method, params }); queueMicrotask(() => resultHandler({ id, result: {} })); return;
      }
      if (method === "azrael/service/http") {
        brokerCalls.push(JSON.parse(JSON.stringify(params)));
        const outcome = brokerResults.shift();
        if (outcome instanceof Error) { queueMicrotask(() => resultHandler({ id, error: { message: outcome.message } })); return; }
        network.push({ ...params, transport: "native" });
        queueMicrotask(() => resultHandler({ id, result: outcome ?? { status: statuses.shift() ?? 200, headers: { authorization: "Bearer server-secret", "x-result": "retained" }, bodyBase64: Buffer.from("native body").toString("base64") } }));
        return;
      }
      calls.push({ method, params: JSON.parse(JSON.stringify(params)) });
      const next = responses.shift();
      queueMicrotask(() => resultHandler(next instanceof Error ? { id, error: { message: next.message } } : { id, result: next }));
    } };
  const auth = new context.Auth(connection), http = new context.Http(auth, null, { getUserAgent: () => "test" });
  http.backoffDelay = () => 0;
  return { auth, calls, brokerCalls, controls, network, logs, run: (signal = new AbortController().signal) => http.fetchHttp("request", { url: "https://chatgpt.com/backend-api/test", method: "GET", ...request }, signal) };
}

// Retain the actual pinned caller check: an upstream rebase or auth refactor can
// otherwise restore chat credentials or retry a request under a newly selected main.
test("frozen host transform rejects drift, composes with namespace and URL safety, and is idempotent", () => {
  assert.equal(injectServiceAuth(transformed).count, 0);
  assert.throws(() => injectServiceAuth(transformed.replace(MARKER, MARKER + MARKER)), /Damaged/);
  assert.throws(() => injectServiceAuth(source.replace("getToken({refreshToken:!0})", "getToken({refreshToken:true})")), /Pinned/);
  assert.equal(injectServiceAuth(source, "webview/other.js").count, 0);
  const output = require("../namespace-azrael-host.cjs").transformAsset(source, "out/extension.js", "host.js", ts);
  assert.equal(output.asset.serviceAuthEdits, 1);
  assert.equal(output.asset.urlSafetyTransportEdits, 1);
  assert.equal(injectServiceAuth(output.text).count, 0);
  assert.equal(require("../inject-url-safety-transport.cjs").injectUrlSafetyTransport(output.text).count, 0);
});

test("new HTTP requests resolve fresh main; ordinary auth remains separate and tokens stay in host", async () => {
  const h = harness([binding("main-a"), binding("main-b"), { authMethod: "chatgpt", authToken: "chat-token" }]);
  await h.run(); await h.run();
  assert.equal(h.network[0].headers.Authorization, `Bearer ${token("main-a")}`);
  assert.equal(h.network[1].headers.Authorization, `Bearer ${token("main-b")}`);
  assert.deepEqual(h.brokerCalls.map(call => [call.profileId, call.revision]), [["main-a", 4], ["main-b", 4]]);
  assert.ok(h.network.every(call => call.transport === "native"));
  assert.equal(await h.auth.getToken({ refreshToken: false }), "chat-token");
  assert.deepEqual(h.calls.map(call => call.method), ["azrael/service/auth", "azrael/service/auth", "getAuthStatus"]);
  assert.equal(JSON.stringify(h.logs).includes(token("main-a")), false);
});

test("401 refresh keeps original binding and selection failure never replays old request", async () => {
  const h = harness([binding(), binding("main", 4, token("refreshed"))], [401, 200]);
  assert.ok((await h.run()).response);
  assert.deepEqual(h.calls[1].params, { requestId: h.calls[0].params.requestId, refreshToken: true, profileId: "main", revision: 4 });
  assert.equal(h.network[1].headers.Authorization, `Bearer ${token("refreshed")}`);
  for (const failure of [new Error("Selection changed"), binding("new-main", 5)]) {
    const failed = harness([binding(), failure], [401, 200]);
    assert.equal((await failed.run()).status, 499);
    assert.equal(failed.network.length, 1);
    assert.equal(failed.calls.length, 2);
  }
});

test("old engines and malformed credentials fail closed without root fallback", async () => {
  for (const response of [new Error("Unknown method"), null, { ...binding(), revision: undefined }]) {
    const h = harness([response]);
    assert.equal((await h.run()).status, 433);
    assert.equal(h.network.length, 0);
    assert.deepEqual(h.calls.map(call => call.method), ["azrael/service/auth"]);
    assert.equal(h.auth.pending.size, 0);
  }
});

test("expected identity, mutation retry, no-auth destinations and response header stripping are preserved", async () => {
  const identity = harness([binding()], [200], { expectedIdentity: { accountId: "chat-account", userId: "user" } });
  assert.equal((await identity.run()).status, 499); assert.equal(identity.network.length, 0);
  for (const request of [{ retry: "never" }, { method: "POST", url: "https://chatgpt.com/mutation" }]) {
    const h = harness([binding()], [401], request); assert.equal((await h.run()).status, 401); assert.equal(h.calls.length, 1);
  }
  const anonymous = harness([], [200], { url: "https://status.openai.com/status" });
  assert.ok((await anonymous.run()).response); assert.equal(anonymous.calls.length, 0);
  assert.equal(anonymous.brokerCalls.length, 0);
  assert.equal(anonymous.network[0].transport, "js");
  const noToken = harness([{ authMethod: null, authToken: null, requiresOpenaiAuth: true, profileId: null, revision: 0 }]);
  const response = (await noToken.run()).response;
  assert.equal(noToken.network[0].headers.Authorization, undefined);
  assert.equal(response.headers.get("authorization"), null);
  assert.equal(response.headers.get("x-result"), "retained");
  const retry = harness([binding()], [500, 200]);
  assert.ok((await retry.run()).response);
  assert.equal(retry.calls.length, 1);
  assert.equal(retry.network.length, 2);
  assert.equal(retry.network[0].headers.Authorization, retry.network[1].headers.Authorization);
  assert.deepEqual(retry.brokerCalls.map(call => [call.profileId, call.revision]), [["main", 4], ["main", 4]]);
});

test("broker policy rejection or unknown mutation outcome never replays or falls back to JS", async () => {
  for (const error of [new Error("Network denied"), new Error("Producer disconnected; outcome unknown")]) {
    const h = harness([binding()], [200], { method: "POST", body: "mutation" }, [error]);
    assert.equal((await h.run()).status, 433);
    assert.equal(h.brokerCalls.length, 1);
    assert.equal(h.network.length, 0);
    assert.equal(h.calls.length, 1);
  }
});

test("broker response bytes and HEAD/204/205/304 body semantics are preserved", async () => {
  const h = harness([binding()]);
  assert.equal(await (await h.run()).response.text(), "native body");
  for (const [method, status] of [["HEAD", 200], ["GET", 204], ["GET", 205], ["GET", 304]]) {
    const h = harness([binding()], [status], { method, returnErrorResponse: true });
    const result = await h.run();
    assert.equal(result.response.status, status);
    assert.equal(await result.response.text(), "");
  }
});

test("logical request lease survives retries, forwards expected binding, strips private headers and always ends", async () => {
  const h = harness([binding(), binding("main", 4, token("refreshed"))], [401, 500, 200], {
    headers: { "x-azrael-service-profile": "main", "x-azrael-service-revision": "4" }
  });
  assert.ok((await h.run()).response);
  const id = h.calls[0].params.requestId;
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(h.calls[0].params, { requestId: id, refreshToken: false, profileId: "main", revision: 4 });
  assert.ok(h.brokerCalls.every(call => call.requestId === id));
  assert.ok(h.network.every(call => !Object.keys(call.headers).some(key => key.startsWith("x-azrael-service-"))));
  assert.deepEqual(JSON.parse(JSON.stringify(h.controls)), [{ method: "azrael/service/request/end", params: { requestId: id } }]);
});

test("cancellation rejects pending initial auth and notifies the same native connection", async () => {
  const h = harness([]), controller = new AbortController();
  // The real auth pending channel receives no initial reply in this probe.
  h.auth.mcpConnection.sendRequest = (_provider, id, method, params) => {
    if (method === "azrael/service/auth") { h.calls.push({ method, params }); return; }
    h.controls.push({ method, params });
  };
  const pending = h.run(controller.signal);
  controller.abort();
  assert.equal((await pending).status, 499);
  assert.equal(h.network.length, 0);
  assert.deepEqual(h.controls.map(call => call.method), ["azrael/service/http/cancel", "azrael/service/request/end"]);
  assert.equal(h.controls[0].params.requestId, h.calls[0].params.requestId);
  assert.equal(h.auth.pending.size, 0);
});

test("cancellation aborts a pending broker operation without a second dispatch", async () => {
  const h = harness([binding()]), controller = new AbortController();
  const send = h.auth.mcpConnection.sendRequest;
  let started;
  const dispatched = new Promise(resolve => { started = resolve; });
  h.auth.mcpConnection.sendRequest = (provider, id, method, params) => {
    if (method === "azrael/service/http") { h.brokerCalls.push(params); started(); return; }
    send(provider, id, method, params);
  };
  const pending = h.run(controller.signal);
  await dispatched; controller.abort();
  assert.equal((await pending).status, 499);
  assert.equal(h.brokerCalls.length, 1);
  assert.equal(h.network.length, 0);
  assert.equal(h.auth.pending.size, 0);
  assert.equal(h.controls[0].params.requestId, h.brokerCalls[0].requestId);
});

test("service projection uses management metadata and rejects stale revision without retaining tokens", async () => {
  const projection = createServiceIdentity();
  let value = metadata();
  await projection.attach({ hostId: "local", sendRequest: async (method, params) => {
    assert.equal(method, "azrael/account"); assert.deepEqual(params, { action: "list" }); return value;
  } });
  await Promise.resolve();
  const original = projection.read();
  assert.equal(original.accountId, "workspace-service");
  assert.equal(JSON.stringify(original).includes("must-never"), false);
  const options = projection.options(original, { expectedIdentity: { accountId: "chat", userId: "chat-user" }, additionalHeaders: { "chatgpt-account-id": "chat" } });
  assert.deepEqual(options.expectedIdentity, { accountId: "workspace-service", userId: "user-service" });
  assert.equal(options.additionalHeaders["ChatGPT-Account-ID"], "workspace-service");
  value = metadata("service", 10); await projection.refresh();
  assert.throws(() => projection.options(original), /changed/);
  assert.notDeepEqual(projection.key(original, ["settings"]), projection.key(projection.read(), ["settings"]));
});

test("service membership metadata reuses accounts-check endpoint and never substitutes chat membership", async () => {
  const projection = createServiceIdentity(); let meta = metadata(), received;
  await projection.attach({ hostId: "local", sendRequest: async () => meta });
  const binding = projection.capture();
  const query = projection.accountUserQuery({ safeGet: async (path, options) => {
    received = { path, options };
    return { accounts: { "workspace-service": { account: { account_id: "workspace-service", account_user_id: "service-membership" } },
      "chat-account": { account: { account_id: "chat-account", account_user_id: "chat-membership" } } } };
  } }, binding);
  assert.deepEqual(await query.queryFn(), { accountUserId: "service-membership", bindingKey: binding.key });
  assert.equal(received.path, "/accounts/check/{version}");
  assert.equal(received.options.parameters.path.version, "v4-2023-04-27");
  assert.equal(received.options.expectedIdentity.userId, "user-service");
  const observer = new AbortController(); observer.abort();
  assert.deepEqual(await query.queryFn({ signal: observer.signal }), { accountUserId: "service-membership", bindingKey: binding.key });
  assert.equal(received.options.signal, undefined);
  for (const response of [
    { accounts: { "chat-account": { account: { account_user_id: "chat-membership" } } } },
    { accounts: { "workspace-service": { account: { account_id: "workspace-service" } } } },
    { accounts: { "workspace-service": { account: { account_id: "chat-account", account_user_id: "chat-membership" } } } }
  ]) {
    const missing = projection.accountUserQuery({ safeGet: async () => response }, binding);
    await assert.rejects(missing.queryFn(), /membership identity is unavailable/);
  }
  let complete;
  const lateResponse = new Promise(resolve => { complete = resolve; });
  const late = projection.accountUserQuery({ safeGet: async () => lateResponse }, binding).queryFn();
  meta = metadata("service", 10); await projection.refresh();
  complete({ accounts: { "workspace-service": { account: { account_id: "workspace-service", account_user_id: "old-service-membership" } } } });
  await assert.rejects(late, /changed/);
  await assert.rejects(query.queryFn(), /changed/);
  assert.equal(projection.read().ready, true);
});

test("actual Webview settings mutation and query use service identity while chat atoms stay unchanged", async () => {
  const root = process.env.AZRAEL_PRESERVATION_UI_ROOT || path.join(__dirname, "../../artifacts/upstream-ui/26.1007.21434");
  const input = fs.readFileSync(path.join(root, IDENTITY_ASSET), "utf8");
  const output = injectServiceAuth(input, IDENTITY_ASSET);
  assert.equal(injectServiceAuth(output.text, IDENTITY_ASSET).count, 0);
  const ast = ts.createSourceFile("webview.js", output.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0);
  const functions = {}, callbacks = {};
  function find(node) {
    if (ts.isFunctionDeclaration(node) && ["OUt", "MUt", "NUt", "ZC", "EUt"].includes(node.name?.text)) functions[node.name.text] = node.getText(ast);
    if (ts.isBinaryExpression(node) && ["ew", "qUt"].includes(node.left.getText(ast)) && ts.isCallExpression(node.right)) callbacks[node.left.getText(ast)] = node.right.arguments[1].getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast);
  const atoms = Object.fromEntries(["JC", "KS", "qC", "qS", "JS", "YUt", "$C", "ew"].map(name => [name, Symbol(name)]));
  let meta = metadata(), options;
  const state = new Map(), calls = [], queryData = { chatTheme: "old" };
  const context = vm.createContext({ ...atoms, globalThis: {}, DOMException, WeakMap, Map, Set, Proxy, JSON, $: {},
    na: (_scope, initial) => ({ initial }), sb: "x-workspace-id", __vite__mapDeps: () => [],
    rv: async () => ({ Request: { safePatch: async (url, request) => { request.assertRequestCurrent(); calls.push({ url, request }); return { chat_theme: "new" }; } } }),
    GUt: { shape: { settings: { unwrap: () => ({ extend: () => ({ safeParse: data => ({ success: true, data }) }) }) } } }, bUt: {},
    Zve: { isServer: () => false }, Jp: { ONE_MINUTE: 60000 }, pr: class extends Error {}
  });
  vm.runInContext(output.text.slice(output.text.indexOf("var __azraelServiceIdentity=")).replace("export{__azraelServiceAtom as __azraelGetServiceIdentityAtom};", ""), context);
  const projection = context.__azraelServiceIdentity;
  await projection.attach({ hostId: "local", sendRequest: async () => meta });
  const snapshot = { cancel: async () => {}, getData: () => queryData, setData: updater => Object.assign(queryData, updater(queryData)), invalidate: async () => {} };
  const scope = { get: (atom, key) => {
    if (atom?.initial) return atom.initial();
    if (atom === atoms.YUt) { if (!state.has(key)) state.set(key, { revision: 0, queue: Promise.resolve() }); return state.get(key); }
    return new Map([[atoms.JC, "chat-account"], [atoms.KS, "chat-account"], [atoms.qS, "chat-user"], [atoms.JS, "chat-user"]]).get(atom);
  }, query: { snapshot: () => snapshot }, queryClient: { defaultQueryOptions: () => ({ retry: 0 }) } };
  for (const source of Object.values(functions)) vm.runInContext(source.replaceAll("import.meta.url", '"webview-test"'), context);
  const edit = context.OUt(scope);
  assert.equal(edit.accountId, "workspace-service");
  assert.equal(await context.MUt(scope, "new", edit), true);
  assert.equal(calls[0].request.expectedIdentity.accountId, "workspace-service");
  assert.equal(calls[0].request.additionalHeaders["ChatGPT-Account-ID"], "workspace-service");
  assert.equal(scope.get(atoms.JC), "chat-account");
  const queryFactory = vm.runInContext(`(${callbacks.ew})`, context);
  options = queryFactory({ scope, get: atom => scope.get(atom) });
  assert.equal(options.queryKey[0], "azrael-openai-service");
  assert.equal(options.enabled, true);
  const actualSettingsRead = context.EUt;
  let readOptions;
  context.EUt = async (_scope, passed) => { readOptions = passed; return {}; };
  const retiredObserver = new AbortController(); retiredObserver.abort();
  await options.queryFn({ signal: retiredObserver.signal });
  assert.equal(readOptions.signal, undefined);
  context.EUt = actualSettingsRead;
  const quickFactory = vm.runInContext(`(${callbacks.qUt.replaceAll("import.meta.url", '"webview-test"')})`, context);
  const quick = quickFactory({ scope, get: atom => scope.get(atom) });
  meta = metadata("service", 10); await projection.refresh();
  assert.equal(await context.MUt(scope, "new", edit), false);
  await assert.rejects(options.queryFn({ signal: new AbortController().signal }), /changed/);
  await assert.rejects(quick.mutationFn(true), /changed/);
  assert.equal(calls.length, 1);
  const next = queryFactory({ scope, get: atom => scope.get(atom) });
  assert.notDeepEqual([...next.queryKey], [...options.queryKey]);
  const events = fs.readFileSync(path.join(root, IDENTITY_EVENTS_ASSET), "utf8");
  assert.equal(injectServiceAuth(events, IDENTITY_EVENTS_ASSET).count, 1);
});

test("actual URL-safety origin forwards service expectation and rejects a stale completion", async () => {
  const root = process.env.AZRAEL_PRESERVATION_UI_ROOT || path.join(__dirname, "../../artifacts/upstream-ui/26.1007.21434");
  const result = injectServiceAuth(fs.readFileSync(path.join(root, IDENTITY_EVENTS_ASSET), "utf8"), IDENTITY_EVENTS_ASSET);
  const ast = ts.createSourceFile("events.js", result.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0);
  const apr = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "apr").getText(ast);
  const projection = createServiceIdentity();
  let meta = metadata(), switchDuringRequest = false, received;
  await projection.attach({ hostId: "local", sendRequest: async () => meta });
  const context = vm.createContext({ __azraelServiceIdentity: projection, Fg: { safePost: async (url, options) => {
    received = { url, options };
    if (switchDuringRequest) { meta = metadata("next", 10); await projection.refresh(); }
    return { safe: true };
  } } });
  vm.runInContext(apr, context);
  assert.equal(await context.apr("https://example.com"), true);
  assert.equal(received.options.expectedIdentity.accountId, "workspace-service");
  assert.equal(received.options.additionalHeaders["x-azrael-service-revision"], "9");
  switchDuringRequest = true;
  await assert.rejects(context.apr("https://example.com"), /changed/);
});
