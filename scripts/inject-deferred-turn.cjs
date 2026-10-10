"use strict";

// The pinned native UI predates Azrael's nonterminal turn/deferred notification.
// Extend its existing reducer without invoking completion notifications, unread
// bookkeeping, automation follow-ups, or successful-task side effects.
const DEFERRED_REDUCER_ASSET = "webview/assets/app-initial-97d3534ad35f.js";
const DEFERRED_PRESENTATION_ASSET = "webview/assets/app-initial-c014f9ee4429.js";
const DEFERRED_WAIT_RENDERER_ASSET = "webview/assets/sites-end-resource-90d3046b3014.js";
const DEFERRED_THREAD_ASSET = "webview/assets/local-conversation-thread-2429c4b61076.js";
const DEFERRED_TURN_ASSET = "webview/assets/local-conversation-turn-9fb266d5c020.js";
const DEFERRED_COLLAPSED_ASSET = "webview/assets/collapsed-turn-disclosure-de639e3d6c71.js";
const DEFERRED_NOTIFICATION_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const { azraelHasDeferredBoundary, azraelNormalizeDeferredTurn, azraelMergeRootResumeWait,
  azraelRootResumeWaitItem, azraelRootResumeWaitLabel } = require("./root-resume-wait.cjs");
const recoveryHelpers = require("./root-resume-wait.cjs");

const boundaryHelpers = () => azraelHasDeferredBoundary.toString() + "\n" + azraelNormalizeDeferredTurn.toString() + "\n";

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
  // Reuse the native completion handler's converter, rather than a minified
  // alias from another module (the error classifier also accepts one argument).
  const converters = [...text.matchAll(/let\{threadId:s,turn:c\}=t\.params,l=([A-Za-z_$][\w$]*)\(s\);if\(!o\.threadStore\.conversations\.has\(l\)\)/g)];
  if (converters.length !== 1) throw new Error("Pinned deferred-turn native conversation converter anchor must occur exactly once.");
  const conversationId = converters[0][1];
  text = boundaryHelpers() + azraelMergeRootResumeWait.toString() + "\n" +
    "const azraelDeferredJournals=new WeakMap();\n" +
    ["azraelDeferredJournal", "azraelDeferredLog", "azraelMergeEndedRootResumeWait", "azraelFlushDeferred", "azraelReceiveDeferred", "azraelReconcileDeferredRestoration"]
      .map(name => recoveryHelpers[name].toString()).join("\n") + "\n" + text;
  text = replaceOnce(text, "),a.broadcastConversationSnapshot(c);break}case`turn/completed`:{",
    ");let azraelPrior=a.getConversation(c);" +
    "if(azraelPrior!=null&&vg(azraelPrior,t=>t.turnId!=null&&t.turnId!==i.id&&(t.status===`inProgress`||" +
    "t.status===`deferred`&&azraelHasDeferredBoundary(t)&&(t.rootResumeWait.state===`waiting`||" +
    "t.rootResumeWait.state===`claimed`||!Number.isFinite(t.durationMs)))))" +
    "azraelReconcileDeferredRestoration(a,o,vg,c,e,i.id);" +
    "a.broadcastConversationSnapshot(c);break}case`turn/completed`:{");
  text = replaceOnce(text, "case`turn/completed`:{if(o.itemStreamState.drainBefore",
    "case`turn/deferred`:{" +
    "if(o.itemStreamState.drainBefore(()=>{a.onNotification(`turn/deferred`,t.params,n,i,r)}))return`deferred`;" +
    `let{threadId:s,turn:c}=t.params,l=${conversationId}(s);` +
    "azraelReceiveDeferred(a,o,vg,l,s,c.id,c.rootResumeWait,c);" +
    "a.broadcastConversationSnapshot(l);break}" +
    "case`turn/rootResumeWait/updated`:{" +
    "if(o.itemStreamState.drainBefore(()=>{a.onNotification(`turn/rootResumeWait/updated`,t.params,n,i,r)}))return`deferred`;" +
    `let{threadId:s,turnId:c,wait:w}=t.params,l=${conversationId}(s);` +
    "azraelReceiveDeferred(a,o,vg,l,s,c,w,null);" +
    "a.broadcastConversationSnapshot(l);break}" +
    "case`turn/completed`:{if(o.itemStreamState.drainBefore");
  text = replaceOnce(text, "case`turn/started`:case`turn/completed`:case`turn/diff/updated`:",
    "case`turn/started`:case`turn/deferred`:case`turn/rootResumeWait/updated`:case`turn/completed`:case`turn/diff/updated`:");
  text = replaceOnce(text, "durationMs:t.durationMs,finalAssistantStartedAtMs:oxn(t.completedAt),status:t.status",
    "durationMs:t.status===`inProgress`&&azraelHasDeferredBoundary(t)?null:t.durationMs,rootResumeWait:t.rootResumeWait??null,finalAssistantStartedAtMs:oxn(t.completedAt),status:t.status===`inProgress`&&azraelHasDeferredBoundary(t)?`deferred`:t.status");
  text = replaceOnce(text, "policy:o}){let s=e.status!==`inProgress`&&t.status===`inProgress`",
    "policy:o}){if((e.status===`completed`||e.status===`interrupted`||e.status===`failed`)&&(t.status===`inProgress`||t.status===`deferred`))" +
    "t={...t,status:e.status,error:e.error,durationMs:e.durationMs,turnStartedAtMs:e.turnStartedAtMs," +
    "firstTurnWorkItemStartedAtMs:e.firstTurnWorkItemStartedAtMs,finalAssistantStartedAtMs:e.finalAssistantStartedAtMs,completedAt:e.completedAt};" +
    "e=azraelNormalizeDeferredTurn(e);t=azraelNormalizeDeferredTurn(t);let s=e.status!==`inProgress`&&t.status===`inProgress`");
  text = replaceOnce(text, "durationMs:e.durationMs??t.durationMs,finalAssistantStartedAtMs:",
    "durationMs:e.status===`deferred`&&t.status===`inProgress`?e.durationMs:t.durationMs??e.durationMs,rootResumeWait:azraelMergeRootResumeWait(e.rootResumeWait,t.rootResumeWait),finalAssistantStartedAtMs:");
  // A snapshot fetched before the defer boundary can arrive after its notification.
  // The same turn never becomes active again: resumption starts a new turn.
  text = replaceOnce(text, "status:s&&(i||!n&&c!=null)?e.status:t.status",
    "status:s&&(e.status===`deferred`||i||!n&&c!=null)?e.status:t.status");
  text = replaceOnce(text, "durationMs:e.durationMs??null});let s=n=>e.sendRequest(`thread/timeline/list`",
    "durationMs:e.durationMs??null,rootResumeWait:e.rootResumeWait??null});let s=n=>e.sendRequest(`thread/timeline/list`");
  text = replaceOnce(text, "completedAt:e.completedAt,durationMs:e.durationMs}));let p=new Set",
    "completedAt:e.completedAt,durationMs:e.durationMs,rootResumeWait:e.rootResumeWait??o.get(e.turnId)?.rootResumeWait??null}));let p=new Set");
  text = replaceOnce(text, "broadcastConversationSnapshot(e){return this.streamState.broadcastConversationSnapshot(e)}",
    "broadcastConversationSnapshot(e){azraelFlushDeferred(this,e);return this.streamState.broadcastConversationSnapshot(e)}");
  text = replaceOnce(text, "e.broadcastConversationSnapshot(f);let St=e.getConversation(f)?.turnsPagination??null",
    `azraelReconcileDeferredRestoration(e,e.notificationContext,vg,${conversationId}($e.thread.id),$e.thread.id);` +
    "e.broadcastConversationSnapshot(f);let St=e.getConversation(f)?.turnsPagination??null");
  return { text, count: 11, nativeTimingChecks: 1 };
}

