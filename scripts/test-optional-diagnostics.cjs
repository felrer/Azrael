"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const policy = require("./optional-diagnostics.cjs");
const source = fs.readFileSync(require("node:path").join(__dirname, "../extensions/azrael-ex/src/optionalDiagnostics.ts"), "utf8");
const exportsValue = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: exportsValue, process });
test("host and account policies preserve defaults, override and fallback consistently", () => {
  for (const implementation of [policy, exportsValue]) {
    for (const category of ["RECOVERY", "UI_INPUT", "ACCOUNTS"]) {
      for (const value of [undefined, "", "invalid", "0;throw", "TRUE-ish"]) {
        assert.equal(implementation.diagnosticsEnabled(category, { AZRAEL_DIAGNOSTICS: value }), true);
        assert.equal(implementation.diagnosticsEnabled(category, { AZRAEL_DIAGNOSTICS: "off", [`AZRAEL_DIAGNOSTICS_${category}`]: value }), false);
      }
      for (const value of ["1", " true ", "ON"]) {
        assert.equal(implementation.diagnosticsEnabled(category, { AZRAEL_DIAGNOSTICS: value }), true);
        assert.equal(implementation.diagnosticsEnabled(category, { AZRAEL_DIAGNOSTICS: "off", [`AZRAEL_DIAGNOSTICS_${category}`]: value }), true);
      }
      for (const value of ["0", " FALSE ", "Off"]) {
        assert.equal(implementation.diagnosticsEnabled(category, { AZRAEL_DIAGNOSTICS: value }), false);
        assert.equal(implementation.diagnosticsEnabled(category, { AZRAEL_DIAGNOSTICS: "on", [`AZRAEL_DIAGNOSTICS_${category}`]: value }), false);
      }
    }
  }
});
test("account helper operations succeed quietly when off, errors remain, and override restores logs", async () => {
  const { EventEmitter } = require("node:events");
  const filename = require("node:path").join(__dirname, "../extensions/azrael-ex/src/providerAccountService.ts");
  const serviceExports = {}, logs = [];
  let failure = false, calls = 0;
  const spawn = () => {
    calls++;
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
    child.stderr = { resume() {} }; child.kill = () => {};
    child.stdin = new EventEmitter(); child.stdin.destroy = () => {};
    child.stdin.write = line => {
      const request = JSON.parse(line);
      setImmediate(() => child.stdout.emit("data", JSON.stringify({ id: request.id,
        type: failure ? "error" : "result", ...(failure ? { error: "fixture operation failed" } : { value: "done" }) }) + "\n"));
    };
    return child;
  };
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports: serviceExports, process, Buffer, setTimeout, clearTimeout,
    require: name => name === "node:child_process" ? { spawn } : name === "./optionalDiagnostics" ? exportsValue :
      name === "./protocol" ? { isRecord: value => value !== null && typeof value === "object" && !Array.isArray(value) } : require(name) });
  for (const [master, override, expected] of [[undefined, undefined, 2], ["off", undefined, 0], ["off", "on", 2]]) {
    const service = new serviceExports.ProviderAccountService(require("node:path").resolve("artifacts"), {
      AZRAEL_PROVIDER_BUN: process.execPath, AZRAEL_PROVIDER_ACCOUNTS_HELPER: filename,
      AZRAEL_DIAGNOSTICS: master, AZRAEL_DIAGNOSTICS_ACCOUNTS: override
    }, { log: record => logs.push(record) });
    const count = logs.length;
    assert.equal(await service.request("snapshot", {}), "done");
    assert.equal(logs.length-count, expected);
    failure = true;
    await assert.rejects(service.request("snapshot", {}), /fixture operation failed/);
    assert.equal(logs.at(-1).phase, "failed");
    assert.ok(logs.at(-1).requestId); failure = false;
    service.dispose();
  }
  assert.equal(calls, 6);
});
