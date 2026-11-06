"use strict";
const {azraelUserWaitDuration}=require('./task-work-time.cjs');
const REDUCER='webview/assets/app-initial-97d3534ad35f.js';
const PRESENTATION='webview/assets/app-initial-c014f9ee4429.js';
const APPROVAL='webview/assets/app-initial-7a199c66e670.js';
const TURN='webview/assets/local-conversation-turn-9fb266d5c020.js';
const PENDING='webview/assets/pending-request-item-panel-24ca353c997e.js';
const METHOD='turn/userWaitTiming/updated';
const MARKER='/*azrael-user-wait-time-v1*/';

// A newer snapshot may close a request, but can never reopen or move it.
function azraelMergeUserWaitTiming(current,incoming){
 const ms=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 if(!incoming||!Number.isSafeInteger(incoming.revision)||incoming.revision<0||!Array.isArray(incoming.requests)||!Array.isArray(incoming.blockedIntervals))return current??null;
 if(incoming.startedAtMs!=null&&!ms(incoming.startedAtMs))return current??null;
 if(current?.startedAtMs!=null&&incoming.startedAtMs!=null&&current.startedAtMs!==incoming.startedAtMs)return current;
 if(current&&incoming.revision<=current.revision)return current.startedAtMs==null&&incoming.startedAtMs!=null?{...current,startedAtMs:incoming.startedAtMs}:current;
 const ids=new Set();
 for(const r of incoming.requests){if(!r||typeof r.requestId!=='string'||!r.requestId||ids.has(r.requestId)||typeof r.kind!=='string'||!ms(r.startedAtMs)||r.endedAtMs!=null&&(!ms(r.endedAtMs)||r.endedAtMs<r.startedAtMs)||r.durationMs!=null&&!ms(r.durationMs))return current??null;ids.add(r.requestId)}
 for(const b of incoming.blockedIntervals)if(!b||!ms(b.startedAtMs)||b.endedAtMs!=null&&(!ms(b.endedAtMs)||b.endedAtMs<b.startedAtMs))return current??null;
 const requests=new Map((current?.requests??[]).map(r=>[r.requestId,r]));
 for(const r of incoming.requests){const old=requests.get(r.requestId);if(old&&(old.startedAtMs!==r.startedAtMs||old.kind!==r.kind||old.callId!==r.callId))return current;requests.set(r.requestId,old?.endedAtMs!=null?old:{...r})}
 const blocks=new Map((current?.blockedIntervals??[]).map(b=>[b.startedAtMs,b]));
 for(const b of incoming.blockedIntervals){const old=blocks.get(b.startedAtMs);blocks.set(b.startedAtMs,old?.endedAtMs!=null?old:{...b})}
 return {revision:incoming.revision,startedAtMs:current?.startedAtMs??incoming.startedAtMs??null,requests:[...requests.values()],blockedIntervals:[...blocks.values()]};
}
function azraelUserWaitRequest(timing,identity){
 const requests=timing?.requests??[];
 if(!identity)return null;
 const id=identity.requestId;
 if(id!=null){const exact=requests.filter(r=>r.requestId===String(id));if(exact.length===1)return exact[0]}
 if(identity.callId==null||identity.kind==null)return null;
 const fallback=requests.filter(r=>r.callId===identity.callId&&r.kind===identity.kind);
 return fallback.length===1?fallback[0]:null;
}
function azraelUserWaitLabel(request,now){
 if(!request||!Number.isFinite(request.startedAtMs))return null;
 const ended=request.endedAtMs!=null;
 const duration=ended?(request.durationMs??request.endedAtMs-request.startedAtMs):now-request.startedAtMs;
 if(!Number.isFinite(duration))return null;
 const seconds=Math.floor(Math.max(0,duration)/1000),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60);
 return (ended?'응답까지 ':'응답 대기 ')+(hours?hours+'시간 ':'')+(minutes?minutes+'분 ':'')+seconds%60+'초';
}
function azraelUserWaitKind(kind){return {commandApproval:'명령 승인',patchApproval:'파일 변경 승인',permissions:'권한 요청',userInput:'사용자 입력',elicitation:'MCP 요청'}[kind]??'응답 요청'}
function azraelUserWaitTurn(turns,pending){
 const item=pending?.item??pending,identity=item?.azraelWaitIdentity??{requestId:pending?.request?.params?.userWaitRequestId??item?.approvalRequestId??item?.requestId??pending?.requestId,callId:item?.callId,kind:item?.type==='exec'?'commandApproval':item?.type==='patch'?'patchApproval':pending?.type==='permissionRequest'?'permissions':null};
 const matches=(turns??[]).filter(turn=>azraelUserWaitRequest(turn.userWaitTiming,identity)!=null);
 return matches.length===1?{...matches[0],azraelWaitIdentity:identity}:null;
}
function azraelReceiveUserWait(manager,context,findTurn,conversationId,turnId,timing){
 let journal=azraelUserWaitJournals.get(manager);if(!journal)azraelUserWaitJournals.set(manager,journal=new Map());
 const key=JSON.stringify([conversationId,turnId]),prior=journal.get(key);
 const conversation=manager.getConversation(conversationId),turn=conversation==null?null:findTurn(conversation,t=>t.turnId===turnId);
 const merged=azraelMergeUserWaitTiming(turn?.userWaitTiming??prior?.timing,timing);
 if(!merged)return;
 if(turn){if(merged!==turn.userWaitTiming)context.updateTurnState(conversationId,turnId,target=>{target.userWaitTiming=merged});journal.delete(key)}
 else journal.set(key,{context,findTurn,conversationId,turnId,timing:merged});
}
function azraelFlushUserWait(manager,conversationId){
 const journal=azraelUserWaitJournals.get(manager);if(!journal)return;
 for(const row of [...journal.values()])if(row.conversationId===conversationId)azraelReceiveUserWait(manager,row.context,row.findTurn,conversationId,row.turnId,row.timing);
}
function once(text,anchor,replacement){if(text.split(anchor).length!==2)throw Error('Pinned user wait anchor changed: '+anchor);return text.replace(anchor,replacement)}
const MERGE=azraelMergeUserWaitTiming.toString();
const REDUCER_HELPERS=MERGE+'\nconst azraelUserWaitJournals=new WeakMap();\n'+azraelReceiveUserWait.toString()+'\n'+azraelFlushUserWait.toString();
const CONTEXT=String.raw`
var azraelWaitContext;
function azraelUserWaitContext(){return azraelWaitContext??=wd().createContext(null)}
function azraelUserWaitScope(children,turn,history=true){return m().jsx(azraelUserWaitContext().Provider,{value:turn??null,children:m().jsxs(m().Fragment,{children:[children,history?m().jsx(AzraelUserWaitHistory,{}):null]})})}
function azraelUserWaitIdentityScope({children,identity}){const turn=wd().useContext(azraelUserWaitContext());return azraelUserWaitScope(children,turn?{...turn,azraelWaitIdentity:identity}:null,false)}
function AzraelUserWaitTimer({request,history=false}){
 const React=wd(),[now,setNow]=React.useState(Date.now);
 React.useEffect(()=>{setNow(Date.now());if(!request||request.endedAtMs!=null)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[request?.requestId,request?.startedAtMs,request?.endedAtMs]);
 const label=azraelUserWaitLabel(request,now);
 return label?m().jsx('div',{'data-azrael-user-wait':request.requestId,title:azraelUserWaitKind(request.kind)+'에 대한 사용자 응답 시간',className:'min-w-0 text-sm text-secondary tabular-nums',children:history?azraelUserWaitKind(request.kind)+' · '+label:label}):null;
}
function AzraelUserWaitHistory(){
 const turn=wd().useContext(azraelUserWaitContext());
 const requests=(turn?.userWaitTiming?.requests??[]).filter(request=>request.endedAtMs!=null);
 return requests.length?m().jsx('div',{className:'flex min-w-0 flex-col gap-1',children:requests.map(request=>m().jsx(AzraelUserWaitTimer,{request,history:true},request.requestId))}):null;
}
`;
function injectUserWaitTime(text,asset){
 const host=asset==='out/extension.js';
 if(!host&&![REDUCER,PRESENTATION,APPROVAL,TURN,PENDING].includes(asset))return {text,count:0};
 if(!text.includes(MARKER)&&(text.includes('/*azrael-user-wait-segments:')||text.includes('/*azrael-user-wait-check:')))throw Error('User wait transform is damaged');
 // Full transformed segments are checked, not only a marker: partial output fails closed.
 const finish=(out,segments)=>({text:out+'\n'+MARKER+'\n/*azrael-user-wait-segments:'+segments.length+'*/\n'+segments.map(s=>'/*azrael-user-wait-check:'+Buffer.from(s).toString('base64')+'*/').join('\n'),count:1});
 if(text.includes(MARKER)){
  if(text.split(MARKER).length!==2)throw Error('User wait transform is damaged');
  const segments=[...text.matchAll(/\/\*azrael-user-wait-check:([A-Za-z0-9+/=]+)\*\//g)];
  if(!segments.length||segments.length!==Number(text.match(/\/\*azrael-user-wait-segments:(\d+)\*\//)?.[1])||segments.some(m=>text.split(Buffer.from(m[1],'base64').toString()).length!==2))throw Error('User wait transform is damaged');
  return {text,count:0};
 }
 const segments=[];
 const replace=(anchor,replacement)=>{text=once(text,anchor,replacement);segments.push(replacement)};
 if(host||asset===APPROVAL){
  replace('"turn/completed":!0','"'+METHOD+'":!0,"turn/completed":!0');
  if(host)return finish(text,segments);
  text+='\n'+azraelUserWaitRequest.toString()+'\n'+azraelUserWaitLabel.toString()+'\n'+azraelUserWaitKind.toString()+'\n'+CONTEXT;
  segments.push(CONTEXT);
  replace('export{','export{azraelUserWaitContext,azraelUserWaitScope,azraelUserWaitIdentityScope,AzraelUserWaitHistory,');
  // Request wrappers pass identity explicitly; native controls remain untouched.
  replace('function Ika(e){let t=', 'function Ika(e){return m().jsx(azraelTimedApprovalCard,{...e})}function azraelTimedApprovalCard(e){const turn=wd().useContext(azraelUserWaitContext()),request=azraelUserWaitRequest(turn?.userWaitTiming,e.azraelWaitIdentity??turn?.azraelWaitIdentity);return m().jsx(azraelNativeApprovalCard,{...e,body:request?m().jsxs(m().Fragment,{children:[e.body,m().jsx(`div`,{className:`px-4 pb-3`,children:m().jsx(AzraelUserWaitTimer,{request})})]}):e.body})}function azraelNativeApprovalCard(e){let t=');
 }else if(asset===REDUCER){
  text=REDUCER_HELPERS+'\n'+text;segments.push(REDUCER_HELPERS);
  const converters=[...text.matchAll(/let\{threadId:s,turn:c\}=t\.params,l=([\w$]+)\(s\);if\(!o\.threadStore\.conversations\.has\(l\)\)/g)];
  if(converters.length!==1)throw Error('Pinned user wait conversation converter changed');
  const converter=converters[0][1];
  replace('case`turn/completed`:{if(o.itemStreamState.drainBefore','case`'+METHOD+'`:{if(o.itemStreamState.drainBefore(()=>{a.onNotification(`'+METHOD+'`,t.params,n,i,r)}))return`deferred`;let{threadId:s,turnId:c,timing:w}=t.params,l='+converter+'(s);azraelReceiveUserWait(a,o,vg,l,c,w);a.broadcastConversationSnapshot(l);break}case`turn/completed`:{if(o.itemStreamState.drainBefore');
  replace('case`turn/started`:case`turn/deferred`:', 'case`'+METHOD+'`:case`turn/started`:case`turn/deferred`:');
  replace('durationMs:t.status===`inProgress`&&azraelHasDeferredBoundary(t)?null:t.durationMs,','userWaitTiming:azraelMergeUserWaitTiming(null,t.userWaitTiming),durationMs:t.status===`inProgress`&&azraelHasDeferredBoundary(t)?null:t.durationMs,');
  replace('s$(t,i.status),t.turnId=i.id,','s$(t,i.status),t.turnId=i.id,t.userWaitTiming=azraelMergeUserWaitTiming(t.userWaitTiming,i.userWaitTiming),');
  replace('e.error=c.error,e.durationMs=c.durationMs,','e.error=c.error,e.userWaitTiming=azraelMergeUserWaitTiming(e.userWaitTiming,c.userWaitTiming),e.durationMs=c.durationMs,');
  replace('rootResumeWait:azraelMergeRootResumeWait(e.rootResumeWait,t.rootResumeWait),','rootResumeWait:azraelMergeRootResumeWait(e.rootResumeWait,t.rootResumeWait),userWaitTiming:azraelMergeUserWaitTiming(e.userWaitTiming,t.userWaitTiming),');
  replace('durationMs:e.durationMs??null,parentTurnId:', 'durationMs:e.durationMs??null,userWaitTiming:e.userWaitTiming??null,parentTurnId:');
  replace('completedAt:e.completedAt,durationMs:e.durationMs,parentTurnId:', 'completedAt:e.completedAt,durationMs:e.durationMs,userWaitTiming:e.userWaitTiming??o.get(e.turnId)?.userWaitTiming??null,parentTurnId:');
  replace('broadcastConversationSnapshot(e){azraelFlushDeferred(this,e);','broadcastConversationSnapshot(e){azraelFlushUserWait(this,e);azraelFlushDeferred(this,e);');
 }else if(asset===PENDING){
  text+='\nimport {azraelUserWaitScope,zpt as azraelWaitTurns} from "./app-initial-7a199c66e670.js";\n'+azraelUserWaitRequest.toString()+'\n'+azraelUserWaitTurn.toString()+'\n';segments.push(azraelUserWaitTurn.toString());
  replace('function zr(e){let t=', 'function zr(e){const turns=b(azraelWaitTurns,e.conversationId);return azraelUserWaitScope((0,$.jsx)(azraelNativePendingPanel,e),azraelUserWaitTurn(turns,e.pendingRequest),false)}function azraelNativePendingPanel(e){let t=');
  replace('(0,$.jsx)(de,{actions:r,headerContent:i,subtitle:a,title:I})', '(0,$.jsx)(de,{azraelWaitIdentity:l.azraelWaitIdentity??{requestId:l.callId,callId:l.callId,kind:l.type===`exec`?`commandApproval`:`patchApproval`},actions:r,headerContent:i,subtitle:a,title:I})');
  replace('(0,$.jsx)(de,{actions:Y,body:me,headerContent:he,title:I})', '(0,$.jsx)(de,{azraelWaitIdentity:l.azraelWaitIdentity??{requestId:l.callId,callId:l.callId,kind:l.type===`exec`?`commandApproval`:`patchApproval`},actions:Y,body:me,headerContent:he,title:I})');
  replace('(0,Q.jsx)(de,{actions:me,headerContent:ge,subtitle:O,title:pe})', '(0,Q.jsx)(de,{azraelWaitIdentity:o.azraelWaitIdentity,actions:me,headerContent:ge,subtitle:O,title:pe})');
 }else if(asset===TURN){
  // Both native history render routes share the existing canonical-turn scope.
  replace('azraelResumeBranchScope((t[207]===oe?', 'azraelUserWaitScope(azraelResumeBranchScope((t[207]===oe?');
  replace(')),K?void 0:ue)}for(let e of Fn)', ')),K?void 0:ue),v??b)}for(let e of Fn)');
  replace('azraelResumeBranchScope(xo,K?void 0:ue)}', 'azraelUserWaitScope(azraelResumeBranchScope(xo,K?void 0:ue),v??b)}');
  const mcp='for(let e of wn)X(`mcp-server-elicitation-${e.requestId}`,(0,$.jsx)(Mi,{isReadOnly:De,item:e,conversationId:d,hostId:f,conversationDetailLevel:ht,isTurnInProgress:K,cwd:E,reportEntityType:W,resolvedApps:ke,renderMcpApps:gt,toolActivityTurnKey:Ze}))';
  replace(mcp,'for(let e of wn)X(`mcp-server-elicitation-${e.requestId}`,(0,$.jsx)(azraelUserWaitIdentityScope,{identity:{requestId:e.params?.userWaitRequestId},children:(0,$.jsx)(Mi,{isReadOnly:De,item:e,conversationId:d,hostId:f,conversationDetailLevel:ht,isTurnInProgress:K,cwd:E,reportEntityType:W,resolvedApps:ke,renderMcpApps:gt,toolActivityTurnKey:Ze})}))');
  text+='\nimport {azraelUserWaitScope,azraelUserWaitIdentityScope} from "./app-initial-7a199c66e670.js";\n';segments.push('import {azraelUserWaitScope,azraelUserWaitIdentityScope} from "./app-initial-7a199c66e670.js";');
 }else if(asset===PRESENTATION){
  text+='\nimport {azraelUserWaitContext,AzraelUserWaitHistory} from "./app-initial-7a199c66e670.js";\n'+azraelUserWaitDuration.toString()+'\n';segments.push(azraelUserWaitDuration.toString());
  replace('approvalRequestId:ns(t)}','approvalRequestId:ns(t),azraelWaitIdentity:{requestId:n.approvalId??n.itemId,callId:n.itemId,kind:`commandApproval`}}');
  replace('approvalRequestId:ns(e.id)}}function bLt','approvalRequestId:ns(e.id),azraelWaitIdentity:{requestId:e.params.approvalId??e.params.itemId,callId:e.params.itemId,kind:`commandApproval`}}}function bLt');
  replace('function _Lt(e){return{type:`permission-request`,','function _Lt(e){return{azraelWaitIdentity:{requestId:e.params.itemId,callId:e.params.itemId,kind:`permissions`},type:`permission-request`,');
  replace('let l=Math.max((i??o)-r,0),u;', 'let azraelTurn=X().useContext(azraelUserWaitContext()),azraelMeasured=azraelTurn?.userWaitTiming!=null&&!n.startsWith(`azrael`),azraelStart=azraelTurn?.userWaitTiming?.startedAtMs??azraelTurn?.turnStartedAtMs??r,azraelElapsed=azraelMeasured?(azraelTurn.durationMs??Math.max((i??o)-azraelStart,0)):Math.max((i??o)-r,0),azraelNet=azraelMeasured?azraelUserWaitDuration(azraelElapsed,azraelStart,azraelTurn.userWaitTiming):null,l=azraelNet?.durationMs??azraelElapsed,u;');
  // Keep unmeasured historical elapsed time visibly distinct from measured work.
  replace('let{timeLabel:s,elapsedMs:c}=Vzi(o),l;', 'let{timeLabel:s,elapsedMs:c}=Vzi(o),l;const azraelTurn=X().useContext(azraelUserWaitContext());');
  replace('let u=a??`text-tertiary`,d;', 'if(e.rootResumeWait==null&&azraelTurn?.userWaitTiming==null&&l!=null)l=(0,E7.jsxs)(`span`,{title:`사용자 응답 대기가 측정되지 않은 경과 시간`,children:[`기록된 `,l]});let u=a??`text-tertiary`,d;');
 }
 return finish(text,segments);
}
module.exports={REDUCER,PRESENTATION,APPROVAL,TURN,PENDING,METHOD,MARKER,CONTEXT,injectUserWaitTime,azraelMergeUserWaitTiming,azraelUserWaitRequest,azraelUserWaitTurn,azraelUserWaitLabel,azraelUserWaitKind};
