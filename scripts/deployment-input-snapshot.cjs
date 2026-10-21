"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");

const sha = value => crypto.createHash("sha256").update(value).digest("hex");

async function snapshotProject(directory, { concurrency = 8 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new Error("Snapshot concurrency must be an integer from 1 to 32.");
  }
  const started = performance.now();
  const root = path.resolve(directory);
  const leaves = [];
  const trees = [];
  let bytes = 0;
  let fileCount = 0;
  async function inventory(folder) {
    const git = spawnSync("git", ["-c", "core.longpaths=true", "-C", folder,
      "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024,
    });
    if (git.error || git.status !== 0) throw new Error(`Project input inventory failed: ${git.error?.message || git.stderr.trim()}`);
    const entries = [...new Set(git.stdout.split("\0").filter(Boolean))].sort().map(relative => ({ path: relative }));
    const tree = { root: folder, entries };
    trees.push(tree);
    for (const entry of entries) {
      const filename = path.resolve(folder, entry.path);
      const relative = path.relative(folder, filename);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Project input path escapes its root: ${entry.path}`);
      }
      let stat;
      try { stat = await fs.promises.stat(filename); } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
        entry.sha256 = "deleted";
        continue;
      }
      if (stat.isDirectory()) {
        try { await fs.promises.access(path.join(filename, ".git")); } catch {
          throw new Error(`Project gitlink is not initialized: ${filename}`);
        }
        entry.tree = await inventory(filename);
      } else if (stat.isFile()) {
        leaves.push({ entry, filename });
      } else {
        throw new Error(`Unsupported project input: ${filename}`);
      }
    }
    return tree;
  }
  const tree = await inventory(root);
  let next = 0;
  let failure;
  async function readFiles() {
    while (!failure && next < leaves.length) {
      const { entry, filename } = leaves[next++];
      try {
        const hash = crypto.createHash("sha256");
        const handle = await fs.promises.open(filename, "r");
        try {
          const before = await handle.stat();
          await pipeline(handle.createReadStream({ autoClose: false }), hash);
          const after = await handle.stat();
          const current = await fs.promises.stat(filename);
          if ([after, current].some(stat => stat.size !== before.size || stat.mtimeMs !== before.mtimeMs ||
              stat.ctimeMs !== before.ctimeMs || stat.ino !== before.ino || stat.dev !== before.dev)) {
            throw new Error(`Project input changed while hashing: ${filename}`);
          }
          entry.sha256 = hash.digest("hex");
          bytes += before.size;
          fileCount++;
        } finally { await handle.close(); }
      } catch (error) { failure ??= error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, leaves.length) }, readFiles));
  if (failure) throw failure;
  function aggregate(current) {
    const records = current.entries.map(entry => ({ path: entry.path,
      sha256: entry.tree ? aggregate(entry.tree) : entry.sha256 }));
    current.inventory = records;
    return sha(JSON.stringify(records));
  }
  const sha256 = aggregate(tree);
  return { schema: 1, sha256, fileCount, bytes, elapsedMs: performance.now() - started,
    inventory: trees.map(item => ({ root: item.root, entries: item.inventory })) };
}

// Compare inventories already measured by the input owner. Diagnostics never
// grant reuse: every consumed change still fails the immutable-input guard.
function compareSnapshots(before, after) {
  function measured(snapshot) {
    if (snapshot?.schema !== 1 || !/^[a-f0-9]{64}$/.test(snapshot.sha256 || '') ||
        !Array.isArray(snapshot.inventory) || !snapshot.inventory.length) throw new Error('Complete measured input inventory required.');
    const root = snapshot.inventory[0].root;
    if (!path.isAbsolute(root || '')) throw new Error('Absolute input inventory root required.');
    const files = new Map(), trees = new Map();
    for (const tree of snapshot.inventory) {
      const prefix = path.relative(root, tree.root || '');
      if (!path.isAbsolute(tree.root || '') || prefix === '..' || prefix.startsWith(`..${path.sep}`) || path.isAbsolute(prefix) ||
          trees.has(prefix) || !Array.isArray(tree.entries)) throw new Error('Invalid input inventory tree.');
      const seen = new Set();
      for (const entry of tree.entries) {
        if (typeof entry.path !== 'string' || !entry.path || path.isAbsolute(entry.path) ||
            entry.path.split(/[\\/]/).some(part => part === '..' || part === '.') || seen.has(entry.path) ||
            (entry.sha256 !== 'deleted' && !/^[a-f0-9]{64}$/.test(entry.sha256 || ''))) throw new Error('Invalid input inventory entry.');
        seen.add(entry.path);
        files.set(path.join(prefix, entry.path).replaceAll('\\', '/'), entry.sha256);
      }
      trees.set(prefix, sha(JSON.stringify(tree.entries)));
    }
    if (trees.get('') !== snapshot.sha256) throw new Error('Input inventory digest mismatch.');
    for (const [prefix, digest] of trees) {
      if (!prefix) continue;
      const key = prefix.replaceAll('\\', '/');
      if (files.get(key) !== digest) throw new Error('Nested input inventory digest mismatch.');
      files.delete(key); // report changed leaves instead of repeating gitlinks
    }
    return { root: path.resolve(root), files };
  }
  const left = measured(before), right = measured(after);
  const rootChanged = left.root !== right.root;
  const changes = [...new Set([...left.files.keys(), ...right.files.keys()])].sort().flatMap(filename => {
    const previous = left.files.get(filename), current = right.files.get(filename);
    if (previous === current) return [];
    return [{ path: filename, kind: current === undefined || current === 'deleted' ? 'removed' :
      previous === undefined || previous === 'deleted' ? 'added' : 'modified', before: previous ?? null, after: current ?? null }];
  });
  const unchanged = !rootChanged && before.sha256 === after.sha256;
  return { schema: 1, status: unchanged ? 'unchanged' : 'consumed-inputs-changed',
    inputRoot: right.root, rootChanged, beforeSha256: before.sha256, afterSha256: after.sha256,
    changes, action: unchanged ? 'continue' : 'reject-affected-results-and-select-new-inputs' };
}

async function main() {
  if (process.argv[2] === 'compare') {
    const [beforePath, afterPath, reportPath, expectedBefore, expectedAfter, ...extra] = process.argv.slice(3);
    if (!beforePath || !afterPath || !reportPath || extra.length || !expectedBefore || !expectedAfter) {
      throw new Error('Usage: deployment-input-snapshot.cjs compare <before> <after> <report> <expected-before-sha256> <expected-after-sha256>');
    }
    const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
    const before = read(beforePath), after = read(afterPath);
    if (before.sha256 !== expectedBefore || after.sha256 !== expectedAfter) throw new Error('Measured input identity changed.');
    const result = compareSnapshots(before, after);
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }
  const [root, reportPath, ...extra] = process.argv.slice(2);
  if (!root || extra.length) throw new Error("Usage: deployment-input-snapshot.cjs <root> [report-path]");
  const result = await snapshotProject(root);
  if (reportPath) await fs.promises.writeFile(reportPath, JSON.stringify(result, null, 2) + "\n");
  const { inventory, ...summary } = result;
  process.stdout.write(JSON.stringify(summary) + "\n");
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`Project input snapshot failed: ${error.message}\n`);
  process.exitCode = 1;
});
module.exports = { snapshotProject, compareSnapshots };
