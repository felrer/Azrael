"use strict";
const MARKER = "/*azrael-computer-use-approvals-v1*/";
const access = 'require("./computer-use-approvals.cjs")';
const replacements = [
  ['onRequest:F=>{this.broadcastToAllViews({type:"mcp-request",hostId:"local",request:F})}', `onRequest:F=>{${access}.receive(F,(id,result)=>this.codexMcpConnection.sendResponse(id,result),request=>this.broadcastToAllViews({type:"mcp-request",hostId:"local",request}))}${MARKER}`],
  ['case"mcp-response":{let{id:n,result:o}=r.response;this.codexMcpConnection.sendResponse(n,o);break}', `case"mcp-response":{let{id:n,result:o}=r.response;this.codexMcpConnection.sendResponse(n,${access}.response(n,o));break}`],
  ['let{id:n,method:o,params:i}=r.request;this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(bR,String(n),o,i,r.retainResponse);break', `let{id:n,method:o,params:i}=r.request;${access}.outgoing(o,i);this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(bR,String(n),o,i,r.retainResponse);break`],
  ['interruptTurn:e=>this.sendInternalAppServerRequest("turn/interrupt",e)', `interruptTurn:e=>{${access}.stop(e?.threadId);return this.sendInternalAppServerRequest("turn/interrupt",e)}`],
  ['onFatalError:(F,V)=>{this.logger.error("Fatal error"', `onFatalError:(F,V)=>{${access}.reset();this.logger.error("Fatal error"`],
  ['onRawNotification:F=>{let{method:V,params:J}=F;this.broadcastToAllViews', `onRawNotification:F=>{let{method:V,params:J}=F;${access}.notification(V,J);this.broadcastToAllViews`],
  ['var eF=class extends ut{async getAppApprovals(){return null}async removeAppApproval(){return null}', `var eF=class extends ut{async getAppApprovals(){return ${access}.getAppApprovals()}async removeAppApproval(e){return ${access}.removeAppApproval(e)}`],
];
function injectComputerUse(text) {
  const markers = text.split(MARKER).length - 1;
  if (markers) {
    if (markers !== 1 || replacements.some(([, value]) => text.split(value).length - 1 !== 1)) throw new Error("Invalid computer-use approval injection marker");
    return { text, count: 0 };
  }
  for (const [anchor] of replacements) if (text.split(anchor).length - 1 !== 1) throw new Error("Pinned computer-use approval anchor must occur exactly once: " + anchor.slice(0, 60));
  for (const [anchor, value] of replacements) text = text.replace(anchor, value);
  return { text, count: replacements.length };
}
module.exports = { injectComputerUse, MARKER, replacements };
