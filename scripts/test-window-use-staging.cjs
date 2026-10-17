'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const scripts = __dirname;
function load(name, overrides = {}, append = '') {
  const file = path.join(scripts, name), realRequire = createRequire(file), module = { exports: {} };
  const context = { require: id => Object.hasOwn(overrides, id) ? overrides[id] : realRequire(id), module, exports: module.exports, __dirname: scripts, __filename: file, Buffer, console, process, structuredClone };
  vm.runInNewContext(fs.readFileSync(file, 'utf8') + append, context, { filename: file });
  return module.exports;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-window-use-staging-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true }); });
  const write = (rel, bytes) => { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); return file; };
  return { root, write };
}
test('unified source staging preserves vendor backend docs and provenance without a duplicate discoverable entry', t => {
  const { root, write } = fixture(t);
  const realInjector = require('./inject-sky-control-policy.cjs');
  // Mock only external binary transforms. This checks payload assembly, not Sky acceptance.
  const runtime = load('computer-use-runtime.cjs', {
    './computer-use-branding.cjs': { SKY_EXECUTABLE: 'node_modules/@oai/sky/bin/windows/codex-computer-use.exe', brandComputerUse: input => ({ content: input, transform: { kind: 'fixture' } }) },
    './inject-sky-control-policy.cjs': { ...realInjector, transformTransport: (input, packageVersion, transformVersion = 4) => ({ content: input, transform: { version: transformVersion, sourceSha256: require('./computer-use-runtime.cjs').hash(input), outputSha256: require('./computer-use-runtime.cjs').hash(input) } }) },
  });
  write('runtime/node.exe', 'mock node'); write('runtime/node_repl.exe', 'mock repl');
  write('runtime/node_modules/@oai/sky/package.json', JSON.stringify({ name: '@oai/sky', version: '0.7.4' }));
  write('runtime/node_modules/@oai/sky/bin/windows/codex-computer-use.exe', 'mock binary');
  write('runtime/' + realInjector.TRANSPORT, 'mock transport');
  const vendor = '---\nname: computer-use\ndescription: vendor\n---\nOriginal initialization and recovery [guide](../../docs/guidance.md)';
  write('plugin/skills/computer-use/SKILL.md', vendor);
  for (const name of ['guidance', 'api', 'confirmations']) write(`plugin/docs/${name}.md`, `preserved ${name}`);
  write('plugin/LICENSE', 'vendor notice');
  const result = runtime.stageRuntime({ runtimeDirectory: path.join(root, 'runtime'), pluginDirectory: path.join(root, 'plugin'), selectedWindowGuide: path.join(scripts, '../instructions/computer-use-selected-window.md'), destination: path.join(root, 'payload') });
  assert.equal(result.manifest.windowUseGuidanceVersion, 1);
  assert.equal(fs.existsSync(path.join(result.directory, 'skills/computer-use')), false);
  assert.equal(fs.readFileSync(path.join(result.directory, 'docs/computer-use-skill.md'), 'utf8'), vendor.replaceAll('../../docs/', './'));
  assert.equal(result.manifest.files.find(x => x.path === 'docs/computer-use-skill.md').sourceSha256, runtime.hash(vendor));
  assert.equal(result.manifest.files.find(x => x.path === 'docs/computer-use-skill.md').source, path.join(root, 'plugin/skills/computer-use/SKILL.md'));
  for (const name of ['guidance', 'api', 'confirmations']) assert.equal(fs.readFileSync(path.join(result.directory, `docs/${name}.md`), 'utf8'), `preserved ${name}`);
  for (const rel of runtime.WINDOW_GUIDES) assert.equal(fs.readFileSync(path.join(result.directory, rel), 'utf8'), fs.readFileSync(path.join(scripts, '../instructions', rel.slice(5)), 'utf8'));
  assert.equal(result.manifest.skyPolicyOwnerVersion, 1);
  const nestedPolicy = realInjector.TRANSPORT_POLICY_MODULES.find(rel => rel.endsWith('/sky-control-policy.mjs'));
  assert.equal(fs.readFileSync(path.join(result.directory, nestedPolicy), 'utf8'), runtime.TRANSPORT_POLICY_REEXPORT);
  const manifestFile = path.join(result.directory, 'manifest.json'), manifestBytes = fs.readFileSync(manifestFile), nestedBytes = fs.readFileSync(path.join(result.directory, nestedPolicy));
  const duplicate = fs.readFileSync(path.join(result.directory, 'sky-control-policy.mjs'));
  fs.writeFileSync(path.join(result.directory, nestedPolicy), duplicate);
  const forged = JSON.parse(manifestBytes), entry = forged.files.find(x => x.path === nestedPolicy);
  entry.sha256 = runtime.hash(duplicate); entry.bytes = duplicate.length;
  fs.writeFileSync(manifestFile, JSON.stringify(forged));
  assert.throws(() => runtime.verifyRuntime(result.directory), /single-owner re-export provenance/);
  fs.writeFileSync(manifestFile, manifestBytes); fs.writeFileSync(path.join(result.directory, nestedPolicy), nestedBytes);
  fs.appendFileSync(path.join(result.directory, 'docs/window-use/common.md'), 'tamper');
  assert.throws(() => runtime.verifyRuntime(result.directory), /hash mismatch/);
});
test('generated settings ESM retains schema-2 independent stage admission', async t => {
  const { root, write } = fixture(t), { generateSettingsModule } = require('./inject-sky-control-policy.cjs');
  const output = generateSettingsModule(fs.readFileSync(path.join(scripts, 'use-control-settings.cjs')));
  const generated = write('settings.mjs', output.content);
  const esm = await import(pathToFileURL(generated).href);
  const owner = esm.createSettingsOwner(path.join(root, 'state'));
  assert.equal(esm.stageEnabled(owner.getSettings(), 1), true);
  owner.updateSettings({ stage1Enabled: false, stage4Enabled: true }, 0);
  assert.equal(esm.stageEnabled(owner.getSettings(), 1), false);
  assert.equal(esm.stageEnabled(owner.getSettings(), 4), true);
  owner.updateSettings({ windowUseEnabled: false }, 1);
  assert.throws(() => owner.assertStageEnabled(4), /disabled/i);
});
test('unified sync installs only Window Use and preserves unknown standalone Computer Use consumers', async t => {
  const { root, write } = fixture(t);
  const engine = write('engine.exe', 'mock engine'), source = path.join(root, 'source'), state = path.join(root, 'state'), runtime = path.join(root, 'runtime');
  write('source/config.toml', `notify = [${JSON.stringify(engine)}]\n`);
  const manifest = write('manifest.json', JSON.stringify({ schema: 1, copyGlobalInstructions: false, agentRoles: [], generatedAgentRoles: [], personalSkills: [], config: { rootKeys: ['notify'], tables: [], tableKeys: {}, protectedRootKeys: [] } }));
  write('runtime/manifest.json', '{}'); write('runtime/node.exe', 'mock node'); write('runtime/node_repl.exe', 'mock repl');
  write('runtime/node_modules/placeholder', 'mock'); write('runtime/sky-controlled-service.mjs', 'mock sky');
  write('runtime/skills/window-use/SKILL.md', '---\nname: window-use\ndescription: unified\n---\nManaged context');
  const legacy = write('state/skills/computer-use/SKILL.md', 'independently managed or active legacy entry');
  const validations = [];
  const sync = load('sync-codex-environment.cjs', {
    './computer-use-runtime.cjs': { verifyRuntime: () => ({ manifest: { windowUseGuidanceVersion: 1 } }) },
    // This fixture owns skill staging. Native strict configuration and plugin
    // materialization have separate selected-engine integration coverage.
    './lib/codex-environment-engine.cjs': { createEnvironmentEngine: async selected => {
      assert.equal(selected, engine);
      return {
        validate: async home => { validations.push(home); },
        materialize: async (home, selectors) => { assert.equal(selectors.length, 0); return []; },
      };
    } },
  }, '\nmodule.exports.main = main;');
  await sync.main(['--source-home', source, '--state-root', state, '--engine', engine, '--manifest', manifest, '--computer-use-directory', runtime]);
  assert.equal(validations.length, 3);
  assert.equal(validations[0], validations[1]);
  assert.notEqual(validations[0], state);
  assert.equal(validations[2], state);
  assert.equal(fs.readFileSync(legacy, 'utf8'), 'independently managed or active legacy entry');
  assert.equal(fs.readFileSync(path.join(state, 'skills/window-use/SKILL.md'), 'utf8'), fs.readFileSync(path.join(runtime, 'skills/window-use/SKILL.md'), 'utf8'));
  const receipt = JSON.parse(fs.readFileSync(path.join(state, 'azrael/codex-environment/snapshot.json')));
  assert.equal(receipt.skillHashes['computer-use'], undefined);
  assert(receipt.warnings.some(x => x.includes('active-consumer')));
  assert.equal(Object.hasOwn(receipt.managedStates, path.join('skills', 'computer-use')), false);
});


