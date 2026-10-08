import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fixture=join(root,'artifacts/verification/context-compaction-ui');
const logs=join(root,'artifacts/logs/context-compaction/ui');
const assets=join(root,'artifacts/upstream-ui/26.930.61225/webview/assets');
const profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);
const ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const {injectProviderContext,CONTEXT_ASSET}=require('./inject-provider-context.cjs');
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const mainName='app-initial-532d60c9b397.js';
const main=injectProviderContext(await readFile(join(assets,mainName),'utf8'),CONTEXT_ASSET).text;
const ast=ts.createSourceFile('main.js',main,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function adapt(name,replacements,newName){const owner=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(owner,name);let render=owner.getText(ast),edits=[];function visit(n){if(ts.isIdentifier(n)&&replacements[n.text]&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(ast)-owner.getStart(ast),end:n.end-owner.getStart(ast),text:replacements[n.text]});ts.forEachChild(n,visit)}visit(owner);for(const e of edits.sort((a,b)=>b.start-a.start))render=render.slice(0,e.start)+e.text+render.slice(e.end);return render.replace('function '+name+'(','function '+newName+'(')}
const native=adapt('__azraelNativeContextGauge',{_d:'fixtureIntl',Q:'FixtureMessage',_f:'FixtureNumber'},'fixtureNativeGauge');
const wrapper=adapt('cra',{_d:'fixtureIntl',Wl:'fixtureWl',Hx:'fixtureHx',__azraelNativeContextGauge:'fixtureNativeGauge'},'fixtureGauge');
// Only host/store and localization are adapted. The transformed card/action,
// native gauge, hover card, button, React and pinned theme CSS render directly.
const adapterSource=`
const fixtureIntl=()=>({locale:window.fixtureState.locale,formatMessage:({defaultMessage},values)=>defaultMessage.replace('{percent}',values?.percent??''),formatNumber:x=>String(x)});
function FixtureMessage({defaultMessage}){return defaultMessage}
function FixtureNumber({value}){return value}
window.fixtureState={id:'chat-a',locale:'en',mode:'pending'};window.fixtureEvents=[];window.fixtureSubmits=0;
const fixtureStore={get(atom,id){return 'local'}};
const fixtureWl=()=>fixtureStore;
const fixtureHx=(store,host)=>({compactThread(...args){window.fixtureEvents.push({args,host});if(fixtureState.mode==='error')return Promise.reject(Error('synthetic failure'));return new Promise(resolve=>window.fixtureResolve=resolve)}});
${native}
${wrapper}
const policy={providerId:'openai',modelId:'gpt-6-astra',contextWindow:400000,safeContextWindow:380000,autoCompactTokenLimit:361000,inputTokens:272001,inputTokensEstimated:true,pricing:{status:'confirmed',inputTokenThreshold:272000,sourceUrl:'https://example.com/pricing'}};
function Fixture(){dra();const React=ad(),[,update]=React.useState(0);window.fixtureRerender=()=>update(n=>n+1);return _7.jsxs('form',{onSubmit:e=>{e.preventDefault();fixtureSubmits++},className:'flex flex-col gap-4',children:[_7.jsx('textarea',{'aria-label':'Draft',defaultValue:'Unsent draft',className:'border p-3'}),_7.jsx('div',{'data-attachment':'image.png',children:'image.png'}),_7.jsx(fixtureGauge,{conversationId:fixtureState.id,contextUsage:{percent:68,usedTokens:272001,contextWindow:400000,contextPolicy:policy}})]})}
export {Fixture};`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-668342ae9abd.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5e7be244bca.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto flex w-full max-w-3xl flex-col p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {KEt,UEt} from '/assets/app-initial-efe028fd535e.js';import {Fixture} from '/assets/${mainName}';const $=KEt();window.reactRoot=UEt().createRoot(document.getElementById('root'));reactRoot.render($.jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);if(pathname===join(assets,mainName))source=main+adapterSource;res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Production transformed context hover card, native gauge/button/React/CSS in light/dark; synthetic host/localization. No build or model requests.',checks:[]},pending=new Map(),exceptions=[];
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
 await wait("window.fixtureReady && !!document.querySelector('[data-azrael-pricing-boundary]')");
 const open=async()=>{await evaluate("document.querySelector('[data-azrael-pricing-boundary]').focus()");await wait("document.querySelector('[data-azrael-context-compaction]')?.dataset.azraelContextCompaction===(fixtureState.id??'') && !!document.querySelector('[data-azrael-context-compaction] button')")};
 const card=()=>evaluate("(()=>{const e=document.querySelector('[data-azrael-context-compaction]'),b=e.querySelector('button'),s=getComputedStyle(b);return {text:e.innerText,disabled:b.disabled,type:b.type,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,color:s.color,background:s.backgroundColor}})()");
 const click=()=>evaluate("document.querySelector('[data-azrael-context-compaction] button').click()");
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixtureState.id='chat-${theme}';fixtureState.locale='en';fixtureState.mode='pending';fixtureRerender()`);await open();
  const idle=await card();check(theme+' native button geometry and non-submit type',idle.type==='button'&&idle.width>80&&idle.height>20);summary[theme]={idle};
  await click();await wait("document.querySelector('[data-azrael-context-compaction] button').disabled");check(theme+' visible pending status',(await card()).text.includes('Requesting compaction'));await click();check(theme+' duplicate guard',await evaluate(`fixtureEvents.filter(e=>e.args[0]==='chat-${theme}').length===1`));
  await evaluate('fixtureResolve()');await wait("document.querySelector('[data-azrael-context-compaction]').innerText.includes('Compaction requested')");
  await writeFile(join(logs,theme+'-card.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("fixtureState.mode='error';fixtureRerender()");await click();await wait("document.querySelector('[data-azrael-context-compaction] [role=alert]')?.innerText.includes('failed')");check(theme+' error and retry affordance',(await card()).text.includes('Retry compaction'));
  await evaluate("fixtureState.mode='pending';fixtureRerender()");await evaluate("document.querySelector('[data-azrael-context-compaction] button').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await open();await wait("document.querySelector('[data-azrael-context-compaction] button')?.disabled");await evaluate('fixtureResolve()');
  check(theme+' draft attachments and no submit',await evaluate("document.querySelector('textarea').value==='Unsent draft'&&document.querySelector('[data-attachment]').dataset.attachment==='image.png'&&fixtureSubmits===0"));
 }
 await evaluate("fixtureState.id=null;fixtureState.locale='ko-KR';fixtureRerender()");await open();await wait("document.querySelector('[data-azrael-context-compaction]').innerText.includes('대화를 선택')");check('missing ID disabled localized control',(await card()).disabled);
 summary.events=await evaluate('fixtureEvents');check('ID-only RPC',summary.events.every(e=>e.args.length===1&&typeof e.args[0]==='string'));
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
 if(chrome?.exitCode===null)await new Promise(r=>{const t=setTimeout(r,5000);chrome.once('exit',()=>{clearTimeout(t);r()})});
 const allowed=join(root,'artifacts/verification')+sep;
 if(chrome?.exitCode!==null&&fixture.startsWith(allowed)){
  await writeFile(join(fixture,'check-result.json'),JSON.stringify({passed:summary.outcome==='passed',scope:summary.scope,checks:summary.checks})+'\n');
  const cleanup=async apply=>{const report=join(logs,apply?'cleanup-result.json':'cleanup-preview.json');const proc=spawn('pwsh',['-NoProfile','-Command','& $env:AZRAEL_CARD_CLEANUP_SCRIPT -ProjectRoot $env:AZRAEL_CARD_PROJECT -FixtureRoot $env:AZRAEL_CARD_FIXTURE -IncludeDiagnosedFixtures '+(apply?'-Apply ':'')+'-ReportPath $env:AZRAEL_CARD_REPORT'],{windowsHide:true,env:{...process.env,AZRAEL_CARD_CLEANUP_SCRIPT:join(root,'scripts/clean-verification-artifacts.ps1'),AZRAEL_CARD_PROJECT:root,AZRAEL_CARD_FIXTURE:fixture,AZRAEL_CARD_REPORT:report},stdio:['ignore','pipe','pipe']});let output='';proc.stdout.on('data',c=>output+=c);proc.stderr.on('data',c=>output+=c);const exit=await new Promise((r,j)=>{proc.once('error',j);proc.once('exit',r)});await writeFile(join(logs,apply?'cleanup.log':'cleanup-preview.log'),output);assert.equal(exit,0,'cleanup script exit');return JSON.parse(await readFile(report,'utf8'))};
  try { const preview=await cleanup(false);assert.equal(preview.candidates[0]?.status,'selected','owned fixture selected by guarded cleanup');const result=await cleanup(true);assert.equal(result.candidates[0]?.status,'deleted','owned fixture deleted');assert.equal(await access(fixture).then(()=>true,()=>false),false,'fixture/profile absent');summary.cleanup='Owned browser exited; project guarded cleanup removed fixture/profile'; }
  catch(e){summary.cleanup=String(e);process.exitCode=1}
 }else{summary.cleanup='Browser exit uncertain; profile retained until confirmed closed';process.exitCode=1}
 summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
