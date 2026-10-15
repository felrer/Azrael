"use strict";

const ACCOUNT_QUEUE_CORE_ASSET = "webview/assets/app-initial-97d3534ad35f.js";
const ACCOUNT_QUEUE_PRESENTATION_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const ACCOUNT_QUEUE_LIST_ASSET = "webview/assets/queued-message-list-616ed03f7f35.js";
const ACCOUNT_QUEUE_PRESENTATION_PREFIX = "function vsn({scope:e,manager:t,appServerVersion:n}){";
const ACCOUNT_QUEUE_PRESENTATION_MARKER = "/*azrael-account-switch-queue-presentation-v2*/";
const ACCOUNT_QUEUE_PRESENTATION_PRELUDE = ACCOUNT_QUEUE_PRESENTATION_MARKER + "let __azraelPending=false;const __azraelRefreshAccount=async()=>{let n=await t.sendRequest(`azrael/account`,{action:`list`});if(typeof n?.state?.isSwitching!==`boolean`)throw Error(`Account switch state is unavailable`);if(l)return __azraelPending;if(__azraelPending!==n.state.isSwitching){__azraelPending=n.state.isSwitching;for(let e of a.keys())f(e)}return __azraelPending};";

// New conversations have no thread queue until creation succeeds. Retain the
// original creation closure while admission is pending, without using old auth.
async function __azraelCreateAfterAccountChange(manager, create, assertCurrent) {
  const rejected = error => error?.name === `AppServerRequestError(${String(error.code)})` &&
    error.jsonRpcCode === error.code && Number.isInteger(error.code) &&
    error.data?.azraelAdmission === "accountChangePending";
  let notice;
  try {
    for (;;) {
      manager.assertActive();
      await assertCurrent?.();
      const account = await manager.sendRequest("azrael/account", { action: "list" });
      if (typeof account?.state?.isSwitching !== "boolean") throw Error("Account switch state is unavailable");
      if (account.state.isSwitching) {
        if (!notice && typeof document !== "undefined") {
          notice = document.createElement("div");
          notice.setAttribute("role", "status");
          notice.setAttribute("aria-live", "polite");
          notice.setAttribute("data-azrael-account-wait", "");
          notice.textContent = "계정 전환 대기 중 · 요청은 대기열에 보관되어 있으며, 전환 완료 후 자동으로 전송됩니다.";
          notice.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:10000;max-width:calc(100% - 24px);padding:12px 16px;border-radius:12px;background:var(--vscode-editor-background);color:var(--vscode-foreground);border:1px solid var(--vscode-panel-border);box-shadow:0 4px 16px #0002;font-size:13px";
          document.body.appendChild(notice);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      try { return await create(); }
      catch (error) {
        if (!rejected(error)) throw error;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  } finally { notice?.remove(); }
}

function apply(text, owner, edits) {
  const marker = `/*azrael-account-switch-queue-${owner}-v2*/`;
  if (text.includes(`/*azrael-account-switch-queue-${owner}-v1*/`)) throw Error("Stale account-switch queue transform; use the pinned original asset");
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
    ["async function fkn(e,t,n,", "$MARKER" + __azraelCreateAfterAccountChange.toString() + ";async function fkn(e,t,n,"],
    ["()=>t.threadCreation.createConversation(se,r,", "()=>__azraelCreateAfterAccountChange(e,()=>t.threadCreation.createConversation(se,r,"],
    ["ce,N,v??c));w!=null", "ce,N,v??c),v??c));w!=null"],
    ["(await t.executeTurnStart(le,{request:", "(await __azraelCreateAfterAccountChange(e,()=>t.executeTurnStart(le,{request:"],
    ["x??l)).turn.id", "x??l),v??c)).turn.id"],
    ["let{conversationId:h,message:g}=e,_=await s(e);", "let{conversationId:h,message:g}=e;try{let _=await s(e);"],
    ["return{status:`sent`,messageId:g.id,turnId:x.turnId}}async function o", "return{status:`sent`,messageId:g.id,turnId:x.turnId}}catch(t){if(t?.name===`AppServerRequestError(${String(t.code)})`&&t.jsonRpcCode===t.code&&Number.isInteger(t.code)&&t.data?.azraelAdmission===`accountChangePending`)return i(h,g,e.editPosition,d,p,m);throw t}}async function o"],
    ["queueModeOverride:n==null?r.submission.queueModeOverride:`send-now`,editPosition:", "queueModeOverride:n==null?r.submission.queueModeOverride:`send-now`,explicitQueuedSteer:n!=null,editPosition:"],
    ["async function s(e){let t=await r(e);return t===`send-only`?t:e.queueModeOverride??t}", "async function s(t){if(await e.accountChangePending?.())return t.explicitQueuedSteer===!0&&t.queueModeOverride===`send-now`&&e.getActiveTurnId(t.conversationId)!=null?`send-now`:`queue-only`;let n=await r(t);return n===`send-only`?n:t.queueModeOverride??n}"],
    ["submissionHost:{needsResume:", "submissionHost:{accountChangePending:async()=>{let t=await e.sendRequest(`azrael/account`,{action:`list`});if(typeof t?.state?.isSwitching!==`boolean`)throw Error(`Account switch state is unavailable`);return t.state.isSwitching},needsResume:"],
  ]);
  if (relativePath === ACCOUNT_QUEUE_PRESENTATION_ASSET) return apply(text, "presentation", [
    [ACCOUNT_QUEUE_PRESENTATION_PREFIX, ACCOUNT_QUEUE_PRESENTATION_PREFIX + ACCOUNT_QUEUE_PRESENTATION_PRELUDE],
    ["canSendNow:!i};if(o)", "canSendNow:!i,...__azraelPending?{submission:{status:`queued`,accountChangePending:true}}:{}};if(o)"],
    ["y=async(e,n,a,o,s,c)=>{let d=await _(e)", "y=async(e,n,a,o,s,c)=>{await __azraelRefreshAccount();let d=await _(e)"],
    ["dispose(){l=!0,S(),g?.(),a.clear()", "dispose(){l=!0,__azraelAccountSubscription(),S(),g?.(),a.clear()"],
    ["return{isEnabled:u,canEnqueue:", "const __azraelAccountSubscription=t.addNotificationCallback(`azrael/account/updated`,()=>{__azraelRefreshAccount().catch(e=>Uh.warning(`Failed to refresh account queue status`,{safe:{},sensitive:{error:e}}))});return{isEnabled:u,canEnqueue:"],
    [
    "resume:i?void 0:async(e,n)=>{if(t.isConversationStreaming(e))return;",
    "resume:i?void 0:async(e,n)=>{if(await __azraelRefreshAccount()||t.isConversationStreaming(e))return;",
  ]]);
  if (relativePath === ACCOUNT_QUEUE_LIST_ASSET) return apply(text, "list", [
    ["N=(u?.status===`pending`||u?.status===`sending`)&&!l", "$MARKERN=u?.accountChangePending?`account-change`:(u?.status===`pending`||u?.status===`sending`)&&!l"],
    ["K=!N&&te?", "K=(!N||N===`account-change`)&&te?"],
    ["children:(0,$.jsx)(c,{id:`azrael.queuedMessage.awaitingAcceptance`,defaultMessage:`전송 대기 중`", "children:(0,$.jsx)(c,{id:N===`account-change`?`azrael.queuedMessage.accountChangePending`:`azrael.queuedMessage.awaitingAcceptance`,defaultMessage:N===`account-change`?`계정 전환 대기 중`:`전송 대기 중`"],
  ]);
  return { text, count: 0 };
}

module.exports = { ACCOUNT_QUEUE_CORE_ASSET, ACCOUNT_QUEUE_PRESENTATION_ASSET, ACCOUNT_QUEUE_LIST_ASSET, ACCOUNT_QUEUE_PRESENTATION_PREFIX, ACCOUNT_QUEUE_PRESENTATION_MARKER, ACCOUNT_QUEUE_PRESENTATION_PRELUDE, injectAccountSwitchQueue };
