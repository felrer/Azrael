'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createHost}=require('./window-control-host.cjs');
const {createApprovalEngine,attachApprovalEngine}=require('./window-approval-engine-fixture.cjs');
const thread='12345678-1234-1234-1234-123456789abc';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){const deadline=Date.now()+2000;while(!predicate()){assert.ok(Date.now()<deadline,'fixture event did not arrive');await tick();}}
async function fixture(t,{engine=createApprovalEngine(),home,timeout=30}={}){
  const ownedHome=!home;home??=await fs.mkdtemp(path.join(os.tmpdir(),'async-window-approval-'));
  const approvals=require('./window-use-approvals.cjs').createOwner(home),settings=require('./use-control-settings.cjs').createSettingsOwner(home),posts=[],actions=[];
  const descriptor={hwnd:'fixture',pid:4,processCreated:'created',executable:'C:/fixture/app.exe',title:'Fixture',minimized:false,widthPx:800,heightPx:600,dpi:96};
  const host=createHost({runtime:{codexHome:home,windowControl:{},computerUse:{directory:path.join(home,'desktop')}},approvalTimeoutMs:timeout,occupancyDirectory:path.join(home,'occupancy'),approvals,
    vscode:{window:{showWarningMessage(){assert.fail('External consent modal');}}},
    backend:{async request(method){if(method==='listWindows')return [descriptor];actions.push(method);return descriptor;},async dispose(){}}});
  const native={registerProvider(){return {dispose(){}};}};attachApprovalEngine(host,native,undefined,engine);
  const publish=envelope=>{posts.push(envelope);return true;};host.registerApprovalUI(native,publish);
  host.observe(native,{method:'turn/started',params:{threadId:thread,turn:{id:'one'}}});await host.threads.get(thread).ready;
  t.after(async()=>{await host.dispose();if(ownedHome)await fs.rm(home,{recursive:true});});
  let turn='one';const metadata=()=>({threadId:thread,'codex/sandbox-state-meta':{permissionProfile:{type:'disabled'}},'x-codex-turn-metadata':{thread_id:thread,turn_id:turn}});
  const call=(tool,args={})=>host.handlePipe({nonce:host.nonce,threadId:thread,method:'call',tool,arguments:args,_meta:metadata()});
  const stage=()=>call('request_stage',{stage:4,reason:'Perform the explicitly requested fixture task'});
  const cards=()=>posts.filter(value=>value.type==='mcp-request');
  const answer=(id,action='accept',persist='session')=>host.respondApproval(native,id,{action,...(action==='accept'?{content:{persist}}:{})});
  return {host,native,engine,home,approvals,settings,actions,descriptor,posts,publish,cards,call,stage,answer,
    start(id){turn=id;host.observe(native,{method:'turn/started',params:{threadId:thread,turn:{id}}});},
    complete(){host.observe(native,{method:'turn/completed',params:{threadId:thread,turn:{status:'completed'}}});},
    stop(){host.request(native,'fixture','stop','turn/interrupt',{threadId:thread,turnId:turn});}};
}
const pending=error=>error.code==='permission_pending'&&error.approvalState==='pending'&&error.actionExecuted===false&&/^azrael-window-consent-/.test(error.approvalRequestId);

test('fast approval records the offered decision once and executes no action before approval',async t=>{
  const f=await fixture(t),waiting=f.stage();await until(()=>f.cards().length===1);const id=f.cards()[0].request.id;
  assert.deepEqual(f.actions,[]);await assert.rejects(f.host.handlePipe({nonce:f.host.nonce,threadId:thread,method:'desktop_authority',_meta:{'codex/sandbox-state-meta':{permissionProfile:{type:'disabled'}},'x-codex-turn-metadata':{thread_id:thread,turn_id:'one'}}}),{code:'permission_denied'});
  f.answer(id);f.answer(id);assert.equal((await waiting).authorized,true);
  assert.equal(f.engine.calls.filter(value=>value.method==='thread/approval/resolve').length,1);assert.deepEqual(f.engine.resumes,[]);
});

test('30ms pending survives ordinary turn completion; late accept resumes once and a fresh call consumes the receipt',async t=>{
  const f=await fixture(t);await assert.rejects(f.stage(),pending);const id=f.cards()[0].request.id;
  assert.equal(f.posts.some(value=>value.notification?.params?.requestId===id),false,'pending card stays visible');assert.deepEqual(f.actions,[]);
  f.complete();f.answer(id);f.answer(id);await until(()=>f.engine.resumes.length===1);await until(()=>f.engine.records.get(id).state==='accepted');
  f.start('resumed');assert.equal((await f.stage()).authorized,true);assert.equal(f.cards().length,1,'fresh same-scope call does not prompt again');
  assert.equal(f.engine.calls.filter(value=>value.method==='thread/approval/resolve').length,1,'late double click resolves only once');
});

