import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const containedPath=(value,parent,label)=>{const target=resolve(root,value),allowed=resolve(root,parent)+sep;assert.ok(target.toLowerCase().startsWith(allowed.toLowerCase()),label+' must be a descendant of '+parent);return target};
const fixture=containedPath(process.env.AZRAEL_RENDER_FIXTURE_ROOT||'artifacts/verification/compaction-skip-ui','artifacts/verification','Renderer fixture');
const logs=containedPath(process.env.AZRAEL_RENDER_LOG_ROOT||'artifacts/logs/compaction-skip/ui','artifacts/logs','Renderer logs');
const assets=join(root,"artifacts/upstream-ui/26.1007.21434/webview/assets");
const profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);
const ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const {injectQueuedCompactionPresentation,COMPACTION_SKIPPED_MESSAGE}=require('./inject-queued-compaction.cjs');
const {injectQueueRefresh}=require('./inject-queue-refresh.cjs');
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const mainName="app-initial-7a199c66e670.js";
const main=injectQueuedCompactionPresentation(injectQueueRefresh(await readFile(join(assets,mainName),'utf8')).text).text;
const ast=ts.createSourceFile('main.js',main,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function adapt(name,replacements,newName){const owner=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(owner,name);let render=owner.getText(ast),edits=[];function visit(n){if(ts.isIdentifier(n)&&replacements[n.text]&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(ast)-owner.getStart(ast),end:n.end-owner.getStart(ast),text:replacements[n.text]});ts.forEachChild(n,visit)}visit(owner);for(const e of edits.sort((a,b)=>b.start-a.start))render=render.slice(0,e.start)+e.text+render.slice(e.end);return render.replace('function '+name+'(','function '+newName+'(')}
const alert=adapt('xBr',{st:'fixtureIntl'},'fixtureNativeAlert');
const notice=adapt('kBr',{xBr:'fixtureNativeAlert'},'fixtureNativeNotice');
const adapterSource=`
const fixtureIntl=()=>({locale:window.fixtureLocale,formatMessage:({defaultMessage})=>defaultMessage});
window.fixtureLocale='ko-KR';window.fixtureClosed=0;
${alert}
${notice}
let nativeToast,releaseViewport;
function initializeFixture(){if(nativeToast)return;MBr();gx();CXa();nativeToast=HMt('fixture-compaction',fixtureNativeNotice);
releaseViewport=nativeToast.registerViewport();window.fixtureInitialized=true;}
const fixtureScope={get(atom){if(atom===hx)return nativeToast;if(atom===fm)return fixtureIntl();if(atom===bXa)return false;throw Error('Unexpected fixture atom')}};
window.fixtureNotify=()=>_Xa(fixtureScope,{hostId:'fixture',method:'warning',params:{threadId:'fixture-thread',message:${JSON.stringify(COMPACTION_SKIPPED_MESSAGE)}}});
window.fixtureCleanup=()=>{nativeToast.closeAll();releaseViewport()};
function Fixture(){initializeFixture();return nY.jsx(Pr,{id:'fixture-compaction',containerAriaLabel:'Notifications',position:'top-center',visibleToasts:3,toastOptions:{unstyled:true}})}
export {Fixture};`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5b2ced5ef25.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto flex w-full max-w-3xl flex-col p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {$At,XAt} from '/assets/app-initial-97d3534ad35f.js';import {Fixture} from '/assets/${mainName}';const $=$At();window.reactRoot=XAt().createRoot(document.getElementById('root'));reactRoot.render($.jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);if(pathname===join(assets,mainName))source=main+adapterSource;res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Production compaction warning handler, native toast/React/CSS in light/dark; synthetic transport/store/localization. No product build or model requests.',checks:[]},pending=new Map(),exceptions=[];
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
 await wait("window.fixtureReady && window.fixtureInitialized");
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixtureLocale='ko-KR';fixtureNotify()`);
  await wait("document.querySelector('[data-sonner-toast]')?.innerText.includes('압축을 실행하지 않았습니다')");
  await wait("(()=>{const e=document.querySelector('[data-sonner-toast]');return e&&e.getBoundingClientRect().top>=0&&Number(getComputedStyle(e).opacity)>=0.99})()");
  const state=await evaluate("(()=>{const e=document.querySelector('[data-sonner-toast]'),r=e.getBoundingClientRect(),s=getComputedStyle(e.firstElementChild);return {text:e.innerText,width:r.width,height:r.height,color:s.color,background:s.backgroundColor,close:!!e.querySelector('button')}})()");
  check(theme+' localized native warning and reason',state.text.includes('15% 미만')&&state.width>100&&state.height>30&&state.close);summary[theme]=state;
  await writeFile(join(logs,theme+'-notice.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("document.querySelector('[data-sonner-toast] button').focus()");
  check(theme+' keyboard-focusable dismiss',await evaluate("document.activeElement===document.querySelector('[data-sonner-toast] button')"));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait("!document.querySelector('[data-sonner-toast]')");
  await evaluate("fixtureLocale='en';fixtureNotify()");await wait("document.querySelector('[data-sonner-toast]')?.innerText.includes('Context compaction was skipped')");
  check(theme+' repeated request and English reason',await evaluate("document.querySelector('[data-sonner-toast]').innerText.includes('below 15%')"));
  await evaluate("document.querySelector('[data-sonner-toast] button').click()");await wait("!document.querySelector('[data-sonner-toast]')");
 }
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);summary.outcome='passed';await evaluate('fixtureCleanup();reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
 if(chrome&&chrome.exitCode===null&&chrome.signalCode===null)await new Promise(r=>{const finish=()=>{clearTimeout(t);chrome.off('exit',finish);r()};const t=setTimeout(finish,10000);chrome.once('exit',finish)});
 const allowed=join(root,'artifacts/verification')+sep;
 if(chrome&&(chrome.exitCode!==null||chrome.signalCode!==null)&&fixture.toLowerCase().startsWith(allowed.toLowerCase())){
  await writeFile(join(fixture,'check-result.json'),JSON.stringify({passed:summary.outcome==='passed',scope:summary.scope,checks:summary.checks})+'\n');
  const cleanup=async apply=>{const report=join(logs,apply?'cleanup-result.json':'cleanup-preview.json');const proc=spawn('pwsh',['-NoProfile','-Command','& $env:AZRAEL_CARD_CLEANUP_SCRIPT -ProjectRoot $env:AZRAEL_CARD_PROJECT -FixtureRoot $env:AZRAEL_CARD_FIXTURE -IncludeDiagnosedFixtures '+(apply?'-Apply ':'')+'-ReportPath $env:AZRAEL_CARD_REPORT'],{windowsHide:true,env:{...process.env,AZRAEL_CARD_CLEANUP_SCRIPT:join(root,'scripts/clean-verification-artifacts.ps1'),AZRAEL_CARD_PROJECT:root,AZRAEL_CARD_FIXTURE:fixture,AZRAEL_CARD_REPORT:report},stdio:['ignore','pipe','pipe']});let output='';proc.stdout.on('data',c=>output+=c);proc.stderr.on('data',c=>output+=c);const exit=await new Promise((r,j)=>{proc.once('error',j);proc.once('exit',r)});await writeFile(join(logs,apply?'cleanup.log':'cleanup-preview.log'),output);assert.equal(exit,0,'cleanup script exit');return JSON.parse(await readFile(report,'utf8'))};
  try { const preview=await cleanup(false);assert.equal(preview.candidates[0]?.status,'selected','owned fixture selected by guarded cleanup');const result=await cleanup(true);assert.equal(result.candidates[0]?.status,'deleted','owned fixture deleted');assert.equal(await access(fixture).then(()=>true,()=>false),false,'fixture/profile absent');summary.cleanup='Owned browser exited; project guarded cleanup removed fixture/profile'; }
  catch(e){summary.cleanup=String(e);process.exitCode=1}
 }else{summary.cleanup='Browser exit uncertain; profile retained until confirmed closed';process.exitCode=1}
 summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
