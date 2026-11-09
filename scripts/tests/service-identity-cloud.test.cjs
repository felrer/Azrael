"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("../../extensions/azrael-ex/node_modules/typescript");
const { createServiceIdentity } = require("../inject-service-auth.cjs");
const { serviceIdentityFixture } = require("./service-identity-fixture.cjs");
const { injectServiceCloud, SERVICE_CLOUD_ASSETS, CLOUD_SETTINGS_ASSET, CREDENTIALS_ASSET, HANDOFF_ASSET, SECURITY_CLIENT_ASSET, SECURITY_RECOMMENDATIONS_ASSET, SECURITY_SETTINGS_ASSET, AEON_MAIN_ASSET, AEON_ONBOARDING_ASSET, HOSTED_THREAD_ASSET, SERVICE_ACCOUNTS_ASSET } = require("../service-identity-cloud.cjs");
const root = process.env.AZRAEL_PRESERVATION_UI_ROOT || path.join(__dirname, "../../artifacts/upstream-ui/26.1007.21434");
const source = asset => fs.readFileSync(path.join(root, asset), "utf8");
const compiled = new Map();
function compile(asset) {
  if (!compiled.has(asset)) {
    const output = injectServiceCloud(source(asset), asset).text;
    compiled.set(asset, { output, parsed: ts.createSourceFile(asset, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) });
  }
  return compiled.get(asset);
}

// Retain these actual pinned functions: future upstream updates must reconnect
// both the request binding and revision-partitioned query/cache owners.
function extracted(asset, names, bindings) {
  const { parsed } = compile(asset);
  assert.equal(parsed.parseDiagnostics.length, 0);
  const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  const assignments = [];
  const visit = node => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left) && names.includes(node.left.text) && !functions.some(f => f.name.text === node.left.text)) assignments.push(node);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.equal(functions.length + assignments.length, names.length);
  const helpers = parsed.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ["__azraelCloudRequest", "__azraelCloudCacheScope"].includes(d.name.getText(parsed))));
  const catalog = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "__azraelCloudCatalog");
  const context = vm.createContext({ DOMException, AbortController, AbortSignal, ...bindings });
  vm.runInContext([...helpers.map(node => node.getText(parsed)), ...(catalog ? [catalog.getText(parsed)] : []), ...functions.map(node => node.getText(parsed)), ...assignments.map(node => `${node.getText(parsed)};`)].join("\n"), context);
  return context;
}
async function identity() {
  const store = createServiceIdentity(); let current = serviceIdentityFixture("main-a", 1);
  await store.attach({ hostId: "local", sendRequest: async () => current });
  return { store, switch: async (profile = "main-b", revision = 2) => { current = serviceIdentityFixture(profile, revision); await store.refresh(); } };
}
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

test("pinned cloud transforms parse, reject drift and remain idempotent", () => {
  for (const asset of SERVICE_CLOUD_ASSETS) {
    const { output, parsed } = compile(asset);
    assert.equal(parsed.parseDiagnostics.length, 0);
    assert.equal(injectServiceCloud(output, asset).count, 0);
  }
  assert.throws(() => injectServiceCloud(source(CLOUD_SETTINGS_ASSET).replace("function at(", "function changed("), CLOUD_SETTINGS_ASSET), /Pinned/);
});

test("saved-credential infinite query uses service identity and rejects late results without replay", async () => {
  const h = await identity(), calls = [], pending = deferred();
  const context = extracted(CREDENTIALS_ASSET, ["Ge", "Ke"], {
    __azraelServiceIdentityV1: h.store, d: value => value,
    qe: { parse: value => value }, m: () => ({ parse: value => value }), b: value => value,
    he: { safeGet: (url, options) => { calls.push({ url, options }); return pending.promise; },
      safeDelete: async (url, options) => { calls.push({ url, options }); return { status: "deleted" }; } }
  });
  const a = context.Ge("chat-account", "chat-user"), signal = new AbortController().signal;
  const running = a.queryFn({ pageParam: "cursor-a", signal });
  assert.equal(calls[0].options.expectedIdentity.accountId, "workspace-main-a");
  assert.equal(calls[0].options.additionalHeaders["x-azrael-service-revision"], "1");
  assert.equal(calls[0].options.parameters.query.cursor, "cursor-a");
  await h.switch(); pending.resolve({ items: [{ credential_id: "a" }] });
  await assert.rejects(running, { name: "AbortError" });
  assert.equal(calls.length, 1);
  const b = context.Ge("chat-account", "chat-user");
  assert.notDeepEqual(plain(a.queryKey), plain(b.queryKey));
  await context.Ke("chat-account", "chat-user", "credential-b");
  assert.equal(calls[1].options.expectedIdentity.accountId, "workspace-main-b");
});

