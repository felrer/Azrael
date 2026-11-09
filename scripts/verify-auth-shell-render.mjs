import artifactRunTools from './artifact-run.cjs';
import {createRequire} from 'node:module';
import {spawn as nativeSpawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const run=artifactRunTools.beginArtifactRun(root,{workId:'FO-01-auth-shell-render',owner:'scripts/verify-auth-shell-render.mjs'});
const spawn=(...args)=>artifactRunTools.trackArtifactChild(run,nativeSpawn(...args));
const assets=join(root,'artifacts/upstream-ui/26.1007.21434/webview/assets'),profile=join(run.temporary,'chrome-profile');
const require=createRequire(import.meta.url),ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const {injectProviderModelPicker,PROVIDER_PICKER_ASSET}=require('./inject-provider-model-picker.cjs');
const {injectAuthShell,useSubmitAdmission}=require('./inject-auth-shell.cjs');
await mkdir(profile,{recursive:true});await mkdir(run.logs,{recursive:true});
const mainName='app-initial-7a199c66e670.js';
const main=injectAuthShell(injectProviderModelPicker(await readFile(join(assets,mainName),'utf8'),PROVIDER_PICKER_ASSET).text,PROVIDER_PICKER_ASSET).text;
const ast=ts.createSourceFile('main.js',main,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
// Localization and router/host inputs are the fixture boundary. Production
// routing, provider menu, native menu rows, React and theme styles remain real.
function localizedCopy(name){
 const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 assert.ok(node,'Pinned native '+name);let source=node.getText(ast);const changes=[];
 function walk(n){if(ts.isIdentifier(n)&&['st','q'].includes(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))changes.push({start:n.getStart(ast)-node.getStart(ast),end:n.end-node.getStart(ast),text:n.text==='st'?'fixtureIntl':'FixtureMessage'});ts.forEachChild(n,walk)}
 walk(node);for(const change of changes.sort((a,b)=>b.start-a.start))source=source.slice(0,change.start)+change.text+source.slice(change.end);return source.replace(/\b(ssa|esa|Doa)\b/g,name=>'fixture_'+name);
}
const route=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Ski').getText(ast)
 .replace('function Ski(','function FixtureRoute(').replaceAll('Lu()','fixtureLocation()').replaceAll('(0,b2.jsx)','K8.jsx').replaceAll('_ki','FixtureShell').replaceAll('eu,','FixtureRedirect,');
const adapter=`
const fixtureIntl=()=>({formatMessage:({defaultMessage})=>defaultMessage});
function FixtureMessage({defaultMessage}){return defaultMessage}
${['ssa','esa','Doa'].map(localizedCopy).join('\n')}
${route}
window.fixtureState={path:'/home',page:'home',menuOpen:false,authLoading:true,authMethod:null,model:null};window.fixtureEvents=[];
function fixtureLocation(){return{pathname:fixtureState.path}}
function FixtureRedirect({to}){G8.useEffect(()=>{fixtureState.path=to;fixtureState.page='accounts';fixtureRerender()},[to]);return null}
window.fixtureSetModels=async models=>{__azraelProviderCatalog.sessionCreated('fixture');await __azraelProviderCatalog.query('fixture',()=>({sendRequest:async()=>({data:models.map(model=>({model,supportedReasoningEfforts:[],defaultReasoningEffort:null})),nextCursor:null})}),100);fixtureRerender()};
const fixtureUseAdmission=${useSubmitAdmission.toString()};
function FixtureShell(){const props=fixtureUseAdmission(G8,__azraelProviderCatalog,{executionTargetHostId:'fixture'});return K8.jsxs('section',{'data-shell':true,className:'flex flex-col gap-4',children:[K8.jsxs('nav',{className:'flex gap-3',children:[K8.jsx(mw,{'data-general':true,onClick:()=>{fixtureState.page='general';fixtureRerender()},children:'General settings'}),K8.jsx(mw,{'data-accounts':true,onClick:()=>{fixtureState.page='accounts';fixtureRerender()},children:'Accounts and usage'})]}),K8.jsx('div',{'data-page':fixtureState.page,children:fixtureState.page==='general'?'General settings':fixtureState.page==='accounts'?'Accounts and usage':'Chat'}),K8.jsx(mw,{'data-submit':true,disabled:props.submitDisabled,title:props.disabledReason,onClick:()=>fixtureEvents.push('submit'),children:'Send'}),K8.jsx('p',{'data-admission':true,role:'status',children:props.disabledReason??'Model connection ready'})]})}
function Fixture(){FR();fsa();gw();const[,update]=G8.useState(0);window.fixtureRerender=()=>update(n=>n+1);const snapshot=__azraelProviderCatalog.snapshot('fixture');const options=snapshot.models.map(model=>({id:model,label:model.includes('anthropic')?'Claude':'Local API',subText:model,catalogHost:'fixture',selected:model===fixtureState.model,onSelect:()=>{fixtureState.model=model;fixtureEvents.push(model);fixtureRerender()}}));return K8.jsxs('div',{className:'flex flex-col gap-4',children:[K8.jsx(FixtureRoute,{routes:[]}),K8.jsx(OR,{open:fixtureState.menuOpen,onOpenChange(){},triggerButton:K8.jsx('button',{children:'Model'}),contentStyle:{width:420,minWidth:420,maxWidth:420,maxHeight:700,overflow:'hidden'},contentClassName:'[--app-menu-gutter:0px]',children:K8.jsx(fixture_ssa,{active:true,menuView:'advanced',modelListConfig:{providerGroups:true,catalogHost:'fixture',options},powerSelections:[],selectedPowerSelection:null,selectedServiceTier:null,serviceTierOptions:[],fallbackModelLabel:'Model',onSelectPower(){},onToggleMenuView(){},shouldReduceMotion:true})})]})}
export{Fixture};`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style>${['aad627bd9dff','49150e6a0951','f5b2ced5ef25'].map(hash=>`<link rel="stylesheet" href="/assets/app-initial-${hash}.css">`).join('')}</head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto flex w-full max-w-3xl flex-col p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import{$At,XAt}from'/assets/app-initial-97d3534ad35f.js';import{Fixture}from'/assets/${mainName}';window.reactRoot=XAt().createRoot(document.getElementById('root'));reactRoot.render($At().jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');const source=pathname===join(assets,mainName)?main+adapter:await readFile(pathname);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(error){res.statusCode=500;res.end(String(error))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const pending=new Map(),exceptions=[];
const summary={scope:'Actual pinned transformed Ski routing and ssa provider menu/PR.Item with native React/CSS; synthetic router/shell/host/catalog boundary. Windows headless light/dark, no installed app, full _ki bootstrap, backend authentication or inference.',checks:[]};
try{
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-background-mode','--disable-extensions','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((r,j)=>{let s='';const t=setTimeout(()=>j(Error('Chrome startup timeout')),20000);chrome.stderr.on('data',c=>{s+=c;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);r(m[1])}});chrome.on('error',j)});
 socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.j(Error(JSON.stringify(m.error))):p.r(m.result)}}});
 const send=(method,params={},sid=session)=>new Promise((r,j)=>{const n=++id,t=setTimeout(()=>j(Error('CDP timeout '+method)),20000);pending.set(n,{r,j,t});socket.send(JSON.stringify({id:n,method,params,...(sid?{sessionId:sid}:{})}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Wait failed: '+expression+'; '+JSON.stringify(await evaluate('({errors:fixtureErrors,body:document.body.innerText,focused:document.hasFocus(),active:document.activeElement?.outerHTML})')))};
 const check=(name,value)=>{assert.ok(value,name);summary.checks.push(name)};
 const key=async(key,code,n)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:n,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:n})};
 session=(await send('Target.attachToTarget',{targetId:(await send('Target.createTarget',{url:'about:blank'},null)).targetId,flatten:true},null)).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Page.bringToFront');await send('Emulation.setFocusEmulationEnabled',{enabled:true});await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});await send('Page.setDocumentContent',{frameId:(await send('Page.getFrameTree')).frameTree.frame.id,html:'<!doctype html><button id=probe onclick="window.probeClicks=(window.probeClicks||0)+1">Probe</button>'});await evaluate("document.querySelector('#probe').focus()");await key('Enter','Enter',13);summary.focusProbe=await evaluate("({focused:document.hasFocus(),active:document.activeElement?.id,clicks:window.probeClicks??0})");check('small native button CDP keyboard probe',summary.focusProbe.clicks===1);await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 await wait("window.fixtureReady && !!document.querySelector('[data-shell]')");
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixtureState.path='/home';fixtureState.authLoading=true;fixtureState.authMethod=null;fixtureState.page='home';fixtureState.menuOpen=false;fixtureRerender()`);
  await evaluate('fixtureSetModels([])');await wait("document.querySelector('[data-submit]').disabled");
  check(theme+' unauthenticated/loading shell remains rendered',await evaluate("!!document.querySelector('[data-shell]')"));
  await evaluate("document.querySelector('[data-general]').click()");await wait("!!document.querySelector('[data-page=general]')");check(theme+' general settings boundary accessible',true);
  await evaluate("document.querySelector('[data-accounts]').click()");await wait("!!document.querySelector('[data-page=accounts]')");check(theme+' account route boundary accessible',true);
  await evaluate("fixtureState.menuOpen=true;fixtureRerender()");await wait("!!document.querySelector('[data-azrael-model-search]')");
  check(theme+' empty catalog has no selectable model or default GPT',await evaluate("document.querySelectorAll('[data-azrael-model-option]').length===0&&!/gpt-/i.test(document.querySelector('[role=menu]').innerText)"));
  check(theme+' empty model reason visible',await evaluate("document.querySelector('[data-admission]').innerText.includes(String.fromCharCode(0xc5f0,0xacb0))"));
  summary[theme]=await evaluate("(()=>{const e=document.querySelector('[data-submit]'),s=getComputedStyle(e),r=e.getBoundingClientRect();return{disabled:e.disabled,width:r.width,height:r.height,color:s.color,font:s.fontFamily}})()");
  check(theme+' native styled submit remains disabled',summary[theme].disabled&&summary[theme].width>20&&summary[theme].height>=24);
  await writeFile(join(run.logs,theme+'-empty.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("fixtureSetModels(['managed/anthropic/claude-opus','api/local/model'])");await wait("!document.querySelector('[data-submit]').disabled");
  await evaluate("document.querySelector('[data-azrael-model-search]').focus()");await send('Input.insertText',{text:'Claude'});await wait("document.querySelectorAll('[data-azrael-model-option]').length===1");
  await key('ArrowDown','ArrowDown',40);await key('Enter','Enter',13);await wait("fixtureState.model==='managed/anthropic/claude-opus'");check(theme+' connected Anthropic selected with keyboard',true);
  await evaluate("document.querySelector('[data-azrael-model-search]').focus();document.querySelector('[data-azrael-model-search]').select()");await key('Backspace','Backspace',8);await send('Input.insertText',{text:'Local'});
  await wait("document.querySelectorAll('[data-azrael-model-option]').length===1&&document.querySelector('[data-azrael-model-option]').innerText.includes('Local API')");
  await key('ArrowDown','ArrowDown',40);await key('Enter','Enter',13);await wait("fixtureState.model==='api/local/model'");check(theme+' explicit API model selected without OpenAI',true);
  check(theme+' recovery never replays submit',await evaluate("!fixtureEvents.includes('submit')"));
  await writeFile(join(run.logs,theme+'-connected.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("fixtureState.path='/login';fixtureRerender()");await wait("fixtureState.path==='/settings/usage'&&!!document.querySelector('[data-page=accounts]')");check(theme+' legacy login enters account boundary',true);
 }
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);summary.events=await evaluate('fixtureEvents');summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(error){summary.outcome='failed';summary.error=String(error.stack||error);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 if(chrome?.exitCode==null)await new Promise(r=>{chrome.once('exit',r);setTimeout(r,5000)});
 summary.browserExit=await artifactRunTools.confirmOwnedBrowserExit(chrome,profile,spawn);run.producerStopped=summary.browserExit.confirmed;
 if(!summary.browserExit.confirmed)process.exitCode=1;
 summary.runRoot=run.runRoot;summary.lifecycleId=run.lifecycleId;summary.exitCode=process.exitCode||0;
 await writeFile(join(run.logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}
