"use strict";

// The pinned native UI predates Azrael's nonterminal turn/deferred notification.
// Extend its existing reducer without invoking completion notifications, unread
// bookkeeping, automation follow-ups, or successful-task side effects.
const DEFERRED_REDUCER_ASSET = "webview/assets/app-initial-efe028fd535e.js";
const DEFERRED_PRESENTATION_ASSET = "webview/assets/app-initial-5120fa5fe295.js";
const DEFERRED_WAIT_RENDERER_ASSET = "webview/assets/connector-asset-title-query-69906f81188e.js";
const DEFERRED_THREAD_ASSET = "webview/assets/local-conversation-thread-8f3221bfc636.js";
const DEFERRED_TURN_ASSET = "webview/assets/local-conversation-turn-4aa6f571456a.js";
const DEFERRED_COLLAPSED_ASSET = "webview/assets/collapsed-turn-disclosure-2f7026e8d6c9.js";
const { azraelMergeRootResumeWait, azraelRootResumeWaitItem, azraelRootResumeWaitLabel } = require("./root-resume-wait.cjs");

function replaceOnce(text, anchor, replacement) {
  if (text.split(anchor).length !== 2) {
    throw new Error("Pinned deferred-turn anchor must occur exactly once: " + anchor);
  }
  return text.replace(anchor, replacement);
}

function injectDeferredTurn(text) {
  if (text.includes("function azraelMergeRootResumeWait(")) {
    throw new Error("Pinned deferred-turn anchor must occur exactly once: already transformed.");
  }
  // Native stable turns retain timing fields; the old lossy thin-turn projection is gone.
  const timingSchema = "turnStartedAtMs:Date.now(),durationMs:null,firstTurnWorkItemStartedAtMs:null,finalAssistantStartedAtMs:null,status:`inProgress`,error:null,diff:null,items:[]";
  if (text.split(timingSchema).length !== 2) throw new Error("Pinned deferred-turn native timing anchor must occur exactly once.");
  text = azraelMergeRootResumeWait.toString() + "\n" + text;
  text = replaceOnce(text, "case`turn/completed`:{if(o.itemStreamState.drainBefore",
    "case`turn/deferred`:{" +
    "if(o.itemStreamState.drainBefore(()=>{a.onNotification(`turn/deferred`,t.params,n,i,r)}))return`deferred`;" +
    "let{threadId:s,turn:c}=t.params,l=m(s);" +
    "if(!o.threadStore.conversations.has(l)){a.logger.error(`Received turn/deferred for unknown conversation`,{safe:{conversationId:l},sensitive:{}});break}" +
    "o.updateTurnState(l,c.id,e=>{if(e.status===`completed`||e.status===`interrupted`||e.status===`failed`)return;" +
    "e.turnId=c.id;e.status=`deferred`;e.error=null;e.durationMs=c.durationMs;" +
    "e.rootResumeWait=azraelMergeRootResumeWait(e.rootResumeWait,c.rootResumeWait);" +
    "if(c.startedAt!=null)e.turnStartedAtMs=c.startedAt*1e3});" +
    "a.broadcastConversationSnapshot(l);break}" +
    "case`turn/rootResumeWait/updated`:{" +
    "if(o.itemStreamState.drainBefore(()=>{a.onNotification(`turn/rootResumeWait/updated`,t.params,n,i,r)}))return`deferred`;" +
    "let{threadId:s,turnId:c,wait:w}=t.params,l=m(s);" +
    "if(!o.threadStore.conversations.has(l))break;" +
    "o.updateTurnState(l,c,e=>{e.rootResumeWait=azraelMergeRootResumeWait(e.rootResumeWait,w)});" +
    "a.broadcastConversationSnapshot(l);break}" +
    "case`turn/completed`:{if(o.itemStreamState.drainBefore");
  text = replaceOnce(text, "case`turn/started`:case`turn/completed`:case`turn/diff/updated`:",
    "case`turn/started`:case`turn/deferred`:case`turn/rootResumeWait/updated`:case`turn/completed`:case`turn/diff/updated`:");
  text = replaceOnce(text, "durationMs:t.durationMs,finalAssistantStartedAtMs:Iyn(t.completedAt),status:t.status",
    "durationMs:t.durationMs,rootResumeWait:t.rootResumeWait??null,finalAssistantStartedAtMs:Iyn(t.completedAt),status:t.status");
  text = replaceOnce(text, "durationMs:e.durationMs??t.durationMs,finalAssistantStartedAtMs:",
    "durationMs:t.durationMs??e.durationMs,rootResumeWait:azraelMergeRootResumeWait(e.rootResumeWait,t.rootResumeWait),finalAssistantStartedAtMs:");
  text = replaceOnce(text, "durationMs:e.durationMs??null});let s=n=>e.sendRequest(`thread/timeline/list`",
    "durationMs:e.durationMs??null,rootResumeWait:e.rootResumeWait??null});let s=n=>e.sendRequest(`thread/timeline/list`");
  text = replaceOnce(text, "completedAt:e.completedAt,durationMs:e.durationMs}));let p=new Set",
    "completedAt:e.completedAt,durationMs:e.durationMs,rootResumeWait:e.rootResumeWait??o.get(e.turnId)?.rootResumeWait??null}));let p=new Set");
  return { text, count: 6, nativeTimingChecks: 1 };
}

