"use strict";

const assert = require("node:assert/strict");
const vo = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { FILE_OPEN_MENU_ASSET, ANCHOR, MARKER, REPLACEMENT, injectFileOpenMenu } = require("./inject-file-open-menu.cjs");
const root = process.env.AZRAEL_PRESERVATION_UI_ROOT ?? process.env.AZRAEL_PINNED_HOST_ROOT ?? path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434"));
const _s = require("../extensions/azrael-ex/node_modules/typescript");
const original = vo.readFileSync(path.join(root, FILE_OPEN_MENU_ASSET), "utf8");


function pinnedExpression(source, name, predicate) {
  const file = _s.createSourceFile("pinned-expression.js", source, _s.ScriptTarget.Latest, true, _s.ScriptKind.JS);
  const nodes = [];
  function visit(node) { if (predicate(node)) nodes.push(node.getText(file)); _s.forEachChild(node, visit); }
  visit(file);
  assert.equal(nodes.length, 1, `Unique pinned expression: ${name}`);
  return nodes[0];
}
const descriptors = vm.runInNewContext(`(${pinnedExpression(original, "file descriptors", node =>
  _s.isCallExpression(node) && node.expression.getText() === "nr" && node.getText().includes("markdown.fileReference.copyPath")).slice(3, -1)})`);
const normalizationSource = vo.readFileSync(path.join(root, "webview/assets/app-initial-7a199c66e670.js"), "utf8");
const normalizeMenu = vm.runInNewContext(`(${pinnedNode(normalizationSource, "IR", node =>
  _s.isFunctionDeclaration(node) && node.name?.text === "IR")})`);
const formatterSource = vo.readFileSync(path.join(root, "webview/assets/app-initial-97d3534ad35f.js"), "utf8");
const formatterCode = pinnedExpression(formatterSource, "intl formatter", node =>
  _s.isBinaryExpression(node) && node.left.getText() === "wQe" && _s.isFunctionExpression(node.right));
const assertionCode = pinnedNode(formatterSource, "mQe", node => _s.isFunctionDeclaration(node) && node.name?.text === "mQe");
const formatMessage = vm.runInNewContext(`${assertionCode};${formatterCode};wQe`);
// Exercise the production formatter's translated-string path and descriptor assertion.
const intlConfig = { locale: "ko", defaultLocale: "en", messages: {
  "azrael.workspaceFile.openInVSCode": "VS Code에서 열기",
  "markdown.fileReference.copyPath": "경로 복사",
  "markdown.fileReference.copyFileContents": "파일 내용 복사",
  "markdown.fileReference.openInExplorer": "탐색기에서 열기",
} };
const formatMenu = menu => normalizeMenu(menu, (message, values) => formatMessage(intlConfig, {}, message, values));

