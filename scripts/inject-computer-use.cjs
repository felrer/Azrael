"use strict";
const MARKER = "/*azrael-computer-use-approvals-v1*/";
const COMPUTER_USE_SETTINGS_ASSET = "webview/assets/use-visible-settings-sections-7686bdcccd03.js";
const SETTINGS_MARKER = "/*azrael-computer-use-settings-v1*/";
const SETTINGS_ANCHOR = 'case`computer-use`:return{visible:!1,pending:!1};';
const SETTINGS_REPLACEMENT = "case`computer-use`:return{visible:!0,pending:!1};" + SETTINGS_MARKER;
const COMPUTER_USE_APPROVAL_CARD_ASSET = "webview/assets/computer-use-app-approval-request-card-a9ef3724f471.js";
const CANCEL_MARKER = "/*azrael-computer-use-cancel-request-v1*/";
const CANCEL_ANCHOR = "{headerContent:I,title:L,subtitle:R,actions:W}";
const CANCEL_REPLACEMENT = '{headerContent:I,title:L,subtitle:R,actions:W,body:(0,k.jsx)(`button`,{type:`button`,disabled:z,onClick:()=>F(`cancel`),className:`text-sm text-token-text-secondary hover:text-token-text-primary disabled:opacity-50`,children:(0,k.jsx)(a,{id:`azrael.computerUse.cancelRequest`,defaultMessage:`Cancel request`})})}' + CANCEL_MARKER;
const COMPUTER_USE_MANAGEMENT_ASSET = "webview/assets/computer-use-settings-a06e6e547020.js";
const MANAGEMENT_MARKER = "/*azrael-computer-use-local-management-v1*/";
const managementReplacements = [
  ['function Hr(){let e=(0,Q.c)(26)', 'function Hr(){let e=(0,Q.c)(28)' + MANAGEMENT_MARKER],
  ["let b;e[21]===a.available?b=e[22]", "let b;e[21]===a.available&&e[26]===t&&e[27]===o?b=e[22]"],
  ["b=a.available?(0,$.jsxs)($.Fragment", "b=(t===`local`&&o===`windows`||a.available)?(0,$.jsxs)($.Fragment"],
  ['(0,$.jsx)(ii,{})', 'a.available&&(0,$.jsx)(ii,{})'],
  ['e[21]=a.available,e[22]=b', 'e[21]=a.available,e[26]=t,e[27]=o,e[22]=b'],
];
const windowAccess = 'require("./window-control-host.cjs")';
const bindWindowApproval = `if(this.azraelWindowApprovalNative!==this.codexMcpConnection){this.azraelWindowApprovalNative=this.codexMcpConnection;this.azraelWindowApprovalPublish=envelope=>this.broadcastToAllViews(envelope);this.azraelWindowApprovalNavigate=async(threadId,isPending)=>{if(!isPending())return;await require("vscode").commands.executeCommand("azrael.openSidebar");if(isPending())this.navigateToRoute("/local/"+threadId)}}${windowAccess}.registerApprovalUI(this.codexMcpConnection,this.azraelWindowApprovalPublish,this.azraelWindowApprovalNavigate);`;
const access = 'require("./computer-use-approvals.cjs")';
const replacements = [
  ['onRequest:F=>{this.broadcastToAllViews({type:"mcp-request",hostId:"local",request:F})}', `onRequest:F=>{${bindWindowApproval}${access}.receive(F,(id,result)=>this.codexMcpConnection.sendResponse(id,result),request=>this.broadcastToAllViews({type:"mcp-request",hostId:"local",request}))}${MARKER}`],
  ['case"mcp-response":{let{id:n,result:o}=r.response;this.codexMcpConnection.sendResponse(n,o);break}', `case"mcp-response":{let{id:n,result:o}=r.response;if(${windowAccess}.respondApproval(this.codexMcpConnection,n,o))break;this.codexMcpConnection.sendResponse(n,${access}.response(n,o));break}`],
  ['let{id:n,method:o,params:i}=r.request;this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(IR,String(n),o,i,r.retainResponse);break', `let{id:n,method:o,params:i}=r.request;${bindWindowApproval}${access}.outgoing(o,i);this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(IR,String(n),o,i,r.retainResponse);break`],
  ['interruptTurn:e=>this.sendInternalAppServerRequest("turn/interrupt",e)', `interruptTurn:e=>{${access}.stop(e?.threadId);return this.sendInternalAppServerRequest("turn/interrupt",e)}`],
  ['onFatalError:(F,V)=>{this.logger.error("Fatal error"', `onFatalError:(F,V)=>{${access}.reset();this.logger.error("Fatal error"`],
  ["onRawNotification:F=>{let{method:V,params:J}=F;this.broadcastToAllViews", `onRawNotification:F=>{let{method:V,params:J}=F;${bindWindowApproval}${access}.notification(V,J);this.broadcastToAllViews`],
  ["var dF=class extends ut{async getAppApprovals(){return null}async removeAppApproval(){return null}", `var dF=class extends ut{async getAppApprovals(){return ${access}.getAppApprovals()}async removeAppApproval(e){return ${access}.removeAppApproval(e)}`],
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
function injectComputerUseSettings(text, relativePath) {
  if (relativePath !== COMPUTER_USE_SETTINGS_ASSET) return { text, count: 0 };
  const markers = text.split(SETTINGS_MARKER).length - 1;
  const anchors = text.split(SETTINGS_ANCHOR).length - 1;
  const branches = text.split('case`computer-use`:').length - 1;
  if (markers) {
    if (markers !== 1 || anchors !== 0 || branches !== 1 || text.split(SETTINGS_REPLACEMENT).length - 1 !== 1) {
      throw new Error("Invalid computer-use settings injection marker");
    }
    return { text, count: 0 };
  }
  if (anchors !== 1 || branches !== 1) throw new Error("Pinned computer-use settings anchor must occur exactly once");
  return { text: text.replace(SETTINGS_ANCHOR, SETTINGS_REPLACEMENT), count: 1 };
}
function injectComputerUseCancelRequest(text, relativePath) {
  if (relativePath !== COMPUTER_USE_APPROVAL_CARD_ASSET) return { text, count: 0 };
  const markers = text.split(CANCEL_MARKER).length - 1;
  const anchors = text.split(CANCEL_ANCHOR).length - 1;
  if (markers) {
    if (markers !== 1 || anchors !== 0 || text.split(CANCEL_REPLACEMENT).length - 1 !== 1) {
      throw new Error("Invalid computer-use cancel-request injection marker");
    }
    return { text, count: 0 };
  }
  if (anchors !== 1) throw new Error("Pinned computer-use cancel-request anchor must occur exactly once");
  return { text: text.replace(CANCEL_ANCHOR, CANCEL_REPLACEMENT), count: 1 };
}
const WINDOW_TITLE_MARKER = "/*azrael-window-approval-title-v1*/";
const windowTitleReplacements = [
  ['function E(e){let t=(0,D.c)(42)', 'function E(e){let t=(0,D.c)(43)' + WINDOW_TITLE_MARKER],
  ['t[18]===d.appDisplayName?L=t[19]', 't[18]===d.appDisplayName&&t[42]===d.connectorName?L=t[19]'],
  ['id:`composer.computerUseAppApproval.title.chatgpt`,defaultMessage:`Allow ChatGPT to use {appDisplayName}?`', 'id:d.connectorName===`Window Use`?`azrael.windowUse.appApproval.title`:`composer.computerUseAppApproval.title.chatgpt`,defaultMessage:d.connectorName===`Window Use`?`Allow Azrael to use {appDisplayName}?`:`Allow ChatGPT to use {appDisplayName}?`'],
  ['t[18]=d.appDisplayName,t[19]=L', 't[18]=d.appDisplayName,t[42]=d.connectorName,t[19]=L'],
];
function injectWindowApprovalTitle(text,relativePath){
  if(relativePath!==COMPUTER_USE_APPROVAL_CARD_ASSET)return {text,count:0};
  const markers=text.split(WINDOW_TITLE_MARKER).length-1;
  if(markers){if(markers!==1||windowTitleReplacements.some(([,after])=>text.split(after).length-1!==1))throw Error('Invalid Window Use approval title marker');return {text,count:0};}
  for(const [before] of windowTitleReplacements)if(text.split(before).length-1!==1)throw Error('Pinned Window Use approval title changed');
  for(const [before,after] of windowTitleReplacements)text=text.replace(before,after);
  return {text,count:1};
}
function injectComputerUseManagement(text, relativePath) {
  if (relativePath !== COMPUTER_USE_MANAGEMENT_ASSET) return { text, count: 0 };
  const markers = text.split(MANAGEMENT_MARKER).length - 1;
  if (markers) {
    if (markers !== 1 || managementReplacements.some(([before, after]) =>
      text.split(after).length - 1 !== 1 || text.replace(after, "").includes(before))) {
      throw new Error("Invalid computer-use local-management injection marker");
    }
    return { text, count: 0 };
  }
  for (const [before] of managementReplacements) {
    if (text.split(before).length - 1 !== 1) throw new Error("Pinned computer-use local-management anchor must occur exactly once: " + before);
  }
  for (const [before, after] of managementReplacements) text = text.replace(before, after);
  return { text, count: 1 };
}
module.exports = { injectComputerUse, injectComputerUseSettings, injectComputerUseCancelRequest, injectComputerUseManagement,
  COMPUTER_USE_SETTINGS_ASSET, COMPUTER_USE_APPROVAL_CARD_ASSET, COMPUTER_USE_MANAGEMENT_ASSET,
  MANAGEMENT_MARKER, managementReplacements,
  SETTINGS_MARKER, SETTINGS_ANCHOR, SETTINGS_REPLACEMENT, CANCEL_MARKER, CANCEL_ANCHOR, CANCEL_REPLACEMENT,
  MARKER, replacements };

Object.assign(module.exports,{injectWindowApprovalTitle,WINDOW_TITLE_MARKER,windowTitleReplacements});
