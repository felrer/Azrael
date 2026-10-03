'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { stageRuntime, verifyRuntime } = require('./computer-use-runtime.cjs');
test('Computer Use packaging preserves dependency provenance and rejects unsafe or corrupt payloads after relocation', () => {
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-computer-use-packaging-'));
function write(rel, text) { const target = path.join(root, rel); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); }
function pkg(rel, name, dependencies = {}) { write(`source/bin/${rel}/package.json`, JSON.stringify({ name, version: '1.2.3', dependencies })); write(`source/bin/${rel}/LICENSE`, 'fixture license'); }
try {
  write('source/bin/node_repl.exe', 'fixture repl'); write('source/bin/node.exe', 'fixture node');
  pkg('node_modules/@oai/sky', '@oai/sky', { dependency: '^1', transitive: '^1' });
  write('source/bin/node_modules/@oai/sky/bin/windows/codex-computer-use.exe', 'fixture sky service');
  pkg('node_modules/dependency', 'dependency', { transitive: '^1' });
  pkg('node_modules/transitive', 'transitive');
  pkg('node_modules/dependency/node_modules/transitive', 'transitive');
  pkg('node_modules/unrelated', 'unrelated');
  for (const rel of ['skills/computer-use/SKILL.md', 'docs/guidance.md', 'docs/api.md', 'docs/confirmations.md', '.codex-plugin/plugin.json', 'LICENSE']) write(`plugin/${rel}`, 'fixture instructions');
  const options = { runtimeDirectory: path.join(root, 'source'), pluginDirectory: path.join(root, 'plugin'), destination: path.join(root, 'bundle') };
  const staged = stageRuntime(options);
  assert.equal(staged.manifest.schema, 1);
  assert.equal(staged.manifest.packages.length, 4);
  assert(!fs.existsSync(path.join(options.destination, 'node_modules/unrelated')));
  assert(fs.existsSync(path.join(options.destination, '.codex-plugin/plugin.json')));
  assert(fs.existsSync(path.join(options.destination, 'LICENSE')));
  console.log('PASS recursive and nested dependency closure; unrelated package excluded; license/provenance preserved');
  const moved = path.join(root, 'relocated'); fs.renameSync(options.destination, moved);
  assert.equal(verifyRuntime(moved).manifestSha256, staged.manifestSha256);
  console.log('PASS relocated bundle verification without access to original source');
  fs.renameSync(path.join(root, 'source'), path.join(root, 'removed-source'));
  assert.equal(verifyRuntime(moved).manifestSha256, staged.manifestSha256);
  const executable = path.join(moved, 'node.exe'); const original = fs.readFileSync(executable);
  fs.writeFileSync(executable, 'tamper'); assert.throws(() => verifyRuntime(moved), /hash mismatch/); fs.writeFileSync(executable, original);
  fs.unlinkSync(executable); assert.throws(() => verifyRuntime(moved), /ENOENT|missing/); fs.writeFileSync(executable, original);
  const manifestFile = path.join(moved, 'manifest.json'), saved = fs.readFileSync(manifestFile), manifest = JSON.parse(saved);
  manifest.files[0].path = '../escape'; fs.writeFileSync(manifestFile, JSON.stringify(manifest)); assert.throws(() => verifyRuntime(moved), /Unsafe runtime path/); fs.writeFileSync(manifestFile, saved);
  write('relocated/unrecorded.txt', 'extra'); assert.throws(() => verifyRuntime(moved), /Unrecorded/); fs.unlinkSync(path.join(moved, 'unrecorded.txt'));
  console.log('PASS tampered, missing, escaping and unrecorded payloads rejected');
  fs.renameSync(path.join(root, 'removed-source'), path.join(root, 'source'));
  fs.rmSync(path.join(root, 'source/bin/node_modules/transitive'), { recursive: true });
  assert.throws(() => stageRuntime({ ...options, destination: path.join(root, 'missing-dependency') }), /Missing runtime dependency/);
  fs.mkdirSync(path.join(root, 'source/bin/node_modules/transitive')); pkg('node_modules/transitive', 'transitive');
  fs.symlinkSync(path.join(root, 'source/bin/node_modules/transitive'), path.join(root, 'source/bin/node_modules/link'), 'junction');
  write('source/bin/node_modules/@oai/sky/package.json', JSON.stringify({ name: '@oai/sky', version: '1', dependencies: { link: '*' } }));
  assert.throws(() => stageRuntime({ ...options, destination: path.join(root, 'linked') }), /symlink forbidden/);
  console.log('PASS missing transitive dependency and linked package rejected');
  console.log('Computer Use runtime packaging tests passed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
});
