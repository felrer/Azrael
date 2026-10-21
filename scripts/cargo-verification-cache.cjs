'use strict';

// Cargo compilation reuse and passing-test evidence are separate contracts.
// Full source/provenance identity is supplied by the preservation gate each run.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { getDirectoryState } = require('./directory-state.cjs');
const { buildCargoTestCommand } = require('./cargo-verification.cjs');
const storage = require('./verification-result-cache.cjs');
// This namespace owns both evidence and its locks. Legacy cargo owners may have
// only {token,pid}, without enough producer identity for verified retirement.
// Leave that entire root protected; never import its entries under new locks.
const CACHE_NAMESPACE = 'cargo-v2';
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const wrappers = new Set(['check-api-context.cjs', 'check-model-harness-profiles.cjs',
  'check-root-resume-reasoning.cjs', 'check-task-work-time-native.cjs',
  'check-thread-auto-compaction.cjs', 'check-parent-requests.cjs',
  'check-capacity-recovery.cjs', 'check-task-profile-skills.cjs',
  'check-shared-engine-native.cjs'].map(file => `scripts/${file}`));
const sourceOnlyHelpers = {
  'scripts/cargo-verification.cjs': '07edcd7bdab380342a1fefcb369340ede5179e60f7075b623bb52065ab6768bb',
  'scripts/cargo-target-owner.cjs': 'a1aa884c33c635dabf641b4ac8ee43f422eb88033cc8b331252ab5634e3a343b',
};
function auditedSourceOnly(config, group) {
  try {
    if (!group.entries.every(({ check }) => require('./cargo-preflight-recipes.cjs').recipesForCheck(config, check).gaps.length === 0)) return false;
    return Object.entries(sourceOnlyHelpers).every(([filename, expected]) =>
      sha(fs.readFileSync(path.join(config.projectRoot, filename), 'utf8').replace(/\r\n/g, '\n')) === expected);
  } catch { return false; }
}

function isEligible(group) {
  return Boolean(group?.native && Array.isArray(group.entries) && group.entries.length &&
    group.entries.every(({ feature, check }) => feature?.area === 'engine' && check?.level === 'native' &&
      check.executable === 'node' && Array.isArray(check.args) && wrappers.has(check.args[0]) &&
      check.args.every(arg => typeof arg === 'string' && !/\{(?:engine|fixture)\}/.test(arg)) &&
      check.args.some(arg => arg.includes('{engineSourceRoot}'))));
}

function environmentValue(env, name, platform) {
  const keys = Object.keys(env).filter(key => platform === 'win32' ? key.toUpperCase() === name : key === name);
  if (keys.length > 1) throw Error(`Ambiguous tool environment: ${name}`);
  return keys.length ? env[keys[0]] : undefined;
}

