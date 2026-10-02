"use strict";
// Offline VM execution of the pinned native host handler and UI response parser.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const test = require("node:test");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { ANCHOR, NORMALIZED_ANCHOR, MARKER, injectFetchResponse } = require("./inject-fetch-response.cjs");
const pinnedRoot = process.env.AZRAEL_PINNED_HOST_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.928.31416");
const hostFilename = path.join(pinnedRoot, "out/extension.js");
const original = fs.readFileSync(hostFilename, "utf8");
const patched = injectFetchResponse(original).text;

function extract(source, filename, predicates) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, `Invalid JavaScript: ${filename}`);
  const matches = predicates.map(() => []);
  function visit(node) {
    predicates.forEach((predicate, index) => { if (predicate(node, ast)) matches[index].push(node); });
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return matches.map(nodes => {
    assert.equal(nodes.length, 1, `Pinned AST target must be unique: ${filename}`);
    return nodes[0].getText(ast);
  });
}
const servicePredicate = (node, ast) => ts.isMethodDeclaration(node) && node.name.getText(ast) === "fetch" && node.body?.getText(ast).includes("bodyJsonString:JSON.stringify(o");
const releasePredicate = (node, ast) => ts.isPropertyAssignment(node) && node.name.getText(ast) === '"queued-follow-up-send-lock-release"';
const [originalService, releaseProperty] = extract(original, hostFilename, [servicePredicate, releasePredicate]);
const [patchedService] = extract(patched, hostFilename, [servicePredicate]);
const webFilename = path.join(pinnedRoot, "webview/assets/app-initial-4bd9e54bcd58.js");
const [responseMethod] = extract(fs.readFileSync(webFilename, "utf8"), webFilename, [
  (node, ast) => ts.isMethodDeclaration(node) && node.name.getText(ast) === "onFetchResponse",
]);

function fixture(service = patchedService) {
  class FetchError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const context = { JSON, Error, Promise, Map, AbortController, i6e: "vscode://", BH: "source", wpe: () => false, Vh: FetchError };
  const run = code => vm.runInNewContext(code, context);
  const host = run(`({${service}})`);
  const ui = run(`({${responseMethod}})`);
  ui.pendingRequests = new Map();
  const signals = [], deleted = [], released = [];
  host.setAbortSignal = (...args) => signals.push(args);
  host.deleteAbortSignal = (...args) => deleted.push(args);
  const releaseOwner = { queuedFollowUpSendLocks: { release: payload => released.push(payload) } };
  // The native route is an arrow closing over the coordinator's this.
  const release = run(`(function(){return (${releaseProperty.slice(releaseProperty.indexOf(":") + 1)});})`).call(releaseOwner);
  const params = { conversationId: "test-conversation", messageId: "test-message", lockId: "test-lock", sent: true };
  host.extensionFetchHandler = { handleVSCodeRequest: (_url, body) => release(body) };
  const request = { url: "vscode://queued-follow-up-send-lock-release", body: JSON.stringify(params), requestId: "test-request", headers: {} };
  async function send(overrides = {}) {
    const packet = await host.fetch({ ...request, ...overrides }, { originWebview: "test-webview" });
    let cleaned = 0;
    const result = new Promise((resolve, reject) => ui.pendingRequests.set(packet.requestId, { resolve, reject, cleanup: () => cleaned++ }));
    ui.onFetchResponse(packet);
    assert.equal(cleaned, 1);
    assert.equal(ui.pendingRequests.size, 0);
    assert.equal(signals.length, deleted.length);
    assert.deepEqual(deleted.at(-1), ["test-request", "test-webview"]);
    return { packet, result };
  }
  return { host, ui, send, released, params };
}

test("native undefined release reproduces parse failure before patch and resolves after patch", async () => {
  const before = fixture(originalService);
  const old = await before.send();
  assert.equal(old.packet.responseType, "success");
  assert.equal(old.packet.bodyJsonString, undefined);
  await assert.rejects(old.result, SyntaxError);
  assert.deepEqual(JSON.parse(JSON.stringify(before.released)), [before.params]);
  const after = fixture();
  const fixed = await after.send();
  assert.equal(fixed.packet.status, 200);
  assert.equal(fixed.packet.bodyJsonString, "null");
  const response = await fixed.result;
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.headers), []);
  assert.equal(response.body, null);
  assert.deepEqual(JSON.parse(JSON.stringify(after.released)), [after.params]);
});

test("null, object and primitive results retain existing JSON serialization", async () => {
  for (const value of [null, { acquired: true, nested: { value: 1 }, omitted: undefined }, [1, null], false, 0, "text"]) {
    const f = fixture();
    f.host.extensionFetchHandler.handleVSCodeRequest = async () => value;
    const { packet, result } = await f.send();
    assert.equal(packet.bodyJsonString, JSON.stringify(value));
    assert.deepEqual((await result).body, JSON.parse(JSON.stringify(value)));
  }
});