test("Orbit cookie query ignores project/chat atoms and preserves its captured target", async () => {
  const h = await identity(), calls = [], pending = deferred();
  const context = extracted(CLOUD_SETTINGS_ASSET, ["at"], {
    __azraelServiceIdentityV1: h.store,
    G: { safeGet: (url, options) => { calls.push({ url, options }); return pending.promise; } }
  });
  const scope = { get() { throw Error("must not consult chat atoms"); } };
  const a = context.at(scope, "chat-account", "chat-user");
  const running = a.queryFn({ signal: new AbortController().signal });
  assert.equal(calls[0].options.parameters.query.surface, "Orbit");
  assert.equal(calls[0].options.expectedIdentity.userId, "user-main-a");
  await h.switch("main-a", 2); pending.resolve({ target: { workspace_id: "a", primary_generation: 8 }, hosts: [] });
  await assert.rejects(running, { name: "AbortError" });
  const b = context.at(scope, "chat-account", "chat-user");
  assert.notDeepEqual(plain(a.queryKey), plain(b.queryKey));
  assert.equal(calls.length, 1);
});

test("cloud config/cookie/passkey operations bind the selected service and stop stale completion", async () => {
  const h = await identity(), calls = [], pending = deferred(); let delayed = true;
  const client = Object.fromEntries(["safeGet", "safeDelete", "safePatch"].map(method => [method, (url, options) => {
    calls.push({ method, url, options }); return delayed ? pending.promise : Promise.resolve({ hosts: [], passkeys: [] });
  }]));
  const context = extracted(CLOUD_SETTINGS_ASSET, ["Xe", "Ze", "xt", "St", "Ot", "kt"], { __azraelServiceIdentityV1: h.store, G: client });
  const binding = h.store.capture(), operation = context.Ot({ approval_mode: "always_ask" }, binding);
  await h.switch(); pending.resolve({ approval_mode: "always_ask" });
  await assert.rejects(operation, { name: "AbortError" });
  assert.equal(calls[0].options.expectedIdentity.accountId, "workspace-main-a");
  delayed = false;
  await context.Xe("all"); await context.Xe({ hostname: "example.test", includeSubdomains: true });
  await context.Ze(); await context.xt("credential-b"); await context.St(); await context.kt();
  assert.ok(calls.slice(1).every(call => call.options.expectedIdentity.accountId === "workspace-main-b"));
  assert.equal(calls[2].options.parameters.path.hostname, "example.test");
  assert.equal(calls[4].options.parameters.path.credential_id, "credential-b");
  assert.equal(calls.length, 7);
});

test("cloud cookie component subscribes/remounts by service revision and blocks stale cache writes", async () => {
  const h = await identity(), writes = [], queries = [], pending = deferred();
  const jsx = (type, props, key) => ({ type, props, key });
  const context = extracted(CLOUD_SETTINGS_ASSET, ["Ye", "YeService", "Xe", "Ze"], {
    __azraelServiceIdentityV1: h.store, __azraelGetServiceIdentityAtom: () => "service-atom",
    d: atom => { assert.equal(atom, "service-atom"); return h.store.read(); },
    tt: { c: () => Array(27).fill(Symbol.for("react.memo_cache_sentinel")) },
    p: () => ({ get: () => ({ danger() {} }) }), Ee: {}, a: () => ({ formatMessage: () => "failure" }),
    m: () => ({ setQueryData: (...args) => writes.push(args), invalidateQueries() {} }),
    r: options => { queries.push(options); return { isPending: false, isError: false, data: { hosts: [] }, refetch() {} }; },
    Y: { jsx }, Se: { ONE_MINUTE: 60000 }, J: {}, ie: {}, Qe: "cookie-list", s: "label", V: "button",
    G: { safeDelete: () => pending.promise, safeGet: async () => ({ hosts: [] }) }
  });
  const outerA = context.Ye({}), screenA = outerA.type(outerA.props);
  const mutation = screenA.props.deleteMutationOptions, operation = mutation.mutationFn("all");
  await h.switch(); pending.resolve({});
  await assert.rejects(operation, { name: "AbortError" });
  assert.throws(() => mutation.onSuccess({}, "all"), { name: "AbortError" });
  assert.equal(writes.length, 0);
  const outerB = context.Ye({}); outerB.type(outerB.props);
  assert.notEqual(outerA.key, outerB.key);
  assert.notDeepEqual(plain(queries[0].queryKey), plain(queries[1].queryKey));
});

