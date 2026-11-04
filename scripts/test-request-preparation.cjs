"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { ASSET, MARKER, injectRequestPreparation } = require("./inject-request-preparation.cjs");
const root = process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve("artifacts/upstream-ui/26.1007.21434");
const pristine = fs.readFileSync(path.join(root, ASSET), "utf8");
const transformed = injectRequestPreparation(pristine, ASSET);

// Execute the pinned builder and shell-policy implementation, not a second
// implementation of either. These tests retain the concurrency/dependency gate.
function functions(source) {
  const names = new Set(["SDn", "wDn", "pDn", "mDn", "gDn", "hDn", "bDn", "_Dn", "yDn", "vDn"]);
  const found = new Map();
  const ast = ts.createSourceFile(ASSET, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0);
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) {
      assert.equal(found.has(node.name.text), false, `unique ${node.name.text}`);
      found.set(node.name.text, node.getText(ast));
    } else ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(found.size, names.size);
  return [...found.values()].join("\n");
}
const baselineFunctions = functions(pristine);
const patchedFunctions = functions(transformed.text);
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const tools = [
  { type: "namespace", tools: ["create_worktree", "archive_worktree", "restore_worktree", "list_artifacts", "thread_tool", "special_tool"].map(name => ({ name })) },
];
function fixture({ source = patchedFunctions, shell = true, dynamic = true, instructions = true, shellGate, toolsGate, paramsGate, desktop = false, register = true, hostConfig, shellFailure, toolsValue = tools, shellValue = { shellEnvironment: { set: { TASK: "shell" }, exclude: ["DROP"] } } } = {}) {
  const calls = [], marks = [], warnings = [];
  const args = {
    cwd: "project", serviceTier: "priority", model: "model", defaultFeatureOverrides: {},
    allowMemoryPromptOverrides: true, instructionOverrides: { memoryReadPrompt: "memory", desktopContextSection: "desktop" },
    usesDesktopMcp: desktop, registerDynamicTools: register,
    writingBlockInstructions: true, additionalDeveloperInstructions: "extra", hostConfig,
  };
  const requestClient = {
    hostId: "local", getAppServerVersion: () => "version",
    sendRequest: async (...values) => { calls.push(["request", ...values]); return {}; },
  };
  const deps = {
    requestClient, logger: { warning: (...values) => warnings.push(values) },
    markPreparation: value => marks.push(value),
    async readDeveloperInstructions(value, priority) {
      calls.push(["instructions", plain(value), priority]);
      return { instructions: "generated" };
    },
  };
  if (!instructions) delete deps.readDeveloperInstructions;
  if (shell) deps.readShellEnvironment = async priority => {
    calls.push(["shell", priority]);
    if (shellFailure) throw shellFailure;
    return shellGate ? shellGate.promise : shellValue;
  };
  if (dynamic) deps.readDynamicTools = async () => {
    calls.push(["tools"]);
    return toolsGate ? toolsGate.promise : toolsValue;
  };
  const context = vm.createContext({
    Promise, JZ: 321, Fn: "special_tool", Tn: "special instructions", Tt: "writing instructions",
    xDn: async (tier, logger, read) => { await read(); if (paramsGate) await paramsGate.promise; return {}; },
    _n: async () => { calls.push(["parameters"]); return { cwd: "resolved", developerInstructions: "base", config: { original: "yes", "shell_environment_policy.set": { DROP: "old" } } }; },
    E: () => ({}),
    be: value => { calls.push(["overrides"]); return { ...value, config: { ...value.config, override: true } }; },
    p1: async (...values) => { calls.push(["host", ...values]); return { "shell_environment_policy.inherit": "none" }; },
    ln: value => { calls.push(["flags", plain(value)]); return value.dynamicTools.some(item => item.tools?.some(tool => tool.name === "thread_tool")); },
    Ie: value => { calls.push(["register", plain(value)]); return value; },
    Ve: () => "desktop_tools",
  });
  const build = vm.runInContext(`${source}\nSDn`, context);
  return { args, deps, calls, marks, warnings, run: () => build(args, deps, "critical") };
}

test("guarded injection is idempotent, preserves bytes outside SDn, and rejects drift", () => {
  assert.equal(transformed.count, 1);
  assert.deepEqual(injectRequestPreparation(transformed.text, ASSET), { text: transformed.text, count: 0 });
  assert.deepEqual(injectRequestPreparation(pristine, "other.js"), { text: pristine, count: 0 });
  // Outside SDn only the terminal marker may change.
  const getBuilder = source => {
    const ast = ts.createSourceFile(ASSET, source, 99, true, 1);
    return ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "SDn").getText(ast);
  };
  assert.equal(transformed.text.replace(getBuilder(transformed.text), "BUILDER"), pristine.replace(getBuilder(pristine), "BUILDER") + `\n${MARKER}\n`);
  for (const anchor of ["let c=t.readShellEnvironment;", "let n=await t.readDynamicTools();"]) {
    assert.throws(() => injectRequestPreparation(pristine.replace(anchor, "damaged"), ASSET), /anchors/);
  }
  assert.throws(() => injectRequestPreparation(pristine + pristine, ASSET), /anchors/);
  assert.throws(() => injectRequestPreparation(transformed.text + MARKER, ASSET), /Damaged/);
  assert.throws(() => injectRequestPreparation(transformed.text.replace("await Promise.all([azraelPreparationShell", "await Promise.race([azraelPreparationShell"), ASSET), /Damaged/);
  assert.throws(() => injectRequestPreparation(transformed.text.replace(MARKER, ""), ASSET), /anchors/);
});

