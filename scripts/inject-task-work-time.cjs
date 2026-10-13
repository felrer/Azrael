"use strict";
const {azraelTaskTimeGroups,azraelTaskTimeLabel}=require('./task-work-time.cjs');
const {azraelCreateTaskTimeHistory,azraelMergeTaskTimeTurns}=require('./task-work-time-history.cjs');
const ASSET='webview/assets/local-conversation-thread-2429c4b61076.js';
const ROW_ASSET='webview/assets/virtualized-turn-list-c0fd56eabf08.js';
const ROW_MARKER='/*azrael-task-time-row-measure-v1*/';
const ROW_OBSERVER='let e=new ResizeObserver(e=>{let t=new Map,n=!1;';
const ROW_OBSERVER_MOUNT='let e=azraelTaskTimeRowObserver(e=>{let t=new Map,n=!1;';
function azraelTaskTimeRowObserver(onResize) {
 const pending=new Map();let frame=null,disposed=false;
 const observer=new ResizeObserver(entries=>{
  if(disposed)return;
  for(const entry of entries)pending.set(entry.target,entry);
  if(frame===null)frame=requestAnimationFrame(()=>{
   frame=null;if(disposed)return;
   const latest=[...pending.values()];pending.clear();onResize(latest);
  });
 });
 const disconnect=observer.disconnect.bind(observer),unobserve=observer.unobserve.bind(observer);
 observer.disconnect=()=>{disposed=true;if(frame!==null)cancelAnimationFrame(frame);frame=null;pending.clear();disconnect()};
 observer.unobserve=target=>{pending.delete(target);unobserve(target);if(!pending.size&&frame!==null){cancelAnimationFrame(frame);frame=null}};
 return observer;
}
const MARKER='/*azrael-task-work-time-v1*/';
const IMPORTS='import {F3t as azraelTimePreference,P3t as azraelTimeInitPreferences,W9t as azraelTimeScope} from "./app-initial-c014f9ee4429.js";import {Slt as azraelTimeAtom,_lt as azraelTimeStore,Bbt as azraelTimeIntl} from "./app-initial-97d3534ad35f.js";';
const HELPERS=[azraelTaskTimeGroups,azraelTaskTimeLabel,azraelCreateTaskTimeHistory,azraelMergeTaskTimeTurns].map(fn=>fn.toString()).join('\n');
const PANEL=String.raw`
var azraelTimeBoundaries;
function azraelTaskTimeRule({edge,groupId}){return r().jsx('div',{'data-azrael-task-rule':edge,'data-azrael-rule-group':groupId,'aria-hidden':true,className:'w-full',style:{height:4,borderTop:'1px solid var(--color-text-secondary)',borderBottom:'1px solid var(--color-text-secondary)',opacity:0.45}})}
function azraelUseTaskTime({manager,conversationId,hostId,liveTurns=[]}){
 azraelTimeInitPreferences();azraelTimeBoundaries??=azraelTimePreference('azrael-task-work-time-boundaries',{});
 const React=O(),intl=azraelTimeIntl(),saved=azraelTimeAtom(azraelTimeBoundaries)??{},store=azraelTimeStore(azraelTimeScope),scope=JSON.stringify([hostId,conversationId]);
 const history=React.useMemo(()=>azraelCreateTaskTimeHistory(manager,conversationId,{hostId}),[manager,scope]);
 const snapshot=React.useSyncExternalStore(history.subscribe,history.getSnapshot,history.getSnapshot);
 const revision=JSON.stringify(liveTurns.map(turn=>[turn.turnId,turn.status,turn.turnStartedAtMs,turn.rootTurnId,turn.parentTurnId,turn.turnTrigger,turn.rootResumeWait]));
 React.useEffect(()=>{history.refresh();return()=>history.dispose()},[history]);
 const initialRevision=React.useRef({history,revision});
 React.useEffect(()=>{if(initialRevision.current.history!==history){initialRevision.current={history,revision};return}if(initialRevision.current.revision!==revision){initialRevision.current.revision=revision;history.refresh()}},[history,revision]);
 const turns=azraelMergeTaskTimeTurns(snapshot.turns,liveTurns),boundaries={};
 for(const turn of turns){const value=saved[JSON.stringify([hostId,conversationId,turn.turnId])];if(typeof value==='boolean')boundaries[turn.turnId]=value}
 const[expanded,setExpanded]=React.useState({});
 const[now,setNow]=React.useState(Date.now),groups=azraelTaskTimeGroups(turns,boundaries,now),active=groups.some(group=>group.eligible&&group.active);
 React.useEffect(()=>{if(!active)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[active,scope]);
 const setBoundary=(turnId,value)=>store.set(azraelTimeBoundaries,current=>({...current,[JSON.stringify([hostId,conversationId,turnId])]:value}));
 return {groups,turns,boundaries,now,scope,intl,snapshot,history,setBoundary,expanded,setExpanded};
}
function azraelTaskWorkTimePanel({model,group}){
 const jsx=r(),{turns,boundaries,now,scope,intl,snapshot,history,setBoundary}=model,ko=/^ko/i.test(intl.locale);
 const button=(label,onClick,extra={})=>jsx.jsx(Vt,{color:'ghost',size:'small',onClick,...extra,children:label});
 const unavailable=!snapshot.complete||snapshot.loading||snapshot.error||snapshot.availability!=='ready';
 if(!group.eligible)return null;
 return jsx.jsxs('section',{'data-azrael-task-work-time':scope,'aria-label':ko?'작업 시간':'Task work time',className:'mx-auto mb-2 w-full max-w-3xl py-2 text-sm text-primary',children:[
 jsx.jsx(azraelTaskTimeRule,{edge:'start',groupId:group.id}),
 unavailable?jsx.jsxs('div',{role:snapshot.error?'alert':'status',className:'mb-2 flex items-center gap-2 text-secondary',children:[snapshot.error?(ko?'시간 기록을 불러오지 못했습니다 · 일부 합계':'Time history unavailable · partial totals'):snapshot.loading?(ko?'시간 기록 불러오는 중 · 일부 합계':'Loading time history · partial totals'):(ko?'시간 기록 없음 · 일부 합계':'Time history unavailable · partial totals'),snapshot.error?button(ko?'다시 시도':'Retry',()=>history.refresh(),{'data-azrael-time-retry':true}):null]}):null,
 jsx.jsxs('details',{'data-azrael-time-group':group.id,open:model.expanded[scope+':'+group.id]===true,onToggle:event=>{const value=event.currentTarget.open,key=scope+':'+group.id;model.setExpanded(current=>current[key]===value?current:{...current,[key]:value})},className:'py-1',children:[jsx.jsx('summary',{className:'cursor-interaction rounded-md px-2 py-1 focus-visible:outline focus-visible:outline-2',children:(ko?'작업 ':'Task ')+(model.groups.filter(g=>g.eligible).indexOf(group)+1)+' · '+(ko?'총 ':'Total ')+azraelTaskTimeLabel(group.durationMs,intl.locale)+' · '+group.turnIds.length+(ko?'개 턴':' turns')+(group.partial?(ko?' · 일부 시간 확인 불가':' · some time unavailable'):unavailable?(ko?' · 일부 합계':' · partial totals'):'')}),jsx.jsx('ol',{className:'mt-2 space-y-1 px-2',children:group.turns.map(turn=>{const duration=azraelTaskTimeGroups([turn],{},now)[0],first=turn.turnId===turns[0]?.turnId;return jsx.jsxs('li',{'data-azrael-time-turn':turn.turnId,className:'flex flex-wrap items-center justify-between gap-2 rounded-md py-1 text-secondary',children:[jsx.jsx('span',{children:(ko?'턴 ':'Turn ')+(turns.findIndex(t=>t.turnId===turn.turnId)+1)+' · '+azraelTaskTimeLabel(duration.durationMs,intl.locale)+(duration.partial?(ko?' · 일부 시간 확인 불가':' · some time unavailable'):'')}),!first?button(turn.turnId===group.firstTurnId?(ko?'이전 작업에 합치기':'Merge into previous task'):(ko?'새 작업 시작':'Start new task'),()=>setBoundary(turn.turnId,turn.turnId!==group.firstTurnId),{'data-azrael-time-boundary':turn.turnId}):null]},turn.turnId)})})]})]});
}
function azraelTaskTimeVirtualList({azraelTaskTime,entries,RowComponent,...props}){
 const React=O(),jsx=r(),model=azraelUseTaskTime(azraelTaskTime??{});
 const rows=React.useMemo(()=>{
  if(!azraelTaskTime)return entries;
  const id=entry=>entry.turn?.turnId??entry.turnId??entry.sourceTurnId??entry.presentation?.turnId;
  const starts=new Map(),ends=new Map();
  for(const group of model.groups.filter(g=>g.eligible)){
   const first=entries.findIndex(entry=>id(entry)===group.firstTurnId),last=entries.findLastIndex(entry=>id(entry)===group.lastTurnId);
   if(first>=0)starts.set(first,group);
   if(last>=0)ends.set(last,group);
  }
  return entries.flatMap((entry,index)=>{
   const start=starts.get(index),end=ends.get(index),out=[];
   if(start)out.push({turnKey:'azrael-task-work-time:'+model.scope+':'+start.id,type:'gap',estimatedHeightPx:76,azraelTimeGroup:start});
   out.push(end?{...entry,azraelTimeEnd:end.id}:entry);return out;
  });
 },[entries,azraelTaskTime,model.groups]);
 const modelRef=React.useRef(model);modelRef.current=model;
 const Row=React.useMemo(()=>function AzraelTaskTimeRow(rowProps){return rowProps.entry.azraelTimeGroup?jsx.jsx(azraelTaskWorkTimePanel,{model:modelRef.current,group:rowProps.entry.azraelTimeGroup}):rowProps.entry.azraelTimeEnd?jsx.jsxs(jsx.Fragment,{children:[jsx.jsx(RowComponent,rowProps),jsx.jsx('div',{className:'mx-auto mt-2 mb-2 w-full max-w-3xl',children:jsx.jsx(azraelTaskTimeRule,{edge:'end',groupId:rowProps.entry.azraelTimeEnd})})]}):jsx.jsx(RowComponent,rowProps)},[RowComponent]);
 return jsx.jsx(eu,{...props,entries:rows,RowComponent:Row});
}
export {azraelTaskWorkTimePanel,azraelTaskTimeVirtualList};
`;

