import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fixture=join(root,'artifacts/verification/astra-ultrafast-ui');
const logs=join(root,'artifacts/logs/astra-ultrafast/ui');
const assets=join(root,'artifacts/upstream-ui/26.930.61225/webview/assets');
const profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);
const ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const {injectProviderModelPicker,PROVIDER_PICKER_ASSET}=require('./inject-provider-model-picker.cjs');
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const mainName='app-initial-532d60c9b397.js';
const main=injectProviderModelPicker(await readFile(join(assets,mainName),'utf8'),PROVIDER_PICKER_ASSET).text;
const ast=ts.createSourceFile('main.js',main,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const owner=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='sQi');
assert.ok(owner,'Pinned speed controls');
let render=owner.getText(ast),edits=[];
function visit(n){if(ts.isIdentifier(n)&&['_d','Q'].includes(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(ast)-owner.getStart(ast),end:n.end-owner.getStart(ast),text:n.text==='_d'?'fixtureIntl':'FixtureMessage'});ts.forEachChild(n,visit)}
visit(owner);for(const e of edits.sort((a,b)=>b.start-a.start))render=render.slice(0,e.start)+e.text+render.slice(e.end);
render=render.replace('function sQi(','function fixtureSpeedControls(');
// Only localization and host state are adapted. The production transformed
// controls, native menu item, icons, React and theme CSS are rendered unchanged.
const adapterSource=`

const fixtureIntl=()=>({formatMessage:({defaultMessage})=>defaultMessage});
function FixtureMessage({defaultMessage}){return defaultMessage}
${render}
window.fixtureState={model:'gpt-6-astra',tier:null,loading:false};window.fixtureEvents=[];
function Fixture(){pQi();const [,update]=fQi.useState(0);window.fixtureRerender=()=>update(n=>n+1);const state=window.fixtureState;return G8.jsx(Xz,{open:true,onOpenChange(){},triggerButton:G8.jsx('button',{children:'Model'}),contentClassName:z8.Menu,children:G8.jsx(fixtureSpeedControls,{selectedPowerSelection:{model:state.model,reasoningEffort:'medium',labels:{model:state.model==='gpt-6-astra'?'Astra':'Sol',effort:'Medium'}},selectedServiceTier:state.tier,serviceTierOptions:[{value:null,iconKind:null},{value:'priority',iconKind:'fast',speedMultiplier:1.5},...(state.model==='gpt-6-astra'?[{value:'ultrafast',iconKind:'ultrafast'}]:[])],serviceTierOptionsLoading:state.loading,onSelectServiceTier:value=>{state.tier=value;window.fixtureEvents.push(value);window.fixtureRerender()},onToggle(){},isExplicitModelSelection:true})})}
export {Fixture};`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-668342ae9abd.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5e7be244bca.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto flex w-full max-w-3xl flex-col p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {KEt,UEt} from '/assets/app-initial-efe028fd535e.js';import {Fixture} from '/assets/${mainName}';const $=KEt();window.reactRoot=UEt().createRoot(document.getElementById('root'));reactRoot.render($.jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);if(pathname===join(assets,mainName))source=main+adapterSource;res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Production transformed Astra controls, native menu item, React and CSS in light/dark; synthetic host/localization. No build, installed app or model requests.',checks:[]},pending=new Map(),exceptions=[];
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
 await wait("window.fixtureReady && !!document.querySelector('[data-azrael-astra-speed]')");
 const button=()=>evaluate("(()=>{const e=document.querySelector('[data-azrael-astra-speed]'),s=getComputedStyle(e),icon=getComputedStyle(e.querySelector('svg'));return {mode:e.dataset.azraelAstraSpeed,label:e.getAttribute('aria-label'),role:e.getAttribute('role'),color:s.color,background:s.backgroundColor,iconColor:icon.color,disabled:e.getAttribute('aria-disabled'),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}})()");
 const click=()=>evaluate("document.querySelector('[data-azrael-astra-speed]').click()");
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixtureState.tier=null;fixtureRerender()`);
  await wait("document.querySelector('[data-azrael-astra-speed]').dataset.azraelAstraSpeed==='default'");
  const standard=await button();check(theme+' standard native geometry',standard.role==='menuitem'&&standard.width>15&&standard.height>15);
  await click();await wait("fixtureState.tier==='priority'");check(theme+' fast mode',(await button()).mode==='fast');
  await click();await wait("fixtureState.tier==='ultrafast'");const ultra=await button();check(theme+' ultrafast purple icon/background',ultra.color===ultra.iconColor&&ultra.color!==standard.color&&ultra.background!==standard.background);
  summary[theme]={standard,ultrafast:ultra};
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:990,y:940});
  await writeFile(join(logs,theme+'-ultrafast.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("document.querySelector('[data-azrael-astra-speed]').focus()");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait("fixtureState.tier===null");check(theme+' keyboard returns to standard',(await button()).mode==='default');
 }
 await evaluate("fixtureState.loading=true;fixtureRerender()");await wait("document.querySelector('[data-azrael-astra-speed]').getAttribute('aria-disabled')==='true'");await click();check('loading prevents mutation',await evaluate('fixtureState.tier===null'));
 await evaluate("fixtureState.loading=false;fixtureState.model='gpt-6.1-sol';fixtureRerender()");await wait("!document.querySelector('[data-azrael-astra-speed]')");check('other model keeps native two-state control',await evaluate("!!document.querySelector('[role=menuitemcheckbox]')"));
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);summary.events=await evaluate('fixtureEvents');summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
 if(chrome?.exitCode===null)await new Promise(r=>{const t=setTimeout(r,5000);chrome.once('exit',()=>{clearTimeout(t);r()})});
 const allowed=join(root,'artifacts/verification')+sep;
 if(chrome?.exitCode!==null&&fixture.startsWith(allowed)){await rm(fixture,{recursive:true,force:true,maxRetries:5,retryDelay:200});summary.cleanup='Owned browser exited; guarded fixture/profile removed'}else{summary.cleanup='Browser exit uncertain; profile retained until confirmed closed';process.exitCode=1}
 summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
