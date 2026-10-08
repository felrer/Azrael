import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fixture=join(root,'artifacts/verification/deferred-timer-ui');
const logs=resolve(root,process.env.AZRAEL_DEFERRED_RENDER_LOG_DIR||'artifacts/logs/resume-timer-fix-20261008/ui');
const assets=join(root,'artifacts/upstream-ui/26.930.61225/webview/assets');
const profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);
const ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const {injectDeferredPresentation,injectDeferredTurn,injectDeferredThread,DEFERRED_PRESENTATION_ASSET,DEFERRED_REDUCER_ASSET,DEFERRED_THREAD_ASSET}=require('./inject-deferred-turn.cjs');
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const mainName=DEFERRED_PRESENTATION_ASSET.split('/').at(-1);
const main=injectDeferredPresentation(await readFile(join(assets,mainName),'utf8')).text;
const ast=ts.createSourceFile('main.js',main,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const named=(tree,name)=>{const owner=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(owner,'Pinned function '+name);return owner};
const adaptations={ra:'fixtureLocale',X:'FixtureMessage',RFi:'fixtureClock',IFi:'fixtureLabel',LFi:'fixtureDivider'};
const adapt=owner=>{let source=owner.getText(ast),edits=[];function visit(n){if(ts.isIdentifier(n)&&adaptations[n.text]&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(ast)-owner.getStart(ast),end:n.end-owner.getStart(ast),text:adaptations[n.text]});ts.forEachChild(n,visit)}visit(owner);for(const e of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,e.start)+e.text+source.slice(e.end);return source};
const reducer=injectDeferredTurn(await readFile(join(assets,DEFERRED_REDUCER_ASSET.split('/').at(-1)),'utf8')).text;
const reducerAst=ts.createSourceFile('reducer.js',reducer,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const reducerName=DEFERRED_REDUCER_ASSET.split('/').at(-1);
const threadName=DEFERRED_THREAD_ASSET.split('/').at(-1);
const thread=injectDeferredThread(await readFile(join(assets,threadName),'utf8')).text;
// Append exports in the original module scope: converters, merge helpers and
// projection dependencies retain their real pinned imports and implementation.
const reducerAdapter=String.raw`
export {uwn as fixtureNotification,mue as fixtureMergeSnapshot,Nyn as fixtureHistory,Eh as fixtureInitializeReducer,Fh as fixtureFindTurn,Ih as fixtureFindEntry,zh as fixtureCanonicalHistory,azraelFlushDeferred as fixtureFlushDeferred};
export const fixtureWrongNotification=${named(reducerAst,'uwn').getText(reducerAst).replace('function uwn(', 'function fixtureWrongNotification(').replaceAll('l=B(s);','l=m(s);')};`;
const threadAdapter=String.raw`
export function fixtureActivity(turn){return lp({requests:[],generatedImages:[],isBackgroundSubagentsEnabled:false},turn,{key:turn.turnId,itemIds:turn.items.map(item=>item.id),state:'active',presentation:'codex',startedAtMs:turn.turnStartedAtMs,completedAtMs:null},null,false).turnState;}`;
const adapterSource=String.raw`
import {fixtureNotification,fixtureWrongNotification,fixtureMergeSnapshot,fixtureHistory,fixtureInitializeReducer,fixtureFindTurn,fixtureFindEntry,fixtureCanonicalHistory,fixtureFlushDeferred} from './${reducerName}';
import {fixtureActivity} from './${threadName}';
const fixtureLocale=()=>({locale:'en-US'});
let fixtureStoreReady=false;
function FixtureMessage({defaultMessage,values={}}){return defaultMessage.replace(/\{(\w+)\}/g,(_,key)=>values[key]??key)}
${['RFi','IFi','LFi'].map(n=>adapt(named(ast,n))).join(String.fromCharCode(10))}
window.fixtureNow=20000;Date.now=()=>fixtureNow;

const waitValue=(state='waiting',revision=1)=>({reservationId:'r1',revision,waitStartedAtMs:20000,waitEndedAtMs:state==='resumed'?fixtureNow:null,resumeAtMs:80000,state,canWakeEarly:false});
const nativeOld=()=>({id:'old',status:'deferred',durationMs:8000,startedAt:12,rootResumeWait:waitValue(),items:[]});
const oldTurn=()=>({turnId:'old',status:'inProgress',turnStartedAtMs:12000,durationMs:null,items:[{id:'reason',type:'reasoning',summary:['Timer verification'],content:[]}],params:{threadId:'thread-live',input:[],attachments:[]}});
let fixtureEnvironment;
function setTurns(turns){const c=fixtureState.conversation;if(fixtureState.layout==='canonical'){c.turnHistory={kind:'canonical',history:{isComplete:true,entitiesByKey:Object.fromEntries(turns.map(t=>['turn:'+t.turnId,t])),islands:[{id:'loaded',entries:turns.map(t=>({key:'turn:'+t.turnId,value:'turn:'+t.turnId})),olderBoundary:{status:'exhausted'},newerBoundary:{status:'exhausted'}}]}}}else c.turns=turns}
function allTurns(){const c=fixtureState.conversation,h=fixtureCanonicalHistory(c);return h?h.islands.flatMap(i=>i.entries.map(e=>h.entitiesByKey[e.value])):c.turns}
window.allTurns=allTurns;
function replaceTurn(id,turn){const c=fixtureState.conversation,e=fixtureFindEntry(c,t=>t.turnId===id),h=fixtureCanonicalHistory(c);if(!e)throw Error('Missing loaded turn '+id);if(h)h.entitiesByKey[e.entityKey]=turn;else c.turns[c.turns.indexOf(e.turn)]=turn}
window.fixtureReset=(layout='legacy',missing=false)=>{window.fixtureState={layout,conversation:{id:'thread-live',turns:[],requests:[]}};Object.defineProperties(fixtureState,{old:{get:()=>fixtureFindTurn(fixtureState.conversation,t=>t.turnId==='old')},current:{get:()=>fixtureFindTurn(fixtureState.conversation,t=>t.turnId==='new')}});setTurns(missing?[]:[oldTurn()]);window.fixtureReceipt={updates:[],broadcasts:[],queries:[],errors:[],recovery:[]};const manager={logger:{error:(...args)=>fixtureReceipt.errors.push(args),info:(...args)=>fixtureReceipt.recovery.push(args)},getConversation:id=>id==='thread-live'?fixtureState.conversation:null,updateConversationState:(id,update)=>{if(id!=='thread-live')throw Error('Wrong native conversation');update(fixtureState.conversation)},broadcastConversationSnapshot:id=>{fixtureFlushDeferred(manager,id);fixtureReceipt.broadcasts.push(id);window.fixtureRerender?.()},listThreadTurns:(id,options)=>{fixtureReceipt.queries.push({id,options});return new Promise(resolve=>{window.fixtureResolveQuery=(terminal=false)=>{const turn=nativeOld();if(terminal)turn.rootResumeWait=waitValue('resumed',2);resolve({response:{data:[turn],nextCursor:null}})}})}};fixtureEnvironment={manager,createId:()=> 'native-'+Math.random(),notificationContext:{threadStore:{conversations:new Map([['thread-live',fixtureState.conversation]])},itemStreamState:{drainBefore:()=>false},updateTurnState:(threadId,turnId,update)=>{if(threadId!=='thread-live')throw Error('Native converter failed: '+threadId);const target=fixtureFindTurn(manager.getConversation(threadId),t=>t.turnId===turnId);if(!target)throw Error('Native lookup failed: '+turnId);fixtureReceipt.updates.push({threadId,turnId});update(target)}}};};fixtureReset();
window.fixtureEmit=(method,params)=>{fixtureNotification(fixtureEnvironment,{method,params:{threadId:'thread-live',...params}},null,fixtureNow,fixtureNow);fixtureRerender()};
window.fixtureDefer=()=>fixtureEmit('turn/deferred',{turn:nativeOld()});
window.fixtureWait=()=>fixtureEmit('turn/rootResumeWait/updated',{turnId:'old',wait:waitValue()});
window.fixtureBugProbe=()=>{fixtureWrongNotification(fixtureEnvironment,{method:'turn/deferred',params:{threadId:'thread-live',turn:nativeOld()}});return fixtureState.old.status==='inProgress'&&fixtureReceipt.updates.length===0};
window.fixtureStale=resume=>{replaceTurn('old',fixtureMergeSnapshot(fixtureState.old,{...fixtureState.old,status:'inProgress',durationMs:99000,rootResumeWait:null},{isResumeSnapshot:resume}));fixtureRerender()};
window.fixtureResume=()=>{fixtureEmit('turn/rootResumeWait/updated',{turnId:'old',wait:waitValue('resumed',2)});fixtureEmit('turn/started',{turn:{id:'new',status:'inProgress',durationMs:null,error:null}});fixtureEnvironment.notificationContext.updateTurnState('thread-live','new',t=>t.items.push({id:'new-reason',type:'reasoning',summary:['Resumed native work'],content:[]}));fixtureRerender()};
window.fixtureLoadOld=()=>{setTurns([oldTurn(),...allTurns().filter(t=>t.turnId!=='old')]);fixtureEnvironment.manager.broadcastConversationSnapshot('thread-live')};
window.fixtureReload=()=>{setTurns(fixtureHistory({threadId:'thread-live',permissions:{approvalPolicy:'never',approvalsReviewer:'user',sandboxPolicy:{type:'dangerFullAccess'}},turns:allTurns().map(t=>({id:t.turnId,status:t.status,startedAt:t.turnStartedAtMs/1000,completedAt:null,durationMs:t.durationMs,rootResumeWait:t.rootResumeWait,items:[]}))}));fixtureEnvironment.manager.broadcastConversationSnapshot('thread-live')};
function Fixture(){if(!fixtureStoreReady){VS();fixtureInitializeReducer();Qm();h4e({},()=>{});fixtureStoreReady=true}HFi();const [,update]=VFi.useState(0);window.fixtureRerender=()=>update(n=>n+1);const projected=(fixtureState.old?fixtureActivity(fixtureState.old).items:[]).filter(item=>item.type==='worked-for');return k7.jsxs('div',{children:[k7.jsx('div',{'data-fixture-old':'',children:projected.map((item,i)=>k7.jsx(fixtureDivider,item,i))},document.documentElement.dataset.theme),fixtureState.current&&k7.jsx('div',{'data-fixture-new':'',children:fixtureActivity(fixtureState.current).items.filter(item=>item.type==='worked-for').map((item,i)=>k7.jsx(fixtureDivider,item,i))})]})}
export {Fixture};`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-668342ae9abd.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5e7be244bca.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto flex w-full max-w-3xl flex-col p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {KEt,UEt} from '/assets/app-initial-efe028fd535e.js';import {Fixture} from '/assets/${mainName}';const $=KEt();window.reactRoot=UEt().createRoot(document.getElementById('root'));reactRoot.render($.jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);if(pathname===join(assets,mainName))source=main+adapterSource;if(pathname===join(assets,reducerName))source=reducer+reducerAdapter;if(pathname===join(assets,threadName))source=thread+threadAdapter;res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={sourceSha256:createHash('sha256').update(await readFile(join(root,'scripts/root-resume-wait.cjs'))).digest('hex'),scope:'Actual transformed module-bound notifications and native imported converter -> synthetic host store -> native lp/Yo/BS/Hgt projection, history mapper, snapshot merge and React clock/divider with native CSS in light/dark. Synthetic host/localization and advanced clock; no installed app or release build.',checks:[]},pending=new Map(),exceptions=[];
try{
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((r,j)=>{let s='';const t=setTimeout(()=>j(Error('Chrome startup timeout')),20000);chrome.stderr.on('data',c=>{s+=c;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);r(m[1])}});chrome.on('error',j)});
 socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')exceptions.push(m.params.args);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.j(Error(JSON.stringify(m.error))):p.r(m.result)}}});
 const send=(method,params={},sid=session)=>new Promise((r,j)=>{const n=++id,t=setTimeout(()=>j(Error('CDP timeout '+method)),20000);pending.set(n,{r,j,t});socket.send(JSON.stringify({id:n,method,params,...(sid?{sessionId:sid}:{})}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Wait failed: '+expression+'; '+JSON.stringify(await evaluate('({errors:fixtureErrors,body:document.body.innerText})')))};
 const check=(name,value)=>{assert.ok(value,name);summary.checks.push(name)};
 session=(await send('Target.attachToTarget',{targetId:(await send('Target.createTarget',{url:'about:blank'},null)).targetId,flatten:true},null)).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 await wait("window.fixtureReady && !!document.querySelector('[data-fixture-old] span')");
 const oldText=()=>evaluate("document.querySelector('[data-fixture-old]').innerText");
 const advance=async ms=>{await evaluate('fixtureNow+='+ms);await new Promise(r=>setTimeout(r,1100))};
 const screenshot=async name=>writeFile(join(logs,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixtureNow=20000;fixtureReset();fixtureRerender()`);
  check(theme+' actual native error-classifier alias misses deferred notification',await evaluate('fixtureBugProbe()'));
  await evaluate('fixtureReset();fixtureRerender()');
  await wait("document.querySelector('[data-fixture-old]').innerText.includes('Working')");
  const active=await oldText();await advance(3000);check(theme+' active work clock ticks',(await oldText())!==active);
  await evaluate('fixtureNow=20000;fixtureDefer()');await wait("document.querySelector('[data-fixture-old]').innerText.includes('Worked for 8s')");
  check(theme+' native notification targets actual thread and turn',await evaluate("fixtureReceipt.updates.length===1&&fixtureReceipt.updates[0].threadId==='thread-live'&&fixtureReceipt.updates[0].turnId==='old'&&fixtureReceipt.broadcasts[0]==='thread-live'&&fixtureReceipt.errors.length===0"));
  await advance(4000);check(theme+' waiting ticks independently',(await oldText()).includes('현재 4초 대기함'));
  check(theme+' old work freezes',(await oldText()).includes('Worked for 8s'));
  for(const resume of [false,true]){await evaluate('fixtureStale('+resume+')');await advance(3000);check(theme+' stale snapshot '+resume+' keeps deferred clock',await evaluate("fixtureState.old.status==='deferred'&&fixtureState.old.durationMs===8000")&&(await oldText()).includes('Worked for 8s'))}
  await screenshot(theme+'-waiting');
  await evaluate('fixtureResume()');await wait("document.querySelector('[data-fixture-old]').innerText.includes('10초 대기 후 재개됨')");
  const ended=await oldText();const newText=await evaluate("document.querySelector('[data-fixture-new]').innerText");await advance(5000);
  check(theme+' resumed wait and old work stay fixed',(await oldText())===ended);
  check(theme+' new work clock ticks',await evaluate("document.querySelector('[data-fixture-new]').innerText")!==newText);
  check(theme+' resumed notification reaches native thread',await evaluate("fixtureReceipt.updates.length===3&&fixtureReceipt.broadcasts.length===3"));
  await evaluate('fixtureReload()');await advance(3000);
  check(theme+' native history reload preserves frozen work and wait',(await oldText())===ended&&await evaluate("fixtureState.old.durationMs===8000&&fixtureState.old.rootResumeWait.waitEndedAtMs===30000"));
  const style=await evaluate("(()=>{const e=document.querySelector('[data-fixture-old] span'),s=getComputedStyle(e),line=document.querySelector('[data-fixture-old] .border-t');return {color:s.color,font:s.fontFamily,height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,line:getComputedStyle(line).borderTopWidth}})()");
  check(theme+' native divider geometry',style.height>10&&style.width>20&&style.line==='1px');summary[theme]={text:await oldText(),style};await screenshot(theme+'-resumed');
 }

 for(const theme of ['light','dark'])for(const layout of ['legacy','canonical']){
  const label=theme+' '+layout;
  await evaluate("document.documentElement.dataset.theme="+JSON.stringify(theme)+";document.body.dataset.vscodeThemeKind='vscode-"+theme+"';fixtureNow=20000;fixtureReset('"+layout+"');fixtureRerender()");
  await wait("document.querySelector('[data-fixture-old]').innerText.includes('Working')");const initial=await oldText();await advance(3000);check(label+' missed defer begins with ticking native work',(await oldText())!==initial);
  await evaluate('fixtureNow=20000;fixtureWait()');await wait("document.querySelector('[data-fixture-old]').innerText.includes('작업 시간 확인 불가')");
  check(label+' waiting callback finds real historical turn and queries once',await evaluate("fixtureState.old.status==='deferred'&&fixtureState.old.durationMs===null&&fixtureReceipt.queries.length===1&&fixtureReceipt.queries[0].id==='thread-live'"));
  await advance(4000);check(label+' unknown work stops while wait clock advances',(await oldText()).includes('작업 시간 확인 불가')&&(await oldText()).includes('현재 4초 대기함')&&!(await oldText()).includes('Working'));
  await screenshot(theme+'-'+layout+'-missed-defer-unknown');
  await evaluate('fixtureResolveQuery()');await wait("document.querySelector('[data-fixture-old]').innerText.includes('Worked for 8s')");await advance(3000);check(label+' later authoritative response fixes old duration',(await oldText()).includes('Worked for 8s')&&await evaluate('fixtureState.old.turnStartedAtMs===12000&&allTurns().length===1'));
  await evaluate('fixtureResume()');await wait("document.querySelector('[data-fixture-old]').innerText.includes('7초 대기 후 재개됨')");const frozen=await oldText(),activeNew=await evaluate("document.querySelector('[data-fixture-new]').innerText");await advance(5000);
  check(label+' native turn started creates separate ticking turn',await evaluate("allTurns().length===2&&fixtureState.current.turnId==='new'&&fixtureState.old.turnId==='old'")&&await evaluate("document.querySelector('[data-fixture-new]').innerText")!==activeNew);
  check(label+' old duration and resumed wait freeze',(await oldText())===frozen);
  await evaluate('fixtureDefer();fixtureDefer()');await advance(3000);check(label+' delayed duplicate defer cannot restart resumed wait',(await oldText())===frozen&&await evaluate("fixtureState.old.rootResumeWait.state==='resumed'&&fixtureState.old.rootResumeWait.revision===2"));
  await evaluate('fixtureReload()');await advance(3000);check(label+' native history reload preserves recovered old clock',(await oldText())===frozen);await screenshot(theme+'-'+layout+'-missed-defer-resumed');
  await evaluate("fixtureNow=20000;fixtureReset('"+layout+"',true);fixtureWait()");await wait('fixtureReceipt.queries.length===1');
  check(label+' missing history callback does not synthesize a tail',await evaluate('allTurns().length===0&&fixtureReceipt.updates.length===0'));
  await evaluate('fixtureResolveQuery()');await wait("fixtureReceipt.recovery.some(e=>e[1].safe.outcome==='query_resolved')");
  check(label+' authoritative query retains missing old metadata without fake tail',await evaluate('allTurns().length===0&&fixtureReceipt.updates.length===0'));
  await evaluate('fixtureLoadOld()');await wait("document.querySelector('[data-fixture-old]').innerText.includes('Worked for 8s')");check(label+' ordinary history load broadcast applies same old ID',await evaluate("allTurns().length===1&&fixtureState.old.turnId==='old'&&fixtureState.old.status==='deferred'&&fixtureState.old.durationMs===8000"));await advance(4000);check(label+' recovered missing history renders fixed work and ticking wait',(await oldText()).includes('Worked for 8s')&&(await oldText()).includes('현재 4초 대기함'));
  await evaluate("fixtureNow=20000;fixtureReset('"+layout+"');fixtureWait()");await wait("document.querySelector('[data-fixture-old]').innerText.includes('작업 시간 확인 불가')");await evaluate('fixtureNow=27000;fixtureResolveQuery(true)');await wait("document.querySelector('[data-fixture-old]').innerText.includes('7초 대기 후 재개됨')");const nativeTerminal=await oldText();await advance(4000);check(label+' authoritative resumed metadata closes wait and freezes both clocks',(await oldText())===nativeTerminal&&nativeTerminal.includes('Worked for 8s')&&await evaluate("fixtureState.old.rootResumeWait.state==='resumed'&&fixtureState.old.rootResumeWait.waitEndedAtMs===27000"));await evaluate('fixtureDefer();fixtureReload()');await advance(3000);check(label+' authoritative terminal wait survives delayed defer and reload',(await oldText())===nativeTerminal);

 }
 check('native themes change label color',summary.light.style.color!==summary.dark.style.color);
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
 if(chrome?.exitCode===null)await new Promise(r=>{const t=setTimeout(r,5000);chrome.once('exit',()=>{clearTimeout(t);r()})});
 const allowed=join(root,'artifacts/verification')+sep;
 if(chrome?.exitCode!==null&&fixture.startsWith(allowed)){const cleanupCommand=String.raw`$ErrorActionPreference='Stop'; $target=[IO.Path]::GetFullPath($env:AZRAEL_TIMER_FIXTURE); $allowed=[IO.Path]::GetFullPath($env:AZRAEL_TIMER_PARENT).TrimEnd('\')+'\'; if(-not $target.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw 'Fixture containment failed'}; for($cursor=$target;$cursor;$cursor=[IO.Path]::GetDirectoryName($cursor)){if((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Linked cleanup path'}}; for($attempt=0;$attempt -lt 20;$attempt++){ $references=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'chrome.exe' -and $_.CommandLine -and $_.CommandLine.Contains($target)}); if($references.Count -eq 0){break}; Start-Sleep -Milliseconds 250 }; if($references.Count -ne 0){throw 'Owned browser still references fixture'}; Remove-Item -LiteralPath $target -Recurse -Force; if(Test-Path -LiteralPath $target){throw 'Fixture remains'}`;
 const cleanup=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',cleanupCommand],{windowsHide:true,env:{...process.env,AZRAEL_TIMER_FIXTURE:fixture,AZRAEL_TIMER_PARENT:join(root,'artifacts/verification')},stdio:['ignore','pipe','pipe']});let cleanupOutput='';cleanup.stdout.on('data',c=>cleanupOutput+=c);cleanup.stderr.on('data',c=>cleanupOutput+=c);const cleanupExit=await new Promise((r,j)=>{cleanup.on('error',j);cleanup.on('exit',r)});summary.cleanupExitCode=cleanupExit;summary.cleanup=cleanupExit===0?'Owned browser exited; guarded native PowerShell fixture/profile removal verified':cleanupOutput; if(cleanupExit!==0)process.exitCode=1}else{summary.cleanup='Browser exit uncertain; profile retained until confirmed closed';process.exitCode=1}
 summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
