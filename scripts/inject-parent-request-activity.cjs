"use strict";

const ASSETS = ["webview/assets/app-initial-c014f9ee4429.js", "webview/assets/sites-end-resource-90d3046b3014.js"];
const MARKER = "/*azrael-parent-request-activity-v1*/";
// The native activity row owns avatar, text geometry, offset and theme. The
// only action here is disclosure; responses remain owned by the parent agent.
const HELPER = `function azraelParentRequestActivity({item:n}){
 const intl=g(),ko=intl.locale?.startsWith("ko"),[open,setOpen]=iE.useState(false),p=n.parentRequest;
 const labels=ko?{pending:"판단 요청",resolved:"판단 완료",deferred:"판단 보류",cancelled:"요청 취소"}:{pending:"Decision requested",resolved:"Decision completed",deferred:"Decision deferred",cancelled:"Request cancelled"};
 const fields=[[ko?"질문":"Question",p.question],[ko?"맥락":"Context",p.context],[ko?"추천":"Recommendation",p.recommendation],[ko?"대기 중인 작업":"Blocked action",p.blockedAction],[ko?"판단":"Decision",p.response?.decision],[ko?"이유":"Reason",p.response?.reason],[ko?"재시도 조건":"Retry condition",p.response?.retryCondition]];
 const detailId="azrael-parent-request-"+p.requestId;
 return aE.jsxs(al,{padding:"offset",children:[aE.jsx("button",{type:"button","data-testid":"parent-request-activity-row","data-request-id":p.requestId,"aria-expanded":open,"aria-controls":detailId,className:"w-full cursor-interaction text-start focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring",onClick:()=>setOpen(v=>!v),children:aE.jsxs(Wu,{className:"group",children:[aE.jsx(Nf,{seed:Gi(n.agentThreadId),className:"icon-sm","aria-hidden":true}),aE.jsxs("span",{className:"min-w-0 break-words text-text-tertiary/90 group-hover:text-default",children:[n.displayName!=null?aE.jsx("span",{className:"font-content",children:n.displayName}):aE.jsx("span",{children:ko?"하위 에이전트":"Subagent"}),": ",aE.jsx("span",{children:labels[p.status]??labels.pending})]})]})}),open?aE.jsx("dl",{id:detailId,className:"mt-2 flex min-w-0 flex-col gap-2 border-l border-default pl-4 text-sm text-secondary",children:fields.filter(([,v])=>typeof v==="string"&&v.length>0).map(([label,value])=>aE.jsxs("div",{className:"min-w-0",children:[aE.jsx("dt",{className:"font-medium text-default",children:label}),aE.jsx("dd",{className:"font-content whitespace-pre-wrap break-words",style:{overflowWrap:"anywhere"},children:value})]},label))}):null]})
}`;

const EDITS = {
 [ASSETS[0]]: [["agentThreadId:n.agentThreadId,isMessage:n.kind===`interacted`,displayName:ZS(n.agentPath),displayStatus:Syt(n.kind)", "agentThreadId:n.agentThreadId,isMessage:n.kind===`interacted`,displayName:ZS(n.agentPath),displayStatus:Syt(n.kind),...(n.parentRequest!=null?{parentRequest:n.parentRequest}:{})"]],
 [ASSETS[1]]: [["function nE(e){", "function nE(e){if(e.item.parentRequest!=null)return aE.jsx(azraelParentRequestActivity,e);"]]
};
function injectParentRequestActivity(text, asset) {
 if (!ASSETS.includes(asset)) return {text,count:0};
 const edits=EDITS[asset];
 if(!edits) throw new Error("Parent request projection anchor is not configured");
 const marker=MARKER+"/*"+asset+"*/";
 if(text.includes(marker)) {
  if(text.split(marker).length!==2 || edits.some(([,replacement])=>text.split(replacement).length!==2) || (asset===ASSETS[1]&&text.split(HELPER).length!==2)) throw new Error("Parent request transform damaged");
  return {text,count:0};
 }
 if(text.includes(MARKER)||text.includes("function azraelParentRequestActivity"))throw new Error("Parent request transform marker damaged");
 for(const [anchor,replacement] of edits)if(text.split(anchor).length!==2||text.includes(replacement))throw new Error("Pinned parent request anchor must occur exactly once: "+anchor);
 for(const [anchor,replacement] of edits)text=text.replace(anchor,replacement);
 text+="\n"+marker+"\n"+(asset===ASSETS[1]?HELPER:"");
 for(const [,replacement]of edits)if(text.split(replacement).length!==2)throw new Error("Parent request replacement verification failed");
 return {text,count:edits.length};
}
const EXPECTED_COUNTS=Object.fromEntries(ASSETS.map(asset=>[asset,EDITS[asset].length]));
const EXPECTED_TOTAL=Object.values(EXPECTED_COUNTS).reduce((a,b)=>a+b,0);
module.exports={ASSETS,EXPECTED_COUNTS,EXPECTED_TOTAL,MARKER,HELPER,EDITS,injectParentRequestActivity};