test("local browser fallback remains available without service identity", async () => {
  const h = await identity();
  await h.store.attach({ hostId: "local", sendRequest: async () => ({}) });
  assert.equal(h.store.read().ready, false);
  const context = extracted(HANDOFF_ASSET, ["D", "DService"], {
    __azraelServiceIdentityV1: h.store, __azraelGetServiceIdentityAtom: () => "service-atom",
    s: () => h.store.read(), j: { c: () => Array(15).fill(Symbol.for("react.memo_cache_sentinel")) },
    N: { jsx: (type, props, key) => ({ type, props, key }) }, c: () => "server-thread", v: {}
  });
  const rendered = context.D({ conversationId: "local-thread", targetTabId: "ordinary-local-tab", fallback: "local-browser" });
  assert.equal(rendered.type(rendered.props), "local-browser");
});

test("cloud handoff query retains its service snapshot across a delayed result", async () => {
  const h = await identity(), calls = [], queries = [], pending = deferred(), stop = Error("query captured");
  const context = extracted(HANDOFF_ASSET, ["O"], {
    __azraelServiceIdentityV1: h.store,
    j: { c: () => Array(29).fill(Symbol.for("react.memo_cache_sentinel")) },
    i: () => ({}), M: { useState: value => [value, () => {}] },
    n: options => { queries.push(options); throw stop; },
    x: { safeGet: (url, options) => { calls.push({ url, options }); return pending.promise; } }
  });
  const binding = h.store.capture();
  assert.throws(() => context.O({ serverConversationId: "server-thread", identity: { accountId: binding.accountId, userId: binding.userId }, serviceBinding: binding }), error => error === stop);
  const running = queries[0].queryFn({ signal: new AbortController().signal });
  assert.equal(calls[0].options.expectedIdentity.accountId, "workspace-main-a");
  assert.equal(calls[0].options.parameters.query.conversation_id, "server-thread");
  await h.switch(); pending.resolve({ novnc_url: "https://example.test/old-account" });
  await assert.rejects(running, { name: "AbortError" });
  const next = h.store.capture();
  assert.throws(() => context.O({ serverConversationId: "server-thread", identity: { accountId: next.accountId, userId: next.userId }, serviceBinding: next }), error => error === stop);
  assert.notDeepEqual(plain(queries[0].queryKey), plain(queries[1].queryKey));
  assert.equal(calls.length, 1);
});

test("security query factories partition each family and preserve dispatched A when its observer retires", async () => {
  const h = await identity(), calls = [], pending = deferred();
  const context = extracted(SECURITY_CLIENT_ASSET, ["s"], {
    __azraelServiceIdentityV1: h.store, r: { ONE_MINUTE: 60000 },
    c: { safeGet: (url, options) => { calls.push({ url, options }); return pending.promise; } }
  });
  const a = context.s("chat-account", { includeTrustedDevices: true, sessionReviewUserId: "chat-user" });
  assert.deepEqual(Object.keys(a), ["addPassword", "changePassword", "mfa", "sessions", "linkedApps", "cyber", "protection"]);
  for (const query of Object.values(a)) assert.equal(query.queryKey[1], h.store.read().key);
  const observer = new AbortController(), running = a.sessions.queryFn({ signal: observer.signal });
  assert.equal(calls[0].options.signal, undefined);
  assert.equal(calls[0].options.expectedIdentity.accountId, "workspace-main-a");
  assert.equal(calls[0].options.expectedIdentity.userId, "user-main-a");
  await h.switch(); observer.abort(); pending.resolve({ devices: [] });
  await assert.rejects(running, { name: "AbortError" });
  const b = context.s("chat-account");
  assert.notDeepEqual(plain(a.sessions.queryKey), plain(b.sessions.queryKey));
  assert.equal(calls.length, 1);
  await h.store.attach({ hostId: "local", sendRequest: async () => ({}) });
  assert.ok(Object.values(context.s("chat-account")).every(query => query.enabled === false));
});

