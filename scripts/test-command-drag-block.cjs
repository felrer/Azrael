"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { installCommandDragBlock, wrapCommandDragBlock, COMMAND_DRAG_CSS } = require("./command-drag-policy.cjs");
const { ASSETS, CSS_ASSET, ACTIVITY_ASSET, SHELL_ASSET, injectCommandDragBlock } = require("./inject-command-drag-block.cjs");
const uiRoot = process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434");

test("only command scopes cancel selection and drag; disposal releases both capture listeners", () => {
  const listeners = new Map();
  const document = {
    addEventListener(name, callback, capture) { assert.equal(capture, true); listeners.set(name, callback); },
    removeEventListener(name, callback, capture) { assert.equal(capture, true); assert.equal(listeners.get(name), callback); listeners.delete(name); },
  };
  const dispose = installCommandDragBlock({ document });
  assert.deepEqual([...listeners.keys()], ["selectstart", "dragstart"]);
  for (const name of listeners.keys()) for (const inside of [true, false]) {
    const element = { closest(selector) { assert.equal(selector, ".azrael-command-execution"); return inside ? this : null; } };
    for (const target of [element, { parentElement: element }]) {
      let prevented = false, stopped = false;
      listeners.get(name)({ target, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
      assert.equal(prevented, inside); assert.equal(stopped, inside);
    }
  }
  assert.equal(listeners.has("mousedown"), false); assert.equal(listeners.has("drop"), false);
  dispose(); assert.equal(listeners.size, 0);
});

test("dynamic execution results are scoped without changing unrelated tool and message nodes", () => {
  const content = {}, jsx = (tag, props) => ({ tag, ...props });
  for (const tool of ["exec", "exec_command", "write_stdin"]) for (const namespace of [undefined, "functions"]) {
    const result = wrapCommandDragBlock({ type: "dynamic-tool-call", tool, namespace }, content, jsx);
    assert.equal(result.className, "azrael-command-execution"); assert.equal(result.children, content);
  }
  for (const item of [{ type: "assistant-message" }, { type: "dynamic-tool-call", namespace: "other", tool: "exec" }, { type: "dynamic-tool-call", namespace: "functions", tool: "search" }]) {
    assert.equal(wrapCommandDragBlock(item, content, jsx), content);
  }
});

test("pinned assets keep native controls, reject drift and remain idempotent", () => {
  const ts = require(process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH ?? "../extensions/azrael-ex/node_modules/typescript");
  for (const asset of ASSETS) {
    const original = fs.readFileSync(path.join(uiRoot, asset), "utf8");
    const result = injectCommandDragBlock(original, asset);
    assert.equal(result.count, 1); assert.equal(injectCommandDragBlock(result.text, asset).count, 0);
    if ([ACTIVITY_ASSET, SHELL_ASSET].includes(asset)) {
      const strip = text => [...text.matchAll(/onClick:[^,}]+|onKeyDown:[^,}]+|onCopy:[^,}]+/g)].map(match => match[0]);
      assert.deepEqual(strip(result.text), strip(original));
      assert.equal(ts.createSourceFile(asset, result.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0);
    }
  }
  const shell = fs.readFileSync(path.join(uiRoot, SHELL_ASSET), "utf8");
  assert.throws(() => injectCommandDragBlock(shell.replace("De=d(`flex flex-col overflow-clip`,Ee)", "De=changed"), SHELL_ASSET), /Pinned/);
  assert.throws(() => injectCommandDragBlock(injectCommandDragBlock(shell, SHELL_ASSET).text.replace("azrael-command-execution", "damaged"), SHELL_ASSET), /Damaged/);
  assert.match(COMMAND_DRAG_CSS, /user-select:none!important/);
  assert.equal(injectCommandDragBlock("ordinary text", "unrelated.js").count, 0);
});

test("namespace CSS composition preserves typography and scroll-fade guards; scoped cache inputs are bound", () => {
  const namespace = require("./namespace-azrael-host.cjs");
  const ts = require(process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH ?? "../extensions/azrael-ex/node_modules/typescript");
  const css = fs.readFileSync(path.join(uiRoot, CSS_ASSET), "utf8");
  const result = namespace.transformAsset(css, CSS_ASSET, CSS_ASSET, ts);
  assert.equal(result.asset.commandDragBlockEdits, 1); assert.equal(result.asset.scrollFadeEdits, 4);
  assert.equal(namespace.transformAsset(result.text, CSS_ASSET, CSS_ASSET, ts).asset, null);
  const rules = namespace.getTransformRules();
  for (const asset of ASSETS) for (const owner of ["inject-command-drag-block.cjs", "command-drag-policy.cjs"]) assert.ok(namespace.getAssetTransformRules(asset, rules)[owner]);
  assert.equal(namespace.getAssetTransformRules("unrelated.js", rules)["command-drag-policy.cjs"], undefined);
});