test("both reads start after parameters/overrides; instructions and flags await both results", async () => {
  const shellGate = deferred(), toolsGate = deferred(), paramsGate = deferred();
  const f = fixture({ shellGate, toolsGate, paramsGate });
  const pending = f.run();
  await tick();
  assert.deepEqual(f.calls.map(call => call[0]), ["request"]);
  paramsGate.resolve();
  await tick();
  assert.deepEqual(f.calls.map(call => call[0]), ["request", "parameters", "overrides", "shell", "tools"]);
  toolsGate.resolve(tools);
  await tick();
  assert.equal(f.calls.some(call => ["flags", "instructions"].includes(call[0])), false);
  shellGate.resolve({ shellEnvironment: { set: { TASK: "shell" }, exclude: ["DROP"] } });
  const actual = await pending;
  assert.deepEqual(plain(actual), {
    cwd: "resolved", developerInstructions: "generated\n\nspecial instructions\n\nwriting instructions\n\nextra",
    config: { original: "yes", "memories.read_prompt": "memory", override: true,
      "shell_environment_policy.inherit": "none", "shell_environment_policy.exclude": ["DROP"], "shell_environment_policy.set": { TASK: "shell" } },
    dynamicTools: tools,
  });
  assert.deepEqual(f.calls.map(call => call[0]), ["request", "parameters", "overrides", "shell", "tools", "host", "flags", "register", "instructions"]);
  assert.equal(f.calls.find(call => call[0] === "flags")[1].config, null);
  assert.deepEqual(f.calls.find(call => call[0] === "instructions"), ["instructions", {
    baseInstructions: "base", cwd: "resolved", instructionOverrides: { desktopContextSection: "desktop" },
    threadId: null, threadToolsEnabled: true, worktreeToolsEnabled: true, hostId: "local",
  }, "critical"]);
  assert.deepEqual(f.marks, ["request_parameters_started", "request_parameters_finished", "shell_environment_started", "dynamic_tools_started", "dynamic_tools_finished", "shell_environment_finished", "instructions_started", "instructions_finished"]);
});

test("shell completion cannot start dependent instructions while tools remain pending", async () => {
  const toolsGate = deferred();
  const f = fixture({ toolsGate });
  const pending = f.run();
  await tick();
  assert.ok(f.marks.includes("shell_environment_finished"));
  assert.equal(f.calls.some(call => call[0] === "instructions"), false);
  toolsGate.resolve(tools);
  await pending;
});

test("native output bytes and optional/desktop tool behavior remain unchanged", async () => {
  for (const options of [{}, { shell: false }, { dynamic: false }, { shell: false, dynamic: false }, { desktop: true }, { register: false }, { hostConfig: null }, { shellValue: { shellEnvironment: null } }, { toolsValue: [] }, { instructions: false }]) {
    const native = fixture({ ...options, source: baselineFunctions }), patched = fixture(options);
    assert.equal(JSON.stringify(await patched.run()), JSON.stringify(await native.run()), JSON.stringify(options));
    assert.deepEqual([...patched.marks].sort(), [...native.marks].sort());
    assert.deepEqual(patched.calls.find(call => call[0] === "instructions"), native.calls.find(call => call[0] === "instructions"));
    if (options.shell === false) assert.equal(patched.marks.some(mark => mark.startsWith("shell_")), false);
    if (options.dynamic === false) assert.equal(patched.marks.some(mark => mark.startsWith("dynamic_")), false);
  }
});

test("shell read failure keeps native warning and request; tools failure propagates", async () => {
  const error = new Error("shell failed");
  const native = fixture({ source: baselineFunctions, shellFailure: error }), patched = fixture({ shellFailure: error });
  assert.equal(JSON.stringify(await patched.run()), JSON.stringify(await native.run()));
  assert.deepEqual(plain(patched.warnings), plain(native.warnings));
  assert.equal(patched.warnings[0][1].sensitive.error, error);
  for (const synchronous of [false, true]) {
    const toolsGate = deferred(), shellGate = deferred(), failure = new Error("tools failed");
    const f = fixture({ shellGate, toolsGate });
    if (synchronous) f.deps.readDynamicTools = () => { throw failure; };
    const pending = f.run();
    const observed = assert.rejects(pending, error => error === failure);
    await tick();
    if (!synchronous) toolsGate.reject(failure);
    await observed;
    assert.equal(f.calls.some(call => call[0] === "instructions"), false);
    // The other branch is still observed after Promise.all has rejected.
    shellGate.reject(new Error("later shell failure"));
    await tick();
    assert.equal(f.warnings.length, 1);
  }
});

test("Promise.all observes a late rejection from either independent branch", async () => {
  for (const first of ["shell", "tools"]) {
    const shellGate = deferred(), toolsGate = deferred(), unhandled = [];
    const shellError = new Error("shell branch failed"), toolsError = new Error("tools branch failed");
    const listener = error => unhandled.push(error);
    process.on("unhandledRejection", listener);
    try {
      const f = fixture({ shellGate, toolsGate });
      // wDn normally catches shell errors; a throwing completion observer tests
      // Promise.all's protection even if that branch itself rejects.
      f.deps.markPreparation = mark => { if (mark === "shell_environment_finished") throw shellError; };
      const pending = f.run();
      const observed = assert.rejects(pending, error => error === (first === "shell" ? shellError : toolsError));
      await tick();
      if (first === "shell") shellGate.resolve({ shellEnvironment: null });
      else toolsGate.reject(toolsError);
      await observed;
      if (first === "shell") toolsGate.reject(toolsError);
      else shellGate.resolve({ shellEnvironment: null });
      await tick();
      assert.deepEqual(unhandled, []);
      assert.equal(f.calls.some(call => call[0] === "instructions"), false);
    } finally {
      process.off("unhandledRejection", listener);
    }
  }
});
