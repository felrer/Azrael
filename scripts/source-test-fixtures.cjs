'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { SOURCE_SHA256: executableSha256 } = require('./computer-use-branding.cjs');
const { SOURCE_SHA256: transportSha256, TRANSPORT: transport } = require('./inject-sky-control-policy.cjs');
const { LEGACY_SESSION_LINK_ASSETS, SESSION_LINK_ASSETS } = require('./inject-session-links.cjs');

const executable = 'node_modules/@oai/sky/bin/windows/codex-computer-use.exe';
const rawHashes = {
  [transport]: transportSha256,
  [executable]: executableSha256,
};
const linkAssets = {
  '26.928.31416': LEGACY_SESSION_LINK_ASSETS,
  '26.1007.21434': SESSION_LINK_ASSETS,
};

function inspectSourceFixtures({ root, files, env = process.env }) {
  root = path.resolve(root);
  const selected = new Set(files.map(file => path.relative(root, path.isAbsolute(file) ? file : path.resolve(root, file)).replaceAll('\\', '/')));
  const has = name => selected.has(name);
  const requirements = [];
  const add = (id, target, inspect) => {
    try {
      if (typeof target !== 'string' || !target.trim()) throw Error('A nonempty path is required');
      inspect(target);
      requirements.push({ id, status: 'ready', path: target, reason: 'Selected test prerequisite is available' });
    } catch (error) {
      requirements.push({ id, status: 'blocked', path: target ?? null, reason: error.message });
    }
  };
  const regular = target => { if (!fs.lstatSync(target).isFile()) throw Error('Expected a regular file'); };
  const file = (id, target, digest) => add(id, target, target => {
    regular(target);
    if (digest && crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== digest) throw Error('Pinned pristine source SHA256 mismatch');
  });
  const json = (id, target, inspect) => {
    let result;
    add(id, target, target => { regular(target); result = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '')); if (inspect) inspect(result); });
    return result;
  };
  // Caller owns registration and containment. An absolute path does not prove
  // that this process has authority over the directory or its ancestors.
  const fixtureRoot = (id, target) => add(id, target, target => { if (!path.isAbsolute(target)) throw Error('Explicit absolute fixture root required; caller owns registration'); });
  const resolve = value => path.resolve(root, value);
  const runtimeSuite = has('scripts/test-computer-use-runtime.cjs');
  const skySuite = has('scripts/test-sky-control-policy.cjs');
  const syncSuite = has('scripts/tests/sync-codex-environment.test.cjs');
  if (runtimeSuite || skySuite || syncSuite) {
    const runtime = env.AZRAEL_TEST_COMPUTER_USE_RUNTIME || (env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'OpenAI/Codex/runtimes/cua_node/b63ee7ee40c23b77'));
    if (!runtime) add('computer-use.runtime', null, () => {});
    else {
      const bin = path.join(resolve(runtime), 'bin');
      file('computer-use.transport', path.join(bin, transport), rawHashes[transport]);
      if (runtimeSuite) {
        for (const rel of ['node.exe', 'node_repl.exe', executable]) file(`computer-use.${rel}`, path.join(bin, rel), rawHashes[rel]);
        for (const name of ['@oai/sky', '@statsig/js-client', '@statsig/client-core']) file(`computer-use.package.${name}`, path.join(bin, 'node_modules', name, 'package.json'));
      } else if (skySuite) file('computer-use.package.@oai/sky', path.join(bin, 'node_modules/@oai/sky/package.json'));
    }
  }
  if (runtimeSuite) {
    const plugin = resolve(env.AZRAEL_TEST_COMPUTER_USE_PLUGIN || path.join(os.homedir(), '.azrael-ex/plugins/cache/openai-bundled/computer-use/26.1007.21434'));
    for (const rel of ['skills/computer-use/SKILL.md', 'docs/guidance.md', 'docs/api.md', 'docs/confirmations.md']) file(`computer-use.plugin.${rel}`, path.join(plugin, rel));
    const historical = resolve(env.AZRAEL_TEST_LEGACY_COMPUTER_USE_RUNTIME || 'artifacts/releases/all_changes_20261007_r6/computer-use');
    json('computer-use.historical-manifest', path.join(historical, 'manifest.json'), manifest => {
      if (manifest.windowUseGuidanceVersion !== undefined || manifest.files?.find(entry => entry.path === transport)?.transform?.version !== 3) throw Error('Historical fixture must retain nonguidance v3 provenance');
    });
  }
  if (has('scripts/test-session-links.cjs')) {
    // Both asset loops are hardcoded. Only the later package.json read honors
    // AZRAEL_PRESERVATION_UI_ROOT; it must not redirect the asset checks.
    for (const [version, assets] of Object.entries(linkAssets)) for (const asset of assets) {
      file(`session-links.${version}.${asset}`, path.join(root, 'artifacts/upstream-ui', version, asset));
    }
    file('session-links.current-package', resolve(path.join(env.AZRAEL_PRESERVATION_UI_ROOT || 'artifacts/upstream-ui/26.1007.21434', 'package.json')));
  }
  if (has('scripts/tests/instruction-catalog.test.cjs')) fixtureRoot('instruction.catalog-root', env.AZRAEL_CATALOG_TEST_ROOT);
  if (has('scripts/tests/instruction-migration.test.cjs')) fixtureRoot('instruction.migration-root', env.AZRAEL_MIGRATION_TEST_ROOT);
  const host = has('scripts/test-instruction-library-host.cjs');
  const management = host || has('extensions/azrael-ex/test/instructionManagement.test.ts') || has('extensions/azrael-ex/test/instructionMigrationFlow.test.ts');
  const service = host || has('extensions/azrael-ex/test/instructionService.test.ts');
  if (management) fixtureRoot('instruction.test-root', env.AZRAEL_INSTRUCTION_TEST_ROOT);
  if (service) {
    const assets = env.AZRAEL_INSTRUCTION_RELEASE_ASSETS ?? path.join(root, 'artifacts/instructions/review-1.0.0');
    const manifest = json('instruction.release-manifest', resolve(path.join(assets, 'azrael-instructions-1.0.0-manifest.json')));
    for (const [id, asset] of [['archive', manifest?.archive?.name], ['documents', manifest?.documentsAsset?.name]]) {
      if (typeof asset !== 'string' || !asset || path.isAbsolute(asset) || asset.split(/[\\/]/).includes('..')) add(`instruction.release-${id}`, null, () => {});
      else file(`instruction.release-${id}`, resolve(path.join(assets, asset)));
    }
    let engine = env.AZRAEL_INSTRUCTION_TEST_ENGINE;
    if (engine === undefined || engine === null) {
      const latest = json('instruction.latest-engine-metadata', path.join(root, 'artifacts/latest.json'));
      if (typeof latest?.releaseDirectory === 'string') engine = path.join(latest.releaseDirectory, 'engine', process.platform === 'win32' ? 'codex.exe' : 'codex');
    }
    add('instruction.engine', engine, target => { if (!path.isAbsolute(target)) throw Error('Instruction engine must be absolute'); regular(target); });
  }
  return { status: requirements.some(item => item.status === 'blocked') ? 'blocked' : 'ready', requirements };
}

function assertSourceFixtures(options) {
  const result = inspectSourceFixtures(options);
  if (result.status === 'blocked') {
    const error = Error('Source test prerequisites blocked:\n' + result.requirements.filter(item => item.status === 'blocked').map(item => `${item.id}: ${item.path ?? '(unset)'}: ${item.reason}`).join('\n'));
    error.code = 'AZRAEL_SOURCE_FIXTURES_BLOCKED'; error.readiness = result; throw error;
  }
  return result;
}

module.exports = { inspectSourceFixtures, assertSourceFixtures };
