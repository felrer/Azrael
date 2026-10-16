import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function containedOutput(value,fallback,allowed){
 const candidate=resolve(value||fallback),within=relative(allowed,candidate);
 if(!within||within==='..'||within.startsWith('..'+sep)||isAbsolute(within))throw Error('Render output must be contained beneath '+allowed);
 return candidate;
}
const run=containedOutput(process.env.AZRAEL_RENDER_RUN_ROOT,join(root,'artifacts/tasks/error-specificity/runs/01'),join(root,'artifacts/tasks'));
const fixture=containedOutput(process.env.AZRAEL_RENDER_FIXTURE_ROOT,join(run,'temporary/error-render'),join(run,'temporary'));
const logs=containedOutput(process.env.AZRAEL_RENDER_LOG_ROOT,join(run,'reports/error-render'),join(run,'reports'));
const assets=join(root,'artifacts/upstream-ui/26.1007.21434/webview/assets'),profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);

const {injectErrorPresentation,ERROR_PRESENTATION_ASSET}=require('./inject-error-presentation.cjs');
const ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const scriptHash=createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const mainName='app-initial-c014f9ee4429.js';
const main=await readFile(join(assets,mainName),'utf8');
const selector=injectErrorPresentation(await readFile(join(root,'artifacts/upstream-ui/26.1007.21434',ERROR_PRESENTATION_ASSET),'utf8'),ERROR_PRESENTATION_ASSET).text;
const ast=ts.createSourceFile('transformed-error-selector.js',selector,99,true,ts.ScriptKind.JS);
function declaration(name){const owner=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(owner,name);return owner.getText(ast)}
const selectorSource=declaration('Zdn').replace('function Zdn(', 'function FixtureNativeErrorSelect(').replaceAll('yNe(','fixtureParse(').replaceAll('utn(','fixturePolicy(').replaceAll(',Qdn',',undefined');
const adapterSource=`
window.fixtureCases=[
 {id:'unknown',message:'SECRET_UNKNOWN raw connection timeout login',errorInfo:'other'},
 {id:'legacy',message:'rate limit exceeded: Provider request rate limit reached. Try again later.',errorInfo:'rateLimitExceeded'},
 {id:'rate',message:'rate limit exceeded: 모델 입력 토큰 처리량 제한에 도달했습니다.',errorInfo:'rateLimitExceeded'},
 {id:'auth',message:'SECRET_AUTH',errorInfo:'unauthorized'},
 {id:'usage',message:'SECRET_USAGE',errorInfo:'usageLimitExceeded'},
 {id:'account',message:'The provider account requires reauthentication. Work was stopped. Sign in again or select a healthy account before continuing.',errorInfo:'badRequest'},
 {id:'refusal',message:'Fatal error: 모델 제공자가 응답을 거부했습니다. (provider_refusal)',errorInfo:'other'},
 {id:'image',message:'Attached images exceed the provider request limit. Remove images or start a new thread.',errorInfo:'badRequest'},
 {id:'wrapped',message:JSON.stringify({error:{message:'SECRET_WRAPPED'}}),errorInfo:'other'},
 {id:'retry',message:'SECRET_RETRY',errorInfo:'other',willRetry:true},
 {id:'misalignment',message:'SECRET_POLICY',errorInfo:'misalignmentPolicyViolation'},
 {id:'policy',message:'fixture-policy-block',errorInfo:'other'}
];
function fixtureParse(message){try{const data=JSON.parse(message);return typeof data?.error?.message==='string'?{success:true,data}:{success:false}}catch{return{success:false}}}
function fixturePolicy({message}){return message==='fixture-policy-block'?'bio':null}
${declaration('azraelDescribeConversationError')}
${selectorSource}
window.fixtureSelect=FixtureNativeErrorSelect;
function Fixture(){kNi();return d7.jsx('div',{children:fixtureCases.map(value=>{const message=FixtureNativeErrorSelect(value);return message===null?null:d7.jsx('div',{'data-error-case':value.id,className:'p-4',children:d7.jsx(rp,{Icon:$5,content:d7.jsx('span',{children:message}),stackOnNarrow:true})},value.id)})})}
export{Fixture};`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;html,body,#root{height:100%;margin:0}</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5b2ced5ef25.css"></head><body data-vscode-theme-kind="vscode-light"><div id="root"></div><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import{$At as KEt,XAt as UEt}from'/assets/app-initial-97d3534ad35f.js';import{Fixture}from'/assets/${mainName}';window.reactRoot=UEt().createRoot(document.getElementById('root'));reactRoot.render(KEt().jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);if(pathname===join(assets,mainName))source=main+adapterSource;res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Actual transformed Zdn selector and native system-error card/React/CSS. Synthetic JSON parser and policy adapters; no installed app or provider acceptance.',scriptHash,checks:[]},pending=new Map(),exceptions=[];
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

 await wait("window.fixtureReady && !!document.querySelector('[data-error-case=unknown]')");
 const expected={unknown:'정의되지 않은 오류',legacy:'정의되지 않은 오류',rate:'모델 입력 토큰 처리량 제한에 도달했습니다.',auth:'The selected provider rejected authentication. Check account authentication before resuming.',usage:'The provider usage limit was reached. Check account usage before resuming.',account:'The provider account requires reauthentication. Work was stopped. Sign in again or select a healthy account before continuing.',refusal:'모델 제공자가 응답을 거부했습니다. (provider_refusal)',image:'Attached images exceed the provider request limit. Remove images or start a new thread.',wrapped:'정의되지 않은 오류'};
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}'`);
  const state=await evaluate(`(()=>{const result={};for(const node of document.querySelectorAll('[data-error-case]')){const card=node.firstElementChild;const style=getComputedStyle(card),bounds=card.getBoundingClientRect();result[node.dataset.errorCase]={text:node.innerText,color:style.color,background:style.backgroundColor,width:bounds.width,height:bounds.height}}return {cards:result,body:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
  for(const [id,text]of Object.entries(expected)){check(theme+' '+id+' exact native card text',state.cards[id]?.text===text);check(theme+' '+id+' visible native card',state.cards[id].width>100&&state.cards[id].height>=24)}
  check(theme+' raw secrets excluded',!state.body.includes('SECRET_'));
  check(theme+' retry and policy cards suppressed',['retry','misalignment','policy'].every(id=>!state.cards[id]));
  check(theme+' no horizontal overflow',!state.overflow);summary[theme]=state.cards;
  await writeFile(join(logs,theme+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 check('native foreground follows theme',summary.light.unknown.color!==summary.dark.unknown.color);
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:950,deviceScaleFactor:1,mobile:false});
 check('narrow native cards have no horizontal overflow',await evaluate('document.documentElement.scrollWidth<=360'));
 await writeFile(join(logs,'narrow.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 check('retry and both policy filters return null',await evaluate("fixtureCases.filter(e=>['retry','misalignment','policy'].includes(e.id)).every(e=>fixtureSelect(e)===null)"));
 check('script input unchanged',createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex')===scriptHash);
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
 if(chrome&&chrome.exitCode===null&&chrome.signalCode===null)await new Promise(r=>{const t=setTimeout(r,30000);chrome.once('exit',()=>{clearTimeout(t);r()})});
 const browserExited=chrome!=null&&(chrome.exitCode!==null||chrome.signalCode!==null);
 if(browserExited){const cleaned=spawnSync('powershell.exe',['-NoProfile','-Command','$taskFixture = [IO.Path]::GetFullPath($env:AZRAEL_ERROR_FIXTURE); $taskParent = [IO.Path]::GetFullPath($env:AZRAEL_ERROR_TEMP_ROOT); if ([IO.Path]::GetDirectoryName($taskFixture) -ne $taskParent) { throw "Fixture containment failed" }; Remove-Item -LiteralPath $taskFixture -Recurse; if (Test-Path -LiteralPath $taskFixture) { exit 1 }'],{windowsHide:true,env:{...process.env,AZRAEL_ERROR_FIXTURE:fixture,AZRAEL_ERROR_TEMP_ROOT:join(run,'temporary')},encoding:'utf8'});if(cleaned.status!==0)throw Error('Fixture cleanup failed: '+cleaned.stderr);summary.cleanup='Owned browser exited; contained fixture/profile removed'}else{summary.cleanup='Browser exit uncertain; profile retained until confirmed closed';process.exitCode=1}
 summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