test("security recommendations use the service user and reject stale completion", async () => {
  const h = await identity(), calls = [], pending = deferred();
  const context = extracted(SECURITY_RECOMMENDATIONS_ASSET, ["p"], {
    __azraelServiceIdentityV1: h.store, m: { parse: value => value },
    s: { safeGet: (url, options) => { calls.push(options); return pending.promise; } }
  });
  const a = context.p("chat-account", "chat-user"), running = a.queryFn({ signal: new AbortController().signal });
  assert.equal(calls[0].expectedIdentity.userId, "user-main-a");
  await h.switch(); pending.resolve({ recommendations: [] });
  await assert.rejects(running, { name: "AbortError" });
  assert.notDeepEqual(plain(a.queryKey), plain(context.p("chat-account", "chat-user").queryKey));
});

test("1Password enrollment uses authoritative service membership and never opens a stale authorization URL", async () => {
  const h = await identity(), calls = [], opened = [], pending = deferred(); let delayed = true;
  const context = extracted(CREDENTIALS_ASSET, ["Le"], {
    __azraelServiceIdentityV1: h.store, URL, N: value => opened.push(value),
    he: { safePost: (url, options) => { calls.push(options); return delayed ? pending.promise : Promise.resolve({ authorization_url: "https://my.1password.com/oauth/authorize?state=b" }); } }
  });
  const membership = await h.store.accountUserQuery({ safeGet: async () => ({ accounts: { "workspace-main-a": { account: { account_id: "workspace-main-a", account_user_id: "membership-main-a" } } } }) }, h.store.capture()).queryFn();
  const running = context.Le("workspace-main-a", membership.accountUserId, "user-main-a", null, h.store.capture());
  assert.equal(calls[0].requestBody.expected_account_user_id, "membership-main-a");
  assert.equal(calls[0].expectedIdentity.accountId, "workspace-main-a");
  await h.switch(); pending.resolve({ authorization_url: "https://my.1password.com/oauth/authorize?state=a" });
  await assert.rejects(running, { name: "AbortError" });
  assert.equal(opened.length, 0);
  delayed = false;
  await context.Le("workspace-main-b", "membership-main-b", "user-main-b", null, h.store.capture());
  assert.equal(opened.length, 1);
  assert.equal(calls[1].expectedIdentity.accountId, "workspace-main-b");
});

test("aeon catalog factory owns revision keys and cannot publish a late profile into B's cache", async () => {
  const h = await identity(), pending = deferred(), calls = [], writes = [];
  const context = extracted(AEON_MAIN_ASSET, ["uT"], {
    __azraelServiceIdentityV1: h.store, __azraelGetServiceIdentityAtom: () => "service-atom",
    Q: {}, ei: (_scope, factory) => factory, ef: "chat-account-atom", dl: "chat-user-atom", qb: "eligible", Bh: { ONE_MINUTE: 60000 }, Vo: () => {}, Vp: "ChatGPT-Account-ID",
    Wp: { safeGet: (url, options) => { calls.push(options); return pending.promise; } }
  });
  const get = atom => atom === "service-atom" ? h.store.read() : atom === "eligible";
  const scope = { query: { getData: () => null, setData: (...args) => writes.push(args) }, get, set() {} };
  const a = context.uT({ get, scope }), observer = new AbortController();
  const running = a.queryFn({ signal: observer.signal });
  assert.equal(calls[0].signal, undefined);
  await h.switch(); observer.abort(); pending.resolve({ items: [{ id: "a", active_root_thread_id: "thread-a" }], cursor: null });
  await assert.rejects(running, { name: "AbortError" });
  assert.equal(writes.length, 0);
  assert.notDeepEqual(plain(a.queryKey), plain(context.uT({ get, scope }).queryKey));
});