function injectDeferredPresentation(text) {
  text = azraelRootResumeWaitItem.toString() + "\n" + azraelRootResumeWaitLabel.toString() + "\n" + text;
  text = replaceOnce(text, "function _it(e){switch(e){case`completed`:",
    "function _it(e){switch(e){case`deferred`:return`deferred`;case`completed`:");
  text = replaceOnce(text,
    "function Hgt({items:e,status:t,workStartedAtMs:n,finalAssistantStartedAtMs:r}){let i=Ugt(e,t);",
    "function Hgt(e){let{items:t,status:n,workStartedAtMs:r,finalAssistantStartedAtMs:i,rootResumeWait:w}=e;" +
    "let a=n===`deferred`?[...t,{type:`worked-for`,status:r!=null&&i!=null?`worked`:`pausedUnknown`,startedAtMs:r??0,completedAtMs:i??r??0}]:azraelOriginalWorkDivider(e);" +
    "let o=azraelRootResumeWaitItem(w);return o!=null?[...a,o]:n===`deferred`?[...a,{type:`worked-for`,status:`azraelWaitUnknown`,startedAtMs:0,completedAtMs:0}]:a}" +
    "function azraelOriginalWorkDivider({items:e,status:t,workStartedAtMs:n,finalAssistantStartedAtMs:r}){let i=Ugt(e,t);");
  text = replaceOnce(text, "finalAssistantStartedAtMs:y.finalAssistantStartedAtMs??null});return{items:o?bat(ce):ce,hookRuns:y.hookRuns",
    "rootResumeWait:y.rootResumeWait??null,finalAssistantStartedAtMs:y.status===`deferred`||y.status===`completed`||y.status===`interrupted`||y.status===`failed`?jgt(y):y.finalAssistantStartedAtMs??null});return{items:o?bat(ce):ce,hookRuns:y.hookRuns");
  text = replaceOnce(text, "bb0:switch(n){case`loading`:",
    "if(e.rootResumeWait!=null)l=azraelRootResumeWaitLabel(e.rootResumeWait,c);else bb0:switch(n){case`azraelWaitUnknown`:l=`재개 대기 이력 · 대기 시간 확인 불가`;break bb0;case`pausedUnknown`:l=`작업 시간 확인 불가`;break bb0;case`loading`:");
  text = replaceOnce(text, "Wbn(c,n===`working`&&i==null?1e3:null)",
    "Wbn(c,(n===`working`||n===`azraelWaiting`)&&i==null?1e3:null)");
  text = replaceOnce(text, "e===`cancelled`?{type:`worked-for`,status:`unknown`,startedAtMs:n,completedAtMs:null}",
    "e===`cancelled`?{type:`worked-for`,status:r==null?`unknown`:`stopped`,startedAtMs:n,completedAtMs:r}");
  text = replaceOnce(text, "function LFi(e){let t=(0,BFi.c)(13)", "function LFi(e){let t=(0,BFi.c)(14)");
  text = replaceOnce(text, "t[0]!==a||t[1]!==i||t[2]!==r?(o=(0,k7.jsx)(IFi,{status:r,startedAtMs:i,completedAtMs:a}),t[0]=a,t[1]=i,t[2]=r,t[3]=o)",
    "t[0]!==a||t[1]!==i||t[2]!==r||t[13]!==e.rootResumeWait?(o=(0,k7.jsx)(IFi,{status:r,startedAtMs:i,completedAtMs:a,rootResumeWait:e.rootResumeWait}),t[0]=a,t[1]=i,t[2]=r,t[3]=o,t[13]=e.rootResumeWait)");
  return { text, count: 8 };
}

