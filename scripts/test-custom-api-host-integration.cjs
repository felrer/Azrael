"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const { injectProviderModelPicker, PROVIDER_PICKER_ASSET, PROVIDER_QUERY_ASSET } = require("./inject-provider-model-picker.cjs");
const root = path.resolve(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434"));

test("API picker preserves pinned syntax and exposes the registered host management command", () => {
  for (const asset of [PROVIDER_QUERY_ASSET, PROVIDER_PICKER_ASSET]) {
    const source = fs.readFileSync(path.join(root, asset), "utf8");
    const transformed = injectProviderModelPicker(source, asset);
    assert.equal(transformed.count, 1);
    assert.equal(ts.createSourceFile(asset, transformed.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
    assert.equal(injectProviderModelPicker(transformed.text, asset).count, 0);
    if (asset === PROVIDER_QUERY_ASSET) {
      const callback = transformed.text.match(/globalThis\.__azraelOpenApiConnections=\(\)=>vm\.dispatchMessage\([^;]+?\}\)/)?.[0];
      assert(callback, "initialized management callback");
      const calls = [];
      const context = { vm: { dispatchMessage: (...args) => calls.push(args) } };
      vm.runInNewContext(callback, context);
      context.__azraelOpenApiConnections();
      assert.equal(calls[0][0], "open-vscode-command");
      assert.equal(calls[0][1].command, "azrael.apiConnections");
    } else {
      assert(transformed.text.includes('o.model.startsWith(`api/`)'), "API models bypass native-provider visibility restrictions");
      assert(transformed.text.includes('r?.model?.startsWith(`api/`)'), "API selection is not reset to native power defaults");
    }
  }
});