function menuFixture({ remote = false, file = "report.HTML" } = {}) {
  const text = injectFileOpenMenu(original, FILE_OPEN_MENU_ASSET).text;
  const menuCode = pinnedNode(text, "vE", node => _s.isFunctionDeclaration(node) && node.name?.text === "vE");
  const openCode = pinnedNode(text, "MT", node => _s.isFunctionDeclaration(node) && node.name?.text === "MT")
    .replaceAll("import.meta.url", '"file:///pinned-test.js"');
  const calls = [];
  const host = { id: "local", remote };
  const context = {
    vd: "host", is: "capability", sT: "targets", Yh: "platform", Lf: "thread", CT: "mutation",
    hE: () => ({ primaryTarget: null, visibleTargets: [] }),
    Yu: h => h.remote, xs: () => false, s_: () => "thread-1",
    e_: (cwd, file) => path.win32.join(cwd, file),
    Ue: message => message, yE: () => ({ id: "markdown.fileReference.openInExplorer", defaultMessage: "Open in explorer" }),
    bE: descriptors,
    U: { clipboard: { writeText: value => { calls.push(["copy-path", value]); return Promise.resolve(); } } },
    pE: (_query, value) => calls.push(["copy-contents", value]),
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
  const buildMenu = vm.runInNewContext(`${openCode};${menuCode};vE`, context);
  return { calls, menu: buildMenu(scope, { hostId: "local", path: file, cwd: "C:\\project", line: 7, column: 3 }) };
}

test("pinned file menu explicitly routes VS Code with the original path and selection", () => {
  const { menu, calls } = menuFixture();
  assert.deepEqual(Array.from(menu, item => item.id), [
    "workspace-file-open-vscode", "workspace-file-copy-path", "workspace-file-copy-contents", "workspace-file-reveal-path",
  ]);
  const item = menu.find(item => item.id === "workspace-file-open-vscode");
  assert.equal(item.message.id, "azrael.workspaceFile.openInVSCode");
  assert.equal(item.message.defaultMessage, "VS Code에서 열기");
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

test("pinned menu normalization formats every MP4 action and rejects the old plain-string payload", () => {
  const file = "C:/Users/felre/Desktop/long-video/runtime/robot-battle/run-01/final.mp4";
  const { menu, calls } = menuFixture({ file });
  const formatted = formatMenu(menu);
  assert.deepEqual(Array.from(formatted, item => item.nativeLabel), [
    "VS Code에서 열기", "경로 복사", "파일 내용 복사", "탐색기에서 열기",
  ]);
  for (const item of formatted) item.onSelect();
  assert.equal(calls[0][1].path, file);
  assert.equal(calls[0][1].target, "vscode");
  assert.equal(calls[2][1].path, file);
  assert.equal(calls[3][1].path, file);
  assert.equal(calls[3][1].target, "fileManager");
  const malformed = menu.map(item => item.id === "workspace-file-open-vscode"
    ? { ...item, message: "VS Code에서 열기" } : item);
  assert.throws(() => formatMenu(malformed), /\[@formatjs\/intl\] An `id` must be provided to format a message/);
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
  const { transformAsset, getTransformRules } = require("./namespace-azrael-host.cjs");
  const result = transformAsset(original, FILE_OPEN_MENU_ASSET, FILE_OPEN_MENU_ASSET, _s);
  assert.equal(result.asset.fileOpenMenuEdits, 1);
  assert.ok(result.text.includes(REPLACEMENT));
  assert.ok(Object.hasOwn(getTransformRules(), "inject-file-open-menu.cjs"));
  const { createAssetTransformCache } = require("./asset-transform-cache.cjs");
  const temporaryRoot = path.resolve(__dirname, "../artifacts/tmp");
  vo.mkdirSync(temporaryRoot, { recursive: true });
  const cacheDirectory = vo.mkdtempSync(path.join(temporaryRoot, "azrael-file-menu-cache-"));
  try {
    const statistics = { hits: 0, misses: 0 };
    const cache = createAssetTransformCache({ cacheDirectory, typescriptSha256: "a".repeat(64),
      typescriptVersion: _s.version, transformRules: getTransformRules(), statistics });
    cache.run(FILE_OPEN_MENU_ASSET, original, () => result);
    const cached = cache.run(FILE_OPEN_MENU_ASSET, original, () => { throw new Error("Cache missed"); });
    assert.equal(cached.asset.fileOpenMenuEdits, 1);
    assert.equal(statistics.hits, 1);
  } finally {
    assert.equal(path.dirname(cacheDirectory), temporaryRoot);
    vo.rmSync(cacheDirectory, { recursive: true, force: true });
  }
});

test("menu transform is idempotent, scoped to its asset and rejects ambiguous pinned input", () => {
  const result = injectFileOpenMenu(original, FILE_OPEN_MENU_ASSET);
  assert.equal(result.count, 1);
  assert.equal(_s.createSourceFile(FILE_OPEN_MENU_ASSET, result.text, _s.ScriptTarget.Latest, true, _s.ScriptKind.JS).parseDiagnostics.length, 0);
  assert.equal(injectFileOpenMenu(result.text, FILE_OPEN_MENU_ASSET).count, 0);
  assert.equal(injectFileOpenMenu(original, "other.js").text, original);
  for (const input of ["unrelated", ANCHOR + ANCHOR, MARKER + ANCHOR, REPLACEMENT.replace("vscode", "other")]) {
    assert.throws(() => injectFileOpenMenu(input, FILE_OPEN_MENU_ASSET), /marker|anchor/);
  }
});
function pinnedNode(source, ownerName, predicate) {
  const hst = _s.createSourceFile("pinned-owner.js", source, _s.ScriptTarget.Latest, true, _s.ScriptKind.JS);
  const owners = [];
  function findOwner(node) {
    if (_s.isFunctionDeclaration(node) && node.name?.text === ownerName) owners.push(node);
    _s.forEachChild(node, findOwner);
  }
  findOwner(hst);
  assert.equal(owners.length, 1, `Unique pinned owner: ${ownerName}`);
  const matches = [];
  function visit(node) {
    if (predicate(node)) matches.push(node.getText(hst));
    _s.forEachChild(node, visit);
  }
  visit(owners[0]);
  assert.equal(matches.length, 1, `Ambiguous pinned node: ${ownerName}`);
  return matches[0];
}
