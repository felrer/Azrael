"use strict";
const {azraelTaskTimeGroups,azraelTaskTimeLabel}=require('./task-work-time.cjs');
const {azraelCreateTaskTimeHistory,azraelMergeTaskTimeTurns}=require('./task-work-time-history.cjs');
const ASSET='webview/assets/local-conversation-thread-2429c4b61076.js';
const MARKER='/*azrael-task-work-time-v1*/';
const IMPORTS='import {F3t as azraelTimePreference,P3t as azraelTimeInitPreferences,W9t as azraelTimeScope} from "./app-initial-c014f9ee4429.js";import {Slt as azraelTimeAtom,_lt as azraelTimeStore,Bbt as azraelTimeIntl} from "./app-initial-97d3534ad35f.js";';
const HELPERS=[azraelTaskTimeGroups,azraelTaskTimeLabel,azraelCreateTaskTimeHistory,azraelMergeTaskTimeTurns].map(fn=>fn.toString()).join('\n');
const PANEL=String.raw`
var azraelTimeBoundaries;
function azraelTaskWorkTimePanel({manager,conversationId,hostId,liveTurns=[]}){
 azraelTimeInitPreferences();azraelTimeBoundaries??=azraelTimePreference('azrael-task-work-time-boundaries',{});
 const React=O(),jsx=r(),intl=azraelTimeIntl(),ko=/^ko/i.test(intl.locale),saved=azraelTimeAtom(azraelTimeBoundaries)??{},store=azraelTimeStore(azraelTimeScope);
 const scope=JSON.stringify([hostId,conversationId]),boundaries={};
 for(const turn of liveTurns)if(saved[JSON.stringify([hostId,conversationId,turn.turnId])]===true)boundaries[turn.turnId]=true;
 const history=React.useMemo(()=>azraelCreateTaskTimeHistory(manager,conversationId),[manager,scope]);
 const snapshot=React.useSyncExternalStore(history.subscribe,history.getSnapshot,history.getSnapshot);
 const revision=JSON.stringify(liveTurns.map(turn=>[turn.turnId,turn.status,turn.rootResumeWait?.revision]));
 React.useEffect(()=>{history.refresh();return()=>history.dispose()},[history]);
 const initialRevision=React.useRef({history,revision});
 React.useEffect(()=>{if(initialRevision.current.history!==history){initialRevision.current={history,revision};return}if(initialRevision.current.revision!==revision){initialRevision.current.revision=revision;history.refresh()}},[history,revision]);
 const turns=azraelMergeTaskTimeTurns(snapshot.turns,liveTurns);
 for(const turn of turns)if(saved[JSON.stringify([hostId,conversationId,turn.turnId])]===true)boundaries[turn.turnId]=true;
 const[now,setNow]=React.useState(Date.now);
 const groups=azraelTaskTimeGroups(turns,boundaries,now),active=groups.some(group=>group.active);
 React.useEffect(()=>{if(!active)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[active,scope]);
 const setBoundary=(turnId,value)=>store.set(azraelTimeBoundaries,current=>{const next={...current},key=JSON.stringify([hostId,conversationId,turnId]);if(value)next[key]=true;else delete next[key];return next});
 const button=(label,onClick,extra={})=>jsx.jsx(Vt,{color:'ghost',size:'small',onClick,...extra,children:label});
 const unavailable=!snapshot.complete||snapshot.loading||snapshot.error;
 return jsx.jsxs('section',{'data-azrael-task-work-time':scope,'aria-label':ko?'작업 시간':'Task work time',className:'mx-auto mb-4 w-full max-w-3xl rounded-lg border border-default p-3 text-sm text-primary',children:[
 unavailable?jsx.jsxs('div',{role:snapshot.error?'alert':'status',className:'mb-2 flex items-center gap-2 text-secondary',children:[snapshot.error?(ko?'시간 기록을 불러오지 못했습니다 · 일부 합계':'Time history unavailable · partial totals'):snapshot.loading?(ko?'시간 기록 불러오는 중 · 일부 합계':'Loading time history · partial totals'):(ko?'시간 기록 없음 · 일부 합계':'Time history unavailable · partial totals'),snapshot.error?button(ko?'다시 시도':'Retry',()=>history.refresh(),{'data-azrael-time-retry':true}):null]}):null,
 ...groups.map((group,index)=>jsx.jsxs('details',{'data-azrael-time-group':group.id,className:'py-1',children:[jsx.jsx('summary',{className:'cursor-interaction rounded-md px-2 py-1 focus-visible:outline focus-visible:outline-2',children:(ko?'작업 ':'Task ')+(index+1)+' · '+(ko?'총 ':'Total ')+azraelTaskTimeLabel(group.durationMs,intl.locale)+' · '+group.turnIds.length+(ko?'개 턴':' turns')+(group.partial?(ko?' · 일부 시간 확인 불가':' · some time unavailable'):unavailable?(ko?' · 일부 합계':' · partial totals'):'')}),jsx.jsx('ol',{className:'mt-2 space-y-1 px-2',children:group.turns.map(turn=>{const duration=azraelTaskTimeGroups([turn],{},now)[0];const first=turn.turnId===turns[0]?.turnId;return jsx.jsxs('li',{'data-azrael-time-turn':turn.turnId,className:'flex flex-wrap items-center justify-between gap-2 rounded-md py-1 text-secondary',children:[jsx.jsx('span',{children:(ko?'턴 ':'Turn ')+(turns.findIndex(t=>t.turnId===turn.turnId)+1)+' · '+azraelTaskTimeLabel(duration.durationMs,intl.locale)+(duration.partial?(ko?' · 일부 시간 확인 불가':' · some time unavailable'):'')}),!first?button(boundaries[turn.turnId]?(ko?'이전 작업에 합치기':'Merge into previous task'):(ko?'새 작업 시작':'Start new task'),()=>setBoundary(turn.turnId,!boundaries[turn.turnId]),{'data-azrael-time-boundary':turn.turnId}):null]},turn.turnId)})})]},group.id))]});
}
export {azraelTaskWorkTimePanel};
`;
const HELPER=IMPORTS+'\n'+HELPERS+'\n'+PANEL;
const ANCHOR='T?(0,Qh.jsx)(ch,{conversationId:t,entries:Sn,';
const MOUNT='(0,Qh.jsx)(azraelTaskWorkTimePanel,{manager:Tr(D,i),conversationId:t,hostId:i,liveTurns:D.get(Fr,t)??[]}),'+ANCHOR;
function injectTaskWorkTime(text,asset){
 if(asset!==ASSET)return {text,count:0};
 const count=value=>text.split(value).length-1;
 if(count(MARKER)){if(count(MARKER)!==1||count(HELPER)!==1||count(MOUNT)!==1)throw Error('Task work time transform is damaged');return {text,count:0}}
 if(count(ANCHOR)!==1||text.includes('function azraelTaskWorkTimePanel'))throw Error('Pinned task work time anchors changed');
 return {text:text.replace(ANCHOR,MOUNT)+'\n'+HELPER+'\n'+MARKER+'\n',count:1};
}
module.exports={ASSET,MARKER,HELPER,IMPORTS,PANEL,injectTaskWorkTime};
