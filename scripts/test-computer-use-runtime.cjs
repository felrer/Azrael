'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {stageRuntime,verifyRuntime}=require('./computer-use-runtime.cjs');
test('generic Node runtime excludes retired Sky and skills while preserving dependencies',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'azrael-node-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true}));
 const bin=path.join(root,'source/bin');fs.mkdirSync(bin,{recursive:true});for(const name of ['node_repl.exe','node.exe'])fs.writeFileSync(path.join(bin,name),name);
 for(const name of ['@oai/sky','retained']){const dir=path.join(bin,'node_modules',name);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name,version:'1.0.0'}));}
 const result=stageRuntime({runtimeDirectory:path.dirname(bin),destination:path.join(root,'runtime')});assert.equal(result.manifest.kind,'azrael-node-repl');assert.equal(result.manifest.schema,2);assert.equal(fs.existsSync(path.join(result.directory,'skills')),false);assert.equal(fs.existsSync(path.join(result.directory,'node_modules/@oai/sky')),false);assert.equal(result.manifest.packages[0].name,'retained');assert.equal(verifyRuntime(result.directory).manifestSha256,result.manifestSha256);
 fs.writeFileSync(path.join(result.directory,'node.exe'),'corrupt');assert.throws(()=>verifyRuntime(result.directory),/hash mismatch/);
});
