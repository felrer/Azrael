'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, after } = require('node:test');
const cache = require('./cargo-verification-cache.cjs');
const storage = require('./verification-result-cache.cjs');
const { getDirectoryState } = require('./directory-state.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fixtureParent = process.env.AZRAEL_CARGO_OWNER_TEST_ROOT ? path.resolve(process.env.AZRAEL_CARGO_OWNER_TEST_ROOT) : path.resolve(__dirname, '../artifacts/verification');
fs.mkdirSync(fixtureParent, { recursive: true });
const fixtures = fs.mkdtempSync(path.join(fixtureParent, 'cargo-cache-'));
let sequence = 0;
const write = (root, file, value) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), value);
};
function setup() {
  const root = path.join(fixtures, String(++sequence));
  for (const file of ['feature-preservation.cjs', 'cargo-verification-cache.cjs', 'cargo-verification.cjs',
    'cargo-target-owner.cjs', 'cargo-test-preparation.cjs', 'artifact-lifecycle.cjs',
    'verification-result-cache.cjs', 'directory-state.cjs', 'cargo-config-self-contained.py', 'cargo-preflight-recipes.cjs', 'check-api-context.cjs']) write(root, `scripts/${file}`, file);
  write(root, 'scripts/owner.cjs', 'owner'); write(root, 'docs/contract.md', 'contract');
  write(root, 'engine/codex-rs/Cargo.lock', 'lock'); write(root, 'engine/codex-rs/core/src/lib.rs', 'source');
  const tools = path.join(root, 'tools');
  for (const name of ['cargo', 'rustc']) {
    write(tools, name + (process.platform === 'win32' ? '.EXE' : ''), name);
    if (process.platform !== 'win32') fs.chmodSync(path.join(tools, name), 0o755);
  }
  const config = { projectRoot: root, engineSourceRoot: path.join(root, 'engine') };
  const group = { native: true, entries: [{ feature: { id: 'engine.api-context', area: 'engine',
    owners: ['scripts/owner.cjs'], contract: 'docs/contract.md' },
    check: { id: 'engine.api-context.native', level: 'native', executable: 'node',
      args: ['scripts/check-api-context.cjs', '--engine-source-root', '{engineSourceRoot}'] } }] };
  group.check = group.entries[0].check;
  const env = process.platform === 'win32' ? { Path: tools, PathExt: '.EXE;.CMD' } : { PATH: tools };
  env.CARGO_HOME = path.join(root, 'cargo-home');
  let version = 'tool version 1\nhost: fixture\n';
  const providers = { resolveTool: (name, env, platform) => cache.resolveExecutable(name,
    name === 'python' || name === 'python3' ? process.env : env), probe: async (_tool, args) => {
    assert.deepEqual(args, ['--version', '--verbose']); return { stdout: version, stderr: '' };
  } };
  const inputs = async () => ({ projectSha256: 'whole-project', engine: {
    sourceRoot: config.engineSourceRoot, provenance: { source: await getDirectoryState(config.engineSourceRoot),
      selectedSource: 'frozen-input', lockfile: 'present' } } });
  const runtime = () => cache.runtime(config, env, providers);
  const key = async () => cache.key(config, group, await inputs(), await runtime());
  return { root, config, group, env, providers, tools, inputs, runtime, key, version: value => { version = value; } };
}

test('only wholly eligible declared Cargo groups can reuse', () => {
  const f = setup(); assert.equal(cache.isEligible(f.group), true);
  for (const change of [g => { g.native = false; }, g => { g.entries = []; },
    g => { g.entries[0].feature.area = 'ui'; }, g => { g.entries[0].check.level = 'source'; },
    g => { g.entries[0].check.executable = 'python'; },
    g => { g.entries[0].check.args[0] = 'scripts/check-arbitrary.cjs'; },
    g => { g.entries[0].check.args.pop(); }, g => { g.entries[0].check.args.push('--fixture={fixture}'); },
    g => { g.entries[0].check.args.push('{engine}'); },
    g => { g.entries.push({ feature: { area: 'ui' }, check: {} }); }]) {
    const group = structuredClone(f.group); change(group); assert.equal(cache.isEligible(group), false);
  }
});

test('additional source-backed Cargo owners accept actual manifest args and bind wrapper contents', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'azrael-feature-contracts.json'), 'utf8'));
  const f = setup(), runtime = await f.runtime(), inputs = await f.inputs();
  for (const wrapper of ['check-parent-requests.cjs', 'check-capacity-recovery.cjs', 'check-task-profile-skills.cjs']) {
    const script = `scripts/${wrapper}`;
    const matches = manifest.features.flatMap(feature => feature.checks
      .filter(check => check.args[0] === script).map(check => ({ feature, check })));
    assert.equal(matches.length, 1, wrapper);
    const { feature, check } = matches[0];
    assert.equal(feature.area, 'engine');
    assert.deepEqual(check.args, [script, '{engineSourceRoot}']);
    const group = { native: true, entries: [{ feature: f.group.entries[0].feature, check }] };
    assert.equal(cache.isEligible(group), true, wrapper);
    for (const template of ['{engine}', '{fixture}']) {
      const unsafe = structuredClone(group); unsafe.entries[0].check.args.push(template);
      assert.equal(cache.isEligible(unsafe), false, `${wrapper}: ${template}`);
    }
    write(f.root, script, fs.readFileSync(path.join(__dirname, wrapper), 'utf8'));
    const baseline = await cache.key(f.config, group, inputs, runtime);
    fs.appendFileSync(path.join(f.root, script), '\n// wrapper change\n');
    assert.notEqual(await cache.key(f.config, group, inputs, runtime), baseline, wrapper);
  }
});

