'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {createHost}=require('./window-control-host.cjs');
const {injectComputerUse,replacements}=require('./inject-computer-use.cjs');
const thread='12345678-1234-1234-1234-123456789abc';
const descriptor={hwnd:'fixture',pid:123,processCreated:'fixture-created',executable:'C:/synthetic/editor.exe',title:'Synthetic Editor',minimized:false,widthPx:800,heightPx:600,dpi:96};
test('actual Window Use host consumes transformed native approvals, scopes and expiry without engine passthrough',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'azrael-window-native-integration-'));
 let host;
 try{
  const approvals=require('./window-use-approvals.cjs').createOwner(home),computer=require('./computer-use-approvals.cjs').createOwner(home),shown=[],engine=[],backendCalls=[];
  const native={registerProvider(){return {dispose(){}}},sendRequest(...args){engine.push({request:args})},sendResponse(id,result){engine.push({id,result})}};
  host=createHost({runtime:{codexHome:home},approvalTimeoutMs:150,occupancyDirectory:path.join(home,'occupancy'),approvals,vscode:{workspace:{workspaceFolders:[]}},backend:{async request(method){backendCalls.push(method);return method==='listWindows'?[descriptor]:descriptor},async dispose(){}},createServer(){const server=new EventEmitter();server.listen=(_name,done)=>done();server.close=()=>{};return server}});
  host.attach(native,()=>assert.fail('unexpected internal engine RPC'));
  const original=await fs.readFile(path.join(__dirname,'../artifacts/upstream-ui/26.930.61225/out/extension.js'),'utf8'),injected=injectComputerUse(original);for(const index of [0,1,2])assert(injected.text.includes(replacements[index][1]),'exact transformed production handler');
  const context=vm.createContext({require(name){if(name==='./window-control-host.cjs')return host;if(name==='./computer-use-approvals.cjs')return computer;throw Error(name)},bR:'native-provider'});
  context.host={codexMcpConnection:native,broadcastToAllViews(envelope){shown.push(envelope)},pendingMcpRequests:new Map()};
  vm.runInContext(`host.outgoing=function(r,e){switch(r.type){case'mcp-request':{${replacements[2][1]}}}};host.respond=function(r){switch(r.type){${replacements[1][1]}}};host.receive=function(){return ({${replacements[0][1]}}).onRequest}.call(host);`,context);
  context.host.outgoing({type:'mcp-request',request:{id:'normal-request',method:'thread/read',params:{threadId:thread}}},{});
  assert.equal(engine.length,1);
  host.observe(native,{method:'thread/started',params:{thread:{id:thread}}});await host.threads.get(thread).ready;host.observe(native,{method:'turn/started',params:{threadId:thread,turn:{id:'native-turn'}}});
  const call=(tool,args,disabled=true)=>host.handlePipe({nonce:host.nonce,threadId:thread,method:'call',tool,arguments:args,_meta:{threadId:thread,'codex/sandbox-state-meta':{permissionProfile:disabled?{type:'disabled'}:{type:'managed',sandbox:'danger-full-access'}},'x-codex-turn-metadata':{thread_id:thread,turn_id:'native-turn',sandbox_mode:'danger-full-access'}}});
  const nextRequest=async count=>{for(let i=0;i<100;i++){const requests=shown.filter(e=>e.type==='mcp-request');if(requests.length>count)return requests.at(-1).request;await new Promise(r=>setTimeout(r,2))}assert.fail('local approval did not publish')};
  await assert.rejects(call('list_windows',{},false),{code:'permission_denied'});assert.equal(backendCalls.length,0);
  for(const persist of ['session','always']){
   const list=await call('list_windows',{}),before=shown.filter(e=>e.type==='mcp-request').length;
   const selecting=call('select_window',{candidateId:list.candidates[0].candidateId});const request=await nextRequest(before);
   assert.equal(request.params._meta.connector_name,'Window Use');assert.equal(request.params._meta.codex_approval_kind,'mcp_tool_call');
   context.host.receive({id:'unrelated',method:'unrelated',params:{}}); // Rebinding must preserve the pending approval.
   context.host.respond({type:'mcp-response',response:{id:request.id,result:{action:'accept',content:{},_meta:{persist}}}});
   const selected=await selecting;assert(selected.targetId);assert.equal(approvals.hasAppApproval(descriptor.executable,thread),true);assert.equal(approvals.hasAppApproval(descriptor.executable,'other-thread'),persist==='always');assert.equal(engine.length,1,'local response never reaches engine');
   assert(shown.some(e=>e.notification?.method==='serverRequest/resolved'&&e.notification.params.requestId===request.id));approvals.removeAppApproval(descriptor.executable);
  }
  const list=await call('list_windows',{}),before=shown.filter(e=>e.type==='mcp-request').length;
  const expired=call('select_window',{candidateId:list.candidates[0].candidateId});const rejected=assert.rejects(expired,{code:'approval_timeout',approvalState:'expired',userResponded:false,actionExecuted:false});const request=await nextRequest(before);await rejected;
  assert(shown.some(e=>e.notification?.method==='serverRequest/resolved'&&e.notification.params.threadId===thread&&e.notification.params.requestId===request.id));
  context.host.respond({type:'mcp-response',response:{id:request.id,result:{action:'accept',content:{},_meta:{persist:'always'}}}});assert.equal(engine.length,1);assert.equal(approvals.hasAppApproval(descriptor.executable,thread),false);
  context.host.respond({type:'mcp-response',response:{id:'ordinary',result:{action:'accept'}}});assert.equal(engine.at(-1).id,'ordinary');
 }finally{await host?.dispose();await fs.rm(home,{recursive:true,force:true})}
});