test('same-scope pending requests coalesce without replacing their ledger identity or grace timer',async t=>{
  const f=await fixture(t);await assert.rejects(f.stage(),pending);const id=f.cards()[0].request.id;
  const scheduled=[],realTimeout=global.setTimeout;t.mock.method(global,'setTimeout',(fn,ms,...args)=>{scheduled.push(ms);return realTimeout(fn,ms,...args);});
  await assert.rejects(f.stage(),error=>pending(error)&&error.approvalRequestId===id);
  assert.equal(f.engine.calls.filter(value=>value.method==='thread/approval/request').length,1);
  assert.equal(f.engine.records.get(id).waiterDetached,true,'coalesced requests reuse the already detached ledger entry');
  assert.equal(scheduled.includes(30),false,'coalescing never starts another synchronous grace timer');
  f.answer(id,'decline');await until(()=>f.engine.records.get(id).state==='declined');assert.deepEqual(f.actions,[]);
});

test('the 30ms synchronous grace begins only after UI delivery succeeds',async t=>{
  const f=await fixture(t);let release;const delivered=new Promise(resolve=>release=resolve);
  f.host.registerApprovalUI(f.native,envelope=>{f.posts.push(envelope);return envelope.type==='mcp-request'?delivered:true;});
  let settled=false;const waiting=f.stage();waiting.then(()=>settled=true,()=>settled=true);const rejected=assert.rejects(waiting,pending);
  await until(()=>f.cards().length===1);await new Promise(resolve=>setTimeout(resolve,45));assert.equal(settled,false,'delivery time is outside the approval wait');
  release(true);await rejected;assert.equal(f.engine.records.get(f.cards()[0].request.id).waiterDetached,true);
});

for(const ending of ['stop','policy'])test(`pending ${ending} blocks a late accept and resume`,async t=>{
  const f=await fixture(t);await assert.rejects(f.stage(),pending);const id=f.cards()[0].request.id;
  if(ending==='stop')f.stop();else f.settings.updateSettings({stage4Enabled:false},f.settings.getSettings().revision);
  f.answer(id);await until(()=>f.engine.records.get(id).state==='cancelled');assert.deepEqual(f.engine.resumes,[]);assert.deepEqual(f.actions,[]);
});

test('pending approval and private owner key survive host recreation',async t=>{
  const engine=createApprovalEngine(),f=await fixture(t,{engine});await assert.rejects(f.stage(),pending);const id=f.cards()[0].request.id;
  const ownerToken=engine.calls.find(value=>value.method==='thread/approval/request').params.ownerToken;
  await f.host.dispose();const g=await fixture(t,{engine,home:f.home});await until(()=>g.cards().some(value=>value.request.id===id));
  g.answer(id);await until(()=>engine.resumes.length===1);g.start('resumed');assert.equal((await g.stage()).authorized,true);
  assert.ok(engine.calls.every(value=>value.params.ownerToken===ownerToken));assert.equal(engine.calls.filter(value=>value.method==='thread/approval/request').length,1);
  await g.host.dispose();
});

test('resolve overlapping the grace deadline cannot execute the detached tool call',async t=>{
  let release,entered=false;const gate=new Promise(resolve=>release=resolve),engine=createApprovalEngine({beforeResolve:async()=>{entered=true;await gate;}});
  const f=await fixture(t,{engine}),waiting=f.stage(),rejected=assert.rejects(waiting,pending);await until(()=>f.cards().length===1);const id=f.cards()[0].request.id;
  f.answer(id);await until(()=>entered);await rejected;f.complete();release();await until(()=>engine.resumes.length===1);
  assert.deepEqual(f.actions,[]);f.start('resumed');assert.equal((await f.stage()).authorized,true);
});

test('a late stage receipt never permits input to a window whose process identity changed',async t=>{
  const f=await fixture(t);f.approvals.addAppApproval(f.descriptor.executable,'Fixture');
  const listed=await f.call('list_windows'),selected=await f.call('select_window',{candidateId:listed.candidates[0].candidateId});
  const stage=()=>f.call('request_stage',{stage:2,targetId:selected.targetId,reason:'Resize the explicitly selected fixture window'});
  await assert.rejects(stage(),pending);const id=f.cards()[0].request.id;
  f.descriptor.processCreated='replacement-process';f.complete();f.answer(id);await until(()=>f.engine.resumes.length===1);f.start('resumed');
  await stage();await assert.rejects(f.call('resize',{targetId:selected.targetId,widthDip:700,heightDip:500}));
  assert.equal(f.actions.includes('resize'),false);assert.equal(f.actions.includes('act'),false);
});