test('full source, deleted lockfile and provenance bind keys', async () => {
  const f = setup(); const baseline = await f.key(); assert.equal(await f.key(), baseline);
  write(f.root, 'engine/codex-rs/core/src/lib.rs', 'changed'); assert.notEqual(await f.key(), baseline);
  write(f.root, 'engine/codex-rs/core/src/lib.rs', 'source');
  fs.unlinkSync(path.join(f.root, 'engine/codex-rs/Cargo.lock')); assert.notEqual(await f.key(), baseline);
  write(f.root, 'engine/codex-rs/Cargo.lock', 'lock');
  for (const mutate of [i => { i.engine.provenance.selectedSource = 'other provenance'; },
    i => { i.engine.provenance.lockfile = 'different representation'; }]) {
    const inputs = await f.inputs(); mutate(inputs);
    assert.notEqual(await cache.key(f.config, f.group, inputs, await f.runtime()), baseline);
  }
});

test('release directory alone is excluded while verified provenance and all other inputs remain bound', async () => {
  const f = setup(), runtime = await f.runtime(), inputs = await f.inputs();
  inputs.engine.directory = path.join(f.root, 'releases/first/engine');
  inputs.engine.provenance.binaries = { 'azrael.exe': 'verified-binary-sha256' };
  inputs.engine.provenance.environment = { target: 'x86_64-pc-windows-msvc' };
  inputs.manifest = { checks: 'verified-manifest-sha256' };
  const original = structuredClone(inputs);
  const baseline = await cache.key(f.config, f.group, inputs, runtime);
  const relocated = structuredClone(inputs);
  relocated.engine.directory = path.join(f.root, 'releases/second/engine');
  assert.equal(await cache.key(f.config, f.group, relocated, runtime), baseline);
  assert.deepEqual(inputs, original, 'the full gate/receipt identity must not be mutated');
  for (const mutate of [i => { i.engine.provenance.binaries['azrael.exe'] = 'changed-binary'; },
    i => { i.engine.sourceRoot += '-different'; },
    i => { i.engine.provenance.source.sha256 = 'changed-source'; },
    i => { i.engine.provenance.environment.target = 'different-target'; },
    i => { i.manifest.checks = 'changed-manifest'; },
    i => { i.otherDirectory = 'still-significant'; }]) {
    const changed = structuredClone(relocated); mutate(changed);
    assert.notEqual(await cache.key(f.config, f.group, changed, runtime), baseline);
  }
  const changedRuntime = structuredClone(runtime); changedRuntime.environmentSha256 = 'changed-env';
  assert.notEqual(await cache.key(f.config, f.group, relocated, changedRuntime), baseline);
  const minimal = { engine: { directory: 'first' } };
  assert.equal(await cache.key(f.config, f.group, minimal, runtime),
    await cache.key(f.config, f.group, { engine: { directory: 'second' } }, runtime));
  assert.deepEqual(minimal, { engine: { directory: 'first' } });
  assert.match(await cache.key(f.config, f.group, {}, runtime), /^[a-f0-9]{64}$/);
});

test('audited source-backed checks omit complete product payload identity but retain source and unknown inputs', async () => {
  const f = setup(), inputs = await f.inputs(), runtime = await f.runtime();
  Object.assign(f.group.entries[0].check, { cargoPreflight: 'selected-tests-v1', args: ['scripts/check-api-context.cjs', '{engineSourceRoot}', 'core'] });
  for (const file of ['check-api-context.cjs', 'cargo-verification.cjs', 'cargo-target-owner.cjs', 'cargo-test-preparation.cjs'])
    write(f.root, `scripts/${file}`, fs.readFileSync(path.join(__dirname, file), 'utf8'));
  const hash = character => character.repeat(64);
  inputs.engine.provenance = { source: { sourceSha256: hash('a'), target: 'x86_64-pc-windows-msvc', buildEnvironment: {} },
    binaries: { 'azrael.exe': hash('b'), 'azrael-bridge.exe': hash('c'), 'azrael-code-mode-host.exe': hash('d') },
    externalRuntimes: { codeModeHost: { kind: 'external-import', sourcePath: path.join(f.root, 'external/host.exe'), sha256: hash('d') } } };
  const original = structuredClone(inputs), baseline = await cache.key(f.config, f.group, inputs, runtime);
  const copied = structuredClone(inputs);
  copied.engine.provenance.binaries['azrael.exe'] = hash('e');
  copied.engine.provenance.binaries['azrael-code-mode-host.exe'] = hash('f');
  copied.engine.provenance.externalRuntimes.codeModeHost.sha256 = hash('f');
  copied.engine.provenance.externalRuntimes.codeModeHost.sourcePath = path.join(f.root, 'another/host.exe');
  assert.equal(await cache.key(f.config, f.group, copied, runtime), baseline);
  assert.deepEqual(inputs, original);
  for (const mutate of [value => { value.engine.provenance.source.sourceSha256 = hash('e'); },
    value => { value.engine.provenance.extraInput = 'unknown'; },
    value => { value.engine.provenance.externalRuntimes.anotherRuntime = 'unknown'; },
    value => { value.engine.provenance.externalRuntimes.codeModeHost.extraInput = 'unknown'; }]) {
    const changed = structuredClone(copied); mutate(changed);
    assert.notEqual(await cache.key(f.config, f.group, changed, runtime), baseline);
  }
  const incomplete = structuredClone(inputs); delete incomplete.engine.provenance.binaries['azrael-bridge.exe'];
  const changed = structuredClone(incomplete); changed.engine.provenance.binaries['azrael.exe'] = hash('e');
  assert.notEqual(await cache.key(f.config, f.group, incomplete, runtime), await cache.key(f.config, f.group, changed, runtime));
  const malformed = structuredClone(inputs); malformed.engine.provenance.externalRuntimes.codeModeHost.sourcePath = {};
  const malformedChanged = structuredClone(malformed); malformedChanged.engine.provenance.binaries['azrael.exe'] = hash('e');
  assert.notEqual(await cache.key(f.config, f.group, malformed, runtime), await cache.key(f.config, f.group, malformedChanged, runtime));
  for (const platform of ['x86_64-unknown-linux-gnu', 'aarch64-apple-darwin']) {
    const unix = structuredClone(inputs);
    unix.engine.provenance.source.target = platform;
    unix.engine.provenance.binaries = { azrael: hash('b'), 'azrael-bridge': hash('c'), 'azrael-code-mode-host': hash('d') };
    unix.engine.provenance.externalRuntimes.codeModeHost = { kind: 'source-built', sha256: hash('d'), sourceSha256: hash('a') };
    const equivalent = structuredClone(unix); equivalent.engine.provenance.binaries.azrael = hash('e');
    assert.equal(await cache.key(f.config, f.group, equivalent, runtime), await cache.key(f.config, f.group, unix, runtime));
  }
  for (const file of ['check-api-context.cjs', 'cargo-verification.cjs']) {
    const filename = path.join(f.root, 'scripts', file), before = fs.readFileSync(filename);
    fs.appendFileSync(filename, '\n// source-only boundary must be audited again\n');
    assert.notEqual(await cache.key(f.config, f.group, copied, runtime), await cache.key(f.config, f.group, inputs, runtime));
    fs.writeFileSync(filename, before);
  }
});

