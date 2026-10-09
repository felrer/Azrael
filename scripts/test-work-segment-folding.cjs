"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { injectDeferredTurnView, injectDeferredThread, injectDeferredWaitRenderer } = require("./inject-deferred-turn.cjs");
const { WORK_SEGMENT_FOLDING_ASSET, WORK_SEGMENT_FOLDING_ACTIVITY_ASSET, injectWorkSegmentFolding, injectWorkSegmentWaiting } = require("./inject-work-segment-folding.cjs");
const root = path.resolve(__dirname, "..");
const ts = require(require.resolve("typescript", { paths: [path.join(root, "extensions/azrael-ex")] }));

// Shared by the browser harness: derive the actual transformed Ks prop
// expressions, rather than maintaining a second implementation of its policy.
function productionPolicy() {
  const source = fs.readFileSync(path.join(root, "artifacts/upstream-ui/26.1007.21434", WORK_SEGMENT_FOLDING_ASSET), "utf8");
  const deferred = injectDeferredTurnView(source).text;
  const result = injectWorkSegmentFolding(deferred);
  const ast = ts.createSourceFile("turn.js", result.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let eligibility, props, header;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === "azraelStoppedFold") eligibility = n.initializer.getText(ast);
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === "sa" && n.initializer?.getText(ast).startsWith("o??ft??")) header = n.initializer.getText(ast);
    if (ts.isObjectLiteralExpression(n) && n.properties.some(p => p.name?.getText(ast) === "allowCollapseBeforeFinal")) props = n;
    ts.forEachChild(n, visit);
  }
  visit(ast);
  assert.ok(eligibility && props && header);
  const names = ["allowCollapseBeforeFinal", "forceExpanded", "disableCollapse", "preventAutoCollapse"];
  const expressions = names.map(name => name + ":" + props.properties.find(p => p.name?.getText(ast) === name).initializer.getText(ast));
  const body = "const {l,b,K,xn,Cn,wn,Dn,Pt,G,Pe,$e,U,A,j,Qe,fr}=input;const ic=e=>!e.completed,rc=ic;const azraelStoppedFold=" + eligibility + ";return {azraelStoppedFold," + expressions.join(",") + "}";
  const tc = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "tc").getText(ast);
  const headerBody = "const wc={default:(items,predicate)=>items.findLast(predicate)};" + tc + ";return " + header;
  return { source, deferred, result, body, headerBody, selectHeader: new Function("Ji", "o", "ft", headerBody), evaluate: new Function("input", body) };
}

