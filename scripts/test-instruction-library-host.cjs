"use strict";
// Compile only the exact host test inputs in memory; never build or install the app.
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const tests = ["instructionView", "instructionService", "instructionLibraryService"];
if (process.argv[2] === "--run-ts") {
  const name = process.argv[3];
  if (!tests.includes(name)) throw new Error("Unknown instruction host test");
  const ts = require(path.join(root, "extensions/azrael-ex/node_modules/typescript"));
  require.extensions[".ts"] = (module, filename) => {
    const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      fileName: filename,
    });
    module._compile(result.outputText, filename);
  };
  require(path.join(root, `extensions/azrael-ex/test/${name}.test.ts`));
} else {
  const test = require("node:test");
  const assert = require("node:assert/strict");
  for (const name of tests) test(`instruction host ${name}`, () => {
    const result = spawnSync(process.execPath, [__filename, "--run-ts", name], {
      cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
  });
}
