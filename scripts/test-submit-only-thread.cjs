"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { test } = require("node:test");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { ASSET, MARKER, ORIGINAL, PATCHED, injectSubmitOnlyThread } = require("./inject-submit-only-thread.cjs");
const root = process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve("artifacts/upstream-ui/26.1007.21434");
const pristine = fs.readFileSync(path.join(root, ASSET), "utf8");
const transformed = injectSubmitOnlyThread(pristine, ASSET);

function creationMethods(source) {
  const ast = ts.createSourceFile(ASSET, source, 99, true, 1);
  assert.equal(ast.parseDiagnostics.length, 0);
  let owner;
  function visit(node) {
    if (ts.isClassExpression(node) && node.members.some(m => m.name?.getText(ast) === "prewarmConversation" && m.getText(ast).startsWith("prewarmConversation(e,t){"))) {
      assert.equal(owner, undefined, "one shared creation owner");
      owner = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);

  return new Map(owner.members.filter(m => ts.isMethodDeclaration(m)).map(m => [m.name.getText(ast), m.getText(ast)]));
}
const baseline = creationMethods(pristine);
const patched = creationMethods(transformed.text);

function fixture(methods = patched, { failure, cloud = false } = {}) {
  const calls = [], conversations = new Map();
  const response = { thread: { id: "submitted", cwd: "project-a", modelProvider: "openai", historyMode: "paginated", gitInfo: {} }, model: "model-b", cwd: "project-a" };
  const requestClient = {
    async prewarmThreadStart(request) { calls.push(["prewarm", request]); return response; },
    async sendRequest(method, request, options) {
      calls.push([method, request, options]);
      if (failure) throw failure;
      return response;
    },
  };
  const params = {
    hostId: "local", requestClient, logger: { info() {}, warning() {}, error() {} },
    usePaginatedThreadHistory: () => true, setThreadReferencesSupported() {},
    prewarmedThreadManager: {
      hasPrewarmedThread: () => false,
      setPrewarmedThreadPromise() { calls.push(["retainPrewarm"]); },
    },
    threadStore: {
      getConversation: id => conversations.get(id),
      updateConversationState: (id, update) => update(conversations.get(id)),
      ensureRecentConversationId: id => calls.push(["recent", id]),
    },
    setConversation: value => conversations.set(value.id, value),
    initializationCapabilities: {},
  };
  const start = inputs => ({ request: { model: inputs.model, config: inputs.config, cwd: "project-a", historyMode: "paginated" }, method: "thread/start", options: { source: "submit" } });
  const context = vm.createContext({
    Symbol, Promise, Date, Error,
    N1: class {
      constructor({ inputs }) { this.inputs = inputs; }
      async preparePrewarm() { return { start: start(this.inputs) }; }
      async prepareConversation() {
        return { canUsePrewarmedThread: true, ephemeral: false, permissionsConfig: {}, initialization: {}, serviceTier: "priority",
          acceptedThread: { fixedCwd: "project-a", workspaceKind: "project", threadSettingsSummary: {} },
          prepareStart: async () => start(this.inputs) };
      }
    },
    B: id => id, ln: () => false, Ft: class extends Error {}, SQ: () => false,
    v1: () => ({}), v$: () => ({ createdAt: 1, updatedAt: 1 }), b$: () => ({}), r$: () => null,
    kr: value => value, q$: (conversation, settings) => { conversation.latestThreadSettings = settings; },
    gTn: () => ({}), _Tn: () => ({}), KAn: async () => ({ response, permissionsConfig: {} }),
  });
  const owner = vm.runInContext(`new class { constructor(params){this.params=params} ${["prewarmConversation", "prepareThreadStart", "createConversation", "getRequestedThreadHistoryMode"].map(key => methods.get(key)).join(" ")} }(globalThis.params)`, Object.assign(context, { params }));
  let inputs = { model: "model-a", config: { approval_policy: "on-request" } }, releases = 0;
  const reader = async () => { calls.push(["readInputs"]); return { ...inputs, [Symbol.dispose]: () => { releases++; } }; };
  reader[Symbol.dispose] = () => { releases++; };
  const args = { cwd: "project-a", workspaceRoots: ["project-a"], cloudThreadPrototype: cloud };
  return { owner, calls, conversations, reader, args, releases: () => releases, editInputs(value) { inputs = value; } };
}

test("guarded transform is idempotent and rejects pinned drift or partial injection", () => {

  assert.equal(injectSubmitOnlyThread(transformed.text, ASSET).text, transformed.text);
  assert.equal(injectSubmitOnlyThread("unrelated", "other.js").text, "unrelated");
  for (const damaged of ["", pristine + ORIGINAL, pristine.replace(ORIGINAL, ORIGINAL.replace("let n=", "let z=")), pristine + MARKER,
    transformed.text + MARKER, transformed.text.replace(PATCHED, ""), transformed.text + PATCHED]) {
    assert.throws(() => injectSubmitOnlyThread(damaged, ASSET), /anchor|Damaged/);
  }
});

test("native baseline prewarming creates a thread without submission", async () => {
  const f = fixture(baseline);
  assert.equal((await f.owner.prewarmConversation(f.args, f.reader)).thread.id, "submitted");
  assert.equal(f.calls.filter(([method]) => method === "prewarm").length, 1);
});

for (const cloud of [false, true]) test(`draft activity cannot create a ${cloud ? "cloud-prototype" : "local"} thread or retain prewarm state`, async () => {
  const f = fixture(patched, { cloud });
  for (const event of ["input", "paste", "clear", "attachment", "model", "navigate", "restore"]) {
    assert.equal(await f.owner.prewarmConversation({ ...f.args, event }, f.reader), null);
  }
  assert.deepEqual(f.calls, []);
  assert.equal(f.releases(), 7, "unused readers release their own resources");
  assert.equal(f.conversations.size, 0);
});

test("native first-send creation remains intact and uses settings read at submission", async () => {
  const f = fixture();
  await f.owner.prewarmConversation(f.args, f.reader);
  f.editInputs({ model: "model-b", config: { approval_policy: "never" } });
  const accepted = [];
  const result = await f.owner.createConversation(f.args, f.reader, undefined, id => accepted.push(id));
  const starts = f.calls.filter(([method]) => method === "thread/start");
  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0][1], { model: "model-b", config: { approval_policy: "never" }, cwd: "project-a", historyMode: "paginated" });
  assert.equal(result.conversationId, "submitted");
  assert.equal(result.initializationError, null);
  assert.deepEqual(accepted, ["submitted"]);
  assert.deepEqual(f.calls.at(-1), ["recent", "submitted"]);
  assert.equal(f.conversations.get("submitted").resumeState, "resumed");
});

