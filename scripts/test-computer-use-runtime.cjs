'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { stageRuntime, verifyRuntime } = require('./computer-use-runtime.cjs');
// Pristine official input recorded in artifacts/logs/cua-window-candidate/intermediate-receipt.json.
// Sky 0.7.4 is the supported transform input; the installed Azrael executable is already branded.
const officialRuntime = path.resolve(process.env.AZRAEL_TEST_COMPUTER_USE_RUNTIME || path.join(process.env.LOCALAPPDATA, 'OpenAI/Codex/runtimes/cua_node/b63ee7ee40c23b77'));
const officialBin = path.join(officialRuntime, 'bin');
const officialPlugin = path.join(os.homedir(), '.azrael-ex/plugins/cache/openai-bundled/computer-use/26.930.21537');
function cleanup(root) {
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('azrael-computer-use-packaging-')) throw new Error('Unsafe fixture cleanup path');
  fs.rmSync(root, { recursive: true });
}
test('recorded official Computer Use inputs stage with their complete dependency provenance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-computer-use-packaging-'));
  try {
    const staged = stageRuntime({ runtimeDirectory: officialRuntime, pluginDirectory: officialPlugin, destination: path.join(root, 'bundle') });
    assert.equal(staged.manifest.source.runtimeDirectory, officialRuntime);
    assert.equal(staged.manifest.source.pluginDirectory, officialPlugin);
    assert.equal(staged.manifest.packages.find(pkg => pkg.name === '@oai/sky').version, '0.7.4');
    const sky = staged.manifest.files.find(entry => entry.path.endsWith('/codex-computer-use.exe'));
    assert.equal(sky.sourceSha256, require('./computer-use-branding.cjs').SOURCE_SHA256);
    assert.notEqual(sky.sha256, sky.sourceSha256);
    assert.equal(verifyRuntime(staged.directory).manifestSha256, staged.manifestSha256);
  } finally { cleanup(root); }
});
test('Computer Use packaging preserves dependency provenance and rejects unsafe or corrupt payloads after relocation', () => {
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-computer-use-packaging-'));
function write(rel, text) { const target = path.join(root, rel); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); }
function pkg(rel, name, dependencies = {}) { write(`source/bin/${rel}/package.json`, JSON.stringify({ name, version: name === '@oai/sky' ? '0.7.4' : '1.2.3', dependencies })); write(`source/bin/${rel}/LICENSE`, 'fixture license'); }
try {
  write('source/bin/node_repl.exe', 'fixture repl'); write('source/bin/node.exe', 'fixture node');
  const { TRANSPORT } = require('./inject-sky-control-policy.cjs');
  write('source/bin/' + TRANSPORT, fs.readFileSync(path.join(officialBin, TRANSPORT)));
  pkg('node_modules/@oai/sky', '@oai/sky', { dependency: '^1', transitive: '^1' });
  write('source/bin/node_modules/@oai/sky/bin/windows/codex-computer-use.exe', fs.readFileSync(path.join(officialBin, 'node_modules/@oai/sky/bin/windows/codex-computer-use.exe')));
  pkg('node_modules/dependency', 'dependency', { transitive: '^1' });
  pkg('node_modules/transitive', 'transitive');
  pkg('node_modules/dependency/node_modules/transitive', 'transitive');
  pkg('node_modules/unrelated', 'unrelated');
  for (const rel of ['skills/computer-use/SKILL.md', 'docs/guidance.md', 'docs/api.md', 'docs/confirmations.md', '.codex-plugin/plugin.json', 'LICENSE']) write(`plugin/${rel}`, 'fixture instructions');
  const options = { runtimeDirectory: path.join(root, 'source'), pluginDirectory: path.join(root, 'plugin'), destination: path.join(root, 'bundle') };
  write('mode-guide.md', 'Selected-window guidance');
  for (const name of ['common', 'stage-1', 'stage-2', 'stage-3', 'stage-4']) write(`window-use/${name}.md`, `${name} guidance`);
  write('plugin/skills/computer-use/SKILL.md', '---\nname: computer-use\ndescription: Existing computer use\n---\nOriginal Sky instructions');
  const routed = stageRuntime({ ...options, destination: path.join(root, 'routed'), selectedWindowGuide: path.join(root, 'mode-guide.md') });
  const routedSkill = fs.readFileSync(path.join(routed.directory, 'docs/computer-use-skill.md'), 'utf8');
  assert.equal(fs.existsSync(path.join(routed.directory, 'skills/computer-use')), false);
  assert.equal(routed.manifest.windowUseGuidanceVersion, 1);
  for (const rel of require('./computer-use-runtime.cjs').WINDOW_GUIDES) assert(routed.manifest.files.some(entry => entry.path === rel));
  assert(routedSkill.startsWith('---\nname: computer-use\n'));
  const windowSkill = fs.readFileSync(path.join(routed.directory, 'skills/window-use/SKILL.md'), 'utf8');
  assert(windowSkill.startsWith('---\nname: window-use\n'));
  assert(windowSkill.includes('Selected-window guidance'));
  assert(routedSkill.includes('Original Sky instructions'));
  assert.equal(fs.readFileSync(path.join(routed.directory, 'docs/selected-window.md'), 'utf8'), 'Selected-window guidance');
  assert.equal(routed.manifest.files.find(entry => entry.path === require('./inject-sky-control-policy.cjs').TRANSPORT).transform.version, 4);
  assert.equal(verifyRuntime(routed.directory).manifestSha256, routed.manifestSha256);
  const routedManifestFile = path.join(routed.directory, 'manifest.json'), routedManifestBytes = fs.readFileSync(routedManifestFile), routedManifest = JSON.parse(routedManifestBytes);
  routedManifest.files.find(entry => entry.path === require('./inject-sky-control-policy.cjs').TRANSPORT).transform.version = 3;
  fs.writeFileSync(routedManifestFile, JSON.stringify(routedManifest));
  assert.throws(() => verifyRuntime(routed.directory), /Unsupported Sky policy transform version for runtime/);
  fs.writeFileSync(routedManifestFile, routedManifestBytes);
  const staged = stageRuntime(options);
  assert.equal(staged.manifest.schema, 1);
  assert.equal(staged.manifest.packages.length, 4);
  const { TRANSPORT_POLICY_MODULES } = require('./inject-sky-control-policy.cjs');
  for (const rel of TRANSPORT_POLICY_MODULES) {
    const rootEntry = staged.manifest.files.find(entry => entry.path === path.posix.basename(rel));
    const packageEntry = staged.manifest.files.find(entry => entry.path === rel);
    if (rel.endsWith('/sky-control-policy.mjs')) {
      assert.equal(packageEntry.sourceSha256, rootEntry.sha256);
      assert.equal(fs.readFileSync(path.join(staged.directory, rel), 'utf8'), require('./computer-use-runtime.cjs').TRANSPORT_POLICY_REEXPORT);
    } else assert.equal(packageEntry.sha256, rootEntry.sha256);
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
} finally { cleanup(root); }
});


