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
const fixture=containedOutput(process.env.AZRAEL_RENDER_FIXTURE_ROOT,join(root,'artifacts/verification/capacity-retry-ui'),join(root,'artifacts/verification'));
const logs=containedOutput(process.env.AZRAEL_RENDER_LOG_ROOT,join(root,'artifacts/logs/capacity-retry-stop/render'),join(root,'artifacts/logs'));
const assets=join(root,'artifacts/upstream-ui/26.1007.21434/webview/assets'),profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);

const {injectCapacityRetryStop,CAPACITY_RETRY_ASSET}=require('./inject-capacity-retry-stop.cjs');
const ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const mainName=CAPACITY_RETRY_ASSET.split('/').at(-1);
const main=injectCapacityRetryStop(await readFile(join(assets,mainName),'utf8'),CAPACITY_RETRY_ASSET).text;
const ast=ts.createSourceFile(mainName,main,99,true,ts.ScriptKind.JS);
function adapt(name,replacements,newName){const owner=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(owner,name);let render=owner.getText(ast),edits=[];function visit(n){if(ts.isIdentifier(n)&&replacements[n.text]&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(ast)-owner.getStart(ast),end:n.end-owner.getStart(ast),text:replacements[n.text]});ts.forEachChild(n,visit)}visit(owner);for(const e of edits.sort((a,b)=>b.start-a.start))render=render.slice(0,e.start)+e.text+render.slice(e.end);return render.replace('function '+name+'(','function '+newName+'(')}
const controls=adapt('CNi',{Tme:'fixtureMode',ta:'fixtureScope',J:'fixtureRead',le:'fixtureIntl',SDe:'fixtureAdmit',COe:'fixtureRetry',ZTe:'fixtureRelease',pMn:'fixtureTimer',mNi:'FixtureRetry'},'FixtureControls');
const retry=adapt('mNi',{U:'FixtureMessage'},'FixtureRetry');
const adapterSource=`
window.fixtureState={turn:0};window.fixtureEvents=[];
const fixtureMode=()=>({activeMode:'default'});
const fixtureScope=()=>({get:()=> 'ready'}),fixtureRead=key=>key===EKe?{role:'owner'}:true,fixtureIntl=()=>({locale:'ko'}),fixtureAdmit=()=>true,fixtureRelease=()=>{};
function fixtureRetry(a,r,n,p){fixtureEvents.push(p);return Promise.resolve()}
function fixtureTimer(callback,delay){u7.useEffect(()=>{if(delay===null)return;const handle=setInterval(callback,delay);return()=>clearInterval(handle)},[callback,delay])}
function FixtureMessage({defaultMessage,values}){return defaultMessage.replace('{seconds}',values?.seconds??'')}
${retry}
${controls}
function Fixture(){kNi();const[,update]=u7.useState(0);window.fixtureRerender=()=>update(n=>n+1);return d7.jsx('div',{className:'p-4',children:d7.jsx(rp,{Icon:$5,content:d7.jsx('span',{children:'Selected model is at capacity. Please try a different model.'}),stackOnNarrow:true,customCtas:d7.jsx(FixtureControls,{conversationId:'chat',hostId:'local',turnId:'failed-'+fixtureState.turn,retryDelaySeconds:60},fixtureState.turn)})})}
export{Fixture};`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;html,body,#root{height:100%;margin:0}</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5b2ced5ef25.css"></head><body data-vscode-theme-kind="vscode-light"><div id="root"></div><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import{$At as KEt,XAt as UEt}from'/assets/app-initial-97d3534ad35f.js';import{Fixture}from'/assets/${mainName}';window.reactRoot=UEt().createRoot(document.getElementById('root'));reactRoot.render(KEt().jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);if(pathname===join(assets,mainName))source=main+adapterSource;res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Transformed capacity controls, native retry/button/card/React/CSS; synthetic host admission, localization and timer. Installed app and provider remain separate.',checks:[]},pending=new Map(),exceptions=[];
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

 await wait("window.fixtureReady && !!document.querySelector('[data-azrael-capacity-stop]')");
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixtureState.turn++;fixtureRerender()`);
  await wait("!!document.querySelector('[data-azrael-capacity-stop]')");
  const state=await evaluate("(()=>{const e=document.querySelector('[data-azrael-capacity-stop]'),s=getComputedStyle(e),r=e.getBoundingClientRect();return {color:s.color,background:s.backgroundColor,width:r.width,height:r.height,text:e.innerText}})()");
  check(theme+' native styled stop button',state.width>50&&state.height>=24&&state.text==='재시도 중단');summary[theme]=state;
  await writeFile(join(logs,theme+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  if(theme==='light')await evaluate("document.querySelector('[data-azrael-capacity-stop]').click()");
  else {
   await evaluate("document.querySelector('[data-azrael-capacity-stop]').focus()");
   await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'char',text:'\r',unmodifiedText:'\r',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  }
  await wait("!document.querySelector('[data-azrael-capacity-stop]')");
  check(theme+' stop preserves manual retry',await evaluate("fixtureEvents.length==="+(theme==='light'?0:1)+" && [...document.querySelectorAll('button')].some(e=>e.innerText==='Retry')"));
  await evaluate("[...document.querySelectorAll('button')].find(e=>e.innerText==='Retry').click()");
  await wait('fixtureEvents.length==='+ (theme==='light'?1:2));
  check(theme+' manual trigger preserved',await evaluate("fixtureEvents.at(-1).turnTrigger==='capacity_retry_manual'"));
 }
 check('theme foreground changes',summary.light.color!==summary.dark.color);
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:700,deviceScaleFactor:1,mobile:false});
 await evaluate('fixtureState.turn++;fixtureRerender()');await wait("!!document.querySelector('[data-azrael-capacity-stop]')");
 check('narrow card has no horizontal overflow',await evaluate('document.body.scrollWidth<=360'));
 await writeFile(join(logs,'narrow.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
 if(chrome&&chrome.exitCode===null&&chrome.signalCode===null)await new Promise(r=>{const t=setTimeout(r,30000);chrome.once('exit',()=>{clearTimeout(t);r()})});
 const browserExited=chrome!=null&&(chrome.exitCode!==null||chrome.signalCode!==null);
 if(browserExited){const cleaned=spawnSync('powershell.exe',['-NoProfile','-Command','$taskFixture = $env:AZRAEL_CAPACITY_FIXTURE; Remove-Item -LiteralPath $taskFixture -Recurse; if (Test-Path -LiteralPath $taskFixture) { exit 1 }'],{windowsHide:true,env:{...process.env,AZRAEL_CAPACITY_FIXTURE:fixture},encoding:'utf8'});if(cleaned.status!==0)throw Error('Fixture cleanup failed: '+cleaned.stderr);summary.cleanup='Owned browser exited; contained fixture/profile removed'}else{summary.cleanup='Browser exit uncertain; profile retained until confirmed closed';process.exitCode=1}
 summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
