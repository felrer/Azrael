'use strict';

// Native probes own fresh fixtures; only their declared immutable inputs enter
// the key. Evidence storage, leases and guarded collection remain shared.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { getDirectoryState } = require('./directory-state.cjs');
const storage = require('./verification-result-cache.cjs');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const BINARY_FILES = ['codex.exe', 'azrael-bridge.exe', 'codex-code-mode-host.exe'];
const rootFor = config => path.join(config.projectRoot, 'artifacts/cache/verification-results/native');
async function contentState(root, files) {
  const { path: directory, ...state } = await getDirectoryState(root, files);
  return state;
}

function validateInputs(feature, check, reference) {
  const inputs = check.nativeCacheInputs;
  if (feature.area !== 'engine' || check.level !== 'native' || check.executable !== 'node' || !inputs ||
      typeof inputs !== 'object' || Array.isArray(inputs) || canonical(Object.keys(inputs).sort()) !== canonical(['files', 'schema']) ||
      inputs.schema !== 1 || !Array.isArray(inputs.files) || !inputs.files.length || new Set(inputs.files).size !== inputs.files.length ||
      !check.args.includes('{fixture}')) throw Error(`Invalid native cache inputs: ${check.id}`);
  inputs.files.forEach(reference);
}

async function runtime(config, env) {
  return { node: { executable: process.execPath, sha256: sha(await fs.promises.readFile(process.execPath)),
    version: process.version, platform: process.platform, arch: process.arch },
    os: { release: os.release(), version: os.version(), machine: os.machine() },
    environmentSha256: sha(canonical(env)),
    binaries: await contentState(config.engineDirectory, BINARY_FILES),
    catalog: await contentState(config.engineSourceRoot, ['codex-rs/models-manager/models.json']) };
}

async function key(config, group, runtimeIdentity) {
  const files = new Set(['scripts/feature-preservation.cjs', 'scripts/native-verification-cache.cjs',
    'scripts/verification-result-cache.cjs', 'scripts/directory-state.cjs']);
  const declared = group.entries.map(({ feature, check }) => {
    feature.owners.forEach(file => files.add(file)); files.add(feature.contract);
    check.nativeCacheInputs.files.forEach(file => files.add(file));
    check.args.filter(arg => /\.(?:cjs|mjs|js|py)$/.test(arg) && !arg.includes('{')).forEach(file => files.add(file));
    return { featureId: feature.id, owners: feature.owners, contract: feature.contract, check };
  });
  // Templates retain flags/order but avoid the fresh fixture and copied release
  // paths. Both roots still undergo the normal provenance checks every run.
  return sha(canonical({ schema: 1, declared, projectRoot: path.resolve(config.projectRoot),
    files: await getDirectoryState(config.projectRoot, [...files].sort()),
    runtime: runtimeIdentity }));
}

const options = config => ({ projectRoot: config.projectRoot, cacheRoot: rootFor(config) });
module.exports = { validateInputs, runtime, key, options, CACHE_SCHEMA: storage.CACHE_SCHEMA,
  begin: storage.begin, pruneObsoleteVersions: storage.pruneObsoleteVersions, pruneRemovedChecks: storage.pruneRemovedChecks };
