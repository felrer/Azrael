"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { transformAsset } = require("./namespace-azrael-host.cjs");
const { injectErrorPresentation, ERROR_PRESENTATION_ASSET: asset, ERROR_PRESENTATION_MARKER: marker } = require("./inject-error-presentation.cjs");
const source = fs.readFileSync(`${process.env.AZRAEL_PRESERVATION_UI_ROOT ?? 'artifacts/upstream-ui/26.1007.21434'}/${asset}`, "utf8");
const changed = injectErrorPresentation(source, asset);
function selector(text = changed.text) {
  const start = text.indexOf(marker), end = text.indexOf("var Qdn;", start);
  assert(start >= 0 && end > start);
  const context = vm.createContext({ Qdn: {}, utn: () => null, yNe: value => {
    try { const data = JSON.parse(value); return { success: typeof data?.error?.message === "string", data }; } catch { return { success: false }; }
  } });
  vm.runInContext(text.slice(start, end), context);
  return { context, render: context.Zdn };
}
test("guarded integrated native error transform is idempotent, parsed and accounted", () => {
  assert.equal(changed.count, 1);
  assert.equal(injectErrorPresentation(changed.text, asset).count, 0);
  assert.equal(injectErrorPresentation(source, "other.js").count, 0);
  assert.throws(() => injectErrorPresentation("", asset), /anchor/);
  assert.throws(() => injectErrorPresentation(source + source, asset), /anchor/);
  assert.throws(() => injectErrorPresentation(changed.text + marker, asset), /Duplicate/);
  const integrated = transformAsset(source, asset, asset, ts);
  assert.equal(integrated.asset.errorPresentationEdits, 1);
  assert.equal(ts.createSourceFile(asset, integrated.text, 99, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
  assert.equal(selector(integrated.text).render({ message: "unknown PRIVATE", errorInfo: "other" }), "정의되지 않은 오류");
});
test("native current/history selector hides unknown nested detail and preserves exact evidence", () => {
  const { render, context } = selector();
  for (const message of ["PRIVATE", "not an auth failure", "quota billing config", JSON.stringify({ error: { message: "PRIVATE_NESTED" } })]) {
    assert.equal(render({ message, errorInfo: "other" }), "정의되지 않은 오류");
  }
  for (const detail of ["모델 입력 토큰 처리량 제한에 도달했습니다.", "모델 요청 수 제한에 도달했습니다."]) {
    assert.equal(render({ message: "rate limit exceeded: " + detail, errorInfo: "rateLimitExceeded" }), detail);
  }
  assert.equal(render({ message: "PRIVATE", errorInfo: "usageLimitExceeded" }), "The provider usage limit was reached. Check account usage before resuming.");
  assert.equal(render({ message: "rate limit exceeded: Provider request rate limit reached. Try again later.", errorInfo: "rateLimitExceeded" }), "정의되지 않은 오류");
  for (const message of [
    "The provider account was removed. Work was stopped. Select a healthy account before continuing.",
    "The provider account requires reauthentication. Work was stopped. Sign in again or select a healthy account before continuing.",
    "Attached images exceed the provider request limit. Remove images or start a new thread.",
    ...["unsupported_image_format", "remote_image_unsupported", "invalid_image_input"].map(code =>
      `This provider accepts PNG, JPEG, GIF or WebP image attachments only (${code})`),
  ]) {
    assert.equal(render({ message, errorInfo: "badRequest" }), message);
    assert.equal(render({ message, errorInfo: "other" }), "정의되지 않은 오류");
    assert.notEqual(render({ message: "Quoted: " + message, errorInfo: "badRequest" }), message);
    assert.equal(render({ message, errorInfo: "unauthorized" }), "The selected provider rejected authentication. Check account authentication before resuming.");
  }
  assert.equal(render({ message: "PRIVATE", errorInfo: "other", willRetry: true }), null);
  assert.equal(render({ message: "PRIVATE", errorInfo: "misalignmentPolicyViolation" }), null);
  context.utn = () => ({});
  assert.equal(render({ message: "PRIVATE", errorInfo: "other" }), null);
});
module.exports = { selector };
