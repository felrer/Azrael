'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createLedger,readOwnerToken,scopeKey}=require('./window-use-async-approvals.cjs');
const {windowError,errorPayload,fromPayload}=require('./window-control-errors.cjs');
const root=path.resolve(process.env.AZRAEL_APPROVAL_TEST_ROOT||'artifacts/tasks/CF-01-window-use-admin-setup/runs/20261019-async-approval-r1/host/temporary/ledger');
function fixture(t) {
 const directory=path.join(root,crypto.randomUUID());fs.mkdirSync(directory,{recursive:true,mode:0o700});
 t.after(()=>{for(const name of fs.readdirSync(directory)){assert.equal(name,'owner-key');fs.unlinkSync(path.join(directory,name));}fs.rmdirSync(directory);});return directory;
}
function request(threadId='thread-fixture') {return {id:'azrael-window-consent-'+crypto.randomUUID(),params:{threadId,_meta:{persist:['session']}}};}
test('profile owner token is stable, unpredictable and not regenerated from malformed state',t=>{
 const directory=fixture(t),first=readOwnerToken(directory);assert.match(first,/^[a-f0-9]{64}$/);assert.equal(readOwnerToken(directory),first);
 fs.writeFileSync(path.join(directory,'owner-key'),'damaged');assert.throws(()=>readOwnerToken(directory),/not private or valid/);assert.equal(fs.readFileSync(path.join(directory,'owner-key'),'utf8'),'damaged');
});
test('independent profiles have separate approval bearer capabilities',t=>{assert.notEqual(readOwnerToken(fixture(t)),readOwnerToken(fixture(t)));});
test('scope identity is stable across property order but changes for policy, target or environment',()=>{
 assert.equal(scopeKey({target:{pid:2,exe:'x'},policy:3}),scopeKey({policy:3,target:{exe:'x',pid:2}}));
 for(const changed of [{target:{pid:3,exe:'x'},policy:3},{target:{pid:2,exe:'y'},policy:3},{target:{pid:2,exe:'x'},policy:4}])assert.notEqual(scopeKey(changed),scopeKey({target:{pid:2,exe:'x'},policy:3}));
});
test('typed ledger binds bearer, request, exact scope, decision and deferral without exposing token in records',async t=>{
 const calls=[],directory=fixture(t),binding={threadId:'thread-fixture',policy:7,target:'paint'},ui=request(),key=scopeKey(binding);
 const saved={requestId:ui.id,scopeKey:key,payload:{request:ui,binding},state:'pending',persistence:null,waiterDetached:false};
 const rpc=async(thread,method,params)=>{calls.push({thread,method,params});if(method.endsWith('/list'))return {requests:[saved]};if(method.endsWith('/withdraw'))return {requests:[{...saved,state:'cancelled'}]};return {request:saved};};
 const ledger=createLedger({directory,rpc});
 assert.equal((await ledger.request(binding.threadId,ui,binding)).requestId,ui.id);
 assert.equal((await ledger.list(binding.threadId)).length,1);
 await ledger.defer(binding.threadId,ui.id,key);
 await ledger.resolve(binding.threadId,ui.id,key,{action:'accept',content:{persist:'session'}},true);
 await ledger.withdraw(binding.threadId,ui.id,'user-stop');
 assert.deepEqual(calls.map(c=>c.method),['request','list','defer','resolve','withdraw'].map(m=>'thread/approval/'+m));
 for(const call of calls){assert.equal(call.thread,binding.threadId);assert.equal(call.params.ownerToken,readOwnerToken(directory));assert.equal(call.params.threadId,binding.threadId);}
 assert.equal(calls[3].params.resume,true);assert.equal(calls[3].params.persistence,'session');assert.equal(calls[3].params.decision,'accept');assert.equal(JSON.stringify(saved).includes(readOwnerToken(directory)),false);
});
test('unknown engine capability and mismatched persisted scope fail closed',async t=>{
 const ledger=createLedger({directory:fixture(t),rpc:async()=>({})});await assert.rejects(()=>ledger.list('thread-fixture'),/ledger unavailable/);
 const binding={threadId:'thread-fixture'},ui=request(),saved={requestId:ui.id,scopeKey:scopeKey(binding),payload:{request:ui,binding:{...binding,policy:'changed'}},state:'pending',persistence:null};
 const corrupt=createLedger({directory:fixture(t),rpc:async()=>({requests:[saved]})});await assert.rejects(()=>corrupt.list('thread-fixture'),/Invalid durable/);
});
test('pending metadata survives transport and remains explicitly unexecuted',()=>{
 const id=request().id;const value=errorPayload(fromPayload(errorPayload(windowError('permission_pending','waiting',{approvalRequestId:id,approvalState:'pending',userResponded:false,actionExecuted:false}))));
 assert.equal(value.code,'permission_pending');assert.equal(value.approvalRequestId,id);assert.equal(value.approvalState,'pending');assert.equal(value.actionExecuted,false);assert.equal(value.userResponded,false);
 assert.equal(errorPayload(windowError('permission_pending','waiting',{approvalRequestId:'foreign'})).approvalRequestId,undefined);
});
