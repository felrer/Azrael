import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fixture=join(root,'artifacts/verification/deferred-timer-ui');
const logs=join(root,'artifacts/logs/deferred-timer-20261007/ui');
const assets=join(root,'artifacts/upstream-ui/26.930.61225/webview/assets');
const profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);
const ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const {injectDeferredPresentation,injectDeferredTurn,DEFERRED_PRESENTATION_ASSET,DEFERRED_REDUCER_ASSET}=require('./inject-deferred-turn.cjs');
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const mainName=DEFERRED_PRESENTATION_ASSET.split('/').at(-1);
const main=injectDeferredPresentation(await readFile(join(assets,mainName),'utf8')).text;
const ast=ts.createSourceFile('main.js',main,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const named=(tree,name)=>{const owner=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(owner,'Pinned function '+name);return owner};
const adaptations={ra:'fixtureLocale',X:'FixtureMessage',RFi:'fixtureClock',IFi:'fixtureLabel',LFi:'fixtureDivider'};
const adapt=owner=>{let source=owner.getText(ast),edits=[];function visit(n){if(ts.isIdentifier(n)&&adaptations[n.text]&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(ast)-owner.getStart(ast),end:n.end-owner.getStart(ast),text:adaptations[n.text]});ts.forEachChild(n,visit)}visit(owner);for(const e of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,e.start)+e.text+source.slice(e.end);return source};
const reducer=injectDeferredTurn(await readFile(join(assets,DEFERRED_REDUCER_ASSET.split('/').at(-1)),'utf8')).text;
const reducerAst=ts.createSourceFile('reducer.js',reducer,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const merge=named(reducerAst,'mue').getText(reducerAst).replace('function mue(','function fixtureMerge(');
const adapterSource=String.raw`
const fixtureLocale=()=>({locale:'en-US'});
function FixtureMessage({defaultMessage,values={}}){return defaultMessage.replace(/\{(\w+)\}/g,(_,key)=>values[key]??key)}
${['RFi','IFi','LFi'].map(n=>adapt(named(ast,n))).join(String.fromCharCode(10))}
const fixtureMergeSnapshot=(()=>{const vue={default:()=>true},wh=()=>null,gue=(existing,incoming)=>incoming.params,bh=(existing,incoming)=>incoming;
${named(reducerAst,'azraelMergeRootResumeWait').getText(reducerAst)}
${merge}
return fixtureMerge;})();
window.fixtureNow=20000;Date.now=()=>fixtureNow;
window.fixtureState={old:{turnId:'old',status:'inProgress',turnStartedAtMs:12000,durationMs:null,items:[],params:{}},current:null};
window.fixtureDefer=()=>{fixtureState.old={...fixtureState.old,status:'deferred',durationMs:8000,rootResumeWait:{reservationId:'r1',revision:1,waitStartedAtMs:20000,waitEndedAtMs:null,resumeAtMs:80000,state:'waiting',canWakeEarly:false}};fixtureRerender()};
window.fixtureStale=resume=>{fixtureState.old=fixtureMergeSnapshot(fixtureState.old,{...fixtureState.old,status:'inProgress',durationMs:99000,rootResumeWait:null},{isResumeSnapshot:resume});fixtureRerender()};
window.fixtureResume=()=>{fixtureState.old={...fixtureState.old,rootResumeWait:{...fixtureState.old.rootResumeWait,state:'resumed',revision:2,waitEndedAtMs:fixtureNow}};fixtureState.current={status:'inProgress',turnStartedAtMs:fixtureNow};fixtureRerender()};
function Fixture(){HFi();const [,update]=VFi.useState(0);window.fixtureRerender=()=>update(n=>n+1);const old=fixtureState.old;const projected=old.status==='inProgress'?[Kmt({status:'in_progress',hasStartedWork:true,workStartedAtMs:old.turnStartedAtMs,workedCompletedAtMs:null})]:Hgt({items:[],status:old.status,workStartedAtMs:old.turnStartedAtMs,finalAssistantStartedAtMs:jgt(old),rootResumeWait:old.rootResumeWait});return k7.jsxs('div',{children:[k7.jsx('div',{'data-fixture-old':'',children:projected.map((item,i)=>k7.jsx(fixtureDivider,item,i))},document.documentElement.dataset.theme),fixtureState.current&&k7.jsx('div',{'data-fixture-new':'',children:k7.jsx(fixtureDivider,Kmt({status:'in_progress',hasStartedWork:true,workStartedAtMs:fixtureState.current.turnStartedAtMs,workedCompletedAtMs:null}))})]})}
export {Fixture};`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-668342ae9abd.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5e7be244bca.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto flex w-full max-w-3xl flex-col p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {KEt,UEt} from '/assets/app-initial-efe028fd535e.js';import {Fixture} from '/assets/${mainName}';const $=KEt();window.reactRoot=UEt().createRoot(document.getElementById('root'));reactRoot.render($.jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);if(pathname===join(assets,mainName))source=main+adapterSource;res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Pinned production deferred work divider, clock hook and snapshot merge rendered with native React/CSS in light/dark; synthetic host/localization and advanced clock. No installed app or release build.',checks:[]},pending=new Map(),exceptions=[];
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
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixtureNow=20000;fixtureState={old:{turnId:'old',status:'inProgress',turnStartedAtMs:12000,durationMs:null,items:[],params:{}},current:null};fixtureRerender()`);
  await wait("document.querySelector('[data-fixture-old]').innerText.includes('Working')");
  const active=await oldText();await advance(3000);check(theme+' active work clock ticks',(await oldText())!==active);
  await evaluate('fixtureNow=20000;fixtureDefer()');await wait("document.querySelector('[data-fixture-old]').innerText.includes('Worked for 8s')");
  await advance(4000);check(theme+' waiting ticks independently',(await oldText()).includes('현재 4초 대기함'));
  check(theme+' old work freezes',(await oldText()).includes('Worked for 8s'));
  for(const resume of [false,true]){await evaluate('fixtureStale('+resume+')');await advance(3000);check(theme+' stale snapshot '+resume+' keeps deferred clock',await evaluate("fixtureState.old.status==='deferred'&&fixtureState.old.durationMs===8000")&&(await oldText()).includes('Worked for 8s'))}
  await screenshot(theme+'-waiting');
  await evaluate('fixtureResume()');await wait("document.querySelector('[data-fixture-old]').innerText.includes('10초 대기 후 재개됨')");
  const ended=await oldText();const newText=await evaluate("document.querySelector('[data-fixture-new]').innerText");await advance(5000);
  check(theme+' resumed wait and old work stay fixed',(await oldText())===ended);
  check(theme+' new work clock ticks',await evaluate("document.querySelector('[data-fixture-new]').innerText")!==newText);
  const style=await evaluate("(()=>{const e=document.querySelector('[data-fixture-old] span'),s=getComputedStyle(e),line=document.querySelector('[data-fixture-old] .border-t');return {color:s.color,font:s.fontFamily,height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,line:getComputedStyle(line).borderTopWidth}})()");
  check(theme+' native divider geometry',style.height>10&&style.width>20&&style.line==='1px');summary[theme]={text:await oldText(),style};await screenshot(theme+'-resumed');
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
