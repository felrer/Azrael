'use strict';
// Retained: public target routing and idle completion semantics are easy to lose
// when adding tools or moving execution across the global physical-input queue.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {fork}=require('node:child_process');
const {once}=require('node:events');
const {createWindowOwner, TOOLS} = require('./window-control-policy.cjs');
const {createLeaseCoordinator} = require('./window-control-occupancy.cjs');
const window = {hwnd:'101',pid:4,processCreated:'123',executable:'C:\\Apps\\test.exe',title:'Test',minimized:false,widthPx:800,heightPx:600,dpi:96};
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'window-request-targets-'));
  const disposals=[];
  t.after(async()=>{for(const dispose of disposals)await dispose();fs.rmSync(root,{recursive:true});});
  let clock=1000;
  const directory=path.join(root,'occupancy');
  return {root,directory,now:()=>clock,tick:n=>{clock+=n;},owner(extra={}){
    let count=0;
    const owner=createWindowOwner({codexHome:root,occupancyDirectory:directory,now:()=>clock,authorize:async()=>true,leaseWaitMs:0,
      backend:{request:async(method,params)=>method==='listWindows'?[window,{...window,hwnd:'102'}]:method==='inspect'?{window:params.window,observationId:'obs-'+(++count),elementsTruncated:false,elements:[{id:'e',name:'Button',controlType:'Button'}]}:params.window},...extra});
    disposals.push(()=>owner.dispose());return owner;
  }};
}
if(process.argv[2]!=='lease-child') {
test('atomic leases expire at exactly 30s idle after completion and never during a long request',t=>{
  const f=fixture(t),a=createLeaseCoordinator({directory:f.directory,now:f.now}),b=createLeaseCoordinator({directory:f.directory,now:f.now});
  const first=a.begin(window,'a',true),epoch=first.epoch;
  f.tick(60000);assert.throws(()=>b.begin(window,'b',true),e=>e.code==='window_busy'&&e.actionExecuted===false);
  first.complete();f.tick(29999);assert.throws(()=>b.begin(window,'b',true),e=>e.code==='window_busy');
  // An owner's observation pins the lease and completion resets its idle clock.
  const read=a.begin(window,'a',false);f.tick(50000);assert.throws(()=>b.begin(window,'b',true),e=>e.code==='window_busy');read.complete();
  f.tick(30000);const next=b.begin(window,'b',true);assert.notEqual(next.epoch,epoch);next.complete();
});
test('public IDs remain stable, route independent observations, reject forged/implicit targets and expire stale observations',async t=>{
  const f=fixture(t),a=f.owner(),b=f.owner();
  assert.equal(TOOLS.includes('select_window'),false);
  const listed=await a.call('a','list_windows',{}),[one,two]=listed.candidates.map(c=>c.windowId);
  assert.deepEqual((await a.call('a','list_windows',{})).candidates.map(c=>c.windowId),[one,two]);
  await assert.rejects(a.call('a','status',{}));await assert.rejects(a.call('a','status',{windowId:'forged'}));await assert.rejects(b.call('b','status',{windowId:one}));
  const observed=await a.call('a','inspect',{windowId:one});
  await a.call('a','inspect',{windowId:two});
  await a.call('a','invoke',{windowId:one,observationId:observed.observationId,elementId:'e'});
  const fresh=await a.call('a','inspect',{windowId:one});f.tick(30000);
  await assert.rejects(a.call('a','invoke',{windowId:one,observationId:fresh.observationId,elementId:'e'}),/Fresh/);
  assert.equal(Object.hasOwn(observed,'targetId'),false);
});
test('competitor observations cannot mutate on acquisition, and cancellation interrupts a waiting lease',async t=>{
  const f=fixture(t);let cancelled=false;
  const a=f.owner(),b=f.owner({leaseWaitMs:30000,isCancelled:()=>cancelled});
  const one=(await a.call('a','list_windows',{})).candidates[0].windowId;
  const obs=await a.call('a','inspect',{windowId:one});await a.call('a','invoke',{windowId:one,observationId:obs.observationId,elementId:'e'});
  const other=(await b.call('b','list_windows',{})).candidates[0].windowId;
  const foreign=await b.call('b','inspect',{windowId:other});
  const waiting=b.call('b','invoke',{windowId:other,observationId:foreign.observationId,elementId:'e'});
  cancelled=true;await assert.rejects(waiting,/cancelled/);cancelled=false;f.tick(30000);
  await assert.rejects(b.call('b','invoke',{windowId:other,observationId:foreign.observationId,elementId:'e'}),/Fresh/);
  const fresh=await b.call('b','inspect',{windowId:other});await b.call('b','invoke',{windowId:other,observationId:fresh.observationId,elementId:'e'});
});

test('lifecycle cleanup pins execution without renewing the last actual request completion',async t=>{
  const f=fixture(t);let finish,started,block=false;
  const owner=f.owner({releaseDesktopInput:()=>block?new Promise(resolve=>{finish=resolve;started();}):Promise.resolve()});
  const competitor=createLeaseCoordinator({directory:path.join(f.directory,'claims'),now:f.now});
  await owner.withWindowLease('lifecycle',window,async()=>{});
  f.tick(10000);owner.invalidateObservation('lifecycle');
  await new Promise(resolve=>setImmediate(resolve));
  f.tick(20000);
  const next=competitor.begin(window,'competitor',true);next.complete();competitor.releaseSession('competitor');
  await owner.withWindowLease('lifecycle',window,async()=>{});
  f.tick(10000);block=true;
  const began=new Promise(resolve=>{started=resolve;});owner.invalidateObservation('lifecycle');await began;
  f.tick(50000);assert.throws(()=>competitor.begin(window,'competitor',true),e=>e.code==='window_busy');
  block=false;finish();await new Promise(resolve=>setImmediate(resolve));
  const afterCleanup=competitor.begin(window,'competitor',true);afterCleanup.complete();competitor.dispose();
});
test('desktop-only Stop keeps its lease pinned until input release completes',async t=>{
  const f=fixture(t);let finish,started;
  const began=new Promise(resolve=>{started=resolve;});
  let first=true;
  const owner=f.owner({releaseDesktopInput:()=>{if(!first)return Promise.resolve();first=false;started();return new Promise(resolve=>{finish=resolve;});}});
  const competitor=createLeaseCoordinator({directory:path.join(f.directory,'claims'),now:f.now});
  await owner.withWindowLease('desktop',window,async()=>{});
  owner.stop('desktop');await began;f.tick(60000);
  assert.throws(()=>competitor.begin(window,'competitor',true),e=>e.code==='window_busy');
  finish();await owner.dispose();
  const next=competitor.begin(window,'competitor',true);next.complete();competitor.dispose();
});
test('separate processes arbitrate window leases and physical input atomically',async t=>{
  const f=fixture(t),local=createLeaseCoordinator({directory:f.directory,now:f.now});
  const child=fork(__filename,['lease-child',f.directory],{stdio:['ignore','ignore','pipe','ipc']});
  await once(child,'message');
  const command=async action=>{const received=once(child,'message');child.send(action);const [reply]=await received;assert.equal(reply.ok,true,reply.error);};
  try {
    await command('begin');f.tick(60000);
    assert.throws(()=>local.begin(window,'parent',true),e=>e.code==='window_busy');
    await command('complete');f.tick(30000);
    const acquired=local.begin(window,'parent',true);acquired.complete();
    await command('action');assert.throws(()=>local.beginAction(),e=>e.code==='window_busy');
    await command('releaseAction');local.beginAction()();
  } finally {const exited=once(child,'exit');child.send('exit');await exited;}
});
} else {
  let clock=1000,lease,finish;
  const coordinator=createLeaseCoordinator({directory:process.argv[3],now:()=>clock});
  process.on('message',action=>{
    try {
      if(action==='begin')lease=coordinator.begin(window,'child',true);
      if(action==='complete'){clock+=60000;lease.complete();}
      if(action==='action')finish=coordinator.beginAction();
      if(action==='releaseAction'){finish();finish=null;}
      if(action==='exit'){finish?.();coordinator.dispose();process.exit(0);}
      process.send({ok:true});
    }catch(error){process.send({ok:false,error:error.message});}
  });
  process.send({ready:true});
}
