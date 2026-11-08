"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");

const sha = value => crypto.createHash("sha256").update(value).digest("hex");

async function inventoryProject(root) {
  const leaves = [];
  const trees = [];
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
  return { tree, trees, leaves };
}

async function snapshotProject(directory, { concurrency = 8 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new Error("Snapshot concurrency must be an integer from 1 to 32.");
  }
  const started = performance.now();
  const root = path.resolve(directory);
  let bytes = 0;
  let fileCount = 0;
  const { tree, trees, leaves } = await inventoryProject(root);
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
          if (before.size <= 64 * 1024) {
            // Bound allocation even if the input grows after stat. The extra
            // byte detects growth; partial descriptor reads must reach EOF.
            const buffer = Buffer.alloc(before.size + 1);
            let length = 0;
            while (length < buffer.length) {
              const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
              if (!bytesRead) break;
              length += bytesRead;
            }
            if (length !== before.size) throw new Error(`Project input changed while hashing: ${filename}`);
            hash.update(buffer.subarray(0, length));
          } else {
            await pipeline(handle.createReadStream({ autoClose: false }), hash);
          }
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
        files.set(path.join(prefix, entry.path).replaceAll('\\', '/').replace(/\/$/, ''), entry.sha256);
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
  const conditional = extra.length === 6 && extra[0] === '--baseline' &&
    extra[2] === '--expected-baseline-sha256' && /^[a-f0-9]{64}$/.test(extra[3]) &&
    extra[4] === '--expected-baseline-file-sha256' && /^[a-f0-9]{64}$/.test(extra[5]);
  if (!root || (extra.length && !conditional)) {
    throw new Error('Usage: deployment-input-snapshot.cjs <root> [report-path] [--baseline <full-report> --expected-baseline-sha256 <sha256> --expected-baseline-file-sha256 <sha256>]');
  }
  const result = await snapshotProject(root);
  const { inventory, ...summary } = result;
  let report = result;
  if (conditional) {
    const baselinePath = path.resolve(extra[1]);
    async function physicalBaseline() {
      for (let current = baselinePath; ; current = path.dirname(current)) {
        const stat = await fs.promises.lstat(current);
        if (stat.isSymbolicLink() || (current !== baselinePath && !stat.isDirectory())) {
          throw new Error('Baseline path cannot contain linked or non-directory ancestors.');
        }
        if (path.dirname(current) === current) break;
      }
      return fs.promises.lstat(baselinePath);
    }
    if (path.resolve(reportPath) === baselinePath) throw new Error('Baseline and phase report must be separate files.');
    const before = await physicalBaseline();
    if (!before.isFile() || before.nlink !== 1) throw new Error('Baseline must be a physical unlinked full snapshot file.');
    const sameFile = stat => stat.isFile() && ['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev', 'nlink']
      .every(field => stat[field] === before[field]);
    try {
      const destination = await fs.promises.stat(reportPath);
      if (destination.dev === before.dev && destination.ino === before.ino) {
        throw new Error('Baseline and phase report must be separate files.');
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const physicalPath = await fs.promises.realpath(baselinePath);
    const handle = await fs.promises.open(baselinePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let content;
    try {
      const opened = await handle.stat();
      if (!sameFile(opened)) throw new Error('Baseline snapshot changed while opening.');
      content = await handle.readFile();
      const after = await handle.stat();
      const current = await physicalBaseline();
      if (current.isSymbolicLink() ||
          await fs.promises.realpath(baselinePath) !== physicalPath ||
          !sameFile(after) || !sameFile(current)) {
        throw new Error('Baseline snapshot changed while reading.');
      }
    } finally { await handle.close(); }
    const baselineFileSha256 = sha(content);
    if (baselineFileSha256 !== extra[5]) throw new Error('Baseline file identity changed.');
    const baseline = JSON.parse(content.toString('utf8').replace(/^\uFEFF/, ''));
    if (baseline.sha256 !== extra[3]) throw new Error('Baseline input identity changed.');
    if (!Number.isSafeInteger(baseline.fileCount) || baseline.fileCount < 0 ||
        !Number.isSafeInteger(baseline.bytes) || baseline.bytes < 0) {
      throw new Error('Invalid baseline snapshot summary.');
    }
    const comparison = compareSnapshots(baseline, result);
    if (comparison.status === 'unchanged') {
      if (baseline.fileCount !== result.fileCount || baseline.bytes !== result.bytes) {
        throw new Error('Baseline snapshot summary mismatch.');
      }
      report = { ...summary, schema: 2, status: 'unchanged',
        baseline: { path: physicalPath, sha256: baselineFileSha256, inputSha256: baseline.sha256 } };
    }
  }
  if (reportPath) await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(summary) + "\n");
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`Project input snapshot failed: ${error.message}\n`);
  process.exitCode = 1;
});
module.exports = { snapshotProject, compareSnapshots, inventoryProject };
