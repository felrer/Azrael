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

test('shared runtime uses a deterministic home endpoint and preserves unrelated environment',()=>{
  const before=process.env.AZRAEL_EX_MANAGEMENT_SOCKET;
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'azrael-shared-home-'));
  try {
  const extra={sharedEngine:true,sharedEngineProtocol:1,engineSha256:'a'.repeat(64),codexHome:home};
  const first=load(undefined,extra);
  const second=load(undefined,extra);
  assert.equal(first.socket,second.socket);
  assert.equal(first.socket,path.join(first.codexHome,'app-server-control','app-server-control.sock'));
  const other={...extra}; delete other.codexHome;
  assert.notEqual(load(undefined,other).socket,first.socket);
  assert.equal(process.env.AZRAEL_EX_MANAGEMENT_SOCKET,before);
  } finally { fs.rmSync(home,{recursive:true}); }
});
test('shared runtime rejects a missing receipt identity',()=>assert.throws(()=>load(undefined,{sharedEngine:true}),/immutable build receipt/));
