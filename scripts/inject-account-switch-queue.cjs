"use strict";

const ACCOUNT_QUEUE_CORE_ASSET = "webview/assets/app-initial-9f7d97690e9b.js";
const ACCOUNT_QUEUE_PRESENTATION_ASSET = "webview/assets/app-initial-9cbfb5c07b41.js";

function apply(text, owner, edits) {
  const marker = `/*azrael-account-switch-queue-${owner}-v1*/`;
  if (text.includes(marker)) {
    for (const [, replacement] of edits) {
      if (text.split(replacement.replace("$MARKER", marker)).length !== 2) throw Error("Partial account-switch queue transform");
    }
    return { text, count: 0 };
  }
  for (const [anchor, replacement] of edits) {
    if (text.split(anchor).length !== 2) throw Error(`Pinned account-switch queue anchor must occur exactly once: ${anchor.slice(0, 100)}`);
    text = text.replace(anchor, replacement.replace("$MARKER", marker));
  }
  return { text, count: 1 };
}

function injectAccountSwitchQueue(text, relativePath) {
  if (relativePath === ACCOUNT_QUEUE_CORE_ASSET) return apply(text, "core", [
    ["let{conversationId:h,message:g}=e,_=await s(e);", "let{conversationId:h,message:g}=e;$MARKERtry{let _=await s(e);"],
    ["return{status:`sent`,messageId:g.id,turnId:x.turnId}}async function o", "return{status:`sent`,messageId:g.id,turnId:x.turnId}}catch(t){if(t?.name===`AppServerRequestError(${String(t.code)})`&&t.jsonRpcCode===t.code&&Number.isInteger(t.code)&&t.data?.azraelAdmission===`accountChangePending`)return i(h,g,e.editPosition,d,p,m);throw t}}async function o"],
    ["async function s(e){let t=await r(e);return t===`send-only`?t:e.queueModeOverride??t}", "async function s(t){if(await e.accountChangePending?.())return`queue-only`;let n=await r(t);return n===`send-only`?n:t.queueModeOverride??n}"],
    ["submissionHost:{needsResume:", "submissionHost:{accountChangePending:async()=>{let t=await e.sendRequest(`azrael/account`,{action:`list`});if(typeof t?.state?.isSwitching!==`boolean`)throw Error(`Account switch state is unavailable`);return t.state.isSwitching},needsResume:"],
  ]);
  if (relativePath === ACCOUNT_QUEUE_PRESENTATION_ASSET) return apply(text, "presentation", [[
    "resume:i?void 0:async(e,n)=>{if(t.isConversationStreaming(e))return;",
    "resume:i?void 0:async(e,n)=>{$MARKERlet __azraelAccount=await t.sendRequest(`azrael/account`,{action:`list`});if(typeof __azraelAccount?.state?.isSwitching!==`boolean`)throw Error(`Account switch state is unavailable`);if(__azraelAccount.state.isSwitching||t.isConversationStreaming(e))return;",
  ]]);
  return { text, count: 0 };
}

module.exports = { ACCOUNT_QUEUE_CORE_ASSET, ACCOUNT_QUEUE_PRESENTATION_ASSET, injectAccountSwitchQueue };
