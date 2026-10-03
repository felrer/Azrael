"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), vm = require("node:vm");
const { injectComputerUse, replacements, MARKER } = require("./inject-computer-use.cjs");
const { createOwner } = require("./computer-use-approvals.cjs");
const { request } = require("./test-computer-use-approvals.cjs");
const test = require('node:test');
async function run() {
  const original = fs.readFileSync(path.join(__dirname, "../artifacts/upstream-ui/26.928.31416/out/extension.js"), "utf8");
  const injected = injectComputerUse(original);
  assert.equal(injected.count, 7); assert.equal(injectComputerUse(injected.text).count, 0);
  new vm.Script(injected.text);
  assert.throws(() => injectComputerUse(original.replace(replacements[0][0], "changed")));
  assert.throws(() => injectComputerUse(original + replacements[0][0]));
  assert.throws(() => injectComputerUse(injected.text.replace(replacements[1][1], "changed")));
  assert.throws(() => injectComputerUse(original + MARKER));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-injection-test-"));
  try {
    const owner = createOwner(home), sent = [], shown = [], outbound = [];
    const context = vm.createContext({ require: name => { assert.equal(name, "./computer-use-approvals.cjs"); return owner; }, ut: class {}, bR: "provider" });
    context.host = { codexMcpConnection: { sendResponse: (id, result) => sent.push({ id, result }), sendRequest: (...args) => outbound.push(args) }, broadcastToAllViews: value => shown.push(value), pendingMcpRequests: new Map(), sendInternalAppServerRequest: (...args) => outbound.push(args) };
    // Evaluate the exact transformed handlers obtained from the full pinned bundle.
    const onRequest = replacements[0][1];
    vm.runInContext(`host.receive=function(){return ({${onRequest}}).onRequest}.call(host)`, context);
    vm.runInContext(`host.respond=function(r){switch(r.type){${replacements[1][1]}}}`, context);
    vm.runInContext(`host.outgoing=function(r,e){switch(r.type){case "mcp-request":{${replacements[2][1]}}}}`, context);
    vm.runInContext(`host.interrupt=function(){return ({${replacements[3][1]}}).interruptTurn}.call(host)`, context);
    const start = injected.text.indexOf("var eF=class extends ut{");
    const end = injected.text.indexOf(";B();", start);
    vm.runInContext(injected.text.slice(start, end) + ";settings=new eF", context);
    context.host.receive(request(1)); assert.equal(shown[0].request.id, 1);
    context.host.respond({ type: "mcp-response", response: { id: 1, result: { action: "accept", content: { persist: "always" } } } });
    context.host.receive(request(2)); assert.equal(sent[1].result.content.scope, "global");
    assert.equal((await context.settings.getAppApprovals()).approvedApps.length, 1);
    assert.equal((await context.settings.removeAppApproval("MICROSOFT.WINDOWSCALCULATOR")).approvedApps.length, 0);
    context.host.receive(request(3, "late.exe")); context.host.interrupt({ threadId: "thread-a", turnId: "turn-1" });
    context.host.respond({ type: "mcp-response", response: { id: 3, result: { action: "accept", content: { persist: "always" } } } });
    assert.equal(sent.at(-1).result.action, "cancel");
    context.host.receive(request(4, "outgoing-late.exe"));
    context.host.outgoing({ type: "mcp-request", request: { id: 9, method: "turn/interrupt", params: { threadId: "thread-a" } } }, {});
    context.host.respond({ type: "mcp-response", response: { id: 4, result: { action: "accept", _meta: { persist: "always" } } } });
    assert.equal(sent.at(-1).result.action, "cancel");
    const unrelated = { id: 90, method: "unrelated", params: { value: "unchanged" } }; context.host.receive(unrelated); assert.equal(shown.at(-1).request, unrelated);
    const ordinary = { action: "accept", content: { x: "unchanged" } }; context.host.respond({ type: "mcp-response", response: { id: 90, result: ordinary } }); assert.equal(sent.at(-1).result, ordinary);
    assert.equal((await context.settings.getAppApprovals()).approvedApps.length, 0);
    console.log("PASS full pinned injection parsing/idempotency/fail-closed anchors and actual transformed request/response/settings/interrupt handlers in VM");
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}
test("pinned computer-use approval injection and transformed host handlers", run);
