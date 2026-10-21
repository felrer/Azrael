"use strict";

const QUESTION_QUEUE_CORE_ASSET = "webview/assets/app-initial-97d3534ad35f.js";
const QUESTION_QUEUE_PRESENTATION_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const QUESTION_QUEUE_LIST_ASSET = "webview/assets/queued-message-list-616ed03f7f35.js";
const QUESTION_QUEUE_ASSETS = [QUESTION_QUEUE_CORE_ASSET, QUESTION_QUEUE_PRESENTATION_ASSET, QUESTION_QUEUE_LIST_ASSET];

// Missing state is not evidence that a conversation has no unanswered questions.
function __azraelPendingQuestionCount(response) {
  const count = response?.pendingQuestionCount;
  if (!Number.isSafeInteger(count) || count < 0) throw Error("Pending question state is unavailable");
  return count;
}

function __azraelPendingResponseCounts(response) {
  const pendingQuestionCount = __azraelPendingQuestionCount(response);
  const pendingApprovalCount = response?.pendingApprovalCount;
  if (!Number.isSafeInteger(pendingApprovalCount) || pendingApprovalCount < 0) throw Error("Pending approval state is unavailable");
  return { pendingQuestionCount, pendingApprovalCount };
}

function editsFor(asset) {
  if (asset === QUESTION_QUEUE_CORE_ASSET) return [
    ["submissionHost:{accountChangePending:", "submissionHost:{hasPendingQuestions:async t=>{const c=__azraelPendingResponseCounts(await e.sendRequest(`thread/queue/list`,{threadId:t,limit:1}));return c.pendingQuestionCount>0||c.pendingApprovalCount>0},accountChangePending:"],
    ["if(!d()||r==null||!t.tryAcquireStartTurn(e)", "if(n==null&&await this.options.submissionHost.hasPendingQuestions(e))return;if(!d()||r==null||!t.tryAcquireStartTurn(e)"],
  ];
  if (asset === QUESTION_QUEUE_PRESENTATION_ASSET) return [
    ["function vsn({scope:e,manager:t,appServerVersion:n}){", "function vsn({scope:e,manager:t,appServerVersion:n}){const __azraelQuestionCounts=new Map;"],
    ["let n,r;do{s.delete(e),r=a.get(e)?.items,n=[];", "let n,r,__azraelCount;do{s.delete(e),r=a.get(e)?.items,n=[];"],
    ["n.push(...r.data),i=r.nextCursor", "__azraelCount=__azraelPendingResponseCounts(r),n.push(...r.data),i=r.nextCursor"],
    ["if(l)return;let i=a.get(e)", "if(l)return;__azraelQuestionCounts.set(e,__azraelCount);let i=a.get(e)"],
    ["if(o)return{...a,pausedReason:Lpt};", "if(__azraelQuestionCounts.get(e)?.pendingQuestionCount>0||__azraelQuestionCounts.get(e)?.pendingApprovalCount>0)a={...a,submission:{...a.submission,status:a.submission?.status??`queued`,...__azraelQuestionCounts.get(e)}};if(o)return{...a,pausedReason:Lpt};"],
    ["if(await __azraelRefreshAccount()||t.isConversationStreaming(e))return;let r=await _(e)", "if(await __azraelRefreshAccount()||t.isConversationStreaming(e))return;await m(e);if(__azraelQuestionCounts.get(e)?.pendingQuestionCount>0||__azraelQuestionCounts.get(e)?.pendingApprovalCount>0)return;let r=await _(e)"],
    ["dispose(){l=!0,__azraelAccountSubscription()", "dispose(){l=!0,__azraelQuestionCounts.clear(),__azraelAccountSubscription()"],
  ];
  if (asset === QUESTION_QUEUE_LIST_ASSET) return [
    ["N=u?.accountChangePending?`account-change`:", "N=u?.pendingQuestionCount>0&&u?.pendingApprovalCount>0?`response-wait`:u?.pendingApprovalCount>0?`approval-wait`:u?.pendingQuestionCount>0?`question-wait`:u?.accountChangePending?`account-change`:"],
    ["id:N===`account-change`?`azrael.queuedMessage.accountChangePending`", "id:N===`response-wait`?`azrael.queuedMessage.pendingResponses`:N===`approval-wait`?`azrael.queuedMessage.pendingApprovals`:N===`question-wait`?`azrael.queuedMessage.pendingQuestions`:N===`account-change`?`azrael.queuedMessage.accountChangePending`"],
    ["defaultMessage:N===`account-change`?", "defaultMessage:N===`response-wait`?`사용자 응답 대기`:N===`approval-wait`?`승인 응답 대기`:N===`question-wait`?`사용자 답변 대기 중`:N===`account-change`?"],
  ];
  return [];
}

function injectQuestionQueue(text, asset) {
  const edits = editsFor(asset);
  if (!edits.length) return { text, count: 0 };
  const marker = `/*azrael-question-queue-${QUESTION_QUEUE_ASSETS.indexOf(asset)}-v1*/`;
  if (text.includes(marker)) {
    if (text.split(marker).length !== 2 || edits.some(([, replacement]) => text.split(replacement).length !== 2)) throw Error("Partial question queue transform");
    return { text, count: 0 };
  }
  for (const [anchor, replacement] of edits) {
    if (text.split(anchor).length !== 2) throw Error(`Pinned question queue anchor must occur exactly once: ${anchor.slice(0, 100)}`);
    text = text.replace(anchor, replacement);
  }
  return { text: text + "\n" + marker + (asset === QUESTION_QUEUE_LIST_ASSET ? "" : "\n" + __azraelPendingQuestionCount.toString() + "\n" + __azraelPendingResponseCounts.toString()), count: 1 };
}

// Earlier transform owners validate their pinned boundaries against this exact
// inverse view. Validate the complete later transform first; never return this
// view as product output or accept a partial/duplicated question transform.
function questionQueueValidationView(text, asset) {
  const edits = editsFor(asset);
  if (!edits.length) return text;
  const marker = `/*azrael-question-queue-${QUESTION_QUEUE_ASSETS.indexOf(asset)}-v1*/`;
  if (text.includes(marker)) {
    injectQuestionQueue(text, asset);
    for (const [anchor, replacement] of [...edits].reverse()) text = text.replace(replacement, anchor);
  } else if (edits.some(([, replacement]) => text.includes(replacement))) {
    throw Error("Partial question queue transform: marker is missing");
  }
  return text;
}

module.exports = { QUESTION_QUEUE_ASSETS, QUESTION_QUEUE_CORE_ASSET, QUESTION_QUEUE_PRESENTATION_ASSET, QUESTION_QUEUE_LIST_ASSET, injectQuestionQueue, questionQueueEditsFor: editsFor, questionQueueValidationView, __azraelPendingQuestionCount, __azraelPendingResponseCounts };