test('all declared Cargo groups share semantic keys across execution roots and preserve every bound input', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'azrael-feature-contracts.json'), 'utf8'));
  const groups = new Map();
  for (const feature of manifest.features) for (const check of feature.checks) {
    if (!cache.isEligible({ native: true, entries: [{ feature, check }] })) continue;
    const name = JSON.stringify(check.args), group = groups.get(name) || { native: true, entries: [] };
    group.entries.push({ feature, check }); groups.set(name, group);
  }
  for (const scope of ['appserver', 'manual']) {
    assert(groups.has(JSON.stringify(['scripts/check-shared-engine-native.cjs', '{engineSourceRoot}', scope])),
      `shared-engine ${scope} checks must bind their source and tool inputs`);
  }
  const f = setup(), second = path.join(fixtures, 'semantic-second-execution');
  for (const group of groups.values()) for (const { feature, check } of group.entries) {
    for (const file of [...feature.owners, feature.contract]) write(f.root, file, file);
    write(f.root, check.args[0], fs.readFileSync(path.join(__dirname, path.basename(check.args[0])), 'utf8'));
  }
  fs.cpSync(f.root, second, { recursive: true });
  const firstConfig = f.config, secondConfig = { ...f.config, projectRoot: second };
  const runtime = await f.runtime(), nextRuntime = await cache.runtime(secondConfig, f.env, f.providers);
  const inputs = await f.inputs();
  inputs.manifestSha256 = 'full-manifest-first';
  inputs.registered = { path: f.root, sha256: 'all-registered-bytes', fileCount: 30, bytes: 100, unknown: 'retain' };
  inputs.transformRules = { 'unrelated-ui.cjs': 'global-rule-hash' };
  inputs.engine.directory = path.join(f.root, 'release-first');
  inputs.engine.provenance.binaries = { 'azrael.exe': 'binary-sha' };
  const nextInputs = structuredClone(inputs);
  nextInputs.projectSha256 = 'unrelated-work-note'; nextInputs.manifestSha256 = 'unrelated-manifest-declaration';
  nextInputs.registered.path = second; nextInputs.engine.directory = path.join(second, 'release-second');
  const originalInputs = structuredClone(inputs), originalRuntime = structuredClone(runtime);
  for (const group of groups.values()) {
    const baseline = await cache.key(firstConfig, group, inputs, runtime);
    assert.equal(await cache.key(secondConfig, group, nextInputs, nextRuntime), baseline, group.entries[0].check.id);
    assert.equal(await cache.key({ ...secondConfig, cargoVerificationCacheProjectRoot: f.root },
      group, nextInputs, nextRuntime), baseline, 'storage owner must not change semantic identity');
    assert.notEqual(await cache.key({ ...secondConfig, engineSourceRoot: path.join(f.root, 'different-engine') },
      group, nextInputs, nextRuntime), baseline, 'explicit source location remains bound');
    for (const mutate of [i => { i.engine.sourceRoot += '-changed'; },
      i => { i.engine.provenance.source.sha256 = 'changed-source-bytes'; },
      i => { i.engine.provenance.binaries['azrael.exe'] = 'changed-binary'; },
      i => { i.registered.sha256 = 'changed-registered-bytes'; },
      i => { i.registered.unknown = 'changed-unknown'; },
      i => { i.transformRules['unrelated-ui.cjs'] = 'changed-rule'; },
      i => { i.unknown = 'new-input'; }]) {
      const changed = structuredClone(nextInputs); mutate(changed);
      assert.notEqual(await cache.key(secondConfig, group, changed, nextRuntime), baseline);
    }
    for (const mutate of [r => { r.environmentSha256 = 'changed-environment'; },
      r => { r.tools.cargo.version.stdout += ' changed'; },
      r => { r.helper.sha256 = 'changed-helper-bytes'; },
      r => { r.helper.unknown = 'new-helper-field'; },
      r => { r.configParser = { identity: 'changed-parser' }; },
      r => { r.normalized[0].args.push('--changed'); },
      r => { r.unknown = 'new-runtime-field'; }]) {
      const changed = structuredClone(nextRuntime); mutate(changed);
      assert.notEqual(await cache.key(secondConfig, group, nextInputs, changed), baseline);
    }
    const changedGroup = structuredClone(group); changedGroup.entries[0].check.args.push('--changed');
    assert.notEqual(await cache.key(secondConfig, changedGroup, nextInputs, nextRuntime), baseline);
    const first = group.entries[0];
    for (const file of new Set([first.feature.owners[0], first.feature.contract, first.check.args[0], 'scripts/cargo-verification.cjs', 'scripts/cargo-target-owner.cjs', 'scripts/artifact-lifecycle.cjs'])) {
      const full = path.join(second, file), original = fs.readFileSync(full);
      fs.appendFileSync(full, '\nchanged bound bytes');
      assert.notEqual(await cache.key(secondConfig, group, nextInputs, nextRuntime), baseline, file);
      fs.writeFileSync(full, original);
    }
  }
  assert.deepEqual(inputs, originalInputs); assert.deepEqual(runtime, originalRuntime);
  await assert.rejects(cache.key({ ...firstConfig, engineSourceRoot: 'relative' }, groups.values().next().value,
    inputs, runtime), /absolute engine source root/);

  // Historical schema-2 algorithm is a benchmark reference, never an evidence migration.
  const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const legacyKey = async (config, group, input, identity) => {
    const files = new Set(['scripts/feature-preservation.cjs', 'scripts/cargo-verification-cache.cjs',
      'scripts/cargo-verification.cjs', 'scripts/cargo-config-self-contained.py',
      'scripts/verification-result-cache.cjs', 'scripts/directory-state.cjs']);
    const declared = group.entries.map(({ feature, check }) => {
      feature.owners.forEach(file => files.add(file)); files.add(feature.contract); files.add(check.args[0]);
      return { feature, check };
    });
    const previousInputs = structuredClone(input); delete previousInputs.engine.directory;
    return sha(canonical({ schema: 2, projectRoot: path.resolve(config.projectRoot),
      engineSourceRoot: path.resolve(config.engineSourceRoot), inputs: previousInputs, declared,
      files: await getDirectoryState(config.projectRoot, [...files].sort()), runtime: identity }));
  };
  write(f.root, 'mock-stdout.log', 'bounded passing mock executor; no Cargo compilation');
  write(f.root, 'mock-stderr.log', '');
  const evidence = { exitCode: 0, signal: null, logPath: path.join(f.root, 'mock-stdout.log'),
    errorPath: path.join(f.root, 'mock-stderr.log') };
  const benchmark = { scope: `${groups.size} actual declared command groups; two verified mock input snapshots; no full gate/Cargo execution` };
  for (const [name, makeKey] of [['schema2', legacyKey], ['schema4', cache.key]]) {
    const metrics = { executed: 0, reused: 0, elapsedMs: 0 }, started = performance.now();
    const owner = path.join(fixtures, `mock-benchmark-${name}`); fs.mkdirSync(owner, { recursive: true });
    for (const [index, [config, input, identity]] of [[firstConfig, inputs, runtime], [secondConfig, nextInputs, nextRuntime]].entries()) {
      for (const group of groups.values()) {
        const checkId = group.entries[0].check.id;
        const handle = await cache.begin({ ...cache.options({ ...config, cargoVerificationCacheProjectRoot: owner }),
          checkId, key: await makeKey(config, group, input, identity),
          runDirectory: path.join(config.projectRoot, 'artifacts/mock-results', name, String(index), checkId), logName: 'mock-cargo' });
        if (handle.hit) metrics.reused += 1;
        else { metrics.executed += 1; assert.equal((await handle.publish(evidence)).published, true); }
        await handle.close();
      }
    }
    metrics.elapsedMs = performance.now() - started; benchmark[name] = metrics;
  }
  assert.equal(benchmark.schema2.executed, groups.size * 2); assert.equal(benchmark.schema2.reused, 0);
  assert.equal(benchmark.schema4.executed, groups.size); assert.equal(benchmark.schema4.reused, groups.size);
  benchmark.mockExecutionsAvoided = groups.size;
  const evidenceRoot = process.env.AZRAEL_CARGO_OWNER_TEST_ROOT
    ? path.join(fixtureParent, 'evidence') : path.resolve(__dirname, '../artifacts/logs/AF-01-resume-install/optimization-20min');
  fs.mkdirSync(evidenceRoot, { recursive: true });
  fs.writeFileSync(path.join(evidenceRoot, 'cargo-schema4-mock-benchmark.json'), JSON.stringify(benchmark, null, 2) + '\n');
  console.log(JSON.stringify(benchmark));
});

