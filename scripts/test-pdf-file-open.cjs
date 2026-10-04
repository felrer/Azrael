"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");

const helperPath = path.join(__dirname, "pdf-file-open.cjs");
const source = fs.readFileSync(helperPath, "utf8");
const roots = {
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
  LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
};
const chromeAt = root => path.win32.join(root, "Google", "Chrome", "Application", "chrome.exe");

function fixture({ env = roots, installed = [chromeAt(roots.ProgramFiles)], isFile = true, statError, spawnError, automatic = true } = {}) {
  const calls = [];
  const child = new EventEmitter();
  child.unref = () => calls.push(["unref"]);
  const modules = {
    "node:fs": {
      statSync(file) {
        calls.push(["stat", file]);
        if (statError) throw statError;
        return { isFile: () => isFile };
      },
      existsSync(file) { calls.push(["exists", file]); return installed.includes(file); },
    },
    "node:path": path.win32,
    "node:url": { pathToFileURL },
    "node:child_process": {
      spawn(executable, args, options) {
        calls.push(["spawn", executable, Array.from(args), { ...options }]);
        if (automatic) queueMicrotask(() => child.emit(spawnError ? "error" : "spawn", spawnError));
        return child;
      },
    },
  };
  const exported = { exports: {} };
  vm.runInNewContext(source, {
    module: exported, exports: exported.exports, process: { env, platform: "win32" },
    require(id) { assert.ok(Object.hasOwn(modules, id), `Unexpected helper dependency: ${id}`); return modules[id]; },
  }, { filename: helperPath });
  return { open: exported.exports.openFileInChrome, calls, child };
}

test("PDF launch discovers each standard Chrome install and prefers the first available root", async () => {
  for (const root of Object.values(roots)) {
    const { open, calls } = fixture({ installed: [chromeAt(root)] });
    await open("C:\\reports\\report.pdf");
    assert.equal(calls.find(call => call[0] === "spawn")[1], chromeAt(root));
    assert.equal(calls.filter(call => call[0] === "spawn").length, 1);
  }
  const { open, calls } = fixture({ installed: Object.values(roots).map(chromeAt) });
  await open("C:\\reports\\report.pdf");
  assert.equal(calls.find(call => call[0] === "spawn")[1], chromeAt(roots.ProgramFiles));
});

test("missing Chrome rejects without launching another app or searching relative install paths", async () => {
  for (const env of [roots, {}]) {
    const { open, calls } = fixture({ env, installed: [] });
    await assert.rejects(open("C:\\reports\\report.pdf"), /Chrome/i);
    assert.ok(!calls.some(call => call[0] === "spawn"));
    assert.ok(calls.filter(call => call[0] === "exists").every(call => path.win32.isAbsolute(call[1])));
  }
});

test("missing targets and directories fail before searching Chrome or creating a process", async () => {
  const missing = Object.assign(new Error("ENOENT: PDF missing"), { code: "ENOENT" });
  for (const options of [{ isFile: false }, { statError: missing }]) {
    const { open, calls } = fixture(options);
    await assert.rejects(open("C:\\reports\\missing.pdf"));
    assert.deepEqual(calls, [["stat", "C:\\reports\\missing.pdf"]]);
  }
});

test("Chrome receives an encoded HTML file URL as one shell-free detached argument", async () => {
  const file = "C:\\보고서 폴더\\실험 #1.html";
  const { open, calls } = fixture();
  await open(file);
  const launch = calls.find(call => call[0] === "spawn");
  assert.deepEqual(launch[2], [pathToFileURL(file).href]);
  assert.match(launch[2][0], /^file:\/\//);
  assert.match(launch[2][0], /%20/);
  assert.match(launch[2][0], /%23/);
  assert.match(launch[2][0], /%[A-F0-9]{2}/);
  assert.equal(new URL(launch[2][0]).hash, "");
  assert.deepEqual(launch[3], { shell: false, windowsHide: true, detached: true, stdio: "ignore" });
  assert.equal(calls.at(-1)[0], "unref");
});

test("PDF handling waits for successful spawn before resolving and unrefing Chrome", async () => {
  const { open, calls, child } = fixture({ automatic: false });
  let resolved = false;
  const pending = open("C:\\reports\\report.pdf").then(() => { resolved = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolved, false);
  assert.ok(!calls.some(call => call[0] === "unref"));
  child.emit("spawn");
  await pending;
  assert.equal(resolved, true);
  assert.equal(calls.filter(call => call[0] === "unref").length, 1);
});

test("asynchronous Chrome spawn failure propagates and does not unref", async () => {
  const failure = Object.assign(new Error("Chrome spawn EACCES"), { code: "EACCES" });
  const { open, calls } = fixture({ spawnError: failure });
  await assert.rejects(open("C:\\reports\\report.pdf"), error => error === failure);
  assert.equal(calls.filter(call => call[0] === "spawn").length, 1);
  assert.ok(!calls.some(call => call[0] === "unref"));
});
