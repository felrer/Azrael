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
  if (features.some(feature => feature.checks.some(check => check.args.includes('scripts/check-question-withdrawal-sdk.cjs')))) {
    result.sdkPythonSha256 = sha(await fs.promises.readFile(sdkPython(config.projectRoot)));
  }
  if (budgetRequired(features)) {
    result.zod = await getDirectoryState(dependencyRoot(config.projectRoot));
    const bun = bunPath(config.projectRoot);
    const resolved = path.isAbsolute(bun) ? bun : /[\\/]/.test(bun) ? path.resolve(config.projectRoot, 'providers/opencodex', bun) : await require('./cargo-verification-cache.cjs').resolveExecutable(bun, process.env);
    result.bunSha256 = sha(await fs.promises.readFile(resolved));
  }
  return result;
}
// Match check-question-withdrawal-sdk.cjs exactly; a PATH Python is not an SDK selection.
function sdkPython(projectRoot, env = process.env) {
  const python = env.AZRAEL_PYTHON_SDK || path.join(projectRoot, 'engine/sdk/python/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!path.isAbsolute(python) || !fs.existsSync(python)) throw Error('Set AZRAEL_PYTHON_SDK to an installed SDK Python interpreter');
  return python;
}
function composePath(env, directories, platform = process.platform) {
  const output = { ...env };
  const keys = Object.keys(output).filter(key => platform === 'win32' ? key.toUpperCase() === 'PATH' : key === 'PATH');
  const inherited = keys.map(key => output[key]).filter(Boolean);
  for (const key of keys) delete output[key];
  const delimiter = platform === 'win32' ? ';' : ':';
  const entries = [...directories, ...inherited.flatMap(value => value.split(delimiter))].filter(Boolean);
  const seen = new Set();
  output.PATH = entries.filter(entry => {
    let id = entry;
    if (platform === 'win32') {
      id = path.win32.normalize(entry);
      if (id !== path.win32.parse(id).root) id = id.replace(/\\+$/, '');
      id = id.toLowerCase();
    }
    if (seen.has(id)) return false; seen.add(id); return true;
  }).join(delimiter);
  return output;
}
function consumers(features) {
  const checks = features.flatMap(feature => feature.checks);
  return {
    python: checks.some(check => check.executable === 'python'),
    sdkPython: checks.some(check => check.args.includes('scripts/check-question-withdrawal-sdk.cjs') ||
      (check.args[0] === 'scripts/check-window-approval-native.cjs' && ['all', 'queue'].includes(check.args[2] || 'all'))),
    cargo: checks.some(check => check.cargoPreflight === 'selected-tests-v1'),
  };
}
function filesystemBoundaries(config) {
  if (!config.projectRoot) return { storage: { status: 'not-selected' }, temporary: { status: 'not-selected' } };
  const { physicalPath } = require('./cargo-target-owner.cjs');
  const root = physicalPath(config.projectRoot);
  const stat = fs.statfsSync(root, { bigint: true });
  const availableBytes = stat.bavail * stat.bsize;
  const thresholds = {};
  for (const name of ['requiredFreeBytes', 'estimatedGrowthBytes']) {
    if (config[name] === undefined) continue;
    if (!Number.isSafeInteger(config[name]) || config[name] < 0) throw Error(`${name} must be a nonnegative safe integer`);
    thresholds[name] = config[name];
    if (availableBytes < BigInt(config[name])) throw Error(`Insufficient workspace capacity: available ${availableBytes} bytes; ${name} ${config[name]}`);
  }
  const storage = { availableBytes: availableBytes.toString(), ...thresholds,
    status: config.estimatedGrowthBytes === undefined ? 'unknown' : 'passed',
    ...(config.estimatedGrowthBytes === undefined ? { reason: 'No selected compilation growth estimate supplied' } : {}) };
  if (!config.temporaryDirectory) return { storage, temporary: { status: 'not-selected', reason: 'No temporaryDirectory supplied' } };
  if (!path.isAbsolute(config.temporaryDirectory)) throw Error('temporaryDirectory must be absolute');
  const identity = value => process.platform === 'win32' ? value.toLowerCase() : value;
  function within(parent, child) {
    const relative = path.relative(identity(parent), identity(child));
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
  }
  const artifacts = physicalPath(path.join(root, 'artifacts'));
  const directory = physicalPath(config.temporaryDirectory);
  if (!within(artifacts, directory) || identity(directory) === identity(artifacts)) throw Error('temporaryDirectory must be contained under project artifacts');
  if (!config.engineSourceRoot || within(physicalPath(config.engineSourceRoot), directory)) throw Error('temporaryDirectory must be outside selected engine source');
  fs.mkdirSync(directory, { recursive: true });
  if (identity(physicalPath(directory)) !== identity(directory)) throw Error('temporaryDirectory identity changed before probe');
  const filename = path.join(directory, `.preflight-${crypto.randomUUID()}`);
  const contents = crypto.randomBytes(32);
  fs.writeFileSync(filename, contents, { flag: 'wx' });
  if (!fs.readFileSync(filename).equals(contents)) throw Error(`Temporary write/read probe mismatch: ${filename}`);
  fs.unlinkSync(filename);
  if (fs.existsSync(filename)) throw Error(`Temporary probe deletion did not complete: ${filename}`);
  return { storage, temporary: { status: 'passed', directory, checks: ['exclusive-write', 'read-back', 'ordinary-delete'] } };
}
async function environment(config, features, { env = process.env, run = spawnSync } = {}) {
  const required = consumers(features);
  const boundaries = filesystemBoundaries(config);
  const temporaryPatch = boundaries.temporary.status === 'passed' ? Object.fromEntries(['TEMP', 'TMP', 'TMPDIR'].map(name => [name, boundaries.temporary.directory])) : {};
  const childEnv = { ...env };
  if (process.platform === 'win32') for (const key of Object.keys(childEnv)) {
    if (Object.hasOwn(temporaryPatch, key.toUpperCase())) delete childEnv[key];
  }
  Object.assign(childEnv, temporaryPatch);
  if (!required.python && !required.sdkPython && !required.cargo) return { env: childEnv, environmentPatch: temporaryPatch, probes: [], required, boundaries };
  if (!path.isAbsolute(config.projectRoot || '') || !path.isAbsolute(config.engineSourceRoot || '')) throw Error('Environment preflight requires absolute project and selected engine source roots');
  const cwd = path.join(config.engineSourceRoot, 'codex-rs');
  if (!fs.statSync(cwd).isDirectory()) throw Error('Selected source has no Cargo workspace');
  const directories = config.toolDirectories || [];
  if (!Array.isArray(directories) || directories.some(directory => typeof directory !== 'string' || !path.isAbsolute(directory) || !fs.statSync(directory).isDirectory())) throw Error('toolDirectories must select existing absolute tool directories');
  let effective = composePath(childEnv, [path.dirname(process.execPath), ...directories]);
  const patch = { ...temporaryPatch };
  if (required.sdkPython) {
    patch.AZRAEL_PYTHON_SDK = sdkPython(config.projectRoot, env);
    effective.AZRAEL_PYTHON_SDK = patch.AZRAEL_PYTHON_SDK;
  }
  if (config.cargoTargetDirectory) {
    if (!path.isAbsolute(config.cargoTargetDirectory)) throw Error('Cargo target directory must be absolute');
    patch.CARGO_TARGET_DIR = effective.CARGO_TARGET_DIR = config.cargoTargetDirectory;
  }
  if (config.cargoTarget) patch.AZRAEL_CARGO_TARGET = effective.AZRAEL_CARGO_TARGET = config.cargoTarget;
  if (config.cargoProfile) patch.AZRAEL_CARGO_PROFILE = effective.AZRAEL_CARGO_PROFILE = config.cargoProfile;
  if (config.rustupToolchain) patch.RUSTUP_TOOLCHAIN = effective.RUSTUP_TOOLCHAIN = config.rustupToolchain;
  patch.PATH = effective.PATH;
  const probes = [];
  function probe(command, args, phase, probeEnv = effective) {
    const started = Date.now();
    const result = run(command, args, { cwd, env: probeEnv, encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: 4 * 1024 * 1024 });
    const evidence = { phase, command, args, cwd, exitCode: result.status ?? null, signal: result.signal ?? null,
      durationMs: Date.now() - started, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error?.message || null };
    probes.push(evidence);
    if (result.error || result.signal || result.status !== 0) {
      const error = Error(`Environment preflight ${phase} failed: ${result.error?.message || result.stderr || result.status}`);
      error.probes = probes; throw error;
    }
    return result;
  }
  if (required.sdkPython) {
    const modulePath = path.join(config.engineSourceRoot, 'sdk/python/src/openai_codex/generated/v2_all.py');
    if (!fs.statSync(modulePath).isFile()) throw Error('Selected source has no generated Python SDK models');
    probe(patch.AZRAEL_PYTHON_SDK, ['-B', '-c', 'import json,pathlib,sys,pydantic; sys.path.insert(0,str(pathlib.Path(sys.argv[1])/"sdk/python/src")); from openai_codex.generated import v2_all; assert pathlib.Path(v2_all.__file__).resolve()==pathlib.Path(sys.argv[1],"sdk/python/src/openai_codex/generated/v2_all.py").resolve(); print(json.dumps({"python":sys.executable,"pydantic":pydantic.__version__,"module":v2_all.__file__}))', config.engineSourceRoot], 'python-sdk-import');
  }
  // Exercise Node's real child lookup, rather than only checking file presence.
  const children = [
    ...(required.sdkPython ? [['sdk-python', 'python', ['-B', '-c', 'import sys; print(sys.executable)'], composePath(effective, [path.dirname(patch.AZRAEL_PYTHON_SDK)])]] : []),
    ...(required.python || required.cargo ? [['python', 'python', ['-B', '-c', 'import json,sys,tomllib; assert sys.version_info >= (3,11), "Cargo configuration parser requires Python >= 3.11"; print(json.dumps({"python":sys.executable,"version":sys.version.split()[0],"tomllib":tomllib.__file__}))'], effective]] : []),
    ...(required.cargo ? [['cargo', 'cargo', ['--version', '--verbose'], effective]] : []),
  ];
  for (const [phase, tool, args, probeEnv] of children) {
    const child = probe(process.execPath, ['-e', 'const c=require("node:child_process");const r=c.spawnSync(process.argv[1],JSON.parse(process.argv[2]),{cwd:process.cwd(),env:process.env,encoding:"utf8",windowsHide:true});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.error)process.stderr.write(r.error.message);process.exitCode=r.error||r.signal?1:r.status??1;', tool, JSON.stringify(args)], `child-path-${phase}`, probeEnv);
    if (!child.stdout?.trim()) throw Error(`Environment preflight child-path-${phase} returned no identity`);
    const identity = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (phase === 'sdk-python' && identity(fs.realpathSync.native(child.stdout.trim())) !== identity(fs.realpathSync.native(patch.AZRAEL_PYTHON_SDK))) throw Error('Child PATH Python differs from selected SDK interpreter');
  }
  return { env: effective, environmentPatch: patch, probes, required, boundaries, environmentSha256: sha(JSON.stringify(Object.keys(effective).sort().map(key => [key, effective[key]]))) };
}
module.exports = { prepare, identity, dependencyRoot, budgetRequired, sdkPython, composePath, consumers, environment, filesystemBoundaries };
if (require.main === module) {
  const args = process.argv.slice(2);
  const environmentOnly = args[0] === '--environment';
  if (environmentOnly) args.shift();
  const [filename, ...extra] = args;
  if (!filename || extra.length) throw Error('Usage: pipeline-preflight.cjs <config JSON>');
  const config = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  const manifest = JSON.parse(fs.readFileSync(path.join(config.projectRoot, 'scripts/azrael-feature-contracts.json'), 'utf8'));
  const features = manifest.features.filter(feature => feature.area === 'engine' && (!config.featureIds || config.featureIds.includes(feature.id)));
  if (environmentOnly) environment(config, features).then(({ env, ...report }) => console.log(JSON.stringify(report))).catch(error => {
    console.error(JSON.stringify({ error: error.message, probes: error.probes || [] })); process.exitCode = 1;
  });
  else console.log(JSON.stringify(prepare(config, features)));
}