test('tools, versions, full environment, target/profile/flags and helper defaults bind keys', async () => {
  const f = setup(); let previous = await f.key();
  for (const [name, value] of [['UNRELATED_ENV', 'value'], ['AZRAEL_CARGO_PROFILE', 'release'],
    ['AZRAEL_CARGO_TARGET', 'fixture-target'], ['RUSTFLAGS', '--cfg fixture'],
    ['CARGO_ENCODED_RUSTFLAGS', '--cfg\x1ffixture'], ['CARGO_TARGET_DIR', path.join(f.root, 'target')]]) {
    f.env[name] = value; const next = await f.key(); assert.notEqual(next, previous); previous = next;
  }
  f.version('tool version 2\nhost: fixture\n'); assert.notEqual(await f.key(), previous);
  previous = await f.key();
  write(f.tools, 'cargo' + (process.platform === 'win32' ? '.EXE' : ''), 'new shim bytes');
  assert.notEqual(await f.key(), previous); previous = await f.key();
  write(f.root, 'scripts/cargo-verification.cjs', 'helper change'); assert.notEqual(await f.key(), previous);
  previous = await f.key();
  f.group.entries[0].check.cargoPreflight = 'selected-tests-v1';
  assert.notEqual(await f.key(), previous, 'preflight declaration must invalidate older passing evidence');
  const runtime = await f.runtime();
  assert.equal(runtime.normalized[0].rustMinStack, '33554432'); assert.equal(runtime.normalized[0].instaUpdate, 'no');
  assert(runtime.normalized[0].args.includes('release')); assert(runtime.normalized[0].args.includes('fixture-target'));
  assert.notEqual(runtime.normalized[0].environmentSha256, runtime.normalized[1].environmentSha256);
});