test("native start failure propagates without an automatic retry or saved conversation", async () => {
  const failure = new Error("start rejected"), f = fixture(patched, { failure });
  await assert.rejects(f.owner.createConversation(f.args, f.reader), error => error === failure);
  assert.equal(f.calls.filter(([method]) => method === "thread/start").length, 1);
  assert.equal(f.conversations.size, 0);
});

test("unknown delivery keeps its native callback and cannot trigger an implicit retry", async () => {
  const failure = new Error("outcome unknown"), f = fixture(patched, { failure });
  const onUnknown = () => {};
  await assert.rejects(f.owner.createConversation(f.args, f.reader, onUnknown));
  const starts = f.calls.filter(([method]) => method === "thread/start");
  assert.equal(starts.length, 1);
  assert.equal(starts[0][2].onOutcomeUnknown, onUnknown);
});

test("normal creation and preparation methods are byte-identical to upstream", () => {
  for (const [name, method] of baseline) if (name !== "prewarmConversation") assert.equal(patched.get(name), method, name);
});

test("production pipeline reports the boundary and binds it to its asset fingerprint", () => {
  const { getTransformRules, getAssetTransformRules } = require("./namespace-azrael-host.cjs");

  const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "inject-submit-only-thread.cjs"))).digest("hex");
  assert.equal(getTransformRules()["inject-submit-only-thread.cjs"], hash);
  assert.equal(getAssetTransformRules(ASSET)["inject-submit-only-thread.cjs"], hash);
  assert.equal(getAssetTransformRules("out/extension.js")["inject-submit-only-thread.cjs"], undefined);
});
