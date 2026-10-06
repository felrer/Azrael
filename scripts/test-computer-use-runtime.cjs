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
function pkg(rel, name, dependencies = {}) { write(`source/bin/${rel}/package.json`, JSON.stringify({ name, version: name === '@oai/sky' ? '0.7.4' : '1.2.3', dependencies })); write(`source/bin/${rel}/LICENSE`, 'fixture license'); }
try {
  write('source/bin/node_repl.exe', 'fixture repl'); write('source/bin/node.exe', 'fixture node');
  const { TRANSPORT } = require('./inject-sky-control-policy.cjs');
  write('source/bin/' + TRANSPORT, fs.readFileSync(path.resolve(__dirname, '../artifacts/releases/turn_render_fix_20261006_r1/computer-use', TRANSPORT)));
  pkg('node_modules/@oai/sky', '@oai/sky', { dependency: '^1', transitive: '^1' });
  write('source/bin/node_modules/@oai/sky/bin/windows/codex-computer-use.exe', fs.readFileSync(path.resolve(__dirname, '../artifacts/releases/computer_use_20261004_v6/computer-use/node_modules/@oai/sky/bin/windows/codex-computer-use.exe')));
  pkg('node_modules/dependency', 'dependency', { transitive: '^1' });
  pkg('node_modules/transitive', 'transitive');
  pkg('node_modules/dependency/node_modules/transitive', 'transitive');
  pkg('node_modules/unrelated', 'unrelated');
  for (const rel of ['skills/computer-use/SKILL.md', 'docs/guidance.md', 'docs/api.md', 'docs/confirmations.md', '.codex-plugin/plugin.json', 'LICENSE']) write(`plugin/${rel}`, 'fixture instructions');
  const options = { runtimeDirectory: path.join(root, 'source'), pluginDirectory: path.join(root, 'plugin'), destination: path.join(root, 'bundle') };
  write('mode-guide.md', 'Selected-window guidance');
  write('plugin/skills/computer-use/SKILL.md', '---\nname: computer-use\ndescription: Existing computer use\n---\nOriginal Sky instructions');
  const routed = stageRuntime({ ...options, destination: path.join(root, 'routed'), selectedWindowGuide: path.join(root, 'mode-guide.md') });
  const routedSkill = fs.readFileSync(path.join(routed.directory, 'skills/computer-use/SKILL.md'), 'utf8');
  assert(routedSkill.startsWith('---\nname: computer-use\n'));
  const windowSkill = fs.readFileSync(path.join(routed.directory, 'skills/window-use/SKILL.md'), 'utf8');
  assert(windowSkill.startsWith('---\nname: window-use\n'));
  assert(windowSkill.includes('Selected-window guidance'));
  assert(routedSkill.includes('Original Sky instructions'));
  assert.equal(fs.readFileSync(path.join(routed.directory, 'docs/selected-window.md'), 'utf8'), 'Selected-window guidance');
  assert.equal(verifyRuntime(routed.directory).manifestSha256, routed.manifestSha256);
  const staged = stageRuntime(options);
  assert.equal(staged.manifest.schema, 1);
  assert.equal(staged.manifest.packages.length, 4);
  const { TRANSPORT_POLICY_MODULES } = require('./inject-sky-control-policy.cjs');
  for (const rel of TRANSPORT_POLICY_MODULES) {
    const rootEntry = staged.manifest.files.find(entry => entry.path === path.posix.basename(rel));
    const packageEntry = staged.manifest.files.find(entry => entry.path === rel);
    assert.equal(packageEntry.sha256, rootEntry.sha256);
    assert.equal(packageEntry.source, rootEntry.source);
  }
  const sky = staged.manifest.files.find(e => e.path.endsWith('/codex-computer-use.exe'));
  assert.equal(sky.transform.signature, 'unsigned-local-copy');
  assert.notEqual(sky.sourceSha256, sky.sha256);
  assert(fs.readFileSync(sky.source).includes(Buffer.from('Codex is using your computer')));
  assert(fs.readFileSync(path.join(staged.directory, sky.path)).includes(Buffer.from('Azrael is using the computer')));
  assert(!fs.existsSync(path.join(options.destination, 'node_modules/unrelated')));
  assert(fs.existsSync(path.join(options.destination, '.codex-plugin/plugin.json')));
  assert(fs.existsSync(path.join(options.destination, 'LICENSE')));
  console.log('PASS recursive and nested dependency closure; unrelated package excluded; license/provenance preserved');
  const moved = path.join(root, 'relocated'); fs.renameSync(options.destination, moved);
  assert.equal(verifyRuntime(moved).manifestSha256, staged.manifestSha256);
  console.log('PASS relocated bundle verification without access to original source');
  fs.renameSync(path.join(root, 'source'), path.join(root, 'removed-source'));
  assert.equal(verifyRuntime(moved).manifestSha256, staged.manifestSha256);
  const wrapper = path.join(moved, 'sky-controlled-service.mjs'), wrapperBytes = fs.readFileSync(wrapper);
  fs.unlinkSync(wrapper); assert.throws(() => verifyRuntime(moved), /ENOENT|missing/); fs.writeFileSync(wrapper, wrapperBytes);
  const transportPath = path.join(moved, TRANSPORT), transportBytes = fs.readFileSync(transportPath);
  fs.writeFileSync(transportPath, 'tampered transport'); assert.throws(() => verifyRuntime(moved), /hash mismatch/); fs.writeFileSync(transportPath, transportBytes);
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


test('Sky display branding changes only its label and PE signature metadata and rejects unknown binaries', () => {
  const { brandComputerUse } = require('./computer-use-branding.cjs');
  const source = fs.readFileSync(path.resolve(__dirname, '../artifacts/releases/computer_use_20261004_v6/computer-use/node_modules/@oai/sky/bin/windows/codex-computer-use.exe'));
  const { content, transform } = brandComputerUse(source);
  const optional = source.readUInt32LE(0x3c) + 24;
  const ranges = [[transform.labelOffset, transform.labelOffset + Buffer.byteLength(transform.before)], [optional + 64, optional + 68], [optional + 144, optional + 152]];
  assert.equal(content.length, source.length);
  for (let i = 0; i < source.length; i++)
    if (source[i] !== content[i]) assert(ranges.some(([start, end]) => i >= start && i < end), `unexpected modified byte ${i}`);
  assert(content.includes(Buffer.from('Esc to cancel')));
  assert.deepEqual(brandComputerUse(content).content, content);
  const tampered = Buffer.from(source); tampered[0] ^= 1;
  assert.throws(() => brandComputerUse(tampered), /Unsupported Sky/);
});