function injectDeferredThread(text) {
  text = replaceOnce(text, "function lp(e,t,n,r,i,a){let o=new Set(n.itemIds)",
    "function lp(e,t,n,r,i,a){let azraelDeferred=t.status===`deferred`,azraelWait=t.rootResumeWait!=null;" +
    "if(n.state===`active`&&(azraelDeferred||t.status===`completed`||t.status===`interrupted`||t.status===`failed`)){" +
    "let end=t.turnStartedAtMs!=null&&t.durationMs!=null?t.turnStartedAtMs+t.durationMs:t.finalAssistantStartedAtMs??null;" +
    "n={...n,state:`terminal`,terminalReason:`turn`,completedAtMs:end}}" +
    "let o=new Set(n.itemIds)");
  text = replaceOnce(text, "durationMs:n.completedAtMs==null||n.startedAtMs==null?null:Math.max(n.completedAtMs-n.startedAtMs,0),firstTurnWorkItemStartedAtMs:c?null:n.startedAtMs",
    "durationMs:azraelDeferred?t.durationMs:n.completedAtMs==null||n.startedAtMs==null?null:Math.max(n.completedAtMs-n.startedAtMs,0),firstTurnWorkItemStartedAtMs:azraelDeferred?t.firstTurnWorkItemStartedAtMs??t.turnStartedAtMs:c?null:n.startedAtMs");
  text = replaceOnce(text, "turnStartedAtMs:n.startedAtMs},d=vp", "turnStartedAtMs:azraelDeferred?t.turnStartedAtMs:n.startedAtMs},d=vp");
  text = replaceOnce(text, "p=n.presentation===`voice-work`&&n.state!==`active`?up(t,n):void 0,m=p==null&&!c?f:",
    "p=!azraelDeferred&&!azraelWait&&n.presentation===`voice-work`&&n.state!==`active`?up(t,n):void 0,m=azraelDeferred||azraelWait||p==null&&!c?f:");
  return { text, count: 4 };
}

function injectDeferredTurnView(text) {
  text = replaceOnce(text, "G=qe==null?y.status===`in_progress`:qe===`inProgress`",
    "G=y.status===`deferred`?false:qe==null?y.status===`in_progress`:qe===`inProgress`");
  text = replaceOnce(text, "ht=!K&&!J&&v?.status===`interrupted`&&Te?",
    "ht=!K&&!J&&v?.status===`interrupted`&&v.rootResumeWait==null&&Te?");
  text = replaceOnce(text, "Mi.filter(e=>e.type!==`worked-for`||n===`all`&&ht==null)",
    "Mi.filter(e=>e.type!==`worked-for`||e.rootResumeWait!=null||y.status===`deferred`||n===`all`&&ht==null)");
  return { text, count: 3 };
}

function injectDeferredCollapsed(text) {
  text = replaceOnce(text, "t[0]!==a||t[1]!==i.completedAtMs||t[2]!==i.startedAtMs||t[3]!==i.status?",
    "t[0]!==a||t[1]!==i.completedAtMs||t[2]!==i.startedAtMs||t[3]!==i.status||t[4]?.props?.rootResumeWait!==i.rootResumeWait?");
  text = replaceOnce(text, "className:a,status:i.status,startedAtMs:i.startedAtMs,completedAtMs:i.completedAtMs}",
    "className:a,status:i.status,startedAtMs:i.startedAtMs,completedAtMs:i.completedAtMs,rootResumeWait:i.rootResumeWait}");
  return { text, count: 2 };
}

function injectDeferredWaitRenderer(text) {
  text = replaceOnce(text, "t[289]!==n.completedAtMs||t[290]!==n.startedAtMs||t[291]!==n.status||t[292]!==de?",
    "t[289]!==n.completedAtMs||t[290]!==n.startedAtMs||t[291]!==n.status||t[292]!==de||t[293]?.props?.rootResumeWait!==n.rootResumeWait?");
  text = replaceOnce(text, "leadingAccessory:de,status:n.status,startedAtMs:n.startedAtMs,completedAtMs:n.completedAtMs}",
    "leadingAccessory:de,status:n.status,startedAtMs:n.startedAtMs,completedAtMs:n.completedAtMs,rootResumeWait:n.rootResumeWait}");
  return { text, count: 2 };
}

function injectDeferredHostNotification(text) {
  if (text.includes('"turn/deferred":!0')) {
    throw new Error("Pinned deferred-turn anchor must occur exactly once: already transformed.");
  }
  return { text: replaceOnce(text, '"turn/completed":!0', '"turn/deferred":!0,"turn/rootResumeWait/updated":!0,"turn/completed":!0'), count: 1 };
}

module.exports = { DEFERRED_REDUCER_ASSET, DEFERRED_PRESENTATION_ASSET, DEFERRED_WAIT_RENDERER_ASSET, DEFERRED_THREAD_ASSET, DEFERRED_TURN_ASSET, DEFERRED_COLLAPSED_ASSET,
  injectDeferredTurn, injectDeferredPresentation, injectDeferredWaitRenderer, injectDeferredThread, injectDeferredTurnView, injectDeferredCollapsed, injectDeferredHostNotification };
