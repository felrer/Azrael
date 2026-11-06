'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createHost}=require('./window-control-host.cjs');
const {createApprovalEngine,attachApprovalEngine}=require('./window-approval-engine-fixture.cjs');
const thread='12345678-1234-1234-1234-123456789abc';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){const deadline=Date.now()+2000;while(!predicate()){assert.ok(Date.now()<deadline,'fixture event did not arrive');await tick();}}
async function fixture(t,{engine=createApprovalEngine(),home,timeout=30}={}){
  const ownedHome=!home;home??=await fs.mkdtemp(path.join(process.env.WINDOW_USE_HOST_TEST_ROOT||os.tmpdir(),'async-window-approval-'));
  const approvals=require('./window-use-approvals.cjs').createOwner(home),settings=require('./use-control-settings.cjs').createSettingsOwner(home),posts=[],actions=[];
  const descriptor={hwnd:'fixture',pid:4,processCreated:'created',executable:'C:/fixture/app.exe',title:'Fixture',minimized:false,widthPx:800,heightPx:600,dpi:96};
  const host=createHost({runtime:{codexHome:home,windowControl:{},computerUse:{directory:path.join(home,'desktop')}},approvalTimeoutMs:timeout,occupancyDirectory:path.join(home,'occupancy'),approvals,
    vscode:{window:{showWarningMessage(){assert.fail('External consent modal');}}},
    backend:{async request(method){if(method==='listWindows')return [descriptor];if(['act','resize','restore'].includes(method))actions.push(method);return method==='observe'?({window:{...descriptor},observationId:"fixture-observation",frameTimestamp:"fixture-time",widthPx:descriptor.widthPx,heightPx:descriptor.heightPx,dpi:descriptor.dpi,elements:[],elementsTruncated:false,image:{mimeType:"image/png",data:"aW1hZ2U="}}):descriptor;},async dispose(){}}});
  const native={registerProvider(){return {dispose(){}};}};attachApprovalEngine(host,native,undefined,engine);
  const publish=envelope=>{posts.push(envelope);return true;};host.registerApprovalUI(native,publish);
  host.observe(native,{method:'turn/started',params:{threadId:thread,turn:{id:'one'}}});await host.threads.get(thread).ready;
  t.after(async()=>{await host.dispose();if(ownedHome)await fs.rm(home,{recursive:true});});
  let turn='one';const metadata=()=>({threadId:thread,'codex/sandbox-state-meta':{permissionProfile:{type:'disabled'}},'x-codex-turn-metadata':{thread_id:thread,turn_id:turn}});
  const call=(tool,args={})=>host.handlePipe({nonce:host.nonce,threadId:thread,method:'call',tool,arguments:args,_meta:metadata()});
  const permission=async()=>{const listed=await call('list_windows');return call('resize',{windowId:listed.candidates[0].windowId,widthDip:700,heightDip:500});};
  const cards=()=>posts.filter(value=>value.type==='mcp-request');
  const answer=(id,action='accept',persist='session')=>host.respondApproval(native,id,{action,...(action==='accept'?{content:{persist}}:{})});
  return {host,native,engine,home,approvals,settings,actions,descriptor,posts,publish,cards,call,permission,answer,
    start(id){turn=id;host.observe(native,{method:'turn/started',params:{threadId:thread,turn:{id}}});},
    complete(){host.observe(native,{method:'turn/completed',params:{threadId:thread,turn:{status:'completed'}}});},
    stop(){host.request(native,'fixture','stop','turn/interrupt',{threadId:thread,turnId:turn});}};
}

// Retained to prevent future consent refactors from detaching or replaying an actual mutation.
test('actual mutation waits for approval, accepts once, and continues without engine resume',async t=>{
  const f=await fixture(t,{timeout:1000}),waiting=f.permission();await until(()=>f.cards().length===1);const id=f.cards()[0].request.id;
  assert.deepEqual(f.actions,[]);f.answer(id);f.answer(id);assert.ok(await waiting);assert.deepEqual(f.actions,['resize']);assert.deepEqual(f.engine.resumes,[]);
  assert.equal(f.engine.calls.filter(value=>value.method==='thread/approval/resolve').length,1);
});
for(const action of ['decline','cancel'])test('actual mutation reports '+action+' without input',async t=>{
  const f=await fixture(t,{timeout:1000}),waiting=f.permission(),rejected=assert.rejects(waiting,{code:action==='decline'?'approval_denied':'cancelled',userResponded:true,actionExecuted:false});
  await until(()=>f.cards().length===1);f.answer(f.cards()[0].request.id,action);await rejected;assert.deepEqual(f.actions,[]);assert.deepEqual(f.engine.resumes,[]);
});
test('timeout is terminal, distinct from denial, and a late answer cannot grant or replay',async t=>{
  const f=await fixture(t),waiting=f.permission(),rejected=assert.rejects(waiting,{code:'approval_timeout',approvalState:'expired',userResponded:false,actionExecuted:false});
  await until(()=>f.cards().length===1);const id=f.cards()[0].request.id;await rejected;f.answer(id);await tick();assert.deepEqual(f.actions,[]);assert.deepEqual(f.engine.resumes,[]);assert.equal(f.approvals.hasAppApproval(f.descriptor.executable,thread),false);
});
test('approval deadline starts after successful delivery',async t=>{
  const f=await fixture(t);let release;const gate=new Promise(resolve=>release=resolve);f.host.registerApprovalUI(f.native,envelope=>{f.posts.push(envelope);return envelope.type==='mcp-request'?gate:true;});
  let settled=false;const waiting=f.permission();waiting.then(()=>settled=true,()=>settled=true);const rejected=assert.rejects(waiting,{code:'approval_timeout'});await until(()=>f.cards().length===1);await new Promise(resolve=>setTimeout(resolve,45));assert.equal(settled,false);release(true);await rejected;assert.deepEqual(f.actions,[]);
});
for(const ending of ['stop','policy','thread/closed','thread/archived','thread/deleted'])test(ending+' cancels automatic approval and blocks late answers',async t=>{
  const f=await fixture(t,{timeout:1000}),waiting=f.permission(),rejected=assert.rejects(waiting);await until(()=>f.cards().length===1);const id=f.cards()[0].request.id;
  if(ending==='stop')f.stop();else if(ending==='policy')f.settings.updateSettings({windowUseEnabled:false},f.settings.getSettings().revision);else f.host.observe(f.native,{method:ending,params:{threadId:thread}});
  f.answer(id);await rejected;assert.deepEqual(f.actions,[]);assert.deepEqual(f.engine.resumes,[]);assert.equal(f.approvals.hasAppApproval(f.descriptor.executable,thread),false);
});
test('changed process identity after approval prevents the waiting mutation',async t=>{
  const f=await fixture(t,{timeout:1000}),waiting=f.permission(),rejected=assert.rejects(waiting);await until(()=>f.cards().length===1);f.descriptor.processCreated='replacement';f.answer(f.cards()[0].request.id);await rejected;assert.deepEqual(f.actions,[]);
});
test('resolve transport failure reports an observed response without executing input',async t=>{
  const engine=createApprovalEngine({beforeResolve(){throw Error('Fixture transport failed');}}),f=await fixture(t,{engine,timeout:1000}),waiting=f.permission(),rejected=assert.rejects(waiting,{code:'connection_error',userResponded:true,actionExecuted:false});await until(()=>f.cards().length===1);f.answer(f.cards()[0].request.id);await rejected;assert.deepEqual(f.actions,[]);assert.deepEqual(engine.resumes,[]);
});
