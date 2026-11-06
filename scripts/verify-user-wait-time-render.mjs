import artifactRunTools from './artifact-run.cjs';
const {beginArtifactRun,trackArtifactChild}=artifactRunTools;
import {createRequire} from 'node:module';
import {spawn as nativeSpawn,} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const artifactRun=beginArtifactRun(root,{workId:'verify-user-wait-time-render-EK-01',owner:'scripts/verify-user-wait-time-render.mjs',runId:process.env.AZRAEL_USER_WAIT_RENDER_RUN_ID,paths:{...(process.env.AZRAEL_RENDER_FIXTURE_ROOT ? {temporary:resolve(process.env.AZRAEL_RENDER_FIXTURE_ROOT)} : {}),...(process.env.AZRAEL_RENDER_LOG_ROOT ? {logs:resolve(process.env.AZRAEL_RENDER_LOG_ROOT)} : {})}});
const spawn=(...args)=>trackArtifactChild(artifactRun,nativeSpawn(...args));
const confirmOwnedBrowserExit=(child,profilePath)=>artifactRunTools.confirmOwnedBrowserExit(child,profilePath,spawn);

const fixture=artifactRun.temporary;
const logs=artifactRun.logs;
const assets=join(root,'artifacts/upstream-ui/26.1007.21434/webview/assets'),profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);

