import artifactRunTools from './artifact-run.cjs';
const {beginArtifactRun,trackArtifactChild}=artifactRunTools;
import {createRequire} from 'node:module';
import {spawn as nativeSpawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{UI_HELPER}=require('./inject-webview-idle.cjs');
const root=resolve(import.meta.dirname,'..');
const artifactRun=beginArtifactRun(root,{workId:'verify-webview-idle-render',owner:'scripts/verify-webview-idle-render.mjs',paths:{...(process.env.AZRAEL_RENDER_FIXTURE_ROOT ? {temporary:resolve(process.env.AZRAEL_RENDER_FIXTURE_ROOT)} : {}),...(process.env.AZRAEL_RENDER_LOG_ROOT ? {logs:resolve(process.env.AZRAEL_RENDER_LOG_ROOT)} : {})}});
const spawn=(...args)=>trackArtifactChild(artifactRun,nativeSpawn(...args));
const confirmOwnedBrowserExit=(child,profilePath)=>artifactRunTools.confirmOwnedBrowserExit(child,profilePath,spawn);
const fixture=artifactRun.temporary,logs=artifactRun.logs;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await mkdir(fixture,{recursive:true});await mkdir(logs,{recursive:true});
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+join(fixture,'profile')],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let socket,seq=0,pending=new Map(),session,summary={checks:[],scope:'Production renderer snapshot helper in actual Chromium DOM; synthetic composer scope; no native model calls'},exceptions=[];
try{
 const endpoint=await new Promise((r,j)=>{let output='';const t=setTimeout(()=>j(Error('Chrome startup timeout')),20000);chrome.stderr.on('data',b=>{output+=b;const m=output.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(t);r(m[1])}});chrome.on('error',j)});
 socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.j(Error(JSON.stringify(m.error))):p.r(m.result)}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails)});
 const send=(method,params={},sid=session)=>new Promise((r,j)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);j(Error('CDP timeout '+method))},10000);pending.set(id,{r,j,t});socket.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}))});
 const target=await send('Target.createTarget',{url:'about:blank'},null);session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
 await send('Runtime.enable');await send('Page.enable');
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value};
 for(const theme of ['light','dark']){
  const saved={key:'a',draft:{prompt:'unsent',pullRequestChecks:[]},viewState:{fileAttachments:[{path:'a.txt'}],responseTextAnnotations:[]},selections:[[],[],[],[],[],null,0],scroll:[{path:[1,0],top:420,left:0,bottom:false}]};
  await send('Page.navigate',{url:'about:blank'});await sleep(100);
  const html='<html><head><meta name="azrael-webview-idle-state" content="'+encodeURIComponent(JSON.stringify(saved))+'"></head><body style="background:'+(theme==='dark'?'#1e1e1e;color:white':'white;color:#222')+'"><div id="history" style="height:100px;overflow:auto"><div style="height:2000px">Latest model result</div></div><textarea>unsent</textarea></body></html>';
  await send('Page.setDocumentContent',{frameId:(await send('Page.getFrameTree')).frameTree.frame.id,html});
  await evaluate(`globalThis.messages=[];const Dm={dispatchMessage:(type,data)=>messages.push({type,...data})};const nativeConversation={id:'a',resumeState:'resumed',threadRuntimeStatus:{type:'idle'},requests:[]},nativeManager={hasPendingConversationResume:()=>false,requestClient:{getPendingRequestCount:()=>0},turnCoordinator:{readState:()=>({}),readMessages:()=>[]},getConversation:()=>nativeConversation,getCachedConversations:()=>[nativeConversation],getThreadSummaries:()=>[],stateReaders:{getListState:()=>({isConversationInProgress:false,isResponseInProgress:false,latestTurnStatus:'completed'})}};const zNt='zNt',nA='nA';const ZG='ZG',HG='HG',Kf='Kf',QG='QG',uK='uK',OW='OW',DW='DW',iW='iW',lW='lW',SW='SW',xW='xW';const RG={drafts$:'drafts'},g_=v=>v.conversationId,jnt=()=> 'a',PG=x=>x,Dyr=()=>{};const saved=${JSON.stringify(saved)},values={ZG:saved.viewState,uK:[],OW:[],DW:[],iW:[],SW:null,xW:0};const scope={value:{kind:'local',conversationId:'a'},get(a){return a===zNt?{status:'ready'}:a===nA?nativeManager:a==='drafts'?{a:saved.draft}:a===QG?values.ZG:a===Kf?{pathname:'/local/a'}:a===HG?false:values[a]},set(a,v){values[a]=v}};${UI_HELPER};azraelIdleMount(scope);azraelIdleRestoreScroll();`);
  assert.equal(await evaluate('document.querySelector("#history").scrollTop'),420);summary.checks.push(theme+': saved scroll restored in actual DOM');
  await evaluate('window.dispatchEvent(new MessageEvent("message",{data:{type:"azrael-webview-idle-capture",id:9}}))');
  const message=await evaluate('messages.at(-1)');assert.equal(message.id,9);assert.equal(message.snapshot.canSuspend,true);assert.equal(message.snapshot.draft.prompt,'unsent');assert.equal(message.snapshot.viewState.fileAttachments[0].path,'a.txt');assert.equal(message.snapshot.scroll[0].top,420);summary.checks.push(theme+': production capture message preserves composer and scroll');
  assert.ok(await evaluate('!JSON.stringify(messages).includes("Latest model result")'));summary.checks.push(theme+': transcript excluded from retained snapshot');
 }
 assert.equal(exceptions.length,0);summary.outcome='passed';await send('Browser.close',{},null).catch(()=>{});
}catch(error){summary.outcome='failed';summary.error=String(error.stack||error);summary.exceptions=exceptions;process.exitCode=1}
finally{
 if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify({id:++seq,method:'Browser.close'}));await sleep(250);socket.close()}for(const p of pending.values())clearTimeout(p.t);
  summary.browserExit=await confirmOwnedBrowserExit(chrome,join(fixture,'profile'));
  artifactRun.producerStopped=summary.browserExit.confirmed;
  summary.runRoot=artifactRun.runRoot;summary.lifecycleId=artifactRun.lifecycleId;
  summary.fixtureRemoved=false;summary.retentionReason='Retained fixture, profile and raw results for lifecycle review';
  if(!summary.browserExit.confirmed)process.exitCode=1;
  summary.exitCode=process.exitCode||0;await writeFile(join(logs,'render-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}
