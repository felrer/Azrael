'use strict';
const { test, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const preflight = require('./pipeline-preflight.cjs');
const root = path.resolve(process.env.AZRAEL_PIPELINE_PREFLIGHT_TEST_ROOT || path.join(__dirname, '../artifacts/verification/preflight-tests')); fs.mkdirSync(root, { recursive: true });
const owned = [];
after(() => { for (const dir of owned) { assert.equal(path.dirname(dir), root); fs.rmSync(dir, { recursive: true }); } });
const features = [{ checks: [{ args: ['scripts/test-provider-input-budget-helper.cjs'] }] }];
function fixture() {
  const projectRoot = fs.mkdtempSync(path.join(root, 'case-')); owned.push(projectRoot);
  const provider = path.join(projectRoot, 'providers/opencodex'); fs.mkdirSync(provider, { recursive: true });
  fs.writeFileSync(path.join(provider, 'package.json'), '{}'); return { projectRoot, provider };
}
function install(provider) {
  const zod = path.join(provider, 'node_modules/zod'); fs.mkdirSync(zod, { recursive: true });
  fs.writeFileSync(path.join(zod, 'package.json'), JSON.stringify({ name: 'zod', exports: { './v4': './index.cjs' } }));
  fs.writeFileSync(path.join(zod, 'index.cjs'), 'module.exports = {};');
}
test('unselected dependency check causes no install and no package resolution', () => {
  assert.deepEqual(preflight.prepare({ projectRoot: 'missing' }, [], () => { throw Error('unexpected install'); }), { dependenciesPrepared: false });
});
test('existing verification dependencies are reused', () => {
  const f = fixture(); install(f.provider);
  assert.deepEqual(preflight.prepare(f, features, () => { throw Error('unexpected install'); }), { dependenciesPrepared: false });
});
test('missing dependencies require a lockfile and preserve frozen install arguments', () => {
  const f = fixture(); assert.throws(() => preflight.prepare(f, features), /lockfile required/);
  fs.writeFileSync(path.join(f.provider, 'bun.lock'), 'pinned');
  const result = preflight.prepare(f, features, (_executable, args, options) => {
    assert.deepEqual(args, ['install', '--frozen-lockfile']); assert.equal(options.cwd, f.provider); assert.equal(options.shell, false);
    install(f.provider); return { status: 0 };
  }); assert.equal(result.dependenciesPrepared, true);
});
test('failed install and missing exported module reject preparation', () => {
  const f = fixture(); fs.writeFileSync(path.join(f.provider, 'bun.lock'), 'pinned');
  assert.throws(() => preflight.prepare(f, features, () => ({ status: 7 })), /failed: 7/);
  assert.throws(() => preflight.prepare(f, features, () => ({ status: 0 })), /zod/);
});
test('verification identity binds actual package and runtime bytes', async () => {
  const f = fixture(); install(f.provider); const bun = path.join(f.projectRoot, 'bun.exe'); fs.writeFileSync(bun, 'bun runtime');
  const previous = process.env.AZRAEL_BUN; process.env.AZRAEL_BUN = bun;
  try {
    const first = await preflight.identity(f, features);
    fs.appendFileSync(path.join(f.provider, 'node_modules/zod/index.cjs'), '// changed');
    const second = await preflight.identity(f, features); assert.notDeepEqual(second.zod, first.zod);
    fs.appendFileSync(bun, ' changed'); assert.notEqual((await preflight.identity(f, features)).bunSha256, first.bunSha256);
  } finally { if (previous === undefined) delete process.env.AZRAEL_BUN; else process.env.AZRAEL_BUN = previous; }
});
test('Windows PATH composition has one key and deduplicates case; POSIX paths retain case', () => {
  const windows = preflight.composePath({ Path: 'C:\\Tools;C:\\other', PATH: 'c:\\tools;C:\\Extra', SECRET: 'retained' }, ['C:\\Python'], 'win32');
  assert.deepEqual(Object.keys(windows).filter(key => key.toUpperCase() === 'PATH'), ['PATH']);
  assert.equal(windows.PATH, 'C:\\Python;C:\\Tools;C:\\other;C:\\Extra');
  assert.equal(windows.SECRET, 'retained');
  assert.equal(preflight.composePath({ PATH: '/Tools:/tools' }, [], 'linux').PATH, '/Tools:/tools');
});
const sdkFeatures = [{ checks: [{ executable: 'node', args: ['scripts/check-question-withdrawal-sdk.cjs'], level: 'source' },
  { id: 'native', executable: 'node', args: ['scripts/check-api-context.cjs'], cargoPreflight: 'selected-tests-v1' }] }];
function environmentFixture() {
  const f = fixture(); const engineSourceRoot = path.join(f.projectRoot, 'selected');
  fs.mkdirSync(path.join(engineSourceRoot, 'codex-rs'), { recursive: true });
  const generated = path.join(engineSourceRoot, 'sdk/python/src/openai_codex/generated');
  fs.mkdirSync(generated, { recursive: true }); fs.writeFileSync(path.join(generated, 'v2_all.py'), '# fixture');
  return { ...f, engineSourceRoot };
}
test('selected consumers probe actual SDK import and composed child PATH with selected settings', async () => {
  const f = environmentFixture(); const calls = [];
  const sdkDirectory=path.join(f.projectRoot,'sdk-python310'),genericDirectory=path.join(f.projectRoot,'build-python313');
  fs.mkdirSync(sdkDirectory);fs.mkdirSync(genericDirectory);
  const sdkExecutable=path.join(sdkDirectory,process.platform==='win32'?'python.exe':'python');fs.writeFileSync(sdkExecutable,'fixture SDK');
  const result = await preflight.environment({ ...f, toolDirectories:[genericDirectory], cargoTargetDirectory: path.join(f.projectRoot, 'target'), cargoTarget: 'selected-triple', cargoProfile: 'release', rustupToolchain: 'pinned' }, sdkFeatures, {
    env: { PATH: 'C:\\inherited', AZRAEL_PYTHON_SDK: sdkExecutable, TOKEN: 'secret' },
    run(command, args, options) {
      calls.push({ command, args, options });
      assert.equal(options.cwd, path.join(f.engineSourceRoot, 'codex-rs'));
      assert.equal(options.shell, false);
      assert.equal(options.env.RUSTUP_TOOLCHAIN, 'pinned');
      if(calls.length===2) assert.equal(options.env.PATH.split(path.delimiter)[0],sdkDirectory);
      else assert.ok(!options.env.PATH.split(path.delimiter).includes(sdkDirectory));
      return { status: 0, stdout: calls.length === 2 ? sdkExecutable : calls.length===3 ? JSON.stringify({python:path.join(genericDirectory,'python'),version:'3.13.0'}) : 'identity', stderr: '' };
    },
  });
  assert.equal(calls.length, 4);
  assert.match(calls[0].args[2], /import json,pathlib,sys,pydantic/);
  assert.equal(calls[0].args.at(-1), f.engineSourceRoot);
  assert.equal(result.environmentPatch.AZRAEL_CARGO_PROFILE, 'release');
  assert.ok(!result.environmentPatch.PATH.split(path.delimiter).includes(sdkDirectory));
  assert.equal(result.environmentPatch.AZRAEL_PYTHON_SDK,sdkExecutable);
  assert.match(calls[2].args.at(-1),/tomllib/);
  assert.ok(!calls[0].args[2].includes('sys.version_info >= (3,11)'));
  assert.equal(result.env.TOKEN, 'secret');
  const { env, ...report } = result; assert.ok(!JSON.stringify(report).includes('secret'));
  assert.deepEqual(result.probes.map(probe => probe.exitCode), [0, 0, 0, 0]);
});
test('base Cargo Python parser and Cargo lookup failures block remaining consumers', async () => {
  const f=environmentFixture();
  const cargoOnly=[{checks:[{executable:'node',args:['scripts/check-api-context.cjs'],cargoPreflight:'selected-tests-v1'}]}];
  let calls=0;
  await assert.rejects(preflight.environment(f,cargoOnly,{env:{PATH:path.dirname(process.execPath)},run(){calls++;return {status:1,stderr:'No module named tomllib'};}}),/tomllib/);
  assert.equal(calls,1);
  calls=0;
  await assert.rejects(preflight.environment(f,cargoOnly,{env:{PATH:path.dirname(process.execPath)},run(){calls++;return calls===1?{status:0,stdout:'Python 3.13 parser'}:{status:1,stderr:'spawnSync cargo ENOENT'};}}),/cargo ENOENT/);
  assert.equal(calls,2);
});
test('environment probes are conditional and failed prerequisite blocks remaining probes', async () => {
  assert.deepEqual((await preflight.environment({}, [], { env: {}, run() { throw Error('unexpected'); } })).probes, []);
  const f = environmentFixture(); let calls = 0;
  await assert.rejects(preflight.environment(f, sdkFeatures, { env: { AZRAEL_PYTHON_SDK: process.execPath }, run() { calls++; return { status: 7, stderr: 'missing pydantic' }; } }), error => {
    assert.match(error.message, /missing pydantic/); assert.equal(error.probes[0].exitCode, 7); return true;
  });
  assert.equal(calls, 1);
  await assert.rejects(preflight.environment(f, sdkFeatures, { env: { AZRAEL_PYTHON_SDK: 'relative' } }), /installed SDK Python/);
});
test('filesystem preflight reports unknown estimates, checks capacity and probes owned temporary output', context => {
  const f = environmentFixture();
  context.mock.method(fs, 'statfsSync', () => ({ bavail: 100n, bsize: 10n }));
  assert.equal(preflight.filesystemBoundaries(f).storage.status, 'unknown');
  assert.equal(preflight.filesystemBoundaries(f).temporary.status, 'not-selected');
  assert.throws(() => preflight.filesystemBoundaries({ ...f, estimatedGrowthBytes: 1001 }), /Insufficient workspace capacity/);
  assert.throws(() => preflight.filesystemBoundaries({ ...f, estimatedGrowthBytes: -1 }), /nonnegative/);
  assert.throws(() => preflight.filesystemBoundaries({ ...f, temporaryDirectory: path.join(f.projectRoot, 'outside') }), /under project artifacts/);
  const temporaryDirectory = path.join(f.projectRoot, 'artifacts', 'owned-probe');
  const report = preflight.filesystemBoundaries({ ...f, temporaryDirectory, estimatedGrowthBytes: 500, requiredFreeBytes: 1000 });
  assert.equal(report.storage.status, 'passed'); assert.equal(report.storage.availableBytes, '1000');
  assert.equal(report.temporary.status, 'passed'); assert.deepEqual(fs.readdirSync(temporaryDirectory), []);
  assert.throws(() => preflight.filesystemBoundaries({ ...f, engineSourceRoot: path.join(f.projectRoot, 'artifacts'), temporaryDirectory }), /outside selected engine/);
});
test('validated temporary directory reaches real children even without Python or Cargo consumers', async () => {
  const f = environmentFixture();
  const temporaryDirectory = path.join(f.projectRoot, 'artifacts', 'child-temporary');
  const inherited = { ...process.env, TEMP: 'inherited-external', TMP: 'inherited-external', TMPDIR: 'inherited-external' };
  const report = await preflight.environment({ ...f, temporaryDirectory }, [], { env: inherited });
  const expected = fs.realpathSync.native(temporaryDirectory);
  assert.equal(report.boundaries.temporary.status, 'passed');
  for (const variable of ['TEMP', 'TMP', 'TMPDIR']) {
    assert.equal(report.environmentPatch[variable], expected);
    assert.equal(report.env[variable], expected);
    assert.equal(inherited[variable], 'inherited-external');
  }
  const child = require('node:child_process').spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify([process.env.TEMP,process.env.TMP,process.env.TMPDIR]))'], { env: report.env, encoding: 'utf8', windowsHide: true });
  assert.equal(child.status, 0); assert.deepEqual(JSON.parse(child.stdout), [expected, expected, expected]);
});
