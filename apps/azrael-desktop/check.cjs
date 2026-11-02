"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { transform } = require("./image-bridge.cjs");
const files = ["main.cjs", "vscode-host.cjs", "file-service.cjs", "terminal-service.cjs", "dialog-service.cjs", "theme.cjs", "preload.cjs", "shell-preload.cjs", "image-bridge.cjs", "verify.cjs", "fixture-backend.cjs", "verification.cjs", "renderer/shell.mjs", "renderer/detail-panel.mjs", "renderer/dialogs.mjs"];
for (const file of files) {
  const check = spawnSync(process.execPath, ["--check", path.join(__dirname, file)], { encoding: "utf8", windowsHide: true });
  if (check.status !== 0) throw new Error(`${file}: ${check.stderr}`);
}
// A pinned UI upgrade can change the provider tree. Fail before serving an
// unadapted image route; never silently replace the native viewer.
const filename = "app-initial-c014f9ee4429.js";
const original = fs.readFileSync(path.resolve(__dirname, "../../artifacts/upstream-ui/26.1007.21434/webview/assets", filename), "utf8");
const result = transform(filename, original);
assert.notEqual(result, original);
assert.equal(transform("unrelated.js", original), original);
assert.throws(() => transform(filename, ""), /anchor/);
assert.throws(() => transform(filename, result), /already applied/);
const parse = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: result, encoding: "utf8", windowsHide: true });
if (parse.status !== 0) throw new Error(parse.stderr);
const bundle = require("esbuild").buildSync({ entryPoints: [path.join(__dirname, "renderer/shell.mjs")], bundle: true, format: "esm", write: false, outdir: "unused", logLevel: "silent" });
assert(bundle.outputFiles.some(file => file.path.endsWith(".js")));
assert(bundle.outputFiles.some(file => file.path.endsWith(".css")));
console.log(`Desktop source syntax (${files.length}), in-memory renderer bundle and pinned image provider adaptation passed.`);
