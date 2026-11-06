'use strict';
// Shared protection and publication for optional, attempt-local observations.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
let nodeSha256;

function unlinked(filename) {
  for (let current = filename; ; current = path.dirname(current)) {
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) throw Error('Linked observation path');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
}

function binding(root, context, tools, allowInsideRoot = false) {
  if (process.platform !== 'win32' || !context || typeof context.generation !== 'string' || !context.generation ||
      typeof context.statePath !== 'string' || !path.isAbsolute(context.statePath) ||
      context.statePath.split(/[\\/]/).includes('..') || !/^[A-Za-z]:[\\/]/.test(root)) throw Error('Unsupported observation context');
  const relative = path.relative(root, context.statePath);
  if (!relative || (!allowInsideRoot && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw Error('Observation state is inside source');
  unlinked(root);
  unlinked(context.statePath);
  const drive = path.parse(root).root;
  const probe = '$d=[IO.DriveInfo]::new($env:AZRAEL_SOURCE_OBSERVATION_DRIVE); if($d.DriveType -eq [IO.DriveType]::Fixed -and $d.DriveFormat -ceq "NTFS"){[Console]::Write("NTFS")}else{exit 1}';
  const result = execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(probe, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 10000, env: { ...process.env, AZRAEL_SOURCE_OBSERVATION_DRIVE: drive }, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result !== 'NTFS') throw Error('Local NTFS required');
  nodeSha256 ??= hash(fs.readFileSync(process.execPath));
  return { generation: context.generation, root: fs.realpathSync.native(root),
    node: { path: process.execPath, version: process.version, sha256: nodeSha256 },
    tools: Object.fromEntries(['source-observation.cjs', ...tools]
      .map(name => [name, hash(fs.readFileSync(path.join(__dirname, name)))])) };
}

function publish(filename, value) {
  unlinked(filename);
  const temporary = `${filename}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let created = false;
  try {
    const descriptor = fs.openSync(temporary, 'wx');
    created = true;
    try { fs.writeFileSync(descriptor, JSON.stringify(value) + '\n'); }
    finally { fs.closeSync(descriptor); }
    unlinked(filename);
    fs.renameSync(temporary, filename);
  } finally {
    if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

module.exports = { binding, publish, unlinked, hash };
