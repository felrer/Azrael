'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs/promises'), os=require('node:os'), path=require('node:path');
const {createWindowOwner}=require('./window-control-policy.cjs');

// Preserve the image/stage boundary when future edits share semantic and virtual tool dispatch.
test('virtual input uses image capture, exact identity, stage2 and cancellable lifecycle',async t=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'window-virtual-policy-'));
  const w={hwnd:'101',pid:4,processCreated:'123',executable:'test.exe',title:'Selected',minimized:false,widthPx:800,heightPx:600,dpi:96};
  let stage2=true, sequence=0, inputs=0, releases=0, beforeInput, failRelease=false, cleanupErrors=0;
  const owner=createWindowOwner({codexHome:home,onOverlayError:()=>cleanupErrors++,authorize:async(_w,_thread,operation)=>operation.stage===1 || stage2,
    backend:{async request(method){if(method==='listWindows')return [w];if(['observe','inspect'].includes(method))return {window:w,observationId:'o'+ ++sequence,frameTimestamp:'now',widthPx:800,heightPx:600,dpi:96,elements:[],elementsTruncated:false,image:{mimeType:'image/png',data:'YQ=='}};return {window:w};}},
    virtualInput:{async input(thread,identity,input,guard){assert.equal(thread,'thread');assert.deepEqual(identity,w);assert.deepEqual(input,{kind:'key',virtualKey:65,action:'down'});if(beforeInput)await beforeInput();await guard();inputs++;return {delivered:true,private:'never returned'};},async release(){releases++;if(failRelease)throw new Error('detach unverified');return {detached:true};}}
  });
  t.after(async()=>{await owner.dispose();await fs.rm(home,{recursive:true});});
  let target=await owner.bind('thread',w);
  const capture=()=>owner.call('thread','capture',{targetId:target.targetId});
  const input=observation=>owner.call('thread','virtual_input',{targetId:target.targetId,observationId:observation.observationId,input:{kind:'key',virtualKey:65,action:'down'}});
  let image=await capture();assert.equal(inputs,0);assert.equal(releases,0);
  const inspected=await owner.call('thread','inspect',{targetId:target.targetId});await assert.rejects(input(inspected),/Fresh image/);
  image=await capture();const result=await input(image);assert.equal(result.delivery,'virtualInput');assert.equal(result.verified,false);assert.equal(result.private,undefined);assert.equal(inputs,1);
  await assert.rejects(input(image),/Fresh image/);
  image=await capture();stage2=false;await assert.rejects(input(image),{code:'permission_denied'});assert.equal(inputs,1);
  stage2=true;target=await owner.bind('thread',w);image=await capture();
  beforeInput=async()=>owner.stop('thread');await assert.rejects(input(image));assert.equal(inputs,1);beforeInput=undefined;
  const detached=await owner.call('thread','release_virtual_input',{targetId:target.targetId});assert.equal(detached.detached,true);assert.equal(detached.pauseReason,'user_stopped');assert.ok(releases>=1);
  await assert.rejects(owner.call('thread','release_virtual_input',{targetId:'forged'}),/forged/);
  const previous=releases;target=await owner.bind('thread',w);assert.ok(releases>previous);
  image=await capture();owner.invalidateObservation('thread');await assert.rejects(input(image),/Fresh image/);assert.equal(inputs,1);
  failRelease=true;owner.stop('thread');
  await assert.rejects(owner.call('thread','release_virtual_input',{targetId:target.targetId}),/detach unverified/);
  await assert.rejects(owner.bind('thread',w),/detach unverified/);assert.equal(inputs,1);assert.ok(cleanupErrors>0);
  failRelease=false;
});

// A future dispatch merge must not bypass image/stage/stop gates for the shared-input backend.
test('switched input preserves fresh-image authority, native result and stop cleanup',async t=>{
  const {beginArtifactRun}=require('./artifact-run.cjs');
  const run=beginArtifactRun(path.resolve(__dirname,'..'),{workId:'EZ01',owner:'EZ-01-window-use-multipointer-review',runId:'coop-policy-'+require('node:crypto').randomUUID()});
  const w={hwnd:'101',pid:4,processCreated:'123',executable:'test.exe',title:'Selected',minimized:false,widthPx:800,heightPx:600,dpi:96};
  let allowed=true,seq=0,inputs=0,releases=0,stageArgs;
  const owner=createWindowOwner({codexHome:run.temporary,authorize:async(_w,_t,op)=>op.stage===1||allowed,
    requestStage:async(_t,args)=>{stageArgs=args;return {authorized:true};},
    backend:{async request(method){if(method==='listWindows')return [w];if(['observe','inspect'].includes(method))return {window:w,observationId:'s'+ ++seq,frameTimestamp:'now',widthPx:800,heightPx:600,dpi:96,elements:[],elementsTruncated:false,image:{mimeType:'image/png',data:'YQ=='}};return {window:w};}},
    switchedInput:{async input(thread,identity,input,guard){await guard();assert.equal(thread,'thread');assert.deepEqual(identity,w);assert.deepEqual(input,{action:'press',keys:[65],operationId:7,x:10,y:20});inputs++;return {operationId:7,collaboration:{enabled:true},appEffectVerified:false};},async release(){releases++;return {detached:true};}}
  });
  t.after(()=>owner.dispose());
  const selected=await owner.bind('thread',w),base={targetId:selected.targetId};
  await owner.call('thread','request_stage',{...base,stage:2,reason:'mouse collaboration',switchedInput:true});assert.equal(stageArgs.switchedInput,true);
  await assert.rejects(owner.call('thread','request_stage',{...base,stage:2,reason:'ambiguous',switchedInput:true,virtualInput:true}));
  const send=image=>owner.call('thread','switched_input',{...base,observationId:image.observationId,input:{action:'press',keys:[65],operationId:7,x:10,y:20}});
  const inspected=await owner.call('thread','inspect',base);await assert.rejects(send(inspected),/Fresh image/);assert.equal(inputs,0);
  const image=await owner.call('thread','capture',base),result=await send(image);assert.equal(result.delivery,'switchedInput');assert.equal(result.verified,false);assert.equal(result.inputResult.operationId,7);assert.equal(result.inputResult.collaboration.enabled,true);
  await assert.rejects(send(image),/Fresh image/);assert.equal(inputs,1);
  const next=await owner.call('thread','capture',base);allowed=false;await assert.rejects(send(next),{code:'permission_denied'});assert.equal(inputs,1);allowed=true;
  owner.stop('thread');const released=await owner.call('thread','release_switched_input',base);assert.equal(released.detached,true);assert.equal(released.pauseReason,'user_stopped');assert.ok(releases>0);
  await assert.rejects(owner.call('thread','release_switched_input',{targetId:'forged'}),/forged/);
});