test('declared check flags, owners, contract and implementation inputs bind keys', async () => {
  const f = setup(); const baseline = await f.key();
  f.group.check.args.push('--new-flag'); assert.notEqual(await f.key(), baseline); f.group.check.args.pop();
  for (const file of ['scripts/owner.cjs', 'docs/contract.md', 'scripts/check-api-context.cjs',
    'scripts/verification-result-cache.cjs', 'scripts/cargo-verification-cache.cjs',
    'scripts/cargo-target-owner.cjs', 'scripts/artifact-lifecycle.cjs',
    'scripts/cargo-config-self-contained.py']) {
    const previous = await f.key(); fs.appendFileSync(path.join(f.root, file), ' changed');
    assert.notEqual(await f.key(), previous);
  }
  await assert.rejects(cache.key(f.config, f.group, undefined, await f.runtime()), /verified inputs/);
});

test('uncertain resolution, missing executables and failed version probes disable identity', async () => {
  const f = setup();
  await assert.rejects(cache.runtime(f.config, {}, f.providers), /PATH missing/);
  await assert.rejects(cache.runtime(f.config, { PATH: '.' }, f.providers), /Uncertain/);
  await assert.rejects(cache.runtime(f.config, f.env, { probe: () => { throw Error('probe failure'); } }), /probe failure/);
  await assert.rejects(cache.runtime(f.config, f.env, { probe: () => ({ stdout: '', stderr: '' }) }), /version identity/);
  fs.unlinkSync(path.join(f.tools, 'rustc' + (process.platform === 'win32' ? '.EXE' : '')));
  await assert.rejects(f.runtime(), /Cannot resolve rustc/);
  if (process.platform === 'win32') {
    await assert.rejects(cache.runtime(f.config, { ...f.env, PATH: f.tools }, f.providers), /Ambiguous/);
  }
});

test('ignored external Cargo configs and absent config sentinels invalidate keys', async () => {
  const f = setup(); let previous = await f.key();
  for (const file of ['cargo-home/config.toml', '.cargo/config', 'engine/.cargo/config.toml',
    'engine/codex-rs/.cargo/config.toml']) {
    write(f.root, file, '[build]\njobs = 2\n');
    const next = await f.key(); assert.notEqual(next, previous, `new config ${file}`); previous = next;
    write(f.root, file, '[build]\njobs = 3\n');
    const changed = await f.key(); assert.notEqual(changed, previous, `config bytes ${file}`); previous = changed;
  }
  const runtime = await f.runtime();
  assert(runtime.cargoConfigs.some(config => config.present === false));
  assert(runtime.cargoConfigs.some(config => config.filename === path.join(f.env.CARGO_HOME, 'config.toml') && config.present));
  const defaultHome = path.join(f.root, 'default-home');
  const env = { ...f.env }; delete env.CARGO_HOME;
  const first = await cache.runtime(f.config, env, { ...f.providers, homedir: defaultHome });
  write(defaultHome, '.cargo/config', '[net]\noffline = true\n');
  const second = await cache.runtime(f.config, env, { ...f.providers, homedir: defaultHome });
  assert.notDeepEqual(first.cargoConfigs, second.cargoConfigs);
  env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'] = defaultHome;
  const inherited = await cache.runtime(f.config, env, f.providers);
  assert.deepEqual(inherited.cargoConfigs, second.cargoConfigs);
});

test('config includes, path dependencies, external tools and unparsed config syntax disable reuse', async () => {
  const f = setup();
  for (const contents of ['include = "other.toml"', 'paths = ["external"]',
    '[patch.crates-io.example]\npath = "../external"', '[target.fixture]\nlinker = "external-tool"',
    '[build]\nrustc-wrapper = "wrapper"', '[build]\nrustflags = ["-L", "../native"]',
    '[build]\ntarget = "external-target.json"']) {
    write(f.root, 'cargo-home/config.toml', contents);
    await assert.rejects(f.runtime(), /unresolved external inputs|unsupported syntax|external specification/);
  }
  fs.unlinkSync(path.join(f.root, 'cargo-home/config.toml'));
  f.env.CARGO_HOME = 'relative-home'; await assert.rejects(f.runtime(), /Relative CARGO_HOME/);
});

