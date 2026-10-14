"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { snapshotProject } = require("./deployment-input-snapshot.cjs");

const sha = value => crypto.createHash("sha256").update(value).digest("hex");
function git(root, args, input) {
  const result = spawnSync("git", ["-c", "core.longpaths=true", "-C", root, ...args],
    { input, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Git selection/index failed (${root}): ${result.error?.message || result.stderr.trim()}`);
  return result.stdout;
}
function contained(root, file) {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function parents(root, filename) {
  if (!contained(root, filename)) throw new Error(`Selected path escapes root: ${filename}`);
  // Resolve once for this inspection, never cache source parent inspections across files.
  const physicalRoot = fs.realpathSync.native(root);
  const result = [];
  for (let folder = path.dirname(filename); contained(root, folder); folder = path.dirname(folder)) {
    const stat = fs.lstatSync(folder);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Selected parent is a link/junction or non-directory: ${folder}`);
    const realpath = fs.realpathSync.native(folder);
    if (!contained(physicalRoot, realpath)) throw new Error(`Selected parent escapes physical root: ${folder}`);
    result.push({ path: folder, realpath, ino: stat.ino, dev: stat.dev, mode: stat.mode & 0o777 });
    if (folder === root) break;
  }
  return result;
}
function parentIdentity(records) {
  return JSON.stringify(records.map(({ path, realpath, ino, dev }) => ({ path, realpath, ino, dev })));
}
function fileChanged(before, after) {
  return ["size", "mtimeMs", "ctimeMs", "ino", "dev", "mode"].some(key => after[key] !== before[key]);
}
async function captureProject(directory, destination, { concurrency = 8, smallFileMaxBytes = 128 * 1024 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error("Invalid capture concurrency");
  if (!Number.isInteger(smallFileMaxBytes) || smallFileMaxBytes < 0 || smallFileMaxBytes > 1024 * 1024) throw new Error("Invalid capture small-file threshold (0 through 1048576 bytes)");
  const started = performance.now(), startedUtc = new Date().toISOString();
  const root = path.resolve(directory), frozenRoot = path.resolve(destination);
  if (contained(root, frozenRoot) && !path.relative(root, frozenRoot).startsWith(`artifacts${path.sep}`)) throw new Error("Capture destination must be an independent artifact root");
  const physicalRoot = fs.realpathSync.native(root), leaves = [], trees = [], directoryModes = new Map();
  const phasesMs = {};
  let bytes = 0, fileCount = 0, bufferedFileCount = 0, streamedFileCount = 0;
  async function inventory(folder) {
    const head = git(folder, ["rev-parse", "HEAD"]).trim();
    const selectedUtc = new Date().toISOString();
    const selectedPaths = [...new Set(git(folder, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean))].sort();
    const stages = new Map();
    for (const row of git(folder, ["ls-files", "--stage", "-z"]).split("\0").filter(Boolean)) {
      const tab = row.indexOf("\t"), [mode, object, stage] = row.slice(0, tab).split(" ");
      if (stage !== "0") throw new Error(`Unmerged selected source: ${folder}/${row.slice(tab + 1)}`);
      stages.set(row.slice(tab + 1), { mode, object });
    }
    const tree = { root: folder, frozenRoot: path.join(frozenRoot, path.relative(root, folder)), head, selectedUtc, selectedPaths, entries: [] };
    trees.push(tree);
    for (const name of selectedPaths) {
      if (name.includes("\n") || name.includes("\r") || name.split("/").includes(".git")) throw new Error(`Unsupported selected source path: ${name}`);
      const filename = path.resolve(folder, name);
      if (!contained(folder, filename) || !contained(root, filename)) throw new Error(`Selected path escapes source boundary: ${filename}`);
      const entry = { path: name, index: stages.get(name) };
      tree.entries.push(entry);
      let stat;
      try { parents(root, filename); stat = fs.lstatSync(filename); }
      catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
        entry.sha256 = "deleted"; continue;
      }
      if (stat.isSymbolicLink()) throw new Error(`Selected source link/junction is unsupported: ${filename}`);
      if (!contained(physicalRoot, fs.realpathSync.native(filename))) throw new Error(`Selected source escapes physical root: ${filename}`);
      if (stat.isDirectory()) {
        if ((entry.index && entry.index.mode !== "160000") || !fs.existsSync(path.join(filename, ".git"))) throw new Error(`Selected directory is not an initialized nested repository: ${filename}`);
        entry.tree = await inventory(filename);
      } else if (stat.isFile()) leaves.push({ entry, filename });
      else throw new Error(`Selected source is not a regular file: ${filename}`);
    }
    return tree;
  }
  const rootTree = await inventory(root);
  phasesMs.inventory = performance.now() - started;
  const copyStarted = performance.now();
  let next = 0, failure;
  async function readFiles() {
    while (!failure && next < leaves.length) {
      const { entry, filename } = leaves[next++];
      let handle;
      try {
        const parentBefore = parents(root, filename), original = fs.lstatSync(filename);
        if (!original.isFile() || original.isSymbolicLink()) throw new Error(`Selected source became a link/non-file: ${filename}`);
        if (!contained(physicalRoot, fs.realpathSync.native(filename))) throw new Error(`Selected source escapes physical root: ${filename}`);
        handle = await fs.promises.open(filename, "r");
        const before = await handle.stat();
        if (!before.isFile() || fileChanged(original, before)) throw new Error(`Selected source changed before reading: ${filename}`);
        const copied = path.join(frozenRoot, path.relative(root, filename));
        // Walk from the destination root so mkdir cannot traverse an existing junction.
        const folders = [frozenRoot];
        for (const component of path.relative(frozenRoot, path.dirname(copied)).split(path.sep).filter(Boolean)) {
          folders.push(path.join(folders.at(-1), component));
        }
        for (const folder of folders) {
          let stat;
          try { stat = fs.lstatSync(folder); }
          catch (error) {
            if (error.code !== "ENOENT" || folder === frozenRoot) throw error;
            fs.mkdirSync(folder); stat = fs.lstatSync(folder);
          }
          if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Frozen parent is a link/non-directory: ${folder}`);
        }
        const destinationBefore = parents(frozenRoot, copied);
        for (const record of parentBefore) {
          const target = path.join(frozenRoot, path.relative(root, record.path));
          const observed = destinationBefore.find(item => item.path === target);
          const previous = directoryModes.get(target);
          if (!observed || (previous && parentIdentity([previous.identity]) !== parentIdentity([observed]))) {
            throw new Error(`Frozen directory changed: ${target}`);
          }
          directoryModes.set(target, { identity: observed, mode: record.mode });
        }
        const hash = crypto.createHash("sha256");
        if (smallFileMaxBytes > 0 && before.size <= smallFileMaxBytes) {
          const selectedBytes = await handle.readFile();
          hash.update(selectedBytes);
          await fs.promises.writeFile(copied, selectedBytes, { flag: "wx", mode: before.mode & 0o777 });
          bufferedFileCount++;
        } else {
          await pipeline(handle.createReadStream({ autoClose: false }),
            new Transform({ transform(chunk, encoding, callback) { hash.update(chunk); callback(null, chunk); } }),
            fs.createWriteStream(copied, { flags: "wx", mode: before.mode & 0o777 }));
          streamedFileCount++;
        }
        const after = await handle.stat(), current = fs.lstatSync(filename);
        if (!current.isFile() || current.isSymbolicLink() || [after, current].some(stat => fileChanged(before, stat)) ||
            parentIdentity(parents(root, filename)) !== parentIdentity(parentBefore) ||
            !contained(physicalRoot, fs.realpathSync.native(filename))) throw new Error(`Selected source changed while streaming: ${filename}`);
        if (parentIdentity(parents(frozenRoot, copied)) !== parentIdentity(destinationBefore)) throw new Error(`Frozen parent changed while streaming: ${copied}`);
        fs.chmodSync(copied, before.mode & 0o777);
        entry.sha256 = hash.digest("hex"); entry.mode = before.mode & 0o777;
        bytes += before.size; fileCount++;
      } catch (error) { failure ??= error; }
      finally { if (handle) await handle.close(); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, leaves.length) }, readFiles));
  if (failure) throw failure;
  // Apply each observed source directory mode once, after copying has finished.
  for (const [folder, record] of [...directoryModes].sort(([a], [b]) => b.length - a.length)) {
    const observed = parents(frozenRoot, path.join(folder, "__mode_identity__"))[0];
    if (parentIdentity([observed]) !== parentIdentity([record.identity])) throw new Error(`Frozen directory changed before mode application: ${folder}`);
    fs.chmodSync(folder, record.mode);
  }
  phasesMs.copy = performance.now() - copyStarted;
  function aggregate(tree) {
    tree.inventory = tree.entries.map(entry => ({ path: entry.path, sha256: entry.tree ? aggregate(entry.tree) : entry.sha256 }));
    return sha(JSON.stringify(tree.inventory));
  }
  const sha256 = aggregate(rootTree);
  const gitStarted = performance.now();
  // Only frozen metadata is adjusted. Source HEAD/index and already-read source files are never revisited.
  for (const tree of [...trees].reverse()) {
    git(tree.frozenRoot, ["reset", "--mixed", tree.head]);
    const regular = tree.entries.filter(entry => !entry.tree && entry.sha256 !== "deleted");
    const objects = regular.length ? git(tree.frozenRoot, ["hash-object", "-w", "--no-filters", "--stdin-paths"], regular.map(entry => entry.path).join("\n") + "\n").trim().split("\n") : [];
    if (objects.length !== regular.length) throw new Error(`Frozen object count differs: ${tree.frozenRoot}`);
    regular.forEach((entry, index) => { entry.frozenObject = objects[index]; });
    let empty;
    const rows = tree.entries.filter(entry => !entry.tree || entry.index).map(entry => {
      const mode = entry.tree ? "160000" : entry.index?.mode || "100644";
      if (!["100644", "100755", "120000", "160000"].includes(mode)) throw new Error(`Unsupported selected index mode: ${entry.path}`);
      const object = entry.tree ? entry.tree.head : entry.frozenObject || entry.index?.object || (empty ??= git(tree.frozenRoot, ["hash-object", "-w", "--stdin"], "").trim());
      return `${mode} ${object}\t${entry.path}\0`;
    }).join("");
    git(tree.frozenRoot, ["read-tree", "--empty"]);
    if (rows) git(tree.frozenRoot, ["update-index", "-z", "--index-info"], rows);
  }
  phasesMs.git = performance.now() - gitStarted;
  const hashStarted = performance.now();
  const frozen = await snapshotProject(frozenRoot, { concurrency });
  phasesMs.finalHash = performance.now() - hashStarted;
  if (frozen.sha256 !== sha256 || frozen.fileCount !== fileCount || frozen.bytes !== bytes) throw new Error("Frozen project aggregate differs from selected stream bytes");
  return { schema: 1, state: "succeeded", exitCode: 0, root, frozenRoot, sha256, sourceBytesHash: sha256, fileCount, bytes,
    startedUtc, completedUtc: new Date().toISOString(), elapsedMs: performance.now() - started, phasesMs,
    copyIo: { smallFileMaxBytes, bufferedFileCount, streamedFileCount },
    semantics: "Each file is selected over its own read interval; this is not an atomic snapshot of the changing source repository. Later source edits are excluded.",
    inventory: trees.map(tree => ({ root: tree.root, frozenRoot: tree.frozenRoot, head: tree.head, selectedUtc: tree.selectedUtc, selectedPaths: tree.selectedPaths, entries: tree.inventory })),
    frozenSnapshot: frozen };
}
module.exports = { captureProject, parents, parentIdentity, fileChanged, contained };
if (require.main === module) {
  const [root, destination, report] = process.argv.slice(2);
  captureProject(root, destination).then(result => {
    fs.writeFileSync(report, JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify({ sha256: result.sha256, fileCount: result.fileCount, bytes: result.bytes, startedUtc: result.startedUtc, completedUtc: result.completedUtc, elapsedMs: result.elapsedMs, phasesMs: result.phasesMs, copyIo: result.copyIo }));
  }).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
