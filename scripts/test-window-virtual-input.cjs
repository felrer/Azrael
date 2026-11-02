'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const {createHash}=require('node:crypto');
const {beginArtifactRun}=require('./artifact-run.cjs');
const {validateInput,identity,verifyVirtualRuntime,createVirtualInputProvider}=require('./window-virtual-input.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const target={hwnd:'1234',pid:123,processCreated:'abcd',executable:'C:\\Fixture\\fixture.exe'};
function fakeBroker(options={}) {
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.commands=[];
  child.stdin=new Writable({write(data,enc,done){
    const request=JSON.parse(data);child.commands.push(request);
    queueMicrotask(()=>{
      if(options.hold===request.method)return;
      const result=request.method==='attach'?{attached:true}:{delivered:true};
      child.stdout.write(JSON.stringify(options.nullReply ? null : {id:options.wrongId?'wrong':request.id,result})+'\n');
    });done();
  },final(done){done();queueMicrotask(()=>{child.emit('close',options.exitCode??0,null);});}});
  return child;
}
function provider(child,overrides={}) {
  return createVirtualInputProvider({directory:'fixture',manifestSha256:'a'.repeat(64)},
    {platform:'win32',arch:'x64',verify:()=>({executable:'fixture.exe',manifestSha256:'a'.repeat(64)}),spawnChild:()=>child,timeoutMs:60,closeMs:80,...overrides});
}
test('virtual packets preserve Unicode, reject malformed states and Windows keys',()=>{
  assert.deepEqual(validateInput({kind:'text',text:'가😀'}),{kind:'text',text:'가😀'});
  assert.equal(validateInput({kind:'text',text:'가'.repeat(2047)}).text.length,2047);
  for(const packet of [{kind:'text',text:'\ud800'},{kind:'text',text:'\u0000'},{kind:'key',virtualKey:0x5b,action:'down'},
    {kind:'mouse',action:'move',x:1},{kind:'mouse',action:'up',button:'left',delta:1},{kind:'mouse',action:'wheel',delta:0},
    {kind:'text',text:'x'.repeat(2048)},{kind:'text',text:'😀'.repeat(1024)},{kind:'text',text:'x',pid:3}]) assert.throws(()=>validateInput(packet));
  assert.throws(()=>identity({...target,hwnd:'0'}));
});
test('construction and cleanup do not attach; explicit input binds only immutable target',async()=>{
  const child=fakeBroker(),p=provider(child);assert.equal(child.commands.length,0);
  let checks=0;
  const result=await p.input('thread',{...target,title:'not serialized'}, {kind:'text',text:'hello'},async()=>{checks++;});
  assert.deepEqual(child.commands.map(r=>r.method),['attach','input']);
  assert.deepEqual(child.commands[0].params.window,target);assert.ok(checks>=3);assert.equal(result.verified,false);
  assert.equal(result.delivery,'virtualInput');await p.release('thread');await p.dispose();
});
test('revocation after DLL attach prevents the first input',async()=>{
  const child=fakeBroker(),p=provider(child);let calls=0;
  await assert.rejects(p.input('t',target,{kind:'text',text:'no'},async()=>{if(++calls===2)throw new Error('revoked');}),/revoked/);
  assert.deepEqual(child.commands.map(r=>r.method),['attach']);await p.dispose();
});
test('uncorrelated replies and timeouts poison the provider without replay',async()=>{
  for(const options of [{wrongId:true},{nullReply:true},{hold:'input'}]) {
    const child=fakeBroker(options),p=provider(child);let spawns=0;
    await assert.rejects(p.input('t',target,{kind:'text',text:'one'}),error=>error.mutationOutcome==='unknown');
    assert.ok(child.commands.filter(r=>r.method==='input').length<=1);
    await p.dispose();
  }
});
test('incomplete detach remains an error, not successful cleanup',async()=>{
  const child=fakeBroker({exitCode:1}),p=provider(child);
  await p.input('t',target,{kind:'text',text:'x'});
  await assert.rejects(p.release('t'),/unverified/);await assert.rejects(p.dispose(),/unverified/);
});
test('runtime declaration cannot redirect or accept a changed payload',()=>{
  const run=beginArtifactRun(path.resolve(__dirname,'..'),{workId:'EZ-01-window-use-multipointer-review',owner:'EZ-01-window-use-multipointer-review',runId:'virtual-provider-'+Date.now()});
  const directory=path.join(run.temporary,'runtime');fs.mkdirSync(directory);
  const files=['azrael-virtual-input.exe','azrael-virtual-input-hook.dll','THIRD_PARTY_NOTICES.md'].map(name=>{const bytes=Buffer.from('owned-fixture '+name);fs.writeFileSync(path.join(directory,name),bytes);return {path:name,bytes:bytes.length,sha256:sha(bytes)};});
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({schema:1,kind:'azrael-virtual-input',platform:'win32',arch:'x64',sourceSha256:'b'.repeat(64),files}));
  assert.equal(verifyVirtualRuntime(directory).sourceSha256,'b'.repeat(64));
  fs.writeFileSync(path.join(directory,'azrael-virtual-input-hook.dll'),'changed');
  assert.throws(()=>verifyVirtualRuntime(directory),/hash mismatch/);
});
