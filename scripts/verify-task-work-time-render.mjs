import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const containedPath=(value,parent,label)=>{const target=resolve(root,value),allowed=resolve(root,parent)+sep;assert.ok(target.toLowerCase().startsWith(allowed.toLowerCase()),label+' must be a descendant of '+parent);return target};
const fixture=containedPath(process.env.AZRAEL_RENDER_FIXTURE_ROOT||'artifacts/verification/task-work-time','artifacts/verification','Renderer fixture');
const logs=containedPath(process.env.AZRAEL_RENDER_LOG_ROOT||'artifacts/logs/task-work-time/ui','artifacts/logs','Renderer logs'),profile=join(fixture,'chrome-profile');
const assets=join(root,'artifacts/upstream-ui/26.1007.21434/webview/assets');
const require=createRequire(import.meta.url),ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const {HELPER,ROW_ASSET,injectTaskWorkTime}=require('./inject-task-work-time.cjs');
const nativeControl=process.env.AZRAEL_TASK_TIME_NATIVE_CONTROL==='1';
const moduleSource=`
import {nLt as O,$At as r,Clt as Scope,Hbt as Intl,fixtureInitScope,Abt as initIntl,Qct as initAtom} from './app-initial-97d3534ad35f.js';
import {ZIt as Vt,$It as initButton} from './app-initial-7a199c66e670.js';
import {fixtureInitPreferences} from './app-initial-c014f9ee4429.js';
import {t as eu,n as initVirtualList} from './virtualized-turn-list-c0fd56eabf08.js';
import {t as ScrollContext,n as initScrollContext} from './thread-scroll-controller-context-value-33f016052c42.js';
${HELPER}
window.fixtureNow=20000;Date.now=()=>fixtureNow;window.fixtureQueries=[];window.fixtureFailure=false;window.fixtureHost='local';window.fixtureChat='chat';window.fixtureLocale='ko';
window.fixtureMakeChain=(prefix,count,duration=5000)=>Array.from({length:count},(_,i)=>({turnId:prefix+i,rootTurnId:prefix+'0',parentTurnId:i?prefix+(i-1):null,turnTrigger:i?'root_resume':'user',turnStartedAtMs:i*200000,durationMs:duration,status:'completed',rootResumeWait:i<3?{reservationId:prefix+'wait'+i,revision:1,state:'resumed',waitStartedAtMs:i*200000+duration,waitEndedAtMs:i*200000+duration}:null}));
window.fixtureTurns=fixtureMakeChain('a',${nativeControl?176:6});window.fixtureVisible=null;window.fixtureHistory=null;
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
function MessageRow({entry}){if(${nativeControl}&&entry.turnId==='a0')return jsx.jsxs(jsx.Fragment,{children:[jsx.jsx('details',{'data-native-control':true,children:jsx.jsxs(jsx.Fragment,{children:[jsx.jsx('summary',{children:'Native control disclosure'}),jsx.jsx('ol',{children:Array.from({length:176},(_,i)=>jsx.jsx('li',{style:{height:32},children:'Turn '+i},i))})]})}),jsx.jsx('article',{'data-fixture-message':entry.turnKey,style:{height:120,padding:16},children:entry.text})]});return jsx.jsx('article',{'data-fixture-message':entry.turnKey,style:{height:120,padding:16},children:entry.text})}
function Rows(){const[,update]=React.useState(0);window.fixtureRerender=()=>update(n=>n+1);const entries=(fixtureVisible??fixtureTurns).map(t=>({turnKey:'message-'+t.turnId,turnId:t.turnId,estimatedHeightPx:120,text:'메시지 '+t.turnId}));return jsx.jsx(Intl,{value:{locale:fixtureLocale,formatMessage:({defaultMessage})=>defaultMessage},children:jsx.jsx(ScrollContext.Provider,{value:controller,children:jsx.jsx('div',{id:'virtual-scroll',onScroll:publishScroll,style:{height:650,overflow:'auto',overflowAnchor:'none'},children:jsx.jsx('div',{style:{display:'flex',flexDirection:'column'},children:jsx.jsx(${nativeControl?'eu':'azraelTaskTimeVirtualList'},{entries,RowComponent:MessageRow,preserveMeasuredTurnViewport:true,azraelTaskTime:{manager,hostId:fixtureHost,conversationId:fixtureChat,liveTurns:fixtureTurns}})})})})})}
let initialized=false;
function Fixture(){initVirtualList();initScrollContext();initButton();initIntl();initAtom();fixtureInitScope();azraelTimeInitPreferences();if(!initialized){initialized=true;fixtureInitPreferences(JSON.parse(localStorage.getItem('prefs')||'{}'),(key,value)=>{const prefs=JSON.parse(localStorage.getItem('prefs')||'{}');prefs[key]=value;localStorage.setItem('prefs',JSON.stringify(prefs))})}return jsx.jsx(Scope,{scope:azraelTimeScope,children:jsx.jsx(Rows,{})})}
export {Fixture};`;
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto max-w-3xl p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];window.fixtureROCalls=[];window.fixturePhase='startup';const NativeResizeObserver=ResizeObserver;window.ResizeObserver=class extends NativeResizeObserver{constructor(callback){const creation=Error('Observer creation').stack;super((entries,observer)=>{fixtureROCalls.push({phase:fixturePhase,creation,targets:entries.map(e=>({tag:e.target.tagName,key:e.target.getAttribute('data-turn-key'),height:e.contentRect.height}))});if(fixtureROCalls.length>30)fixtureROCalls.shift();callback(entries,observer)})}};addEventListener('error',e=>fixtureErrors.push({message:e.message,phase:fixturePhase,callbacks:fixtureROCalls.slice(-3)}));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {$At,XAt} from '/assets/app-initial-97d3534ad35f.js';import {Fixture} from '/assets/task-fixture.js';window.reactRoot=XAt().createRoot(document.getElementById('root'));reactRoot.render($At().jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=pathname===join(assets,'task-fixture.js')?moduleSource:await readFile(pathname);if(!nativeControl&&pathname===join(root,'artifacts/upstream-ui/26.1007.21434',ROW_ASSET))source=injectTaskWorkTime(source.toString(),ROW_ASSET).text;if(pathname===join(assets,'app-initial-97d3534ad35f.js'))source=source.toString()+'\nexport {kRt as fixtureInitScope};';if(pathname===join(assets,'app-initial-c014f9ee4429.js'))source=source.toString()+'\nexport {a3e as fixtureInitPreferences};';res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(pathname)]||'application/octet-stream');res.end(source);return}res.statusCode=404;res.end()}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let socket,session,id=0,chrome;
const pinnedRows=await readFile(join(root,'artifacts/upstream-ui/26.1007.21434',ROW_ASSET),'utf8'),hash=value=>createHash('sha256').update(value).digest('hex');
const summary={scope:'Verbatim production panel with native React/preferences/buttons/CSS/virtual list and synthetic metadata host and scroll controller, Windows Chrome.',nativeControl,startedAtUtc:new Date().toISOString(),inputs:{helperSha256:hash(HELPER),pinnedRowsSha256:hash(pinnedRows),renderedRowsSha256:hash(nativeControl?pinnedRows:injectTaskWorkTime(pinnedRows,ROW_ASSET).text)},checks:[]},pending=new Map(),exceptions=[];
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
 if(nativeControl){
 await wait("window.fixtureReady&&document.querySelector('[data-native-control]')");
 for(const theme of ['light','dark']){
 await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme));
 await evaluate("document.querySelector('[data-native-control]').open=true");await wait("document.querySelector('[data-turn-key=message-a0]').parentElement.getBoundingClientRect().height>5000");
 await evaluate("document.querySelector('[data-native-control]').open=false");await wait("document.querySelector('[data-turn-key=message-a0]').parentElement.getBoundingClientRect().height<200");
 for(let n=0;n<8;n++){await evaluate('fixtureScrollTo(true)');await wait("document.querySelector('[data-fixture-message=message-a175]')");await evaluate('fixtureScrollTo(false)');await wait("document.querySelector('[data-native-control]')")}
 check(theme+' native undecorated expansion and fast scrolling',true);
 }
 }else{
 await wait("window.fixtureReady && document.querySelector('summary')?.innerText.includes('30초') && !document.querySelector('[role=status]')");
 const click=selector=>evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
 const text=()=>evaluate('document.body.innerText');
 const key=async()=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32})};
 const colors=[];
 for(const theme of ['light','dark']){
 await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme)+';document.body.dataset.vscodeThemeKind='+JSON.stringify('vscode-'+theme));
 check(theme+' no card outline',await evaluate("(()=>{const s=getComputedStyle(document.querySelector('section'));return s.borderLeftWidth==='0px'&&s.borderRightWidth==='0px'&&s.borderRadius==='0px'})()"));
 check(theme+' native double rule',await evaluate("(()=>{const s=getComputedStyle(document.querySelector('[data-azrael-task-rule=start]'));return s.borderTopWidth==='1px'&&s.borderBottomWidth==='1px'&&parseFloat(s.height)===4})()"));
 check(theme+' excludes user idle',(await text()).includes('총 30초'));
 colors.push(await evaluate("(()=>{const s=getComputedStyle(document.querySelector('section'));const line=getComputedStyle(document.querySelector('[data-azrael-task-rule=start]'));return {color:s.color,border:line.borderTopColor}})()"));
 await evaluate("document.querySelector('details').open=false;document.querySelector('summary').focus()");await key();await wait("document.querySelector('details').open");
 await evaluate("document.querySelector('[data-azrael-time-boundary=a3]').focus()");await key();await wait("document.querySelectorAll('details').length===2");check(theme+' keyboard split retains fragments',true);
 await evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)");
 check(theme+' fragment totals',(await text()).includes('총 15초'));
 check(theme+' separate measured group starts',await evaluate("document.querySelectorAll('[data-azrael-task-rule=start]').length===2"));
 await writeFile(join(logs,theme+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await click('[data-azrael-time-boundary=a3]');await wait("document.querySelectorAll('details').length===1");check(theme+' explicit merge total',(await text()).includes('총 30초'));
 }
 check('native semantic theme colors',colors[0].color!==colors[1].color&&colors[0].border!==colors[1].border);summary.colors=colors;
 await send('Page.reload');await wait("window.fixtureReady && document.querySelector('summary')?.innerText.includes('30초')");check('reload explicit false merge retained',await evaluate("Object.values(JSON.parse(localStorage.getItem('prefs'))['azrael-task-work-time-boundaries']).includes(false)"));
 for(const n of [0,1,2]){
 await evaluate("fixtureChat='small-"+n+"';fixtureFailure=true;fixtureTurns=fixtureMakeChain('small',"+n+");fixtureRerender()");await new Promise(r=>setTimeout(r,150));
 check(n+' registrations have no group/rules/feature error',await evaluate("!document.querySelector('[data-azrael-task-work-time]')&&!document.querySelector('[data-azrael-task-rule]')&&!document.querySelector('[role=alert]')"));
 }
 await evaluate("fixtureFailure=false;fixtureChat='three';fixtureTurns=fixtureMakeChain('three',3);fixtureRerender()");await wait("document.querySelector('summary')?.innerText.includes('15초')&&!document.querySelector('[role=status]')");check('third committed registration enables group',true);
 await evaluate("fixtureFailure=true;fixtureTurns=fixtureTurns.map(t=>({...t,status:'failed'}));fixtureRerender()");await wait("!!document.querySelector('[role=alert]')");check('eligible failure retains partial total',(await text()).includes('일부'));
 await evaluate('fixtureFailure=false');await click('[data-azrael-time-retry]');await wait("!document.querySelector('[role=alert]')");
 await evaluate("fixtureLocale='en';fixtureRerender()");await wait("document.querySelector('summary')?.innerText.includes('Task 1')");check('English localization',true);
 await evaluate("fixtureChat='multiple';fixtureTurns=[...fixtureMakeChain('x',3),...fixtureMakeChain('y',3)];fixtureRerender()");await wait("document.querySelectorAll('details').length===2");check('independent eligible groups',true);
 await evaluate("fixtureHistory=fixtureTurns;fixtureVisible=fixtureTurns.slice(1);fixtureRerender()");await wait("!document.querySelector('[data-azrael-rule-group=x0][data-azrael-task-rule=start]')");
 check('partial history never substitutes unrelated first row',await evaluate("document.querySelector('[data-azrael-rule-group=y0][data-azrael-task-rule=start]')!==null"));
 await evaluate("fixtureVisible=null;fixtureHistory=null;fixtureRerender()");await wait("document.querySelectorAll('[data-azrael-task-rule=start]').length===2");

 await evaluate("fixtureChat='live';fixtureNow=406000;fixtureTurns=fixtureMakeChain('live',3);fixtureTurns[2]={...fixtureTurns[2],status:'deferred',rootResumeWait:{...fixtureTurns[2].rootResumeWait,state:'waiting',revision:2,waitEndedAtMs:null}};fixtureRerender()");await wait("document.querySelector('summary')?.innerText.includes('16s')&&!document.querySelector('[role=status]')");
 const clockQueries=await evaluate('fixtureQueries.length');await evaluate('fixtureNow=409000');await new Promise(r=>setTimeout(r,1100));check('recorded automatic wait ticks',(await text()).includes('19s'));check('clock does not query metadata',await evaluate('fixtureQueries.length')===clockQueries);
 await evaluate("fixtureHistory=fixtureTurns.map(t=>({...t,status:'completed',rootResumeWait:t.rootResumeWait?{...t.rootResumeWait,state:'resumed',revision:3,waitEndedAtMs:t.turnId==='live2'?409000:t.rootResumeWait.waitEndedAtMs}:null}));fixtureTurns=fixtureHistory;fixtureRerender()");await wait("!document.querySelector('[role=status]')");const frozen=await text();await evaluate("fixtureTurns=fixtureTurns.map(t=>({...t,status:'inProgress',rootResumeWait:t.rootResumeWait?{...t.rootResumeWait,state:'waiting',revision:1,waitEndedAtMs:null}:null}));fixtureNow=600000;fixtureRerender()");await wait("!document.querySelector('[role=status]')");await new Promise(r=>setTimeout(r,1100));check('stale live updates preserve terminal total',(await text())===frozen);
 await evaluate("fixtureHistory=null;fixtureRerender()");
 for(const theme of ['light','dark']){
 await evaluate("document.documentElement.dataset.theme="+JSON.stringify(theme)+";fixtureChat='scroll';fixtureLocale='ko';fixtureTurns=fixtureMakeChain('turn-',176,60000);fixtureRerender()");
 await evaluate("fixtureScrollTo(false)");
 await wait("document.querySelector('#virtual-scroll summary')?.innerText.includes('176개 턴')&&!document.querySelector('[role=status]')");
 check(theme+' summary measured native row',await evaluate("!!document.querySelector('[data-turn-key^=azrael-task-work-time] section')"));
 await evaluate("document.querySelector('details').open=true");await wait("document.querySelector('[data-turn-key^=azrael-task-work-time]').parentElement.getBoundingClientRect().height>5000");
 await evaluate("document.querySelector('details').open=false");await wait("document.querySelector('[data-turn-key^=azrael-task-work-time]').parentElement.getBoundingClientRect().height<200");
 await evaluate("new Promise(resolve=>{let n=0;const step=()=>{document.querySelector('details').open=(n++%2)===0;if(n<12)requestAnimationFrame(step);else requestAnimationFrame(resolve)};step()})");await wait("document.querySelector('[data-turn-key^=azrael-task-work-time]').parentElement.getBoundingClientRect().height<200");check(theme+' rapid disclosure resizes remain measured',true);
 const scrollQueries=await evaluate('fixtureQueries.length');
 for(let n=0;n<8;n++){
 await evaluate("fixtureScrollTo(true)");await wait("!!document.querySelector('[data-fixture-message=message-turn-175]')");
 await wait("(()=>{const line=document.querySelector('[data-azrael-task-rule=end]')?.getBoundingClientRect(),view=document.getElementById('virtual-scroll').getBoundingClientRect();return line&&line.top>=view.top&&line.bottom<=view.bottom})()");
 check(theme+' group end after actual last row '+n,await evaluate("document.querySelector('[data-azrael-task-rule=end]').getBoundingClientRect().top>=document.querySelector('[data-fixture-message=message-turn-175]').getBoundingClientRect().bottom"));
 check(theme+' start unmounted at latest rows '+n,await evaluate("!document.querySelector('[data-azrael-task-work-time]')"));
 await evaluate("fixtureScrollTo(false)");await wait("!!document.querySelector('[data-fixture-message=message-turn-0]')&&!!document.querySelector('[data-azrael-task-work-time]')");
 }
 await evaluate("document.querySelector('details').open=true");await wait("document.querySelector('details').open");await evaluate("fixtureScrollTo(true)");await wait("!document.querySelector('details')");await evaluate("fixtureScrollTo(false)");await wait("document.querySelector('details')?.open");check(theme+' disclosure survives virtual unmount',true);await evaluate("document.querySelector('details').open=false");
 check(theme+' scroll never reloads metadata',await evaluate('fixtureQueries.length')===scrollQueries);
 check(theme+' first message follows summary',await evaluate("document.querySelector('[data-fixture-message=message-turn-0]').getBoundingClientRect().top>=document.querySelector('section').getBoundingClientRect().bottom"));
 await writeFile(join(logs,'scroll-'+theme+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 }
 summary.browserErrors=await evaluate('fixtureErrors');check('no browser exceptions '+JSON.stringify(summary.browserErrors),exceptions.length===0&&summary.browserErrors.length===0);
 summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
 if(chrome?.exitCode===null&&chrome?.signalCode===null)await new Promise(r=>{const t=setTimeout(r,10000);chrome.once('exit',()=>{clearTimeout(t);r()})});
 summary.browserExitCode=chrome?.exitCode;summary.browserSignalCode=chrome?.signalCode;
 const allowed=join(root,'artifacts/verification')+sep;
 if(chrome&&(chrome.exitCode!==null||chrome.signalCode!==null)&&fixture.toLowerCase().startsWith(allowed.toLowerCase())){const cleanupScript=String.raw`try {
$ErrorActionPreference='Stop'
$taskRoot = [IO.Path]::GetFullPath($env:AZRAEL_TASK_TIME_FIXTURE)
$expectedParent = [IO.Path]::GetFullPath((Join-Path (Get-Location) 'artifacts/verification'))
if (-not $taskRoot.StartsWith($expectedParent+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected cleanup target' }
$preview = & ./scripts/clean-verification-artifacts.ps1 -FixtureRoot $taskRoot -IncludeDiagnosedFixtures -ReportPath $env:AZRAEL_TASK_TIME_CLEANUP_REPORT
if ($preview.status -ne 'preview' -or $preview.candidates.Count -ne 1 -or $preview.candidates[0].status -ne 'selected') { throw ('Cleanup guarded preview refused: '+($preview|ConvertTo-Json -Depth 8 -Compress)) }
# Use native removal after the project guard; its Apply archives evidence into
# a different owner's log directory, while this task must retain only its own logs.
$live = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { ($_.CommandLine -and $_.CommandLine.Replace('/','\').Contains($taskRoot)) -or ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskRoot,[StringComparison]::OrdinalIgnoreCase)) })
if ($live.Count) { throw 'Cleanup path still referenced by a live process' }
Remove-Item -LiteralPath $taskRoot -Recurse -ErrorAction Stop
if (Test-Path -LiteralPath $taskRoot) { throw 'Fixture survived cleanup' }
Write-Output 'Guarded preview selected owned fixture; native PowerShell removal confirmed absent.'
} catch { [Console]::Error.WriteLine($_); exit 1 }

`;
 const cleanup=spawn('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command','-'],{cwd:root,windowsHide:true,env:{...process.env,AZRAEL_TASK_TIME_FIXTURE:fixture,AZRAEL_TASK_TIME_CLEANUP_REPORT:join(logs,'cleanup-preview.json')},stdio:['pipe','pipe','pipe']});let output='';cleanup.stdout.on('data',b=>output+=b);cleanup.stderr.on('data',b=>output+=b);cleanup.stdin.end(cleanupScript);summary.cleanupExitCode=await new Promise((r,j)=>{cleanup.on('error',j);cleanup.on('exit',r)});await writeFile(join(logs,'cleanup.txt'),output);summary.cleanup=summary.cleanupExitCode===0?'Owned browser exited; project guarded preview passed; native PowerShell fixture/profile removal confirmed absent':'Cleanup failed; see cleanup.txt';if(summary.cleanupExitCode!==0)process.exitCode=1}else{summary.cleanup='Browser exit uncertain; profile retained until confirmed closed';process.exitCode=1}
 summary.completedAtUtc=new Date().toISOString();summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
