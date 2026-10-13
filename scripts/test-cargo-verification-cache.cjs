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
const fixtureParent = path.resolve(__dirname, '../artifacts/verification');
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
    'verification-result-cache.cjs', 'directory-state.cjs', 'check-api-context.cjs']) write(root, `scripts/${file}`, file);
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
  const providers = { probe: async (_tool, args) => {
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

test('full source, deleted lockfile, project identity and provenance bind keys', async () => {
  const f = setup(); const baseline = await f.key(); assert.equal(await f.key(), baseline);
  write(f.root, 'engine/codex-rs/core/src/lib.rs', 'changed'); assert.notEqual(await f.key(), baseline);
  write(f.root, 'engine/codex-rs/core/src/lib.rs', 'source');
  fs.unlinkSync(path.join(f.root, 'engine/codex-rs/Cargo.lock')); assert.notEqual(await f.key(), baseline);
  write(f.root, 'engine/codex-rs/Cargo.lock', 'lock');
  for (const mutate of [i => { i.projectSha256 = 'other project'; },
    i => { i.engine.provenance.selectedSource = 'other provenance'; },
    i => { i.engine.provenance.lockfile = 'different representation'; }]) {
    const inputs = await f.inputs(); mutate(inputs);
    assert.notEqual(await cache.key(f.config, f.group, inputs, await f.runtime()), baseline);
  }
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
  const runtime = await f.runtime();
  assert.equal(runtime.normalized[0].rustMinStack, '33554432'); assert.equal(runtime.normalized[0].instaUpdate, 'no');
  assert(runtime.normalized[0].args.includes('release')); assert(runtime.normalized[0].args.includes('fixture-target'));
  assert.notEqual(runtime.normalized[0].environmentSha256, runtime.normalized[1].environmentSha256);
});

test('declared check flags, owners, contract and implementation inputs bind keys', async () => {
  const f = setup(); const baseline = await f.key();
  f.group.check.args.push('--new-flag'); assert.notEqual(await f.key(), baseline); f.group.check.args.pop();
  for (const file of ['scripts/owner.cjs', 'docs/contract.md', 'scripts/check-api-context.cjs',
    'scripts/verification-result-cache.cjs', 'scripts/cargo-verification-cache.cjs']) {
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
