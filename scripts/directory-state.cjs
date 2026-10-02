'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function enumerate(root, prefix = '') {
  const entries = await fs.promises.readdir(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await enumerate(root, relative));
    else if (entry.isFile() || (entry.isSymbolicLink() && (await fs.promises.stat(path.join(root, relative))).isFile())) files.push(relative);
  }
  return files;
}

async function hashFile(root, realRoot, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative)) {
    throw new Error('Directory manifest requires nonempty relative file paths.');
  }
  const fullPath = path.resolve(root, relative);
  if (!isInside(root, fullPath)) throw new Error(`Directory manifest path escapes root: ${relative}`);
  const realPath = await fs.promises.realpath(fullPath);
  if (!isInside(realRoot, realPath)) throw new Error(`Directory file resolves outside root: ${relative}`);
  const handle = await fs.promises.open(fullPath, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`Directory manifest entry is not a file: ${relative}`);
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    // The descriptor is closed by finally, including failed streams.
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    const after = await handle.stat();
    const current = await fs.promises.stat(fullPath);
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs || current.dev !== after.dev || current.ino !== after.ino ||
        current.size !== after.size || current.mtimeMs !== after.mtimeMs || current.ctimeMs !== after.ctimeMs) {
      throw new Error(`Directory file changed while hashing: ${relative}`);
    }
    return { bytes, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
  }
}

async function getDirectoryState(root, orderedRelativePaths, concurrency = 8) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Directory root must be an absolute path.');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Directory hash concurrency must be an integer from 1 to 8.');
  if (!(await fs.promises.stat(root)).isDirectory()) throw new Error('Directory root must be a directory.');
  const realRoot = await fs.promises.realpath(root);
  const relatives = orderedRelativePaths === undefined ? (await enumerate(root)).sort() : orderedRelativePaths;
  if (!Array.isArray(relatives)) throw new Error('Directory manifest must be an array of relative file paths.');
  if (new Set(relatives).size !== relatives.length) throw new Error('Directory manifest contains duplicate paths.');
  const results = new Array(relatives.length);
  let cursor = 0;
  let failure;
  const workers = Array.from({ length: Math.min(concurrency, relatives.length) }, async () => {
    while (!failure && cursor < relatives.length) {
      const index = cursor++;
      try { results[index] = await hashFile(root, realRoot, relatives[index]); }
      catch (error) { failure ??= error; }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
  const aggregate = crypto.createHash('sha256');
  let bytes = 0;
  for (let index = 0; index < relatives.length; index++) {
    const result = results[index];
    // Match the existing PowerShell normalization of Windows separators.
    const recordPath = relatives[index].replaceAll('\\', '/');
    aggregate.update(`${recordPath}\0${result.bytes}\0${result.sha256}\n`, 'utf8');
    bytes += result.bytes;
  }
  return { path: root, sha256: aggregate.digest('hex'), fileCount: relatives.length, bytes };
}

module.exports = { getDirectoryState };

if (require.main === module) {
  (async () => {
    const [root, manifest, ...extra] = process.argv.slice(2);
    if (!root || extra.length) throw new Error('Usage: node directory-state.cjs <absolute root> [manifest JSON]');
    const orderedPaths = manifest === undefined ? undefined : JSON.parse(await fs.promises.readFile(manifest, 'utf8'));
    process.stdout.write(`${JSON.stringify(await getDirectoryState(root, orderedPaths))}\n`);
  })().catch(error => {
    process.stderr.write(`Directory state failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