test("hosted MCP request keeps native chat access checks and uses only service identity for HTTP", async () => {
  const h = await identity(), calls = [], pending = deferred();
  const chatAccount = {}, chatUser = {};
  const context = extracted(HOSTED_THREAD_ASSET, ["J"], {
    __azraelServiceIdentityV1: h.store, crypto: { randomUUID: () => "request-a" },
    D: chatAccount, y: chatUser, T: {}, M: () => ({}), R: () => ({}), P: () => ({}),
    B: { getInstance: () => ({ sendRequest: (method, url, options) => { calls.push({ method, url, options }); return pending.promise; } }) },
    A: (_scope, value) => value.sendRequest(value.request), o: { parse: value => JSON.parse(value) }
  });
  const scope = { get: atom => atom === chatAccount ? "chat-account" : atom === chatUser ? "chat-user" : null, watch: callback => { callback({ get: scope.get }); return () => {}; } };
  const adapter = context.J(scope, { view: { accountId: "chat-account", appId: "app", toolName: "open" }, thread: { kind: "app-server", id: "native-thread" }, linkId: "native-link", userId: "chat-user", signal: new AbortController().signal, isThreadAccessRevoked: () => false, serviceBinding: h.store.capture() });
  const running = adapter.open();
  assert.equal(calls[0].options.expectedIdentity.accountId, "workspace-main-a");
  assert.equal(calls[0].options.headers["ChatGPT-Account-ID"], "workspace-main-a");
  assert.equal(calls[0].options.signal.aborted, false);
  await h.switch();
  assert.equal(calls[0].options.signal.aborted, false);
  pending.resolve({ body: JSON.stringify({ id: "request-a", jsonrpc: "2.0", result: {} }) });
  await assert.rejects(running, { name: "AbortError" });
  assert.equal(calls.length, 1);
});

test("security account metadata reuses the pinned membership decoder with service binding", async () => {
  const h = await identity(), pending = deferred(), calls = [];
  const context = extracted(SERVICE_ACCOUNTS_ASSET, ["__azraelServiceAccountsQuery", "MRt"], { __azraelServiceIdentityV1: h.store });
  const client = { safeGet: (url, options) => { calls.push(options); return pending.promise; } };
  const a = context.__azraelServiceAccountsQuery(client, h.store.capture()), running = a.queryFn();
  assert.equal(calls[0].expectedIdentity.accountId, "workspace-main-a");
  await h.switch(); pending.resolve({ accounts: {}, account_ordering: [] });
  await assert.rejects(running, { name: "AbortError" });
  const account = { account_id: "workspace-main-b", account_user_id: "membership-b", account_user_role: "owner", structure: "personal", plan_type: "pro", is_zdr: false };
  const b = context.__azraelServiceAccountsQuery({ safeGet: async () => ({ account_ordering: [account.account_id], accounts: { [account.account_id]: { account, can_access_with_session: true } } }) }, h.store.capture());
  assert.notDeepEqual(plain(a.queryKey), plain(b.queryKey));
  const data = await b.queryFn();
  assert.equal(data.accounts[0].plan_type, "pro");
  assert.equal(data.default_account_id, "workspace-main-b");
});

test("aeon primary/sidebar/by-thread factories never seed service queries from unbound native catalog state", async () => {
  const h = await identity(), atoms = Object.fromEntries(["ef", "dl", "kg", "_f", "Hb", "Xu", "qd", "rut"].map(name => [name, name]));
  const context = extracted(AEON_MAIN_ASSET, ["pT", "cx", "wx"], {
    __azraelServiceIdentityV1: h.store, __azraelGetServiceIdentityAtom: () => "service-atom",
    Q: {}, ei: (_scope, factory) => factory, Br: (_scope, factory) => factory,
    ...atoms, sl: "local", Bh: { ONE_MINUTE: 60000, FIVE_MINUTES: 300000 }, Vo: () => {}
  });
  const get = atom => atom === "service-atom" ? h.store.read() : atom === "Hb" ? { attachments: [{ thread_id: "chat-private" }], profilesByThreadId: { "thread-a": { id: "chat-private" } } } : atom === "rut" ? { accountId: "workspace-main-a", userId: "user-main-a", response: { selection: { available: true } } } : atom === "qd" ? ["local"] : true;
  const scope = { get, query: {}, set() {} };
  const a = [context.pT({ get, scope }), context.cx({ get, scope }), context.wx("thread-a", { get, scope })];
  for (const query of a) { assert.equal(query.queryKey[1], h.store.read().key); assert.equal(query.initialData, undefined); }
  await h.switch("main-a", 2);
  const b = [context.pT({ get, scope }), context.cx({ get, scope }), context.wx("thread-a", { get, scope })];
  for (let index = 0; index < a.length; index++) assert.notDeepEqual(plain(a[index].queryKey), plain(b[index].queryKey));
});

