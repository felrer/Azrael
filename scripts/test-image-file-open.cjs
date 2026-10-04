"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { ANCHOR, MARKER, REPLACEMENT, injectImageFileOpen } = require("./inject-image-file-open.cjs");

const originalPath = path.join(process.env.AZRAEL_PINNED_HOST_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.928.31416"), "out", "extension.js");
assert.ok(fs.existsSync(originalPath), `Pinned original extension bundle missing: ${originalPath}`);
const original = fs.readFileSync(originalPath, "utf8");
const methodStart = "async open({path:e,line:r,column:n,cwd:o,target:i})";
const methodEnd = "async setGlobalPreferredTarget";

function fixture(bundle, workspacePaths = [], { platform = "linux", pdfError } = {}) {
  const start = bundle.indexOf(methodStart);
  assert.ok(start >= 0, "pinned provider open method exists");
  assert.equal(bundle.indexOf(methodStart, start + 1), -1, "provider method is unique");
  const end = bundle.indexOf(methodEnd, start);
  assert.ok(end > start, "provider method end exists");
  const calls = [];
  const filePath = platform === "win32" ? path.win32 : path;
  const uri = fsPath => ({ fsPath });
  const workspaceFolders = workspacePaths.map(fsPath => ({ uri: uri(fsPath) }));
  class Position { constructor(line, character) { Object.assign(this, { line, character }); } }
  class Range { constructor(start, end) { Object.assign(this, { start, end }); } }
  const vscode = {
    Uri: { file: uri, joinPath(base, ...parts) { return uri(filePath.join(base.fsPath, ...parts)); } },
    Position, Range,
    commands: { async executeCommand(...args) { calls.push(["command", ...args]); } },
    workspace: {
      workspaceFolders,
      async openTextDocument(value) { calls.push(["text", value]); return { uri: value }; },
      async findFiles() { calls.push(["find"]); return []; },
    },
    window: { async showTextDocument(document, options) { calls.push(["show", document, options]); } },
  };
  const context = { lo: vscode, process: { platform }, S3e: filePath.isAbsolute, M4e: filePath,
    Pc: value => /^\/[A-Za-z]:[\\/]/.test(value) ? value.slice(1) : value,
    require(id) {
      assert.equal(id, "./pdf-file-open.cjs");
      return { async openFileInChrome(value) {
        calls.push(["pdf", value]);
        if (pdfError) throw pdfError;
      } };
    },
    NZ(relative, folders) {
      assert.equal(filePath.isAbsolute(relative), false);
      assert.equal(folders.length, workspaceFolders.length);
      return folders.map(folder => uri(filePath.join(folder.uri.fsPath, relative)));
    },
  };
  const provider = vm.runInNewContext(`({${bundle.slice(start, end)}})`, context);
  provider.logger = { error(...args) { calls.push(["error", ...args]); } };
  return { provider, calls };
}

test("pinned original bundle injects once and accepts only its exact marker", () => {
  assert.equal(original.split(ANCHOR).length - 1, 1);
  const injected = injectImageFileOpen(original);
  assert.equal(injected.count, 1);
  assert.equal(injected.text.split(MARKER).length - 1, 1);
  assert.equal(injectImageFileOpen(injected.text).count, 0);
  assert.equal(injected.text.split(REPLACEMENT).length - 1, 1);
});

test("actual injected provider routes absolute and cwd-relative images to VS Code image preview", async () => {
  const { provider, calls } = fixture(injectImageFileOpen(original).text);
  for (const input of [
    { path: "/photos/portrait.PNG" },
    { path: "figures/chart.svg", cwd: "/project" },
  ]) {
    calls.length = 0;
    assert.equal((await provider.open(input)).success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "command");
    assert.equal(calls[0][1], "vscode.openWith");
    assert.equal(calls[0][2].fsPath, input.cwd ? path.join(input.cwd, input.path) : input.path);
    assert.equal(calls[0][3], "imagePreview.previewEditor");
    assert.equal(calls[0][4].preview, false);
  }
});

test("actual injected provider resolves workspace-relative images through workspace folders", async () => {
  const { provider, calls } = fixture(injectImageFileOpen(original).text, ["/workspace/project"]);
  assert.equal((await provider.open({ path: "figures/workspace.webp" })).success, true);
  assert.deepEqual(calls.map(call => call[0]), ["command"]);
  assert.equal(calls[0][1], "vscode.openWith");
  assert.equal(calls[0][2].fsPath, path.join("/workspace/project", "figures/workspace.webp"));
  assert.equal(calls[0][3], "imagePreview.previewEditor");
});

test("actual injected provider preserves CSV and text line selection", async () => {
  const { provider, calls } = fixture(injectImageFileOpen(original).text);
  for (const file of ["/project/data.csv", "/project/notes.txt"]) {
    calls.length = 0;
    assert.equal((await provider.open({ path: file, line: 7, column: 3 })).success, true);
    assert.deepEqual(calls.map(call => call[0]), ["text", "show"]);
    assert.equal(calls[0][1].fsPath, file);
    assert.equal(calls[1][2].preview, false);
    assert.equal(calls[1][2].selection.start.line, 6);
    assert.equal(calls[1][2].selection.start.character, 2);
  }
});

test("actual injected provider preserves file manager reveal for images", async () => {
  const { provider, calls } = fixture(injectImageFileOpen(original).text);
  assert.equal((await provider.open({ path: "/photos/portrait.png", target: "fileManager" })).success, true);
  assert.deepEqual(calls.map(call => call[0]), ["command"]);
  assert.equal(calls[0][1], "revealFileInOS");
  assert.equal(calls[0][2].fsPath, "/photos/portrait.png");
});

test("actual Windows provider resolves absolute, cwd, and workspace PDFs before opening Chrome", async () => {
  for (const { input, workspace, expected } of [
    { input: { path: "C:\\reports\\report.pdf" }, expected: "C:\\reports\\report.pdf" },
    { input: { path: "/C:/reports/REPORT.PDF" }, expected: "C:/reports/REPORT.PDF" },
    { input: { path: "reports/report.PdF", cwd: "C:\\project" }, expected: "C:\\project\\reports\\report.PdF" },
    { input: { path: "reports/report.pdf" }, workspace: ["C:\\workspace"], expected: "C:\\workspace\\reports\\report.pdf" },
  ]) {
    const { provider, calls } = fixture(injectImageFileOpen(original).text, workspace, { platform: "win32" });
    assert.equal((await provider.open(input)).success, true);
    assert.deepEqual(calls, [["pdf", expected]]);
  }
});

test("PDF failures report unsuccessful handling without opening a text editor", async () => {
  for (const error of [new Error("Chrome unavailable"), new Error("spawn failed"), new Error("Not a file")]) {
    for (const input of [{ path: "C:\\reports\\report.pdf" }, { path: "report.pdf", cwd: "C:\\reports" }]) {
      const { provider, calls } = fixture(injectImageFileOpen(original).text, [], { platform: "win32", pdfError: error });
      assert.equal((await provider.open(input)).success, false);
      assert.equal(calls[0][0], "pdf");
      assert.equal(calls.at(-1)[0], "error");
      assert.ok(calls.every(call => ["pdf", "find", "error"].includes(call[0])));
    }
  }
});

test("Windows PDF reveal takes precedence and existing image/text handling remains available", async () => {
  const { provider, calls } = fixture(injectImageFileOpen(original).text, [], { platform: "win32" });
  assert.equal((await provider.open({ path: "C:\\reports\\report.pdf", target: "fileManager" })).success, true);
  assert.deepEqual(calls.map(call => call.slice(0, 2)), [["command", "revealFileInOS"]]);
  calls.length = 0;
  assert.equal((await provider.open({ path: "C:\\reports\\chart.PNG" })).success, true);
  assert.equal(calls[0][1], "vscode.openWith");
  assert.equal(calls[0][3], "imagePreview.previewEditor");
  calls.length = 0;
  assert.equal((await provider.open({ path: "C:\\reports\\notes.txt", line: 7, column: 3 })).success, true);
  assert.deepEqual(calls.map(call => call[0]), ["text", "show"]);
  assert.equal(calls[1][2].selection.start.line, 6);
  assert.equal(calls[1][2].selection.start.character, 2);
});

test("non-Windows provider preserves PDF text handling", async () => {
  const { provider, calls } = fixture(injectImageFileOpen(original).text);
  assert.equal((await provider.open({ path: "/reports/report.pdf" })).success, true);
  assert.deepEqual(calls.map(call => call[0]), ["text", "show"]);
});

test("Windows HTML and HTM links open Chrome through existing path resolution", async () => {
  for (const { input, workspace, expected } of [
    { input: { path: "C:\\reports\\report.html", line: 7, column: 3 }, expected: "C:\\reports\\report.html" },
    { input: { path: "/C:/reports/REPORT.HTM" }, expected: "C:/reports/REPORT.HTM" },
    { input: { path: "reports/report.HtMl", cwd: "C:\\project" }, expected: "C:\\project\\reports\\report.HtMl" },
    { input: { path: "reports/report.htm" }, workspace: ["C:\\workspace"], expected: "C:\\workspace\\reports\\report.htm" },
  ]) {
    const { provider, calls } = fixture(injectImageFileOpen(original).text, workspace, { platform: "win32" });
    assert.equal((await provider.open(input)).success, true);
    assert.deepEqual(calls, [["pdf", expected]]);
  }
});

test("explicit VS Code menu target uses text and line selection for HTML and media files", async () => {
  const { provider, calls } = fixture(injectImageFileOpen(original).text, [], { platform: "win32" });
  for (const extension of ["html", "HTM", "pdf", "png", "txt"]) {
    calls.length = 0;
    assert.equal((await provider.open({ path: `C:\\reports\\report.${extension}`, target: "vscode", line: 7, column: 3 })).success, true);
    assert.deepEqual(calls.map(call => call[0]), ["text", "show"]);
    assert.equal(calls[1][2].selection.start.line, 6);
    assert.equal(calls[1][2].selection.start.character, 2);
  }
});

test("HTML reveal takes precedence and Chrome failures use existing failure handling", async () => {
  const { provider, calls } = fixture(injectImageFileOpen(original).text, [], { platform: "win32" });
  assert.equal((await provider.open({ path: "C:\\reports\\report.html", target: "fileManager" })).success, true);
  assert.deepEqual(calls.map(call => call.slice(0, 2)), [["command", "revealFileInOS"]]);
  for (const error of [new Error("Chrome unavailable"), new Error("spawn failed"), new Error("Not a file")]) {
    const failed = fixture(injectImageFileOpen(original).text, [], { platform: "win32", pdfError: error });
    assert.equal((await failed.provider.open({ path: "C:\\reports\\report.htm" })).success, false);
    assert.deepEqual(failed.calls.map(call => call[0]), ["pdf", "error"]);
  }
});

test("injection fails closed for missing, duplicated, and altered anchors or markers", () => {
  assert.throws(() => injectImageFileOpen("unrelated bundle"), /anchor must occur exactly once: found 0/);
  assert.throws(() => injectImageFileOpen(ANCHOR + ANCHOR), /anchor must occur exactly once: found 2/);
  assert.throws(() => injectImageFileOpen(ANCHOR.replace("revealFileInOS", "revealFile")), /anchor must occur exactly once: found 0/);
  assert.throws(() => injectImageFileOpen(MARKER + ANCHOR), /Invalid image file-open marker/);
  assert.throws(() => injectImageFileOpen(REPLACEMENT + MARKER), /Invalid image file-open marker/);
  assert.throws(() => injectImageFileOpen(REPLACEMENT.replace("imagePreview.previewEditor", "other.preview")), /Invalid image file-open marker/);
});
