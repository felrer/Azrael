"use strict";
const { createApprovalProjection, approvalSelectorInputs, approvalResponseOrigin } = require("./team-approval-routing.cjs");
const APP_ASSET = "webview/assets/app-initial-97d3534ad35f.js";
const BRIDGE_ASSET = "webview/assets/app-initial-c014f9ee4429.js";
const TEAM_APPROVAL_ASSETS = [APP_ASSET, BRIDGE_ASSET];
const MARKER = "/*azrael-team-approvals-v1*/";
const APP_HELPERS = `${createApprovalProjection}\n${approvalResponseOrigin}\nlet azraelApprovalRegistry=null;const azraelApprovalProjection=createApprovalProjection({registry:()=>azraelApprovalRegistry,turns:c=>$Z(c),parent:c=>c?.parentThreadId??uQ(c?.source)?.parentThreadId});globalThis.addEventListener?.("message",event=>{if(event.data?.type==="persisted-atom-sync"&&(azraelApprovalRegistry==null||Object.hasOwn(event.data.state??{},"azrael-team-registry-v1"))){azraelApprovalRegistry=event.data.state?.["azrael-team-registry-v1"]??{teams:[]};azraelApprovalProjection.refresh()}});`;
function injectTeamApprovals(text, asset) {
  if (!TEAM_APPROVAL_ASSETS.includes(asset)) return { text, count: 0 };
  const edits = asset === APP_ASSET ? [
    ["setConversation(e,{historyInvalidation:t,changedItems:n,patches:r,acceptedTranscriptText:i}={}){", "setConversation(e,{historyInvalidation:t,changedItems:n,patches:r,acceptedTranscriptText:i}={}){azraelApprovalProjection.observe(this);"],
    ["updateConversationState(e,t,{broadcastPatchesToFollowers:n=!0,knownHistoryInvalidation:r,knownChangedItems:i,acceptedTranscriptText:a}={}){", "updateConversationState(e,t,{broadcastPatchesToFollowers:n=!0,knownHistoryInvalidation:r,knownChangedItems:i,acceptedTranscriptText:a}={}){azraelApprovalProjection.observe(this);"],
    ...["vSn", "ySn", "bSn", "SSn"].map(name => [`function ${name}(e,t,n,r){`, `function ${name}(e,t,n,r){const azraelOrigin=approvalResponseOrigin(e,t,n);if(azraelOrigin==null)return;if(azraelOrigin.conversationId!==t)return ${name}(e,azraelOrigin.conversationId,azraelOrigin.requestId,r);`]),
    ["onApprovalRequest:l,onUserInputRequest:u", "onApprovalRequest:azraelNativeApproval,onUserInputRequest:u"],
    ["let{id:p,method:m,params:h}=t;function g(e,t,n)", "let l=details=>{const owner=azraelApprovalProjection.owner(e,details.conversationId);if(owner!=null)azraelNativeApproval({...details,conversationId:owner})};let{id:p,method:m,params:h}=t;function g(e,t,n)"],
  ] : [
    ["function sLt(e,t,n){", "function sLt(e,t,n){[e,t]=approvalSelectorInputs(e,t);"],
    ["function lLt(e,t,n=!1){", "function lLt(e,t,n=!1){[e,t]=approvalSelectorInputs(e,t);"],
    ["for(let a=e.length-1;a>=0;--a){let o=e[a];switch(o.method)", "for(let a=e.length-1;a>=0;--a){let o=e[a];if(o.__azraelTeamApprovalHidden)continue;switch(o.method)"],
  ];
  const helper = asset === APP_ASSET ? APP_HELPERS : approvalSelectorInputs.toString();
  const count = token => text.split(token).length - 1;
  if (count(MARKER)) {
    if (count(MARKER) !== 1 || count(helper) !== 1 || edits.some(([, replacement]) => count(replacement) !== 1)) throw Error("Damaged Team approval injection");
    return { text, count: 0 };
  }
  for (const [anchor, replacement] of edits) {
    if (count(anchor) !== 1) throw Error(`Pinned Team approval anchor changed: ${anchor}`);
    text = text.replace(anchor, replacement);
  }
  return { text: text + "\n" + MARKER + "\n" + helper + "\n", count: 1 };
}
module.exports = { injectTeamApprovals, TEAM_APPROVAL_ASSETS, APP_ASSET, BRIDGE_ASSET, MARKER };
