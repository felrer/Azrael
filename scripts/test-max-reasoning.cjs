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
const original = process.env.AZRAEL_PRESERVATION_UI_ROOT || process.env.MAX_REASONING_ORIGINAL || path.resolve("artifacts/upstream-ui/26.930.61225");
const read = asset => fs.readFileSync(path.join(original, asset), "utf8");
function ast(source) {
  const tree = vp.createSourceFile("candidate.js", source, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length, 0);
  return tree;
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
  ["ZC(e)&&i.has(e)", "(t==null||r==null||r.includes($8[t]))"],
  ["new Set([...Wg(e,JXe.enabledReasoningEfforts),`persistent`])", "let p=n==null?u(_Sn):new Set([...n,`persistent`])"],
  ["let r=Z.filter(e),i=l?.models.some(We)", "if(l==null||r.length===0&&!i)"],
  ["m=s==null?void 0:f(s)"],
];
function nativeContract(source) {
  const c = contextFunctions(source, ["rbr", "ibr", "ZC"], { __azraelProviderCatalog: createProviderModelCatalog() });
  const models = [
    { model: "native", supportedReasoningEfforts: efforts(["low", "medium", "max", "ultra"]), defaultReasoningEffort: "medium", isDefault: true },
    { model: "unsupported", supportedReasoningEfforts: efforts(["low"]), defaultReasoningEffort: "low" },
    { model: "managed/openrouter/test", supportedReasoningEfforts: efforts(["low", "max"]), defaultReasoningEffort: "low" },
    { model: "hidden", hidden: true, supportedReasoningEfforts: efforts(["max"]) },
  ];
  for (const enabled of [[], ["low"], ["ultra"], ["max"]]) {
    const result = c.rbr({ models, enabledReasoningEfforts: new Set(enabled), authMethod: "chatgpt", availableModels: new Set(), includeUltraReasoningEffort: true });
    assert.ok(result.models[0].supportedReasoningEfforts.some(e => e.reasoningEffort === "max"));
    assert.equal(result.defaultModel.defaultReasoningEffort, "medium");
    assert.equal(result.models.find(m => m.model === "unsupported").supportedReasoningEfforts.some(e => e.reasoningEffort === "max"), false);
    assert.equal(result.models.some(m => m.model === "hidden"), false);
    assert.equal(result.models[0].supportedReasoningEfforts.some(e => e.reasoningEffort === "ultra"), enabled.includes("ultra"));
  }
  const args = { models, enabledReasoningEfforts: new Set(["max", "ultra"]), authMethod: "copilot", includeUltraReasoningEffort: false, availableModels: new Set() };
  assert.deepEqual(plain(c.rbr(args).models[0].supportedReasoningEfforts), [], "Copilot medium-only constraint survives");
  args.authMethod = "chatgpt";
  assert.deepEqual(plain(c.rbr(args).models[0].supportedReasoningEfforts).map(e => e.reasoningEffort), ["max"], "Ultra feature gate survives");
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
  const derived = find(tree, n => vp.isBinaryExpression(n) && n.left.getText(tree) === "_Sn" && n.right.getText(tree).startsWith("G(Q,"));
  const filters = find(tree, n => vp.isVariableDeclaration(n) && n.name.getText(tree) === "p" && n.initializer?.getText(tree).startsWith("new Set([...(n==null?u(_Sn):n)"));
  assert.equal(derived.length, 1); assert.equal(filters.length, 1);
  for (const saved of [undefined, [], ["low"], ["ultra"]]) {
    const c = { Q: {}, JXe: { enabledReasoningEfforts: { default: ["low", "medium", "high", "xhigh"] } }, Wg: (get, setting) => saved ?? setting.default, G: (scope, fn) => fn({ get() {} }) };
    vm.createContext(c); vm.runInContext(derived[0].getText(tree), c);
    assert.ok(c._Sn.has("max")); assert.ok(c._Sn.has("persistent"));
    assert.equal(c._Sn.has("ultra"), saved?.includes("ultra") === true);
    for (const explicit of [undefined, [], ["low"], ["ultra"]]) {
      c.n = explicit; c.u = () => c._Sn;
      const set = vm.runInContext(filters[0].initializer.getText(tree), c);
      assert.ok(set.has("max")); assert.ok(set.has("persistent"));
      assert.equal(set.has("ultra"), (explicit ?? saved)?.includes("ultra") === true);
    }
  }
});
test("actual ChatGPT stage filter retains Max, model limits and current/default stages", () => {
  const asset = policy.MAX_REASONING_ASSETS[0], source = policy.injectMaxReasoning(read(asset), asset).text;
  const c = contextFunctions(source, ["h$i"], {
    $8: { low: "low", high: "high", max: "max", ultra: "ultra" }, XJ: () => false,
    "_$i": { default: (rows, key) => [...new Map(rows.map(row => [key(row), row])).values()] },
    GS: (config, row) => config.options.find(o => o.slug === row.slug && o.thinkingEffort === row.thinkingEffort),
    "g$i": (o, effort) => ({ id: `${o.slug}:${effort}`, model: o.slug }),
    YJ: (rows, id) => rows.find(r => r.id === id), tjt: () => "Model",
  });
  const config = { defaultModelSlug: "gpt", defaultThinkingEffortByModelSlug: { gpt: "low" }, options: ["low", "max", "ultra"].map(thinkingEffort => ({ slug: "gpt", thinkingEffort })) };
  for (const enabled of [undefined, [], ["low"], ["ultra"]]) {
    const result = c["h$i"](config, config.options, { slug: "gpt", thinkingEffort: "max" }, { enabledReasoningEfforts: enabled });
    assert.ok(result.powerSettings.some(row => row.thinkingEffort === "max"));
    assert.equal(result.selectedPowerSelection.id, "gpt:max");
    assert.equal(result.powerSettings.some(row => row.thinkingEffort === "ultra"), enabled == null || enabled.includes("ultra"));
  }
  const current = c["h$i"](config, config.options, { slug: "gpt", thinkingEffort: "low" }, { enabledReasoningEfforts: ["low"] });
  assert.equal(current.selectedPowerSelection.id, "gpt:low"); assert.equal(current.defaultPowerSelection.id, "gpt:low");
  assert.equal(c["h$i"](config, config.options, { slug: "gpt" }, { enabledReasoningEfforts: [], modelLimits: [{ model_slug: "gpt" }] }).powerSettings.length, 0);
  const noMax = { ...config, options: config.options.filter(o => o.thinkingEffort !== "max") };
  assert.equal(c["h$i"](noMax, noMax.options, { slug: "gpt", thinkingEffort: "low" }, { enabledReasoningEfforts: [] }).powerSettings.length, 0);
});
function settingsContract(source) {
  let data, enabled, writes = [];
  const jsx = (type, props, key) => ({ type, props, key });
  const c = contextFunctions(source, ["He", "Ue", "We", "Ge"], {
    Y: { c: count => Array(count).fill(Symbol.for("react.memo_cache_sentinel")) },
    i: () => ({}), Ne: {}, r: () => enabled, ce: {}, ie: () => ({ data }),
    Z: ["max", "ultra"], R: ["low", "medium", "high", "xhigh"],
    X: { jsx, jsxs: jsx }, U: Object.assign("section", { Header: "header", Content: "content" }),
    I: "group", V: "row", s: "message", h: "menu", oe: "trigger", g: { CheckboxItem: "checkbox" }, W: "effort",
    de: (action, args) => writes.push(args),
  });
  function nodes(tree) { const out = []; function visit(n) { if (!n || typeof n !== "object") return; out.push(n); for (const ch of [n.props?.children, n.props?.control, n.props?.triggerButton].flat(Infinity)) visit(ch); } visit(tree); return out; }
  for (const ultraSupported of [false, true]) for (const selected of [[], ["max"], ["ultra"]]) {
    enabled = new Set(selected); data = { hasModelSupportingMaxReasoningEffort: true, hasModelSupportingUltraReasoningEffort: ultraSupported, models: [{ supportedReasoningEfforts: [] }] };
    const tree = c.He({ hostId: "local" }); assert.ok(tree, "Max-only support must retain other settings");
    const rendered = nodes(tree), boxes = rendered.filter(n => n.type === "checkbox");
    assert.equal(boxes.some(n => n.key === "max"), false);
    assert.equal(boxes.some(n => n.key === "ultra"), ultraSupported);
    assert.equal(boxes.filter(n => n.props.disabled).length, 4);
    assert.equal(rendered.find(n => n.props?.values?.count != null).props.values.count, 4 + Number(ultraSupported && selected.includes("ultra")));
    if (ultraSupported) { const ultra = boxes.find(n => n.key === "ultra"); assert.equal(ultra.props.checked, selected.includes("ultra")); ultra.props.onCheckedChange(true); assert.equal(writes.at(-1).reasoningEffort, "ultra"); }
  }
  enabled = new Set(); data = { hasModelSupportingMaxReasoningEffort: true, models: [{ supportedReasoningEfforts: efforts(["persistent", "max"]) }] };
  const persistent = nodes(c.He({ hostId: "local" })).filter(n => n.type === "checkbox");
  assert.equal(persistent.length, 5); assert.equal(persistent.find(n => n.key === "persistent").props.disabled, true);
  data = undefined; assert.equal(c.He({ hostId: "local" }), null);
}
test("actual settings render omits only Max item and count, preserves Ultra and disabled base items", () => {
  const asset = policy.MAX_REASONING_ASSETS[2]; settingsContract(policy.injectMaxReasoning(read(asset), asset).text);
  assert.throws(() => settingsContract(read(asset)), assert.AssertionError, "reverted settings must fail acceptance");
});
function workSettingsContract(source) {
  const tree = ast(source);
  const owner = find(tree, n => vp.isFunctionDeclaration(n) && n.name?.text === "K")[0];
  assert.ok(owner);
  const local = ast(owner.getText(tree));
  const choices = find(local, n => vp.isVariableDeclaration(n) && n.name.getText(local) === "m" && n.initializer?.getText(local).startsWith("s==null?void 0:f(s)"));
  const render = find(local, n => vp.isBinaryExpression(n) && n.left.getText(local) === "x" && n.right.getText(local).includes("p.CheckboxItem"));
  const selectedFilter = find(local, n => vp.isArrowFunction(n) && n.getText(local) === "e=>i.includes(e)");
  const selected = find(local, n => vp.isVariableDeclaration(n) && n.initializer?.getText(local) === "m.filter(e)");
  assert.equal(choices.length, 1); assert.equal(render.length, 1); assert.equal(selectedFilter.length, 1); assert.equal(selected.length, 1);
  const picker = policy.injectMaxReasoning(read(policy.MAX_REASONING_ASSETS[0]), policy.MAX_REASONING_ASSETS[0]).text;
  const jsx = (type, props, key) => ({ type, props, key });
  const c = contextFunctions(picker, ["m$i"], {
    $8: { low: "low", max: "max", ultra: "ultra", persistent: "persistent" },
    Mx: { enabledReasoningEfforts: { schema: { element: { options: ["low", "max", "ultra", "persistent"] } } } },
    q: { jsx, jsxs: jsx }, oe: "row", V: "label", ee: "menu", re: "trigger", p: { Item: "reset", CheckboxItem: "checkbox" }, ue: "default", ce: "effort", r: false, c: false, E: "count",
  });
  c.f = c["m$i"];
  for (const saved of [[], ["low"], ["max"], ["ultra", "persistent"]]) {
    c.s = { options: ["low", "max", "ultra", "persistent"].map(thinkingEffort => ({ thinkingEffort })) };
    c.i = saved;
    c.m = vm.runInContext(choices[0].initializer.getText(local), c);
    assert.deepEqual(plain(c.m), ["low", "ultra", "persistent"]);
    c.e = vm.runInContext(selectedFilter[0].getText(local), c);
    assert.equal(vm.runInContext(selected[0].initializer.getText(local), c).length, saved.filter(e => e !== "max").length);
    const writes = []; c.a = update => writes.push(update);
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
