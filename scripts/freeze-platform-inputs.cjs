"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { snapshotProject } = require("./deployment-input-snapshot.cjs");
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function contained(root, file) {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function safeLink(file, root) {
  const target = fs.readlinkSync(file);
  if (path.isAbsolute(target) || path.win32.isAbsolute(target) || !contained(root, path.resolve(path.dirname(file), target))) {
    throw new Error(`Snapshot symbolic link escapes input root: ${file}`);
  }
  let resolved;
  try { resolved = fs.realpathSync(file); }
  catch (error) { throw new Error(`Snapshot symbolic link is dangling or invalid: ${file}: ${error.code}`); }
  if (!contained(fs.realpathSync(root), resolved)) throw new Error(`Snapshot symbolic link resolves outside input root: ${file}`);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Unsupported symbolic link target: ${file}`);
  return { target, stat };
}
function copyTree(source, destination, exclusions = ["target", "node_modules", ".git"], boundary) {
  const stat = fs.lstatSync(source);
  const sourceRoot = boundary || (stat.isDirectory() ? path.resolve(source) : path.dirname(path.resolve(source)));
  if (stat.isSymbolicLink()) {
    const { target, stat: resolvedStat } = safeLink(source, sourceRoot);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(target, destination, resolvedStat.isDirectory() ? "dir" : "file");
    if (fs.readlinkSync(source) !== target) throw new Error(`Snapshot link changed while copying: ${source}`);
  } else if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source).sort()) {
      if (exclusions.includes(name)) continue;
      copyTree(path.join(source, name), path.join(destination, name), exclusions, sourceRoot);
    }
    fs.chmodSync(destination, stat.mode & 0o777);
    if ((fs.lstatSync(source).mode & 0o777) !== (stat.mode & 0o777)) throw new Error(`Snapshot directory mode changed: ${source}`);
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const before = hash(source);
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, stat.mode);
    if (before !== hash(destination) || before !== hash(source) || (fs.lstatSync(source).mode & 0o777) !== (stat.mode & 0o777)) throw new Error(`Snapshot input changed: ${source}`);
  } else throw new Error(`Unsupported snapshot input: ${source}`);
}
function inventoryTree(root) {
  root = path.resolve(root);
  const records = [], directories = [], links = [];
  function visit(folder) {
    directories.push({ path: path.relative(root, folder).split(path.sep).join("/"), mode: fs.lstatSync(folder).mode & 0o777 });
    for (const name of fs.readdirSync(folder).sort()) {
      const file = path.join(folder, name), stat = fs.lstatSync(file);
      const relative = path.relative(root, file).split(path.sep).join("/");
      if (stat.isSymbolicLink()) {
        const { target, stat: resolvedStat } = safeLink(file, root);
        links.push({ path: relative, target });
        if (resolvedStat.isFile()) records.push({ path: relative, sha256: hash(file), mode: resolvedStat.mode & 0o777, kind: "symlink" });
      } else if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) records.push({ path: relative, sha256: hash(file), mode: stat.mode & 0o777, kind: "file" });
      else throw new Error(`Unsupported frozen input: ${file}`);
    }
  }
  visit(root);
  return { sha256: crypto.createHash("sha256").update(JSON.stringify({ files: records, directories, links })).digest("hex"), files: records, directories, links };
}
async function freezeProject(root, destination) {
  root = path.resolve(root);
  const before = await snapshotProject(root);
  const selected = before.inventory.flatMap(tree => tree.entries.filter(entry => entry.sha256 !== "deleted").map(entry => path.join(tree.root, entry.path)));
  const physicalRoot = fs.realpathSync(root);
  const parents = new Set([root]);
  for (const file of selected) {
    if (!contained(root, path.resolve(file)) || !contained(physicalRoot, fs.realpathSync(file))) {
      throw new Error(`Selected project input escapes the project root: ${file}`);
    }
    for (let parent = path.dirname(file); contained(root, parent); parent = path.dirname(parent)) {
      parents.add(parent);
      if (parent === root) break;
    }
  }
  function selectedMetadata() {
    return [...new Set([...selected, ...parents])].sort().map(file => {
      const stat = fs.lstatSync(file);
      return { path: path.relative(root, file), mode: stat.mode & 0o777,
        kind: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "unsupported",
        ...(stat.isSymbolicLink() ? { target: safeLink(file, root).target } : {}) };
    });
  }
  const metadata = selectedMetadata();
  fs.mkdirSync(destination, { recursive: true });
  for (const tree of before.inventory) {
    for (const entry of tree.entries) {
      if (entry.sha256 === "deleted") continue;
      const source = path.join(tree.root, entry.path);
      const stat = fs.lstatSync(source);
      if (!stat.isFile() && !stat.isSymbolicLink()) continue;
      const relative = path.relative(root, source);
      copyTree(source, path.join(destination, relative), [], path.resolve(root));
      if (stat.isFile() && hash(path.join(destination, relative)) !== entry.sha256) throw new Error(`Frozen project content mismatch: ${source}`);
    }
  }
  if (JSON.stringify(selectedMetadata()) !== JSON.stringify(metadata)) throw new Error("Project filesystem identity changed while freezing inputs");
  if ((await snapshotProject(root)).sha256 !== before.sha256) throw new Error("Project changed while freezing inputs; start a new build.");
  for (const record of metadata.filter(record => record.kind === "directory")) {
    const copied = path.join(destination, record.path);
    if (fs.existsSync(copied)) fs.chmodSync(copied, record.mode);
  }
  inventoryTree(destination); // Validate copied link targets after the complete inventory has been copied.
  return { ...before, filesystemSha256: crypto.createHash("sha256").update(JSON.stringify(metadata)).digest("hex") };
}
module.exports = { hash, copyTree, inventoryTree, freezeProject };
