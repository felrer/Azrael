"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), Kd = require("node:os"), vm = require("node:vm");
const { injectComputerUse, injectComputerUseSettings, injectComputerUseCancelRequest, injectComputerUseManagement,
  COMPUTER_USE_SETTINGS_ASSET, COMPUTER_USE_APPROVAL_CARD_ASSET, COMPUTER_USE_MANAGEMENT_ASSET,
  MANAGEMENT_MARKER, managementReplacements,
  SETTINGS_MARKER, SETTINGS_ANCHOR, SETTINGS_REPLACEMENT, CANCEL_MARKER, CANCEL_ANCHOR, CANCEL_REPLACEMENT,
  replacements, MARKER } = require("./inject-computer-use.cjs");
const { createOwner } = require("./computer-use-approvals.cjs");
const { injectWindowControl } = require("./inject-window-control.cjs");
const { request } = require("./test-computer-use-approvals.cjs");
const test = require('node:test');
function assetRules(transformer, asset, rules = transformer.getTransformRules()) {
  return typeof transformer.getAssetTransformRules === "function" ? transformer.getAssetTransformRules(asset, rules) : rules;
}
async function run() {
  const original = fs.readFileSync(path.join(__dirname, "../artifacts/upstream-ui/26.930.61225/out/extension.js"), "utf8");
  const injected = injectComputerUse(original);
  assert.equal(injected.count, 7); assert.equal(injectComputerUse(injected.text).count, 0);
  new vm.Script(injected.text);
  assert.throws(() => injectComputerUse(original.replace(replacements[0][0], "changed")));
  assert.throws(() => injectComputerUse(original + replacements[0][0]));
  assert.throws(() => injectComputerUse(injected.text.replace(replacements[1][1], "changed")));
  assert.throws(() => injectComputerUse(original + MARKER));
  const home = fs.mkdtempSync(path.join(Kd.tmpdir(), "azrael-injection-test-"));
  try {
    const owner = createOwner(home), sent = [], shown = [], outbound = [];
    const registered = [];
    const context = vm.createContext({ require: name => { if(name === "./window-control-host.cjs")return {registerApprovalUI(native,publish){registered.push({native,publish});},respondApproval(native,id,result){return String(id).startsWith("azrael-window-consent-");}}; assert.equal(name, "./computer-use-approvals.cjs"); return owner; }, ut: class {}, bR: "provider" });
    context.host = { codexMcpConnection: { sendResponse: (id, result) => sent.push({ id, result }), sendRequest: (...args) => outbound.push(args) }, broadcastToAllViews: value => shown.push(value), pendingMcpRequests: new Map(), sendInternalAppServerRequest: (...args) => outbound.push(args) };
    // Evaluate the exact transformed handlers obtained from the full pinned bundle.
    const onRequest = replacements[0][1];
    vm.runInContext(`host.receive=function(){return ({${onRequest}}).onRequest}.call(host)`, context);
    vm.runInContext(`host.respond=function(r){switch(r.type){${replacements[1][1]}}}`, context);
    vm.runInContext(`host.outgoing=function(r,e){switch(r.type){case "mcp-request":{${replacements[2][1]}}}}`, context);
    vm.runInContext(`host.interrupt=function(){return ({${replacements[3][1]}}).interruptTurn}.call(host)`, context);
    const vp = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
    const hostAst = vp.createSourceFile("extension.js", injected.text, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS);
    const settingsOwners = [];
    function findSettingsOwner(node) {
      if (vp.isVariableDeclaration(node) && node.name?.text === "YN" && vp.isClassExpression(node.initializer)) settingsOwners.push(node);
      vp.forEachChild(node, findSettingsOwner);
    }
    findSettingsOwner(hostAst);
    assert.equal(settingsOwners.length, 1, "pinned computer-use settings class is unique");
    vm.runInContext("var " + settingsOwners[0].getText(hostAst) + ";settings=new YN", context);
    context.host.receive(request(1)); assert.equal(registered[0].native,context.host.codexMcpConnection);registered[0].publish({type:"fixture"});assert.equal(shown.pop().type,"fixture"); assert.equal(shown[0].request.id, 1);
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
    const sentBefore=sent.length;context.host.respond({type:"mcp-response",response:{id:"azrael-window-consent-fixture",result:{action:"accept"}}});assert.equal(sent.length,sentBefore,"local Window Use response never reaches native engine");
    assert(registered.length>=2,"outgoing requests bind publication before native send");assert(registered.every(entry=>entry.publish===registered[0].publish),"publication callback stays stable on repeated binding");
    assert.equal((await context.settings.getAppApprovals()).approvedApps.length, 0);
    console.log("PASS full pinned injection parsing/idempotency/fail-closed anchors and actual transformed request/response/settings/interrupt handlers in VM");
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}
test("pinned computer-use approval injection and transformed host handlers", run);

test("pinned computer-use settings visibility preserves eligibility, navigation and redirects", () => {
  const original = fs.readFileSync(path.join(__dirname, "../artifacts/upstream-ui/26.930.61225", COMPUTER_USE_SETTINGS_ASSET), "utf8");
  const injected = injectComputerUseSettings(original, COMPUTER_USE_SETTINGS_ASSET);
  assert.equal(injected.count, 1);
  assert.deepEqual(injectComputerUseSettings(injected.text, COMPUTER_USE_SETTINGS_ASSET), { text: injected.text, count: 0 });
  // Exact reversal proves every other branch, gate, component and feature flag stays unchanged.
  assert.equal(injected.text.replace(SETTINGS_REPLACEMENT, SETTINGS_ANCHOR), original);
  for (const asset of ["out/extension.js", "webview/assets/other.js", COMPUTER_USE_SETTINGS_ASSET + ".map"]) {
    assert.deepEqual(injectComputerUseSettings(original, asset), { text: original, count: 0 });
  }
  const invalid = [
    original.replace(SETTINGS_ANCHOR, "changed"), original + SETTINGS_ANCHOR,
    original + 'case`computer-use`:return{visible:!0,pending:!1};',
    original + SETTINGS_MARKER, injected.text + SETTINGS_MARKER,
    injected.text + SETTINGS_REPLACEMENT, injected.text + SETTINGS_ANCHOR,
    injected.text.replace(SETTINGS_REPLACEMENT, SETTINGS_MARKER),
    injected.text.replace('case`computer-use`:return{visible:!0,pending:!1};', SETTINGS_ANCHOR),
    injected.text.replace('case`computer-use`:return{visible:!0,pending:!1};', 'case`computer-use`:return{visible:!0,pending:!0};'),
    injected.text.replace(SETTINGS_MARKER, ""),
  ];
  for (const source of invalid) assert.throws(() => injectComputerUseSettings(source, COMPUTER_USE_SETTINGS_ASSET));

  const vp = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
  const parsed = vp.createSourceFile(COMPUTER_USE_SETTINGS_ASSET, injected.text, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS);
  assert.equal(parsed.parseDiagnostics.length, 0);
  const transformer = require("./namespace-azrael-host.cjs");
  const transformed = transformer.transformAsset(original, COMPUTER_USE_SETTINGS_ASSET, COMPUTER_USE_SETTINGS_ASSET, vp);
  assert.equal(transformed.asset.computerUseSettingsEdits, 1);
  assert.equal(transformed.asset.computerUseApprovalEdits, 0);
  assert.equal(transformed.asset.path, COMPUTER_USE_SETTINGS_ASSET);
  assert(transformed.text.includes(SETTINGS_REPLACEMENT));
  const crypto = require("node:crypto");
  const sha = value => crypto.createHash("sha256").update(value).digest("hex");
  const namespaced = transformer.rewriteJavaScript(original, COMPUTER_USE_SETTINGS_ASSET, vp);
  const { injectInstructionSettings } = require("./inject-instruction-settings.cjs");
  const instructions = injectInstructionSettings(namespaced.text, COMPUTER_USE_SETTINGS_ASSET);
  const { injectPetsCleanup } = require("./inject-pets-cleanup.cjs");
  const { injectStudentDesign } = require("./inject-student-design.cjs");
  const design = injectStudentDesign(instructions.text, COMPUTER_USE_SETTINGS_ASSET, vp);
  const pets = injectPetsCleanup(design.text, COMPUTER_USE_SETTINGS_ASSET, vp);
  // Other owned transforms remain in the baseline when reversing only computer-use.
  assert.equal(sha(transformed.text.replace(SETTINGS_REPLACEMENT, SETTINGS_ANCHOR)), sha(pets.text));
  assert.equal(transformed.asset.petsCleanupEdits, pets.count);
  assert.equal(transformed.asset.edits, namespaced.count + instructions.count + design.count + pets.count + 1);
  assert.equal(transformed.asset.sourceSha256, sha(original));
  assert.equal(transformed.asset.sha256, sha(transformed.text));
  const rules = transformer.getTransformRules();
  const settingsRules = assetRules(transformer, COMPUTER_USE_SETTINGS_ASSET, rules);
  assert.equal(settingsRules["inject-computer-use.cjs"], sha(fs.readFileSync(path.join(__dirname, "inject-computer-use.cjs"))));
  const changedRules = assetRules(transformer, COMPUTER_USE_SETTINGS_ASSET,
    { ...rules, "inject-computer-use.cjs": "0".repeat(64) });
  const ruleKey = value => sha(JSON.stringify(Object.entries(value).sort(([o], [b]) => o.localeCompare(b))));
  assert.notEqual(ruleKey(settingsRules), ruleKey(changedRules), "injector changes must invalidate the settings asset cache key");

  function inspect(source, eligible, selected = "computer-use") {
    // Run the real hook's visibility/eligibility/selection/navigation tail. Hook data
    // acquisition above it is replaced by controlled inputs; the tail is not reimplemented.
    const functionStart = source.indexOf("function ga(e,t,n){");
    const tailStart = source.indexOf('let L=ce===`loading`', functionStart);
    const tailEnd = source.indexOf("}function _a(e)", tailStart);
    assert(functionStart >= 0 && tailStart > functionStart && tailEnd > tailStart);
    const helpersEnd = source.indexOf("var xa,Sa;", tailEnd);
    const helpers = source.slice(tailEnd + 1, helpersEnd);
    const gateStart = source.indexOf("Sa={", helpersEnd) + 3;
    const gateEnd = source.indexOf("}})))()}", gateStart) + 1;
    assert(gateStart > helpersEnd && gateEnd > gateStart);
    const context = { ce: "denied", i: selected, r: Array(50).fill(Symbol.for("react.memo_cache_sentinel")),
      bt: ["general-settings", "computer-use", "browser-use", "mcp-settings"].map(slug => ({ slug })),
      be: { codexOrWorkLocal: eligible }, M: false, u: false, Ae: false, F: "free", Tt: { ENT26: "enterprise" },
      Zr: () => false, nt: "general-settings" };
    return JSON.parse(JSON.stringify(vm.runInNewContext(
      `var Sa=${source.slice(gateStart, gateEnd)};${helpers};function inspect(){${source.slice(tailStart, tailEnd)}};inspect()`, context)));
  }
  const before = inspect(original, true);
  assert.equal(before.activeSettingsSection, "general-settings");
  assert.equal(before.shouldRedirectToVisibleSettingsSection, true);
  const enabled = inspect(transformed.text, true);
  assert(enabled.visibleSettingsSections.some(section => section.slug === "computer-use"));
  assert(enabled.settingsNavigationSections.some(section => section.slug === "computer-use"));
  assert.equal(enabled.activeSettingsSection, "computer-use");
  assert.equal(enabled.shouldRedirectToVisibleSettingsSection, false);
  assert.equal(enabled.shouldRenderRouteContent, true);
  assert.deepEqual(enabled.visibleSettingsSections.filter(section => section.slug !== "computer-use"), before.visibleSettingsSections);
  const ineligible = inspect(transformed.text, false);
  assert(!ineligible.visibleSettingsSections.some(section => section.slug === "computer-use"));
  assert(!ineligible.settingsNavigationSections.some(section => section.slug === "computer-use"));
  assert.equal(ineligible.activeSettingsSection, "general-settings");
  assert.equal(ineligible.shouldRedirectToVisibleSettingsSection, true);
  assert.deepEqual(inspect(transformed.text, true, "browser-use").activeSettingsSection, "general-settings");
  console.log("PASS actual pinned settings branch, exact path/marker guards, namespace provenance/cache invalidation and native visibility/eligibility/navigation/redirect semantics");
});

test("pinned computer-use approval card cancels the request through the native response closure", async () => {
  const original = fs.readFileSync(path.join(__dirname, "../artifacts/upstream-ui/26.930.61225", COMPUTER_USE_APPROVAL_CARD_ASSET), "utf8");
  const injected = injectComputerUseCancelRequest(original, COMPUTER_USE_APPROVAL_CARD_ASSET);
  assert.equal(injected.count, 1);
  assert.deepEqual(injectComputerUseCancelRequest(injected.text, COMPUTER_USE_APPROVAL_CARD_ASSET), { text: injected.text, count: 0 });
  assert.equal(injected.text.replace(CANCEL_REPLACEMENT, CANCEL_ANCHOR), original,
    "native response closure, approve/deny actions and memo slots must remain unchanged");
  for (const asset of [COMPUTER_USE_SETTINGS_ASSET, "webview/assets/other.js", COMPUTER_USE_APPROVAL_CARD_ASSET + ".map"]) {
    assert.deepEqual(injectComputerUseCancelRequest(original, asset), { text: original, count: 0 });
  }
  for (const text of [original.replace(CANCEL_ANCHOR, "changed"), original + CANCEL_ANCHOR,
    original + CANCEL_MARKER, injected.text + CANCEL_MARKER, injected.text + CANCEL_ANCHOR,
    injected.text + CANCEL_REPLACEMENT, injected.text.replace(CANCEL_REPLACEMENT, CANCEL_MARKER),
    injected.text.replace("onClick:()=>F(`cancel`)", "onClick:()=>F(`decline`)"),
    injected.text.replace("disabled:z", "disabled:!1"), injected.text.replace(CANCEL_MARKER, "")]) {
    assert.throws(() => injectComputerUseCancelRequest(text, COMPUTER_USE_APPROVAL_CARD_ASSET));
  }
  const vp = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
  assert.equal(vp.createSourceFile(COMPUTER_USE_APPROVAL_CARD_ASSET, injected.text, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS).parseDiagnostics.length, 0);
  const transformer = require("./namespace-azrael-host.cjs");
  const transformed = transformer.transformAsset(original, COMPUTER_USE_APPROVAL_CARD_ASSET, COMPUTER_USE_APPROVAL_CARD_ASSET, vp);
  assert.equal(transformed.asset.windowApprovalTitleEdits,1);
  assert.equal(transformed.asset.computerUseCancelRequestEdits, 1);
  assert.equal(transformed.asset.computerUseSettingsEdits, 0);
  assert(transformed.text.includes(CANCEL_REPLACEMENT));
  let reversedTitle=transformed.text;for(const [before,after] of require("./inject-computer-use.cjs").windowTitleReplacements)reversedTitle=reversedTitle.replace(after,before);
  assert.equal(reversedTitle.replace(CANCEL_REPLACEMENT, CANCEL_ANCHOR), transformer.rewriteJavaScript(original, COMPUTER_USE_APPROVAL_CARD_ASSET, vp).text);
  const crypto = require("node:crypto");
  const sha = value => crypto.createHash("sha256").update(value).digest("hex");
  const rules = transformer.getTransformRules();
  const cardRules = assetRules(transformer, COMPUTER_USE_APPROVAL_CARD_ASSET, rules);
  assert.equal(cardRules["inject-computer-use.cjs"], sha(fs.readFileSync(path.join(__dirname, "inject-computer-use.cjs"))));
  const changedRules = assetRules(transformer, COMPUTER_USE_APPROVAL_CARD_ASSET,
    { ...rules, "inject-computer-use.cjs": "0".repeat(64) });
  const ruleKey = value => sha(JSON.stringify(Object.entries(value).sort(([o], [b]) => o.localeCompare(b))));
  assert.notEqual(ruleKey(cardRules), ruleKey(changedRules), "injector changes must invalidate the approval card cache key");

  const cardAst = vp.createSourceFile("approval-card.js", transformed.text, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS);
  const cardOwners = cardAst.statements.filter(node => vp.isFunctionDeclaration(node) && node.name?.text === "E");
  assert.equal(cardOwners.length, 1, "unique native approval card renderer");
  const cardSource = cardOwners[0].getText(cardAst);
  const home = fs.mkdtempSync(path.join(Kd.tmpdir(), "azrael-cancel-card-test-"));
  try {
    const owner = createOwner(home);
    function harness(id, app) {
      let state = null, finish;
      const ref = { current: null }, memo = Array(42).fill(Symbol.for("react.memo_cache_sentinel"));
      const sent = [], settled = [], wire = [], flags = [];
      owner.receive(request(id, app), () => assert.fail("unexpected automatic approval"), () => {});
      const pending = new Promise(resolve => { finish = resolve; });
      const jsx = (type, props) => ({ type, props });
      const _ = { set: (...args) => flags.push(args) };
      const context = { D: { c: () => memo }, O: { useRef: () => ref, useState: () => [state, value => { state = value; }] },
        k: { jsx, jsxs: jsx, Fragment: "fragment" }, c: "localized-label", i: () => _, C: "owner", s: () => ({ formatMessage: descriptor => descriptor.defaultMessage }),
        r: () => false, v: "has-approved", y: () => false, w: "plugin-icon", h: "icon", d: "risk-icon",
        f: (action, content) => { wire.push({ action, content }); return { action, content }; },
        m: () => ({ replyWithMcpServerElicitationResponse: (threadId, requestId, response) => {
          sent.push({ threadId, requestId, response: owner.response(requestId, response) }); return pending;
        } }),
        props: { ApprovalCard: "approval-card", conversationId: "thread-a", hostId: "local", requestId: id,
          request: { riskLevel: "low", connectorName: "Computer Use", appDisplayName: app, persistModes: ["session", "always"] },
          onRequestSettled: action => settled.push(action) } };
      const vmContext = vm.createContext(context);
      vm.runInContext(cardSource, vmContext);
      return { render: () => vm.runInContext("E(props)", vmContext).props, finish, sent, settled, wire, flags };
    }
    const cancel = harness(201, "cancel-card.exe");
    const card = cancel.render();
    assert.equal(card.body.type, "button");
    assert.equal(card.body.props.type, "button");
    assert.equal(card.body.props.disabled, false);
    assert.equal(card.body.props.children.type, "localized-label", "cancel uses the native localized label component");
    assert.equal(card.body.props.children.props.id, "azrael.computerUse.cancelRequest");
    assert.equal(card.body.props.children.props.defaultMessage, "Cancel request");
    card.body.props.onClick();
    assert.deepEqual(cancel.wire, [{ action: "cancel", content: null }]);
    assert.equal(cancel.sent[0].response.action, "cancel");
    assert.equal(cancel.sent[0].requestId, 201);
    assert.equal(cancel.sent[0].threadId, "thread-a");
    assert.equal(cancel.flags.length, 0);
    const submitting = cancel.render();
    assert.equal(submitting.body.props.disabled, true);
    assert.equal(submitting.actions.isLoading, true);
    submitting.body.props.onClick();
    assert.equal(cancel.sent.length, 1, "native in-flight response guard must prevent duplicate cancellation");
    assert.equal(owner.getAppApprovals().approvedApps.length, 0);
    assert(!fs.existsSync(path.join(home, "azrael/computer-use/app-approvals.json")));
    cancel.finish(); await Promise.resolve();
    assert.deepEqual(cancel.settled, ["cancel"]);
    let reshown = false;
    owner.receive(request(202, "cancel-card.exe"), () => assert.fail("cancel must not grant access"), () => { reshown = true; });
    assert(reshown);

    const deny = harness(203, "deny-card.exe");
    deny.render().actions.onDeny();
    assert.deepEqual(deny.wire, [{ action: "decline", content: null }]);
    deny.finish(); await Promise.resolve(); assert.deepEqual(deny.settled, ["decline"]);
    const approve = harness(204, "approve-card.exe");
    approve.render().actions.onApprove();
    assert.equal(approve.wire[0].action, "accept");
    assert.equal(approve.wire[0].content.persist, "session");
    approve.finish(); await Promise.resolve(); assert.deepEqual(approve.settled, ["accept"]);
    const always = harness(205, "always-card.exe");
    always.render().actions.leadingAction.onClick();
    assert.equal(always.wire[0].action, "accept");
    assert.equal(always.wire[0].content.persist, "always");
    always.finish(); await Promise.resolve(); assert.deepEqual(always.settled, ["accept"]);
    assert(owner.getAppApprovals().approvedApps.some(app => app.bundleIdentifier === "always-card.exe"));
    console.log("PASS pinned native card cancel/disabled/settlement/no persistence and unchanged deny/session/always approval actions");
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("local Windows approval management preserves native execution gates and memo correctness", async () => {
  const root = path.join(__dirname, "../artifacts/upstream-ui/26.930.61225");
  const original = fs.readFileSync(path.join(root, COMPUTER_USE_MANAGEMENT_ASSET), "utf8");
  const injected = injectComputerUseManagement(original, COMPUTER_USE_MANAGEMENT_ASSET);
  assert.equal(injected.count, 1);
  assert.deepEqual(injectComputerUseManagement(injected.text, COMPUTER_USE_MANAGEMENT_ASSET), { text: injected.text, count: 0 });
  let restored = injected.text;
  for (const [before, after] of [...managementReplacements].reverse()) restored = restored.replace(after, before);
  assert.equal(restored, original, "all native hooks, plugin/browser/locked gates and query/revoke functions remain unchanged");
  for (const asset of [COMPUTER_USE_SETTINGS_ASSET, "webview/assets/other.js", COMPUTER_USE_MANAGEMENT_ASSET + ".map"]) {
    assert.deepEqual(injectComputerUseManagement(original, asset), { text: original, count: 0 });
  }
  for (const [before, after] of managementReplacements) {
    for (const source of [original.replace(before, "changed"), original + before,
      injected.text.replace(after, "changed"), injected.text + after, injected.text + before]) {
      assert.throws(() => injectComputerUseManagement(source, COMPUTER_USE_MANAGEMENT_ASSET));
    }
  }
  for (const source of [original + MANAGEMENT_MARKER, injected.text + MANAGEMENT_MARKER, injected.text.replace(MANAGEMENT_MARKER, "")]) {
    assert.throws(() => injectComputerUseManagement(source, COMPUTER_USE_MANAGEMENT_ASSET));
  }
  const vp = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
  const parse = source => vp.createSourceFile(COMPUTER_USE_MANAGEMENT_ASSET, source, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS);
  assert.equal(parse(injected.text).parseDiagnostics.length, 0);
  const transformer = require("./namespace-azrael-host.cjs");
  const transformed = transformer.transformAsset(original, COMPUTER_USE_MANAGEMENT_ASSET, COMPUTER_USE_MANAGEMENT_ASSET, vp);
  assert.equal(transformed.asset.computerUseManagementEdits, 1);
  assert.equal(transformed.asset.windowControlEdits, 1);
  assert.equal(transformed.asset.computerUseSettingsEdits, 0);
  assert.equal(transformed.asset.computerUseCancelRequestEdits, 0);
  restored = transformed.text;
  for (const [before, after] of [...managementReplacements].reverse()) restored = restored.replace(after, before);
  assert.equal(restored, injectWindowControl(transformer.rewriteJavaScript(original, COMPUTER_USE_MANAGEMENT_ASSET, vp).text,
    COMPUTER_USE_MANAGEMENT_ASSET, vp).text);
  const rules = transformer.getTransformRules(), crypto = require("node:crypto");
  const sha = value => crypto.createHash("sha256").update(value).digest("hex");
  const ruleKey = value => sha(JSON.stringify(Object.entries(value).sort(([o], [b]) => o.localeCompare(b))));
  const managementRules = assetRules(transformer, COMPUTER_USE_MANAGEMENT_ASSET, rules);
  assert.equal(managementRules["inject-computer-use.cjs"], sha(fs.readFileSync(path.join(__dirname, "inject-computer-use.cjs"))));
  assert.notEqual(ruleKey(managementRules), ruleKey(assetRules(transformer, COMPUTER_USE_MANAGEMENT_ASSET,
    { ...rules, "inject-computer-use.cjs": "0".repeat(64) })));
  assert.equal(managementRules["inject-window-control.cjs"], sha(fs.readFileSync(path.join(__dirname, "inject-window-control.cjs"))));
  assert.notEqual(ruleKey(managementRules), ruleKey(assetRules(transformer, COMPUTER_USE_MANAGEMENT_ASSET,
    { ...rules, "inject-window-control.cjs": "0".repeat(64) })));
  function declaration(source, name) {
    const node = parse(source).statements.find(node => vp.isFunctionDeclaration(node) && node.name.text === name);
    assert(node, `missing native ${name} declaration`);
    return node.getText();
  }
  const nativeVr = declaration(transformed.text, "Vr");
  assert.equal(declaration(transformed.text, "Hr"), declaration(original, "Hr"));
  assert.equal(declaration(transformed.text, "ci"), declaration(original, "ci"));
  assert.equal(declaration(transformed.text, "ui"), declaration(original, "ui"));
  const memo = Array(28).fill(Symbol.for("react.memo_cache_sentinel"));
  let host = "local", platform = "windows", availability = { available: false }, browser = null, plugin = null;
  const jsx = (type, props) => ({ type, props });
  const K = Object.assign(function Section() {}, { Header: "section-header", Content: "section-content" });
  const context = vm.createContext({ Q: { c: count => { assert.equal(count, 28); return memo; } },
    mt: () => ({ selectedHostId: host }), S: () => false, hn: "native-enabled", nt: () => availability,
    bt: () => ({ platform }), ve: () => false, b: () => ({ pathname: browser == null ? "/settings/computer-use" : `/settings/computer-use/${browser}` }),
    k: () => ({ params: { browserFamily: browser } }), en: "browser-route", Qt: value => value, h: () => plugin, Ci: "plugin",
    $: { jsx, jsxs: jsx, Fragment: "fragment" }, ti: "browser-page", _: "redirect", ei: "plugin-page",
    Kt: "settings-title", _i: "computer-use", x: "localized-label", K, q: { control: {}, alwaysAllowedApps: {} },
    Hr: "native-controls", ai: "macos-control", Ot: "boundary", ci: "approvals", ri: "sound", Gt: "settings-page",
    AzraelWindowControlLauncher: "window-control-launcher" });
  vm.runInContext(nativeVr, context);
  const render = () => vm.runInContext("Vr()", context);
  function contains(node, type) {
    if (Array.isArray(node)) return node.some(child => contains(child, type));
    return !!node && typeof node === "object" && (node.type === type || contains(node.props?.children, type));
  }
  for (const unavailable of [{ available: false }, { available: false, isLoading: true }, { available: false, reason: "disabled" }]) {
    availability = unavailable;
    const result = render();
    assert(contains(result, "approvals")); assert(!contains(result, "sound"));
    assert(contains(result, "native-controls"));
    assert.equal(result.props.children[0].props.children[1].props.children[0].props.computerUseAvailability, unavailable);
    assert.equal(render(), result, "unchanged inputs reuse the native memo");
  }
  for (const other of ["macOS", "linux"]) {
    platform = other; assert(!contains(render(), "approvals"));
    platform = "windows"; assert(contains(render(), "approvals"), "platform changes invalidate approvals memo");
  }
  host = "remote"; assert(!contains(render(), "approvals"));
  host = "local"; assert(contains(render(), "approvals"), "host changes invalidate approvals memo");
  for (const selectedHost of ["local", "remote"]) for (const selectedPlatform of ["windows", "macOS", "linux"]) {
    host = selectedHost; platform = selectedPlatform; availability = { available: true };
    assert(contains(render(), "approvals")); assert(contains(render(), "sound"));
  }
  availability = { available: false }; assert(!contains(render(), "approvals"));
  host = "local"; platform = "windows"; assert(contains(render(), "approvals")); assert(!contains(render(), "sound"));
  availability = { available: true }; assert(contains(render(), "approvals")); assert(contains(render(), "sound"));
  availability = { available: false }; assert(contains(render(), "approvals")); assert(!contains(render(), "sound"));
  plugin = {}; assert.equal(render().type, "plugin-page"); plugin = null;
  browser = "chrome"; assert.equal(render().type, "browser-page");
  browser = "unsupported"; assert.equal(render().type, "redirect"); browser = null;

  // Execute the unchanged query factory and ci mount effect: neither requires
  // native availability, and the query invokes the native approval owner directly.
  const querySource = fs.readFileSync(path.join(root, "webview/assets/computer-use-app-approvals-query-9e56575cd5d5.js"), "utf8");
  const queryAst = vp.createSourceFile("approval-query.js", querySource, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS);
  const queryFactories = [];
  function findApprovalQuery(node) {
    if (vp.isBinaryExpression(node) && node.left.getText(queryAst) === "j" &&
        vp.isCallExpression(node.right) && node.right.expression.getText(queryAst) === "n" &&
        node.right.arguments[1]?.getText(queryAst).includes('queryKey:[`computer-use-app-approvals`]')) {
      queryFactories.push(node.right.getText(queryAst));
    }
    vp.forEachChild(node, findApprovalQuery);
  }
  findApprovalQuery(queryAst);
  assert.equal(queryFactories.length, 1, "unique native approval query factory");
  let reads = 0, refetches = 0, fetched;
  const approvedApps = [{ bundleIdentifier: "stored.exe", displayName: "Stored app" }];
  const query = vm.runInNewContext(`(${queryFactories[0]})`, {
    n: (_owner, factory) => factory(), h: "native-owner", m: value => value,
    i: { computerUseSettings: { getAppApprovals: () => { reads++; return { approvedApps }; } } }, o: { ONE_MINUTE: 60000 } });
  assert.equal(Object.hasOwn(query, "enabled"), false);
  assert.equal(query.refetchOnMount, "always");
  const ciContext = vm.createContext({ Q: { c: () => Array(7).fill(Symbol.for("react.memo_cache_sentinel")) },
    c: () => ({ get: key => { assert.equal(key, "approval-query"); return { refetch: () => { refetches++; fetched = query.queryFn({ signal: undefined }); } }; } }),
    Yt: "native-owner", Tn: "approval-query", s: () => ({ isLoading: false, isError: false, data: { approvedApps } }),
    gi: { useEffect: effect => effect() }, $: { jsx }, li: "approval-list" });
  vm.runInContext(declaration(transformed.text, "ci"), ciContext);
  assert.equal(vm.runInContext("ci()", ciContext).type, "approval-list");
  assert.equal(refetches, 1); assert.equal(reads, 1); assert.deepEqual(await fetched, { approvedApps });
  console.log("PASS pinned Vr local Windows management, preserved native gates/sound, host/platform/availability memo invalidation and ungated native ci query mount");
});
test('Window Use Azrael title is guarded and leaves Computer Use native title intact',()=>{
 const {injectWindowApprovalTitle,WINDOW_TITLE_MARKER,windowTitleReplacements}=require('./inject-computer-use.cjs');const original=fs.readFileSync(path.join(__dirname,'../artifacts/upstream-ui/26.930.61225',COMPUTER_USE_APPROVAL_CARD_ASSET),'utf8');
 const result=injectWindowApprovalTitle(original,COMPUTER_USE_APPROVAL_CARD_ASSET);assert.equal(result.count,1);assert.equal(injectWindowApprovalTitle(result.text,COMPUTER_USE_APPROVAL_CARD_ASSET).count,0);assert(result.text.includes('Allow Azrael to use {appDisplayName}?'));assert(result.text.includes('Allow ChatGPT to use {appDisplayName}?'));
 assert.throws(()=>injectWindowApprovalTitle(original+WINDOW_TITLE_MARKER,COMPUTER_USE_APPROVAL_CARD_ASSET));assert.throws(()=>injectWindowApprovalTitle(result.text.replace(windowTitleReplacements[2][1],'tampered'),COMPUTER_USE_APPROVAL_CARD_ASSET));assert.equal(injectWindowApprovalTitle(original,'unrelated.js').count,0);
});
