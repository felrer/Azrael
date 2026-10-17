'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const platform=require('./platform-runtime.cjs');
const source=fs.readFileSync(path.join(__dirname,'ordinary-runtime.cjs'),'utf8');
function load(nodeExecutable, extra = {}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'azrael-node-runtime-'));
  const filename=path.join(root,'azrael-runtime.cjs');fs.writeFileSync(filename,source);
  const config={schema:1,platform:platform.platformIdentity(),engine:process.execPath,bridge:process.execPath,
    engineVersion:'0.162.0',codexHome:path.join(root,'state'), ...extra};
  if(nodeExecutable!==undefined)config.nodeExecutable=nodeExecutable;
  fs.writeFileSync(path.join(root,'azrael-runtime.json'),JSON.stringify(config));
  try{
    const module={exports:{}};
    vm.runInNewContext(source,{__filename:filename,__dirname:root,module,exports:module.exports,process,
      require(name){
        if(name==='./platform-runtime.cjs')return platform;
        if(name==='./shared-engine-host.cjs')return require('./shared-engine-host.cjs');
        if(['./devin-native-host.cjs','./provider-accounts-host.cjs'].includes(name))return {configureEnvironment(){}};
        return require(name);
      }});
    return module.exports.runtime;
  }finally{fs.rmSync(root,{recursive:true});}
}
test('explicit Node executable is accepted',()=>assert.equal(load(process.execPath).nodeExecutable,process.execPath));
test('Node directory is rejected before host activation',()=>assert.throws(()=>load(path.dirname(process.execPath)),/not a file/));
test('missing Node executable is rejected before host activation',()=>assert.throws(()=>load(path.join(os.tmpdir(),'azrael-no-such-node-'+process.pid)),/ENOENT/));
test('runtime without explicit Node retains its existing desktop fallback',()=>assert.equal(load(undefined).nodeExecutable,undefined));

test('shared runtime awaits native release endpoint and preserves unrelated environment',()=>{
  const before=process.env.AZRAEL_EX_MANAGEMENT_SOCKET;
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'azrael-shared-home-'));
  try {
  const extra={sharedEngine:true,sharedEngineProtocol:2,engineSha256:'a'.repeat(64),codexHome:home};
  const first=load(undefined,extra);
  const second=load(undefined,extra);
  assert.equal(first.socket,second.socket);
  assert.equal(first.socket,undefined);
  assert.equal(first.env.AZRAEL_EX_MANAGEMENT_SOCKET,undefined);
  first.socket=path.join(home,'release-instance','control.sock');
  assert.equal(first.socket,path.join(home,'release-instance','control.sock'));
  const other={...extra}; delete other.codexHome;
  assert.equal(load(undefined,other).socket,undefined);
  assert.equal(process.env.AZRAEL_EX_MANAGEMENT_SOCKET,before);
  } finally { fs.rmSync(home,{recursive:true}); }
});
test('shared runtime rejects a missing receipt identity',()=>assert.throws(()=>load(undefined,{sharedEngine:true}),/immutable build receipt/));
test('shared runtime rejects a protocol 1 manifest',()=>assert.throws(()=>load(undefined,{sharedEngine:true,sharedEngineProtocol:1,engineSha256:'a'.repeat(64)}),/protocol 2/));

function workerFixture(t, extra = {}, providerTail = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-runtime-worker-'));
  const filename = path.join(root, 'ordinary-runtime.cjs');
  t.after(() => { delete require.cache[filename]; fs.rmSync(root, { recursive: true }); });
  for (const name of ['ordinary-runtime.cjs', 'platform-runtime.cjs', 'azrael-platforms.json',
    'devin-native-host.cjs', 'provider-accounts-host.cjs', 'shared-engine-host.cjs']) {
    fs.copyFileSync(path.join(__dirname, name), path.join(root, name));
  }
  if (providerTail) fs.appendFileSync(path.join(root, 'provider-accounts-host.cjs'), providerTail);
  const config = { schema: 1, platform: platform.platformIdentity(), engine: process.execPath,
    bridge: process.execPath, engineVersion: '0.162.0', codexHome: path.join(root, 'state'), ...extra };
  const configFile = path.join(root, 'azrael-runtime.json');
  fs.writeFileSync(configFile, JSON.stringify(config));
  return { root, filename, configFile, config, api: require(filename) };
}

test('worker validation coalesces, keeps the event loop responsive and publishes scoped state only on success', async t => {
  const before = { ...process.env };
  const fixture = workerFixture(t, {}, `
    const configure = module.exports.configureEnvironment;
    module.exports.configureEnvironment = (env, config) => {
      require('node:fs').appendFileSync(require('node:path').join(__dirname, 'validations'), '1');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
      return configure(env, config);
    };
  `);
  delete require.cache[fixture.filename];
  assert.equal(require(fixture.filename), fixture.api, 'physical runtime registry survives module aliases/reloads');
  if (process.platform === 'win32') {
    const alias = fixture.filename[0].toLowerCase() + fixture.filename.slice(1);
    assert.equal(require(alias), fixture.api);
  }
  let timerRan = false;
  const timer = setTimeout(() => { timerRan = true; }, 0);
  const first = fixture.api.initialize();
  assert.equal(fixture.api.initialize(), first);
  assert.throws(() => fixture.api.runtime, /still pending/);
  assert.throws(() => fixture.api.process, /still pending/);
  const runtime = await first;
  clearTimeout(timer);
  assert.equal(timerRan, true, 'main event loop advances during synchronous worker validation');
  assert.equal(fs.readFileSync(path.join(fixture.root, 'validations'), 'utf8'), '1');
  assert.equal(runtime, fixture.api.runtime);
  assert.equal(await fixture.api.initialize(), runtime);
  assert.equal(fixture.api.process.env, runtime.env);
  assert.equal(runtime.env.CODEX_HOME, fixture.config.codexHome);
  assert.equal(runtime.env.AZRAEL_EX_PLAINTEXT_AGENTS, '1');
  assert.deepEqual({ ...process.env }, before);
});

test('real worker rejects invalid configuration without publishing it and retries after repair', async t => {
  const fixture = workerFixture(t, { nodeExecutable: path.join(os.tmpdir(), 'azrael-missing-worker-node-' + process.pid) });
  const first = fixture.api.initialize();
  assert.equal(fixture.api.initialize(), first);
  await assert.rejects(first, /ENOENT/);
  assert.throws(() => fixture.api.runtime, /ENOENT/);
  fixture.config.nodeExecutable = process.execPath;
  fs.writeFileSync(fixture.configFile, JSON.stringify(fixture.config));
  const runtime = await fixture.api.initialize();
  assert.equal(runtime.nodeExecutable, process.execPath);
  assert.equal(fixture.api.runtime, runtime);
});

for (const code of [0, 7]) {
  test(`worker premature exit ${code} cannot publish an unvalidated runtime`, async t => {
    const fixture = workerFixture(t, {}, `\nprocess.exit(${code});\n`);
    await assert.rejects(fixture.api.initialize(), code === 0 ? /without a result/ : /code 7/);
  });
}
