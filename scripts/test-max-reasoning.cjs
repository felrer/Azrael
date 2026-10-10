"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const vp = require(process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH || path.resolve("extensions/azrael-ex/node_modules/typescript/lib/typescript.js"));
const policy = require("./inject-max-reasoning.cjs");
const provider = require("./inject-provider-model-picker.cjs");
const { createProviderModelCatalog } = require("./provider-model-picker.cjs");
const original = process.env.AZRAEL_PRESERVATION_UI_ROOT || process.env.MAX_REASONING_ORIGINAL || path.resolve("artifacts/upstream-ui/26.1007.21434");
const read = asset => fs.readFileSync(path.join(original, asset), "utf8");
const astCache=new Map();
function ast(source) {
  if(astCache.has(source))return astCache.get(source);
  const tree = vp.createSourceFile("candidate.js", source, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length, 0);
  astCache.set(source,tree); return tree;
}
function find(tree, predicate) {
  const result = [];
  function visit(node) { if (predicate(node)) result.push(node); vp.forEachChild(node, visit); }
  visit(tree); return result;
}
function contextFunctions(source, names, context) {
  const tree = ast(source);
  const declarations = find(tree, n => vp.isFunctionDeclaration(n) && names.includes(n.name?.text));
  assert.equal(declarations.length, names.length);
  vm.createContext(context);
  vm.runInContext(declarations.map(n => n.getText(tree)).join("\n"), context);
  return context;
}
const efforts = stages => stages.map(reasoningEffort => ({ reasoningEffort, description: reasoningEffort }));
const plain = value => JSON.parse(JSON.stringify(value));
const anchors = [
  ["yC(e)&&a.has(e)", "(t==null||r==null||r.includes(t5[t]))"],
  ["new Set([...vg(e,Pbe.enabledReasoningEfforts),`persistent`])", "_=n==null?u(AMn):new Set([...n,`persistent`])"],
  ["let r=Q.filter(e),a=d?.models.some(Ge)", "if(d==null||r.length===0&&!a)"],
  ["g=s==null?void 0:re(s)"],
];
function nativeContract(source) {
  const c = contextFunctions(source, ["FJr", "IJr", "yC"], { __azraelProviderCatalog: createProviderModelCatalog() });
  const models = [
    { model: "native", supportedReasoningEfforts: efforts(["low", "medium", "max", "ultra"]), defaultReasoningEffort: "medium", isDefault: true },
    { model: "unsupported", supportedReasoningEfforts: efforts(["low"]), defaultReasoningEffort: "low" },
    { model: "managed/openrouter/test", supportedReasoningEfforts: efforts(["low", "max"]), defaultReasoningEffort: "low" },
    { model: "hidden", hidden: true, supportedReasoningEfforts: efforts(["max"]) },
  ];
  for (const enabled of [[], ["low"], ["ultra"], ["max"]]) {
    const result = c.FJr({ models, enabledReasoningEfforts: new Set(enabled), authMethod: "chatgpt", availableModels: new Set(), includeUltraReasoningEffort: true });
    assert.ok(result.models[0].supportedReasoningEfforts.some(e => e.reasoningEffort === "max"));
    assert.equal(result.defaultModel.defaultReasoningEffort, "medium");
    assert.equal(result.models.find(m => m.model === "unsupported").supportedReasoningEfforts.some(e => e.reasoningEffort === "max"), false);
    assert.equal(result.models.some(m => m.model === "hidden"), false);
    assert.equal(result.models[0].supportedReasoningEfforts.some(e => e.reasoningEffort === "ultra"), enabled.includes("ultra"));
  }
  const args = { models, enabledReasoningEfforts: new Set(["max", "ultra"]), authMethod: "copilot", includeUltraReasoningEffort: false, availableModels: new Set() };
  assert.deepEqual(plain(c.FJr(args).models[0].supportedReasoningEfforts), [], "Copilot medium-only constraint survives");
  args.authMethod = "chatgpt";
  assert.deepEqual(plain(c.FJr(args).models[0].supportedReasoningEfforts).map(e => e.reasoningEffort), ["max"], "Ultra feature gate survives");
}
for (const asset of policy.MAX_REASONING_ASSETS) {
  for (const chain of [false, true]) test(`guarded adapter parses and is idempotent: ${asset}, provider=${chain}`, () => {
    const input = chain ? provider.injectProviderModelPicker(read(asset), asset).text : read(asset);
    const result = policy.injectMaxReasoning(input, asset);
    assert.equal(result.count, 1); ast(result.text);
    assert.deepEqual(policy.injectMaxReasoning(result.text, asset), { text: result.text, count: 0 });
    assert.throws(() => policy.injectMaxReasoning("", asset), /anchor/);
    assert.throws(() => policy.injectMaxReasoning(input + input, asset), /anchor/);
    assert.throws(() => policy.injectMaxReasoning(result.text + policy.MAX_REASONING_MARKER, asset), /Duplicate/);
    for (const anchor of anchors[policy.MAX_REASONING_ASSETS.indexOf(asset)]) {
      assert.throws(() => policy.injectMaxReasoning(input.replace(anchor, "/*anchor-drift*/"), asset), /anchor/);
      assert.throws(() => policy.injectMaxReasoning(input + anchor, asset), /anchor/);
    }
  });
}
test("unrelated assets remain untouched", () => assert.deepEqual(policy.injectMaxReasoning("input", "other.js"), { text: "input", count: 0 }));
for (const chain of [false, true]) test(`actual native supported-stage filters preserve authentication/defaults/Ultra, provider=${chain}`, () => {
  const asset = policy.MAX_REASONING_ASSETS[0];
  const input = chain ? provider.injectProviderModelPicker(read(asset), asset).text : read(asset);
  nativeContract(policy.injectMaxReasoning(input, asset).text);
  assert.throws(() => nativeContract(input), assert.AssertionError, "reverting Max policy must fail behavior acceptance");
});
test("actual derived set and explicit query filters force Max for missing/empty/excluding saved lists", () => {
  const asset = policy.MAX_REASONING_ASSETS[1], source = policy.injectMaxReasoning(read(asset), asset).text, tree = ast(source);
  const derived = find(tree, n => vp.isBinaryExpression(n) && n.left.getText(tree) === "AMn" && n.right.getText(tree).startsWith("q(Q,"));
  const filters = find(tree, n => vp.isVariableDeclaration(n) && n.name.getText(tree) === "_" && n.initializer?.getText(tree).startsWith("new Set([...(n==null?u(AMn):n)"));
  assert.equal(derived.length, 1); assert.equal(filters.length, 1);
  for (const saved of [undefined, [], ["low"], ["ultra"]]) {
    const c = { Q: {}, Pbe: { enabledReasoningEfforts: { default: ["low", "medium", "high", "xhigh"] } }, vg: (get, setting) => saved ?? setting.default, q: (scope, fn) => fn({ get() {} }) };
    vm.createContext(c); vm.runInContext(derived[0].getText(tree), c);
    assert.ok(c.AMn.has("max")); assert.ok(c.AMn.has("persistent"));
    assert.equal(c.AMn.has("ultra"), saved?.includes("ultra") === true);
    for (const explicit of [undefined, [], ["low"], ["ultra"]]) {
      c.n = explicit; c.u = () => c.AMn;
      const set = vm.runInContext(filters[0].initializer.getText(tree), c);
      assert.ok(set.has("max")); assert.ok(set.has("persistent"));
      assert.equal(set.has("ultra"), (explicit ?? saved)?.includes("ultra") === true);
    }
  }
});
test("actual ChatGPT stage filter retains Max, model limits and current/default stages", () => {
  const asset = policy.MAX_REASONING_ASSETS[0], source = policy.injectMaxReasoning(read(asset), asset).text;
  const c = contextFunctions(source, ["Lca"], {
    t5: { low: "low", high: "high", max: "max", ultra: "ultra" }, EX: () => false,
    "zca": { default: (rows, key) => [...new Map(rows.map(row => [key(row), row])).values()] },
    oS: (config, row) => config.options.find(o => o.slug === row.slug && o.thinkingEffort === row.thinkingEffort),
    "Rca": (o, effort) => ({ id: `${o.slug}:${effort}`, model: o.slug }),
    TX: (rows, id) => rows.find(r => r.id === id), uFt: () => "Model",
  });
  const config = { defaultModelSlug: "gpt", defaultThinkingEffortByModelSlug: { gpt: "low" }, options: ["low", "max", "ultra"].map(thinkingEffort => ({ slug: "gpt", thinkingEffort })) };
  for (const enabled of [undefined, [], ["low"], ["ultra"]]) {
    const result = c["Lca"](config, config.options, { slug: "gpt", thinkingEffort: "max" }, { enabledReasoningEfforts: enabled });
    assert.ok(result.powerSettings.some(row => row.thinkingEffort === "max"));
    assert.equal(result.selectedPowerSelection.id, "gpt:max");
    assert.equal(result.powerSettings.some(row => row.thinkingEffort === "ultra"), enabled == null || enabled.includes("ultra"));
  }
  const current = c["Lca"](config, config.options, { slug: "gpt", thinkingEffort: "low" }, { enabledReasoningEfforts: ["low"] });
  assert.equal(current.selectedPowerSelection.id, "gpt:low"); assert.equal(current.defaultPowerSelection.id, "gpt:low");
  assert.equal(c["Lca"](config, config.options, { slug: "gpt" }, { enabledReasoningEfforts: [], modelLimits: [{ model_slug: "gpt" }] }).powerSettings.length, 0);
  const noMax = { ...config, options: config.options.filter(o => o.thinkingEffort !== "max") };
  assert.equal(c["Lca"](noMax, noMax.options, { slug: "gpt", thinkingEffort: "low" }, { enabledReasoningEfforts: [] }).powerSettings.length, 0);
});
function settingsContract(source) {
  let data, enabled, writes = [];
  const jsx = (type, props, key) => ({ type, props, key });
  const c = contextFunctions(source, ["Ue", "We", "Ge", "Ke"], {
    X: { c: count => Array(count).fill(Symbol.for("react.memo_cache_sentinel")) },
    o: () => ({}), ge: {}, a: () => enabled, xe: {}, be: () => ({ data }), r:()=>({}),
    Q: ["max", "ultra"], z: ["low", "medium", "high", "xhigh"],
    Z: { jsx, jsxs: jsx }, W: Object.assign("section", { Header: "header", Content: "content" }),
    R: "group", I: "row", i: "message", te: "menu", oe: "trigger", k: { CheckboxItem: "checkbox" }, G: "effort",
    ie: (action, args) => { writes.push(args); return Promise.resolve(); },
  });
  function nodes(tree) { const out = []; function visit(n) { if (!n || typeof n !== "object") return; out.push(n); for (const ch of [n.props?.children, n.props?.control, n.props?.triggerButton].flat(Infinity)) visit(ch); } visit(tree); return out; }
  for (const ultraSupported of [false, true]) for (const selected of [[], ["max"], ["ultra"]]) {
    enabled = new Set(selected); data = { hasModelSupportingMaxReasoningEffort: true, hasModelSupportingUltraReasoningEffort: ultraSupported, models: [{ supportedReasoningEfforts: [] }] };
    const tree = c.Ue({ hostId: "local" }); assert.ok(tree, "Max-only support must retain other settings");
    const rendered = nodes(tree), boxes = rendered.filter(n => n.type === "checkbox");
    assert.equal(boxes.some(n => n.key === "max"), false);
    assert.equal(boxes.some(n => n.key === "ultra"), ultraSupported);
    assert.equal(boxes.filter(n => n.props.disabled).length, 4);
    assert.equal(rendered.find(n => n.props?.values?.count != null).props.values.count, 4 + Number(ultraSupported && selected.includes("ultra")));
    if (ultraSupported) { const ultra = boxes.find(n => n.key === "ultra"); assert.equal(ultra.props.checked, selected.includes("ultra")); ultra.props.onCheckedChange(true); assert.equal(writes.at(-1).reasoningEffort, "ultra"); }
  }
  enabled = new Set(); data = { hasModelSupportingMaxReasoningEffort: true, models: [{ supportedReasoningEfforts: efforts(["persistent", "max"]) }] };
  const persistent = nodes(c.Ue({ hostId: "local" })).filter(n => n.type === "checkbox");
  assert.equal(persistent.length, 5); assert.equal(persistent.find(n => n.key === "persistent").props.disabled, true);
  data = undefined; assert.equal(c.Ue({ hostId: "local" }), null);
}
test("actual settings render omits only Max item and count, preserves Ultra and disabled base items", () => {
  const asset = policy.MAX_REASONING_ASSETS[2]; settingsContract(policy.injectMaxReasoning(read(asset), asset).text);
  assert.throws(() => settingsContract(read(asset)), assert.AssertionError, "reverted settings must fail acceptance");
});
function workSettingsContract(source) {
  const tree = ast(source);
  const owner = find(tree, n => vp.isFunctionDeclaration(n) && n.name?.text === "G")[0];
  assert.ok(owner);
  const local = ast(owner.getText(tree));
  const choices = find(local, n => vp.isVariableDeclaration(n) && n.name.getText(local) === "g" && n.initializer?.getText(local).startsWith("s==null?void 0:re(s)"));
  const render = find(local, n => vp.isBinaryExpression(n) && n.left.getText(local) === "b" && n.right.getText(local).includes("te.CheckboxItem"));
  const selectedFilter = find(local, n => vp.isArrowFunction(n) && n.getText(local) === "e=>a.includes(e)");
  const selected = find(local, n => vp.isVariableDeclaration(n) && n.initializer?.getText(local) === "g.filter(e)");
  assert.equal(choices.length, 1); assert.equal(render.length, 1); assert.equal(selectedFilter.length, 1); assert.equal(selected.length, 1);
  const picker = policy.injectMaxReasoning(read(policy.MAX_REASONING_ASSETS[0]), policy.MAX_REASONING_ASSETS[0]).text;
  const jsx = (type, props, key) => ({ type, props, key });
  const c = contextFunctions(picker, ["Ica"], {
    t5: { low: "low", max: "max", ultra: "ultra", persistent: "persistent" },
    Yb: { enabledReasoningEfforts: { schema: { element: { options: ["low", "max", "ultra", "persistent"] } } } },
    K: { jsx, jsxs: jsx }, oe: "row", B: "label", ne: "menu", ie: "trigger", te: { Item: "reset", CheckboxItem: "checkbox" }, de: "default", le: "effort", r: false, c: false, T: "count",
  });
  c.re = c.Ica;
  for (const saved of [[], ["low"], ["max"], ["ultra", "persistent"]]) {
    c.s = { options: ["low", "max", "ultra", "persistent"].map(thinkingEffort => ({ thinkingEffort })) };
    c.a = saved;
    c.g = vm.runInContext(choices[0].initializer.getText(local), c);
    assert.deepEqual(plain(c.g), ["low", "ultra", "persistent"]);
    c.e = vm.runInContext(selectedFilter[0].getText(local), c);
    assert.equal(vm.runInContext(selected[0].initializer.getText(local), c).length, saved.filter(e => e !== "max").length);
    const writes = []; c.o = update => writes.push(update);
    const row = vm.runInContext(render[0].right.getText(local), c), menu = row.props.control({});
    const [reset, boxes] = menu.props.children;
    assert.deepEqual(plain(boxes.map(n => n.key)), ["low", "ultra", "persistent"]);
    for (const box of boxes) assert.equal(box.props.checked, saved.includes(box.key));
    const ultra = boxes.find(n => n.key === "ultra");
    ultra.props.onCheckedChange(true); assert.ok(writes.at(-1).enabledReasoningEfforts.includes("ultra"));
    ultra.props.onCheckedChange(false); assert.equal(writes.at(-1).enabledReasoningEfforts.includes("ultra"), false);
    reset.props.onSelect(); assert.equal(writes.at(-1).enabledReasoningEfforts, null);
  }
  c.s = undefined; assert.equal(vm.runInContext(choices[0].initializer.getText(local), c), undefined);
}
test("actual Work preferences render removes Max item/count and preserves Ultra/persistent/reset", () => {
  const asset = policy.MAX_REASONING_ASSETS[3]; workSettingsContract(policy.injectMaxReasoning(read(asset), asset).text);
  assert.throws(() => workSettingsContract(read(asset)), assert.AssertionError, "reverted Work settings must fail acceptance");
});