async function resolveTool(name, env, platform) {
  const pathImpl = platform === 'win32' ? path.win32 : path.posix;
  const search = environmentValue(env, 'PATH', platform);
  if (typeof search !== 'string' || !search) throw Error(`Cannot resolve ${name}: PATH missing`);
  let extensions = platform === 'win32'
    ? (environmentValue(env, 'PATHEXT', platform) || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  if (platform === 'win32' && extensions.some(extension => name.toLowerCase().endsWith(extension.toLowerCase()))) extensions = [''];
  // Empty/relative PATH entries depend on the child's working directory.
  // Refuse that uncertainty instead of inventing a tool identity.
  for (const directory of search.split(platform === 'win32' ? ';' : ':')) {
    if (!directory || !pathImpl.isAbsolute(directory)) throw Error(`Uncertain ${name} PATH entry`);
    for (const extension of extensions) {
      const candidate = pathImpl.join(directory, name + extension);
      try {
        const stat = await fs.promises.stat(candidate);
        if (!stat.isFile()) continue;
        await fs.promises.access(candidate, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
        return await fs.promises.realpath(candidate);
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) throw error;
      }
    }
  }
  throw Error(`Cannot resolve ${name} on PATH`);
}

const resolveExecutable = (name, env) => resolveTool(name, env, process.platform);

async function selectedTool(value, env, platform, resolve) {
  if (typeof value !== 'string' || !value) throw Error('Empty external tool identity');
  if (path.isAbsolute(value)) return fs.promises.realpath(value);
  if (/[\\/]/.test(value) || value.includes(' ')) throw Error(`Ambiguous relative external tool: ${value}`);
  return resolve(value, env, platform);
}

async function cargoConfigs(sourceRoot, env, platform, homedir, validate) {
  const directories = new Set();
  let directory = path.join(sourceRoot, 'codex-rs');
  for (;;) {
    directories.add(path.join(directory, '.cargo'));
    const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
  }
  const cargoHome = environmentValue(env, 'CARGO_HOME', platform) || path.join(homedir, '.cargo');
  if (!path.isAbsolute(cargoHome)) throw Error('Relative CARGO_HOME has uncertain config identity');
  directories.add(cargoHome);
  const configs = [];
  for (const root of directories) {
    for (const name of ['config', 'config.toml']) {
      const filename = path.join(root, name);
      try {
        const contents = await fs.promises.readFile(filename);
        await validate(contents, filename);
        const state = await getDirectoryState(root, [name]);
        if (state.sha256 !== sha(`${name}\0${contents.length}\0${sha(contents)}\n`)) {
          throw Error(`Cargo config changed while establishing identity: ${filename}`);
        }
        configs.push({ filename, present: true, state });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        configs.push({ filename, present: false });
      }
    }
  }
  return configs;
}

function probe(executable, args, options) {
  const result = spawnSync(executable, args, { ...options, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0 || result.signal || !result.stdout?.trim()) {
    throw Error(`Tool identity probe failed: ${executable}: ${result.error?.message || result.stderr || result.status}`);
  }
  return { stdout: result.stdout, stderr: result.stderr || '' };
}

// Providers are a module-test seam; CLI/config never select them.
async function runtime(config, env, providers = {}) {
  const platform = providers.platform ?? process.platform;
  const resolve = providers.resolveTool ?? resolveTool;
  const run = providers.probe ?? probe;
  for (const name of ['AZRAEL_CARGO_TARGET', 'CARGO_BUILD_TARGET', 'RUST_TARGET_PATH']) {
    const value = environmentValue(env, name, platform);
    if (value && (name === 'RUST_TARGET_PATH' || !/^[A-Za-z0-9_]+(?:-[A-Za-z0-9_.]+)+$/.test(value) || /\.json$/i.test(value))) {
      throw Error(`Unresolved external target specification: ${name}`);
    }
  }
  const normalized = [false, true].map(isolateHostEnvironment => {
    const command = buildCargoTestCommand(config.engineSourceRoot, ['test', '--lib'], { env, isolateHostEnvironment });
    return { isolateHostEnvironment, cwd: command.cwd, args: command.args,
      targetDirectory: command.env.CARGO_TARGET_DIR, rustMinStack: command.env.RUST_MIN_STACK,
      instaUpdate: command.env.INSTA_UPDATE, environmentSha256: sha(canonical(command.env)) };
  });
  const tools = {};
  for (const name of ['cargo', 'rustc']) {
    const selected = name === 'rustc' ? (environmentValue(env, 'RUSTC', platform) ||
      environmentValue(env, 'CARGO_BUILD_RUSTC', platform)) : undefined;
    const executable = selected ? await selectedTool(selected, env, platform, resolve) : await resolve(name, env, platform);
    if (typeof executable !== 'string' || !path.isAbsolute(executable)) throw Error(`Invalid ${name} executable identity`);
    const state = await getDirectoryState(path.dirname(executable), [path.basename(executable)]);
    const version = await run(executable, ['--version', '--verbose'], { cwd: normalized[0].cwd, env });
    if (typeof version?.stdout !== 'string' || !version.stdout.trim() || typeof version.stderr !== 'string') {
      throw Error(`Invalid ${name} version identity`);
    }
    tools[name] = { executable, state, version };
  }
  const externalTools = {};
  for (const name of Object.keys(env).filter(key => /^(?:(?:CARGO_BUILD_)?(?:RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER|RUSTDOC)|(?:CC|CXX|AR|LD|RANLIB)(?:_.+)?|CARGO_TARGET_.+_(?:LINKER|RUNNER))$/i.test(key))) {
    const value = environmentValue(env, platform === 'win32' ? name.toUpperCase() : name, platform);
    if (!value) { externalTools[name] = { disabled: true }; continue; }
    const executable = await selectedTool(value, env, platform, resolve);
    externalTools[name] = { executable,
      state: await getDirectoryState(path.dirname(executable), [path.basename(executable)]) };
  }
  for (const name of Object.keys(env).filter(key => /(?:RUSTFLAGS|RUSTDOCFLAGS)$/i.test(key))) {
    if (/(?:linker|link-arg|sysroot|--extern|[\\/]|(?:^|[\s\x1f])(?:-L|@))/i.test(env[name] || '')) {
      throw Error(`Unresolved external flag inputs: ${name}`);
    }
  }
  let configParser = null;
  let python;
  const parser = path.join(__dirname, 'cargo-config-self-contained.py');
  const configs = await cargoConfigs(config.engineSourceRoot, env, platform,
    providers.homedir ?? environmentValue(env, platform === 'win32' ? 'USERPROFILE' : 'HOME', platform) ?? os.homedir(),
    async (contents, filename) => {
      if (!configParser) {
        python = await resolve(platform === 'win32' ? 'python' : 'python3', env, platform);
        const state = await getDirectoryState(path.dirname(python), [path.basename(python)]);
        const identity = JSON.parse(probe(python, ['-I', '-B', parser, '--identity'], { env }).stdout);
        if (!identity.version || !identity.executable || !Object.keys(identity.tomllib || {}).length) {
          throw Error('Invalid Python TOML parser identity');
        }
        configParser = { executable: python, state, identity };
      }
      try {
        probe(python, ['-I', '-B', parser], { env, input: contents });
      } catch (error) {
        throw Error(`Cargo config has unresolved external inputs or unsupported syntax: ${filename}: ${error.message}`);
      }
    });
  return { node: { executable: process.execPath,
    state: await getDirectoryState(path.dirname(process.execPath), [path.basename(process.execPath)]),
    version: process.version, platform, arch: process.arch },
    os: { release: os.release(), version: os.version(), machine: os.machine() }, tools, externalTools,
    cargoConfigs: configs, configParser,
    environmentSha256: sha(canonical(env)), normalized,
    helper: await getDirectoryState(config.projectRoot, ['scripts/cargo-verification.cjs', 'scripts/cargo-target-owner.cjs', 'scripts/artifact-lifecycle.cjs']) };
}

async function key(config, group, inputs, runtimeIdentity) {
  if (!isEligible(group)) throw Error('Group is not eligible for Cargo evidence reuse');
  if (!inputs || typeof inputs !== 'object' || !runtimeIdentity) throw Error('Cargo cache requires verified inputs and runtime');
  if (typeof config.engineSourceRoot !== 'string' || !path.isAbsolute(config.engineSourceRoot)) {
    throw Error('Cargo cache requires an absolute engine source root');
  }
  const files = new Set(['scripts/feature-preservation.cjs', 'scripts/cargo-verification-cache.cjs',
    'scripts/cargo-preflight-recipes.cjs',
    'scripts/cargo-verification.cjs', 'scripts/cargo-target-owner.cjs', 'scripts/artifact-lifecycle.cjs', 'scripts/cargo-config-self-contained.py',
    'scripts/verification-result-cache.cjs', 'scripts/directory-state.cjs']);
  const declared = group.entries.map(({ feature, check }) => {
    feature.owners.forEach(file => files.add(file)); files.add(feature.contract); files.add(check.args[0]);
    return { feature, check };
  });
  // The full gate owns project/manifest drift checks. Eligible wrappers consume
  // bound files and explicit source, not the execution/release directory location.
  // Keep all other fields, including conservative global registered/rule hashes.
  const cargoInputs = { ...inputs };
  delete cargoInputs.projectSha256;
  delete cargoInputs.manifestSha256;
  if (inputs.engine && typeof inputs.engine === 'object' && !Array.isArray(inputs.engine)) {
    cargoInputs.engine = { ...inputs.engine };
    delete cargoInputs.engine.directory;
    // These audited wrappers compile and run their own Cargo test artifacts.
    // The gate still verifies the complete supplied product bundle, but its
    // copied binaries/external host are not inputs to these source-only checks.
    // Normalize only a complete recognized receipt; keep unknown fields bound.
    const receipt = inputs.engine.provenance;
    const source = receipt?.source;
    const binaries = receipt?.binaries;
    const host = receipt?.externalRuntimes?.codeModeHost;
    const names = typeof source?.target === 'string' && source.target.includes('windows')
      ? ['azrael.exe', 'azrael-bridge.exe', 'azrael-code-mode-host.exe'] : ['azrael', 'azrael-bridge', 'azrael-code-mode-host'];
    const complete = source && /^[a-f0-9]{64}$/.test(source.sourceSha256 || '') && typeof source.target === 'string' &&
      binaries && Object.keys(binaries).length === names.length && names.every(name => /^[a-f0-9]{64}$/.test(binaries[name] || '')) &&
      host && ['external-import', 'source-built'].includes(host.kind) && host.sha256 === binaries[names[2]] &&
      (host.kind === 'source-built' ? host.sourceSha256 === source.sourceSha256 : typeof host.sourcePath === 'string' && path.isAbsolute(host.sourcePath));
    if (complete && auditedSourceOnly(config, group)) {
      const externalRuntimes = { ...receipt.externalRuntimes };
      // Extra fields on the known host remain significant until audited.
      const retainedHost = { ...host };
      for (const field of ['kind', 'sha256', 'sourcePath', 'sourceSha256']) delete retainedHost[field];
      if (Object.keys(retainedHost).length) externalRuntimes.codeModeHost = retainedHost;
      else delete externalRuntimes.codeModeHost;
      cargoInputs.engine.provenance = { ...receipt, externalRuntimes };
      delete cargoInputs.engine.provenance.binaries;
    }
  }
  if (inputs.registered && typeof inputs.registered === 'object' && !Array.isArray(inputs.registered)) {
    cargoInputs.registered = { ...inputs.registered };
    delete cargoInputs.registered.path;
  }
  // zod is a complete content identity prepared for other engine checks.
  // Cargo wrappers consume explicit engine source; retain every other field.
  if (inputs.checkRuntime && typeof inputs.checkRuntime === 'object' && !Array.isArray(inputs.checkRuntime) &&
      inputs.checkRuntime.zod && typeof inputs.checkRuntime.zod === 'object' && !Array.isArray(inputs.checkRuntime.zod) &&
      typeof inputs.checkRuntime.zod.path === 'string' && path.isAbsolute(inputs.checkRuntime.zod.path) &&
      /^[a-f0-9]{64}$/i.test(inputs.checkRuntime.zod.sha256 || '') &&
      Number.isSafeInteger(inputs.checkRuntime.zod.fileCount) && inputs.checkRuntime.zod.fileCount >= 0 &&
      Number.isSafeInteger(inputs.checkRuntime.zod.bytes) && inputs.checkRuntime.zod.bytes >= 0) {
    cargoInputs.checkRuntime = { ...inputs.checkRuntime, zod: { ...inputs.checkRuntime.zod } };
    delete cargoInputs.checkRuntime.zod.path;
  }
  const cargoRuntime = { ...runtimeIdentity };
  if (runtimeIdentity.helper && typeof runtimeIdentity.helper === 'object' && !Array.isArray(runtimeIdentity.helper)) {
    cargoRuntime.helper = { ...runtimeIdentity.helper };
    delete cargoRuntime.helper.path;
  }
  const fileIdentity = await getDirectoryState(config.projectRoot, [...files].sort());
  delete fileIdentity.path;
  return sha(canonical({ schema: 5,
    engineSourceRoot: path.resolve(config.engineSourceRoot), inputs: cargoInputs, declared,
    files: fileIdentity, runtime: cargoRuntime }));
}

function options(config) {
  const projectRoot = config.cargoVerificationCacheProjectRoot === undefined
    ? config.projectRoot : config.cargoVerificationCacheProjectRoot;
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) {
    throw Error('Cargo verification cache project root must be an absolute path');
  }
  return { projectRoot,
    cacheRoot: path.join(projectRoot, 'artifacts/cache/verification-results', CACHE_NAMESPACE) };
}
module.exports = { isEligible, runtime, key, options, resolveExecutable, CACHE_NAMESPACE, CACHE_SCHEMA: storage.CACHE_SCHEMA,
  begin: storage.begin, pruneObsoleteVersions: storage.pruneObsoleteVersions, pruneRemovedChecks: storage.pruneRemovedChecks };
