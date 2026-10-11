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
const {HELPER}=require('./inject-task-work-time.cjs');
const moduleSource=`
import {nLt as O,$At as r,Clt as Scope,Hbt as Intl,fixtureInitScope,Abt as initIntl,Qct as initAtom} from './app-initial-97d3534ad35f.js';
import {ZIt as Vt,$It as initButton} from './app-initial-7a199c66e670.js';
import {fixtureInitPreferences} from './app-initial-c014f9ee4429.js';
${HELPER}
window.fixtureNow=20000;Date.now=()=>fixtureNow;window.fixtureQueries=[];window.fixtureFailure=false;window.fixtureHost='local';window.fixtureChat='chat';window.fixtureLocale='ko';
window.fixtureTurns=[{turnId:'a',turnStartedAtMs:1000,durationMs:8000,status:'completed'},{turnId:'b',turnStartedAtMs:60000,durationMs:12000,status:'completed'},{turnId:'c',turnStartedAtMs:100000,durationMs:10000,status:'completed'}];
const manager={listThreadTurns:async(id,options)=>{fixtureQueries.push({id,options});if(fixtureFailure)throw Error('fixture failure');return {response:{data:fixtureTurns.map(t=>({id:t.turnId,startedAt:t.turnStartedAtMs/1000,durationMs:t.durationMs,status:t.status,rootResumeWait:t.rootResumeWait})),nextCursor:null}}}};
const React=O(),jsx=r();
function Rows(){const[,update]=React.useState(0);window.fixtureRerender=()=>update(n=>n+1);return jsx.jsx(Intl,{value:{locale:fixtureLocale,formatMessage:({defaultMessage})=>defaultMessage},children:jsx.jsx(azraelTaskWorkTimePanel,{manager,hostId:fixtureHost,conversationId:fixtureChat,liveTurns:fixtureTurns})})}
let initialized=false;
function Fixture(){initButton();initIntl();initAtom();fixtureInitScope();azraelTimeInitPreferences();if(!initialized){initialized=true;fixtureInitPreferences(JSON.parse(localStorage.getItem('prefs')||'{}'),(key,value)=>{const prefs=JSON.parse(localStorage.getItem('prefs')||'{}');prefs[key]=value;localStorage.setItem('prefs',JSON.stringify(prefs))})}return jsx.jsx(Scope,{scope:azraelTimeScope,children:jsx.jsx(Rows,{})})}
export {Fixture};`;
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto max-w-3xl p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {$At,XAt} from '/assets/app-initial-97d3534ad35f.js';import {Fixture} from '/assets/task-fixture.js';window.reactRoot=XAt().createRoot(document.getElementById('root'));reactRoot.render($At().jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=pathname===join(assets,'task-fixture.js')?moduleSource:await readFile(pathname);if(pathname===join(assets,'app-initial-97d3534ad35f.js'))source=source.toString()+'\nexport {kRt as fixtureInitScope};';if(pathname===join(assets,'app-initial-c014f9ee4429.js'))source=source.toString()+'\nexport {a3e as fixtureInitPreferences};';res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(pathname)]||'application/octet-stream');res.end(source);return}res.statusCode=404;res.end()}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let socket,session,id=0,chrome;
const summary={scope:'Verbatim production panel with native React/preferences/buttons/CSS and synthetic metadata host, Windows Chrome.',checks:[]},pending=new Map(),exceptions=[];
try{
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((r,j)=>{let s='';const t=setTimeout(()=>j(Error('Chrome startup timeout')),20000);chrome.stderr.on('data',c=>{s+=c;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);r(m[1])}});chrome.on('error',j)});
 socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')exceptions.push(m.params.args);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.j(Error(JSON.stringify(m.error))):p.r(m.result)}}});
 const send=(method,params={},sid=session)=>new Promise((r,j)=>{const n=++id,t=setTimeout(()=>j(Error('CDP timeout '+method)),20000);pending.set(n,{r,j,t});socket.send(JSON.stringify({id:n,method,params,...(sid?{sessionId:sid}:{})}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const wait=async expression=>{for(let n=0;n<60;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Wait failed: '+expression+'; '+JSON.stringify(await evaluate('({errors:fixtureErrors,body:document.body.innerText})')))};
 const check=(name,value)=>{assert.ok(value,name);summary.checks.push(name)};
 session=(await send('Target.attachToTarget',{targetId:(await send('Target.createTarget',{url:'about:blank'},null)).targetId,flatten:true},null)).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 await wait("window.fixtureReady && document.querySelector('summary')?.innerText.includes('30초') && !document.querySelector('[role=status]')");
 const click=selector=>evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
 const text=()=>evaluate('document.body.innerText');
 const key=async()=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32})};
 const colors=[];
 for(const theme of ['light','dark']){
 await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme)+';document.body.dataset.vscodeThemeKind='+JSON.stringify('vscode-'+theme));
 check(theme+' excludes user idle gap',(await text()).includes('작업 1 · 총 30초 · 3개 턴'));
 colors.push(await evaluate("(()=>{const s=getComputedStyle(document.querySelector('section'));return {color:s.color,border:s.borderColor}})()"));
 await evaluate("document.querySelector('details').open=false;document.querySelector('summary').focus()");await key();await wait("document.querySelector('details').open");check(theme+' keyboard disclosure',true);
 await evaluate("document.querySelector('[data-azrael-time-boundary=b]').focus()");await key();await wait("document.querySelectorAll('details').length===2");check(theme+' keyboard split',true);
 await evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)");check(theme+' split totals',(await text()).includes('총 8초')&&(await text()).includes('총 22초'));
 await writeFile(join(logs,theme+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await click('[data-azrael-time-boundary=b]');await wait("document.querySelectorAll('details').length===1");check(theme+' merge total',(await text()).includes('총 30초'));
 }
 check('native semantic colors change between themes',colors[0].color!==colors[1].color&&colors[0].border!==colors[1].border);summary.colors=colors;
 await evaluate("document.querySelector('details').open=true");await click('[data-azrael-time-boundary=b]');await wait("document.querySelectorAll('details').length===2");await send('Page.reload');await wait("window.fixtureReady && document.querySelectorAll('details').length===2");check('reload persisted boundaries',true);
 await evaluate("fixtureHost='other';fixtureRerender()");await wait("document.querySelectorAll('details').length===1");check('host isolation',true);
 await evaluate("fixtureHost='local';fixtureChat='other';fixtureRerender()");await wait("document.querySelectorAll('details').length===1");check('chat isolation',true);
 await evaluate("fixtureChat='live';fixtureNow=20000;fixtureTurns=[{turnId:'work',turnStartedAtMs:1000,durationMs:8000,status:'deferred',rootResumeWait:{state:'waiting',revision:1,waitStartedAtMs:9000}},{turnId:'next',turnStartedAtMs:15000,status:'inProgress'}];fixtureRerender()");await wait("document.querySelector('summary').innerText.includes('19초') && !document.querySelector('[role=status]')");
 const queries=await evaluate('fixtureQueries.length');await evaluate('fixtureNow=23000');await new Promise(r=>setTimeout(r,1100));check('live overlap wait union ticks',(await text()).includes('22초'));check('clock never polls metadata',await evaluate('fixtureQueries.length')===queries);
 await evaluate("fixtureTurns=fixtureTurns.map(t=>({...t,status:'completed',durationMs:8000,rootResumeWait:t.rootResumeWait?{...t.rootResumeWait,state:'resumed',revision:2,waitEndedAtMs:23000}:null}));fixtureRerender()");await wait("!document.querySelector('[role=status]')");const frozen=await text();await evaluate('fixtureNow=60000');await new Promise(r=>setTimeout(r,1100));check('terminal freezes',(await text())===frozen);
 await evaluate("fixtureFailure=true;fixtureTurns=fixtureTurns.map(t=>({...t,status:'failed'}));fixtureRerender()");await wait("!!document.querySelector('[role=alert]')");check('stale complete is partial',(await text()).includes('일부'));
 await evaluate('fixtureFailure=false');await click('[data-azrael-time-retry]');await wait("!document.querySelector('[role=alert]')");check('explicit retry restores history',true);
 await evaluate("fixtureChat='missing';fixtureTurns=[{turnId:'unknown',status:'completed'}];fixtureRerender()");await wait("document.querySelector('summary').innerText.includes('일부')");check('missing time partial',true);
 await evaluate("fixtureLocale='en';fixtureRerender()");await wait("document.querySelector('summary').innerText.includes('Task 1')");check('English localization',true);
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);
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
 summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
