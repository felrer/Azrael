'use strict';

// Same-attempt optimization context, never an engine acceptance receipt.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function absolute(filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || filename.split(/[\\/]/).includes('..')) throw Error('Independent absolute handoff path required');
  return path.resolve(filename);
}
function unlinked(filename) {
  filename = absolute(filename);
  for (let current = filename;; current = path.dirname(current)) {
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) throw Error('Linked or nonregular handoff path');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === path.dirname(current)) break;
  }
  return filename;
}
function read(filename) {
  filename = unlinked(filename);
  const before = fs.statSync(filename, { bigint: true });
  if (!before.isFile()) throw Error('Regular handoff file required');
  const bytes = fs.readFileSync(filename);
  const after = fs.statSync(filename, { bigint: true });
  if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key])) throw Error('Handoff file changed while reading');
  unlinked(filename);
  return bytes;
}
function write(filename, bytes) {
  filename = unlinked(filename);
  // The parent owns and creates this log directory; never create arbitrary roots.
  if (!fs.statSync(path.dirname(filename)).isDirectory()) throw Error('Owned handoff directory required');
  fs.writeFileSync(filename, bytes, { flag: 'wx' });
}
function pair(statePath, generation) {
  if (!statePath && !generation) return [];
  if (!statePath || typeof generation !== 'string' || !generation.trim()) throw Error('Source state and generation must be supplied together');
  return ['--source-state', absolute(statePath), '--source-generation', generation];
}
function validState(bytes, generation) {
  const state = JSON.parse(bytes.toString('utf8'));
  if (state.schema !== 1 || !state.entries || Array.isArray(state.entries) || typeof state.entries !== 'object') throw Error('Invalid source state');
  const entries = Object.values(state.entries);
  if (!entries.length || entries.some(entry => !entry || entry.generation !== generation || !entry.metadata || !entry.snapshot)) throw Error('Source state generation mismatch or empty observation');
}
function context(options) {
  if (typeof options.token !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(options.token)) throw Error('Explicit attempt token required');
  return { token: options.token, releaseDirectory: absolute(options.releaseDirectory) };
}
function publish(options) {
  const result = { schema: 1, ...context(options), usable: false };
  pair(options.statePath, options.generation);
  try {
    const bytes = read(options.statePath);
    validState(bytes, options.generation);
    Object.assign(result, { usable: true, statePath: absolute(options.statePath), sourceGeneration: options.generation, stateSha256: sha256(bytes) });
  } catch (error) { result.reason = error.message; }
  write(options.handoffPath, JSON.stringify(result));
  return result;
}
function consume(options) {
  const expected = context(options);
  // Destination authority errors must not be hidden as a cache miss.
  const destination = unlinked(options.destination);
  if (fs.existsSync(destination)) throw Error('Consumer source state already exists');
  let bytes, handoff;
  try {
    handoff = JSON.parse(read(options.handoffPath).toString('utf8'));
    if (handoff.schema !== 1 || !handoff.usable || handoff.token !== expected.token || handoff.releaseDirectory !== expected.releaseDirectory) throw Error('Unavailable or stale handoff');
    pair(handoff.statePath, handoff.sourceGeneration);
    bytes = read(handoff.statePath);
    if (sha256(bytes) !== handoff.stateSha256) throw Error('Source state changed after publication');
    validState(bytes, handoff.sourceGeneration);
  } catch (error) { return { usable: false, reason: error.message }; }
  write(destination, bytes);
  return { usable: true, sourceStatePath: destination, sourceGeneration: handoff.sourceGeneration };
}
function main(argv) {
  const [action, ...args] = argv, options = {};
  if (!['publish', 'consume', 'arguments'].includes(action) || args.length % 2) throw Error('Expected publish|consume|arguments and named options');
  const names = { '--token': 'token', '--release': 'releaseDirectory', '--state': 'statePath', '--generation': 'generation', '--handoff': 'handoffPath', '--destination': 'destination' };
  for (let i = 0; i < args.length; i += 2) {
    if (!names[args[i]] || options[names[args[i]]] !== undefined) throw Error('Unknown or duplicate handoff option');
    options[names[args[i]]] = args[i + 1];
  }
  const result = action === 'arguments' ? pair(options.statePath, options.generation) : action === 'publish' ? publish(options) : consume(options);
  // Native stdout decoding varies between PowerShell hosts/code pages. JSON's
  // ASCII escapes preserve all path characters without changing their meaning.
  console.log(JSON.stringify(result).replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')));
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { publish, consume, provenanceArguments: pair };
