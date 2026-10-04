"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { FILE_OPEN_MENU_ASSET, ANCHOR, MARKER, REPLACEMENT, injectFileOpenMenu } = require("./inject-file-open-menu.cjs");
const root = process.env.AZRAEL_PINNED_HOST_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.928.31416");
const original = fs.readFileSync(path.join(root, FILE_OPEN_MENU_ASSET), "utf8");

function menuFixture({ remote = false } = {}) {
  const text = injectFileOpenMenu(original, FILE_OPEN_MENU_ASSET).text;
  const menuCode = text.slice(text.indexOf("function lE("), text.indexOf("function uE("));
  const openCode = text.slice(text.indexOf("function RC("), text.indexOf("function zC("))
    .replaceAll("import.meta.url", '"file:///pinned-test.js"');
  const calls = [];
  const host = { id: "local", remote };
  const context = {
    pf: "host", Ms: "capability", pC: "targets", Du: "platform", mh: "thread", kC: "mutation",
    oE: () => ({ primaryTarget: null, visibleTargets: [] }),
    Gc: h => h.remote, Ja: () => false, Ef: () => "thread-1",
    R_: (cwd, file) => path.win32.join(cwd, file), Ai: () => "C:\\project",
    f: message => message.defaultMessage, uE: () => "탐색기에서 열기",
    dE: { copyPath: "경로 복사" },
    W: { clipboard: { writeText: value => { calls.push(["copy-path", value]); return Promise.resolve(); } } },
    iE: (_query, value) => calls.push(["copy-contents", value]),
  };
  const scope = {
    value: {}, queryClient: {}, query: { getData: () => ({}) },
    getOwnValue: () => ({ clientThreadId: "thread-1" }),
    get(key) {
      if (key === "host") return host;
      if (key === "capability") return { isCapable: false };
      if (key === "platform") return { data: { platform: "win32" } };
      if (key === "mutation") return { mutate: value => calls.push(["open", value]) };
      throw new Error(`Unexpected state: ${key}`);
    },
  };
  const buildMenu = vm.runInNewContext(`${openCode};${menuCode};lE`, context);
  return { calls, menu: buildMenu(scope, { hostId: "local", path: "report.HTML", cwd: "C:\\project", line: 7, column: 3 }) };
}

test("pinned file menu explicitly routes VS Code with the original path and selection", () => {
  const { menu, calls } = menuFixture();
  assert.deepEqual(Array.from(menu, item => item.id), [
    "workspace-file-open-vscode", "workspace-file-copy-path", "workspace-file-copy-contents", "workspace-file-reveal-path",
  ]);
  const item = menu.find(item => item.id === "workspace-file-open-vscode");
  assert.equal(item.message, "VS Code에서 열기");
  item.onSelect();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "open");
  const request = calls[0][1];
  assert.equal(request.target, "vscode");
  assert.equal(request.path, "report.HTML");
  assert.equal(request.cwd, "C:\\project");
  assert.equal(request.line, 7);
  assert.equal(request.column, 3);
  assert.equal(request.hostId, "local");
});

test("file menu retains copy and file manager actions and excludes VS Code on remote hosts", () => {
  const { menu, calls } = menuFixture();
  for (const item of menu.slice(1)) item.onSelect();
  assert.deepEqual(calls.map(call => call[0]), ["copy-path", "copy-contents", "open"]);
  assert.equal(calls[0][1], "C:\\project\\report.HTML");
  assert.equal(calls[2][1].target, "fileManager");
  assert.ok(!menuFixture({ remote: true }).menu.some(item => item.id === "workspace-file-open-vscode"));
});

test("menu transform participates in the host transform and cache fingerprint", () => {
  const ts = require("../extensions/azrael-ex/node_modules/typescript");
  const { transformAsset, getTransformRules } = require("./namespace-azrael-host.cjs");
  const result = transformAsset(original, FILE_OPEN_MENU_ASSET, FILE_OPEN_MENU_ASSET, ts);
  assert.equal(result.asset.fileOpenMenuEdits, 1);
  assert.ok(result.text.includes(REPLACEMENT));
  assert.ok(Object.hasOwn(getTransformRules(), "inject-file-open-menu.cjs"));
  const { createAssetTransformCache } = require("./asset-transform-cache.cjs");
  const temporaryRoot = path.resolve(__dirname, "../artifacts/tmp");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const cacheDirectory = fs.mkdtempSync(path.join(temporaryRoot, "azrael-file-menu-cache-"));
  try {
    const statistics = { hits: 0, misses: 0 };
    const cache = createAssetTransformCache({ cacheDirectory, typescriptSha256: "a".repeat(64),
      typescriptVersion: ts.version, transformRules: getTransformRules(), statistics });
    cache.run(FILE_OPEN_MENU_ASSET, original, () => result);
    const cached = cache.run(FILE_OPEN_MENU_ASSET, original, () => { throw new Error("Cache missed"); });
    assert.equal(cached.asset.fileOpenMenuEdits, 1);
    assert.equal(statistics.hits, 1);
  } finally {
    assert.equal(path.dirname(cacheDirectory), temporaryRoot);
    fs.rmSync(cacheDirectory, { recursive: true, force: true });
  }
});

test("menu transform is idempotent, scoped to its asset and rejects ambiguous pinned input", () => {
  const result = injectFileOpenMenu(original, FILE_OPEN_MENU_ASSET);
  assert.equal(result.count, 1);
  assert.equal(injectFileOpenMenu(result.text, FILE_OPEN_MENU_ASSET).count, 0);
  assert.equal(injectFileOpenMenu(original, "other.js").text, original);
  for (const input of ["unrelated", ANCHOR + ANCHOR, MARKER + ANCHOR, REPLACEMENT.replace("vscode", "other")]) {
    assert.throws(() => injectFileOpenMenu(input, FILE_OPEN_MENU_ASSET), /marker|anchor/);
  }
});