test('current Windows Cargo TOML and equivalent syntax enable config identity', async () => {
  const f = setup();
  const current = fs.readFileSync(path.resolve(__dirname, '../engine/codex-rs/.cargo/config.toml'), 'utf8');
  write(f.root, 'cargo-home/config.toml', current);
  const identity = await f.runtime();
  assert(identity.configParser.identity.version);
  assert(Object.keys(identity.configParser.identity.tomllib).length >= 3);
  const baseline = await f.key();
  const forms = [
    `[target.'cfg(all(windows, target_env = "msvc"))']
"rustflags" = [
  '-C', # preserve array comments
  """link-arg=/STACK:8388608""", "-C", 'target-feature=+crt-static',
]
[term]
progress.when = "always"
progress.width = 80
[profile.release]
lto = true
`,
    `target.aarch64-pc-windows-msvc.rustflags = ["-Clink-arg=/arm64hazardfree"]
build = { jobs = 2, target = 'aarch64-pc-windows-msvc' }
`,
    `[build]
rustflags = ["-C", "link-arg=-Wl,--stack,8388608"]
`,
  ];
  for (const contents of forms) {
    write(f.root, 'cargo-home/config.toml', contents);
    assert.notEqual(await f.key(), baseline);
  }
  const before = await f.key();
  fs.appendFileSync(path.join(f.root, 'cargo-home/config.toml'), '# byte change only\n');
  assert.notEqual(await f.key(), before);
  const runtime = await f.runtime();
  const changed = structuredClone(runtime); changed.configParser.identity.version += ' changed';
  assert.notEqual(await cache.key(f.config, f.group, await f.inputs(), changed), await f.key());
  const changedBytes = structuredClone(runtime);
  changedBytes.configParser.identity.tomllib['parser-source'] = 'changed';
  assert.notEqual(await cache.key(f.config, f.group, await f.inputs(), changedBytes), await f.key());
});

test('TOML unknown flags, disguised paths and invalid TOML fail closed', async () => {
  const f = setup();
  const badFlags = ['link-arg=/LIBPATH:C:/external', 'link-arg=/STACK:8388608,@file',
    'link-arg=/STACK:0', 'link-arg=/STACK:8388608 /OTHER', 'link-arg=/arm64hazardfree/other',
    'link-arg=-Wl,--stack,8388608,@file', 'link-arg=@response', 'linker=clang',
    'sysroot=C:/external', 'target-feature=+crt-static,+unknown', 'unknown=true', '-L', '@file'];
  for (const option of badFlags) {
    write(f.root, 'cargo-home/config.toml', `[target.'cfg(windows)']\nrustflags = ["-C", ${JSON.stringify(option)}]`);
    await assert.rejects(f.runtime(), /unresolved external inputs|unsupported syntax/, option);
  }
  for (const contents of [
    '[build]\njobs = 2\njobs = 3', '[build]\nrustflags = ["-C"]',
    '[build]\nrustflags = "-C link-arg=/STACK:8388608"',
    '[target."external.json"]\nrustflags = []',
    '[target."fixture-target"]\nrunner = "tool"',
    '[env]\nSAFE = "value"', '[term]\ncolor = "safe#not-comment"',
    '[build]\ntarget = """external/target.json"""',
    '[build]\nrustflags = ["-C", "link-arg=/STACK:8388608"]\ninclude = "hidden.toml"',
    '[build]\nrustflags = ["-C", "link-arg=/STACK:8388608", "--sysroot", "external"]',
  ]) {
    write(f.root, 'cargo-home/config.toml', contents);
    await assert.rejects(f.runtime(), /unresolved external inputs|unsupported syntax/, contents);
  }
  write(f.root, 'cargo-home/config.toml', '[build]\njobs = 2');
  await assert.rejects(cache.runtime(f.config, f.env, {
    ...f.providers, resolveTool: (name, env) => {
      if (name === 'python' || name === 'python3') throw Error('Cannot resolve Python parser');
      return cache.resolveExecutable(name, env);
    },
  }), /Cannot resolve Python parser/);
});

test('selected rustc and wrapper executable contents bind keys; relative tools and path flags reject', async () => {
  const f = setup();
  const extension = process.platform === 'win32' ? '.EXE' : '';
  for (const name of ['RUSTC', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'CARGO_TARGET_FIXTURE_LINKER',
    'CARGO_BUILD_RUSTC_WRAPPER']) {
    const file = `${name.toLowerCase()}${extension}`;
    write(f.tools, file, 'tool bytes');
    if (process.platform !== 'win32') fs.chmodSync(path.join(f.tools, file), 0o755);
    f.env[name] = path.join(f.tools, file);
    const before = await f.key(); write(f.tools, file, 'changed tool bytes');
    assert.notEqual(await f.key(), before, name);
  }
  f.env.RUSTC_WRAPPER = `cargo${extension}`;
  assert((await f.runtime()).externalTools.RUSTC_WRAPPER.executable);
  f.env.RUSTC_WRAPPER = './wrapper'; await assert.rejects(f.runtime(), /Ambiguous relative external tool/);
  delete f.env.RUSTC_WRAPPER;
  f.env.RUSTFLAGS = '-L ../native'; await assert.rejects(f.runtime(), /Unresolved external flag inputs/);
  delete f.env.RUSTFLAGS; f.env.CARGO_BUILD_TARGET = 'external.json';
  await assert.rejects(f.runtime(), /Unresolved external target specification/);
});