const {injectUserWaitTime,APPROVAL}=require('./inject-user-wait-time.cjs');
const {injectDeferredRendererNotification}=require('./inject-deferred-turn.cjs');
const ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const mainName=APPROVAL.split('/').at(-1);
let main=injectUserWaitTime(injectDeferredRendererNotification(await readFile(join(assets,mainName),'utf8')).text,APPROVAL).text;
const ast=ts.createSourceFile(mainName,main,99,true,ts.ScriptKind.JS);
const owner=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='azraelNativeApprovalCard');assert.ok(owner);
let render=owner.getText(ast),edits=[];
const adapters=['nha','Hu','st','Nka','q'];
function visit(n){if(ts.isIdentifier(n)&&adapters.includes(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(ast)-owner.getStart(ast),end:n.end-owner.getStart(ast),text:'fixture_'+n.text});ts.forEachChild(n,visit)}visit(owner);
for(const e of edits.sort((a,b)=>b.start-a.start))render=render.slice(0,e.start)+e.text+render.slice(e.end);
main=main.replace(owner.getText(ast),render);
const adapterSource=`
const fixture_nha=()=>false,fixture_Hu=()=>null,fixture_st=()=>({formatMessage:d=>d.defaultMessage}),fixture_Nka=()=>{},fixture_q=({defaultMessage})=>defaultMessage;
window.fixtureNow=1700000133000;Date.now=()=>fixtureNow;window.fixtureEvents=[];
window.fixtureRequest={requestId:'approval-1',callId:'call-1',kind:'commandApproval',startedAtMs:1700000000000,endedAtMs:null,durationMs:null};window.fixturePending=true;
function Fixture(){const React=wd();const[,update]=React.useState(0);window.fixtureRerender=()=>update(n=>n+1);const request=fixtureRequest,timing={revision:request.endedAtMs==null?1:2,requests:[request],blockedIntervals:[]},turn={turnId:'turn',userWaitTiming:timing};const end=kind=>{fixtureEvents.push(kind);window.fixtureRequest={...request,endedAtMs:fixtureNow,durationMs:fixtureNow-request.startedAtMs};window.fixturePending=false;fixtureRerender()};window.fixtureEnd=end;return azraelUserWaitScope(m().jsx('div',{className:'p-4',children:fixturePending?m().jsx(Ika,{azraelWaitIdentity:{requestId:request.requestId},title:'Allow command execution?',reason:'Synthetic command for wait timing verification',actions:{onApprove:()=>end('approve'),onDeny:()=>end('deny')}}):m().jsx('div',{children:'Command result'})}),turn)}
export{Fixture};`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;html,body,#root{height:100%;margin:0}</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5b2ced5ef25.css"></head><body data-vscode-theme-kind="vscode-light"><div id="root"></div><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import{$At as KEt,XAt as UEt}from'/assets/app-initial-97d3534ad35f.js';import{Fixture,Zo as initCard}from'/assets/${mainName}';initCard();window.reactRoot=UEt().createRoot(document.getElementById('root'));reactRoot.render(KEt().jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);if(pathname===join(assets,mainName))source=main+adapterSource;res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Production wait context/timer and native approval shell/buttons/React/CSS; synthetic canonical Turn metadata and localization/host services. Installed host and full provider acceptance remain separate.',checks:[]},pending=new Map(),exceptions=[];
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

 await wait("window.fixtureReady && !!document.querySelector('[data-azrael-user-wait]')");
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.documentElement.className='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixturePending=true;fixtureRequest={...fixtureRequest,endedAtMs:null,durationMs:null};fixtureNow=1700000133000;fixtureRerender()`);
  await wait("!!document.querySelector('[data-codex-approval-surface]')");
  summary.initial=await evaluate("({text:document.body.innerText,now:fixtureNow,request:fixtureRequest,timers:[...document.querySelectorAll('[data-azrael-user-wait]')].map(e=>e.textContent)})");
  await wait("document.querySelector('[data-azrael-user-wait]').textContent==='응답 대기 2분 13초'");
  check(theme+' waits from native boundary',true);
  await evaluate('fixtureNow+=1000');await wait("document.querySelector('[data-azrael-user-wait]').textContent==='응답 대기 2분 14초'");
  const state=await evaluate("(()=>{const e=document.querySelector('[data-azrael-user-wait]'),s=getComputedStyle(e),r=e.getBoundingClientRect();return {color:s.color,width:r.width,height:r.height,text:e.innerText,inside:!!e.closest('[data-codex-approval-surface]')}})()");
  check(theme+' timing inside native styled card',state.inside&&state.width>0&&state.height>0);summary[theme]=state;
  await writeFile(join(logs,theme+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Deny').click()");
  await wait("!document.querySelector('[data-codex-approval-surface]')");
  check(theme+' completed history survives pending card removal with request context',await evaluate("document.querySelector('[data-azrael-user-wait]').textContent==='명령 승인 · 응답까지 2분 14초'"));
  await evaluate('fixtureNow+=60000');await new Promise(r=>setTimeout(r,1100));
  check(theme+' answered timer remains frozen',await evaluate("document.querySelector('[data-azrael-user-wait]').textContent==='명령 승인 · 응답까지 2분 14초'"));
 }
 check('theme foreground changes',summary.light.color!==summary.dark.color);
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:700,deviceScaleFactor:1,mobile:false});
 await evaluate('fixturePending=true;fixtureRequest={...fixtureRequest,endedAtMs:null,durationMs:null};fixtureRerender()');await wait("!!document.querySelector('[data-codex-approval-surface]')");
 check('narrow native card has no horizontal overflow',await evaluate('document.body.scrollWidth<=360'));
 await writeFile(join(logs,'narrow.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Allow once').click()");await wait("!document.querySelector('[data-codex-approval-surface]')");
 check('native approve action preserved',await evaluate("fixtureEvents.at(-1)==='approve'"));
 await evaluate('fixtureRequest={...fixtureRequest,endedAtMs:null,durationMs:null};fixturePending=true;fixtureRerender()');await wait("!!document.querySelector('[data-codex-approval-surface]')");await evaluate("fixtureEnd('cancel')");await wait("!document.querySelector('[data-codex-approval-surface]')");
 check('cancelled boundary stays visible',await evaluate("document.querySelector('[data-azrael-user-wait]').textContent.startsWith('명령 승인 · 응답까지 ')"));
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
