"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync, spawn } = require("node:child_process");
const { snapshotProject } = require("./deployment-input-snapshot.cjs");
const selections = new WeakSet();
function environment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  // Git for Windows accepts the DOS null device, unlike Node's \\.\nul path.
  return { ...env, GIT_NO_REPLACE_OBJECTS: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : os.devNull, GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1" };
}
const args = (root, rest) => ["-c", "core.longpaths=true", "-c", "protocol.allow=never", "-c", "protocol.file.allow=always", "-C", root, ...rest];
function git(root, ...rest) {
  const result = spawnSync("git", args(root, rest), { env: environment(), encoding: "utf8", windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw Error(`Committed input Git command failed (${result.status}): ${result.error?.message || result.stderr}`);
  return result.stdout;
}
function safePath(name) {
  if (!name || /[\\\0\r\n]/.test(name) || path.posix.isAbsolute(name) || path.win32.isAbsolute(name) || name.split("/").some(part => !part || [".", "..", ".git"].includes(part.toLowerCase()))) throw Error(`Unsafe committed source path: ${name}`);
  if (process.platform === "win32" && name.split("/").some(part => /[<>:"|?*]|[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw Error(`Unsupported Windows committed path: ${name}`);
}
function freeze(value) {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function selectCommittedProject(directory, sourceCommit) {
  const root = fs.realpathSync(directory);
  if (fs.realpathSync(git(root, "rev-parse", "--show-toplevel").trim()) !== root) throw Error("Independent project Git root required");
  if (sourceCommit !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sourceCommit)) throw Error("Full sourceCommit SHA required");
  const commit = git(root, "rev-parse", "--verify", `${sourceCommit ?? "HEAD"}^{commit}`).trim();
  if (sourceCommit !== undefined && commit !== sourceCommit) throw Error("Exact selected commit required");
  const inventory = [];
  let fileCount = 0;
  function select(folder, selected) {
    if (git(folder, "cat-file", "-t", selected).trim() !== "commit") throw Error("Recorded gitlink commit unavailable");
    const tree = { root: folder, commit: selected, objectFormat: git(folder, "rev-parse", "--show-object-format").trim(), entries: [] };
    inventory.push(tree);
    const seen = new Set();
    for (const row of git(folder, "ls-tree", "-r", "-z", "--full-tree", selected).split("\0").filter(Boolean)) {
      const tab = row.indexOf("\t"), [mode, type, object] = row.slice(0, tab).split(" "), name = row.slice(tab + 1);
      safePath(name);
      if (folder === root && ["artifacts", "control"].includes(name.split("/")[0].toLowerCase())) throw Error(`Unsafe or generated committed source path: ${name}`);
      const key = process.platform === "win32" ? name.toLowerCase() : name;
      if (tab < 0 || seen.has(key) || !["100644", "100755", "120000", "160000"].includes(mode) || !/^[a-f0-9]{40,64}$/.test(object)) throw Error("Unsupported committed Git entry");
      seen.add(key);
      tree.entries.push({ path: name, mode, type, object });
      if (mode === "160000") {
        const nested = path.join(folder, name);
        const nestedRelative = path.relative(root, fs.realpathSync(nested));
        if (fs.lstatSync(nested).isSymbolicLink() || nestedRelative === ".." || nestedRelative.startsWith(".." + path.sep) || path.isAbsolute(nestedRelative)) throw Error("Linked or escaping gitlink repository rejected");
        if (!fs.existsSync(path.join(nested, ".git")) || fs.realpathSync(git(nested, "rev-parse", "--show-toplevel").trim()) !== fs.realpathSync(nested)) throw Error(`Recorded gitlink requires initialized local repository: ${name}`);
        select(nested, object);
      } else fileCount++;
    }
  }
  select(root, commit);
  const selection = freeze({ root, commit, sourceCommit: commit, fileCount, inventory });
  selections.add(selection);
  return selection;
}
async function writeBlobs(tree, destination) {
  const entries = tree.entries.filter(entry => entry.mode !== "160000");
  if (!entries.length) return;
  const child = spawn("git", args(tree.root, ["cat-file", "--batch"]), { env: environment(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-8192); });
  const completed = new Promise((resolve, reject) => { child.on("error", reject); child.on("close", code => code === 0 ? resolve() : reject(Error(`Committed blob reader failed (${code}): ${stderr}`))); });
  // Observe immediately even when parsing fails before awaiting completion.
  completed.catch(() => {});
  child.stdin.on("error", () => {});
  child.stdin.end(entries.map(entry => entry.object + "\n").join(""));
  const iterator = child.stdout[Symbol.asyncIterator]();
  let buffer = Buffer.alloc(0);
  async function fill() { const next = await iterator.next(); if (next.done) throw Error("Truncated committed Git object stream"); buffer = buffer.length ? Buffer.concat([buffer, next.value]) : next.value; }
  try {
    for (const entry of entries) {
      while (!buffer.includes(10)) await fill();
      const end = buffer.indexOf(10), header = buffer.subarray(0, end).toString("ascii"); buffer = buffer.subarray(end + 1);
      const [object, type, sizeText] = header.split(" "), size = Number(sizeText);
      if (object !== entry.object || type !== "blob" || !Number.isSafeInteger(size) || size < 0) throw Error("Invalid committed blob response");
      const file = path.join(destination, entry.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const chunks = entry.mode === "120000" ? [] : null;
      const fd = chunks ? null : fs.openSync(file, "wx", entry.mode === "100755" ? 0o755 : 0o644);
      try {
        let remaining = size;
        while (remaining) {
          if (!buffer.length) await fill();
          const length = Math.min(remaining, buffer.length), chunk = buffer.subarray(0, length);
          if (chunks) chunks.push(Buffer.from(chunk)); else { let offset = 0; while (offset < length) offset += fs.writeSync(fd, chunk, offset); }
          remaining -= length; buffer = buffer.subarray(length);
        }
      } finally { if (fd !== null) fs.closeSync(fd); }
      if (chunks) {
        const target = Buffer.concat(chunks).toString("utf8"), resolved = path.resolve(path.dirname(file), target), relative = path.relative(destination, resolved);
        if (!target || path.isAbsolute(target) || path.win32.isAbsolute(target) || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw Error("Committed symlink escapes its repository");
        // Match Git's Windows placeholder representation used by imported SOURCE.json.
        // Unix consumers retain the committed relative link itself.
        if (process.platform === "win32") fs.writeFileSync(file, Buffer.concat(chunks), { flag: "wx" });
        else fs.symlinkSync(target, file);
      } else if (process.platform !== "win32") fs.chmodSync(file, entry.mode === "100755" ? 0o755 : 0o644);
      if (!buffer.length) await fill();
      if (buffer[0] !== 10) throw Error("Invalid committed blob terminator");
      buffer = buffer.subarray(1);
    }
    for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) if (chunk.length) throw Error("Unexpected committed blob output");
    await completed;
  } catch (error) { child.kill(); await completed.catch(() => {}); throw error; }
}
async function materializeCommittedProject(selection, directory, { separateControl } = {}) {
  if (!selections.has(selection)) throw Error("Original immutable committed project selection required");
  const destination = path.resolve(directory);
  const parentRelative = path.relative(destination, selection.root);
  if (!parentRelative || (!path.isAbsolute(parentRelative) && parentRelative !== ".." && !parentRelative.startsWith(".." + path.sep))) throw Error("Committed destination must not contain its source repository");
  if (fs.existsSync(destination) && (!fs.lstatSync(destination).isDirectory() || fs.lstatSync(destination).isSymbolicLink() || fs.readdirSync(destination).length)) throw Error("Fresh or empty owned committed destination required");
  fs.mkdirSync(destination, { recursive: true });
  let nested = 0;
  for (const tree of selection.inventory) {
    const target = path.join(destination, path.relative(selection.root, tree.root));
    fs.mkdirSync(target, { recursive: true });
    const init = ["init", "--quiet", "--template=", `--object-format=${tree.objectFormat}`];
    if (separateControl) { const metadata = path.join(separateControl, tree.root === selection.root ? "git" : "n" + nested++); fs.mkdirSync(path.dirname(metadata), { recursive: true }); init.push("--separate-git-dir", metadata); }
    git(target, ...init);
    if (process.platform === "win32") git(target, "config", "core.symlinks", "false");
    git(target, "fetch", "--quiet", "--depth=1", "--no-tags", "--no-recurse-submodules", "--upload-pack=git-upload-pack", tree.root, tree.commit);
    git(target, "reset", "--mixed", "--no-refresh", tree.commit);
    if (separateControl && tree.root === selection.root) {
      const exclude = git(target, "rev-parse", "--git-path", "info/exclude").trim();
      const excludePath = path.resolve(target, exclude);
      fs.mkdirSync(path.dirname(excludePath), { recursive: true });
      fs.appendFileSync(excludePath, "\n/control/\n");
    }
    await writeBlobs({ ...tree, root: target }, target);
  }
  const snapshot = await snapshotProject(destination);
  return { ...snapshot, commit: selection.commit, sourceCommit: selection.commit, frozenSnapshot: snapshot };
}
module.exports = { selectCommittedProject, materializeCommittedProject };
