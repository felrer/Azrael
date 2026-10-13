"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const MARKER = "/*azrael-host-drag-recovery-v1*/";
const anchor = /constructor\((\w+),(\w+)\)\{super\(\);let (\w+)=\(\)=>\{\2\(\)\?\.windowDidDragStart\(\)\},(\w+)=\(\)=>\{\2\(\)\?\.windowDidDragEnd\(\)\};this\._register\((\w+)\(\1,(\w+)\.DRAG_START,/g;
const sha = text => crypto.createHash("sha256").update(text).digest("hex");

function patchWorkbenchDragRecovery(text) {
  const matches = [...text.matchAll(anchor)];
  if (text.includes(MARKER)) {
    const start = text.indexOf(MARKER);
    if (text.split(MARKER).length !== 2 || !text.slice(start, start + 1000).includes('"visibilitychange"')) throw Error("Damaged host drag recovery patch.");
    // The exact original anchor must be recoverable; arbitrary marker text is rejected.
    const stripped = text.slice(0, start) + text.slice(text.indexOf("this._register(", text.indexOf("{dispose:", start)), text.length);
    const originalMatches = [...stripped.matchAll(anchor)];
    if (originalMatches.length !== 1) throw Error("Damaged host drag recovery patch.");
    const rebuilt = patchWorkbenchDragRecovery(stripped);
    if (rebuilt.text !== text) throw Error("Damaged host drag recovery patch.");
    return { text, changed: false };
  }
  if (matches.length !== 1) throw Error("Unsupported VS Code Webview drag monitor; refusing to patch.");
  const m = matches[0], [, view, , , end, listen] = m;
  const position = m.index + m[0].indexOf("this._register(");
  const recovery = `${MARKER}this._register(${listen}(${view},"drop",${end},!0)),this._register(${listen}(${view},"dragend",${end},!0)),this._register(${listen}(${view},"blur",${end},!0)),this._register(${listen}(${view}.document,"visibilitychange",()=>{${view}.document.hidden&&${end}()})),this._register({dispose:${end}});`;
  return { text: text.slice(0, position) + recovery + text.slice(position), changed: true };
}

function hostRoot(file) {
  const suffix = path.join("resources", "app", "out", "vs", "workbench", "workbench.desktop.main.js");
  if (!file.endsWith(suffix)) throw Error("Expected the desktop workbench bundle path.");
  const resourceRoot = file.slice(0, -suffix.length);
  const root = fs.existsSync(path.join(resourceRoot, "Code.exe")) ? resourceRoot : path.dirname(resourceRoot.replace(/[\\/]$/, ""));
  if (!fs.existsSync(path.join(root, "Code.exe"))) throw Error("Cannot identify the selected Windows host executable.");
  return path.resolve(root) + path.sep;
}

function assertStopped(file) {
  const root = hostRoot(file);
  if (process.platform !== "win32") throw Error("Host application is currently verified on Windows only.");
  const script = '$r=[IO.Path]::GetFullPath($env:AZRAEL_PATCH_HOST_ROOT); $p=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath)).StartsWith($r,[StringComparison]::OrdinalIgnoreCase) }); if($p.Count){throw "Selected host is running; close it before applying or restoring."}';
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, AZRAEL_PATCH_HOST_ROOT: root }, windowsHide: true, stdio: "pipe" });
}

function apply(file, mode = "check") {
  file = path.resolve(file);
  hostRoot(file);
  const backup = file + ".azrael-drag-original", receipt = file + ".azrael-drag-receipt.json";
  const current = fs.readFileSync(file), hash = sha(current);
  if (mode === "restore") {
    assertStopped(file);
    const saved = JSON.parse(fs.readFileSync(receipt, "utf8")), original = fs.readFileSync(backup);
    if (saved.file !== file || saved.patchedSHA256 !== hash || sha(original) !== saved.originalSHA256) throw Error("Host or backup changed; refusing to overwrite.");
    fs.writeFileSync(file, original);
    return { mode, file, restored: true, sha256: sha(fs.readFileSync(file)), backup, receipt };
  }
  const result = patchWorkbenchDragRecovery(current.toString("utf8"));
  if (mode === "apply" && result.changed) {
    assertStopped(file);
    if (fs.existsSync(backup) || fs.existsSync(receipt)) throw Error("Recovery files already exist; inspect them before applying again.");
    fs.writeFileSync(backup, current, { flag: "wx" });
    const saved = { file, originalSHA256: hash, patchedSHA256: sha(result.text), appliedAt: new Date().toISOString() };
    // Write provenance before mutation; interruption remains recoverable by inspection.
    fs.writeFileSync(receipt, JSON.stringify(saved, null, 2), { flag: "wx" });
    fs.writeFileSync(file, result.text);
    if (sha(fs.readFileSync(file)) !== saved.patchedSHA256) throw Error("Patched file verification failed.");
  }
  return { mode, file, needsPatch: result.changed, originalSHA256: hash, resultSHA256: sha(result.text), backup, receipt };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2), at = args.indexOf("--workbench"), modes = args.filter(a => ["--apply", "--restore"].includes(a));
    if (at < 0 || !args[at + 1] || modes.length > 1 || args.some((a, i) => i !== at + 1 && !["--workbench", "--apply", "--restore"].includes(a))) throw Error("Usage: node scripts/patch-vscode-webview-drag.cjs --workbench <bundle> [--apply | --restore]. Default: read-only check.");
    console.log(JSON.stringify(apply(args[at + 1], modes[0]?.slice(2) ?? "check"), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { MARKER, patchWorkbenchDragRecovery, apply };
