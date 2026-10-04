"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { rewriteJavaScript } = require("./namespace-azrael-host.cjs");
const { DROP_ASSET, COMPOSER_ASSET, DROP_MARKER, COMPOSER_MARKER, BROWSER_HELPER,
  hasLocalFileTransfer, localFileDescriptors, injectLocalFileDrop } = require("./inject-local-file-drop.cjs");

const assets = path.join(__dirname, "..", "artifacts", "upstream-ui", "26.928.31416", "webview", "assets");

function transfer(data) {
  return { types: Object.keys(data), getData(type) { return data[type] ?? ""; } };
}

function browserDescriptors(data) {
  const sandbox = { URL };
  vm.runInNewContext(BROWSER_HELPER, sandbox);
  return JSON.parse(JSON.stringify(sandbox.azraelLocalFileDescriptors(transfer(data))));
}

test("VS Code editor and Explorer payloads become local file references in order", () => {
  const payload = {
    CodeEditors: "[]",
    CodeFiles: JSON.stringify(["C:\\work\\one.md", "C:\\work\\two file.ts"]),
    "application/vnd.code.uri-list": "file:///C:/work/one.md\r\nfile:///C:/work/three%20file.txt",
  };
  const expected = ["C:\\work\\one.md", "C:\\work\\two file.ts", "C:\\work\\three file.txt"];
  assert.equal(hasLocalFileTransfer(transfer(payload)), true);
  for (const descriptors of [localFileDescriptors(transfer(payload)), browserDescriptors(payload)]) {
    assert.deepEqual(descriptors.map(({ fsPath }) => fsPath), expected);
    assert.deepEqual(descriptors.map(({ label }) => label), ["one.md", "two file.ts", "three file.txt"]);
  }
  const lowercased = { codefiles: JSON.stringify(["C:\\work\\lower.md"]) };
  assert.deepEqual(browserDescriptors(lowercased).map(({ fsPath }) => fsPath), ["C:\\work\\lower.md"]);
  const resources = { ResourceURLs: JSON.stringify(["file:///C:/work/from%20explorer.csv"]) };
  assert.deepEqual(browserDescriptors(resources).map(({ fsPath }) => fsPath), ["C:\\work\\from explorer.csv"]);
});

test("browser links and remote, malformed, and unsupported URIs do not become file references", () => {
  const payloads = [
    { "text/uri-list": "https://example.com/private.txt" },
    { "application/vnd.code.uri-list": "vscode-remote://ssh-remote+host/work/file.txt" },
    { ResourceURLs: JSON.stringify(["file://server/share/private.txt", "https://example.com/private.txt"]) },
    { CodeFiles: "{bad json" },
    { CodeFiles: JSON.stringify(["relative.txt", "\\\\server\\share\\private.txt"]) },
  ];
  for (const payload of payloads) {
    assert.deepEqual(localFileDescriptors(transfer(payload)), []);
    assert.deepEqual(browserDescriptors(payload), []);
  }
  assert.equal(hasLocalFileTransfer(transfer(payloads[0])), false);
});