test("route exceptions retain host error response, UI rejection and cleanup", async () => {
  for (const failure of [new Error("route failed"), "non-Error failure"]) {
    const f = fixture();
    f.host.extensionFetchHandler.handleVSCodeRequest = async () => { throw failure; };
    const { packet, result } = await f.send();
    assert.equal(packet.responseType, "error");
    assert.equal(packet.status, 433);
    assert.equal(packet.error, failure instanceof Error ? failure.message : "Unknown error");
    await assert.rejects(result, error => error.message === packet.error && error.status === 433);
  }
});

test("circular and throwing serializers remain errors", async () => {
  const circular = {}; circular.self = circular;
  for (const value of [circular, { toJSON() { throw new Error("serializer failed"); } }, 1n]) {
    const f = fixture();
    f.host.extensionFetchHandler.handleVSCodeRequest = async () => value;
    const { packet, result } = await f.send();
    assert.equal(packet.responseType, "error");
    assert.equal(packet.status, 433);
    await assert.rejects(result, error => error.message === packet.error && error.status === 433);
  }
});

test("only undefined route results are normalized, not undefined returned by toJSON", async () => {
  const f = fixture();
  f.host.extensionFetchHandler.handleVSCodeRequest = async () => ({ toJSON: () => undefined });
  const { packet, result } = await f.send();
  assert.equal(packet.responseType, "success");
  assert.equal(packet.bodyJsonString, undefined);
  await assert.rejects(result, SyntaxError);
});

test("malformed request and HTTP guard retain host failures without invoking route", async () => {
  for (const overrides of [{ body: "{" }, { url: "https://example.test/" }]) {
    const f = fixture();
    let calls = 0;
    f.host.extensionFetchHandler.handleVSCodeRequest = async () => { calls++; };
    const { packet, result } = await f.send(overrides);
    assert.equal(calls, 0);
    assert.equal(packet.responseType, "error");
    await assert.rejects(result, error => error.status === 433);
  }
});

test("native UI parser still rejects malformed successful response JSON", async () => {
  const f = fixture();
  const result = new Promise((resolve, reject) => f.ui.pendingRequests.set("malformed", { resolve, reject }));
  f.ui.onFetchResponse({ requestId: "malformed", responseType: "success", status: 200, headers: {}, bodyJsonString: "{" });
  await assert.rejects(result, SyntaxError);
  assert.equal(f.ui.pendingRequests.size, 0);
});

test("transform replaces one pinned serializer and is idempotent", () => {
  const result = injectFetchResponse(original);
  assert.equal(result.count, 1);
  assert.equal(result.text, original.replace(ANCHOR, NORMALIZED_ANCHOR + MARKER));
  assert.deepEqual(injectFetchResponse(result.text), { text: result.text, count: 0 });
});

test("missing, duplicate, mixed, unmarked or drifted serializer envelopes fail closed", () => {
  for (const source of [
    "changed host", original + ANCHOR, original + original, patched + original,
    original.replace(ANCHOR, "bodyJsonString:JSON.stringify(result)"),
    original.replace('requestId:e.requestId,status:200,headers:{},' + ANCHOR, 'requestId:e.requestId,status:201,headers:{},' + ANCHOR),
    patched.replace(MARKER, ""), patched + MARKER,
    patched.replace(NORMALIZED_ANCHOR, ANCHOR),
    patched.replace('requestId:e.requestId,status:200,headers:{},' + NORMALIZED_ANCHOR, 'requestId:e.requestId,status:201,headers:{},' + NORMALIZED_ANCHOR),
  ]) assert.throws(() => injectFetchResponse(source), /Pinned|pinned/);
});

test("combined host pipeline preserves fetch normalization, recovery hooks and cache fingerprint", () => {
  const { transformAsset, getTransformRules } = require("./namespace-azrael-host.cjs");
  const combined = transformAsset(original, "out/extension.js", hostFilename, ts);
  const ast = ts.createSourceFile(hostFilename, combined.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.equal(combined.asset.fetchResponseEdits, 1);
  assert.equal(combined.asset.recoveryEdits, 3);
  assert.equal(combined.text.split(MARKER).length - 1, 1);
  assert.equal(combined.text.split(NORMALIZED_ANCHOR).length - 1, 1);
  assert.equal(combined.text.includes(ANCHOR), false);
  for (const hook of ["dispatch", "observe", "disconnect"]) {
    assert.equal(combined.text.split(`require("./azrael-recovery.cjs").${hook}(`).length - 1, 1);
  }
  const injector = fs.readFileSync(path.join(__dirname, "inject-fetch-response.cjs"));
  assert.equal(getTransformRules()["inject-fetch-response.cjs"], crypto.createHash("sha256").update(injector).digest("hex"));
});
