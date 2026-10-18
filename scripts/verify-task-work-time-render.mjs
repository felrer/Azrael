import artifactRunTools from './artifact-run.cjs';
const {beginArtifactRun,trackArtifactChild}=artifactRunTools;
import {createRequire} from 'node:module';
import {spawn as nativeSpawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const artifactRun=beginArtifactRun(root,{workId:'verify-task-work-time-render',owner:'scripts/verify-task-work-time-render.mjs',paths:{...(process.env.AZRAEL_RENDER_FIXTURE_ROOT ? {temporary:resolve(root,process.env.AZRAEL_RENDER_FIXTURE_ROOT)} : {}),...(process.env.AZRAEL_RENDER_LOG_ROOT ? {logs:resolve(root,process.env.AZRAEL_RENDER_LOG_ROOT)} : {})}});
const spawn=(...args)=>trackArtifactChild(artifactRun,nativeSpawn(...args));
const confirmOwnedBrowserExit=(child,profilePath)=>artifactRunTools.confirmOwnedBrowserExit(child,profilePath,spawn);
const containedPath=(value,parent,label)=>{const target=resolve(root,value),allowed=resolve(root,parent)+sep;assert.ok(target.toLowerCase().startsWith(allowed.toLowerCase()),label+' must be a descendant of '+parent);return target};
const fixture=artifactRun.temporary;
const logs=artifactRun.logs,profile=join(fixture,'chrome-profile');
const assets=join(root,'artifacts/upstream-ui/26.1007.21434/webview/assets');
const require=createRequire(import.meta.url),ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const {HELPER,MESSAGE_HELPER}=require('./inject-task-work-time.cjs');
const ROW_ASSET='webview/assets/virtualized-turn-list-c0fd56eabf08.js';
const fixtureHelper=HELPER.replace('import {azraelTaskTimeMessageContext} from "./local-conversation-turn-9fb266d5c020.js";','');
const moduleSource=`
import {nLt as O,$At as r,Clt as Scope,Hbt as Intl,fixtureInitScope,Abt as initIntl,Qct as initAtom} from './app-initial-97d3534ad35f.js';
import {ZIt as Vt,$It as initButton} from './app-initial-7a199c66e670.js';
import {fixtureInitPreferences,W9t as fixtureScope,P3t as fixtureInitPreferenceAtoms} from './app-initial-c014f9ee4429.js';
import {t as eu,n as initVirtualList} from './virtualized-turn-list-c0fd56eabf08.js';
import {t as ScrollContext,n as initScrollContext} from './thread-scroll-controller-context-value-33f016052c42.js';
${fixtureHelper}
const T=O,n=r;
${MESSAGE_HELPER.replace("export {azraelTaskTimeMessageContext,azraelTaskTimeMessageSummary};","")}
window.fixtureNow=20000;Date.now=()=>fixtureNow;window.fixtureQueries=[];window.fixtureFailure=false;window.fixtureHost='local';window.fixtureChat='chat';window.fixtureLocale='ko';
window.fixtureMakeChain=(prefix,count,duration=5000)=>Array.from({length:count},(_,i)=>({turnId:prefix+i,rootTurnId:prefix+'0',parentTurnId:i?prefix+(i-1):null,turnTrigger:i?'root_resume':'user',turnStartedAtMs:i*200000,durationMs:duration,status:'completed',rootResumeWait:i<3?{reservationId:prefix+'wait'+i,revision:1,state:'resumed',waitStartedAtMs:i*200000+duration,waitEndedAtMs:i*200000+duration}:null}));
window.fixtureTurns=fixtureMakeChain('a',6);window.fixtureVisible=null;window.fixtureHistory=null;
const manager={listThreadTurns:async(id,options)=>{fixtureQueries.push({id,options});if(fixtureFailure)throw Error('fixture failure');return {response:{data:(fixtureHistory??fixtureTurns).map(t=>({...t,id:t.turnId,startedAt:t.turnStartedAtMs/1000})),nextCursor:null}}}};
const React=O(),jsx=r();
window.fixtureVirtual=false;
const scrollElement=()=>document.getElementById('virtual-scroll');
const distance=()=>{const el=scrollElement();return el?el.scrollHeight-el.clientHeight-el.scrollTop:100000};
let lastDistance=100000;
const scrollListeners=new Set(),userListeners=new Set();
const listen=(set,fn)=>(set.add(fn),()=>set.delete(fn));
const publishScroll=()=>{lastDistance=distance();for(const fn of scrollListeners)fn(lastDistance)};
window.fixtureScrollTo=async bottom=>{for(let frame=0;frame<6;frame++){const el=scrollElement();el.scrollTop=bottom?el.scrollHeight:0;lastDistance=distance();for(const fn of userListeners)fn(lastDistance);for(const fn of scrollListeners)fn(lastDistance);await new Promise(resolve=>setTimeout(resolve,16))}};
const controller={getScrollElement:scrollElement,getLastScrollDistanceFromBottomPx:()=>lastDistance,getUnroundedScrollDistanceFromBottomPx:x=>x,shouldFollowContentGrowth:()=>false,addScrollListener:fn=>{const dispose=listen(scrollListeners,fn);fn(lastDistance);return dispose},addUserScrollListener:fn=>listen(userListeners,fn),compensateScrollToDistanceFromBottomPx:x=>{const el=scrollElement();el.scrollTop=el.scrollHeight-el.clientHeight-x;publishScroll()},scrollToDistanceFromBottomPx:x=>controller.compensateScrollToDistanceFromBottomPx(x)};
function MessageRow({entry}){return jsx.jsxs('article',{'data-fixture-message':entry.turnKey,style:{minHeight:120,padding:16},children:[jsx.jsx('div',{'data-fixture-user':entry.turnId,children:entry.text}),jsx.jsx(azraelTaskTimeMessageSummary,{}),jsx.jsx('div',{'data-fixture-assistant':entry.turnId,children:'Assistant / tool '+entry.turnId})]})}
function Rows(){const[,update]=React.useState(0);window.fixtureRerender=()=>update(n=>n+1);const entries=(fixtureVisible??fixtureTurns).map(t=>({turnKey:'message-'+t.turnId,turnId:t.turnId,estimatedHeightPx:120,text:'메시지 '+t.turnId}));return jsx.jsx(Intl,{value:{locale:fixtureLocale,formatMessage:({defaultMessage})=>defaultMessage},children:jsx.jsx(ScrollContext.Provider,{value:controller,children:jsx.jsx('div',{id:'virtual-scroll',onScroll:publishScroll,style:{height:650,overflow:'auto',overflowAnchor:'none'},children:jsx.jsx('div',{style:{display:'flex',flexDirection:'column'},children:jsx.jsx(azraelTaskTimeVirtualList,{entries,RowComponent:MessageRow,preserveMeasuredTurnViewport:true,azraelTaskTime:{manager,hostId:fixtureHost,conversationId:fixtureChat,liveTurns:fixtureTurns}})})})})})}
let initialized=false;
function Fixture(){initVirtualList();initScrollContext();initButton();initIntl();initAtom();fixtureInitScope();fixtureInitPreferenceAtoms();if(!initialized){initialized=true;fixtureInitPreferences(JSON.parse(localStorage.getItem('prefs')||'{}'),(key,value)=>{const prefs=JSON.parse(localStorage.getItem('prefs')||'{}');prefs[key]=value;localStorage.setItem('prefs',JSON.stringify(prefs))})}return jsx.jsx(Scope,{scope:fixtureScope,children:jsx.jsx(Rows,{})})}
export {Fixture};`;
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto max-w-3xl p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];window.fixtureROCalls=[];window.fixturePhase='startup';const NativeResizeObserver=ResizeObserver;window.ResizeObserver=class extends NativeResizeObserver{constructor(callback){const creation=Error('Observer creation').stack;super((entries,observer)=>{fixtureROCalls.push({phase:fixturePhase,creation,targets:entries.map(e=>({tag:e.target.tagName,key:e.target.getAttribute('data-turn-key'),height:e.contentRect.height}))});if(fixtureROCalls.length>30)fixtureROCalls.shift();callback(entries,observer)})}};addEventListener('error',e=>fixtureErrors.push({message:e.message,phase:fixturePhase,callbacks:fixtureROCalls.slice(-3)}));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {$At,XAt} from '/assets/app-initial-97d3534ad35f.js';import {Fixture} from '/assets/task-fixture.js';window.reactRoot=XAt().createRoot(document.getElementById('root'));reactRoot.render($At().jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=pathname===join(assets,'task-fixture.js')?moduleSource:await readFile(pathname);if(pathname===join(assets,'app-initial-97d3534ad35f.js'))source=source.toString()+'\nexport {kRt as fixtureInitScope};';if(pathname===join(assets,'app-initial-c014f9ee4429.js'))source=source.toString()+'\nexport {a3e as fixtureInitPreferences};';res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(pathname)]||'application/octet-stream');res.end(source);return}res.statusCode=404;res.end()}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let socket,session,id=0,chrome;
const pinnedRows=await readFile(join(root,'artifacts/upstream-ui/26.1007.21434',ROW_ASSET),'utf8'),hash=value=>createHash('sha256').update(value).digest('hex');
const summary={scope:'Verbatim production wrapper/message helper with native React/CSS/pristine virtual list and synthetic metadata host and scroll controller, Windows Chrome.',startedAtUtc:new Date().toISOString(),inputs:{helperSha256:hash(HELPER),pinnedRowsSha256:hash(pinnedRows),renderedRowsSha256:hash(pinnedRows),messageHelperSha256:hash(MESSAGE_HELPER)},checks:[]},pending=new Map(),exceptions=[];
try{
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((r,j)=>{let s='';const t=setTimeout(()=>j(Error('Chrome startup timeout')),20000);chrome.stderr.on('data',c=>{s+=c;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);r(m[1])}});chrome.on('error',j)});
 socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')exceptions.push(m.params.args);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.j(Error(JSON.stringify(m.error))):p.r(m.result)}}});
 const send=(method,params={},sid=session)=>new Promise((r,j)=>{const n=++id,t=setTimeout(()=>j(Error('CDP timeout '+method)),20000);pending.set(n,{r,j,t});socket.send(JSON.stringify({id:n,method,params,...(sid?{sessionId:sid}:{})}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression:'window.fixturePhase='+JSON.stringify(expression.slice(0,180))+';'+expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const wait=async expression=>{for(let n=0;n<60;n++){if(await evaluate("Boolean("+expression+")"))return;await new Promise(r=>setTimeout(r,50))}throw Error('Wait failed: '+expression+'; '+JSON.stringify(await evaluate('({errors:fixtureErrors,body:document.body.innerText,scroll:document.getElementById("virtual-scroll")?{top:document.getElementById("virtual-scroll").scrollTop,height:document.getElementById("virtual-scroll").scrollHeight,content:document.getElementById("virtual-scroll").firstElementChild?.getBoundingClientRect().height}:null})')))};
 const check=(name,value)=>{assert.ok(value,name);summary.checks.push(name)};
 session=(await send('Target.attachToTarget',{targetId:(await send('Target.createTarget',{url:'about:blank'},null)).targetId,flatten:true},null)).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 await wait("window.fixtureReady && document.querySelector('[data-azrael-task-work-time]')?.innerText.includes('30초')");
 const selector='[data-azrael-task-work-time]';
 const colors=[];
 for(const theme of ['light','dark']){
  await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme)+';document.body.dataset.vscodeThemeKind='+JSON.stringify('vscode-'+theme));
  check(theme+' first user / summary / assistant order',await evaluate(`(()=>{const line=document.querySelector('${selector}'),row=line.closest('article'),user=row.querySelector('[data-fixture-user]'),assistant=row.querySelector('[data-fixture-assistant]');return line.previousElementSibling===user&&line.nextElementSibling===assistant&&line.getBoundingClientRect().top>=user.getBoundingClientRect().bottom})()`));
  check(theme+' exactly one plain summary line',await evaluate(`document.querySelectorAll('${selector}').length===1&&!document.querySelector('details,summary,table,button,[data-azrael-task-rule],[data-azrael-time-turn],[data-azrael-time-boundary]')`));
  colors.push(await evaluate(`getComputedStyle(document.querySelector('${selector}')).color`));
  await writeFile(join(logs,theme+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 check('native semantic theme text colors',colors[0]!==colors[1]);summary.colors=colors;
 for(const n of [0,1,2,3]){
  await evaluate("fixtureChat='threshold-"+n+"';fixtureTurns=fixtureMakeChain('threshold',"+n+");fixtureRerender()");
  await new Promise(r=>setTimeout(r,180));
  check(n+' committed reservations eligibility',await evaluate(`document.querySelectorAll('${selector}').length===${n>=3?1:0}`));
 }
 await evaluate("fixtureChat='multiple';fixtureTurns=[...fixtureMakeChain('x',3),...fixtureMakeChain('y',3)];fixtureRerender()");await wait(`document.querySelectorAll('${selector}').length===2`);check('independent eligible groups',true);
 await evaluate('fixtureHistory=fixtureTurns;fixtureVisible=fixtureTurns.slice(1);fixtureRerender()');await wait(`document.querySelectorAll('${selector}').length===1`);check('partial loaded entries never substitute first user',await evaluate(`document.querySelector('${selector}').closest('article').dataset.fixtureMessage==='message-y0'`));
 await evaluate("fixtureVisible=null;fixtureHistory=null;fixtureChat='live';fixtureLocale='en';fixtureNow=406000;fixtureTurns=fixtureMakeChain('live',3);fixtureTurns[2]={...fixtureTurns[2],status:'deferred',rootResumeWait:{...fixtureTurns[2].rootResumeWait,state:'waiting',revision:2,waitEndedAtMs:null}};fixtureRerender()");await wait(`document.querySelector('${selector}')?.innerText.includes('16s')`);
 const clockQueries=await evaluate('fixtureQueries.length');await evaluate('fixtureNow=409000');await new Promise(r=>setTimeout(r,1100));check('live automatic waiting time ticks',await evaluate(`document.querySelector('${selector}').innerText.includes('19s')`));check('clock ticks never query metadata',await evaluate('fixtureQueries.length')===clockQueries);
 await evaluate("fixtureTurns=fixtureTurns.map(t=>({...t,status:'completed',rootResumeWait:{...t.rootResumeWait,state:'resumed',revision:3,waitEndedAtMs:t.turnId==='live2'?409000:t.rootResumeWait.waitEndedAtMs}}));fixtureRerender()");await wait(`document.querySelector('${selector}')?.innerText.includes('19s')`);const frozen=await evaluate(`document.querySelector('${selector}').innerText`);
 await evaluate('fixtureNow=600000');await new Promise(r=>setTimeout(r,1100));check('completed live chain freezes total',await evaluate(`document.querySelector('${selector}').innerText`)===frozen);
 await evaluate("fixtureChat='failed-history';fixtureFailure=true;fixtureTurns=fixtureMakeChain('failed',3);fixtureRerender()");await wait(`document.querySelector('${selector}')?.title.includes('unavailable')`);check('history failure retains a plain partial line',await evaluate(`document.querySelector('${selector}').innerText.includes('Known 15s')&&!document.querySelector('button,details,table,[role=alert],[role=status]')`));await evaluate('fixtureFailure=false');
 for(const count of [29,176,1000])for(const theme of ['light','dark']){
  await evaluate("document.documentElement.dataset.theme="+JSON.stringify(theme)+";fixtureChat='scroll-"+count+"';fixtureLocale='ko';fixtureTurns=fixtureMakeChain('turn-',"+count+",60000);fixtureRerender()");await evaluate('fixtureScrollTo(false)');await wait(`document.querySelector('${selector}')?.innerText.includes('${count}개 턴')`);
  const queries=await evaluate('fixtureQueries.length');
  for(let i=0;i<8;i++){
   await evaluate('fixtureScrollTo(true)');await wait(`document.querySelector('[data-fixture-message=message-turn-${count-1}]')`);check(theme+' '+count+' summary unmount '+i,await evaluate(`!document.querySelector('${selector}')`));
   await evaluate('fixtureScrollTo(false)');await wait(`document.querySelector('${selector}')`);
  }
  check(theme+' '+count+' remount retains one first-user summary',await evaluate(`document.querySelectorAll('${selector}').length===1&&document.querySelector('${selector}').previousElementSibling.dataset.fixtureUser==='turn-0'`));
  check(theme+' '+count+' scrolling never reloads metadata',await evaluate('fixtureQueries.length')===queries);
  check(theme+' '+count+' finite nonoverlapping native rows',await evaluate(`(()=>{const rows=[...document.querySelectorAll('[data-turn-key]')].map(e=>e.getBoundingClientRect()).filter(b=>b.height>0).sort((a,b)=>a.top-b.top);return rows.every((b,i)=>Number.isFinite(b.height)&&(!i||b.top>=rows[i-1].bottom-1))})()`));
  await writeFile(join(logs,'scroll-'+count+'-'+theme+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 summary.browserErrors=await evaluate('fixtureErrors');check('no browser exceptions '+JSON.stringify(summary.browserErrors),exceptions.length===0&&summary.browserErrors.length===0);
 summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
  summary.browserExit=await confirmOwnedBrowserExit(chrome,profile);
  artifactRun.producerStopped=summary.browserExit.confirmed;
  summary.runRoot=artifactRun.runRoot;summary.lifecycleId=artifactRun.lifecycleId;
  summary.fixtureRemoved=false;summary.retentionReason='Retained fixture, profile and raw results for lifecycle review';
  if(!summary.browserExit.confirmed)process.exitCode=1;
  summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({runRoot:artifactRun.runRoot,lifecycleId:artifactRun.lifecycleId,outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
