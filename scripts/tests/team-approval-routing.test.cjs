"use strict";
// Retained: pinned upgrades can omit the selector/response pairing or lose source
// cwd/patch items when simplifying approval projection.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createApprovalProjection, approvalSelectorInputs, approvalResponseOrigin } = require("../team-approval-routing.cjs");
const { injectTeamApprovals, APP_ASSET, BRIDGE_ASSET } = require("../inject-team-approvals.cjs");
const root = path.resolve(__dirname, "../..");
const source = asset => fs.readFileSync(path.join(root, "artifacts/upstream-ui/26.1007.21434", asset), "utf8");
function segment(text, name, next) { return text.slice(text.indexOf(`function ${name}(`), text.indexOf(`function ${next}(`)); }
function fixture(hostId = "local") {
  const callbacks = [];
  const registry = { teams: [{hostId:"local",leadId:"lead",memberIds:["lead","child"]}] };
  const projection = createApprovalProjection({registry:()=>registry,schedule:f=>callbacks.push(f)});
  const manager = {params:{hostId},conversations:new Map(),updateConversationState(id,change){change(this.conversations.get(id));projection.observe(this);}};
  const lead = {id:"lead",requests:[],turns:[]};
  const child = {id:"child",requests:[],turns:[{turnId:"turn",params:{cwd:"C:/origin"},items:[]}]};
  manager.conversations.set("lead",lead);manager.conversations.set("child",child);
  const context = {hostId,getConversationRequests:id=>manager.conversations.get(id)?.requests??[]};
  return {manager,lead,child,context,projection,registry,flush(){while(callbacks.length)callbacks.shift()();}};
}
function request(method="item/commandExecution/requestApproval",id="r") {return {id,method,params:{threadId:"child",turnId:"turn",itemId:"tool",command:"echo origin",reason:"needs permission"}};}
test("guarded transforms are idempotent on both pinned native assets",()=>{
  for(const asset of [APP_ASSET,BRIDGE_ASSET]) {
    const result=injectTeamApprovals(source(asset),asset);assert.equal(result.count,1);
    assert.equal(injectTeamApprovals(result.text,asset).text,result.text);
    assert.throws(()=>injectTeamApprovals(result.text.replace("/*azrael-team-approvals-v1*/","/*azrael-team-approvals-v1*/\n/*azrael-team-approvals-v1*/"),asset),/Damaged/);
  }
});
test("native dispatcher keeps request at origin; Lead selector builds command with source cwd",()=>{
  const f=fixture();const req=request();
  f.child.turns[0].items.push({type:"agentMessage",text:"private task context"},{type:"userInputResponse",completed:false});
  const app=injectTeamApprovals(source(APP_ASSET),APP_ASSET).text;
  const sandbox={azraelApprovalProjection:f.projection,B:x=>x,c:x=>x};
  vm.createContext(sandbox);vm.runInContext(segment(app,"aEn","oEn")+";globalThis.dispatch=aEn",sandbox);
  const notifications=[];
  sandbox.dispatch({manager:f.manager,serverRequest:req,onApprovalRequest:x=>notifications.push(x)});f.flush();
  assert.equal(f.child.requests[0].id,"r");assert.equal(f.child.requests[0].params.threadId,"child");
  assert.equal(notifications[0].conversationId,"lead");assert.equal(f.lead.turns.length,0);
  const [requests,turns]=approvalSelectorInputs(f.lead.requests,f.lead.turns);
  const bridge=injectTeamApprovals(source(BRIDGE_ASSET),BRIDGE_ASSET).text;
  const render={approvalSelectorInputs,ns:x=>x,svt:()=>[],wp:x=>x,lvt:x=>x,BJe:()=>null};
  vm.createContext(render);
  vm.runInContext(segment(bridge,"sLt","cLt")+segment(bridge,"dLt","fLt")+segment(bridge,"fLt","pLt")+segment(bridge,"hLt","SLt")+";globalThis.select=sLt",render);
  const card=render.select(requests,turns,false);
  assert.equal(card.type,"approval");assert.equal(card.item.cwd,"C:/origin");assert.equal(card.item.cmd[0],"echo origin");
  assert.match(card.item.approvalReason,/Session child/);
  assert.equal(JSON.stringify(f.lead.requests).includes("private task context"),false);
  assert.equal(approvalSelectorInputs(f.child.requests,[])[0].length,0);
});
test("native patch builder receives matching original file item",()=>{
  const f=fixture();f.child.requests.push(request("item/fileChange/requestApproval"));
  f.child.turns[0].items.push({id:"tool",type:"fileChange",changes:{"origin.txt":{diff:"+source"}},status:"inProgress"});f.projection.sync(f.manager);
  const bridge=source(BRIDGE_ASSET),render={ns:x=>x,wp:x=>x,nat:x=>x,qit:()=>[]};vm.createContext(render);
  vm.runInContext(segment(bridge,"bLt","SLt")+";globalThis.patch=bLt",render);
  const [requests,turns]=approvalSelectorInputs(f.lead.requests,[]);const card=render.patch(requests[0],turns[0]);
  assert.equal(card.changes["origin.txt"].diff,"+source");assert.equal(card.callId,"tool");assert.equal(f.lead.turns.length,0);
});
test("native response entry remaps before dispatch and rejects resolved mirrors",()=>{
  const f=fixture();f.child.requests.push(request());f.projection.sync(f.manager);
  const mirror=f.lead.requests[0],sent=[];
  f.context.hostId="another-host";assert.equal(approvalResponseOrigin(f.context,"lead",mirror.id),null);f.context.hostId="local";
  Object.assign(f.context,{getConversationRequest:(id,r)=>f.context.getConversationRequests(id).find(x=>x.id===r),logger:{info(){}},dispatchAppServerResponse:(...x)=>sent.push(x),approvalResolved(){},removeConversationRequest(id,r){f.manager.updateConversationState(id,c=>{c.requests=c.requests.filter(x=>x.id!==r)});}});
  const app=injectTeamApprovals(source(APP_ASSET),APP_ASSET).text;
  const sandbox={approvalResponseOrigin,D$:()=>null};vm.createContext(sandbox);vm.runInContext(segment(app,"_Sn","ySn")+";globalThis.respond=vSn",sandbox);
  sandbox.respond(f.context,"lead",mirror.id,"accept");f.flush();
  assert.equal(sent[0][1].id,"r");assert.equal(sent[0][2],"child");assert.equal(f.lead.requests.length,0);
  f.lead.requests.push(mirror);assert.equal(approvalResponseOrigin(f.context,"lead",mirror.id),null);
});
test("resolution/reload, permission/MCP, host isolation and ordinary decisions",()=>{
  const f=fixture();f.child.requests.push(request("item/permissions/requestApproval"),request("mcpServer/elicitation/request","mcp"),request("item/tool/requestUserInput","question"));f.projection.sync(f.manager);
  assert.equal(f.lead.requests.length,2);assert.equal(f.child.requests.find(r=>r.id==="question").__azraelTeamApprovalHidden,undefined);
  const saved=JSON.parse(JSON.stringify([...f.manager.conversations]));const reload=fixture();reload.manager.conversations=new Map(saved);reload.projection.sync(reload.manager);assert.equal(reload.manager.conversations.get("lead").requests.length,2);
  reload.manager.updateConversationState("child",c=>{c.requests=[]});reload.flush();assert.equal(reload.manager.conversations.get("lead").requests.length,0);
  const other=fixture("remote");other.child.requests.push(request());other.projection.sync(other.manager);assert.equal(other.lead.requests.length,0);assert.equal(other.child.requests[0].__azraelTeamApprovalHidden,undefined);
  f.manager.conversations.delete("lead");f.projection.sync(f.manager);assert.equal(f.child.requests[0].__azraelTeamApprovalHidden,true);
});
test("Direct descendants route to their root; unknown ancestry and cycles fail closed",()=>{
  const f=fixture();f.registry.teams=[];f.child.parentThreadId="lead";f.child.requests.push(request());f.projection.sync(f.manager);
  assert.equal(f.lead.requests.length,1);assert.equal(f.lead.requests[0].__azraelTeamApproval.threadId,"child");
  f.child.parentThreadId="missing";assert.equal(f.projection.owner(f.manager,"child"),null);
  f.child.parentThreadId="lead";f.lead.parentThreadId="child";assert.equal(f.projection.owner(f.manager,"child"),null);
  delete f.manager.params.hostId;assert.equal(f.projection.owner(f.manager,"child"),null);
});
test("native permission and MCP response helpers apply only original request scope",()=>{
  const app=injectTeamApprovals(source(APP_ASSET),APP_ASSET).text;
  for(const [method,name,response] of [["item/permissions/requestApproval","bSn",{permissions:{network:{enabled:true}},scope:"turn"}],["mcpServer/elicitation/request","SSn",{action:"accept",content:{persist:"session"}}],["item/fileChange/requestApproval","ySn","decline"]]) {
    const f=fixture(),req=request(method);f.child.requests.push(req);f.projection.sync(f.manager);const mirror=f.lead.requests[0],sent=[],applied=[];
    Object.assign(f.context,{getConversationRequest:(id,r)=>f.context.getConversationRequests(id).find(x=>x.id===r),logger:{info(){}},dispatchAppServerResponse:(...x)=>sent.push(x),approvalResolved(){},removeConversationRequest(){},isMcpServerElicitationApprovalSafe:()=>true,getEquivalentConnectorAuthRequests:r=>[r],applyPermissionsRequestApprovalResponse:(...x)=>applied.push(x),applyMcpServerElicitationResponse:(...x)=>applied.push(x)});
    const sandbox={approvalResponseOrigin,D$:()=>null,c:x=>x};vm.createContext(sandbox);vm.runInContext(segment(app,"_Sn","O$")+`;globalThis.respond=${name}`,sandbox);
    sandbox.respond(f.context,"lead",mirror.id,response);
    assert.equal(sent[0][2],"child");assert.equal(sent[0][1].id,"r");
    if(applied.length){assert.equal(applied[0][0],"child");assert.equal(applied[0][2],req.params);}
    f.child.requests=[];assert.equal(approvalResponseOrigin(f.context,"lead",mirror.id),null);
  }
});
