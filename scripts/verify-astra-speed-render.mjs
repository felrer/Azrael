import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,rm,realpath} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const readmeCapture=process.env.AZRAEL_RENDER_README_CAPTURE==='1';
const fixture=resolve(process.env.AZRAEL_RENDER_FIXTURE_ROOT ?? join(root,'artifacts/verification/astra-ultrafast-ui'));
const logs=resolve(process.env.AZRAEL_RENDER_LOG_ROOT ?? join(root,'artifacts/logs/astra-ultrafast/ui'));
const assets=join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? join(root,'artifacts/upstream-ui/26.1007.21434'),'webview/assets');
assert.ok(fixture.startsWith(join(root,'artifacts/verification')+sep),'Fixture containment');
assert.ok(logs.startsWith(join(root,'artifacts/logs')+sep),'Log containment');
const profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);
const ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const {injectProviderModelPicker,PROVIDER_PICKER_ASSET}=require('./inject-provider-model-picker.cjs');
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const fixtureRealPath=await realpath(fixture),verificationRealPath=await realpath(join(root,'artifacts/verification'));
assert.ok(fixtureRealPath.startsWith(verificationRealPath+sep),'Real fixture containment');
const mainName='app-initial-7a199c66e670.js';
const main=injectProviderModelPicker(await readFile(join(assets,mainName),'utf8'),PROVIDER_PICKER_ASSET).text;
const ast=ts.createSourceFile('main.js',main,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const owner=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='esa');
assert.ok(owner,'Pinned speed controls');
let render=owner.getText(ast),edits=[];
function visit(n){if(ts.isIdentifier(n)&&['st','q'].includes(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(ast)-owner.getStart(ast),end:n.end-owner.getStart(ast),text:n.text==='st'?'fixtureIntl':'FixtureMessage'});ts.forEachChild(n,visit)}
visit(owner);for(const e of edits.sort((a,b)=>b.start-a.start))render=render.slice(0,e.start)+e.text+render.slice(e.end);
render=render.replace('function esa(','function fixtureSpeedControls(');
// Only localization and host state are adapted. The production transformed
// controls, native menu item, icons, React and theme CSS are rendered unchanged.
function localizedCopy(name){
 const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 assert.ok(node,'Pinned native '+name);let source=node.getText(ast);const changes=[];
 function walk(n){if(ts.isIdentifier(n)&&['st','q'].includes(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))changes.push({start:n.getStart(ast)-node.getStart(ast),end:n.end-node.getStart(ast),text:n.text==='st'?'fixtureIntl':'FixtureMessage'});ts.forEachChild(n,walk)}
 walk(node);for(const change of changes.sort((a,b)=>b.start-a.start))source=source.slice(0,change.start)+change.text+source.slice(change.end);return source;
}
const readmeAdapterSource=readmeCapture?`
const fixtureIntl=()=>({formatMessage:({defaultMessage})=>defaultMessage});
function FixtureMessage({defaultMessage}){return defaultMessage}
window.fixtureState={model:'gpt-6-astra'};window.fixtureEvents=[];
const Fixture=(()=>{
${['ssa','esa','Doa'].map(localizedCopy).join('\n')}
return function Fixture(){FR();fsa();const [,update]=G8.useState(0);window.fixtureRerender=()=>update(n=>n+1);const options=[{id:'gpt-6-astra',label:'Astra',subText:'gpt-6-astra'},{id:'managed/anthropic/claude-opus-5-5',label:'Claude Opus 5.5',subText:'managed/anthropic/claude-opus-5-5'}].map(option=>({...option,selected:option.id===fixtureState.model,onSelect:()=>{fixtureState.model=option.id;fixtureEvents.push(option.id);fixtureRerender()}}));return K8.jsx(OR,{open:true,onOpenChange(){},triggerButton:K8.jsx('button',{children:'Model'}),contentClassName:'w-56 overflow-x-hidden overflow-y-hidden [--app-menu-gutter:0px]',children:K8.jsx(ssa,{active:true,menuView:'advanced',modelListConfig:{providerGroups:true,catalogHost:'readme',options},powerSelections:[],selectedPowerSelection:null,selectedServiceTier:null,serviceTierOptions:[],fallbackModelLabel:'Astra',onSelectPower(){},onToggleMenuView(){},shouldReduceMotion:true})})}
})();
export {Fixture};
`:null;
const speedAdapterSource=`

const fixtureIntl=()=>({formatMessage:({defaultMessage})=>defaultMessage});
function FixtureMessage({defaultMessage}){return defaultMessage}
${render}
window.fixtureState={model:'gpt-6-astra',tier:null,loading:false};window.fixtureEvents=[];
function Fixture(){FR();osa();const [,update]=asa.useState(0);window.fixtureRerender=()=>update(n=>n+1);const state=window.fixtureState;return W8.jsx(OR,{open:true,onOpenChange(){},triggerButton:W8.jsx('button',{children:'Model'}),contentClassName:R8.Menu,children:W8.jsx(fixtureSpeedControls,{selectedPowerSelection:{model:state.model,reasoningEffort:'medium',labels:{model:state.model==='gpt-6-astra'?'Astra':'Sol',effort:'Medium'}},selectedServiceTier:state.tier,serviceTierOptions:[{value:null,iconKind:null},{value:'priority',iconKind:'fast',speedMultiplier:1.5},...(state.model==='gpt-6-astra'?[{value:'ultrafast',iconKind:'ultrafast'}]:[])],serviceTierOptionsLoading:state.loading,onSelectServiceTier:value=>{state.tier=value;window.fixtureEvents.push(value);window.fixtureRerender()},onToggle(){},isExplicitModelSelection:true})})}
export {Fixture};`;
const adapterSource=readmeCapture?readmeAdapterSource:speedAdapterSource;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5b2ced5ef25.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto flex w-full max-w-3xl flex-col p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {$At,XAt} from '/assets/app-initial-97d3534ad35f.js';import {Fixture} from '/assets/${mainName}';const $=$At();window.reactRoot=XAt().createRoot(document.getElementById('root'));reactRoot.render($.jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'||readmeCapture&&req.url==='/speed'){res.setHeader('Content-Type','text/html');res.end(req.url==='/speed'?html.replace(`/assets/${mainName}`,`/assets/${mainName}?speed-fixture`):html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);if(pathname===join(assets,mainName))source=main+(readmeCapture&&req.url.endsWith('?speed-fixture')?speedAdapterSource:adapterSource);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
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

let socket,session,id=0,chrome;
const summary={scope:readmeCapture?'Production transformed advanced model picker, native PR.Item rows, React and CSS in light/dark; synthetic OpenAI/Anthropic catalog and localization, Windows host. No installed app, auth or model requests.':'Production transformed Astra controls, native menu item, React and CSS in light/dark; synthetic host/localization. No build, installed app or model requests.',checks:[]},pending=new Map(),exceptions=[];
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
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 if(readmeCapture){
  await wait("window.fixtureReady && !!document.querySelector('[data-azrael-provider-models]')");
  // Exercise the real provider heading callbacks; OpenAI starts expanded because
  // its synthetic row is selected, so collapse it before expanding both groups.
  await evaluate("document.querySelector('[data-azrael-provider=openai]').click()");
  await wait("document.querySelector('[data-azrael-provider=openai]').getAttribute('aria-expanded')==='false'");
  for(const provider of ['openai','anthropic']){
   await evaluate(`document.querySelector('[data-azrael-provider=${provider}]').click()`);
   await wait(`document.querySelector('[data-azrael-provider=${provider}]').getAttribute('aria-expanded')==='true'`);
  }
  for(const theme of ['light','dark']){
   await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}'`);
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:990,y:940});
   await evaluate('document.fonts.ready');
   await new Promise(r=>setTimeout(r,200));
   const details=await evaluate("(()=>{const menu=document.querySelector('[role=menu]'),rows=[...menu.querySelectorAll('[data-azrael-model-option]')],r=menu.getBoundingClientRect();return {theme:document.documentElement.dataset.theme,vscodeTheme:document.body.dataset.vscodeThemeKind,background:getComputedStyle(menu).backgroundColor,rows:rows.map(e=>({role:e.getAttribute('role'),text:e.innerText,selected:e.getAttribute('aria-checked')})),clip:{x:Math.max(0,Math.floor(r.x)-6),y:Math.max(0,Math.floor(r.y)-6),width:Math.ceil(r.width)+12,height:Math.ceil(r.height)+12,scale:1}}})()");
   check(theme+' full native provider rows',details.rows.length===2&&details.rows.every(row=>row.role==='menuitemradio')&&details.rows[0].text.includes('gpt-6-astra')&&details.rows[1].text.includes('Claude Opus 5.5')&&details.rows[1].text.includes('managed/anthropic/claude-opus-5-5'));
   check(theme+' theme attributes',details.theme===theme&&details.vscodeTheme==='vscode-'+theme);
   summary[theme]=details;
   await writeFile(join(logs,theme+'-model-picker.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',clip:details.clip})).data,'base64'));
  }
  check('light and dark native menu colors differ',summary.light.background!==summary.dark.background);
  await evaluate("document.querySelectorAll('[data-azrael-model-option]')[1].click()");
  await wait("fixtureState.model==='managed/anthropic/claude-opus-5-5'");
  check('native option selection callback',await evaluate("fixtureEvents.includes('managed/anthropic/claude-opus-5-5')"));
  summary.modelPicker={light:summary.light,dark:summary.dark,events:await evaluate('fixtureEvents')};
  check('no model picker browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);
  await evaluate('reactRoot.unmount()');
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/speed`});
 }
 await wait("window.fixtureReady && !!document.querySelector('[data-azrael-astra-speed]')");
 const button=()=>evaluate("(()=>{const e=document.querySelector('[data-azrael-astra-speed]'),s=getComputedStyle(e),icon=getComputedStyle(e.querySelector('svg')),content=e.querySelector('[class*=_FastModeToggleContent_]'),cs=getComputedStyle(content),cr=content.getBoundingClientRect(),wrapper=e.closest('[class*=_ViewControls_]'),ws=getComputedStyle(wrapper),model=wrapper.querySelector('[class*=_ViewToggleModelLabel_]'),effort=wrapper.querySelector('[class*=_ViewToggleEffortLabel_]'),mr=model.getBoundingClientRect(),er=effort.getBoundingClientRect();return {mode:e.dataset.azraelAstraSpeed,label:e.getAttribute('aria-label'),role:e.getAttribute('role'),color:s.color,background:s.backgroundColor,iconColor:icon.color,disabled:e.getAttribute('aria-disabled'),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,display:s.display,borderRadius:s.borderRadius,contentWidth:cr.width,contentHeight:cr.height,contentRadius:cs.borderRadius,wrapperDisplay:ws.display,wrapperMinHeight:ws.minHeight,labelsStacked:mr.top>=er.bottom-.5,modelLabel:model.textContent,effortLabel:effort.textContent}})()");
 const click=()=>evaluate("document.querySelector('[data-azrael-astra-speed]').click()");
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixtureState.tier=null;fixtureRerender()`);
  await wait("document.querySelector('[data-azrael-astra-speed]').dataset.azraelAstraSpeed==='default'");
  const standard=await button();check(theme+' standard native geometry',standard.role==='menuitem'&&standard.width===32&&standard.height>=32&&standard.display==='flex'&&standard.borderRadius==='8px'&&standard.contentWidth===26&&standard.contentHeight===26&&standard.contentRadius==='7px'&&standard.wrapperDisplay==='flex'&&standard.wrapperMinHeight==='36px');
  check(theme+' native model and effort labels occupy separate rows',standard.labelsStacked&&standard.modelLabel==='Astra'&&standard.effortLabel==='Medium');
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
 summary.browserExit=await confirmOwnedBrowserExit(chrome,profile);
 const allowed=join(root,'artifacts/verification')+sep;
 if(summary.browserExit.confirmed&&fixture.startsWith(allowed)){assert.equal(await realpath(fixture),fixtureRealPath);await rm(fixture,{recursive:true,maxRetries:5,retryDelay:200});summary.cleanup='Owned browser exited; guarded fixture/profile removed'}else{summary.cleanup='Browser exit uncertain; profile retained until confirmed closed';process.exitCode=1}
 summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
