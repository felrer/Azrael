'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const tasks = require('./window-task-macros.cjs');
const {createWindowOwner} = require('./window-control-policy.cjs');
const {callResult} = require('./window-control-mcp.cjs');
const w = {hwnd:'101',pid:4,processCreated:'123',executable:'C:\\Apps\\test.exe',title:'Selected',minimized:false,widthPx:800,heightPx:600,dpi:96};
const selector = {automationId:'query',controlType:'Edit',ancestor:{name:'Panel'}};
const condition = (property,equals,sel=selector) => ({selector:sel,property,equals});
const task = steps => ({schema:1,steps});
async function main() {
 const home = await fs.mkdtemp(path.join(os.tmpdir(),'window-task-'));
 let granted=true, approvals=0, n=0, actions=[], captures=0, inspectCount=0, value='', duplicate=false, missing=false, unsupported=false, throwing=false, elementsTruncated=false, onInspect, pendingApproval;
 let current={...w};
 const backend={async request(method,p) {
  if(method === 'listWindows') return [current];
  if(method === 'inspect' || method === 'observe') {
   if(method === 'inspect') {inspectCount++;if(onInspect) await onInspect();} else captures++;
   const e={id:'e'+(++n),name:'Query',automationId:'query',parentId:'panel',controlType:'Edit',patterns:['Value'],enabled:true,isPassword:false,...(!unsupported ? {value} : {})};
   const elements=[{id:'panel',name:'Panel',controlType:'Pane',patterns:[],enabled:true,isPassword:false},...(!missing ? [e] : []),...(duplicate ? [{...e,id:'duplicate'}] : [])];
   const r={window:{...current},observationId:'o'+n,elementsTruncated,elements};
   return method === 'inspect' ? r : {...r,frameTimestamp:'now',widthPx:800,heightPx:600,dpi:96,image:{mimeType:'image/png',data:'YQ=='}};
  }
  if(method === 'act') {actions.push({...p});if(throwing) throw new Error('native failed with SECRET'); if(p.action === 'setValue') value=p.value; if(p.action === 'pressKey') value='submitted';}
  return {window:{...current}};
 }};
 const owner=createWindowOwner({backend,authorize:async()=>granted,approve:async()=>{approvals++;if(pendingApproval) await pendingApproval;granted=true;return true;},codexHome:home});
 async function bind(){return owner.bind('t',current);}
 async function run(def,extra={}) {const target=owner.peek('t');return owner.call('t','run_task_macro',{targetId:target.targetId,definition:def,...extra});}
 try {
  assert.equal((await owner.call('t','status',{})).state,'unbound');
  const first=(await owner.call('t','list_windows',{})).candidates[0];
  assert.deepEqual(Object.keys(first).sort(),['appName','candidateId','minimized','occupancy','title']);
  await assert.rejects(owner.call('other','select_window',{candidateId:first.candidateId}),/Stale/);
  const second=(await owner.call('t','list_windows',{})).candidates[0];
  await assert.rejects(owner.call('t','select_window',{candidateId:first.candidateId}),/Stale/);
  granted=false;const selected=await owner.call('t','select_window',{candidateId:second.candidateId});assert.equal(approvals,1);assert.equal(selected.state,'selected');
  const stale=(await owner.call('t','list_windows',{})).candidates[0];current.processCreated='changed';
  await assert.rejects(owner.call('t','select_window',{candidateId:stale.candidateId}),/identity changed/);current={...w};
  await bind();
  const inspected=await owner.call('t','inspect',{targetId:owner.peek('t').targetId});assert.equal(inspected.image,undefined);assert.equal(inspected.elements[1].automationId,'query');
  const keyResult=await owner.call('t','press_key',{targetId:owner.peek('t').targetId,observationId:inspected.observationId,elementId:inspected.elements[1].id,key:'Tab'});assert.equal(keyResult.delivery,'windowMessage');assert.equal(keyResult.verified,false);
  await assert.rejects(owner.call('t','press_key',{targetId:owner.peek('t').targetId,observationId:inspected.observationId,elementId:inspected.elements[1].id,key:'Ctrl+A'}),/Unsupported key/);
  const pre=actions.length;
  const def={schema:1,id:'search',name:'Search',parameters:['query'],steps:[{action:'set_value',selector,value:{parameter:'query'},postcondition:condition('value',{parameter:'query'})},{action:'assert',condition:condition('value',{parameter:'query'})},{action:'press_key',selector,key:'Return',postcondition:condition('value','submitted')}]};
  const result=await run(def,{parameters:{query:'SECRET'}});assert.equal(result.status,'completed');assert.equal(result.steps.length,3);assert.equal(actions.length-pre,2);assert.notEqual(actions.at(-1).elementId,actions.at(-2).elementId);assert.equal(actions.at(-1).action,'pressKey');
  const rendered=callResult(result);assert.equal(rendered.content[1].type,'image');assert.ok(!rendered.content[0].text.includes('YQ=='));
  const saved=await owner.call('t','save_task_macro',{definition:def});assert.equal(saved.revision,1);
  const updated=await owner.call('t','save_task_macro',{definition:{...def,name:'Updated'}});assert.equal(updated.revision,2);
  assert.equal((await owner.call('t','list_task_macros',{})).macros.length,1);
  const raw=await fs.readFile(tasks.createStore(home).file,'utf8');assert.ok(!raw.includes('SECRET'));
  const reused=await owner.call('t','run_task_macro',{targetId:owner.peek('t').targetId,macroId:'search',parameters:{query:'again'}});assert.equal(reused.status,'completed');assert.equal(reused.revision,2);
  await assert.rejects(run(def,{parameters:{query:'x',extra:'x'}}),/Invalid task/);
  assert.throws(()=>tasks.definition(task([{action:'press_key',selector,key:'Return'}])),/postcondition/);
  assert.throws(()=>tasks.definition(task([{action:'wait_for',condition:condition('exists',true),timeoutMs:10001}])),/limit/);
  assert.throws(()=>tasks.definition(task(Array(33).fill({action:'capture'}))),/32/);
  for(const [flag,message] of [['duplicate','Ambiguous'],['missing','missing'],['unsupported','unsupported']]) {
   duplicate=flag==='duplicate';missing=flag==='missing';unsupported=flag==='unsupported';
   const r=await run(task(flag === 'missing' ? [{action:'invoke',selector}] : [{action:'assert',condition:condition('value','submitted')}]));assert.equal(r.status,'failed');assert.match(r.error.message,new RegExp(message));
  }
  duplicate=missing=unsupported=false;
  elementsTruncated=true;
  const beforePartialActions=actions.length;
  const partialDefinitions=[
   task([{action:'set_value',selector,value:'blocked'}]),
   task([{action:'assert',condition:condition('exists',true)}]),
   task([{action:'wait_for',condition:condition('exists',false),timeoutMs:0}]),
   task([{action:'capture',postcondition:condition('value','submitted')}]),
  ];
  for (const partialDefinition of partialDefinitions) {
   const partial=await run(partialDefinition);
   assert.equal(partial.status,'failed');assert.equal(partial.error.message,'Task requires a complete accessibility observation');
   assert.equal(partial.finalObservation.elementsTruncated,true);assert.equal(actions.length,beforePartialActions);
  }
  missing=true;
  const incompleteMissing=await run(task([{action:'assert',condition:condition('exists',false)}]));
  assert.equal(incompleteMissing.status,'failed');assert.equal(incompleteMissing.error.message,'Task requires a complete accessibility observation');assert.equal(actions.length,beforePartialActions);
  missing=false;
  const partialCaptureOnly=await run(task([{action:'capture'}]));
  assert.equal(partialCaptureOnly.status,'completed');assert.equal(partialCaptureOnly.finalObservation.elementsTruncated,true);assert.equal(actions.length,beforePartialActions);
  elementsTruncated=false;
  const badKey=await run(task([{action:'press_key',selector,key:'Tab',postcondition:condition('value','unexpected')} ]));assert.equal(badKey.status,'failed');assert.match(badKey.error.message,/postcondition/);
  const beforeWaitCaptures=captures;onInspect=()=>{if(inspectCount%3===0)value='ready';};value='pending';
  const waited=await run(task([{action:'wait_for',condition:condition('value','ready'),timeoutMs:1000}]));assert.equal(waited.status,'completed');assert.equal(captures-beforeWaitCaptures,1);onInspect=null;
  const timeout=await run(task([{action:'wait_for',condition:condition('value','never'),timeoutMs:0}]));assert.equal(timeout.status,'failed');assert.match(timeout.error.message,/condition/);
  let signal;const started=new Promise(r=>signal=r);onInspect=()=>signal();value='pending';
  const cancelled=run(task([{action:'wait_for',condition:condition('value','never'),timeoutMs:1000},{action:'invoke',selector}]));await started;owner.stop('t');const cancellation=await cancelled;assert.equal(cancellation.status,'failed');assert.match(cancellation.error.message,/cancelled/);onInspect=null;
  await bind();onInspect=()=>{granted=false;};const revoked=await run(task([{action:'wait_for',condition:condition('value','never'),timeoutMs:1000},{action:'invoke',selector}]));assert.match(revoked.error.message,/revoked/);onInspect=null;granted=true;
  await bind();throwing=true;const beforeFailure=actions.length;const failed=await run(task([{action:'set_value',selector,value:'SECRET'},{action:'invoke',selector}]));assert.equal(actions.length-beforeFailure,1);assert.equal(failed.status,'failed');assert.ok(!JSON.stringify(failed).includes('SECRET'));assert.equal(owner.peek('t').state,'paused');throwing=false;
  await bind();let release;pendingApproval=new Promise(r=>release=r);let approveSignal;const reached=new Promise(r=>approveSignal=r);const previous=backend.request;backend.request=async(method,p)=>{if(method==='listWindows' && pendingApproval) approveSignal();return previous(method,p);};
  const candidate=(await owner.call('t','list_windows',{})).candidates[0];const selecting=owner.call('t','select_window',{candidateId:candidate.candidateId});await reached;owner.stop('t');release();await assert.rejects(selecting,/cancelled|Stale/);pendingApproval=null;
  const noApproval=createWindowOwner({backend,authorize:async()=>false,codexHome:home});const denied=(await noApproval.call('n','list_windows',{})).candidates[0];await assert.rejects(noApproval.call('n','select_window',{candidateId:denied.candidateId}),/revoked/);noApproval.dispose();
  for (const property of ['exists','enabled','selected']) {
    assert.throws(() => tasks.definition({schema:1,parameters:['state'],steps:[{action:'assert',condition:condition(property,{parameter:'state'})}]}), /literal booleans/);
  }
  const store=tasks.createStore(home);
  const validStored=await fs.readFile(store.file,'utf8');
  const tooLarge={schema:1,id:'oversized',name:'Oversized',steps:Array.from({length:11},()=>({action:'set_value',selector,value:'\uD55C'.repeat(32768)}))};
  assert.ok(Buffer.byteLength(JSON.stringify(tooLarge),'utf8')>1024*1024);
  assert.ok(JSON.stringify(tooLarge).length<1024*1024);
  await assert.rejects(store.save(tooLarge),/size limit/);
  assert.equal(await fs.readFile(store.file,'utf8'),validStored);
  assert.equal((await store.read()).revision,2);
  const exhausted=JSON.parse(validStored);exhausted.revision=Number.MAX_SAFE_INTEGER;
  const exhaustedRaw=JSON.stringify(exhausted);await fs.writeFile(store.file,exhaustedRaw);
  await assert.rejects(store.save(def),e => e.code === 'unclassified' && e.message === '미분류된 오류');
  assert.equal(await fs.readFile(store.file,'utf8'),exhaustedRaw);
  await fs.writeFile(store.file,validStored);
  let regressionCaptures=0,regressionActions=0;
  const regressionObservation={observationId:'regression',elementsTruncated:false,elements:[{id:'panel',name:'Panel',controlType:'Pane'},{id:'query',name:'Query',automationId:'query',controlType:'Edit',parentId:'panel',value:'ready'}]};
  const regressionIo={guard:async()=>{},inspect:async()=>regressionObservation,act:async()=>{regressionActions++;throw new Error('Unknown mutation');},capture:async()=>{regressionCaptures++;if(regressionCaptures>1)throw new Error('Capture unavailable');return {...regressionObservation,image:{mimeType:'image/png',data:'old-image'}};}};
  const staleImageResult=await tasks.run(task([{action:'capture'},{action:'invoke',selector}]),{},regressionIo);
  assert.equal(staleImageResult.status,'failed');assert.equal(regressionActions,1);assert.equal(regressionCaptures,2);assert.equal(staleImageResult.finalObservation,undefined);assert.equal(staleImageResult.error.code,'unclassified');assert.equal(staleImageResult.error.message,'미분류된 오류');assert.equal(staleImageResult.error.mutationOutcome,'unknown');
  regressionCaptures=0;
  const captureOnlyResult=await tasks.run(task([{action:'capture'},{action:'assert',condition:condition('value','ready')}]),{},regressionIo);
  assert.equal(captureOnlyResult.status,'completed');assert.equal(regressionCaptures,1);
  regressionCaptures=0;
  const afterMutation=await tasks.run(task([{action:'capture'},{action:'invoke',selector}]),{}, {...regressionIo,act:async()=>{},capture:async()=>{regressionCaptures++;return regressionObservation;}});
  assert.equal(afterMutation.status,'completed');assert.equal(regressionCaptures,2);
  const realNow=Date.now;let clock=realNow();let cancelCount=0,deadlineActions=0,advanced=false;
  try {Date.now=()=>clock;const deadlineResult=await tasks.run(task([{action:'invoke',selector}]),{}, {guard:async()=>{if(cancelCount) throw new Error('Operation cancelled');if(!advanced){clock+=19995;advanced=true;}},inspect:async()=>new Promise(()=>{}),capture:async()=>new Promise(()=>{}),act:async()=>{deadlineActions++;},cancel:()=>{cancelCount++;}});assert.equal(deadlineResult.status,'failed');assert.match(deadlineResult.error.message,/time limit/);assert.ok(cancelCount>0);assert.equal(deadlineActions,0);} finally {Date.now=realNow;}
  console.log('Window task macros: discovery, exact identity, selector/state, snapshots/revisions, privacy, waits, cancellation/revocation and no-replay checks passed');
 } finally {owner.dispose();await fs.rm(home,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