test("pinned Webview transformations are unique, repeatable, and syntactically valid", () => {
  for (const relative of [DROP_ASSET, COMPOSER_ASSET]) {
    const source = fs.readFileSync(path.join(assets, path.basename(relative)), "utf8");
    const injected = injectLocalFileDrop(source, relative);
    assert.equal(injected.count, 1);
    assert.equal(injectLocalFileDrop(injected.text, relative).count, 0);
    const marker = relative === DROP_ASSET ? DROP_MARKER : COMPOSER_MARKER;
    assert.equal(injected.text.split(marker).length - 1, 1);
    const parsed = ts.createSourceFile(relative, injected.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    assert.equal(parsed.parseDiagnostics.length, 0);
    if (relative === COMPOSER_ASSET) {
      assert.throws(() => injectLocalFileDrop(injected.text.replace(COMPOSER_MARKER, COMPOSER_MARKER + "corrupt"), COMPOSER_ASSET), /Invalid local-file composer marker/);
    }
  }
  assert.throws(() => injectLocalFileDrop("unrelated", DROP_ASSET), /anchors changed/);
  assert.throws(() => injectLocalFileDrop("unrelated", COMPOSER_ASSET), /anchor changed/);
});

test("file-drop anchors survive the Azrael namespace transform", () => {
  for (const relative of [DROP_ASSET, COMPOSER_ASSET]) {
    const source = fs.readFileSync(path.join(assets, path.basename(relative)), "utf8");
    const namespaced = rewriteJavaScript(source, relative, ts);
    const injected = injectLocalFileDrop(namespaced.text, relative);
    assert.equal(injected.count, 1);
    assert.equal(ts.createSourceFile(relative, injected.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0);
  }
});

test("injected composer validates local paths before reusing picked-file attachments", async () => {
  const source = fs.readFileSync(path.join(assets, path.basename(COMPOSER_ASSET)), "utf8");
  const injected = injectLocalFileDrop(source, COMPOSER_ASSET).text;
  const start = injected.indexOf("addFileReferences:Sp(async e=>{");
  const end = injected.indexOf("dropTargetPortalTarget:je", start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const sandbox = {
    Sp: callback => callback,
    vi: null,
    Jm: async (method, request) => {
      calls.push([method, request.params.path]);
      return { isFile: request.params.path.endsWith("valid.txt") };
    },
    ye: { get: () => ({ danger: message => calls.push(["toast", message]) }) },
    kx: Symbol("toast"),
    Ra: { async addPickedFiles(files, options) { calls.push(["add", files.map(file => file.fsPath), options.imagesOnly]); } },
    gda: async () => [],
  };
  const object = vm.runInNewContext(`({${injected.slice(start, end)}marker:true})`, sandbox);
  await object.addFileReferences([
    { fsPath: "C:\\work\\valid.txt", path: "C:\\work\\valid.txt", label: "valid.txt" },
    { fsPath: "C:\\work\\missing.txt", path: "C:\\work\\missing.txt", label: "missing.txt" },
  ]);
  assert.deepEqual(calls.map(call => call[0]), ["read-file-metadata", "read-file-metadata", "toast", "add"]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ["add", ["C:\\work\\valid.txt"], false]);
});

test("native drop handler captures the composer callback rather than the drag event", () => {
  const source = fs.readFileSync(path.join(assets, path.basename(DROP_ASSET)), "utf8");
  const injected = injectLocalFileDrop(source, DROP_ASSET).text;
  const ast = ts.createSourceFile(DROP_ASSET, injected, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let hook;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "Obi") hook = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(hook);
  let attached, prevented = 0;
  const sandbox = {
    URL,
    kbi: { c: () => Array(46).fill(Symbol("uninitialized")) },
    X5: { useState: () => [null, () => {}], useEffect() {}, useEffectEvent: callback => callback },
    PZr: () => false,
    DTe: () => ({ imageFiles: [], otherFiles: [] }),
    hve: () => false,
    As: () => false,
  };
  vm.runInNewContext(BROWSER_HELPER + hook.getText(ast), sandbox);
  const props = {
    activeBrowserImageDragBrowserTabId: null, addFiles() {}, addDraggedImage() {},
    directBrowserConversationId: null, dragCounterRef: { current: 0 },
    dropTargetPortalTarget: null, isDragActive: false, onAttachmentAdded() {},
    setIsDragActive() {}, setShowShiftOverlay() {},
    addFileReferences(files) { attached = files; },
  };
  const handler = sandbox.Obi(props);
  handler.handleDrop({
    target: null, dataTransfer: transfer({ CodeFiles: JSON.stringify(["C:\\work\\valid.txt"]) }),
    preventDefault() { prevented++; },
  });
  assert.equal(prevented, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(attached)).map(file => file.fsPath), ["C:\\work\\valid.txt"]);
});

