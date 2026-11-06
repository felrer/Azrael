'use strict';

// Optional, attempt-local observation reuse. The directory content identity and
// the full validator remain owned by directory-state.cjs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { getDirectoryState } = require('./directory-state.cjs');
const { observe } = require('./engine-source-metadata.cjs');
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

function binding(root, context) {
  if (process.platform !== 'win32' || !context || typeof context.generation !== 'string' || !context.generation ||
      typeof context.statePath !== 'string' || !path.isAbsolute(context.statePath) ||
      context.statePath.split(/[\\/]/).includes('..') || !/^[A-Za-z]:[\\/]/.test(root)) throw Error('Unsupported observation context');
  const relative = path.relative(root, context.statePath);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw Error('Observation state is inside source');
  unlinked(root);
  unlinked(context.statePath);
  const drive = path.parse(root).root;
  // DriveInfo uses the Windows volume API; reject network, removable and non-NTFS
  // volumes. Do not infer filesystem support from a drive-letter spelling.
  const probe = '$d=[IO.DriveInfo]::new($env:AZRAEL_UI_OBSERVATION_DRIVE); if($d.DriveType -eq [IO.DriveType]::Fixed -and $d.DriveFormat -ceq "NTFS"){[Console]::Write("NTFS")}else{exit 1}';
  const result = execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(probe, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 10000, env: { ...process.env, AZRAEL_UI_OBSERVATION_DRIVE: drive }, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result !== 'NTFS') throw Error('Local NTFS required');
  nodeSha256 ??= hash(fs.readFileSync(process.execPath));
  return { generation: context.generation, root: fs.realpathSync.native(root),
    node: { path: process.execPath, version: process.version, sha256: nodeSha256 },
    tools: Object.fromEntries(['ui-source-state.cjs', 'directory-state.cjs', 'engine-source-metadata.cjs']
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

async function getUiSourceState(root, context) {
  if (!context) return getDirectoryState(root);
  let selected, before;
  try { selected = binding(root, context); before = observe(root, [], true); }
  catch { return getDirectoryState(root); }
  const key = hash(JSON.stringify(selected));
  try {
    const saved = JSON.parse(fs.readFileSync(context.statePath, 'utf8'));
    const state = saved.directory;
    if (saved.schema === 1 && saved.binding === key && saved.inventory === before.inventory &&
        state?.path === root && /^[a-f0-9]{64}$/.test(state.sha256) &&
        Number.isSafeInteger(state.fileCount) && state.fileCount >= 0 && Number.isSafeInteger(state.bytes) && state.bytes >= 0 &&
        saved.directorySha256 === hash(JSON.stringify({ directory: state, sharedDirectory: saved.sharedDirectory }))) {
      // Shared files can be edited through another path. Hash their contents on
      // every use rather than trusting their observation alone. Reuse the same
      // validator/ordering contract for this explicitly selected subset.
      const sharedDirectory = before.sharedPaths.length ? await getDirectoryState(root, before.sharedPaths) : null;
      const after = observe(root, [], true);
      if (JSON.stringify(sharedDirectory) === JSON.stringify(saved.sharedDirectory) && after.inventory === before.inventory) {
        // Diagnostics stay outside the semantic source identity/checkpoint.
        try { publish(context.statePath, { ...saved, disposition: 'reused' }); } catch { /* optional cache */ }
        return state;
      }
    }
  } catch { /* Missing/corrupt observations select the complete validator. */ }
  const directory = await getDirectoryState(root);
  try {
    unlinked(root);
    const sharedDirectory = before.sharedPaths.length ? await getDirectoryState(root, before.sharedPaths) : null;
    const after = observe(root, [], true);
    if (after.inventory === before.inventory) publish(context.statePath, {
      schema: 1, binding: key, inventory: after.inventory, directory,
      sharedDirectory, directorySha256: hash(JSON.stringify({ directory, sharedDirectory })), disposition: 'full',
    });
  } catch { /* Uncertain metadata or unwritable state cannot grant reuse. */ }
  return directory;
}

module.exports = { getUiSourceState };