if (require.main === module) {
  let checks = 0;
  const check = (name, fn) => { fn(); checks++; console.log("PASS " + name); };
  const policy = productionPolicy();
  const base = { l: "terminal", b: { status: "in_progress" }, K: true, xn: null, Cn: null, wn: [], Dn: [], Pt: false, G: false, Pe: false, $e: "on", U: true, A: 3, j: 4, Qe: false, fr: false };
  const evalCase = delta => policy.evaluate({ ...base, ...delta });
  check("six verified replacements after current deferred transform", () => assert.equal(policy.result.count, 6));
  check("terminal slice remains foldable while source turn is active", () => assert.deepEqual(evalCase({}), { azraelStoppedFold: true, allowCollapseBeforeFinal: true, forceExpanded: false, disableCollapse: false, preventAutoCollapse: true }));
  check("deferred stopped presentation eligibility", () => assert.equal(evalCase({ l: "active", b: { status: "deferred" }, K: false }).azraelStoppedFold, true));
  check("deferred presentation still active is excluded", () => assert.equal(evalCase({ l: "active", b: { status: "deferred" }, K: true }).azraelStoppedFold, false));
  for (const [name, delta] of Object.entries({ approval: { xn: {} }, question: { Cn: { completed: false } }, elicitation: { wn: [{ completed: false }] }, permission: { Dn: [{ completed: false }] } }))
    check("pending " + name + " never newly folds", () => { const p = evalCase(delta); assert.equal(p.azraelStoppedFold, false); assert.equal(p.disableCollapse, true); });
  check("completed requests do not veto", () => assert.equal(evalCase({ Cn: { completed: true }, wn: [{ completed: true }], Dn: [{ completed: true }] }).azraelStoppedFold, true));
  check("inline running subagent allows manual fold and prevents auto fold", () => { const p = evalCase({ fr: true }); assert.equal(p.disableCollapse, false); assert.equal(p.preventAutoCollapse, true); });
  for (const flag of ["G", "Pe"]) check("native " + flag + " exclusion", () => assert.equal(evalCase({ [flag]: true }).disableCollapse, true));
  check("active segment retains native policy", () => { const p = evalCase({ l: "active" }); assert.equal(p.azraelStoppedFold, false); assert.equal(p.allowCollapseBeforeFinal, false); assert.equal(p.forceExpanded, true); assert.equal(p.disableCollapse, true); });
  check("normal unsliced completed baseline retains native policy", () => { const p = evalCase({ l: null, K: false, U: false, A: 1, j: 4 }); assert.equal(p.azraelStoppedFold, false); assert.equal(p.disableCollapse, false); });
  const native = fs.readFileSync(path.join(root, "artifacts/upstream-ui/26.1007.21434/webview/assets/sites-end-resource-90d3046b3014.js"), "utf8");
  const ast = ts.createSourceFile("activity.js", native, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const yo = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "YO");
  const resolve = new Function("return (" + yo.getText(ast) + ")")();
  check("native persisted collapsed overrides stopped initial expansion", () => { const p = evalCase({}); assert.equal(resolve({ ...p, hasRenderableAgentItems: true, persistedCollapsed: true }).isCollapsed, true); assert.equal(resolve({ ...p, hasRenderableAgentItems: true }).isCollapsed, false); });
  check("native empty activity remains excluded", () => assert.equal(resolve({ ...evalCase({}), hasRenderableAgentItems: false }).shouldAllowCollapse, false));
  check("transform changes no timing or key expressions", () => { for (const word of ["durationMs", "turnKey", "turnSearchKey", "startedAtMs", "completedAtMs"]) assert.equal(policy.result.text.split(word).length, policy.deferred.split(word).length); assert.ok(policy.result.text.includes("persistedCollapsed:P,onSetCollapsed:F")); assert.ok(native.includes("te[0]?.kind===`standalone`&&te[0].item.item.type===`context-compaction`")); });
  check("composed native thread preserves segment keys and collapse store", () => {
    const thread = fs.readFileSync(path.join(root, "artifacts/upstream-ui/26.1007.21434/webview/assets/local-conversation-thread-2429c4b61076.js"), "utf8");
    const projected = injectDeferredThread(thread).text;
    const keys = text => [...text.matchAll(/turn(?:Search)?Key:[^,}]+/g)].map(m => m[0]);
    assert.deepEqual(keys(projected), keys(thread));
    for (const anchor of ["turnKey:n.key", "turnSearchKey:n.key", "Wm(e,t,n){e.set(Gm,t,n)}"])
      assert.ok(thread.includes(anchor) && projected.includes(anchor), anchor);
  });
  check("idempotence fails closed", () => assert.throws(() => injectWorkSegmentFolding(policy.result.text), /already transformed/));
  for (const anchor of ["allowCollapseBeforeFinal:Pt,units:t", "disableCollapse:l!=null||G||Pe", "preventAutoCollapse:Pt&&K||Qe||fr", "forceExpanded:G||!Pt&&$e!==`off`&&(U||A!=null&&j!=null&&A>=j-1)", "if(la){let e=ga(Ya,{includeGeneratedImages:!0,mcpServerStatuses:zi,groupStartItems:ln})", "sa=o??ft??(0,wc.default)(Ji,tc)??null"]) {
    check("missing anchor fails closed " + anchor.split(":")[0], () => assert.throws(() => injectWorkSegmentFolding(policy.deferred.replace(anchor, "tampered")), /exactly once/));
    check("duplicate anchor fails closed " + anchor.split(":")[0], () => assert.throws(() => injectWorkSegmentFolding(policy.deferred + anchor), /exactly once/));
  }
  const activityPath = path.join(root, "artifacts/upstream-ui/26.1007.21434", WORK_SEGMENT_FOLDING_ACTIVITY_ASSET);
  const activityDeferred = injectDeferredWaitRenderer(fs.readFileSync(activityPath, "utf8")).text;
  const waiting = injectWorkSegmentWaiting(activityDeferred);
  const waitingAst = ts.createSourceFile("waiting.js", waiting.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const vo = waitingAst.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "VO");
  const partition = new Function("HO", "return (" + vo.getText(waitingAst) + ")")(() => false);
  const work = { type: "worked-for", status: "worked", startedAtMs: 12000, completedAtMs: 20000 };
  const marker = wait => ({ kind: "standalone", key: wait.status, item: { item: wait } });
  const bodyUnit = { kind: "standalone", key: "body", item: { item: { type: "generated-image" } } };
  for (const wait of [{ type: "worked-for", status: "azraelWaiting", rootResumeWait: { state: "waiting" } }, { type: "worked-for", status: "azraelWaiting", rootResumeWait: { state: "resumed" } }, { type: "worked-for", status: "azraelWaitUnknown" }]) {
    check("native VO persistent wait " + JSON.stringify(wait.rootResumeWait?.state ?? wait.status), () => {
      const units = [bodyUnit, marker(work), marker(wait)], p = partition(units);
      assert.deepEqual(p.collapsibleUnits, [bodyUnit]);assert.deepEqual(p.persistentUnits, [units[2]]);
      assert.deepEqual(p.expandedUnits, [bodyUnit, units[2]]);assert.equal(p.workedForItem, work);
      assert.equal(policy.selectHeader([work, wait], null, null), work);
    });
  }
  check("native wait-only partition has no collapsible messages or work header", () => { const wait = { type: "worked-for", status: "azraelWaitUnknown" };const p = partition([marker(wait)]);assert.equal(p.collapsibleUnits.length, 0);assert.equal(p.persistentUnits.length, 1);assert.equal(p.workedForItem, null);assert.equal(policy.selectHeader([wait], null, null), null); });
  check("waiting transform count and guards", () => { assert.equal(waiting.count, 1);assert.throws(() => injectWorkSegmentWaiting(waiting.text), /exactly once/);const anchor = "if(l.kind===`standalone`&&l.item.item.type===`worked-for`){c=l.item.item;continue}";assert.throws(() => injectWorkSegmentWaiting(activityDeferred.replace(anchor, "tampered")), /exactly once/);assert.throws(() => injectWorkSegmentWaiting(activityDeferred + anchor), /exactly once/); });
  const transformer = require("./namespace-azrael-host.cjs"), rule = "inject-work-segment-folding.cjs";
  for (const [asset, expected] of [[WORK_SEGMENT_FOLDING_ASSET, 6], [WORK_SEGMENT_FOLDING_ACTIVITY_ASSET, 1]]) {
    check("full namespace pipeline accounts for work folding " + asset, () => {
      const source = fs.readFileSync(path.join(root, "artifacts/upstream-ui/26.1007.21434", asset), "utf8");
      const transformed = transformer.transformAsset(source, asset, asset, ts);
      assert.equal(transformed.asset.workSegmentFoldingEdits, expected);
      const sum = Object.entries(transformed.asset).filter(([name]) => name.endsWith("Edits")).reduce((total, [, value]) => total + value, 0);
      assert.equal(transformed.asset.edits, sum);
      assert.ok(transformed.asset.edits >= expected + transformed.asset.deferredTurnEdits);
      if (expected === 6) assert.ok(transformed.text.includes("sa=o??ft??(0,wc.default)(Ji,e=>tc(e)&&e.rootResumeWait==null"));
      else assert.ok(transformed.text.includes("l.item.item.status===`azraelWaitUnknown`){a.push(l);o.push(l);continue}"));
    });
  }
  check("both native assets bind to the folding rule and its module hash", () => {
    const rules = transformer.getTransformRules();
    assert.deepEqual(new Set(transformer.ASSET_RULE_PATHS[rule]), new Set([WORK_SEGMENT_FOLDING_ASSET, WORK_SEGMENT_FOLDING_ACTIVITY_ASSET]));
    const moduleSource = fs.readFileSync(path.join(__dirname, rule));
    const sha = data => crypto.createHash("sha256").update(data).digest("hex");
    assert.equal(rules[rule], sha(moduleSource));
    const changed = { ...rules, [rule]: sha(Buffer.concat([moduleSource, Buffer.from("\n")])) };
    const fingerprint = (asset, input) => sha(JSON.stringify(Object.entries(transformer.getAssetTransformRules(asset, input)).sort(([a], [b]) => a.localeCompare(b))));
    for (const asset of [WORK_SEGMENT_FOLDING_ASSET, WORK_SEGMENT_FOLDING_ACTIVITY_ASSET]) {
      assert.equal(transformer.getAssetTransformRules(asset, rules)[rule], rules[rule]);
      assert.notEqual(fingerprint(asset, rules), fingerprint(asset, changed));
    }
    assert.equal(transformer.getAssetTransformRules("webview/assets/unrelated.js", rules)[rule], undefined);
    assert.equal(fingerprint("webview/assets/unrelated.js", rules), fingerprint("webview/assets/unrelated.js", changed));
  });
  check("feature manifest registers folding under the existing validation contract", () => {
    const gate = require("./feature-preservation.cjs"), manifest = gate.loadManifest(root);
    assert.equal(gate.validateManifest(manifest, root, transformer.getTransformRules()), manifest);
    const feature = manifest.features.find(f => f.id === "ui.work-segment-folding");
    assert.ok(feature && feature.owners.includes("scripts/" + rule));
    assert.ok(feature.reportFields.includes("workSegmentFoldingEdits"));
    assert.ok(feature.checks.some(c => c.args.includes("scripts/test-work-segment-folding.cjs")));
  });
  console.log(JSON.stringify({ outcome: "passed", checks, transformCount: policy.result.count, waitingCount: waiting.count, aggregateCount: policy.result.count + waiting.count }));
}
module.exports = { productionPolicy };
