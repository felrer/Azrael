'use strict';
// Node/libuv exposes Windows ChangeTime as ctimeNs (separate from birthtime).
// This observes metadata only; the Python owner decides whether to hash source.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function observe(root, excluded) {
  if (process.platform !== 'win32' || !path.isAbsolute(root) || !Array.isArray(excluded)) throw Error('Windows absolute source root and exclusions required');
  const physical = fs.realpathSync.native(root);
  const first = fs.lstatSync(physical, { bigint: true });
  const identity = s => [String(s.dev), String(s.ino), String(s.mode)];
  if (!first.isDirectory() || first.isSymbolicLink()) throw Error('Physical directory required');
  const rows = [['.', ...identity(first)]];
  function visit(directory, relative) {
    for (const child of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = relative ? `${relative}/${child.name}` : child.name;
      if (excluded.includes(name) && child.isDirectory()) continue;
      const filename = path.join(directory, child.name);
      const s = fs.lstatSync(filename, { bigint: true });
      if (s.isSymbolicLink() || !(s.isDirectory() || s.isFile())) throw Error('Linked or unsupported source entry');
      if (s.isDirectory()) {
        rows.push([name, ...identity(s)]);
        visit(filename, name);
        const after = fs.lstatSync(filename, { bigint: true });
        if (String(identity(s)) !== String(identity(after))) throw Error('Source directory replaced');
      } else {
        if (s.nlink !== 1n || typeof s.ctimeNs !== 'bigint' || typeof s.mtimeNs !== 'bigint' || s.ctimeNs <= 0n) throw Error('Shared or unsupported source identity');
        rows.push([name, ...identity(s), String(s.size), String(s.mtimeNs), String(s.ctimeNs)]);
      }
    }
  }
  visit(physical, '');
  if (fs.realpathSync.native(root) !== physical || String(identity(fs.lstatSync(physical, { bigint: true }))) !== String(identity(first))) throw Error('Source root replaced');
  rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return { inventory: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'), entries: rows.length };
}
module.exports = { observe };
if (require.main === module) {
  try {
    const request = JSON.parse(fs.readFileSync(0, 'utf8'));
    process.stdout.write(JSON.stringify(observe(request.root, request.excluded)));
  } catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
}
