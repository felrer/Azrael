'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { getDirectoryState } = require('./directory-state.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function budgetRequired(features) {
  return features.some(feature => feature.checks.some(check => check.args.includes('scripts/test-provider-input-budget-helper.cjs')));
}
function bunPath(root, env = process.env) {
  return env.AZRAEL_BUN || (process.platform === 'win32' ? path.join(root, 'artifacts/tools/bun-1.4.2/package/bin/bun.exe') : 'bun');
}
function dependencyRoot(root) {
  const provider = path.join(root, 'providers/opencodex');
  const resolve = createRequire(path.join(provider, 'package.json')).resolve;
  const entry = resolve('zod/v4');
  let directory = path.dirname(entry);
  while (!fs.existsSync(path.join(directory, 'package.json'))) {
    const parent = path.dirname(directory); if (parent === directory) throw Error('zod package identity missing'); directory = parent;
  }
  // zod/v4 has its own export package; include the package containing all referenced submodules.
  while (JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).name !== 'zod') {
    const parent = path.dirname(directory); if (parent === directory) throw Error('zod package identity missing'); directory = parent;
    while (!fs.existsSync(path.join(directory, 'package.json'))) { const next = path.dirname(directory); if (next === directory) throw Error('zod package identity missing'); directory = next; }
  }
  return directory;
}
function prepare(config, features, run = spawnSync) {
  if (!budgetRequired(features)) return { dependenciesPrepared: false };
  try { dependencyRoot(config.projectRoot); return { dependenciesPrepared: false }; } catch (error) {
    const cwd = path.join(config.projectRoot, 'providers/opencodex');
    if (!['bun.lock', 'bun.lockb'].some(name => fs.existsSync(path.join(cwd, name)))) throw Error('Pinned Bun lockfile required for verification dependencies');
    const result = run(bunPath(config.projectRoot), ['install', '--frozen-lockfile'], { cwd, env: process.env, stdio: 'inherit', shell: false, windowsHide: true });
    if (result.error || result.status !== 0) throw Error(`Verification dependencies failed: ${result.error?.message || result.status}`);
    dependencyRoot(config.projectRoot);
    return { dependenciesPrepared: true };
  }
}
async function identity(config, features) {
  const result = { nodeSha256: sha(await fs.promises.readFile(process.execPath)) };
  if (features.some(feature => feature.checks.some(check => check.level === 'source' && check.executable === 'python'))) {
    const python = await require('./cargo-verification-cache.cjs').resolveExecutable('python', process.env);
    result.pythonSha256 = sha(await fs.promises.readFile(python));
  }
  if (budgetRequired(features)) {
    result.zod = await getDirectoryState(dependencyRoot(config.projectRoot));
    const bun = bunPath(config.projectRoot);
    const resolved = path.isAbsolute(bun) ? bun : /[\\/]/.test(bun) ? path.resolve(config.projectRoot, 'providers/opencodex', bun) : await require('./cargo-verification-cache.cjs').resolveExecutable(bun, process.env);
    result.bunSha256 = sha(await fs.promises.readFile(resolved));
  }
  return result;
}
module.exports = { prepare, identity, dependencyRoot, budgetRequired };
if (require.main === module) {
  const [filename, ...extra] = process.argv.slice(2);
  if (!filename || extra.length) throw Error('Usage: pipeline-preflight.cjs <config JSON>');
  const config = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  const manifest = JSON.parse(fs.readFileSync(path.join(config.projectRoot, 'scripts/azrael-feature-contracts.json'), 'utf8'));
  const features = manifest.features.filter(feature => feature.area === 'engine' && (!config.featureIds || config.featureIds.includes(feature.id)));
  console.log(JSON.stringify(prepare(config, features)));
}
