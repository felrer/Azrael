import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fixture=resolve(process.env.AZRAEL_RENDER_FIXTURE_ROOT ?? join(root,'artifacts/verification/custom-subagent-photos-20261012'));
const logs=resolve(process.env.AZRAEL_RENDER_LOG_ROOT ?? join(root,'artifacts/logs/custom-subagent-photos-20261012'));
const assets=join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? join(root,'artifacts/upstream-ui/26.1007.21434'),'webview/assets');
assert.ok(fixture.startsWith(join(root,'artifacts/verification')+sep),'Fixture containment');
assert.ok(logs.startsWith(join(root,'artifacts/logs')+sep),'Log containment');
const require=createRequire(import.meta.url);
const {AzraelDesignSettings,createDesignStore,pickStudentPreview}=require('./inject-student-design.cjs');
const {azraelSettingsText}=require('./inject-instruction-settings.cjs');
await mkdir(fixture,{recursive:true}); await mkdir(logs,{recursive:true});
const profile=join(fixture,'chrome-profile');
await mkdir(profile,{recursive:true});
const fixtureRealPath=await realpath(fixture),verificationRealPath=await realpath(join(root,'artifacts/verification'));
assert.ok(fixtureRealPath.startsWith(verificationRealPath+sep),'Real fixture containment');
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-1805ad19110d.css"></head><body class="bg-primary text-default" data-vscode-theme-kind="vscode-light"><main id="root" style="height:950px"></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module" src="/fixture.mjs"></script></body></html>`;
const moduleSource=`import {nLt,$At,XAt,Pc as AzraelPhotoMenu,Fc as initAzraelPhotoMenu} from '/assets/app-initial-97d3534ad35f.js';
import {ti as kt,ri as initNativePage,W3 as AzraelSettingsCard,G3 as initAzraelSettingsCard,Q3 as AzraelSettingsRow,t6 as initAzraelSettingsRow} from '/assets/app-initial-c014f9ee4429.js';
import {l9 as AzraelSwitch,d9 as initAzraelSwitch,ZIt as pe,$It as initNativeButton,Wp as AzraelFontChoice,Gp as initAzraelFontChoice} from '/assets/app-initial-7a199c66e670.js';
const Q=nLt(),$=$At(),ReactDOM=XAt();
const s=()=>({locale:'en'});
${azraelSettingsText.toString()}
${pickStudentPreview.toString()}
${createDesignStore.toString()}
const listeners=new Set();window.fixtureEvents=[];
const students=[{id:10000,photoSetId:'blue-archive',nameEn:'Aru',url:'/photo.png'},{id:10001,photoSetId:'blue-archive',nameEn:'Mutsuki',url:'/photo.png'},{id:'custom:1',photoSetId:'custom',nameEn:'Custom Cat',url:'/photo.png'}];
window.fixtureState={enabled:false,chatFont:'gyeonggi-consolas',students,assignments:{existing:10000},photoSets:[{id:'blue-archive',name:'Blue Archive',count:2},{id:'custom',name:'My characters',count:1}],selectedPhotoSetId:'blue-archive'};
const bridge={subscribe(_type,fn){listeners.add(fn);return()=>listeners.delete(fn)},dispatchMessage(_type,p){fixtureEvents.push(p);if(p.action==='unsubscribe')return;queueMicrotask(()=>{if(p.action==='setEnabled')fixtureState.enabled=p.enabled;if(p.action==='setChatFont')fixtureState.chatFont=p.chatFont;if(p.action==='setPhotoSet')fixtureState.selectedPhotoSetId=p.photoSetId;if(p.action==='importPhotoSet'){fixtureState.photoSets.push({id:'imported',name:'Imported photos',count:1});fixtureState.students.push({id:'imported:1',photoSetId:'imported',nameEn:'Imported Cat',url:'/photo.png'});fixtureState.selectedPhotoSetId='imported'}for(const l of listeners)l({...fixtureState,clientId:'fixture'})})}};
const azraelDesignStore=createDesignStore(bridge,'fixture');window.actualStore=azraelDesignStore;
function useAzraelDesignState(){return Q.useSyncExternalStore(azraelDesignStore.subscribe,azraelDesignStore.getSnapshot)}
${AzraelDesignSettings.toString()}
function Fixture(){initNativePage();initNativeButton();return $.jsx(AzraelDesignSettings,{})}
window.reactRoot=ReactDOM.createRoot(document.getElementById('root'));reactRoot.render($.jsx(Fixture,{}));window.fixtureReady=true;
`;
const server=createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
  if(req.url==='/photo.png'){res.setHeader('Content-Type','image/png');res.end(await readFile(join(root,'extensions/azrael-ex/media/student-avatars/10000.png')));return}
  if(req.url==='/fixture.mjs'){res.setHeader('Content-Type','text/javascript');res.end(moduleSource);return}
  if(req.url.startsWith('/assets/')){const path=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!path.startsWith(assets+sep))throw Error('Invalid asset');res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));return}
  res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));

async function confirmOwnedBrowserExit(child,profilePath){
 if(!child)return {confirmed:true,exitCode:null,signalCode:null,processIds:[]};
 if(child.exitCode===null&&child.signalCode===null)await new Promise(r=>{const timer=setTimeout(r,10000);child.once('exit',()=>{clearTimeout(timer);r()})});
 const result={confirmed:child.exitCode!==null||child.signalCode!==null,exitCode:child.exitCode,signalCode:child.signalCode};
 if(process.platform==='win32'){
  const query=spawn('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop'; $ownedChrome=@(Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" | Where-Object { $_.ProcessId -eq [int]$env:AZRAEL_RENDER_BROWSER_PID -or ($_.CommandLine -and $_.CommandLine.Contains($env:AZRAEL_RENDER_BROWSER_PROFILE)) } | Select-Object -ExpandProperty ProcessId); ConvertTo-Json -Compress -InputObject $ownedChrome"],{windowsHide:true,timeout:15000,env:{...process.env,AZRAEL_RENDER_BROWSER_PID:String(child.pid),AZRAEL_RENDER_BROWSER_PROFILE:profilePath},stdio:['ignore','pipe','pipe']});
  let output='',error='';query.stdout.on('data',c=>output+=c);query.stderr.on('data',c=>error+=c);
  const queryExit=await new Promise(r=>{query.once('error',e=>{error+=String(e);r(null)});query.once('exit',r)});
  result.processInspectionExitCode=queryExit;
  try{if(queryExit!==0)throw Error(error||'Process inspection failed');result.processIds=JSON.parse(output);assert.ok(Array.isArray(result.processIds));result.confirmed=result.processIds.length===0}catch(e){result.confirmed=false;result.inspectionError=String(e)}
 }
 if(result.confirmed){child.unref();child.stderr?.destroy()}
 return result;
}

let socket,session,id=0,chrome,summary={scope:'Production Design component/store and native React/settings controls/CSS; synthetic host replies. No installed VS Code or real file-dialog acceptance.',checks:[]};
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

 session=(await send('Target.attachToTarget',{targetId:(await send('Target.createTarget',{url:'about:blank'},null)).targetId,flatten:true},null)).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:1100,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 await wait("window.fixtureReady && document.querySelector('[role=switch]') && !actualStore.getSnapshot().loading");
 const click=async label=>{await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(label)}).click()`);await wait('!actualStore.getSnapshot().saving')};
 const chooseSet=async label=>{
  await evaluate("document.querySelector('[data-azrael-photo-set-trigger]').focus()");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait("!!document.querySelector('[role=menuitemradio]')");
  check('dropdown contains all sets',await evaluate("document.querySelectorAll('[role=menuitemradio]').length===actualStore.getSnapshot().photoSets.length"));
  await evaluate(`[...document.querySelectorAll('[role=menuitemradio]')].find(e=>e.textContent===${JSON.stringify(label)}).focus()`);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait("!actualStore.getSnapshot().saving && !document.querySelector('[role=menuitemradio]')");
  check('dropdown shows confirmed selection',await evaluate(`document.querySelector('[data-azrael-photo-set-trigger]').textContent===${JSON.stringify(label)}`));
 };
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}'`);
  await chooseSet('My characters');await wait("document.querySelector('img')?.alt==='Custom Cat'");
  check(theme+' set selection limits preview',await evaluate("actualStore.getSnapshot().selectedPhotoSetId==='custom' && document.querySelectorAll('img').length===1"));
  await evaluate("document.querySelector('[role=switch]').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});await wait('!actualStore.getSnapshot().saving');
  check(theme+' keyboard toggle saves',await evaluate("fixtureEvents.at(-1).action==='setEnabled'"));
  await chooseSet('Blue Archive');await wait("!!document.querySelector('img') && document.querySelector('img').alt!=='Custom Cat'");const previous=await evaluate("document.querySelector('img').alt");await click('Draw again');check(theme+' draw excludes previous',await evaluate("document.querySelector('img').alt")!==previous);
  summary[theme]=await evaluate("({background:getComputedStyle(document.body).backgroundColor,color:getComputedStyle(document.querySelector('h1')).color,overflow:document.documentElement.scrollWidth>innerWidth})");check(theme+' page has no horizontal overflow',!summary[theme].overflow);
  await writeFile(join(logs,theme+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("document.querySelector('[data-azrael-photo-set-trigger]').focus()");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait("!!document.querySelector('[role=menuitemradio]')");
  await writeFile(join(logs,theme+'-menu.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await wait("!document.querySelector('[role=menuitemradio]')");
 }
 check('themes differ',summary.light.color!==summary.dark.color);
 await click('Add image set');await wait("document.querySelector('img')?.alt==='Imported Cat'");check('import selects new set',await evaluate("actualStore.getSnapshot().selectedPhotoSetId==='imported'"));
 check('prior assignment retained',await evaluate("actualStore.getSnapshot().assignments.existing===10000"));
 await send('Emulation.setDeviceMetricsOverride',{width:420,height:1100,deviceScaleFactor:1,mobile:false});check('narrow page no overflow',await evaluate('document.documentElement.scrollWidth<=innerWidth'));
 await chooseSet('My characters');check('narrow dropdown selection',await evaluate("actualStore.getSnapshot().selectedPhotoSetId==='custom'"));
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);
 summary.outcome='passed';await evaluate('reactRoot.unmount();actualStore.dispose()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));
 if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
 summary.browserExit=await confirmOwnedBrowserExit(chrome,profile);
 if(summary.browserExit.confirmed){assert.equal(await realpath(fixture),fixtureRealPath);
  const cleanup=spawn('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop'; $target=[IO.Path]::GetFullPath($env:AZRAEL_DESIGN_FIXTURE); $owner=[IO.Path]::GetFullPath($env:AZRAEL_DESIGN_OWNER); if(-not $target.StartsWith($owner+[IO.Path]::DirectorySeparatorChar)){throw 'Containment failed'}; Remove-Item -LiteralPath $target -Recurse; if(Test-Path -LiteralPath $target){throw 'Fixture still exists'}"],{windowsHide:true,env:{...process.env,AZRAEL_DESIGN_FIXTURE:fixture,AZRAEL_DESIGN_OWNER:join(root,'artifacts/verification')},stdio:['ignore','pipe','pipe']});let error='';cleanup.stderr.on('data',c=>error+=c);const code=await new Promise(r=>cleanup.once('exit',r));summary.cleanupExitCode=code;summary.cleanup=code===0?'Owned browser exited; guarded fixture removed':error;if(code!==0)process.exitCode=1;
 }else{summary.cleanup='Browser exit uncertain; owned profile retained until confirmed closed';process.exitCode=1}
 await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}