test('Sky display branding changes only its label and PE signature metadata and rejects unknown binaries', () => {
  const { brandComputerUse } = require('./computer-use-branding.cjs');
  const source = fs.readFileSync(path.join(officialBin, 'node_modules/@oai/sky/bin/windows/codex-computer-use.exe'));
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


test('historical nonguidance v3 runtime verifies its declared receipt without reclassifying bytes', () => {
  const historical = path.resolve(process.env.AZRAEL_TEST_LEGACY_COMPUTER_USE_RUNTIME || 'artifacts/releases/all_changes_20261007_r6/computer-use');
  const before = fs.readFileSync(path.join(historical, 'manifest.json'));
  const manifest = JSON.parse(before), { TRANSPORT, transformTransport } = require('./inject-sky-control-policy.cjs');
  assert.equal(manifest.windowUseGuidanceVersion, undefined);
  assert.equal(manifest.files.find(entry => entry.path === TRANSPORT).transform.version, 3);
  const result = verifyRuntime(historical);
  assert.equal(result.manifestSha256, require('./computer-use-runtime.cjs').hash(before));
  assert.deepEqual(fs.readFileSync(path.join(historical, 'manifest.json')), before);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-computer-use-packaging-'));
  try {
    const copy = path.join(root, 'historical'); fs.cpSync(historical, copy, { recursive: true });
    const bytes = fs.readFileSync(path.join(copy, TRANSPORT));
    const v4 = transformTransport(bytes, '0.7.4');
    fs.writeFileSync(path.join(copy, TRANSPORT), v4.content);
    const entry = manifest.files.find(entry => entry.path === TRANSPORT);
    entry.sha256 = require('./computer-use-runtime.cjs').hash(v4.content); entry.bytes = v4.content.length;
    fs.writeFileSync(path.join(copy, 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => verifyRuntime(copy), /transform provenance mismatch/);
  } finally { cleanup(root); }
});