test('platform host stages full verified desktop identity and child payload only for admitted desktop targets', t => {
  const { root, write } = fixture(t), release = path.join(root, 'release'), host = path.join(root, 'host');
  const helper = write('release/window-control/child-session/windows-child-session.exe', 'synthetic helper');
  write('release/window-control/child-session/probe.ps1', 'probe');
  write('release/computer-use/docs/api.md', 'preserved API');
  const childSession = { executable: helper, sha256: 'a'.repeat(64), probeScript: path.join(release, 'window-control/child-session/probe.ps1') };
  const window = { directory: path.join(release, 'window-control'), executable: path.join(release, 'window-control/azrael-window-control.exe'), mcpScript: path.join(release, 'window-control/window-control-mcp.cjs'), manifestSha256: 'b'.repeat(64), childSession, manifest: { files: [] } };
  const computer = { directory: path.join(release, 'computer-use'), manifestSha256: 'c'.repeat(64), manifest: { files: [] } };
  let admissions = 0;
  const platformHost = load('prepare-platform-host.cjs', {
    './computer-use-runtime.cjs': { verifyRuntime: () => { admissions++; return computer; } },
    './window-control-runtime.cjs': { verifyRuntime: () => { admissions++; return window; } },
  });
  const disabled = platformHost.stageDesktopRuntimes(release, path.join(root, 'linux'), { os: 'linux', desktopControl: false });
  assert.equal(Object.keys(disabled).length, 0); assert.equal(admissions, 0);
  fs.mkdirSync(host);
  const result = platformHost.stageDesktopRuntimes(release, host, { os: 'win32', desktopControl: true });
  assert.equal(admissions, 2);
  assert.equal(result.windowControl.executable, window.executable);
  assert.equal(result.windowControl.mcpScript, window.mcpScript);
  assert.deepEqual(result.windowControl.childSession, childSession);
  assert.equal(result.windowControl.manifest, undefined);
  assert.equal(fs.readFileSync(path.join(host, 'window-control/child-session/windows-child-session.exe'), 'utf8'), 'synthetic helper');
  assert.equal(fs.readFileSync(path.join(host, 'computer-use/docs/api.md'), 'utf8'), 'preserved API');
});
