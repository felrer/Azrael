import artifactRunTools from './artifact-run.cjs';
const { beginArtifactRun, trackArtifactChild, confirmOwnedBrowserExit } = artifactRunTools;
import {createRequire} from 'node:module';
import {spawn as nativeSpawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const paths={};
if(process.env.AZRAEL_RENDER_FIXTURE_ROOT){paths.temporary=resolve(process.env.AZRAEL_RENDER_FIXTURE_ROOT);assert(paths.temporary.startsWith(join(root,'artifacts/verification')+sep));}
if(process.env.AZRAEL_RENDER_LOG_ROOT){paths.logs=resolve(process.env.AZRAEL_RENDER_LOG_ROOT);assert(paths.logs.startsWith(join(root,'artifacts/logs')+sep));}
const artifactRun = beginArtifactRun(root, { workId: 'FO-01-auto-review-service-render', owner: 'scripts/verify-service-auto-review-render.mjs', paths });
const spawn = (...args) => trackArtifactChild(artifactRun, nativeSpawn(...args));
const fixture=artifactRun.temporary,logs=artifactRun.logs;
const assets=join(root,'artifacts/upstream-ui/26.1007.21434/webview/assets');
const profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);
const ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const {AUTO_REVIEW_ASSETS}=require('./inject-auto-review.cjs');
const {transformAsset}=require('./namespace-azrael-host.cjs');
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const dropdownName='permissions-mode-dropdown-66a2c48ceb22.js';
const mainName='app-initial-7a199c66e670.js';
const production=new Map();
// Shared exports injected into the main bundle come from this native owner.
for(const relativePath of [...AUTO_REVIEW_ASSETS,'webview/assets/app-initial-c014f9ee4429.js']){
 const filename=join(root,'artifacts/upstream-ui/26.1007.21434',relativePath);
 production.set(relativePath.split('/').at(-1),transformAsset(await readFile(filename,'utf8'),relativePath,filename,ts).text);
}
const dropdown=production.get(dropdownName),main=production.get(mainName);
const mainFile=ts.createSourceFile('main.js',main,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const configOwner=mainFile.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='QXr');
let configRender=configOwner.getText(mainFile),configEdits=[];
const configHooks=new Set(['azraelUseAutoReviewService','X','Hu','Jg','m4e','xrt']);
function configVisit(n){if(ts.isIdentifier(n)&&configHooks.has(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))configEdits.push({start:n.getStart(mainFile)-configOwner.getStart(mainFile),end:n.end-configOwner.getStart(mainFile),text:'azraelFixture_'+n.text});ts.forEachChild(n,configVisit)}configVisit(configOwner);
for(const e of configEdits.sort((a,b)=>b.start-a.start))configRender=configRender.slice(0,e.start)+e.text+configRender.slice(e.end);
configRender=configRender.replace('function QXr(','function azraelFixtureConfigEligibility(').replace('(0,tZr.use)(R7e)','null');
const serviceOwner=mainFile.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='azraelUseAutoReviewService');
const serviceRender=serviceOwner.getText(mainFile).replace('function azraelUseAutoReviewService(','function azraelFixture_azraelUseAutoReviewService(').replace('scope = Ou($)','scope = azraelFixtureScope').replaceAll('Px(scope, hostId)','azraelFixtureRpc');
const serviceAdapter=String.raw`
const azraelFixtureScope={},azraelFixtureRpc={sendRequest:async(method,params)=>{window.fixtureRpcReads=(window.fixtureRpcReads??0)+1;return{state:{serviceAccount:window.fixtureService}}},subscribe:({listener})=>{window.fixtureAccountUpdated=listener;return{[Symbol.dispose](){window.fixtureAccountUpdated=null}}}};
`;
const configSource=`\nconst azraelFixture_X=()=>false,azraelFixture_Hu=fn=>fn===fPe?{data:{requirements:window.fixtureConfig.requirements},isPending:false}:null,azraelFixture_Jg=()=>[{}],azraelFixture_m4e=()=>true,azraelFixture_xrt=()=>({data:{config:window.fixtureConfig.resolvedConfig},isPending:window.fixtureConfig.isConfigDataPending});\n${serviceAdapter}\n${serviceRender}\n${configRender}\nwindow.fixtureConfigEligibility=azraelFixtureConfigEligibility;`;
const file=ts.createSourceFile('dropdown.js',dropdown,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const owner=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='yn');
assert.ok(owner,'Pinned native permission component');
// Fixture-only adapters replace host state/query/telemetry/localization, while
// the actual native render body, menu components and selection handlers run.
const adapters=new Set(['p','c','d','i','ge','I','P','ce','ot','mt','be','Xe','a']);
let render=owner.getText(file),edits=[];
function visit(n){if(ts.isIdentifier(n)&&adapters.has(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(file)-owner.getStart(file),end:n.end-owner.getStart(file),text:'fixture_'+n.text});ts.forEachChild(n,visit)}
visit(owner);for(const e of edits.sort((a,b)=>b.start-a.start))render=render.slice(0,e.start)+e.text+render.slice(e.end);
render=render.replace('function yn(','function fixtureNativePermissions(');
const adapterSource=`
import {fixtureInitObserver,fixtureMakeObserver,tEt as fixtureResizeContext} from './app-initial-c014f9ee4429.js';
fixtureInitObserver();
const fixture_a=({defaultMessage})=>defaultMessage;
const fixture_i=()=>({formatMessage:({defaultMessage})=>defaultMessage});
const fixture_c=()=>null,fixture_d=()=>({}),fixture_ce=()=>false,fixture_be=()=>null,fixture_Xe=()=>null;
const fixture_p=(fn)=>fn===Ve?{data:[]}:fn===Qe?{isRequired:false}:null;
const fixture_ge=e=>window.fixtureConfigEligibility(e);
const fixture_ot=(...args)=>window.fixtureEvents.push({type:'telemetry',args});
const fixture_mt=(hostId,value)=>window.fixtureEvents.push({type:'persist',hostId,value});
const fixture_I=()=>({...window.fixtureState,isAutoReviewRequiredForSelectedModel:false,permissionProfileId:null,shouldSendPermissionOverrides:true,setAgentMode:mode=>{window.fixtureState.agentMode=mode;window.fixtureEvents.push({type:'mode',mode});window.fixtureRerender()},setPermissionProfileId(){}});
const fixture_P=()=>({preferredNonFullAccessMode:window.fixtureState.preferred,setPreferredNonFullAccessMode:mode=>{window.fixtureState.preferred=mode;window.fixtureEvents.push({type:'preferred',mode})}});
${render}
window.fixtureConfig={isConfigDataPending:false,isGuardianApprovalEnabledByStatsig:false,resolvedConfig:{}};
window.fixtureModelSettings={isLoading:false,model:'managed/anthropic/claude'};window.fixtureService={state:'ready',reason:null};
window.fixtureState={agentMode:'auto',preferred:null};window.fixtureEvents=[];
const fixtureReact=h();let fixtureRevision=0;
function Fixture(){const [,update]=fixtureReact.useState(0);window.fixtureRerender=()=>{window.fixtureAccountUpdated?.();update(++fixtureRevision)};return $.jsx(fixtureResizeContext.Provider,{value:fixtureObserver,children:$.jsx(fixtureNativePermissions,{hostId:'local',cwdOverride:'C:/synthetic-workspace',permissionProfilesOverride:[],defaultOpen:true})})}
const fixtureObserver=fixtureMakeObserver();
export {Fixture};`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto flex w-full max-w-3xl flex-col p-8"><h1 class="text-2xl font-semibold text-default">Permissions</h1><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {$At,XAt} from '/assets/app-initial-97d3534ad35f.js';import {Fixture} from '/assets/${dropdownName}';const $=$At();window.reactRoot=XAt().createRoot(document.getElementById('root'));reactRoot.render($.jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=production.get(pathname.split(sep).at(-1))??await readFile(pathname);if(pathname===join(assets,dropdownName))source=dropdown+adapterSource;else if(pathname===join(assets,mainName))source=main+configSource;else if(pathname===join(assets,'app-initial-c014f9ee4429.js'))source=source.toString()+'\nexport{fj as fixtureInitObserver,V$t as fixtureMakeObserver};';res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Production transformAsset output for Auto-review main/dropdown/manager and shared export owner: actual native QXr/FXr eligibility, permission render/menu/selection handlers, React, ResizeObserver and CSS; synthetic host hooks/default-message localization. Submission manager tested separately; no installed VS Code or model call.',checks:[]},pending=new Map(),exceptions=[];
try{
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((r,j)=>{let s='';const t=setTimeout(()=>j(Error('Chrome startup timeout')),20000);chrome.stderr.on('data',c=>{s+=c;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);r(m[1])}});chrome.on('error',j)});
 socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')exceptions.push(m.params.args);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.j(Error(JSON.stringify(m.error))):p.r(m.result)}}});
 const send=(method,params={},sid=session)=>new Promise((r,j)=>{const n=++id,t=setTimeout(()=>j(Error('CDP timeout '+method)),20000);pending.set(n,{r,j,t});socket.send(JSON.stringify({id:n,method,params,...(sid?{sessionId:sid}:{})}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const capture=async()=>{await new Promise(r=>setTimeout(r,200));return send('Page.captureScreenshot',{format:'png'})};
 const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Wait failed: '+expression+'; '+JSON.stringify(await evaluate('({errors:fixtureErrors,body:document.body.innerText})')))};
 const check=(name,value)=>{assert.ok(value,name);summary.checks.push(name)};
 session=(await send('Target.attachToTarget',{targetId:(await send('Target.createTarget',{url:'about:blank'},null)).targetId,flatten:true},null)).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 await wait("window.fixtureReady && document.body.innerText.includes('Only ask for actions detected as potentially unsafe')");
 const option=()=>evaluate("[...document.querySelectorAll('[role=menuitem],button')].filter(e=>e.textContent.includes('Approve for me')).map(e=>({role:e.getAttribute('role'),disabled:e.getAttribute('aria-disabled'),text:e.textContent}))");
 const clickOption=()=>evaluate("[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.includes('Approve for me')).click()");
 const open=async()=>{const point=await evaluate("(()=>{const r=document.querySelector('button[aria-label=\"Change permissions\"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await wait("!!document.querySelector('[role=menuitem]')")};
 for(const theme of ['light','dark']){
  await evaluate("document.documentElement.dataset.theme="+JSON.stringify(theme)+";document.body.dataset.vscodeThemeKind="+JSON.stringify('vscode-'+theme));
  await new Promise(r=>setTimeout(r,150));
  check(theme+' ready OpenAI service supports foreign chat provider',(await option()).some(e=>e.disabled!=='true'&&e.text.includes('Only ask for actions detected as potentially unsafe')));
  check(theme+' menu uses production Azrael branding',await evaluate("document.body.innerText.includes('How should Azrael actions be approved?')&&!document.body.innerText.includes('How should Codex')"));
  check(theme+' Full access uses neutral production foreground',await evaluate("(()=>{const items=[...document.querySelectorAll('[role=menuitem]')],manual=items.find(e=>e.textContent.includes('Ask for approval')),full=items.find(e=>e.textContent.includes('Full access'));return getComputedStyle(manual).color===getComputedStyle(full).color&&![...full.querySelectorAll('*')].some(e=>e.classList.contains('text-warning'))})()"));
  check(theme+' leading icons mix native blue/orange with gray while labels stay neutral',await evaluate("(()=>{const items=[...document.querySelectorAll('[role=menuitem]')],manual=items.find(e=>e.textContent.includes('Ask for approval')),approve=items.find(e=>e.textContent.includes('Approve for me')),full=items.find(e=>e.textContent.includes('Full access'));return [approve,full].every((item,index)=>{const icon=item.querySelector('svg'),tint=icon.closest('span[style]');return tint?.style.color.includes(index?'--orange-300':'--blue-300')&&tint.style.color.includes('--color-token-description-foreground')&&getComputedStyle(icon).color!==getComputedStyle(manual.querySelector('svg')).color&&getComputedStyle(item).color===getComputedStyle(manual).color})})()"));
  summary[theme]=await evaluate("({color:getComputedStyle(document.querySelector('[role=menuitem]')).color})");
  await clickOption();await wait("fixtureState.agentMode==='guardian-approvals' && !document.querySelector('[role=menuitem]')");
  check(theme+' native selection persists guardian preference',await evaluate("fixtureState.preferred==='guardian-approvals'&&fixtureEvents.some(e=>e.type==='persist'&&e.value.agentMode==='guardian-approvals')"));await open();
  await writeFile(join(logs,theme+'-ready.png'),Buffer.from((await capture()).data,'base64'));
  const prior=await evaluate('fixtureEvents.length');
  await evaluate("fixtureService={state:'reauthRequired',reason:'Sign in to the OpenAI service account again to use Auto-review.'};fixtureRerender()");
  await wait("[...document.querySelectorAll('[role=menuitem]')].some(e=>e.getAttribute('aria-disabled')==='true'&&e.textContent.includes('Approve for me'))");
  check(theme+' unavailable service preserves native guardian state and saved preference',await evaluate("fixtureState.agentMode==='guardian-approvals'&&fixtureState.preferred==='guardian-approvals'"));
  check(theme+' unavailable service displays manual projection',await evaluate("document.querySelector('button[aria-label=\"Change permissions\"]').textContent.includes('Ask for approval')"));
  await clickOption();check(theme+' disabled item cannot select or write preferences',await evaluate('fixtureEvents.length==='+prior));
  const point=await evaluate("(()=>{const item=[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.includes('Approve for me')),r=item.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await wait("[...document.querySelectorAll('[role=tooltip]')].some(e=>e.textContent.includes('Sign in to the OpenAI service account again'))");
  check(theme+' mouse hover exposes native reason tooltip',true);
  await writeFile(join(logs,theme+'-hover.png'),Buffer.from((await capture()).data,'base64'));
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
  // Arrow navigation exercises native menu roving focus; the unavailable item
  // remains focusable and only the selection callback is guarded.
  await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.includes('Ask for approval')).focus()");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await wait("document.activeElement?.textContent.includes('Approve for me')");
  await wait("[...document.querySelectorAll('[role=tooltip]')].some(e=>e.textContent.includes('Sign in to the OpenAI service account again'))");
  check(theme+' keyboard focus exposes native reason tooltip',true);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  check(theme+' keyboard activation cannot mutate disabled preference',await evaluate('fixtureEvents.length==='+prior));
  await writeFile(join(logs,theme+'-focus.png'),Buffer.from((await capture()).data,'base64'));
  await evaluate("fixtureService={state:'ready',reason:null};fixtureRerender()");await wait("[...document.querySelectorAll('[role=menuitem]')].some(e=>e.getAttribute('aria-disabled')!=='true'&&e.textContent.includes('Approve for me'))");
  check(theme+' service recovery restores saved guardian projection',await evaluate("document.querySelector('button[aria-label=\"Change permissions\"]').textContent.includes('Approve for me')"));
  await evaluate("fixtureConfig={...fixtureConfig,resolvedConfig:{features:{guardian_approval:false}}};fixtureRerender()");
  await wait("[...document.querySelectorAll('[role=menuitem]')].some(e=>e.getAttribute('aria-disabled')==='true'&&e.textContent.includes('Requires default sandboxed permissions'))");
  check(theme+' native config restriction remains enforced',true);
  await evaluate("fixtureConfig={...fixtureConfig,resolvedConfig:{}};fixtureRerender()");await wait("[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.includes('Only ask for actions detected as potentially unsafe'))");
  await evaluate("fixtureService={state:'checking',reason:'Checking the OpenAI service account for Auto-review.'};fixtureRerender()");
  await wait("[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.includes('Checking the OpenAI service account'))");
  check(theme+' checking retains enabled manual and Full access options',await evaluate("['Ask for approval','Full access'].every(label=>{const item=[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.includes(label));return item&&item.getAttribute('aria-disabled')!=='true'&&!item.hasAttribute('data-disabled')})"));
  await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.includes('Ask for approval')).click()");await wait("fixtureState.agentMode==='auto'&&!document.querySelector('[role=menuitem]')");
  check(theme+' manual selection works while service checks',await evaluate("fixtureEvents.at(-1).type==='persist'&&fixtureEvents.at(-1).value.agentMode==='auto'"));await open();
  await evaluate("fixtureConfig={...fixtureConfig,isConfigDataPending:true};fixtureRerender()");await wait("document.querySelector('button[aria-label=\"Change permissions\"]').disabled");check(theme+' actual config pending disables trigger',true);
  await evaluate("fixtureConfig={...fixtureConfig,isConfigDataPending:false};fixtureService={state:'ready',reason:null};fixtureRerender()");await wait("!document.querySelector('button[aria-label=\"Change permissions\"]').disabled&&document.body.innerText.includes('Only ask for actions detected as potentially unsafe')");

 }
 check('light/dark semantic foreground differs',summary.light.color!==summary.dark.color);
 check('actual service hook makes fresh native account requests on changes',await evaluate('fixtureRpcReads>4'));
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);
 summary.events=await evaluate('fixtureEvents');summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
 summary.browserExit=await confirmOwnedBrowserExit(chrome,profile,spawn);
 summary.browserExitCode=chrome?.exitCode;summary.browserSignalCode=chrome?.signalCode;
 if(summary.browserExit.confirmed){summary.cleanup='Owned browser exited; fixture/profile retained for explicit lifecycle review'}else{summary.cleanup='Browser exit uncertain; profile retained until confirmed closed';artifactRun.producerStopped=false;process.exitCode=1}
 summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({runRoot:artifactRun.runRoot,lifecycleId:artifactRun.lifecycleId,outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