test("aeon avatar upload preserves captured service identity without aborting its explicit operation signal", async () => {
  const h = await identity(), pending = deferred(), calls = [], operation = new AbortController();
  const context = extracted(AEON_ONBOARDING_ASSET, ["J"], {
    __azraelServiceIdentityV1: h.store, FormData, Blob, D: {}, o: {}, l: {}, r: {},
    t: value => value, q: async () => new Blob(["avatar"]),
    m: { safePost: (url, options) => { calls.push(options); return pending.promise; } }
  });
  const scope = { query: { getOrFetch: async () => ({ id: "custom:pet-a" }) } };
  const running = context.J(scope, "custom:pet-a", "workspace-main-a", "user-main-a", operation.signal, h.store.capture());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0].expectedIdentity.accountId, "workspace-main-a");
  await h.switch();
  assert.equal(calls[0].signal.aborted, false);
  pending.resolve({ snapshot: { asset_pointer: "a" } });
  await assert.rejects(running, { name: "AbortError" });
  assert.equal(calls.length, 1);
});

test("security settings entry reads only the service subscription and session acknowledgement cannot rebind", async () => {
  const h = await identity(), calls = [], atom = {};
  const context = extracted(SECURITY_SETTINGS_ASSET, ["lo", "loService", "ro"], {
    __azraelServiceIdentityV1: h.store, __azraelGetServiceIdentityAtom: () => atom,
    v: value => { assert.equal(value, atom); return h.store.read(); },
    _o: { c: () => Array(2).fill(Symbol.for("react.memo_cache_sentinel")) },
    $: { jsx: (type, props, key) => ({ type, props, key }) }, uo: "security-page", qe: "loading",
    jt: { safePost: async (url, options) => { calls.push(options); return {}; } }
  });
  const rendered = context.lo({}), content = rendered.type(rendered.props);
  assert.equal(content.props.accountId, "workspace-main-a");
  const binding = h.store.capture();
  await context.ro({ accountId: binding.accountId, userId: binding.userId }, binding);
  assert.equal(calls[0].expectedIdentity.accountId, "workspace-main-a");
  await h.switch();
  assert.throws(() => context.ro({ accountId: "chat-account", userId: "chat-user" }), { name: "AbortError" });
  await assert.rejects(async () => context.ro({ accountId: binding.accountId, userId: binding.userId }, binding), { name: "AbortError" });
  assert.equal(calls.length, 1);
});

test("logout-all completion refreshes service metadata and never invokes project/chat logout", async () => {
  const h = await identity(), binding = h.store.capture(); let refreshes = 0;
  h.store.refresh = async () => { refreshes++; };
  const { parsed } = compile(SECURITY_SETTINGS_ASSET);
  const owner = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === "Ya");
  const matches = [];
  const visit = node => {
    if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && node.left.text === "se" && ts.isArrowFunction(node.right)) matches.push(node.right);
    ts.forEachChild(node, visit);
  };
  visit(owner); assert.equal(matches.length, 1);
  const forbidden = () => { throw Error("project/chat logout must remain untouched"); };
  const context = vm.createContext({ __azraelBinding: binding, __azraelStore: h.store, bt: forbidden, At: forbidden, g: forbidden });
  vm.runInContext(`globalThis.complete=${matches[0].getText(parsed)}`, context);
  await context.complete({ accountId: binding.accountId, serviceKey: binding.key }, "all");
  assert.equal(refreshes, 1);
  await context.complete({ accountId: "chat-account", serviceKey: binding.key }, "all");
  await context.complete({ accountId: binding.accountId, serviceKey: "stale" }, "all");
  assert.equal(refreshes, 1);
});
