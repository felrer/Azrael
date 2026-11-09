"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("../../extensions/azrael-ex/node_modules/typescript");
const { APPS_ASSETS, injectServiceIdentityApps } = require("../service-identity-apps.cjs");
const { createServiceIdentity } = require("../inject-service-auth.cjs");
const { serviceIdentityFixture } = require("./service-identity-fixture.cjs");
const root = process.env.AZRAEL_PRESERVATION_UI_ROOT || path.join(__dirname, "../../artifacts/upstream-ui/26.1007.21434");
const outputs = APPS_ASSETS.map(asset => injectServiceIdentityApps(fs.readFileSync(path.join(root, asset), "utf8"), asset).text);
function functions(text, names, context) {
  const source = ts.createSourceFile("apps.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = new Map();
  for (const node of source.statements) if (ts.isFunctionDeclaration(node) && names.includes(node.name.text)) found.set(node.name.text, node.getText(source));
  assert.equal(found.size, names.length);
  return vm.runInNewContext(`${[...found.values()].join("\n")};({${names.join(",")}})`, context);
}
async function store() {
  let metadata = serviceIdentityFixture("main-a", 1), current = createServiceIdentity();
  await current.attach({ hostId: "local", sendRequest: async () => metadata });
  return { current, switch: async () => { metadata = serviceIdentityFixture("main-b", 2); await current.refresh(); } };
}
function mainOwners(state, overrides = {}) {
  const text = outputs[4], names = ["w_n", "Mkn", "B2r", "V2r", "O_n", "k_n", "__azAppsOriginal_w_n", "__azAppsOriginal_Mkn", "__azAppsOriginal_B2r", "__azAppsOriginal_V2r", "__azAppsOriginal_O_n", "__azAppsOriginal_k_n"];
  const source = ts.createSourceFile("main.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name.text)).map(node => node.getText(source));
  assert.equal(declarations.length, names.length);
  const context = { globalThis: { __azraelServiceIdentityV1: state.current, __azraelServiceMainFacade: { scope: scope => scope } },
    Z_n: ["mcp-settings", "app-connect"], Jp: { FIVE_MINUTES: 300000 }, xk: "OAI-Product-Sku", Ck: () => "CODEX", bu: value => value,
    jkn: ({ accountId, userId }) => ["apps", "accessible-links", accountId, userId], Akn: () => ({}), Lf: () => "chat-account",
    Jgn: () => null, B_n: connector => connector.auth, L_n: () => false, K_n: options => { throw Error("Unexpected browser fallback"); },
    ...overrides };
  return vm.runInNewContext(declarations.join("\n") + text.slice(text.lastIndexOf("\nvar __azAppsQuery=")) + ";({w_n,Mkn,B2r,V2r,O_n,k_n})", context);
}

// Retain actual pinned factories: future UI upgrades must preserve the service
// binding in both detail/MFA lookups and callback publication after switches.
test("pinned Apps transforms parse, reject drift, and compose idempotently", () => {
  outputs.forEach((text, index) => {
    const parsed = ts.createSourceFile("apps.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.deepEqual(parsed.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, " ")), []);
    assert.equal(injectServiceIdentityApps(text, APPS_ASSETS[index]).count, 0);
  });
  assert.throws(() => injectServiceIdentityApps("changed", APPS_ASSETS[0]), /anchor changed/);
});

test("actual connector factories use main identity and isolate delayed A responses from B", async () => {
  const state = await store(), calls = [];
  let resolve;
  const Request = { safeGet: async (url, options) => { calls.push({ url, options }); return await new Promise(done => { resolve = done; }); } };
  const { d, f } = functions(outputs[0], ["d", "f"], { __azAppsStore: state.current, s: { FIVE_MINUTES: 300000 }, c: Request, a: "OAI-Product-Sku" });
  const first = f("connector", "chat-account", "chat-user");
  const pending = first.queryFn({ signal: new AbortController().signal });
  assert.equal(calls[0].options.expectedIdentity.accountId, "workspace-main-a");
  assert.equal(calls[0].options.additionalHeaders["x-azrael-service-revision"], "1");
  const oldKey = JSON.stringify(first.queryKey);
  await state.switch();
  resolve({ requirement: "required" });
  await assert.rejects(pending, { name: "AbortError" });
  const second = f("connector", "chat-account", "chat-user");
  assert.notEqual(JSON.stringify(second.queryKey), oldKey);
  const next = second.queryFn({ signal: new AbortController().signal });
  assert.equal(calls[1].options.expectedIdentity.accountId, "workspace-main-b");
  resolve({ requirement: "suggested" });
  assert.equal(await next, "suggested");
  const tos = d("connector", "CONNECTOR_SETTING");
  const tosPending = tos.queryFn({ signal: new AbortController().signal });
  assert.equal(calls[2].options.additionalHeaders["OAI-Product-Sku"], "CONNECTOR_SETTING");
  resolve({ terms: true });
  assert.equal((await tosPending).terms, true);
});

test("actual modal hook wrappers forbid stale callbacks and automatic mutation replay", async () => {
  const state = await store();
  const module = vm.runInNewContext(outputs[1].slice(outputs[1].indexOf("\nvar __azAppsQuery="), outputs[1].indexOf("\nvar __azAppsStore=")) + ";({__azAppsQuery,__azAppsMutation})", { globalThis: { __azraelServiceIdentityV1: state.current } });
  let resolve, writes = 0, sends = 0;
  const binding = state.current.capture();
  const config = module.__azAppsMutation(value => value, binding, { retry: 3, mutationFn: async () => { sends++; return await new Promise(done => { resolve = done; }); }, onSuccess: () => { writes++; } });
  const pending = config.mutationFn();
  await state.switch(); resolve("A");
  await assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(config.onSuccess("A"), { name: "AbortError" });
  assert.equal(config.retry, false); assert.equal(writes, 0); assert.equal(sends, 1);
  const query = module.__azAppsQuery(value => value, state.current.read(), { queryKey: ["connector"], queryFn: async () => "B" });
  assert.equal(await query.queryFn(), "B");
});

test("actual plugin continuation retains chat widget routing and rejects late service publication", async () => {
  const state = await store(), writes = [], calls = [];
  let receipts = [], resolve;
  const scope = {
    get: atom => atom === "account" ? "chat-account" : atom === "user" ? "chat-user" : receipts,
    set: (atom, ...args) => { if (atom === "receipts") receipts = args[0](receipts); else writes.push(args[0]); }
  };
  const { z } = functions(outputs[3], ["z", "B"], {
    __azAppsStore: state.current, A: host => host === "local", f: "account", l: "user", H: "receipts", V: "widgets",
    b: { safeParse: value => ({ data: value }) }, F: async () => true,
    v: { safePost: async (url, options) => { calls.push({ url, options }); return await new Promise(done => { resolve = done; }); } }, _: "ChatGPT-Account-ID"
  });
  const operation = z(scope, { accountId: "chat-account", userId: "chat-user", hostId: "local", notificationId: "notice", widgetId: "widget", pluginId: "cloud", pluginSuggestionReference: "reference" });
  await new Promise(done => setImmediate(done));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.expectedIdentity.accountId, "workspace-main-a");
  assert.equal(writes[0].accountId, "chat-account");
  assert.equal(writes[0].widgetId, "widget");
  const writeCount = writes.length, receiptCount = receipts.length;
  await state.switch(); resolve({}); await operation;
  assert.equal(writes.length, writeCount); assert.equal(receipts.length, receiptCount);
  assert.equal(calls.length, 1);
  await z(scope, { hostId: "remote" });
  assert.equal(calls.length, 1);
});

test("actual main connector queries pin metadata and finish A without publishing under B", async () => {
  const state = await store(), calls = [];
  let resolve, completed = false;
  const Request = { safeGet: async (url, options) => { calls.push(options); const value = await new Promise(done => { resolve = done; }); completed = true; return value; },
    safePost: async (url, options) => { calls.push(options); return { links: [{ id: "link" }] }; } };
  const owners = mainOwners(state, { D_: Request });
  const query = owners.w_n("connector");
  const pending = query.queryFn({ signal: new AbortController().signal });
  await state.switch(); resolve({ id: "connector" });
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(completed, true);
  assert.equal(calls[0].expectedIdentity.accountId, "workspace-main-a");
  const links = owners.Mkn({ accountId: "chat-account", userId: "chat-user" });
  assert.notEqual(JSON.stringify(links.queryKey), JSON.stringify(query.queryKey));
  assert.equal((await links.queryFn({ signal: new AbortController().signal }))[0].id, "link");
  assert.equal(calls[1].expectedIdentity.accountId, "workspace-main-b");
});

test("actual connect API-key operation completes network A, discards stale result and never replays", async () => {
  const state = await store(), calls = [];
  let resolve, completed = false;
  const owners = mainOwners(state, { D_: { safePost: async (url, options) => { calls.push({ url, options }); const result = await new Promise(done => { resolve = done; }); completed = true; return result; } } });
  const controller = new AbortController();
  const pending = owners.O_n({ scope: {}, app: { id: "connector" }, connector: { id: "connector", name: "Connector", auth: "API_KEY" }, apiKey: "synthetic", signal: controller.signal, expectedIdentity: { accountId: "chat-account", userId: "chat-user" } });
  assert.equal(calls[0].options.expectedIdentity.accountId, "workspace-main-a");
  await state.switch();
  assert.equal(controller.signal.aborted, false);
  resolve({ id: "link-a" });
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(completed, true); assert.equal(calls.length, 1);
});
