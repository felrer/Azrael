import artifactRunTools from './artifact-run.cjs';
const {beginArtifactRun,trackArtifactChild}=artifactRunTools;
import {createRequire} from 'node:module';
import {spawn as nativeSpawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const artifactRun=beginArtifactRun(root,{workId:'verify-use-settings-render',owner:'scripts/verify-use-settings-render.mjs',paths:{...(process.env.AZRAEL_RENDER_FIXTURE_ROOT ? {temporary:resolve(process.env.AZRAEL_RENDER_FIXTURE_ROOT)} : {}),...(process.env.AZRAEL_RENDER_LOG_ROOT ? {logs:resolve(process.env.AZRAEL_RENDER_LOG_ROOT)} : {})}});
const spawn=(...args)=>trackArtifactChild(artifactRun,nativeSpawn(...args));
const confirmOwnedBrowserExit=(child,profilePath)=>artifactRunTools.confirmOwnedBrowserExit(child,profilePath,spawn);
const fixture=artifactRun.temporary;
const logs=artifactRun.logs;
const assets=join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? join(root,'artifacts/upstream-ui/26.1007.21434'),'webview/assets');

const require=createRequire(import.meta.url);
const {AzraelWindowControlLauncher,createUseSettingsStore}=require('./inject-window-control.cjs');
const {createSettingsHost}=require('./use-settings-host.cjs');
const {createSettingsOwner}=require('./use-control-settings.cjs');
const {createOwner}=require('./window-use-approvals.cjs');
await mkdir(fixture,{recursive:true}); await mkdir(logs,{recursive:true});
const home=join(fixture,'home'),profile=join(fixture,'chrome-profile');
await mkdir(profile,{recursive:true});
const fixtureRealPath=await realpath(fixture),verificationRealPath=await realpath(join(root,'artifacts'));
assert.ok(fixtureRealPath.startsWith(verificationRealPath+sep),'Real fixture containment');
const settings=createSettingsOwner(home);
const approvals=createOwner(home);
const desktopApprovals=require('./computer-use-approvals.cjs').createOwner(home);
const executable='C:\\Synthetic Applications\\'+ 'Long descriptive application directory '.repeat(6)+'\\fixture.exe';
const windowDescriptor={hwnd:'fixture-window',pid:12345,processCreated:'synthetic-20261007',executable,title:'Acceptance fixture'};
let hold=false,rejectUpdate=false,held=[],requests=[],responses=[];
const host=createSettingsHost({runtime:{codexHome:home},vscode:{window:{showQuickPick:async choices=>choices[0],showWarningMessage:async()=> '삭제'}},backend:{request:async()=>[windowDescriptor]}});
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"></head><body data-vscode-theme-kind="vscode-light"><main id="root" style="height:950px"></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module" src="/fixture.mjs"></script></body></html>`;
const moduleSource=`import {nLt,$At,XAt} from '/assets/app-initial-97d3534ad35f.js';
import {ti as NativePage,ri as initNativePage,W3 as AzraelUseCard,G3 as initAzraelUseCard,Q3 as AzraelUseRow,t6 as initAzraelUseRow} from '/assets/app-initial-c014f9ee4429.js';
import {l9 as AzraelUseSwitch,d9 as initAzraelUseSwitch,ZIt as AzraelUseButton,$It as initAzraelUseButton} from '/assets/app-initial-7a199c66e670.js';
const Q=nLt(),$=$At(),ReactDOM=XAt();
const getAzraelUseReact=nLt;
const listeners=new Set();window.fixtureRequests=[];window.fixtureReceived=[];
const azraelWindowBridge={subscribe(type,callback){listeners.add(callback);return()=>listeners.delete(callback)},dispatchMessage(type,data){window.fixtureRequests.push({...data,type});fetch('/host',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,type})}).then(r=>r.json()).then(message=>{window.fixtureReceived.push(message);for(const l of listeners)l(message)}).catch(e=>{window.fixtureErrors.push(String(e))})}};
const actualFactory=${createUseSettingsStore.toString()};
const createUseSettingsStore=(...args)=>{window.actualStore=actualFactory(...args);return window.actualStore};
${AzraelWindowControlLauncher.toString()}
window.emit=message=>{for(const l of listeners)l(message)};
initNativePage();initAzraelUseCard();initAzraelUseRow();
const previous=$.jsxs('section',{id:'previous-settings',className:'flex flex-col gap-4',children:[$.jsx('h1',{className:'text-2xl font-semibold text-default',children:'Window Use'})]});
window.reactRoot=ReactDOM.createRoot(document.getElementById('root'));window.reactRoot.render($.jsxs(NativePage,{children:[previous,$.jsx(AzraelWindowControlLauncher,{})]}));window.fixtureReady=true;`;
const server=createServer(async(req,res)=>{try{
  if(req.url==='/host') { let body='';for await(const c of req)body+=c;const request=JSON.parse(body);requests.push(request);if(rejectUpdate&&request.action==='update'){request.expectedRevision=-1;rejectUpdate=false}
    await host.receive({postMessage:async message=>{responses.push(message);const finish=()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(message))};if(hold)held.push({finish,message,action:request.action});else finish()}},request);return;
  }
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
  if(req.url==='/fixture.mjs'){res.setHeader('Content-Type','text/javascript');res.end(moduleSource);return}
  if(req.url.startsWith('/assets/')){const path=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!path.startsWith(assets+sep))throw Error('Invalid asset');res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));return}
  res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));



let socket,session,id=0,chrome,summary={scope:'Actual production settings section, real pinned React/native components/CSS and production settings host/store/persistence; synthetic running-window and confirmation decisions. No full installed VS Code navigation.',checks:[]};
const pending=new Map(),exceptions=[];
try{
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-background-mode','--disable-extensions','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((r,j)=>{let s='';const t=setTimeout(()=>j(Error('Chrome startup timeout')),20000);chrome.stderr.on('data',c=>{s+=c;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);r(m[1])}});chrome.on('error',j)});
 socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')exceptions.push(m.params.args);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.j(Error(JSON.stringify(m.error))):p.r(m.result)}}});
 const send=(method,params={},sid=session)=>new Promise((r,j)=>{const n=++id,t=setTimeout(()=>j(Error('CDP timeout '+method)),20000);pending.set(n,{r,j,t});socket.send(JSON.stringify({id:n,method,params,...(sid?{sessionId:sid}:{})}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Wait failed: '+expression+'; '+JSON.stringify(await evaluate('({errors:fixtureErrors,body:document.body.innerText})')))};
 const check=(name,value)=>{assert.ok(value,name);summary.checks.push(name)};
 const waitHost=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await new Promise(r=>setTimeout(r,50))}throw Error('Host request/acknowledgement wait failed')};
 session=(await send('Target.attachToTarget',{targetId:(await send('Target.createTarget',{url:'about:blank'},null)).targetId,flatten:true},null)).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 await wait('window.fixtureReady && window.actualStore?.getSnapshot().settings && !window.actualStore.getSnapshot().loading');
 const snapshot=()=>evaluate('window.actualStore.getSnapshot()');
 const switches=()=>evaluate("[...document.querySelectorAll('[role=switch]')].map(e=>({checked:e.getAttribute('aria-checked'),label:e.getAttribute('aria-label'),labelledby:e.getAttribute('aria-labelledby'),disabled:e.disabled}))");
 const clickSwitch=async index=>{await evaluate(`document.querySelectorAll('[role=switch]')[${index}].click()`);await wait('!actualStore.getSnapshot().saving');};
 const clickButton=async text=>{await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)}).click()`);await wait('!actualStore.getSnapshot().saving');};
 check('initial Window Use on, Window allow-all off, empty apps',(await snapshot()).settings.windowUseEnabled&&!(await snapshot()).settings.windowUseAllowAll&&(await snapshot()).approvedApps.length===0);
 check('native accessible switches',(await switches()).length===6&&(await switches()).every(e=>e.label||e.labelledby));
 hold=true;await wait("fixtureRequests.filter(r=>r.action==='read').length>=2");await waitHost(()=>held.some(entry=>entry.action==='read'));
 check('quiet background read leaves rendered controls enabled',(await switches()).every(e=>!e.disabled)&&!(await snapshot()).loading&&!(await snapshot()).saving);
 await evaluate("document.querySelectorAll('[role=switch]')[0].click()");await wait('actualStore.getSnapshot().saving');
 await wait("fixtureRequests.some(r=>r.action==='update' && r.patch.windowUseEnabled===false)");
 await waitHost(()=>held.some(entry=>entry.action==='update'));
 check('rendered OFF click preempts quiet read with update request',requests.some(r=>r.action==='update'&&r.patch.windowUseEnabled===false));
 await wait('document.querySelector("[role=status]")?.textContent.includes("저장")');
 check('save awaits host acknowledgement',(await snapshot()).settings.windowUseEnabled===true&&(await switches())[0].checked==='true');
 check('real host persisted disabled Window Use before ack',settings.getSettings().windowUseEnabled===false);
 await evaluate(`window.emit({...window.actualStore.getSnapshot(),type:'azrael-use-settings-state',clientId:${JSON.stringify(requests.at(-1).clientId)},requestId:'unrelated-request',error:'stale error'})`);
 check('unrelated request/error ignored',(await snapshot()).saving&&(await snapshot()).error===null);
 hold=false;const updateIndex=held.findIndex(entry=>entry.action==='update');assert.ok(updateIndex>=0,'Held update acknowledgement');held.splice(updateIndex,1)[0].finish();await wait('!actualStore.getSnapshot().saving');
 check('preempting update acknowledgement renders OFF',(await switches())[0].checked==='false'&&!(await snapshot()).settings.windowUseEnabled);
 const staleRead=held.find(entry=>entry.action==='read');assert.ok(staleRead,'Held quiet read');check('held quiet read contains previous ON policy',staleRead.message.settings.windowUseEnabled);
 held.splice(0).forEach(entry=>entry.finish());await wait(`fixtureReceived.some(r=>r.requestId===${JSON.stringify(staleRead.message.requestId)})`);
 check('late quiet read cannot undo acknowledged OFF',(await switches())[0].checked==='false'&&!(await snapshot()).settings.windowUseEnabled&&!((await snapshot()).saving));
 check('master off disables stage and app-consent switches',(await switches()).slice(1).every(e=>e.disabled));
 check('master off preserves independent stage values',settings.getSettings().stage1Enabled&&settings.getSettings().stage2Enabled&&!settings.getSettings().stage3Enabled&&settings.getSettings().stage4Enabled);
 await evaluate("document.querySelector('[role=switch]').focus()");check('native switch receives keyboard focus',await evaluate("document.activeElement.getAttribute('role')==='switch'"));await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});await wait('!actualStore.getSnapshot().saving && actualStore.getSnapshot().settings.windowUseEnabled');
 check('keyboard Space toggles focused native switch',settings.getSettings().windowUseEnabled);
 for(let stage=1;stage<=4;stage++){
  const before=settings.getSettings();await clickSwitch(stage);const after=settings.getSettings();
  check('independent rendered stage '+stage+' persists',after[`stage${stage}Enabled`]===!before[`stage${stage}Enabled`]&&[1,2,3,4].filter(other=>other!==stage).every(other=>after[`stage${other}Enabled`]===before[`stage${other}Enabled`]));
  await clickSwitch(stage);
 }
 await clickSwitch(5);check('all-app consent switch persists independently',settings.getSettings().windowUseAllowAll);await clickSwitch(5);
 rejectUpdate=true;await clickSwitch(0);check('server rejection visible and preserves policy',!!(await snapshot()).error&&settings.getSettings().windowUseEnabled&&await evaluate("!!document.querySelector('[role=alert]')"));
 await clickButton('다시 불러오기');check('retry clears server error',!(await snapshot()).error);
 await clickButton('실행 중인 창에서 추가');check('real persisted synthetic app added',(await snapshot()).approvedApps.length===1&&approvals.getPersistentAppApprovals().approvedApps.length===1);
 desktopApprovals.addAppApproval('legacy desktop identity','Legacy desktop fixture');await evaluate('actualStore.retry()');await wait('!actualStore.getSnapshot().loading && actualStore.getSnapshot().approvedApps.length===2');check('legacy desktop grant has explicit source without window alias',(await snapshot()).approvedApps.find(app=>app.bundleIdentifier==='legacy desktop identity')?.source==='desktop'&&await evaluate("document.body.innerText.includes('데스크톱 제어 승인 · legacy desktop identity')"));
 const wrapping=await evaluate("(()=>{const e=[...document.querySelectorAll('span')].find(e=>e.classList.contains('break-all'));return {scroll:e.scrollWidth,width:e.clientWidth,height:e.getBoundingClientRect().height,sectionWidth:document.querySelector('[data-azrael-window-control]').getBoundingClientRect().width,pageOverflow:document.documentElement.scrollWidth>innerWidth}})()");
 check('long executable path wraps within page',wrapping.height>30&&!wrapping.pageOverflow);
 summary.wrapping=wrapping;
 for(const theme of ['light','dark']){await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}'`);await new Promise(r=>setTimeout(r,150));const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(logs,theme+'.png'),Buffer.from(shot.data,'base64'));summary[theme]=await evaluate("({background:getComputedStyle(document.body).backgroundColor,color:getComputedStyle(document.querySelector('h1')).color,switchBackground:getComputedStyle(document.querySelector('[role=switch]')).backgroundColor,gap:document.querySelector('[data-azrael-window-control]').getBoundingClientRect().top-document.querySelector('#previous-settings').getBoundingClientRect().bottom})");check(theme+' native page keeps added settings within normal section gap',summary[theme].gap>0&&summary[theme].gap<=48)}
 check('light and dark theme tokens differ',summary.light.color!==summary.dark.color);
 await send('Emulation.setDeviceMetricsOverride',{width:520,height:950,deviceScaleFactor:1,mobile:false});check('narrow layout has no horizontal overflow',await evaluate('document.documentElement.scrollWidth<=innerWidth'));
 await clickSwitch(5);check('dark-theme native switch interaction persists',settings.getSettings().windowUseAllowAll);await clickSwitch(5);
 await evaluate("document.querySelector('button[aria-label=\"Legacy desktop fixture 허용 삭제\"]').click()");await wait('!actualStore.getSnapshot().saving && actualStore.getSnapshot().approvedApps.length===1');check('rendered desktop removal routes to desktop owner only',desktopApprovals.getPersistentAppApprovals().approvedApps.length===0&&approvals.getPersistentAppApprovals().approvedApps.length===1);
 await evaluate("document.querySelector('button[aria-label$=\"허용 삭제\"]').click()");await wait('!actualStore.getSnapshot().saving && actualStore.getSnapshot().approvedApps.length===0');check('confirmed app removal persisted',(await snapshot()).approvedApps.length===0&&approvals.getPersistentAppApprovals().approvedApps.length===0);
 check('no browser console exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);
 summary.outcome='passed';summary.requests=requests.map(({action,requestId})=>({action,requestId}));
 await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 host.dispose();held.splice(0).forEach(entry=>entry.finish());server.closeAllConnections();await new Promise(r=>server.close(r));
 if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
  assert.equal(await realpath(fixture),fixtureRealPath);
  summary.browserExit=await confirmOwnedBrowserExit(chrome,profile);
  artifactRun.producerStopped=summary.browserExit.confirmed;
  summary.runRoot=artifactRun.runRoot;summary.lifecycleId=artifactRun.lifecycleId;
  summary.fixtureRemoved=false;summary.retentionReason='Retained fixture, profile and raw results for lifecycle review';
  if(!summary.browserExit.confirmed)process.exitCode=1;
  summary.exitCode=process.exitCode||0;
  await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}
