"use strict";

const QUESTION_WITHDRAWAL_ASSETS = [
  "webview/assets/app-initial-c014f9ee4429.js",
  "webview/assets/sites-end-resource-90d3046b3014.js",
  "webview/assets/app-initial-97d3534ad35f.js",
];
const QUESTION_WITHDRAWAL_MARKER = "/*azrael-question-withdrawal-v1*/";
const STATE_EDITS = [
  ["function Jv(e){return(e.questions??[]).map((t,n)=>({id:Eje(e.id,n),sourceItemId:e.id,questionIndex:n,title:t.title,options:t.options??[]}))}",
   "function Jv(e,includeWithdrawn=!1){return(e.questions??[]).map((t,n)=>({id:Eje(e.id,n),sourceItemId:e.id,questionIndex:n,title:t.title,options:t.options??[],withdrawn:t.withdrawn===!0})).filter(t=>includeWithdrawn||!t.withdrawn)}"],
  ["e=>qv(e)?[e.id,...Jv(e).map(e=>e.id)]", "e=>qv(e)?[e.id,...Jv(e,!0).map(e=>e.id)]"],
  ["d&&qv(n)?w.push(...Jv(n).map", "d&&qv(n)?w.push(...Jv(n,!0).map"],
  ["requestUserInputAsync:{sourceItemId:e.sourceItemId,questionIndex:e.questionIndex}", "requestUserInputAsync:{sourceItemId:e.sourceItemId,questionIndex:e.questionIndex,withdrawn:e.withdrawn}"],
];
const RENDER_EDIT = ["function $D(e){let t=(0,aO.c)(30)", "function __azraelActiveQuestionItem(e){let t=(0,aO.c)(30)"];
// The conversation index owns both the sidebar's pending IDs and its update
// invalidation. Filter after assigning the original index, as in Jv above.
const INDEX_EDITS = [
  ["function Nxn(e){return Rxn(e)?(e.questions??[]).map((t,n)=>Re(e.id,n)):[]}",
   "function Nxn(e){return Rxn(e)?(e.questions??[]).flatMap((t,n)=>t.withdrawn===!0?[]:[Re(e.id,n)]):[]}"],
];
function once(text, before, after) {
  if (text.split(before).length !== 2) throw Error("Pinned question withdrawal anchor must occur exactly once: " + before.slice(0, 100));
  return text.replace(before, after);
}

// A separate component preserves native hook ordering when an active question
// changes into history. Consult the source atom as well as the projection:
// virtualized/history projections can outlive an item/completed upsert.
const QUESTION_BOUNDARY = `
function $D(e){return(0,oO.jsx)(__azraelQuestionBoundary,e)}
function __azraelQuestionBoundary(e){
 const item=e.item,question=item.type==="assistant-message"?item.requestUserInputAsync:null;
 const source=Be(Ji,question&&e.historyEntityKey!=null?{hostId:e.hostId,threadId:e.conversationId,entityKey:e.historyEntityKey,itemId:question.sourceItemId}:null);
 const withdrawn=question!=null&&(source?.type==="agentMessage"?source.questions?.[question.questionIndex]?.withdrawn===true:question.withdrawn===true);
 if(!withdrawn)return(0,oO.jsx)(__azraelActiveQuestionItem,e);
 return(0,oO.jsxs)("details",{className:"group min-w-0 rounded-lg border border-default px-3 py-2 text-sm text-secondary","data-azrael-withdrawn-question":item.searchItemId,children:[
  (0,oO.jsx)("summary",{className:"cursor-interaction select-none",children:"철회된 질문"}),
  (0,oO.jsx)("div",{className:"mt-2 whitespace-pre-wrap break-words text-default",children:source?.questions?.[question.questionIndex]?.title??item.content})
 ]});
}
`;

function injectQuestionWithdrawal(text, relativePath) {
  if (!QUESTION_WITHDRAWAL_ASSETS.includes(relativePath)) return { text, count: 0 };
  const markers = text.split(QUESTION_WITHDRAWAL_MARKER).length - 1;
  if (markers === 1) {
    const edits = relativePath === QUESTION_WITHDRAWAL_ASSETS[0] ? STATE_EDITS : relativePath === QUESTION_WITHDRAWAL_ASSETS[2] ? INDEX_EDITS : [RENDER_EDIT];
    for (const [before, after] of edits) {
      if (text.includes(before) || text.split(after).length !== 2) throw Error("Incomplete question withdrawal transform: " + after.slice(0, 90));
    }
    if (relativePath === QUESTION_WITHDRAWAL_ASSETS[1] && text.split(QUESTION_BOUNDARY).length !== 2) throw Error("Incomplete question withdrawal boundary");
    return { text, count: 0 };
  }
  if (markers) throw Error("Duplicate question withdrawal marker");
  if (relativePath === QUESTION_WITHDRAWAL_ASSETS[0]) {
    for (const [before, after] of STATE_EDITS) text = once(text, before, after);
  } else if (relativePath === QUESTION_WITHDRAWAL_ASSETS[2]) {
    for (const [before, after] of INDEX_EDITS) text = once(text, before, after);
  } else {
    text = once(text, ...RENDER_EDIT);
    text += QUESTION_BOUNDARY;
  }
  return { text: text + "\n" + QUESTION_WITHDRAWAL_MARKER + "\n", count: 1 };
}

module.exports = { QUESTION_WITHDRAWAL_ASSETS, QUESTION_WITHDRAWAL_MARKER, QUESTION_BOUNDARY, injectQuestionWithdrawal };
