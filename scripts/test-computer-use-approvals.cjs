"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createOwner, appKey } = require("./computer-use-approvals.cjs");
const test = require('node:test');
function request(id, app = "Microsoft.WindowsCalculator", persist = ["session", "always"], threadId = "thread-a") {
  return { id, method: "mcpServer/elicitation/request", params: { serverName: "node_repl", threadId, _meta: { connector_id: "computer-use", tool_params: { app }, tool_params_display: [{ name: "app", value: "Calculator" }], persist } } };
}
function probe(owner, req) { let sent, shown; owner.receive(req, (id, result) => { sent = { id, result }; }, value => { shown = value; }); return { sent, shown }; }
function run() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-consent-test-"));
  const file = path.join(home, "azrael/computer-use/app-approvals.json");
  try {
    const a = createOwner(home), b = createOwner(home);
    assert.equal(probe(a, request(1)).shown.id, 1);
    a.response(1, { action: "accept", content: { persist: "always" } });
    assert.equal(probe(b, request(2, "MICROSOFT.WINDOWSCALCULATOR")).sent.result.content.scope, "global");
    assert.equal(a.getAppApprovals().approvedApps[0].displayName, "Calculator");
    probe(a, request(101, undefined, ["session"])); a.response(101, { action: "accept", content: { persist: "session" } });
    assert.equal(a.getAppApprovals().approvedApps.length, 1);
    assert.equal(probe(a, request(3, "other.exe")).shown.id, 3);
    a.response(3, { action: "decline", content: { persist: "always" } });
    probe(a, request(4, "cancel.exe")); a.response(4, { action: "cancel", _meta: { persist: "always" } });
    probe(a, request(5, "disallowed.exe", [])); a.response(5, { action: "accept", content: { persist: "always" } });
    assert.equal(a.getAppApprovals().approvedApps.length, 1);
    assert.ok(probe(a, request(6, undefined, [])).shown);
    assert.equal(probe(a, request(7, "bad\napp")).sent.result.action, "cancel");
    assert.throws(() => appKey(" ")); assert.throws(() => appKey({}));
    const unrelated = request(8); unrelated.params.serverName = "external"; assert.equal(probe(a, unrelated).shown, unrelated);
    const ordinary = request(9); ordinary.params._meta.connector_id = "other"; assert.equal(probe(a, ordinary).shown, ordinary);
    probe(a, request(10, "session.exe")); a.response(10, { action: "accept", _meta: { persist: "session" } });
    assert.equal(probe(a, request(11, "session.exe", ["session"])).sent.result.content.scope, "session");
    assert.ok(probe(createOwner(home), request(111, "session.exe", ["session"])).shown);
    assert.equal(probe(a, request({}, "session.exe")).sent.result.action, "cancel");
    assert.ok(probe(a, request(12, "session.exe", ["session"], "thread-b")).shown);
    assert.ok(probe(a, request(13, "session.exe", [])).shown);
    b.removeAppApproval("microsoft.windowscalculator");
    assert.equal(probe(a, request(14, "session.exe", ["session"])).sent.result.content.scope, "session");
    assert.ok(probe(a, request(15)).shown);
    probe(a, request(16, "late.exe")); a.stop("thread-a");
    assert.equal(a.response(16, { action: "accept", content: { persist: "always" } }).action, "cancel");
    probe(a, request(17, "fatal.exe")); a.reset(); assert.equal(a.response(17, { action: "accept", content: { persist: "always" } }).action, "cancel");
    probe(a, request(18, "session.exe")); a.response(18, { action: "accept", content: { persist: "session" } });
    a.notification("turn/completed", { threadId: "thread-a" });
    a.outgoing("turn/start", { threadId: "thread-a" });
    assert.equal(probe(a, request(19, "session.exe")).sent.result.content.scope, "session");
    assert.ok(a.getAppApprovals().approvedApps.some(app => app.bundleIdentifier === "session.exe" && app.displayName === "Calculator"));
    probe(a, request(20, "lock.exe")); fs.writeFileSync(file + ".lock", "");
    assert.equal(a.response(20, { action: "accept", content: { persist: "always" } }).action, "cancel"); fs.unlinkSync(file + ".lock");
    probe(a, request(21, "revoked-pending.exe"));
    probe(a, request(210, "unrelated-pending.exe"));
    b.removeAppApproval("revoked-pending.exe");
    assert.equal(a.response(21, { action: "accept", content: { persist: "always" } }).action, "cancel");
    assert.equal(a.response(210, { action: "accept", content: { persist: "always" } }).action, "accept");
    assert.ok(a.getAppApprovals().approvedApps.some(app => app.bundleIdentifier === "unrelated-pending.exe"));
    probe(b, request(211, "session.exe")); b.response(211, { action: "accept", content: { persist: "session" } });
    probe(a, request(212, "second-session.exe")); a.response(212, { action: "accept", content: { persist: "session" } });
    b.removeAppApproval("session.exe");
    assert.ok(probe(a, request(213, "session.exe")).shown);
    assert.equal(probe(a, request(214, "second-session.exe")).sent.result.content.scope, "session");
    assert.ok(!b.getAppApprovals().approvedApps.some(app => app.bundleIdentifier === "session.exe"));
    a.removeAppApproval("second-session.exe");
    assert.ok(!a.getAppApprovals().approvedApps.some(app => app.bundleIdentifier === "second-session.exe"));
    probe(a, request(1000, "numeric-id.exe")); probe(a, request("1000", "string-id.exe"));
    a.response(1000, { action: "accept", content: { persist: "always" } });
    a.response("1000", { action: "decline" });
    assert.ok(a.getAppApprovals().approvedApps.some(app => app.bundleIdentifier === "numeric-id.exe"));
    assert.ok(!a.getAppApprovals().approvedApps.some(app => app.bundleIdentifier === "string-id.exe"));
    fs.writeFileSync(file, "corrupt");
    assert.equal(probe(a, request(22)).sent.result.action, "cancel"); assert.throws(() => a.getAppApprovals());
    assert.equal(createOwner(home).response(23, { action: "cancel" }).action, "cancel");
    console.log("PASS persisted/session consent, offered scopes, server boundary, revocation, late stop/fatal, corruption and write lock failure");
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}
module.exports = { request, probe };
if (require.main === module) test("computer-use grants, scoped revocation and fail-closed boundaries", run);
