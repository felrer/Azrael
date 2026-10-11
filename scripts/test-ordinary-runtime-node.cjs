'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const platform=require('./platform-runtime.cjs');
const source=fs.readFileSync(path.join(__dirname,'ordinary-runtime.cjs'),'utf8');
function load(nodeExecutable){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'azrael-node-runtime-'));
  const filename=path.join(root,'azrael-runtime.cjs');fs.writeFileSync(filename,source);
  const config={schema:1,platform:platform.platformIdentity(),engine:process.execPath,bridge:process.execPath,
    engineVersion:'0.162.0',codexHome:path.join(root,'state')};
  if(nodeExecutable!==undefined)config.nodeExecutable=nodeExecutable;
  fs.writeFileSync(path.join(root,'azrael-runtime.json'),JSON.stringify(config));
  try{
    const module={exports:{}};
    vm.runInNewContext(source,{__filename:filename,__dirname:root,module,exports:module.exports,process,
      require(name){
        if(name==='./platform-runtime.cjs')return platform;
        if(['./devin-native-host.cjs','./provider-accounts-host.cjs'].includes(name))return {configureEnvironment(){}};
        return require(name);
      }});
    return module.exports.runtime;
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('explicit Node executable is accepted',()=>assert.equal(load(process.execPath).nodeExecutable,process.execPath));
test('Node directory is rejected before host activation',()=>assert.throws(()=>load(path.dirname(process.execPath)),/not a file/));
test('missing Node executable is rejected before host activation',()=>assert.throws(()=>load(path.join(os.tmpdir(),'azrael-no-such-node-'+process.pid)),/ENOENT/));
test('runtime without explicit Node retains its existing desktop fallback',()=>assert.equal(load(undefined).nodeExecutable,undefined));
