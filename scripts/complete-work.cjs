'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATES = new Set(['succeeded', 'failed', 'cancelled']);
const MAX_FILE_BYTES = 8192;

function parseArgs(args) {
  const values = new Map();
  const allowed = new Set(['--signal-path', '--state', '--summary', '--exit-code']);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!allowed.has(key)) throw new Error('Unknown argument');
    if (values.has(key)) throw new Error('Duplicate argument');
    if (i + 1 >= args.length || allowed.has(args[i + 1])) throw new Error('Missing argument value');
    values.set(key, args[i + 1]);
  }
  const options = {
    signalPath: values.get('--signal-path'),
    state: values.get('--state'),
    summary: values.has('--summary') ? values.get('--summary') : null,
    exitCode: null,
  };
  if (values.has('--exit-code')) {
    const raw = values.get('--exit-code');
    if (!/^-?\d+$/.test(raw)) throw new Error('Exit code must be a signed i32 integer');
    options.exitCode = Number(raw);
  }
  validateOptions(options);
  return options;
}

function validateOptions({ signalPath, state, summary = null, exitCode = null }) {
  if (typeof signalPath !== 'string' || !signalPath || signalPath.includes('\0')) throw new Error('Signal path is required');
  if (!STATES.has(state)) throw new Error('Invalid completion state');
  if (summary !== null && (typeof summary !== 'string' || Buffer.byteLength(summary, 'utf8') > 512)) {
    throw new Error('Summary must be at most 512 UTF-8 bytes');
  }
  if (exitCode !== null && (!Number.isInteger(exitCode) || exitCode < -2147483648 || exitCode > 2147483647)) {
    throw new Error('Exit code must be a signed i32 integer');
  }
}

function readJson(filePath) {
  const before = fs.lstatSync(filePath);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Completion file must be a regular file, not a symlink');
  if (before.size > MAX_FILE_BYTES) throw new Error('Completion file exceeds 8192 bytes');
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('Completion file changed during read');
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > MAX_FILE_BYTES) throw new Error('Completion file exceeds 8192 bytes');
    const after = fs.lstatSync(filePath);
    if (after.isSymbolicLink() || after.dev !== opened.dev || after.ino !== opened.ino) throw new Error('Completion file changed during read');
    return JSON.parse(buffer.subarray(0, size).toString('utf8'));
  } finally {
    fs.closeSync(fd);
  }
}

function finishWork(options) {
  validateOptions(options);
  const signalPath = path.resolve(options.signalPath);
  const filename = path.basename(signalPath);
  const suffix = '.signal.json';
  const workId = filename.endsWith(suffix) ? filename.slice(0, -suffix.length) : '';
  const threadId = path.basename(path.dirname(signalPath));
  if (!UUID.test(workId) || !UUID.test(threadId)) throw new Error('Invalid completion work or thread UUID');
  const parent = fs.lstatSync(path.dirname(signalPath));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('Completion thread parent must be a directory, not a symlink');
  const metadata = readJson(path.join(path.dirname(signalPath), `${workId}.json`));
  if (!metadata || metadata.workId !== workId || metadata.threadId !== threadId || metadata.signalPath !== signalPath || metadata.state !== 'running') {
    throw new Error('Completion metadata identity or signal path mismatch');
  }
  const signal = { workId, state: options.state, summary: options.summary ?? null, exitCode: options.exitCode ?? null };
  const bytes = Buffer.from(JSON.stringify(signal) + '\n', 'utf8');
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Completion signal exceeds 8192 bytes');
  const tempPath = path.join(path.dirname(signalPath), `${randomUUID()}.tmp`);
  let created = false;
  let repeated = false;
  try {
    fs.writeFileSync(tempPath, bytes, { flag: 'wx', mode: 0o600 });
    created = true;
    try {
      fs.linkSync(tempPath, signalPath);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = readJson(signalPath);
      if (!existing || typeof existing !== 'object' || Array.isArray(existing) ||
          Object.keys(existing).some((key) => !Object.hasOwn(signal, key))) {
        throw new Error('Invalid existing completion signal');
      }
      validateOptions({ signalPath, state: existing.state, summary: existing.summary ?? null, exitCode: existing.exitCode ?? null });
      const normalized = { workId: existing.workId, state: existing.state, summary: existing.summary ?? null, exitCode: existing.exitCode ?? null };
      if (Object.keys(signal).some((key) => normalized[key] !== signal[key])) {
        throw new Error('Conflicting completion signal already exists');
      }
      repeated = true;
    }
  } finally {
    if (created) fs.unlinkSync(tempPath);
  }
  return { workId, state: signal.state, repeated };
}

function main(args = process.argv.slice(2)) {
  try {
    process.stdout.write(JSON.stringify({ ok: true, ...finishWork(parseArgs(args)) }) + '\n');
    return 0;
  } catch (error) {
    // Do not echo arbitrary file contents or paths in failure receipts.
    const message = error instanceof SyntaxError ? 'Malformed completion JSON' : error.code ? `Completion file operation failed (${error.code})` : error.message;
    process.stdout.write(JSON.stringify({ ok: false, error: message }) + '\n');
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { parseArgs, finishWork, main };