function injectDeferredPresentation(text) {
  text = boundaryHelpers() + azraelRootResumeWaitItem.toString() + "\n" + azraelRootResumeWaitLabel.toString() + "\n" + text;
  text = replaceOnce(text, "y=v?.turn??e,{replyItemIds:b}=D_t(y.items)",
    "y=azraelNormalizeDeferredTurn(v?.turn??e),{replyItemIds:b}=D_t(y.items)");
  text = replaceOnce(text, "function Qit(e){switch(e){case`completed`:",
    "function Qit(e){switch(e){case`deferred`:return`deferred`;case`completed`:");
  text = replaceOnce(text,
    "function Cyt({items:e,status:t,workStartedAtMs:n,finalAssistantStartedAtMs:r}){let i=wyt(e,t);",
    "function Cyt(e){let{items:t,status:n,workStartedAtMs:r,finalAssistantStartedAtMs:i,rootResumeWait:w}=e;" +
    "let a=n===`deferred`?[...t,{type:`worked-for`,status:r!=null&&i!=null?`worked`:`pausedUnknown`,startedAtMs:r??0,completedAtMs:i??r??0}]:azraelOriginalWorkDivider(e);" +
    "let o=azraelRootResumeWaitItem(w);return o!=null?[...a,o]:n===`deferred`?[...a,{type:`worked-for`,status:`azraelWaitUnknown`,startedAtMs:0,completedAtMs:0}]:a}" +
    "function azraelOriginalWorkDivider({items:e,status:t,workStartedAtMs:n,finalAssistantStartedAtMs:r}){let i=wyt(e,t);");
  text = replaceOnce(text, "finalAssistantStartedAtMs:y.finalAssistantStartedAtMs??null});return{items:o?eot(se):se,hookRuns:y.hookRuns",
    "rootResumeWait:y.rootResumeWait??null,finalAssistantStartedAtMs:y.status===`deferred`||y.status===`completed`||y.status===`interrupted`||y.status===`failed`?fyt(y):y.finalAssistantStartedAtMs??null});return{items:o?eot(se):se,hookRuns:y.hookRuns");
  text = replaceOnce(text, "bb0:switch(n){case`loading`:",
    "if(e.rootResumeWait!=null)l=azraelRootResumeWaitLabel(e.rootResumeWait,c);else bb0:switch(n){case`azraelWaitUnknown`:l=`재개 대기 이력 · 대기 시간 확인 불가`;break bb0;case`pausedUnknown`:l=`작업 시간 확인 불가`;break bb0;case`loading`:");
  text = replaceOnce(text, "pMn(c,n===`working`&&i==null?1e3:null)",
    "pMn(c,(n===`working`||n===`azraelWaiting`)&&i==null?1e3:null)");
  text = replaceOnce(text, "e===`cancelled`?{type:`worked-for`,status:`unknown`,startedAtMs:n,completedAtMs:null}",
    "e===`cancelled`?{type:`worked-for`,status:r==null?`unknown`:`stopped`,startedAtMs:n,completedAtMs:r}");
  text = replaceOnce(text, "function Bzi(e){let t=(0,Uzi.c)(13)", "function Bzi(e){let t=(0,Uzi.c)(14)");
  text = replaceOnce(text, "t[0]!==a||t[1]!==i||t[2]!==r?(o=(0,E7.jsx)(zzi,{status:r,startedAtMs:i,completedAtMs:a}),t[0]=a,t[1]=i,t[2]=r,t[3]=o)",
    "t[0]!==a||t[1]!==i||t[2]!==r||t[13]!==e.rootResumeWait?(o=(0,E7.jsx)(zzi,{status:r,startedAtMs:i,completedAtMs:a,rootResumeWait:e.rootResumeWait}),t[0]=a,t[1]=i,t[2]=r,t[3]=o,t[13]=e.rootResumeWait)");
  return { text, count: 9 };
}

