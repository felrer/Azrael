'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { inspectSourceFixtures: inspect, assertSourceFixtures: check } = require('./source-test-fixtures.cjs');
const artifactRun = process.env.AZRAEL_SOURCE_FIXTURE_TEST_ROOT ? null : require('./artifact-run.cjs').beginArtifactRun(path.resolve(__dirname, '..'), {
  workId: 'source-fixture-checks', owner: 'scripts/test-source-test-fixtures.cjs',
});
const parent = process.env.AZRAEL_SOURCE_FIXTURE_TEST_ROOT || artifactRun.temporary;
assert(path.isAbsolute(parent));
fs.mkdirSync(parent, { recursive: true });
const roots = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(parent, 'gate-')); roots.push(root);
  return root;
}
function write(root, relative, value = 'fixture') {
  const filename = path.join(root, relative); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, value); return filename;
}
after(() => { for (const root of roots) { assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true }); } });

test('unrelated selections have no prerequisites or effects', () => {
  assert.deepEqual(check({ root: fixture(), files: ['scripts/test-unrelated.cjs'], env: {} }), { status: 'ready', requirements: [] });
});

test('all missing prerequisites aggregate with structured evidence', () => {
  const root = fixture(), files = ['scripts/test-computer-use-runtime.cjs', 'scripts/test-session-links.cjs', 'scripts/test-instruction-library-host.cjs'];
  const options = { root, files, env: { AZRAEL_TEST_COMPUTER_USE_PLUGIN: path.join(root, 'plugin') } };
  const report = inspect(options);
  assert.equal(report.status, 'blocked');
  assert(report.requirements.filter(r => r.status === 'blocked').length > 15);
  assert.throws(() => check(options), error => error.code === 'AZRAEL_SOURCE_FIXTURES_BLOCKED' && error.readiness.status === 'blocked' && error.message.includes('computer-use.runtime') && error.message.includes('instruction.engine'));
  assert.equal(fs.readdirSync(root).length, 0);
});

test('explicit instruction roots must be nonempty absolute but may have another registered owner', () => {
  const root = fixture(), otherOwner = path.join(parent, 'caller-owned-not-created');
  const files = ['scripts/tests/instruction-catalog.test.cjs', 'scripts/tests/instruction-migration.test.cjs'];
  assert.equal(inspect({ root, files, env: { AZRAEL_CATALOG_TEST_ROOT: otherOwner, AZRAEL_MIGRATION_TEST_ROOT: otherOwner } }).status, 'ready');
  const report = inspect({ root, files, env: { AZRAEL_CATALOG_TEST_ROOT: 'relative', AZRAEL_MIGRATION_TEST_ROOT: '' } });
  assert(report.requirements.every(r => r.status === 'blocked'));
  assert(!fs.existsSync(otherOwner));
});

test('runtime source hashes reject packaged or altered bytes without executing them', () => {
  const root = fixture(), runtime = path.join(root, 'raw'), transport = 'bin/node_modules/@oai/sky/dist/project/cua/sky_js/src/targets/windows/internal/computer_use_client.js';
  write(runtime, transport, 'transformed or corrupt bytes');
  const report = inspect({ root, files: ['scripts/tests/sync-codex-environment.test.cjs'], env: { AZRAEL_TEST_COMPUTER_USE_RUNTIME: runtime } });
  assert.equal(report.requirements.length, 1);
  assert.match(report.requirements[0].reason, /SHA256 mismatch/);
  assert.equal(fs.readFileSync(path.join(runtime, transport), 'utf8'), 'transformed or corrupt bytes');
});

test('LOCALAPPDATA fallback and historical default follow the selected root', () => {
  const root = fixture(), appData = path.join(root, 'local');
  const report = inspect({ root, files: ['scripts/test-computer-use-runtime.cjs'], env: { LOCALAPPDATA: appData, AZRAEL_TEST_COMPUTER_USE_PLUGIN: path.join(root, 'plugin') } });
  assert(report.requirements.find(r => r.id === 'computer-use.transport').path.startsWith(path.join(appData, 'OpenAI/Codex/runtimes/cua_node/b63ee7ee40c23b77/bin')));
  assert.equal(report.requirements.find(r => r.id === 'computer-use.historical-manifest').path, path.join(root, 'artifacts/releases/all_changes_20261007_r6/computer-use/manifest.json'));
});

