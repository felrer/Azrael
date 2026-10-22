"use strict";

const ASSETS = ["webview/assets/app-initial-c014f9ee4429.js", "webview/assets/sites-end-resource-90d3046b3014.js", "webview/assets/local-conversation-turn-9fb266d5c020.js", "webview/assets/local-conversation-thread-2429c4b61076.js"];
const MARKER = "/*azrael-parent-request-activity-v2*/";
// The native activity row owns avatar, text geometry, offset and theme. The
// only action here is disclosure; responses remain owned by the parent agent.
const HELPER = `function azraelParentRequestActivity({item:n}){
 const intl=g(),ko=intl.locale?.startsWith("ko"),[open,setOpen]=iE.useState(false),p=n.parentRequest;
 const labels=ko?{pending:"판단 요청",resolved:"판단 완료",deferred:"판단 보류",cancelled:"요청 취소"}:{pending:"Decision requested",resolved:"Decision completed",deferred:"Decision deferred",cancelled:"Request cancelled"};
 const fields=[[ko?"질문":"Question",p.question],[ko?"맥락":"Context",p.context],[ko?"추천":"Recommendation",p.recommendation],[ko?"대기 중인 작업":"Blocked action",p.blockedAction],[ko?"판단":"Decision",p.response?.decision],[ko?"이유":"Reason",p.response?.reason],[ko?"재시도 조건":"Retry condition",p.response?.retryCondition]];
 const detailId="azrael-parent-request-"+p.requestId;
 return aE.jsxs(al,{padding:"offset",children:[aE.jsx("button",{type:"button","data-testid":"parent-request-activity-row","data-request-id":p.requestId,"aria-expanded":open,"aria-controls":detailId,className:"w-full cursor-interaction text-start focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring",onClick:()=>setOpen(v=>!v),children:aE.jsxs(Wu,{className:"group",children:[aE.jsx(Nf,{seed:Gi(n.agentThreadId),className:"icon-sm","aria-hidden":true}),aE.jsxs("span",{className:"min-w-0 break-words text-text-tertiary/90 group-hover:text-default",children:[n.displayName!=null?aE.jsx("span",{className:"font-content",children:n.displayName}):aE.jsx("span",{children:ko?"하위 에이전트":"Subagent"}),": ",aE.jsx("span",{children:labels[p.status]??labels.pending})]})]})}),open?aE.jsx("dl",{id:detailId,className:"mt-2 flex min-w-0 flex-col gap-2 border-l border-default pl-4 text-sm text-secondary",children:fields.filter(([,v])=>typeof v==="string"&&v.length>0).map(([label,value])=>aE.jsxs("div",{className:"min-w-0",children:[aE.jsx("dt",{className:"font-medium text-default",children:label}),aE.jsx("dd",{className:"font-content whitespace-pre-wrap break-words",style:{overflowWrap:"anywhere"},children:value})]},label))}):null]})
}`;