test('existing evidence store enforces cold/warm, corruption, failures and forced invalidation', async () => {
  const f = setup(), key = await f.key();
  const opts = { ...cache.options(f.config), checkId: f.group.check.id, key,
    runDirectory: path.join(f.root, 'artifacts/results'), logName: 'cargo-check' };
  write(f.root, 'stdout.log', 'passing Cargo test'); write(f.root, 'stderr.log', '');
  const record = { exitCode: 0, signal: null, logPath: path.join(f.root, 'stdout.log'), errorPath: path.join(f.root, 'stderr.log') };
  let handle = await cache.begin(opts); assert.equal(handle.hit, null);
  assert.equal((await handle.publish({ ...record, exitCode: 1 })).published, false);
  assert.equal((await handle.publish(record)).published, true); await handle.close();
  handle = await cache.begin(opts); assert.equal(handle.hit.reused, true); await handle.close();
  const entry = path.join(opts.cacheRoot, `v${cache.CACHE_SCHEMA}`, sha(opts.checkId), key);
  fs.writeFileSync(path.join(entry, 'stdout.log'), 'tampered');
  handle = await cache.begin(opts); assert.equal(handle.hit, null);
  assert.equal((await handle.publish(record)).published, true); await handle.close();
  fs.writeFileSync(path.join(entry, 'receipt.json'), '{corrupt');
  handle = await cache.begin(opts); assert.equal(handle.hit, null);
  assert.equal((await handle.publish(record)).published, true); await handle.close();
  handle = await cache.begin({ ...opts, force: true }); assert.equal(handle.hit, null);
  assert.equal(fs.existsSync(entry), false);
  assert.equal((await handle.publish({ ...record, exitCode: 9 })).published, false); await handle.close();
  handle = await cache.begin(opts); assert.equal(handle.hit, null); await handle.close();
  assert.equal(cache.begin, storage.begin); assert.equal(cache.pruneRemovedChecks, storage.pruneRemovedChecks);
  assert.equal(cache.pruneObsoleteVersions, storage.pruneObsoleteVersions);
});

test('explicit Cargo storage owner shares evidence and leases while enforcing path guards', async () => {
  const f = setup(), owner = path.join(fixtures, 'shared-cargo-owner');
  fs.mkdirSync(owner, { recursive: true });
  assert.deepEqual(cache.options(f.config), { projectRoot: f.root,
    cacheRoot: path.join(f.root, 'artifacts/cache/verification-results/cargo-v2') });
  assert.equal(cache.CACHE_NAMESPACE, 'cargo-v2');
  for (const value of ['relative', '', null, 1, {}]) {
    assert.throws(() => cache.options({ ...f.config, cargoVerificationCacheProjectRoot: value }), /absolute path/);
  }
  const config = { ...f.config, cargoVerificationCacheProjectRoot: owner };
  const opts = { ...cache.options(config), checkId: f.group.check.id, key: sha('same semantic check'),
    runDirectory: path.join(f.root, 'artifacts/results'), logName: 'shared-owner-check' };
  assert.equal(opts.projectRoot, owner);
  assert.equal(opts.cacheRoot, path.join(owner, 'artifacts/cache/verification-results/cargo-v2'));
  write(f.root, 'stdout.log', 'mock Cargo passed'); write(f.root, 'stderr.log', '');
  const record = { exitCode: 0, signal: null, logPath: path.join(f.root, 'stdout.log'), errorPath: path.join(f.root, 'stderr.log') };
  let cold = await cache.begin(opts);
  assert.equal(cold.hit, null);
  const nextConfig = { ...config, projectRoot: path.join(fixtures, 'second-execution-root') };
  const nextOpts = { ...opts, ...cache.options(nextConfig), runDirectory: path.join(nextConfig.projectRoot, 'results') };
  const busy = await cache.begin(nextOpts);
  assert.equal(busy.hit, null); assert.match(busy.reason, /busy: check lease/); await busy.close();
  assert.equal((await cold.publish(record)).published, true); await cold.close();
  const warm = await cache.begin(nextOpts); assert.equal(warm.hit.reused, true); await warm.close();
  await assert.rejects(cache.begin({ ...nextOpts, cacheRoot: path.join(f.root, 'outside-owner') }), /must be inside/);
  const unsafeOwner = path.join(fixtures, 'redirected-cargo-owner');
  fs.mkdirSync(unsafeOwner, { recursive: true });
  const unsafe = { ...opts, ...cache.options({ ...f.config, cargoVerificationCacheProjectRoot: unsafeOwner }) };
  const target = path.join(fixtures, 'redirected-target');
  write(target, 'keep.txt', 'preserve');
  fs.mkdirSync(path.dirname(unsafe.cacheRoot), { recursive: true });
  fs.symlinkSync(target, unsafe.cacheRoot, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const handle = await cache.begin(unsafe);
    assert.equal(handle.hit, null); assert.match(handle.reason, /Unsafe|Redirected/); await handle.close();
    assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'preserve');
  } finally { fs.unlinkSync(unsafe.cacheRoot); }
});

test('fresh Cargo namespace isolates evidence and leases while preserving unprovable legacy owners', async () => {
  const f = setup(), checkId = f.group.check.id, key = sha('namespace-migration');
  const opts = { ...cache.options(f.config), checkId, key, runDirectory: path.join(f.root, 'artifacts/results') };
  const legacyRoot = path.join(f.root, 'artifacts/cache/verification-results/cargo');
  write(f.root, 'stdout.log', 'legacy passing evidence'); write(f.root, 'stderr.log', '');
  const record = { exitCode: 0, signal: null, logPath: path.join(f.root, 'stdout.log'), errorPath: path.join(f.root, 'stderr.log') };
  const legacy = await storage.begin({ ...opts, cacheRoot: legacyRoot });
  assert.equal((await legacy.publish(record)).published, true); await legacy.close();
  const ownerBytes = JSON.stringify({ token: 'unprovable-legacy-owner', pid: 52716 });
  for (const lease of [path.join('.leases', sha(checkId)), '.lease-access', '.lifecycle']) {
    write(legacyRoot, path.join(lease, 'owner.json'), ownerBytes);
  }
  const before = await getDirectoryState(legacyRoot);
  const fresh = await cache.begin(opts);
  assert.equal(fresh.hit, null, 'legacy passing entries must not be read under new locks');
  assert.match(fresh.reason, /^miss:/);
  const lease = path.join(opts.cacheRoot, '.leases', sha(checkId), 'owner.json');
  const freshOwner = fs.readFileSync(lease);
  const busy = await cache.begin(opts);
  assert.equal(busy.hit, null); assert.match(busy.reason, /busy: check lease/); await busy.close();
  assert.deepEqual(fs.readFileSync(lease), freshOwner, 'live new-namespace ownership stays exclusive');
  fs.writeFileSync(record.logPath, 'fresh passing evidence');
  assert.equal((await fresh.publish(record)).published, true); await fresh.close();
  const warm = await cache.begin(opts);
  assert.equal(warm.hit.reused, true); assert.equal(warm.hit.stdout, 'fresh passing evidence'); await warm.close();
  assert.deepEqual(fs.readdirSync(path.join(opts.cacheRoot, '.leases')), []);
  for (const lease of ['.lifecycle', '.lease-access']) assert.equal(fs.existsSync(path.join(opts.cacheRoot, lease)), false);
  assert.deepEqual(await getDirectoryState(legacyRoot), before, 'legacy evidence and owner bytes stay unchanged');
});