test('each runtime consumer uses the same bin override; empty runtime/plugin overrides use consumer defaults', () => {
  const root = fixture(), override = path.join(root, 'selected-raw');
  for (const selected of ['scripts/test-computer-use-runtime.cjs', 'scripts/test-sky-control-policy.cjs', 'scripts/tests/sync-codex-environment.test.cjs']) {
    const report = inspect({ root, files: [selected], env: { AZRAEL_TEST_COMPUTER_USE_RUNTIME: override } });
    assert.equal(report.requirements.find(r => r.id === 'computer-use.transport').path,
      path.join(override, 'bin', require('./inject-sky-control-policy.cjs').TRANSPORT));
    assert(report.requirements.every(r => !r.id.startsWith('session-links.') && !r.id.startsWith('instruction.')));
  }
  const report = inspect({ root, files: ['scripts/test-computer-use-runtime.cjs'], env: { LOCALAPPDATA: path.join(root, 'local'), AZRAEL_TEST_COMPUTER_USE_RUNTIME: '', AZRAEL_TEST_COMPUTER_USE_PLUGIN: '' } });
  assert.equal(report.requirements.find(r => r.id === 'computer-use.plugin.docs/api.md').path,
    path.join(os.homedir(), '.azrael-ex/plugins/cache/openai-bundled/computer-use/26.1007.21434/docs/api.md'));
  assert(report.requirements.find(r => r.id === 'computer-use.transport').path.startsWith(path.join(root, 'local')));
});

test('legacy and current link assets stay hardcoded while current package honors its override', () => {
  const root = fixture(), override = path.join(root, 'override'), files = [path.join(root, 'scripts/test-session-links.cjs')];
  const first = inspect({ root, files, env: { AZRAEL_PRESERVATION_UI_ROOT: override } });
  assert.equal(first.requirements.length, 9);
  for (const requirement of first.requirements) write(root, path.relative(root, requirement.path));
  assert.equal(inspect({ root, files, env: { AZRAEL_PRESERVATION_UI_ROOT: override } }).status, 'ready');
  const legacy = first.requirements.find(r => r.id.includes('26.928.31416'));
  fs.unlinkSync(legacy.path);
  const report = inspect({ root, files, env: { AZRAEL_PRESERVATION_UI_ROOT: override } });
  assert.equal(report.requirements.filter(r => r.status === 'blocked').length, 1);
  assert.equal(report.requirements.find(r => r.status === 'blocked').path, legacy.path);
});

test('instruction host accepts exact existing latest codex fallback and validates all release assets', () => {
  const root = fixture(), release = path.join(root, 'release');
  const engine = write(release, `engine/${process.platform === 'win32' ? 'codex.exe' : 'codex'}`);
  write(root, 'artifacts/latest.json', JSON.stringify({ releaseDirectory: release }));
  const assets = path.join(root, 'artifacts/instructions/review-1.0.0');
  write(assets, 'azrael-instructions-1.0.0-manifest.json', JSON.stringify({ archive: { name: 'archive.zip' }, documentsAsset: { name: 'docs.json' } }));
  write(assets, 'archive.zip'); write(assets, 'docs.json');
  const env = { AZRAEL_INSTRUCTION_TEST_ROOT: parent }, files = ['scripts/test-instruction-library-host.cjs'];
  assert.equal(check({ root, files, env }).status, 'ready');
  fs.unlinkSync(engine);
  assert.equal(inspect({ root, files, env }).requirements.find(r => r.id === 'instruction.engine').status, 'blocked');
  assert.equal(inspect({ root, files, env: { ...env, AZRAEL_INSTRUCTION_TEST_ENGINE: 'relative.exe' } }).requirements.find(r => r.id === 'instruction.engine').status, 'blocked');
});

test('service-only keeps optional root default and explicit engine bypasses latest; management requires no release inputs', () => {
  const root = fixture(), engine = write(root, 'engine.exe');
  const service = inspect({ root, files: ['extensions/azrael-ex/test/instructionService.test.ts'], env: { AZRAEL_INSTRUCTION_TEST_ENGINE: engine } });
  assert.equal(service.requirements.find(r => r.id === 'instruction.engine').status, 'ready');
  assert(!service.requirements.some(r => r.id === 'instruction.latest-engine-metadata' || r.id === 'instruction.test-root'));
  assert.equal(service.requirements.find(r => r.id === 'instruction.release-manifest').path,
    path.join(root, 'artifacts/instructions/review-1.0.0/azrael-instructions-1.0.0-manifest.json'));
  const management = inspect({ root, files: ['extensions/azrael-ex/test/instructionManagement.test.ts'], env: { AZRAEL_INSTRUCTION_TEST_ROOT: parent } });
  assert.deepEqual(management.requirements.map(r => r.id), ['instruction.test-root']);
  assert.equal(management.status, 'ready');
});

test('malformed manifests and nonregular prerequisite paths block without changes', () => {
  const root = fixture();
  const assets = path.join(root, 'assets');
  write(assets, 'azrael-instructions-1.0.0-manifest.json', '{partial');
  const report = inspect({ root, files: ['extensions/azrael-ex/test/instructionService.test.ts'], env: { AZRAEL_INSTRUCTION_RELEASE_ASSETS: assets, AZRAEL_INSTRUCTION_TEST_ENGINE: root } });
  assert.equal(report.status, 'blocked');
  assert.equal(report.requirements.find(r => r.id === 'instruction.engine').status, 'blocked');
  assert.equal(report.requirements.find(r => r.id === 'instruction.release-manifest').status, 'blocked');
  assert.equal(fs.readFileSync(path.join(assets, 'azrael-instructions-1.0.0-manifest.json'), 'utf8'), '{partial');
});
