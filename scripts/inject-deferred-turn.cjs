"use strict";

// The pinned native UI predates Azrael's nonterminal turn/deferred notification.
// Extend its existing reducer without invoking completion notifications, unread
// bookkeeping, automation follow-ups, or successful-task side effects.
const DEFERRED_REDUCER_ASSET = "webview/assets/app-initial-9f7d97690e9b.js";
const DEFERRED_PRESENTATION_ASSET = "webview/assets/app-initial-4bd9e54bcd58.js";

function replaceOnce(text, anchor, replacement) {
  if (text.split(anchor).length !== 2) {
    throw new Error("Pinned deferred-turn anchor must occur exactly once: " + anchor);
  }
  return text.replace(anchor, replacement);
}

function injectDeferredTurn(text) {
  // Native stable turns retain timing fields; the old lossy thin-turn projection is gone.
  const timingSchema = "turnStartedAtMs:Date.now(),durationMs:null,firstTurnWorkItemStartedAtMs:null,finalAssistantStartedAtMs:null,status:`inProgress`,error:null,diff:null,items:[]";
  if (text.split(timingSchema).length !== 2) throw new Error("Pinned deferred-turn native timing anchor must occur exactly once.");
  text = replaceOnce(text, "case`turn/completed`:{if(o.itemStreamState.drainBefore",
    "case`turn/deferred`:{" +
    "if(o.itemStreamState.drainBefore(()=>{a.onNotification(`turn/deferred`,t.params,n,i,r)}))return`deferred`;" +
    "let{threadId:s,turn:c}=t.params,l=H(s);" +
    "if(!o.threadStore.conversations.has(l)){a.logger.error(`Received turn/deferred for unknown conversation`,{safe:{conversationId:l},sensitive:{}});break}" +
    "o.updateTurnState(l,c.id,e=>{e.turnId=c.id;e.status=`deferred`;e.error=null;e.durationMs=c.durationMs;" +
    "if(c.startedAt!=null)e.turnStartedAtMs=c.startedAt*1e3});" +
    "a.broadcastConversationSnapshot(l);break}" +
    "case`turn/completed`:{if(o.itemStreamState.drainBefore");
  text = replaceOnce(text, "case`turn/started`:case`turn/completed`:case`turn/diff/updated`:",
    "case`turn/started`:case`turn/deferred`:case`turn/completed`:case`turn/diff/updated`:");
  return { text, count: 2, nativeTimingChecks: 1 };
}

function injectDeferredPresentation(text) {
  text = replaceOnce(text, "function Ont(e){switch(e){case`completed`:",
    "function Ont(e){switch(e){case`deferred`:return`deferred`;case`completed`:");
  text = replaceOnce(text,
    "function $mt({items:e,status:t,workStartedAtMs:n,finalAssistantStartedAtMs:r}){let i=eht(e,t);",
    "function $mt({items:e,status:t,workStartedAtMs:n,finalAssistantStartedAtMs:r}){" +
    "if(t===`deferred`)return[...e,{type:`worked-for`,status:n!=null&&r!=null?`azraelDeferred`:`pausedUnknown`,startedAtMs:n??0,completedAtMs:r??n??0}];" +
    "let i=eht(e,t);");
  text = replaceOnce(text, "finalAssistantStartedAtMs:y.finalAssistantStartedAtMs??null});return{items:o?jrt(se):se,hookRuns:y.hookRuns",
    "finalAssistantStartedAtMs:y.status===`deferred`?Hmt(y):y.finalAssistantStartedAtMs??null});return{items:o?jrt(se):se,hookRuns:y.hookRuns");
  text = replaceOnce(text, "bb0:switch(n){case`loading`:",
    "bb0:switch(n){case`azraelDeferred`:l=`${s} 작업 후 재개 대기`;break bb0;case`pausedUnknown`:l=`재개 대기`;break bb0;case`loading`:");
  return { text, count: 4 };
}

function injectDeferredHostNotification(text) {
  if (text.includes('"turn/deferred":!0,"turn/completed":!0')) {
    throw new Error("Pinned deferred-turn anchor must occur exactly once: already transformed.");
  }
  return { text: replaceOnce(text, '"turn/completed":!0', '"turn/deferred":!0,"turn/completed":!0'), count: 1 };
}

module.exports = { DEFERRED_REDUCER_ASSET, DEFERRED_PRESENTATION_ASSET, injectDeferredTurn, injectDeferredPresentation, injectDeferredHostNotification };