// The native conversation has two presentation routes: work activity groups
// and standalone BEM subagent presentations. Both consume these same rows.
const GROUP_HELPER = `function ZT(args){
 const requests=new Map,ordinary=[],completed=[];
 for(const item of args.activityItems)if(item.parentRequest!=null)requests.set(item.parentRequest.requestId,item);else(item.displayStatus==="completed"?completed:ordinary).push(item);
 const latest=new Map(ordinary.map(item=>[Gi(item.agentThreadId),item]));
 const rows=azraelNativeActivityRows({...args,activityItems:ordinary}).map(row=>({...row,activityStatus:latest.get(row.conversationId)?.displayStatus??row.activityStatus}));
 rows.push(...azraelNativeActivityRows({...args,activityItems:completed}).map(row=>({...row,activityKind:"completed",activityStatus:"completed",status:"done"})));
 for(const item of requests.values())rows.push({activityKind:"decision",activityStatus:"updated",status:"waiting",conversationId:Gi(item.agentThreadId),displayName:item.displayName??"Subagent",canOpen:true,parentRequestItem:item});
 // Summary labels describe recorded events. Runtime idle/deferred cannot
 // manufacture completion or consume either a request or an actual completion.
 const order=new Map;for(const item of args.activityItems){const kind=item.parentRequest!=null?"decision":item.displayStatus==="completed"?"completed":"activity";if(!order.has(kind))order.set(kind,order.size)}
 return rows.sort((a,b)=>order.get(a.activityKind??"activity")-order.get(b.activityKind??"activity"));
}
function azraelGroupedActivity({rows,...props}){
 oE();BO();
 const groups=new Map;
 for(const row of rows){const kind=row.parentRequestItem!=null?"decision":row.activityKind??"activity";if(!groups.has(kind))groups.set(kind,[]);groups.get(kind).push(row)}
 return aE.jsx("div",{className:"flex min-w-0 flex-col gap-2",children:[...groups].map(([kind,items])=>kind==="decision"?aE.jsx(azraelParentRequestGroup,{rows:items},kind):aE.jsx(props.renderOrdinary,{...props,rows:items,status:kind==="completed"?"completed":groups.size===1?props.status:JT(items.map(row=>row.activityStatus))},kind))});
}
function azraelParentRequestGroup({rows}){
 const intl=g(),ko=intl.locale?.startsWith("ko"),[open,setOpen]=iE.useState(false),id=iE.useId();
 const requests=new Map(rows.map(row=>[row.parentRequestItem.parentRequest.requestId,row.parentRequestItem])),agents=new Map;
 const statuses=[...requests.values()].map(item=>item.parentRequest.status),status=statuses.includes("pending")?"pending":statuses.every(s=>s===statuses[0])?statuses[0]:"responded";
 const labels=ko?{pending:"판단 요청",resolved:"판단 완료",deferred:"판단 보류",cancelled:"요청 취소",responded:"판단 응답"}:{pending:"Decision requested",resolved:"Decision completed",deferred:"Decision deferred",cancelled:"Request cancelled",responded:"Decision responses"};
 for(const row of rows)agents.set(row.conversationId,{id:row.conversationId,seed:row.conversationId,label:row.displayName,expanded:open,controls:id,onClick:()=>setOpen(v=>!v)});
 return aE.jsxs("div",{"data-testid":"parent-request-activity-group",children:[aE.jsx(IO,{items:[...agents.values()],status:"decision-"+status,decisionLabel:labels[status]??labels.pending,decisionLocale:ko?"ko":"en",expanded:open,controls:id,onOverflowClick:()=>setOpen(v=>!v),testId:"parent-request-activity-summary",className:"text-secondary"}),open?aE.jsx("div",{id,className:"flex min-w-0 flex-col gap-2",children:[...requests.values()].map(item=>aE.jsx(nE,{item},item.parentRequest.requestId))}):null]});
}
export {azraelGroupedActivity};`;

const TURN_HELPER = `function Vs(props){return (0,Ws.jsx)(azraelGroupedActivity,{...props,renderOrdinary:azraelNativeActivityGroup})}`;
const KIND_HELPER = `function azraelActivityKind(item){return item?.parentRequest!=null?"decision":item?.kind==="completed"?"completed":"activity"}`;
const DECISION_SUMMARY = "{count, select, 1 {<first>Subagent</first>} 2 {<first>Subagent</first> and <second>Subagent</second>} 3 {<first>Subagent</first>, <second>Subagent</second> and <third>Subagent</third>} other {<first>Subagent</first>, <second>Subagent</second> and <more>{hiddenCount} more</more>}}: {decisionLabel}";
const DECISION_SUMMARY_KO = "{count, select, 1 {<first>하위 에이전트</first>} 2 {<first>하위 에이전트</first>, <second>하위 에이전트</second>} 3 {<first>하위 에이전트</first>, <second>하위 에이전트</second>, <third>하위 에이전트</third>} other {<first>하위 에이전트</first>, <second>하위 에이전트</second> 외 <more>{hiddenCount}명</more>}}: {decisionLabel}";

