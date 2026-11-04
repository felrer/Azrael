'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { createResourceManager } = require('./window-use-resources.cjs');
const { createIsolationController } = require('./window-use-isolation.cjs');
const { errorPayload, fromPayload, windowError } = require('./window-control-errors.cjs');
const original = { sid:'same-user', profile:'existing-profile', parentSessionId:2, childSessionId:10, workerPid:30, workerCreated:'100', sessionAnchorPid:20, sessionAnchorCreated:'90' };
function proof(identity, previousIdentity) {
  return { ok:true, identity:{...identity}, ownershipVerified:true, inputReleased:true, admissionReady:true, available:true,
    ...(previousIdentity ? { previousIdentity:{...previousIdentity}, connectionRecovered:true } : {}),
    admission:{ scope:'child_platform_fixture', helperSha256:'a'.repeat(64), identity:{...identity}, gates:Object.fromEntries(['connection','render','keyboard','mouse','parentIdentity','dataProfile'].map(k=>[k,{passed:true}])), fixtureClosed:{passed:true} } };
}
async function fixture(t) {
  const root = path.resolve(process.env.WINDOW_CHILD_RECONNECT_TEST_ROOT || path.join(os.tmpdir(),'azrael-child-reconnect-tests'));
  await fs.mkdir(root,{recursive:true}); const directory = await fs.mkdtemp(path.join(root,'case-'));
  t.after(()=>fs.rm(directory,{recursive:true}));
  const resources = createResourceManager({directory});
  let identity = {...original}, recovery, requestRecovery, captureRecovery, allowed = true;
  const calls = [];
  const childSession = {
    describe:async()=>({environment:{parent:{sid:identity.sid,profile:identity.profile,sessionId:identity.parentSessionId}}}),
    start:async()=>proof(identity),
    acquire:async()=>{ if(recovery) { const old={...identity}; identity={...identity,...recovery}; recovery=null; return proof(identity,old); } return proof(identity); },
    ensureConnected:async()=>{ if(recovery) {const old={...identity};identity={...identity,...recovery};recovery=null;return proof(identity,old);} return proof(identity); },
    release:async()=>({ok:true,inputReleased:true}),
    request:async request=>{
      calls.push(request.operation);
      if(captureRecovery && request.operation==='capture') {
        const old={...identity};identity={...identity,...captureRecovery};captureRecovery=null;
        return {ok:false,code:'child_transport_failed',mutationOutcome:'unknown',connectionRecovered:true,connectionVerification:proof(identity,old)};
      }
      if(requestRecovery && request.operation==='input') {
        const old={...identity};identity={...identity,...requestRecovery};requestRecovery=null;
        return {ok:false,code:'child_transport_failed',mutationOutcome:'unknown',connectionRecovered:true,connectionVerification:proof(identity,old)};
      }
      if(request.operation==='launch')return {ok:true,sessionId:10,pid:40,created:'200',hwnd:'123',executable:request.executable};
      if(request.operation==='capture')return {ok:true,sessionId:10,width:80,height:60,png:'mock-png'};
      return {ok:true,sessionId:10,delivered:true};
    },
  };
  const controller=createIsolationController({resources,childSession,authorize:async()=>allowed,approveApp:async()=>true,resolveExecutable:async()=>({executable:path.resolve('approved-app.exe'),sha256:'b'.repeat(64)})});
  return {resources,controller,calls, recover:change=>{recovery=change;},recoverDuringInput:change=>{requestRecovery=change;},recoverDuringCapture:change=>{captureRecovery=change;}, revoke:()=>{allowed=false;}};
}
async function ready(f) {
  await f.controller.start({ownerId:'thread'});
  const launched=await f.controller.launch({ownerId:'thread',parentIdentity:{executable:'approved-app'}});
  const captured=await f.controller.capture({ownerId:'thread',targetId:launched.targetId});
  return captured;
}
test('lost connection rolls exact leased resource to new worker and rejects stale target before input',async t=>{
  const f=await fixture(t), captured=await ready(f);
  f.recover({workerPid:31,workerCreated:'101'});
  await assert.rejects(f.controller.input({ownerId:'thread',targetId:captured.targetId,observationId:captured.observationId,input:{kind:'text',text:'do not replay'}}),e=>e.code==='child_session_reconnected'&&e.actionExecuted===false&&e.observationRequired===true);
  assert.equal(f.calls.filter(x=>x==='input').length,0);
  const record=(await f.resources.inspect()).resources[0];
  assert.equal(record.identity.workerPid,31);assert.equal(record.leases.length,1);
  await assert.rejects(f.controller.capture({ownerId:'thread',targetId:captured.targetId}),/Unknown isolated target/);
  const next=await f.controller.launch({ownerId:'thread',parentIdentity:{executable:'approved-app'}});
  assert.ok((await f.controller.capture({ownerId:'thread',targetId:next.targetId})).observationId);
});
test('unknown input outcome remains unknown after repair and is never sent twice',async t=>{
  const f=await fixture(t), captured=await ready(f); f.recoverDuringInput({workerPid:32,workerCreated:'102'});
  await assert.rejects(f.controller.input({ownerId:'thread',targetId:captured.targetId,observationId:captured.observationId,input:{kind:'mouse',action:'down',button:'left',x:3,y:4}}),e=>e.mutationOutcome==='unknown'&&e.connectionRecovered===true&&e.observationRequired===true&&!Object.hasOwn(e,'actionExecuted'));
  assert.equal(f.calls.filter(x=>x==='input').length,1);
  assert.equal((await f.resources.inspect()).resources[0].identity.workerPid,32);
});
test('same conversation start validates connection and discards old observations after reconnect',async t=>{
  const f=await fixture(t), captured=await ready(f);f.recover({workerPid:33,workerCreated:'103'});
  assert.equal((await f.controller.start({ownerId:'thread'})).connectionRecovered,true);
  await assert.rejects(f.controller.capture({ownerId:'thread',targetId:captured.targetId}),/Unknown isolated target/);
});
test('geometry read failure repairs connection but proves planned input was not dispatched',async t=>{
  const f=await fixture(t), captured=await ready(f);f.recoverDuringCapture({workerPid:36,workerCreated:'106'});
  await assert.rejects(f.controller.input({ownerId:'thread',targetId:captured.targetId,observationId:captured.observationId,input:{kind:'text',text:'not sent'}}),e=>e.mutationOutcome==='not_executed'&&e.actionExecuted===false&&e.connectionRecovered===true);
  assert.equal(f.calls.filter(x=>x==='input').length,0);
});
test('idle resource reacquisition accepts verified same-anchor rollover',async t=>{
  const f=await fixture(t);await ready(f);await f.controller.release('thread');f.recover({workerPid:34,workerCreated:'104'});
  assert.equal((await f.controller.start({ownerId:'next-thread'})).ok,true);
  const record=(await f.resources.inspect()).resources[0];assert.equal(record.identity.workerPid,34);assert.equal(record.leases.length,1);
});
test('changed session anchor or forged prior identity cannot replace resource ownership',async t=>{
  const f=await fixture(t), reg=await f.resources.registerSession({id:'registered',workId:'thread',runId:'run',identity:original,ownershipVerified:true});
  for(const changed of [{sessionAnchorPid:21},{sessionAnchorCreated:'91'},{sid:'foreign'},{childSessionId:11}]) {
    await assert.rejects(f.resources.refreshSessionLease(reg.id,reg.lease,proof({...original,workerPid:31,workerCreated:'101',...changed},original)),/rollover/);
  }
  await assert.rejects(f.resources.refreshSessionLease(reg.id,reg.lease,proof({...original,workerPid:31,workerCreated:'101'},{...original,workerCreated:'wrong'})),/rollover/);
  assert.deepEqual((await f.resources.inspect()).resources[0].identity,original);
});
test('wrong lease and revoked authority cannot update ownership or execute input',async t=>{
  const f=await fixture(t), captured=await ready(f), record=(await f.resources.inspect()).resources[0];
  await assert.rejects(f.resources.refreshSessionLease(record.id,'wrong',proof({...original,workerPid:31,workerCreated:'101'},original)),/Exact active session lease/);
  f.recover({workerPid:35,workerCreated:'105'});f.revoke();
  await assert.rejects(f.controller.input({ownerId:'thread',targetId:captured.targetId,observationId:captured.observationId,input:{kind:'text',text:'blocked'}}),/authority/);
  assert.equal(f.calls.filter(x=>x==='input').length,0);assert.equal((await f.resources.inspect()).resources[0].identity.workerPid,30);
});
test('reconnect recovery metadata survives public error round trip',()=>{
  const payload=errorPayload(windowError('state_changed','connection repaired',{connectionRecovered:true,mutationOutcome:'unknown',observationRequired:true,recovery:'observe_again'}));
  const restored=fromPayload(payload);assert.equal(restored.connectionRecovered,true);assert.equal(restored.mutationOutcome,'unknown');assert.equal(restored.observationRequired,true);
});
