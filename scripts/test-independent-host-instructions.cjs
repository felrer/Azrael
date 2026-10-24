"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "independent-vscode-host-check.cjs"), "utf8");
const sentinel = '<p class="error" data-client-error role="alert"></p>';
async function verify(suffix, mutate = value => value) {
  const calls = [], context = { exports: {}, process, console, Buffer, setTimeout, clearTimeout };
  context.require = name => name === "vscode" ? { commands: { executeCommand: async (command, receiver, request) => {
    calls.push(request);
    if (request.action === "mount") {
      const locale = request.locale;
      const html = `<main lang="${locale}" aria-label="${locale === "ko" ? "지침 라이브러리" : "Instruction library"}" data-library-revision="0"><summary>${locale === "ko" ? "기본 지침 배포" : "Baseline distribution"}</summary>${suffix}</main>`;
      await receiver.postMessage(mutate({ type: "azrael-instructions-state", clientId: request.clientId, requestId: request.requestId, html }));
    }
  } } } : require(name);
  vm.runInNewContext(source + "\nexports.verifyInstructions = verifyEmbeddedInstructions;", context);
  const diagnostics = {};
  try { return await context.exports.verifyInstructions(diagnostics); }
  finally { assert.equal(calls.at(-1).action, "unmount"); }
}
test("installed instruction view accepts its exact empty live-error target in both locales", async () => {
  const result = await verify(sentinel);
  assert.equal(result.locales.length, 2);
  for (const locale of result.locales) { assert.equal(locale.passed, true); assert.equal(locale.hasAlert, false); }
});
test("installed instruction view without an alert also passes", async () => { await verify(""); });
for (const [name, html] of [
  ["populated client error", sentinel.replace("></p>", ">failure</p>")],
  ["other alert", '<div role="alert">failure</div>'],
  ["unexpected empty alert", '<div role="alert"></div>'],
  ["later alert", sentinel + '<div role="alert">later failure</div>'],
  ["duplicate sentinel", sentinel + sentinel],
  ["missing module", sentinel + "Cannot find module: instructionLibrary"],
]) test(`installed instruction view rejects ${name}`, async () => { await assert.rejects(verify(html), /rendered an instruction error/); });
test("later alert retains its useful diagnostic excerpt", async () => {
  await assert.rejects(verify(sentinel + '<div role="alert">later failure</div>'), /later failure/);
});
for (const [name, mutate, error] of [
  ["wrong response", value => ({ ...value, type: "wrong" }), /wrong response type/],
  ["wrong client", value => ({ ...value, clientId: "wrong" }), /mismatched client/],
  ["wrong request", value => ({ ...value, requestId: "wrong" }), /mismatched client/],
  ["missing revision", value => ({ ...value, html: value.html.replace('data-library-revision="0"', "") }), /personal library revision/],
  ["missing baseline", value => ({ ...value, html: value.html.replace(/<summary>.*?<\/summary>/, "") }), /baseline distribution/],
  ["wrong locale", value => ({ ...value, html: value.html.replace('lang="ko"', 'lang="wrong"') }), /requested locale/],
]) test(`installed instruction view retains ${name} rejection`, async () => { await assert.rejects(verify(sentinel, mutate), error); });