function injectDeferredHistoricalRow(text) {
  text = replaceOnce(text, "function eh(e){let t=(0,ih.c)(102)", "function eh(e){let t=(0,ih.c)(103)");
  text = replaceOnce(text, "ue=C(Mt,le),de=C(Et,le),fe=C(Se,le);", "ue=C(Mt,le),de=C(Et,le),fe=C(Se,le),azraelTurnDetails=C(kt,le);");
  text = replaceOnce(text, "t[7]!==le||t[8]!==`all`||t[9]!==pe", "t[102]!==azraelTurnDetails||t[7]!==le||t[8]!==`all`||t[9]!==pe");
  text = replaceOnce(text, "t[15]=fe,t[16]=me):me=t[16];let he=me", "t[15]=fe,t[16]=me,t[102]=azraelTurnDetails):me=t[16];let he=me");
  return { text, count: 4 };
}

function injectDeferredThread(text) {
  text = boundaryHelpers() + text;
  text = replaceOnce(text, "function fp(e,t,n,r,i,a){let o=new Set(n.itemIds)",
    "function fp(e,t,n,r,i,a){t=azraelNormalizeDeferredTurn(t);let azraelDeferred=t.status===`deferred`,azraelWait=t.rootResumeWait!=null;" +
    "if(n.state===`active`&&(azraelDeferred||t.status===`completed`||t.status===`interrupted`||t.status===`failed`)){" +
    "let end=t.turnStartedAtMs!=null&&t.durationMs!=null?t.turnStartedAtMs+t.durationMs:t.finalAssistantStartedAtMs??null;" +
    "n={...n,state:`terminal`,terminalReason:`turn`,completedAtMs:end}}" +
    "let o=new Set(n.itemIds)");
  text = replaceOnce(text, "durationMs:n.completedAtMs==null||n.startedAtMs==null?null:Math.max(n.completedAtMs-n.startedAtMs,0),firstTurnWorkItemStartedAtMs:c?null:n.startedAtMs",
    "durationMs:azraelDeferred?t.durationMs:n.completedAtMs==null||n.startedAtMs==null?null:Math.max(n.completedAtMs-n.startedAtMs,0),firstTurnWorkItemStartedAtMs:azraelDeferred?t.firstTurnWorkItemStartedAtMs??t.turnStartedAtMs:c?null:n.startedAtMs");
  text = replaceOnce(text, "turnStartedAtMs:n.startedAtMs},d=xp", "turnStartedAtMs:azraelDeferred?t.turnStartedAtMs:n.startedAtMs},d=xp");
  text = replaceOnce(text, "p=n.presentation===`voice-work`&&n.state!==`active`?pp(t,n):void 0,m=p==null&&!c?f:",
    "p=!azraelDeferred&&!azraelWait&&n.presentation===`voice-work`&&n.state!==`active`?pp(t,n):void 0,m=azraelDeferred||azraelWait||p==null&&!c?f:");
  const historical = injectDeferredHistoricalRow(text);
  return { text: historical.text, count: 4 + historical.count };
}

