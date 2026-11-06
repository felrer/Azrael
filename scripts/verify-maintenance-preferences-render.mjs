import artifactRunTools from './artifact-run.cjs';
const {beginArtifactRun,trackArtifactChild}=artifactRunTools;
import {createRequire} from 'node:module';
import {spawn as nativeSpawn,} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const artifactRun=beginArtifactRun(root,{workId:'verify-maintenance-preferences-render',owner:'scripts/verify-maintenance-preferences-render.mjs',paths:{...(process.env.AZRAEL_RENDER_FIXTURE_ROOT ? {temporary:resolve(root,process.env.AZRAEL_RENDER_FIXTURE_ROOT)} : {}),...(process.env.AZRAEL_RENDER_LOG_ROOT ? {logs:resolve(root,process.env.AZRAEL_RENDER_LOG_ROOT)} : {})}});
const spawn=(...args)=>trackArtifactChild(artifactRun,nativeSpawn(...args));
const confirmOwnedBrowserExit=(child,profilePath)=>artifactRunTools.confirmOwnedBrowserExit(child,profilePath,spawn);
const containedPath=(value,parent,label)=>{const target=resolve(root,value),allowed=resolve(root,parent)+sep;assert.ok(target.toLowerCase().startsWith(allowed.toLowerCase()),label+' must be a descendant of '+parent);return target};
const fixture=artifactRun.temporary;
const logs=artifactRun.logs;
const assets=join(root,"artifacts/upstream-ui/26.1007.21434/webview/assets");
const profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);
const {renderMaintenancePreferences}=require('./inject-maintenance-preferences.cjs');
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const adapterSource=`import {nLt,$At,XAt} from '/assets/app-initial-97d3534ad35f.js';
import {W3 as Card,G3,Q3 as Row,t6} from '/assets/app-initial-c014f9ee4429.js';
import {ZIt as Button,$It,l9 as Switch,d9} from '/assets/app-initial-7a199c66e670.js';
G3();t6();$It();d9();const React=nLt(),$=$At();
${renderMaintenancePreferences.toString()}
window.fixtureRequests=[];window.fixtureState={ko:false,fail:false,hold:true};
window.fixtureSnapshot={schema:1,revision:0,groups:true,locks:true,deletion:true,effective:{groups:true,locks:true,deletion:true},status:'enabled',pending:false};
let receive;const bridge={subscribe(type,callback){receive=callback;return()=>{receive=null}},dispatchMessage(type,message){fixtureRequests.push(message);const reply=()=>{if(message.action==='write'){if(fixtureState.fail){receive?.({...message,error:'Synthetic native conflict'});return}const p=message.payload;if(p.expected_revision!==fixtureSnapshot.revision)throw Error('CAS mismatch');Object.assign(fixtureSnapshot,p,{revision:fixtureSnapshot.revision+1});delete fixtureSnapshot.expected_revision;fixtureSnapshot.effective={locks:p.locks,groups:p.groups&&p.locks,deletion:p.groups&&p.locks&&p.deletion};fixtureSnapshot.pending=!p.locks;fixtureSnapshot.status=fixtureSnapshot.pending?'draining':p.groups&&p.deletion?'enabled':'disabled'}receive?.({...message,snapshot:structuredClone(fixtureSnapshot)})};if(fixtureState.hold)window.fixtureRelease=()=>{fixtureState.hold=false;reply()};else queueMicrotask(reply)}};
function Fixture(){const [,update]=React.useState(0);window.fixtureRerender=()=>update(x=>x+1);return renderMaintenancePreferences(React,$.jsx,bridge,fixtureState.ko,{Card,Row,Switch,Button})}
window.reactRoot=XAt().createRoot(document.getElementById('root'));reactRoot.render($.jsx(Fixture,{}));window.fixtureReady=true;`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5b2ced5ef25.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto flex w-full max-w-3xl flex-col p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module" src="/fixture.mjs"></script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url==='/fixture.mjs'){res.setHeader('Content-Type','text/javascript');res.end(adapterSource);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Maintenance preferences with pinned React/Card/Row/Switch/Button/CSS, synthetic host in light/dark/narrow. No build or model requests.',checks:[]},pending=new Map(),exceptions=[];
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
 await wait("window.fixtureReady && !!window.fixtureRelease");
 check('loading disables native switches',await evaluate("[...document.querySelectorAll('[role=switch]')].length===3&&[...document.querySelectorAll('[role=switch]')].every(e=>e.disabled)"));
 await evaluate('fixtureRelease()');await wait("[...document.querySelectorAll('[role=switch]')].every(e=>!e.disabled)");
 check('all defaults enabled',await evaluate("[...document.querySelectorAll('[role=switch]')].every(e=>e.getAttribute('aria-checked')==='true')"));
 await evaluate("document.querySelectorAll('[role=switch]')[2].focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});await wait('fixtureSnapshot.deletion===false');
 check('keyboard switch persisted with CAS',await evaluate("fixtureRequests.some(r=>r.action==='write'&&r.payload.expected_revision===0&&r.payload.deletion===false)"));
 await evaluate("fixtureState.fail=true;document.querySelectorAll('[role=switch]')[2].click()");await wait("!!document.querySelector('[role=alert]')");check('failed native write retains confirmed choice',await evaluate('fixtureSnapshot.deletion===false'));await evaluate("fixtureState.fail=false;document.querySelector('button:not([role=switch])').click()");await wait("!document.querySelector('[role=alert]')");
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}'`);
  summary[theme]=await evaluate("(()=>{const e=document.querySelector('[role=switch]');return {height:e.getBoundingClientRect().height,background:getComputedStyle(document.querySelector('button:not([role=switch])')).backgroundColor}})()");check(theme+' native switch geometry',summary[theme].height>=16);
  await writeFile(join(logs,theme+'-settings.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 check('native themes differ',summary.light.background!==summary.dark.background);
 await evaluate("document.querySelectorAll('[role=switch]')[1].click()");await wait('fixtureSnapshot.pending');check('draining preserves requested groups and blocks changes',await evaluate("fixtureSnapshot.groups===true&&fixtureSnapshot.effective.groups===false&&[...document.querySelectorAll('[role=switch]')].every(e=>e.disabled)&&document.body.innerText.includes('locks may still be held')"));
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:1100,deviceScaleFactor:1,mobile:false});await evaluate('fixtureState.ko=true;fixtureRerender()');await wait("document.body.innerText.includes('프로젝트 유지관리')");check('Korean narrow view',await evaluate("document.documentElement.scrollWidth<=360&&document.body.innerText.includes('종료 대기 중')"));await writeFile(join(logs,'dark-narrow-ko.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await evaluate("fixtureSnapshot.pending=false;fixtureSnapshot.status='disabled';document.querySelector('button:not([role=switch])').click()");await wait("[...document.querySelectorAll('[role=switch]')].every(e=>!e.disabled)");check('drain completion refreshed',await evaluate("document.body.innerText.includes('유지관리 기능이 꺼져 있습니다')"));
 summary.events=await evaluate('fixtureRequests');
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
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
