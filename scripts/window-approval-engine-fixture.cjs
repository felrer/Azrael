'use strict';
const assert=require('node:assert/strict');
const clone=value=>structuredClone(value);
function createApprovalEngine({beforeResolve,beforeDefer}={}) {
  const records=new Map(),calls=[],resumes=[];
  const owns=params=>{
    assert.match(params.ownerToken,/^[a-f0-9]{64}$/);assert.equal(typeof params.threadId,'string');
    return [...records.values()].filter(record=>record.threadId===params.threadId&&record.ownerToken===params.ownerToken);
  };
  return {records,calls,resumes,
    async rpc(method,params) {
      assert.ok(method.startsWith('thread/approval/'),'fixture handles only typed approval RPC');calls.push({method,params:clone(params)});
      const owned=owns(params),operation=method.slice('thread/approval/'.length);
      if(operation==='list')return {requests:clone(owned.map(({threadId,ownerToken,...record})=>record))};
      if(operation==='request') {
        assert.match(params.requestId,/^azrael-window-consent-[a-f0-9-]{36}$/i);assert.match(params.scopeKey,/^[a-f0-9]{64}$/);
        assert.equal(params.payload.request.id,params.requestId);assert.equal(params.payload.binding.threadId,params.threadId);
        let record=owned.find(value=>value.scopeKey===params.scopeKey&&value.state==='pending');
        if(!record) {record={...clone(params),state:'pending',persistence:null,waiterDetached:false,resumeState:'not_requested'};records.set(record.requestId,record);}
        const {threadId,ownerToken,...value}=record;return {request:clone(value)};
      }
      if(operation==='withdraw') {
        assert.equal(typeof params.reason,'string');const affected=owned.filter(value=>!params.requestId||value.requestId===params.requestId);
        for(const record of affected){record.state='cancelled';record.persistence=null;record.resumeState='not_requested';}
        return {requests:clone(affected.map(({threadId,ownerToken,...record})=>record))};
      }
      const record=owned.find(value=>value.requestId===params.requestId&&value.scopeKey===params.scopeKey);assert.ok(record,'request must be owned and have the matching scope key');
      if(operation==='defer') {await beforeDefer?.(params,record);record.waiterDetached=true;}
      else if(operation==='resolve') {
        assert.ok(['accept','decline','cancel'].includes(params.decision));assert.equal(typeof params.resume,'boolean');
        if(params.decision==='accept')assert.ok(record.payload.request.params._meta.persist.includes(params.persistence));
        await beforeResolve?.(params,record);
        if(record.state==='pending') {record.state={accept:'accepted',decline:'declined',cancel:'cancelled'}[params.decision];record.persistence=params.decision==='accept'?params.persistence:null;}
        if(params.resume&&record.state==='accepted'&&record.resumeState!=='queued') {record.resumeState='queued';resumes.push({threadId:params.threadId,requestId:record.requestId});}
      } else assert.fail('Unexpected approval endpoint '+method);
      const {threadId,ownerToken,...value}=record;return {request:clone(value)};
    }
  };
}
function attachApprovalEngine(host,native,fallback=()=>assert.fail('Unexpected non-approval engine RPC'),engine=createApprovalEngine()) {
  const original=native.registerProvider.bind(native);let callbacks;
  native.registerProvider=(provider,value)=>{callbacks=value;return original(provider,value);};
  const bridge=host.attach(native,(provider,id,method,params,...rest)=>{
    if(!method.startsWith('thread/approval/'))return fallback(provider,id,method,params,...rest);
    void engine.rpc(method,params).then(result=>callbacks.onResult({id,result}),error=>callbacks.onResult({id,error:{message:error.message}}));
  });
  return {bridge,engine};
}
module.exports={createApprovalEngine,attachApprovalEngine};
