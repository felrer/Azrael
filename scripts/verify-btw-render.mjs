import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function containedOutput(value,fallback,allowed){
 const candidate=resolve(value||fallback),within=relative(allowed,candidate);
 if(!within||within==='..'||within.startsWith('..'+sep)||isAbsolute(within))throw Error('Render output must be contained beneath '+allowed);
 return candidate;
}
const fixture=containedOutput(process.env.AZRAEL_RENDER_FIXTURE_ROOT,join(root,'artifacts/verification/btw-ui'),join(root,'artifacts/verification'));
const logs=containedOutput(process.env.AZRAEL_RENDER_LOG_ROOT,join(root,'artifacts/logs/btw/render'),join(root,'artifacts/logs'));
const assets=join(root,'artifacts/upstream-ui/26.1007.21434/webview/assets'),profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);
const {injectBtw,BTW_ASSETS}=require('./inject-btw.cjs');
const {createBtwController}=require('./btw-conversation.cjs');
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const mainName=BTW_ASSETS[2].split('/').at(-1),main=injectBtw(await readFile(join(assets,mainName),'utf8'),BTW_ASSETS[2]).text;
const adapterSource=`
import {nLt as fixtureReact,$At as fixtureJsx} from './app-initial-97d3534ad35f.js';
${createBtwController.toString()}
const fixtureCallbacks=new Set();
window.fixtureState={running:false,messages:[{role:'assistant',text:'The retry policy keeps the task running. Only confirmed failures trigger recovery.'}],fail:false};
window.fixtureEvents=[];
window.fixtureManager={getConversation:id=>({threadRuntimeStatus:{type:fixtureState.running?'running':'idle'}}),readRecentThreadMessages:()=>fixtureState.messages,addConversationCallback:(_id,fn)=>{fixtureCallbacks.add(fn);return()=>fixtureCallbacks.delete(fn)},sendFollowUpMessage:async(id,{prompt})=>{fixtureEvents.push({id,prompt});if(fixtureState.fail)throw Error('Synthetic delivery failure')},copyEphemeralConversationHistory(){},sendRequest(){}};
window.fixtureController=createBtwController();
await fixtureController.submit({conversationId:'parent',hostId:'local',manager:fixtureManager,text:'/btw',openPanel:async o=>{await o.prepare('side');return 'side'}});
let jsx,React;
function FixtureChat(){return jsx.jsxs('article',{className:'flex flex-col gap-4 p-4 text-default',children:[jsx.jsx('p',{className:'text-sm text-secondary',children:'Synthetic native chat state'}),jsx.jsx('p',{id:'answer',children:fixtureState.messages[0]?.text??'No answer yet'}),jsx.jsx('p',{className:'text-sm text-secondary',children:'Main task continues independently.'})]})}
let FixturePanel;
function Fixture(){jsx??=fixtureJsx();React??=fixtureReact();__azraelInitBtwButton();FixturePanel??=createBtwPanel(React,jsx,__azraelBtwButton,FixtureChat,fixtureController);const[,update]=React.useState(0);window.fixtureRerender=()=>{update(n=>n+1);for(const fn of fixtureCallbacks)fn()};return jsx.jsx(FixturePanel,{conversationId:'side'})}
export{Fixture};`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;html,body,#root{height:100%;margin:0}</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5b2ced5ef25.css"></head><body data-vscode-theme-kind="vscode-light"><div id="root"></div><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import{$At as KEt,XAt as UEt}from'/assets/app-initial-97d3534ad35f.js';import{Fixture}from'/assets/${mainName}';window.reactRoot=UEt().createRoot(document.getElementById('root'));reactRoot.render(KEt().jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);if(pathname===join(assets,mainName))source=main+adapterSource;res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Production /btw panel wrapper, native button, React and CSS in light/dark; synthetic chat/host state. No build, installed app or model requests.',checks:[]},pending=new Map(),exceptions=[];
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
 await wait("window.fixtureReady && !!document.querySelector('[data-azrael-btw-panel] button')");
 const checkButton=()=>evaluate("(()=>{const e=document.querySelector('[data-azrael-btw-panel] button'),s=getComputedStyle(e),r=e.getBoundingClientRect();return {text:e.innerText,disabled:e.disabled,color:s.color,background:s.backgroundColor,width:r.width,height:r.height,font:s.fontFamily,bodyWidth:document.body.scrollWidth}})()");
 const click=()=>evaluate("document.querySelector('[data-azrael-btw-panel] button').click()");
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixtureState.running=false;fixtureState.fail=false;getSelection().removeAllRanges();fixtureRerender()`);
  const state=await checkButton();check(theme+' native styled control',state.width>100&&state.height>=24&&!state.disabled);summary[theme]=state;
  const before=await evaluate('fixtureEvents.length');await click();await wait("document.querySelector('[role=status]')?.innerText.includes('전달했습니다')");
  check(theme+' explicit answer transfer',await evaluate(`fixtureEvents.length===${before+1}&&fixtureEvents.at(-1).id==='parent'&&fixtureEvents.at(-1).prompt===fixtureState.messages[0].text`));
  await evaluate("(()=>{const e=document.getElementById('answer'),r=document.createRange();r.setStart(e.firstChild,0);r.setEnd(e.firstChild,16);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'))})()");
  await wait("document.querySelector('[data-azrael-btw-panel] button').innerText.includes('선택한')");await click();
  check(theme+' selected text transfer',await evaluate("fixtureEvents.at(-1).prompt===document.getElementById('answer').innerText.slice(0,16)"));
  await evaluate("getSelection().removeAllRanges();document.dispatchEvent(new Event('selectionchange'));fixtureState.running=true;fixtureRerender()");
  await wait("document.querySelector('[data-azrael-btw-panel] button').disabled");check(theme+' active side answer prevents transfer',(await checkButton()).disabled);
  await evaluate("fixtureState.running=false;fixtureState.fail=true;fixtureRerender()");await wait("!document.querySelector('[data-azrael-btw-panel] button').disabled");await click();await wait("document.querySelector('[role=status]')?.innerText==='Synthetic delivery failure'");
  check(theme+' failed delivery is visible and retry is manual',!(await checkButton()).disabled);
  await evaluate("fixtureState.fail=false;fixtureRerender()");await wait("!document.querySelector('[data-azrael-btw-panel] button').disabled");await evaluate("document.querySelector('[data-azrael-btw-panel] button').focus()");await wait("document.activeElement===document.querySelector('[data-azrael-btw-panel] button')");
  await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'char',text:'\r',unmodifiedText:'\r',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await wait("document.querySelector('[role=status]')?.innerText.includes('전달했습니다')");check(theme+' keyboard transfer',await evaluate("fixtureEvents.at(-1).id==='parent'"));
  await writeFile(join(logs,theme+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 check('theme foreground changes',summary.light.color!==summary.dark.color);
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:700,deviceScaleFactor:1,mobile:false});check('narrow panel has no horizontal overflow',(await checkButton()).bodyWidth<=360);
 await evaluate("fixtureState.messages=[];fixtureRerender()");await wait("document.querySelector('[data-azrael-btw-panel] button').disabled");check('empty answer prevents transfer',(await checkButton()).disabled);
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);summary.events=await evaluate('fixtureEvents');summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
 if(chrome&&chrome.exitCode===null&&chrome.signalCode===null)await new Promise(r=>{const t=setTimeout(r,10000);chrome.once('exit',()=>{clearTimeout(t);r()})});
 const browserExited=chrome!=null&&(chrome.exitCode!==null||chrome.signalCode!==null);
 if(browserExited){await rm(fixture,{recursive:true,maxRetries:5,retryDelay:200});summary.cleanup='Owned browser exited; guarded fixture/profile removed'}else{summary.cleanup='Browser exit uncertain; profile retained until confirmed closed';process.exitCode=1}
 summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