after(() => {
  function clean(filename) {
    const relative = path.relative(fixtures, filename);
    assert(relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)));
    const stat = fs.lstatSync(filename); assert(!stat.isSymbolicLink());
    if (stat.isDirectory()) { for (const child of fs.readdirSync(filename)) clean(path.join(filename, child)); fs.rmdirSync(filename); }
    else fs.unlinkSync(filename);
  }
  clean(fixtures);
});

test('known MALLOC_CONF table is self-contained, byte/env identity bound and unknown env inputs rejected', async () => {
  const f = setup();
  const current = fs.readFileSync(path.resolve(__dirname, '../engine/.cargo/config.toml'), 'utf8');
  write(f.root, 'cargo-home/config.toml', current);
  const first = await f.key();
  for (const contents of [
    '[env]\nMALLOC_CONF = { value = "thp:always" }',
    '[env]\nMALLOC_CONF = { value = "thp:always", force = true, relative = false }',
    '[env.MALLOC_CONF]\nvalue = "thp:always"\nforce = false\nrelative = false',
  ]) { write(f.root, 'cargo-home/config.toml', contents); assert.notEqual(await f.key(), first); }
  const before = await f.key();
  fs.appendFileSync(path.join(f.root, 'cargo-home/config.toml'), '\n# byte identity changes\n');
  assert.notEqual(await f.key(), before);
  const configChanged = await f.key(); f.env.MALLOC_CONF = 'thp:never';
  assert.notEqual(await f.key(), configChanged);
  f.env.MALLOC_CONF = ''; assert.notEqual(await f.key(), configChanged);
  for (const line of [
    'UNKNOWN = { value = "thp:always" }', 'RUSTC = { value = "thp:always" }',
    'RUSTC_WRAPPER = { value = "thp:always" }',
    'MALLOC_CONF = { value = "thp:always", relative = true }',
    'MALLOC_CONF = { value = "../path" }', 'MALLOC_CONF = { value = "thp:never" }',
    'MALLOC_CONF = { value = true }', 'MALLOC_CONF = { value = "thp:always", force = 0 }',
    'MALLOC_CONF = { value = "thp:always", relative = 0 }',
    'MALLOC_CONF = { value = "thp:always", unknown = false }', 'MALLOC_CONF = "thp:always"',
  ]) { write(f.root, 'cargo-home/config.toml', '[env]\n'+line); await assert.rejects(f.runtime(), /unresolved external/); }
});

test('complete zod content identity ignores snapshot path only; unknown and incomplete identity remain bound', async () => {
  const f = setup(), inputs = await f.inputs(), runtime = await f.runtime();
  inputs.checkRuntime = { nodeSha256: sha('node'), zod: { path: path.join(f.root, 'zod-first'),
    sha256: sha('zod tree'), fileCount: 718, bytes: 4558122 }, bunSha256: sha('bun') };
  const baseline = await cache.key(f.config, f.group, inputs, runtime), relocated = structuredClone(inputs);
  relocated.checkRuntime.zod.path = path.join(f.root, 'zod-second');
  assert.equal(await cache.key(f.config, f.group, relocated, runtime), baseline);
  for (const mutate of [i => { i.checkRuntime.zod.sha256 = sha('changed package'); },
    i => { i.checkRuntime.zod.fileCount++; }, i => { i.checkRuntime.zod.bytes++; },
    i => { i.checkRuntime.zod.unknown = 'changed'; }, i => { i.checkRuntime.nodeSha256 = sha('changed tool'); },
    i => { i.checkRuntime.unknown = 'changed'; }, i => { i.engine.provenance.lockfile = 'changed'; }]) {
    const changed = structuredClone(relocated); mutate(changed);
    assert.notEqual(await cache.key(f.config, f.group, changed, runtime), baseline);
  }
  const changedRuntime = structuredClone(runtime); changedRuntime.environmentSha256 = 'changed environment';
  assert.notEqual(await cache.key(f.config, f.group, relocated, changedRuntime), baseline);
  for (const mutate of [i => { delete i.checkRuntime.zod.sha256; },
    i => { i.checkRuntime.zod.fileCount = '718'; }, i => { i.checkRuntime.zod.path = 'relative-first'; }]) {
    const first = structuredClone(inputs); mutate(first); const second = structuredClone(first);
    second.checkRuntime.zod.path = first.checkRuntime.zod.path === 'relative-first' ? 'relative-second' : path.join(f.root, 'elsewhere');
    assert.notEqual(await cache.key(f.config, f.group, first, runtime), await cache.key(f.config, f.group, second, runtime));
  }
});