const EDITS = {
 [ASSETS[0]]: [["agentThreadId:n.agentThreadId,isMessage:n.kind===`interacted`,displayName:ZS(n.agentPath),displayStatus:Syt(n.kind)", "agentThreadId:n.agentThreadId,isMessage:n.kind===`interacted`,displayName:ZS(n.agentPath),displayStatus:Syt(n.kind),...(n.parentRequest!=null?{parentRequest:n.parentRequest}:{})"]],
 [ASSETS[1]]: [
  ["function nE(e){", "function nE(e){if(e.item.parentRequest!=null)return aE.jsx(azraelParentRequestActivity,e);"],
  ["function ZT({activityItems:e,backgroundAgentById:t,laterActivityConversationIds:n,turnKey:r}){", "function azraelNativeActivityRows({activityItems:e,backgroundAgentById:t,laterActivityConversationIds:n,turnKey:r}){"],
  ["id:`subagents.activity.summary`,defaultMessage:", "id:e.decisionLabel!=null?`azrael.subagents.decision.summary`:`subagents.activity.summary`,defaultMessage:"],
  ["defaultMessage:`{count, select, 1 {<first>Subagent</first>}", "defaultMessage:e.decisionLabel!=null?(e.decisionLocale===`ko`?"+JSON.stringify(DECISION_SUMMARY_KO)+":"+JSON.stringify(DECISION_SUMMARY)+"):`{count, select, 1 {<first>Subagent</first>}"],
  ["status:a,first:g,second:_,third:v,more:y", "status:a,first:g,second:_,third:v,more:y,decisionLabel:e.decisionLabel"],
  ["role:`button`,tabIndex:0,onClick:n.onClick", "role:`button`,tabIndex:0,\"aria-expanded\":n.expanded,\"aria-controls\":n.controls,onClick:n.onClick"],
  ["onClick:c,children:e}),t[15]=c", "onClick:c,\"aria-expanded\":i[0]?.expanded,\"aria-controls\":i[0]?.controls,children:e}),t[15]=c"]
 ],
 [ASSETS[2]]: [
  ["function Vs(e){", "function azraelNativeActivityGroup(e){"],
  ["import{C as ji,D as Mi", "import{azraelGroupedActivity,C as ji,D as Mi"]
 ],
 [ASSETS[3]]: [
  ["items:t.items.filter(e=>e.type===`subAgentActivity`&&e.agentThreadId===r.agentThreadId)", "items:t.items.filter(e=>e.type===`subAgentActivity`&&azraelActivityKind(e)===azraelActivityKind(r))"],
  ["turnId:n.turnId})}}let i={...t,params:", "turnId:n.turnId,activityKind:azraelActivityKind(r)})}}let i={...t,params:"],
  ["backgroundAgentById:new Map(i.map(Cm))", "backgroundAgentById:n.activityKind!=null?new Map:new Map(i.map(Cm))"],
  ["r=t.kind===`started`?`subagent`:`subagent-update`", "r=t.kind===`started`||t.kind===`completed`||t.parentRequest!=null?`subagent`:`subagent-update`"],
  ["let f=[],p=cp(n.filter(e=>e.type!==`pending-artifact`)),m=new Map;", "let f=[],p=cp(n.filter(e=>e.type!==`pending-artifact`)),m=new Map,azraelActivityGroups=new Set;"],
  ["let t=ap(n,s,e);t!=null&&f.push(t);break", "let azraelItem=s.items.find(item=>item.id===e.itemId),azraelKey=e.presentation===`subagent`?JSON.stringify([e.turnId,azraelActivityKind(azraelItem)]):null;if(azraelKey!=null&&azraelActivityGroups.has(azraelKey))break;let t=ap(n,s,e);if(t!=null){f.push(t);if(azraelKey!=null)azraelActivityGroups.add(azraelKey)}break"]
 ]
};
const HELPERS = {[ASSETS[1]]:HELPER+"\n"+GROUP_HELPER,[ASSETS[2]]:TURN_HELPER,[ASSETS[3]]:KIND_HELPER};
function injectParentRequestActivity(text, asset) {
 if (!ASSETS.includes(asset)) return {text,count:0};
 const edits=EDITS[asset];
 if(!edits) throw new Error("Parent request projection anchor is not configured");
 const marker=MARKER+"/*"+asset+"*/";
 if(text.includes(marker)) {
  if(text.split(marker).length!==2 || edits.some(([,replacement])=>text.split(replacement).length!==2) || (HELPERS[asset]&&text.split(HELPERS[asset]).length!==2)) throw new Error("Parent request transform damaged");
  return {text,count:0};
 }
 if(text.includes("/*azrael-parent-request-activity-")||text.includes("function azraelParentRequestActivity"))throw new Error("Parent request transform marker damaged");
 for(const [anchor,replacement] of edits)if(text.split(anchor).length!==2||text.includes(replacement))throw new Error("Pinned parent request anchor must occur exactly once: "+anchor);
 for(const [anchor,replacement] of edits)text=text.replace(anchor,replacement);
 text+="\n"+marker+"\n"+(HELPERS[asset]??"");
 for(const [,replacement]of edits)if(text.split(replacement).length!==2)throw new Error("Parent request replacement verification failed");
 return {text,count:edits.length};
}
const EXPECTED_COUNTS=Object.fromEntries(ASSETS.map(asset=>[asset,EDITS[asset].length]));
const EXPECTED_TOTAL=Object.values(EXPECTED_COUNTS).reduce((a,b)=>a+b,0);
module.exports={ASSETS,EXPECTED_COUNTS,EXPECTED_TOTAL,MARKER,HELPER,HELPERS,EDITS,injectParentRequestActivity};
