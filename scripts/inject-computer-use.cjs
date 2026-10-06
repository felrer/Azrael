"use strict";
const MARKER = "/*azrael-computer-use-approvals-v1*/";
const COMPUTER_USE_SETTINGS_ASSET = "webview/assets/use-visible-settings-sections-4b8b7ed73a1e.js";
const SETTINGS_MARKER = "/*azrael-computer-use-settings-v1*/";
const SETTINGS_ANCHOR = 'case`computer-use`:return{visible:!1,pending:!1};';
const SETTINGS_REPLACEMENT = "case`computer-use`:return{visible:!0,pending:!1};" + SETTINGS_MARKER;
const COMPUTER_USE_APPROVAL_CARD_ASSET = "webview/assets/computer-use-app-approval-request-card-eebb16443520.js";
const CANCEL_MARKER = "/*azrael-computer-use-cancel-request-v1*/";
const CANCEL_ANCHOR = "{headerContent:I,title:L,subtitle:R,actions:W}";
const CANCEL_REPLACEMENT = '{headerContent:I,title:L,subtitle:R,actions:W,body:(0,k.jsx)(`button`,{type:`button`,disabled:z,onClick:()=>F(`cancel`),className:`text-sm text-token-text-secondary hover:text-token-text-primary disabled:opacity-50`,children:(0,k.jsx)(c,{id:`azrael.computerUse.cancelRequest`,defaultMessage:`Cancel request`})})}' + CANCEL_MARKER;
const COMPUTER_USE_MANAGEMENT_ASSET = "webview/assets/computer-use-settings-f7844e8d05eb.js";
const MANAGEMENT_MARKER = "/*azrael-computer-use-local-management-v1*/";
const managementReplacements = [
  ['function Vr(){let e=(0,Q.c)(26)', 'function Vr(){let e=(0,Q.c)(28)' + MANAGEMENT_MARKER],
  ["let y;e[21]===i.available?y=e[22]", "let y;e[21]===i.available&&e[26]===t&&e[27]===a?y=e[22]"],
  ["y=i.available?(0,$.jsxs)($.Fragment", "y=(t===`local`&&a===`windows`||i.available)?(0,$.jsxs)($.Fragment"],
  ['(0,$.jsx)(ri,{})', 'i.available&&(0,$.jsx)(ri,{})'],
  ['e[21]=i.available,e[22]=y', 'e[21]=i.available,e[26]=t,e[27]=a,e[22]=y'],
];
const access = 'require("./computer-use-approvals.cjs")';
const replacements = [
  ['onRequest:F=>{this.broadcastToAllViews({type:"mcp-request",hostId:"local",request:F})}', `onRequest:F=>{${access}.receive(F,(id,result)=>this.codexMcpConnection.sendResponse(id,result),request=>this.broadcastToAllViews({type:"mcp-request",hostId:"local",request}))}${MARKER}`],
  ['case"mcp-response":{let{id:n,result:o}=r.response;this.codexMcpConnection.sendResponse(n,o);break}', `case"mcp-response":{let{id:n,result:o}=r.response;this.codexMcpConnection.sendResponse(n,${access}.response(n,o));break}`],
  ['let{id:n,method:o,params:i}=r.request;this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(bR,String(n),o,i,r.retainResponse);break', `let{id:n,method:o,params:i}=r.request;${access}.outgoing(o,i);this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(bR,String(n),o,i,r.retainResponse);break`],
  ['interruptTurn:e=>this.sendInternalAppServerRequest("turn/interrupt",e)', `interruptTurn:e=>{${access}.stop(e?.threadId);return this.sendInternalAppServerRequest("turn/interrupt",e)}`],
  ['onFatalError:(F,V)=>{this.logger.error("Fatal error"', `onFatalError:(F,V)=>{${access}.reset();this.logger.error("Fatal error"`],
  ["onRawNotification:F=>{let{method:V,params:J}=F;this.broadcastToAllViews", `onRawNotification:F=>{let{method:V,params:J}=F;${access}.notification(V,J);this.broadcastToAllViews`],
  ["var YN=class extends ut{async getAppApprovals(){return null}async removeAppApproval(){return null}", `var YN=class extends ut{async getAppApprovals(){return ${access}.getAppApprovals()}async removeAppApproval(e){return ${access}.removeAppApproval(e)}`],
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