test('resolve failure before commit re-lists pending authority and requires another explicit click',async t=>{
  let fail=true;const engine=createApprovalEngine({beforeResolve(){if(fail){fail=false;throw Error('Fixture transport lost before resolve commit');}}});
  const f=await fixture(t,{engine});await assert.rejects(f.stage(),pending);const id=f.cards()[0].request.id;
  const lists=engine.calls.filter(value=>value.method==='thread/approval/list').length;f.answer(id);
  await until(()=>f.cards().length===2);assert.equal(f.cards()[1].request.id,id);assert.equal(engine.records.get(id).state,'pending');
  assert.ok(engine.calls.filter(value=>value.method==='thread/approval/list').length>lists);assert.equal(engine.calls.filter(value=>value.method==='thread/approval/resolve').length,1,'reconciliation never replays resolve');
  assert.deepEqual(engine.resumes,[]);assert.deepEqual(f.actions,[]);
  f.answer(id);await until(()=>engine.resumes.length===1);assert.equal(engine.calls.filter(value=>value.method==='thread/approval/resolve').length,2,'only the second explicit click retries the decision');
  f.start('resumed');assert.equal((await f.stage()).authorized,true);assert.equal(f.cards().length,2);
});

for(const decision of ['accept','decline'])test(`committed ${decision} with lost transport reconciles its terminal ledger without replay`,async t=>{
  const engine=createApprovalEngine(),rpc=engine.rpc.bind(engine);let fail=true;
  engine.rpc=async(method,params)=>{const result=await rpc(method,params);if(fail&&method==='thread/approval/resolve'){fail=false;throw Error('Fixture transport lost after resolve commit');}return result;};
  const f=await fixture(t,{engine});await assert.rejects(f.stage(),pending);const id=f.cards()[0].request.id,lists=engine.calls.filter(value=>value.method==='thread/approval/list').length;
  f.answer(id,decision);await until(()=>f.posts.some(value=>value.notification?.method==='serverRequest/resolved'&&value.notification.params.requestId===id));
  assert.equal(engine.records.get(id).state,decision==='accept'?'accepted':'declined');assert.equal(engine.calls.filter(value=>value.method==='thread/approval/resolve').length,1);
  assert.ok(engine.calls.filter(value=>value.method==='thread/approval/list').length>lists);assert.equal(f.cards().length,1,'a committed terminal decision never republishes a pending card');
  f.answer(id,decision);await tick();assert.equal(engine.calls.filter(value=>value.method==='thread/approval/resolve').length,1);assert.equal(engine.resumes.length,decision==='accept'?1:0);assert.deepEqual(f.actions,[]);
  if(decision==='accept'){f.start('resumed');assert.equal((await f.stage()).authorized,true);assert.equal(f.cards().length,1);}
});

test('active resolve transport failure reports an observed response without executing the waiting operation',async t=>{
  const engine=createApprovalEngine({beforeResolve(){throw Error('Fixture active decision transport failed');}}),f=await fixture(t,{engine});
  const waiting=f.stage(),rejected=assert.rejects(waiting,{code:'connection_error',userResponded:true,actionExecuted:false});
  await until(()=>f.cards().length===1);f.answer(f.cards()[0].request.id);await rejected;assert.deepEqual(f.actions,[]);assert.deepEqual(engine.resumes,[]);
});

for(const method of ['thread/closed','thread/archived','thread/deleted'])test(`${method} withdraws a pending card and ignores late approval`,async t=>{
  const f=await fixture(t);await assert.rejects(f.stage(),pending);const id=f.cards()[0].request.id;
  f.host.observe(f.native,{method,params:{threadId:thread}});
  await until(()=>f.engine.records.get(id).state==='cancelled'&&f.posts.some(value=>value.notification?.method==='serverRequest/resolved'&&value.notification.params.requestId===id));
  await until(()=>!f.host.threads.has(thread));
  assert.ok(f.engine.calls.some(value=>value.method==='thread/approval/withdraw'&&value.params.threadId===thread&&(!value.params.requestId||value.params.requestId===id)));
  const resolves=f.engine.calls.filter(value=>value.method==='thread/approval/resolve').length;
  assert.equal(f.answer(id),true);await tick();
  assert.equal(f.engine.calls.filter(value=>value.method==='thread/approval/resolve').length,resolves);
  assert.equal(f.engine.records.get(id).state,'cancelled');assert.deepEqual(f.engine.resumes,[]);assert.deepEqual(f.actions,[]);
});