function injectDeferredTurnView(text) {
  text = replaceOnce(text, "K=Ge==null?b.status===`in_progress`:Ge===`inProgress`",
    "K=b.status===`deferred`?false:Ge==null?b.status===`in_progress`:Ge===`inProgress`");
  text = replaceOnce(text, "ft=!q&&!et&&v?.status===`interrupted`&&we?",
    "ft=!q&&!et&&v?.status===`interrupted`&&v.rootResumeWait==null&&we?");
  text = replaceOnce(text, "Ai.filter(e=>e.type!==`worked-for`||n===`all`&&ft==null)",
    "Ai.filter(e=>e.type!==`worked-for`||e.rootResumeWait!=null||y.status===`deferred`||n===`all`&&ft==null)");
  return { text, count: 3 };
}

function injectDeferredCollapsed(text) {
  text = replaceOnce(text, "t[0]!==o||t[1]!==a.completedAtMs||t[2]!==a.startedAtMs||t[3]!==a.status?",
    "t[0]!==o||t[1]!==a.completedAtMs||t[2]!==a.startedAtMs||t[3]!==a.status||t[4]?.props?.rootResumeWait!==a.rootResumeWait?");
  text = replaceOnce(text, "className:o,status:a.status,startedAtMs:a.startedAtMs,completedAtMs:a.completedAtMs}",
    "className:o,status:a.status,startedAtMs:a.startedAtMs,completedAtMs:a.completedAtMs,rootResumeWait:a.rootResumeWait}");
  return { text, count: 2 };
}

function injectDeferredWaitRenderer(text) {
  text = replaceOnce(text, "t[289]!==n.completedAtMs||t[290]!==n.startedAtMs||t[291]!==n.status||t[292]!==fe?",
    "t[289]!==n.completedAtMs||t[290]!==n.startedAtMs||t[291]!==n.status||t[292]!==fe||t[293]?.props?.rootResumeWait!==n.rootResumeWait?");
  text = replaceOnce(text, "leadingAccessory:fe,status:n.status,startedAtMs:n.startedAtMs,completedAtMs:n.completedAtMs}",
    "leadingAccessory:fe,status:n.status,startedAtMs:n.startedAtMs,completedAtMs:n.completedAtMs,rootResumeWait:n.rootResumeWait}");
  return { text, count: 2 };
}

function injectDeferredHostNotification(text) {
  const admission = '"turn/deferred":!0,"turn/rootResumeWait/updated":!0,"turn/completed":!0';
  if (text.includes('"turn/deferred":!0') || text.includes('"turn/rootResumeWait/updated":!0')) {
    if (text.split(admission).length === 2 && text.split('"turn/deferred":!0').length === 2 &&
        text.split('"turn/rootResumeWait/updated":!0').length === 2 && text.split('"turn/completed":!0').length === 2) {
      return { text, count: 0 };
    }
    throw new Error("Pinned deferred-turn anchor must occur exactly once: incomplete or duplicated notification admission.");
  }
  return { text: replaceOnce(text, '"turn/completed":!0', admission), count: 1 };
}

// The renderer has its own notification admission table before the reducer.
// Both transport boundaries must admit these methods.
const injectDeferredRendererNotification = injectDeferredHostNotification;

module.exports = { DEFERRED_REDUCER_ASSET, DEFERRED_PRESENTATION_ASSET, DEFERRED_WAIT_RENDERER_ASSET, DEFERRED_THREAD_ASSET, DEFERRED_TURN_ASSET, DEFERRED_COLLAPSED_ASSET, DEFERRED_NOTIFICATION_ASSET,
  injectDeferredTurn, injectDeferredPresentation, injectDeferredWaitRenderer, injectDeferredThread, injectDeferredTurnView, injectDeferredCollapsed, injectDeferredHostNotification, injectDeferredRendererNotification, injectDeferredHistoricalRow };
