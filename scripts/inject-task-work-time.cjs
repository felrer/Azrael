"use strict";
const {azraelTaskTimeGroups,azraelTaskTimeLabel}=require('./task-work-time.cjs');
const {azraelCreateTaskTimeHistory,azraelMergeTaskTimeTurns}=require('./task-work-time-history.cjs');
const ASSET='webview/assets/local-conversation-thread-2429c4b61076.js';
const TURN_ASSET='webview/assets/local-conversation-turn-9fb266d5c020.js';
const MARKER='/*azrael-task-work-time-v2*/';
const TURN_MARKER='/*azrael-task-work-time-message-v2*/';
const MESSAGE_HELPER=String.raw`
var azraelTimeMessageContext;
function azraelTaskTimeMessageContext(){return azraelTimeMessageContext??=T().createContext(null)}
function azraelTaskTimeMessageSummary(){
 const value=T().useContext(azraelTaskTimeMessageContext());
 return value?n().jsx('div',{'data-azrael-task-work-time':value.scope,'data-azrael-time-group':value.groupId,title:value.title,className:'mx-auto mb-2 w-full max-w-3xl text-right text-sm text-secondary',children:value.label}):null;
}
export {azraelTaskTimeMessageContext,azraelTaskTimeMessageSummary};
`;
const IMPORTS='import {Bbt as azraelTimeIntl} from "./app-initial-97d3534ad35f.js";import {azraelTaskTimeMessageContext} from "./local-conversation-turn-9fb266d5c020.js";';
function azraelTaskTimeRows(entries,groups){
 const starts=new Map(groups.filter(group=>group.eligible).map(group=>[group.firstTurnId,group]));
 const selected=new Set();
 return entries.map(entry=>{
  const id=entry.turn?.turnId??entry.turn?.id??entry.turnId??entry.sourceTurnId??entry.presentation?.turnId??entry.turnKey;
  const group=starts.get(id),block=entry.transcriptBlock;
  if(!group||selected.has(id)||entry.type==='gap'||entry.type?.startsWith('voice-')||entry.isLoaded===false)return entry;
  if(block&&(block.type!=='user-message'||block.item?.steeringStatus!=null))return entry;
  selected.add(id);return {...entry,azraelTimeGroup:group};
 });
}
const HELPERS=[azraelTaskTimeGroups,azraelTaskTimeLabel,azraelCreateTaskTimeHistory,azraelMergeTaskTimeTurns,azraelTaskTimeRows].map(fn=>fn.toString()).join('\n');
const PANEL=String.raw`
function azraelUseTaskTime({manager,conversationId,hostId,liveTurns=[]}){
 const React=O(),intl=azraelTimeIntl(),scope=JSON.stringify([hostId,conversationId]);
 const history=React.useMemo(()=>azraelCreateTaskTimeHistory(manager,conversationId,{hostId}),[manager,scope]);
 const snapshot=React.useSyncExternalStore(history.subscribe,history.getSnapshot,history.getSnapshot);
 const revision=JSON.stringify(liveTurns.map(turn=>[turn.turnId,turn.status,turn.turnStartedAtMs,turn.rootTurnId,turn.parentTurnId,turn.turnTrigger,turn.rootResumeWait]));
 React.useEffect(()=>{history.refresh();return()=>history.dispose()},[history]);
 const initialRevision=React.useRef({history,revision});
 React.useEffect(()=>{if(initialRevision.current.history!==history){initialRevision.current={history,revision};return}if(initialRevision.current.revision!==revision){initialRevision.current.revision=revision;history.refresh()}},[history,revision]);
 const turns=React.useMemo(()=>azraelMergeTaskTimeTurns(snapshot.turns,liveTurns),[snapshot.turns,liveTurns]);
 const[now,setNow]=React.useState(Date.now),groups=React.useMemo(()=>azraelTaskTimeGroups(turns,now),[turns,now]),active=groups.some(group=>group.eligible&&group.active);
 React.useEffect(()=>{if(!active)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[active,scope]);
 return {groups,scope,intl,snapshot};
}
function azraelTaskTimeVirtualList({azraelTaskTime,entries,RowComponent,...props}){
 const React=O(),jsx=r(),model=azraelUseTaskTime(azraelTaskTime??{});
 const rows=React.useMemo(()=>azraelTaskTime?azraelTaskTimeRows(entries,model.groups):entries,[entries,azraelTaskTime,model.groups]);
 const modelRef=React.useRef(model);modelRef.current=model;
 const Row=React.useMemo(()=>function AzraelTaskTimeRow(rowProps){
  const {scope,intl,snapshot}=modelRef.current,group=rowProps.entry.azraelTimeGroup,ko=/^ko/i.test(intl.locale);
  const partial=group&&(group.partial||!snapshot.complete||snapshot.loading||snapshot.error||snapshot.availability!=='ready');
  const value=group?{scope,groupId:group.id,label:(partial?(ko?'확인된 ':'Known '):(ko?'총 ':'Total '))+azraelTaskTimeLabel(group.durationMs,intl.locale)+' · '+group.turnIds.length+(ko?'개 턴':' turns'),title:partial?(ko?'시간 기록 일부 확인 불가':'Some time history unavailable'):undefined}:null;
  return jsx.jsx(azraelTaskTimeMessageContext().Provider,{value,children:jsx.jsx(RowComponent,rowProps)});
 },[RowComponent]);
 return jsx.jsx(eu,{...props,entries:rows,RowComponent:Row});
}
export {azraelTaskTimeVirtualList};
`;
const HELPER=IMPORTS+'\n'+HELPERS+'\n'+PANEL;
const ANCHOR='T?(0,Qh.jsx)(ch,{conversationId:t,entries:Sn,';
const CONFIG='azraelTaskTime:{manager:Tr(D,i),conversationId:t,hostId:i,liveTurns:D.get(Fr,t)??[]},';
const MOUNT='T?(0,Qh.jsx)(ch,{'+CONFIG+'conversationId:t,entries:Sn,';
const INNER='(0,vh.jsx)(eu,{entries:r,';
const FALLBACK='(0,Qh.jsx)(eu,{collapseEmptyRows:q,entries:Sn,';
const INNER_MOUNT='(0,vh.jsx)(azraelTaskTimeVirtualList,{azraelTaskTime:e.azraelTaskTime,entries:r,';
const FALLBACK_MOUNT='(0,Qh.jsx)(azraelTaskTimeVirtualList,{'+CONFIG+'collapseEmptyRows:q,entries:Sn,';
const TRANSCRIPT='userMessageHeader:r}),ye&&e.readReceipt';
const TRANSCRIPT_MOUNT='userMessageHeader:r}),e.isFirstUserMessage?(0,Z.jsx)(azraelTaskTimeMessageSummary,{}):null,ye&&e.readReceipt';
const USER_START='content:(0,$.jsx)(fa,{isReadOnly:De,item:t,';
const USER_START_MOUNT='content:(0,$.jsxs)($.Fragment,{children:[(0,$.jsx)(fa,{isReadOnly:De,item:t,';
const USER_END='emptyUserMessageOverride:e===0?te:void 0})}),{canOwnLatestTurnFollowContent:!1})';
const USER_END_MOUNT='emptyUserMessageOverride:e===0?te:void 0}),e===0?(0,$.jsx)(azraelTaskTimeMessageSummary,{}):null]})}),{canOwnLatestTurnFollowContent:!1})';
function injectTaskWorkTime(text,asset){
 if(asset!==ASSET&&asset!==TURN_ASSET)return {text,count:0};
 const count=value=>text.split(value).length-1;
 if(text.includes('/*azrael-task-work-time-v1*/')||text.includes('/*azrael-task-time-row-measure-v1*/'))throw Error('Task work time requires pristine pinned UI input');
 if(asset===TURN_ASSET){
  if(count(TURN_MARKER)){if(count(TURN_MARKER)!==1||count(MESSAGE_HELPER)!==1||count(TRANSCRIPT_MOUNT)!==1||count(USER_START_MOUNT)!==1||count(USER_END_MOUNT)!==1)throw Error('Task work time message transform is damaged');return {text,count:0}}
  for(const anchor of [TRANSCRIPT,USER_START,USER_END])if(count(anchor)!==1)throw Error('Pinned user message task time anchor changed');
  return {text:text.replace(TRANSCRIPT,TRANSCRIPT_MOUNT).replace(USER_START,USER_START_MOUNT).replace(USER_END,USER_END_MOUNT)+'\n'+MESSAGE_HELPER+'\n'+TURN_MARKER+'\n',count:1};
 }
 if(count(MARKER)){if(count(MARKER)!==1||count(HELPER)!==1||count(MOUNT)!==1||count(INNER_MOUNT)!==1||count(FALLBACK_MOUNT)!==1)throw Error('Task work time transform is damaged');return {text,count:0}}
 if(count(ANCHOR)!==1||count(INNER)!==1||count(FALLBACK)!==1||text.includes('function azraelTaskTimeVirtualList'))throw Error('Pinned task work time anchors changed');
 return {text:text.replace(ANCHOR,MOUNT).replace(INNER,INNER_MOUNT).replace(FALLBACK,FALLBACK_MOUNT)+'\n'+HELPER+'\n'+MARKER+'\n',count:1};
}
module.exports={ASSET,TURN_ASSET,MARKER,TURN_MARKER,HELPER,IMPORTS,PANEL,MESSAGE_HELPER,azraelTaskTimeRows,injectTaskWorkTime};
