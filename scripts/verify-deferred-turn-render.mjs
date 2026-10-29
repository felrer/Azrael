import artifactRunTools from './artifact-run.cjs';
const {beginArtifactRun,trackArtifactChild}=artifactRunTools;
import {createRequire} from 'node:module';
import {spawn as nativeSpawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {EventEmitter} from 'node:events';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const renderScope=process.env.AZRAEL_DEFERRED_RENDER_SCOPE??'full';
assert.ok(['full','branch','management'].includes(renderScope));
const artifactRun=beginArtifactRun(root,{workId:'verify-deferred-turn-render',owner:'scripts/verify-deferred-turn-render.mjs',paths:{...(process.env.AZRAEL_RENDER_FIXTURE_ROOT ? {temporary:resolve(root,process.env.AZRAEL_RENDER_FIXTURE_ROOT)} : {}),...((process.env.AZRAEL_RENDER_LOG_ROOT || process.env.AZRAEL_DEFERRED_RENDER_LOG_DIR) ? {logs:resolve(root,(process.env.AZRAEL_RENDER_LOG_ROOT || process.env.AZRAEL_DEFERRED_RENDER_LOG_DIR))} : {})}});
const spawn=(...args)=>trackArtifactChild(artifactRun,nativeSpawn(...args));
const confirmOwnedBrowserExit=(child,profilePath)=>artifactRunTools.confirmOwnedBrowserExit(child,profilePath,spawn);
const containedPath=(value,parent,label)=>{const target=resolve(root,value),allowed=resolve(root,parent)+sep;assert.ok(target.toLowerCase().startsWith(allowed.toLowerCase()),label+' must be a descendant of '+parent);return target};
const fixture=artifactRun.temporary;
const logs=artifactRun.logs;
const assets=join(root,"artifacts/upstream-ui/26.1007.21434/webview/assets");
const profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);
const ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const {injectDeferredPresentation,injectDeferredTurn,injectDeferredThread,DEFERRED_PRESENTATION_ASSET,DEFERRED_REDUCER_ASSET,DEFERRED_THREAD_ASSET,DEFERRED_TURN_ASSET,injectDeferredTurnView}=require('./inject-deferred-turn.cjs');
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const mainName=DEFERRED_PRESENTATION_ASSET.split('/').at(-1);
const {injectStudentDesign}=require('./inject-student-design.cjs');
const main=injectStudentDesign(injectDeferredPresentation(await readFile(join(assets,mainName),'utf8')).text,DEFERRED_PRESENTATION_ASSET,ts).text;
const ast=ts.createSourceFile('main.js',main,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const named=(tree,name)=>{const owner=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(owner,'Pinned function '+name);return owner};
const adaptations={le:'fixtureLocale',U:'FixtureMessage',Vzi:'fixtureClock',zzi:'fixtureLabel',Bzi:'fixtureDivider'};
const adapt=owner=>{let source=owner.getText(ast),edits=[];function visit(n){if(ts.isIdentifier(n)&&adaptations[n.text]&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(ast)-owner.getStart(ast),end:n.end-owner.getStart(ast),text:adaptations[n.text]});ts.forEachChild(n,visit)}visit(owner);for(const e of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,e.start)+e.text+source.slice(e.end);return source};
const reducer=injectDeferredTurn(await readFile(join(assets,DEFERRED_REDUCER_ASSET.split('/').at(-1)),'utf8')).text;
const reducerAst=ts.createSourceFile('reducer.js',reducer,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const reducerName=DEFERRED_REDUCER_ASSET.split('/').at(-1);
const threadName=DEFERRED_THREAD_ASSET.split('/').at(-1);
const thread=injectDeferredThread(await readFile(join(assets,threadName),'utf8')).text;
// Append exports in the original module scope: converters, merge helpers and
// projection dependencies retain their real pinned imports and implementation.
const reducerAdapter=String.raw`
export {ZTn as fixtureNotification,Lle as fixtureMergeSnapshot,rxn as fixtureHistory,lg as fixtureInitializeReducer,vg as fixtureFindTurn,yg as fixtureFindEntry,Sg as fixtureCanonicalHistory,azraelFlushDeferred as fixtureFlushDeferred};
export const fixtureWrongNotification=${named(reducerAst,'ZTn').getText(reducerAst).replace('function ZTn(', 'function fixtureWrongNotification(').replaceAll('l=B(s);','l=_e(s);')};`;
const turnName=DEFERRED_TURN_ASSET.split('/').at(-1);
const branchTurn=injectDeferredTurnView(await readFile(join(assets,turnName),'utf8')).text+'\nexport {azraelResumeBranchScope};';
const threadAdapter="\nexport function fixtureActivity(turn){return fp({requests:[],generatedImages:[],isBackgroundSubagentsEnabled:false},turn,{key:turn.turnId,itemIds:turn.items.map(item=>item.id),state:'active',presentation:'codex',startedAtMs:turn.turnStartedAtMs,completedAtMs:null},null,false).turnState;}";
const adapterSource=String.raw`
import {fixtureNotification,fixtureWrongNotification,fixtureMergeSnapshot,fixtureHistory,fixtureInitializeReducer,fixtureFindTurn,fixtureFindEntry,fixtureCanonicalHistory,fixtureFlushDeferred} from './${reducerName}';
import {fixtureActivity} from './${threadName}';
import {azraelResumeBranchScope as fixtureBranchScope} from './${turnName}';
window.fixtureBranchEnabled=false;window.fixtureBranchCalls=[];
const fixtureLocale=()=>({locale:'en-US'});
let fixtureStoreReady=false;
window.fixtureCondition='agents';
const fixtureReservations=()=>[{id:'r1',revision:1,state:'waiting',completionTasks:fixtureCondition==='agents'?[]:['work-1'],agentTasks:fixtureCondition==='work'?[]:[{threadId:'child-a',turnId:'a1',agentPath:'/root/first'},{threadId:'child-b',turnId:'b1',agentPath:'/root/second'}]}];
window.fixtureResumeRequests=[];window.fixtureResumeFailure=false;
window.fixtureReconnectRequests=[];window.fixtureConnection=null;
let fixtureResumeReceive;
azraelRootResumeStore=createRootResumeStore({subscribe:(_type,receive)=>{fixtureResumeReceive=receive;return()=>{}},dispatchMessage:(_type,request)=>{
 if(request.action==='unsubscribe')return;
 if(request.action==='reconnect'){fixtureReconnectRequests.push(request);fixtureConnection={...fixtureConnection,reconnecting:true};fixtureResumeReceive({clientId:'fixture',reservations:fixtureReservations(),...fixtureConnection});return}
 if(request.action==='resume'){fixtureResumeRequests.push(request);window.fixtureCompleteManualResume=()=>fixtureResumeReceive({clientId:'fixture',available:true,reservations:fixtureReservations().map(r=>({...r,state:fixtureResumeFailure?'waiting':'resumed',revision:fixtureResumeFailure?2:3})),error:fixtureResumeFailure?'예약 revision이 변경되었습니다. 다시 확인해 주세요.':null});return}
 queueMicrotask(()=>fixtureResumeReceive({clientId:'fixture',available:true,reservations:fixtureReservations(),...fixtureConnection}));
}},'fixture');
window.fixtureDisconnect=()=>{fixtureConnection={available:false,connectionError:true,error:'관리 연결이 끊겼습니다. 재접속해 주세요.',reconnecting:false};fixtureResumeReceive({clientId:'fixture',reservations:fixtureReservations(),...fixtureConnection})};
window.fixtureCompleteReconnect=success=>{fixtureConnection=success?{available:true,connectionError:false,error:null,reconnecting:false}:{available:false,connectionError:true,error:'관리 연결 재접속에 실패했습니다. 다시 시도해 주세요.',reconnecting:false};fixtureResumeReceive({clientId:'fixture',reservations:fixtureReservations().map(r=>({...r,revision:success?4:1})),...fixtureConnection})};
window.fixtureReconnectButton=()=>[...document.querySelectorAll('[data-azrael-root-resume] button')].find(b=>b.textContent.includes('재접속'));
window.fixtureResumeButton=()=>[...document.querySelectorAll('[data-azrael-root-resume] button')].find(b=>b.textContent==='재개');
window.fixtureResumeSnapshot=()=>azraelRootResumeStore.getSnapshot();
window.fixtureRepeatReconnect=()=>azraelRootResumeStore.reconnect();
window.fixtureSetCondition=kind=>{window.fixtureCondition=kind;azraelRootResumeStore.refresh()};
const fixturePhoto='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#747cc5"/><circle cx="12" cy="9" r="5" fill="#f5d4bc"/><path d="M3 24a9 9 0 0118 0" fill="#394271"/></svg>');
azraelDesignStore={subscribe:()=>()=>{},getSnapshot:()=>fixtureDesignSnapshot,dispose:()=>{}};
const fixtureDesignSnapshot={students:[{id:1,url:fixturePhoto}],assignments:{'child-a':1,'child-b':1}};
function FixtureMessage({defaultMessage,values={}}){return defaultMessage.replace(/\{(\w+)\}/g,(_,key)=>values[key]??key)}
${["Vzi","zzi","Bzi"].map(n=>adapt(named(ast,n))).join(String.fromCharCode(10))}
window.fixtureNow=20000;Date.now=()=>fixtureNow;

const waitValue=(state='waiting',revision=1)=>({reservationId:'r1',revision,waitStartedAtMs:20000,waitEndedAtMs:state==='resumed'?fixtureNow:null,resumeAtMs:80000,state,canWakeEarly:true});
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
function Fixture(){if(!fixtureStoreReady){rC();fixtureInitializeReducer();Gm();a3e({},()=>{});fixtureStoreReady=true}Gzi();const [,update]=Wzi.useState(0);window.fixtureRerender=()=>update(n=>n+1);const projected=(fixtureState.old?fixtureActivity(fixtureState.old).items:[]).filter(item=>item.type==='worked-for');return E7.jsxs('div',{children:[E7.jsx('div',{'data-fixture-old':'',children:projected.map((item,i)=>fixtureBranchScope(E7.jsx(fixtureDivider,item,i),fixtureBranchEnabled?()=>fixtureBranchCalls.push(fixtureState.old.turnId):undefined))},document.documentElement.dataset.theme),fixtureState.current&&E7.jsx('div',{'data-fixture-new':'',children:fixtureActivity(fixtureState.current).items.filter(item=>item.type==='worked-for').map((item,i)=>E7.jsx(fixtureDivider,item,i))})]})}
export {Fixture};`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5b2ced5ef25.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto flex w-full max-w-3xl flex-col p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {$At,XAt} from '/assets/app-initial-97d3534ad35f.js';import {Fixture} from '/assets/${mainName}';const $=$At();window.reactRoot=XAt().createRoot(document.getElementById('root'));reactRoot.render($.jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
let management;
if(renderScope==='management'){
 const load=async(name,imports)=>{const exports={};runInNewContext(ts.transpileModule(await readFile(join(root,'extensions/azrael-ex/src',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:id=>{assert.ok(id in imports,'Fixture import '+id);return imports[id]},setInterval,clearInterval});return exports};
 const protocol=await load('rootResumeProtocol',{'./protocol':{isRecord:value=>!!value&&typeof value==='object'&&!Array.isArray(value)}});
 let markup,receive,complete;const requests=[],messages=[];
 const panel={visible:true,reveal(){},onDidChangeViewState(){},onDidDispose(){},dispose(){},webview:{onDidReceiveMessage(fn){receive=fn},set html(value){markup=value}}};
 const {RootResumeView}=await load('rootResumeView',{'./rootResumeProtocol':protocol,vscode:{ViewColumn:{Active:1},window:{createWebviewPanel:()=>panel,showErrorMessage(){},showWarningMessage:async()=>undefined}}});
 const service=new EventEmitter();service.rootResumeAvailable=false;service.rootResumeReservations=[{id:'management-r1',rootThreadId:'root-fixture',revision:1,state:'waiting',resumeAtMs:Date.now()+60000,reason:'관리 연결 재접속 검증',agentTasks:[],completionTasks:[],lastError:null}];
 service.rootResume=async request=>{requests.push(request);if(!service.rootResumeAvailable)throw Error('management disconnected');return {reservations:service.rootResumeReservations}};
 service.connect=()=>new Promise((resolve,reject)=>{complete=success=>{if(success){service.rootResumeAvailable=true;service.rootResumeReservations[0].revision=4;service.emit('rootResumeConnection',true);resolve()}else reject(Error('management connection failed'))}});
 const view=new RootResumeView(service);view.show();
 management={view,service,requests,messages,html:()=>markup,receive:message=>{messages.push(message);receive(message)},complete:success=>complete(success),reset:()=>{service.rootResumeAvailable=false;service.emit('rootResumeConnection',false);requests.length=0;messages.length=0}};
}
const server=createServer(async(req,res)=>{try{
 if(req.url==='/management-message'){let body='';for await(const chunk of req)body+=chunk;management.receive(JSON.parse(body));await new Promise(r=>setImmediate(r));res.end('ok');return}
 if(req.url==='/management'){const source=management.html(),nonce=source.match(/<script nonce="([^"]+)"/)[1];res.setHeader('Content-Type','text/html; charset=utf-8');res.end(source.replace("default-src 'none';","default-src 'none'; connect-src 'self';").replace('<body>',`<body><script nonce="${nonce}">window.fixtureErrors=[];globalThis.acquireVsCodeApi=()=>({postMessage(m){window.messageDone=fetch('/management-message',{method:'POST',body:JSON.stringify(m)})}});addEventListener('error',e=>fixtureErrors.push(e.message));</script>`));return}
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);if(pathname===join(assets,mainName))source=main+adapterSource;if(pathname===join(assets,reducerName))source=reducer+reducerAdapter;if(pathname===join(assets,turnName))source=branchTurn;if(pathname===join(assets,threadName))source=thread+threadAdapter;res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={sourceSha256:createHash('sha256').update(await readFile(join(root,'scripts/root-resume-wait.cjs'))).digest('hex'),scope:"Actual transformed module-bound notifications and native imported converter -> synthetic host store -> native fp/Yo/BS/Cyt projection, history mapper, snapshot merge and React clock/divider with native CSS in light/dark. Management reconnect uses a fixture host bridge with controlled pending/failure/success responses; real host transport is outside this renderer check. Synthetic host/localization and advanced clock; no installed app or release build.",checks:[]},pending=new Map(),exceptions=[];
summary.renderScope=renderScope;
if(management)summary.scope='Windows Chrome CDP rendering of transpiled production RootResumeView HTML, nonce script and CSS with fixture VS Code/account EventEmitter service. Controlled connect pending/failure/success; actual host transport, installed app and other OS excluded.';
try{
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new',"--no-first-run",'--no-default-browser-check','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((r,j)=>{let s='';const t=setTimeout(()=>j(Error('Chrome startup timeout')),20000);chrome.stderr.on('data',c=>{s+=c;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);r(m[1])}});chrome.on('error',j)});
 socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')exceptions.push(m.params.args);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.j(Error(JSON.stringify(m.error))):p.r(m.result)}}});
 const send=(method,params={},sid=session)=>new Promise((r,j)=>{const n=++id,t=setTimeout(()=>j(Error('CDP timeout '+method)),20000);pending.set(n,{r,j,t});socket.send(JSON.stringify({id:n,method,params,...(sid?{sessionId:sid}:{})}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Wait failed: '+expression+'; '+JSON.stringify(await evaluate('({errors:fixtureErrors,body:document.body.innerText})')))};
 const check=(name,value)=>{assert.ok(value,name);summary.checks.push(name)};
 session=(await send('Target.attachToTarget',{targetId:(await send('Target.createTarget',{url:'about:blank'},null)).targetId,flatten:true},null)).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 const screenshot=async name=>writeFile(join(logs,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 if(management){
  for(const theme of ['light','dark']){
   const foreground=theme==='light'?'#202020':'#ececec',background=theme==='light'?'#ffffff':'#181818';
   const palette={'--vscode-font-family':'Arial, sans-serif','--vscode-editor-font-family':'Consolas, monospace','--vscode-foreground':foreground,'--vscode-descriptionForeground':theme==='light'?'#666666':'#aaaaaa','--vscode-panel-border':theme==='light'?'#dedede':'#444444','--vscode-badge-background':theme==='light'?'#ececec':'#333333','--vscode-badge-foreground':foreground,'--vscode-button-background':'#0969da','--vscode-button-foreground':'#ffffff','--vscode-button-hoverBackground':'#0858bb','--vscode-button-secondaryBackground':theme==='light'?'#ececec':'#333333','--vscode-button-secondaryForeground':foreground,'--vscode-button-secondaryHoverBackground':theme==='light'?'#dedede':'#444444','--vscode-errorForeground':theme==='light'?'#b42318':'#ff8080','--vscode-charts-blue':theme==='light'?'#0969da':'#75b4ff'};
   const reload=async()=>{await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/management`});await wait("!!document.querySelector('[data-action=resume]')");await evaluate(`(()=>{for(const [key,value] of Object.entries(${JSON.stringify(palette)}))document.documentElement.style.setProperty(key,value);document.body.style.background=${JSON.stringify(background)};})()`)};
   management.reset();await reload();
   check(theme+' management disconnected shows error and blocks resume',await evaluate("!document.querySelector('[data-action=reconnect]').disabled&&document.querySelector('[data-action=resume]').disabled&&!!document.querySelector('[role=alert]')"));
   check(theme+' management theme colors applied',await evaluate(`getComputedStyle(document.body).color==='${theme==='light'?'rgb(32, 32, 32)':'rgb(236, 236, 236)'}'&&getComputedStyle(document.querySelector('[data-action=reconnect]')).backgroundColor==='${theme==='light'?'rgb(236, 236, 236)':'rgb(51, 51, 51)'}'`));
   await screenshot(theme+'-management-disconnected');
   const point=await evaluate("(()=>{const r=document.querySelector('[data-action=reconnect]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()");
   await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
   await evaluate('messageDone');await reload();
   check(theme+' management original nonce click posts reconnect only',management.messages.length===1&&management.messages[0].action==='reconnect'&&!management.requests.some(r=>r.action==='resume'));
   check(theme+' management pending disables reconnect and resume',await evaluate("document.querySelector('[data-action=reconnect]').disabled&&document.querySelector('[data-action=reconnect]').textContent==='재접속 중…'&&document.querySelector('[data-action=resume]').disabled"));
   await screenshot(theme+'-management-pending');management.complete(false);await new Promise(r=>setImmediate(r));await reload();
   check(theme+' management failed reconnect permits retry',await evaluate("!document.querySelector('[data-action=reconnect]').disabled&&document.querySelector('[data-action=resume]').disabled&&!!document.querySelector('[role=alert]')"));
   await send('Emulation.setDeviceMetricsOverride',{width:360,height:740,deviceScaleFactor:1,mobile:false});await screenshot(theme+'-management-narrow-failed');
   check(theme+' management narrow page has no overflow',await evaluate('document.documentElement.scrollWidth<=360'));
   await evaluate("document.querySelector('[data-action=reconnect]').focus()");await send('Page.bringToFront');
   await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await evaluate('messageDone');
   check(theme+' management keyboard retries reconnect without resume',management.messages.length===2&&management.messages.every(m=>m.action==='reconnect')&&!management.requests.some(r=>r.action==='resume'));
   management.complete(true);await new Promise(r=>setImmediate(r));await reload();
   check(theme+' management reconnect success clears error and restores latest resume',await evaluate("!document.querySelector('[data-action=reconnect]')&&!document.querySelector('[role=alert]')&&!document.querySelector('[data-action=resume]').disabled&&document.querySelector('[data-action=resume]').dataset.revision==='4'"));
   await screenshot(theme+'-management-narrow-success');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});
  }
 }else{
 await wait("window.fixtureReady && !!document.querySelector('[data-fixture-old] span')");
 const oldText=()=>evaluate("document.querySelector('[data-fixture-old]').innerText");
 const advance=async ms=>{await evaluate('fixtureNow+='+ms);await new Promise(r=>setTimeout(r,1100))};
 if(renderScope==='full'){
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixtureNow=20000;fixtureReset();fixtureRerender()`);
  check(theme+' actual native error-classifier alias misses deferred notification',await evaluate('fixtureBugProbe()'));
  await evaluate('fixtureReset();fixtureRerender()');
  await wait("document.querySelector('[data-fixture-old]').innerText.includes('Working')");
  const active=await oldText();await advance(3000);check(theme+' active work clock ticks',(await oldText())!==active);
  await evaluate('fixtureNow=20000;fixtureDefer()');await wait("document.querySelector('[data-fixture-old]')?.innerText.includes('Worked for 8s')");
  check(theme+' native notification targets actual thread and turn',await evaluate("fixtureReceipt.updates.length===1&&fixtureReceipt.updates[0].threadId==='thread-live'&&fixtureReceipt.updates[0].turnId==='old'&&fixtureReceipt.broadcasts[0]==='thread-live'&&fixtureReceipt.errors.length===0"));
  await advance(4000);check(theme+' waiting ticks independently',(await oldText()).includes('재개까지 4/60초'));
  check(theme+' old work freezes',(await oldText()).includes('Worked for 8s'));
  for(const resume of [false,true]){await evaluate('fixtureStale('+resume+')');await advance(3000);check(theme+' stale snapshot '+resume+' keeps deferred clock',await evaluate("fixtureState.old.status==='deferred'&&fixtureState.old.durationMs===8000")&&(await oldText()).includes('Worked for 8s'))}
  await screenshot(theme+'-waiting');
  await wait("document.querySelectorAll('[data-azrael-root-resume] img').length===2");
  check(theme+' selected child photos overlap by one third',await evaluate("(()=>{const a=[...document.querySelectorAll('[data-azrael-root-resume] img')].map(e=>e.getBoundingClientRect());return a[0].width===24&&Math.abs(a[1].left-a[0].left-16)<1})()"));
  check(theme+' resume is native and right aligned',await evaluate("(()=>{const b=document.querySelector('[data-azrael-root-resume] button'),row=b.closest('[data-azrael-root-resume]').querySelector('[data-azrael-resume-row]'),r=b.getBoundingClientRect();return b.textContent==='재개'&&!b.disabled&&r.height>=22&&r.width>=35&&Math.abs(r.right-row.getBoundingClientRect().right)<1})()"));
  check(theme+' agent-only wait label',(await oldText()).includes('하위 에이전트 응답 대기중'));
  for(const [kind,text] of [['work','작업 완료 시 조기 재개'],['mixed','재개 조건 설정됨']]){
   await evaluate(`fixtureSetCondition('${kind}')`);
   await wait(`document.querySelector('[data-fixture-old]').innerText.includes('${text}')`);
   check(theme+' '+kind+' wait label',(await oldText()).includes(text));
   await screenshot(theme+'-'+kind+'-waiting-controls');
  }
  await evaluate("fixtureSetCondition('agents')");
  await wait("document.querySelector('[data-fixture-old]').innerText.includes('하위 에이전트 응답 대기중')");
  await screenshot(theme+'-waiting-controls');
  await send('Emulation.setDeviceMetricsOverride',{width:360,height:740,deviceScaleFactor:1,mobile:false});
  await wait("window.innerWidth===360");
  check(theme+' narrow wait photos and resume stay within row',await evaluate("(()=>{const e=document.querySelector('[data-azrael-root-resume]'),r=e.getBoundingClientRect(),b=e.querySelector('button'),images=[...e.querySelectorAll('img')];return document.documentElement.scrollWidth<=360&&r.left>=0&&r.right<=360&&b&&!b.disabled&&[b,...images].every(n=>{const a=n.getBoundingClientRect();return a.left>=r.left&&a.right<=r.right+1&&a.height>=22})})()"));
  await screenshot(theme+'-narrow-waiting-controls');
  await evaluate("fixtureState.old.rootResumeWait={...fixtureState.old.rootResumeWait,canWakeEarly:false};fixtureRerender()");
  await wait("document.querySelectorAll('[data-azrael-root-resume] img').length===0");
  check(theme+' deadline only wait has no child photos',await evaluate("document.querySelector('[data-azrael-root-resume] button').textContent==='재개'"));
  check(theme+' deadline only wait has no condition label',!(await oldText()).includes(' · '));
  await evaluate("fixtureState.old.rootResumeWait={...fixtureState.old.rootResumeWait,canWakeEarly:true};fixtureRerender()");
  await wait("document.querySelectorAll('[data-azrael-root-resume] img').length===2");
  await evaluate("fixtureResumeFailure=true;document.querySelector('[data-azrael-root-resume] button').click()");
  check(theme+' manual resume locks pending action',await evaluate("document.querySelector('[data-azrael-root-resume] button').disabled&&fixtureResumeRequests.at(-1).reservationId==='r1'&&fixtureResumeRequests.at(-1).revision===1"));
  await evaluate('fixtureCompleteManualResume()');await wait("!!document.querySelector('[data-azrael-root-resume] [role=alert]')");
  check(theme+' race error keeps native retry available',await evaluate("!document.querySelector('[data-azrael-root-resume] button').disabled"));
  await evaluate("fixtureResumeFailure=false;document.querySelector('[data-azrael-root-resume] button').focus()");
  await send('Page.bringToFront');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait('fixtureResumeRequests.at(-1).revision===2');await evaluate('fixtureCompleteManualResume()');
  await wait("!document.querySelector('[data-azrael-root-resume] button')");
  check(theme+' successful resume removes controls',await evaluate("!document.querySelector('[data-azrael-root-resume] [role=alert]')"));
  check(theme+' narrow mouse and keyboard resume remain usable',await evaluate("fixtureResumeRequests.at(-1).revision===2&&document.documentElement.scrollWidth<=360"));
  await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});
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
  await advance(4000);check(label+' unknown work stops while wait clock advances',(await oldText()).includes('작업 시간 확인 불가')&&(await oldText()).includes('재개까지 4/60초')&&!(await oldText()).includes('Working'));
  await screenshot(theme+'-'+layout+'-missed-defer-unknown');
  await evaluate('fixtureResolveQuery()');await wait("document.querySelector('[data-fixture-old]').innerText.includes('Worked for 8s')");await advance(3000);check(label+' later authoritative response fixes old duration',(await oldText()).includes('Worked for 8s')&&await evaluate('fixtureState.old.turnStartedAtMs===12000&&allTurns().length===1'));
  await evaluate('fixtureResume()');await wait("document.querySelector('[data-fixture-old]').innerText.includes('7초 대기 후 재개됨')");const frozen=await oldText(),activeNew=await evaluate("document.querySelector('[data-fixture-new]').innerText");await advance(5000);
  check(label+' native turn started creates separate ticking turn',await evaluate("allTurns().length===2&&fixtureState.current.turnId==='new'&&fixtureState.old.turnId==='old'")&&await evaluate("document.querySelector('[data-fixture-new]').innerText")!==activeNew);
  check(label+' old duration and resumed wait freeze',(await oldText())===frozen);
  await evaluate('fixtureDefer();fixtureDefer()');await advance(3000);check(label+' delayed duplicate defer cannot restart resumed wait',(await oldText())===frozen&&await evaluate("fixtureState.old.rootResumeWait.state==='resumed'&&fixtureState.old.rootResumeWait.revision===2"));
  await evaluate('fixtureReload()');await advance(3000);check(label+' native history reload preserves recovered old clock',(await oldText())===frozen);await screenshot(theme+'-'+layout+'-missed-defer-resumed');
  await evaluate("fixtureNow=20000;fixtureReset('"+layout+"',true);fixtureWait()");await wait('fixtureReceipt.queries.length===1');
  check(label+" missing history callback does not synthesize a tail",await evaluate('allTurns().length===0&&fixtureReceipt.updates.length===0'));
  await evaluate('fixtureResolveQuery()');await wait("fixtureReceipt.recovery.some(e=>e[1].safe.outcome==='query_resolved')");
  check(label+' authoritative query retains missing old metadata without fake tail',await evaluate('allTurns().length===0&&fixtureReceipt.updates.length===0'));
  await evaluate('fixtureLoadOld()');await wait("document.querySelector('[data-fixture-old]').innerText.includes('Worked for 8s')");check(label+' ordinary history load broadcast applies same old ID',await evaluate("allTurns().length===1&&fixtureState.old.turnId==='old'&&fixtureState.old.status==='deferred'&&fixtureState.old.durationMs===8000"));await advance(4000);check(label+' recovered missing history renders fixed work and ticking wait',(await oldText()).includes('Worked for 8s')&&(await oldText()).includes('재개까지 4/60초'));
  await evaluate("fixtureNow=20000;fixtureReset('"+layout+"');fixtureWait()");await wait("document.querySelector('[data-fixture-old]').innerText.includes('작업 시간 확인 불가')");await evaluate('fixtureNow=27000;fixtureResolveQuery(true)');await wait("document.querySelector('[data-fixture-old]').innerText.includes('7초 대기 후 재개됨')");const nativeTerminal=await oldText();await advance(4000);check(label+' authoritative resumed metadata closes wait and freezes both clocks',(await oldText())===nativeTerminal&&nativeTerminal.includes('Worked for 8s')&&await evaluate("fixtureState.old.rootResumeWait.state==='resumed'&&fixtureState.old.rootResumeWait.waitEndedAtMs===27000"));await evaluate('fixtureDefer();fixtureReload()');await advance(3000);check(label+' authoritative terminal wait survives delayed defer and reload',(await oldText())===nativeTerminal);

 }
 check('native themes change label color',summary.light.style.color!==summary.dark.style.color);
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixtureConnection=null;fixtureBranchEnabled=false;fixtureCondition='agents';fixtureNow=20000;fixtureReset();fixtureDefer();fixtureRerender()`);
  await wait('!!fixtureResumeButton()&&!fixtureResumeButton().disabled');
  await evaluate('fixtureResumeRequests=[];fixtureReconnectRequests=[];fixtureDisconnect()');
  await wait('!!fixtureReconnectButton()&&fixtureResumeButton().disabled');
  check(theme+' disconnected management state offers native reconnect and blocks resume',await evaluate("fixtureReconnectButton().textContent==='관리 연결 재접속'&&!fixtureReconnectButton().disabled&&!!document.querySelector('[data-azrael-root-resume] [role=alert]')&&fixtureReconnectButton().getBoundingClientRect().height>=22"));
  await screenshot(theme+'-reconnect-disconnected');
  const reconnectPoint=await evaluate('(()=>{const r=fixtureReconnectButton().getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...reconnectPoint});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...reconnectPoint});
  await wait("fixtureReconnectButton()?.textContent==='재접속 중…'");
  await evaluate('fixtureReconnectButton().click();fixtureResumeButton().click();fixtureRepeatReconnect()');
  check(theme+' reconnect pending blocks duplicate and never sends resume',await evaluate("fixtureReconnectRequests.length===1&&fixtureReconnectRequests[0].action==='reconnect'&&fixtureResumeRequests.length===0&&fixtureReconnectButton().disabled&&fixtureResumeButton().disabled&&fixtureResumeSnapshot().reconnecting"));
  await screenshot(theme+'-reconnect-pending');
  await evaluate('fixtureCompleteReconnect(false)');
  await wait('!!fixtureReconnectButton()&&!fixtureReconnectButton().disabled');
  check(theme+' failed management reconnect permits retry with error',await evaluate("fixtureResumeButton().disabled&&document.querySelector('[data-azrael-root-resume] [role=alert]').textContent.includes('재접속에 실패')&&fixtureResumeRequests.length===0"));
  await send('Emulation.setDeviceMetricsOverride',{width:360,height:740,deviceScaleFactor:1,mobile:false});
  await screenshot(theme+'-reconnect-narrow-failed');
  check(theme+' narrow disconnected reconnect has no overflow',await evaluate("(()=>{const e=document.querySelector('[data-azrael-root-resume]'),r=e.getBoundingClientRect();return document.documentElement.scrollWidth<=360&&r.left>=0&&r.right<=360&&[...e.querySelectorAll('button,img,[role=alert]')].every(n=>{const b=n.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right+1})})()"));
  await evaluate('fixtureReconnectButton().focus()');await send('Page.bringToFront');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait('fixtureReconnectRequests.length===2');
  check(theme+' keyboard reconnect retry leaves resume unsent',await evaluate('fixtureResumeRequests.length===0&&fixtureReconnectButton().disabled&&fixtureResumeButton().disabled'));
  await screenshot(theme+'-reconnect-narrow-pending');
  await evaluate('fixtureCompleteReconnect(true)');
  await wait('!fixtureReconnectButton()&&!!fixtureResumeButton()&&!fixtureResumeButton().disabled');
  check(theme+' successful reconnect clears error and enables latest reservation',await evaluate("!document.querySelector('[data-azrael-root-resume] [role=alert]')&&fixtureResumeSnapshot().reservations[0].revision===4&&fixtureResumeRequests.length===0&&document.documentElement.scrollWidth<=360"));
  await screenshot(theme+'-reconnect-narrow-success');
  await evaluate('fixtureResumeButton().click()');await wait('fixtureResumeRequests.length===1');
  check(theme+' resume after reconnect uses refreshed reservation revision',await evaluate("fixtureResumeRequests[0].reservationId==='r1'&&fixtureResumeRequests[0].revision===4"));
  await evaluate('fixtureCompleteManualResume();fixtureConnection=null');
  await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});
 }
 }
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixtureNow=20000;fixtureReset();fixtureDefer();fixtureBranchEnabled=true;fixtureRerender()`);
  await wait("!!document.querySelector('.azrael-resume-branch')");
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5});
  check(theme+' branch hidden until hover or focus',await evaluate("getComputedStyle(document.querySelector('.azrael-resume-branch')).opacity==='0'"));
  const row=await evaluate("(()=>{const r=document.querySelector('[data-azrael-resume-row]').getBoundingClientRect();return {x:r.left+5,y:r.top+r.height/2}})()");
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...row});
  check(theme+' branch appears on real row hover',await evaluate("getComputedStyle(document.querySelector('.azrael-resume-branch')).opacity==='1'"));
  await screenshot(theme+'-branch-hover');
  const button=await evaluate("(()=>{const r=document.querySelector('.azrael-resume-branch').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()");
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...button,button:'left',clickCount:1});
  check(theme+' click selects previous canonical turn',await evaluate("fixtureBranchCalls.at(-1)==='old'&&fixtureState.old.status==='deferred'"));
  await evaluate('fixtureResume()');
  await wait("!!document.querySelector('[data-fixture-new]')");
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5});
  await evaluate('document.body.tabIndex=-1;document.body.focus()');
  // The branch is the first focusable control: reach it through real Tab input.
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  check(theme+' keyboard focus reveals branch',await evaluate("document.activeElement.matches('.azrael-resume-branch')&&getComputedStyle(document.activeElement).opacity==='1'"));
  await screenshot(theme+'-branch-focus');
  for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  check(theme+' Enter branches old turn while new work continues',await evaluate("fixtureBranchCalls.at(-1)==='old'&&fixtureState.current.turnId==='new'&&fixtureState.current.status==='inProgress'&&allTurns().length===2"));
  await send('Emulation.setDeviceMetricsOverride',{width:360,height:950,deviceScaleFactor:1,mobile:false});
  check(theme+' narrow branch stays within viewport',await evaluate("(()=>{const r=document.querySelector('.azrael-resume-branch').getBoundingClientRect();return document.documentElement.scrollWidth<=360&&r.left>=0&&r.right<=360&&r.height>=22})()"));
  await screenshot(theme+'-branch-narrow');
  await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});
  await evaluate('fixtureBranchEnabled=false;fixtureRerender()');
  await wait("!document.querySelector('.azrael-resume-branch')");
  check(theme+' unavailable native callback hides branch',await evaluate("!document.querySelector('.azrael-resume-branch')"));
 }
 await evaluate('reactRoot.unmount()');
 }
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);summary.outcome='passed';await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 management?.view.dispose();
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
  summary.browserExit=await confirmOwnedBrowserExit(chrome,profile);
  artifactRun.producerStopped=summary.browserExit.confirmed;
  summary.runRoot=artifactRun.runRoot;summary.lifecycleId=artifactRun.lifecycleId;
  summary.fixtureRemoved=false;summary.retentionReason='Retained fixture, profile and raw results for lifecycle review';
  if(!summary.browserExit.confirmed)process.exitCode=1;
  summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({runRoot:artifactRun.runRoot,lifecycleId:artifactRun.lifecycleId,outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
