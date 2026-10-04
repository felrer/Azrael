'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { getDirectoryState } = require('./directory-state.cjs');

function reference(root, relatives) {
  const aggregate = crypto.createHash('sha256');
  let bytes = 0;
  for (const relative of relatives) {
    const data = fs.readFileSync(path.join(root, relative));
    aggregate.update(`${relative.replaceAll('\\', '/')}\0${data.length}\0${crypto.createHash('sha256').update(data).digest('hex')}\n`);
    bytes += data.length;
  }
  return { path: root, sha256: aggregate.digest('hex'), fileCount: relatives.length, bytes };
}

(async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-directory-state-test-'));
  const root = path.join(fixture, 'root');
  fs.mkdirSync(root);
  try {
    assert.deepEqual(await getDirectoryState(root), reference(root, []));
    const relatives = ['z.txt', 'A.txt', 'a-2.txt', 'é.txt', '한글.txt', path.join('nested', 'Case.txt'), '.hidden'];
    fs.mkdirSync(path.join(root, 'nested'));
    for (const [index, relative] of relatives.entries()) fs.writeFileSync(path.join(root, relative), Buffer.from([index, 0, 255, 10]));
    assert.deepEqual(await getDirectoryState(root, relatives), reference(root, relatives));
    assert.deepEqual(await getDirectoryState(root), reference(root, [...relatives].sort()));
    const original = await getDirectoryState(root);
    const modifiedPath = path.join(root, 'z.txt');
    const originalTime = fs.statSync(modifiedPath).mtime;
    fs.writeFileSync(modifiedPath, Buffer.from([99, 0, 255, 10]));
    fs.utimesSync(modifiedPath, originalTime, originalTime);
    assert.notEqual((await getDirectoryState(root)).sha256, original.sha256, 'same size and restored mtime must not hide changes');
    fs.writeFileSync(path.join(root, 'added'), 'added');
    assert.equal((await getDirectoryState(root)).fileCount, relatives.length + 1);
    fs.unlinkSync(path.join(root, 'added'));
    assert.equal((await getDirectoryState(root)).fileCount, relatives.length);
    await assert.rejects(getDirectoryState(root, ['missing']), /ENOENT/);
    await assert.rejects(getDirectoryState(root, ['..' + path.sep + 'outside']), /escapes root/);
    await assert.rejects(getDirectoryState(root, [path.resolve(root, 'A.txt')]), /relative file paths/);
    await assert.rejects(getDirectoryState(root, ['A.txt\0bad']), /relative file paths/);
    await assert.rejects(getDirectoryState(root, ['A.txt', 'A.txt']), /duplicate/);
    await assert.rejects(getDirectoryState(root, ['nested']), /not a file/);
    await assert.rejects(getDirectoryState(root, {}), /must be an array/);
    await assert.rejects(getDirectoryState(root, [], 9), /concurrency/);
    await assert.rejects(getDirectoryState(path.join(root, 'absent')), /ENOENT/);
    const corruptManifest = path.join(fixture, 'corrupt.json');
    fs.writeFileSync(corruptManifest, '{invalid-json');
    const cli = spawnSync(process.execPath, [path.join(__dirname, 'directory-state.cjs'), root, corruptManifest], { encoding: 'utf8' });
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /Directory state failed:/);
    assert.equal(cli.stdout, '');
    const outside = path.join(fixture, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'file'), 'outside');
    fs.symlinkSync(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(getDirectoryState(root, [path.join('escape', 'file')]), /outside root/);

    // Instrument actual open descriptors, preserving the real streaming implementation.
    const open = fs.promises.open;
    let active = 0;
    let maximum = 0;
    const many = Array.from({ length: 24 }, (_, index) => `many-${index}`);
    for (const relative of many) fs.writeFileSync(path.join(root, relative), Buffer.alloc(256 * 1024, 17));
    fs.promises.open = async (...args) => {
      const handle = await open.apply(fs.promises, args);
      active++;
      maximum = Math.max(maximum, active);
      const close = handle.close.bind(handle);
      let closed = false;
      handle.close = async () => {
        try { return await close(); }
        finally { if (!closed) { closed = true; active--; } }
      };
      return handle;
    };
    try {
      assert.deepEqual(await getDirectoryState(root, many), reference(root, many));
      assert.equal(maximum, 8);
      assert.equal(active, 0);
      maximum = 0;
      await getDirectoryState(root, many, 2);
      assert.equal(maximum, 2);
      assert.equal(active, 0);
    } finally { fs.promises.open = open; }

    fs.promises.open = async (...args) => {
      const handle = await open.apply(fs.promises, args);
      const stream = handle.createReadStream.bind(handle);
      handle.createReadStream = options => (async function* () {
        let changed = false;
        for await (const chunk of stream(options)) {
          if (!changed) { changed = true; fs.appendFileSync(args[0], 'changed-during-read'); }
          yield chunk;
        }
      })();
      return handle;
    };
    try { await assert.rejects(getDirectoryState(root, [many[0]]), /changed while hashing/); }
    finally { fs.promises.open = open; }
    console.log('PASS: reference digest, deterministic enumeration, full-byte rehash, add/delete, manifest containment, errors, concurrency 8/2, in-flight change detection');
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
