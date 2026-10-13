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
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const wrappers = new Set(['check-api-context.cjs', 'check-model-harness-profiles.cjs',
  'check-root-resume-reasoning.cjs', 'check-task-work-time-native.cjs',
  'check-thread-auto-compaction.cjs'].map(file => `scripts/${file}`));

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

// Without a TOML dependency parser, accept only config settings whose complete
// meaning cannot reference more files/tools. Unknown syntax disables reuse.
function assertSelfContainedConfig(contents, filename) {
  const scalar = /^(?:true|false|[+-]?\d+|"[A-Za-z0-9_.+-]*"|'[A-Za-z0-9_.+-]*')$/;
  const settings = {
    build: new Set(['jobs', 'target', 'incremental']),
    term: new Set(['verbose', 'quiet', 'color', 'progress.when', 'progress.width']),
    net: new Set(['offline', 'git-fetch-with-cli', 'retry']),
    http: new Set(['timeout', 'multiplexing', 'check-revoke', 'low-speed-limit']),
  };
  const profileKeys = new Set(['opt-level', 'debug', 'strip', 'debug-assertions', 'overflow-checks',
    'lto', 'panic', 'incremental', 'codegen-units', 'rpath', 'inherits']);
  let section = '';
  for (const raw of contents.split(/\r?\n/)) {
    // A # inside a quoted string is outside the accepted scalar grammar too.
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const table = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (table) { section = table[1]; continue; }
    const setting = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    const allowed = settings[section] || (/^profile\.[A-Za-z0-9_-]+$/.test(section) ? profileKeys : null);
    if (!setting || !allowed?.has(setting[1]) || !scalar.test(setting[2])) {
      throw Error(`Cargo config has unresolved external inputs or unsupported syntax: ${filename}`);
    }
    if (section === 'build' && setting[1] === 'target' &&
        (!/^["'][A-Za-z0-9_]+(?:-[A-Za-z0-9_.]+)+["']$/.test(setting[2]) || /\.json["']$/i.test(setting[2]))) {
      throw Error(`Cargo config target may require external specification: ${filename}`);
    }
  }
}

async function cargoConfigs(sourceRoot, env, platform, homedir) {
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
        assertSelfContainedConfig(contents.toString('utf8'), filename);
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
  return { node: { executable: process.execPath,
    state: await getDirectoryState(path.dirname(process.execPath), [path.basename(process.execPath)]),
    version: process.version, platform, arch: process.arch },
    os: { release: os.release(), version: os.version(), machine: os.machine() }, tools, externalTools,
    cargoConfigs: await cargoConfigs(config.engineSourceRoot, env, platform,
      providers.homedir ?? environmentValue(env, platform === 'win32' ? 'USERPROFILE' : 'HOME', platform) ?? os.homedir()),
    environmentSha256: sha(canonical(env)), normalized,
    helper: await getDirectoryState(config.projectRoot, ['scripts/cargo-verification.cjs']) };
}

async function key(config, group, inputs, runtimeIdentity) {
  if (!isEligible(group)) throw Error('Group is not eligible for Cargo evidence reuse');
  if (!inputs || typeof inputs !== 'object' || !runtimeIdentity) throw Error('Cargo cache requires verified inputs and runtime');
  const files = new Set(['scripts/feature-preservation.cjs', 'scripts/cargo-verification-cache.cjs',
    'scripts/cargo-verification.cjs', 'scripts/verification-result-cache.cjs', 'scripts/directory-state.cjs']);
  const declared = group.entries.map(({ feature, check }) => {
    feature.owners.forEach(file => files.add(file)); files.add(feature.contract); files.add(check.args[0]);
    return { feature, check };
  });
  return sha(canonical({ schema: 1, projectRoot: path.resolve(config.projectRoot),
    engineSourceRoot: path.resolve(config.engineSourceRoot), inputs, declared,
    files: await getDirectoryState(config.projectRoot, [...files].sort()), runtime: runtimeIdentity }));
}

const options = config => ({ projectRoot: config.projectRoot,
  cacheRoot: path.join(config.projectRoot, 'artifacts/cache/verification-results/cargo') });
module.exports = { isEligible, runtime, key, options, resolveExecutable, CACHE_SCHEMA: storage.CACHE_SCHEMA,
  begin: storage.begin, pruneObsoleteVersions: storage.pruneObsoleteVersions, pruneRemovedChecks: storage.pruneRemovedChecks };