const HELPER=IMPORTS+'\n'+HELPERS+'\n'+PANEL;
const ANCHOR='T?(0,Qh.jsx)(ch,{conversationId:t,entries:Sn,';
const CONFIG='azraelTaskTime:{manager:Tr(D,i),conversationId:t,hostId:i,liveTurns:D.get(Fr,t)??[]},';
const MOUNT='T?(0,Qh.jsx)(ch,{'+CONFIG+'conversationId:t,entries:Sn,';
const INNER='(0,vh.jsx)(eu,{entries:r,';
const FALLBACK='(0,Qh.jsx)(eu,{collapseEmptyRows:q,entries:Sn,';
const INNER_MOUNT='(0,vh.jsx)(azraelTaskTimeVirtualList,{azraelTaskTime:e.azraelTaskTime,entries:r,';
const FALLBACK_MOUNT='(0,Qh.jsx)(azraelTaskTimeVirtualList,{'+CONFIG+'collapseEmptyRows:q,entries:Sn,';
function injectTaskWorkTime(text,asset){
 if(asset===ROW_ASSET){
  const count=value=>text.split(value).length-1,helper=azraelTaskTimeRowObserver.toString();
  if(count(ROW_MARKER)){if(count(ROW_MARKER)!==1||count(ROW_OBSERVER_MOUNT)!==1||count(helper)!==1)throw Error('Task time row measurement transform is damaged');return {text,count:0}}
  if(count(ROW_OBSERVER)!==1||text.includes('function azraelTaskTimeRowObserver'))throw Error('Pinned task time row observer anchor changed');
  return {text:text.replace(ROW_OBSERVER,ROW_OBSERVER_MOUNT)+'\n'+helper+'\n'+ROW_MARKER+'\n',count:1};
 }
 if(asset!==ASSET)return {text,count:0};
 const count=value=>text.split(value).length-1;
 if(count(MARKER)){if(count(MARKER)!==1||count(HELPER)!==1||count(MOUNT)!==1||count(INNER_MOUNT)!==1||count(FALLBACK_MOUNT)!==1)throw Error('Task work time transform is damaged');return {text,count:0}}
 if(count(ANCHOR)!==1||count(INNER)!==1||count(FALLBACK)!==1||text.includes('function azraelTaskWorkTimePanel'))throw Error('Pinned task work time anchors changed');
 return {text:text.replace(ANCHOR,MOUNT).replace(INNER,INNER_MOUNT).replace(FALLBACK,FALLBACK_MOUNT)+'\n'+HELPER+'\n'+MARKER+'\n',count:1};
}
module.exports={ASSET,ROW_ASSET,MARKER,HELPER,IMPORTS,PANEL,azraelTaskTimeRowObserver,injectTaskWorkTime};
