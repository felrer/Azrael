import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const containedPath=(value,parent,label)=>{const target=resolve(root,value),allowed=resolve(root,parent)+sep;assert.ok(target.toLowerCase().startsWith(allowed.toLowerCase()),label+' must be a descendant of '+parent);return target};
const fixture=containedPath(process.env.AZRAEL_RENDER_FIXTURE_ROOT||'artifacts/verification/session-flags','artifacts/verification','Renderer fixture');
const logs=containedPath(process.env.AZRAEL_RENDER_LOG_ROOT||'artifacts/logs/session-flags','artifacts/logs','Renderer logs'),profile=join(fixture,'chrome-profile');
const assets=join(root,'artifacts/upstream-ui/26.1007.21434/webview/assets');
const require=createRequire(import.meta.url),ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const {ASSET,HELPER,injectSessionFlags}=require('./inject-session-flags.cjs');
const headerName=ASSET.split('/').at(-1),rowsName='app-initial-c014f9ee4429.js';
const original=await readFile(join(assets,headerName),'utf8'),header=injectSessionFlags(original,ASSET).text;
assert.equal(header.split('(0,Z.jsx)(azraelFlaggedSessionRow,{').length-1,2);
assert.equal(injectSessionFlags(header,ASSET).text,header);
const rows=await readFile(join(assets,rowsName),'utf8'),file=ts.createSourceFile('rows.js',rows,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const owner=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Gjr');assert(owner);
// Adapt only external host state, navigation and archive services. Keep Gjr's
// render body, native rQ/Bkr markup, archive confirmation, and production helper.
const adapters=new Set(['ta','K','le','J','VC','Ajr','Gqn','s2n','n2n','cIe','M4t','j4t','Rjr']);
let render=owner.getText(file),edits=[];
function visit(n){if(ts.isIdentifier(n)&&adapters.has(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(file)-owner.getStart(file),end:n.end-owner.getStart(file),text:'fixture_'+n.text});ts.forEachChild(n,visit)}visit(owner);
for(const e of edits.sort((a,b)=>b.start-a.start))render=render.slice(0,e.start)+e.text+render.slice(e.end);
render=render.replace('function Gjr(','function fixtureGjr(');
const rowAdapter=`
const fixture_ta=()=>({get:()=>false}),fixture_K=()=>false,fixture_le=()=>({formatMessage:({defaultMessage})=>defaultMessage}),fixture_VC=()=>null,fixture_Ajr=()=>null,fixture_Gqn=()=>false;
const fixture_J=(atom,key)=>atom===Yj?'idle':atom===qj?{roomId:null,hasUnread:false}:atom===rc?{data:null}:null;
const fixture_Rjr=()=> 'local';
const fixture_n2n=()=>()=>{},fixture_M4t=()=>{},fixture_j4t=()=>null;
const fixture_cIe=(_store,id,host)=>{window.fixtureEvents.push({type:'navigate',id,host});return true};
const fixture_s2n=async(_store,{conversationId,hostId})=>{window.fixtureEvents.push({type:'archive',conversationId,hostId})};
${render}
export {fixtureGjr,Yjr as fixtureInitRow,a3e as fixtureInitPreferences};
`;
const headerAdapter=`
import {fixtureGjr,fixtureInitRow,fixtureInitPreferences} from './${rowsName}';
import {Clt as FixtureScope,Hbt as FixtureIntlContext,fixtureInitScope} from './app-initial-97d3534ad35f.js';
const FixtureReact=v();window.fixtureEvents=[];window.fixtureHost='local';window.fixtureOpen=true;
function FixtureRows(){const[,update]=FixtureReact.useState(0);window.fixtureRerender=()=>update(n=>n+1);return window.fixtureOpen?(0,Z.jsx)(azraelFlaggedSessionRow,{conversationId:'same-id',hostId:window.fixtureHost,threadSummary:{id:'same-id',title:'Review session changes',hostId:window.fixtureHost},disableHoverCard:true,disableEnvTooltip:true,useStableTrailingRail:true,metaContent:(0,Z.jsx)('span',{'data-fixture-time':true,children:'12m'}),onArchiveSuccess:()=>window.fixtureEvents.push({type:'archive-success'})}):null}
let fixtureInitialized=false;
function Fixture(){Dn();fixtureInitRow();fixtureInitScope();if(!fixtureInitialized){fixtureInitialized=true;fixtureInitPreferences(JSON.parse(localStorage.getItem("fixture-preferences")||"{}"),(key,value)=>{const prefs=JSON.parse(localStorage.getItem("fixture-preferences")||"{}");if(value===undefined)delete prefs[key];else prefs[key]=value;localStorage.setItem("fixture-preferences",JSON.stringify(prefs));window.fixtureEvents.push({type:"persist",key,value})})}return Z.jsx(FixtureScope,{scope:Re,children:Z.jsx(FixtureIntlContext,{value:{locale:"en",formatMessage:({defaultMessage})=>defaultMessage},children:Z.jsx(FixtureRows,{})})})}
export {Fixture};
`;
// Helper is copied verbatim by injectSessionFlags. Only the native imported row
// host hooks and localization context are adapted for this isolated fixture.
const servedHeader=header.replace('e4t as Ke,eL as qe','e4t as Ke,eL as originalQe').replace('Bbt as i,','Bbt as originalIntl,')+'\nconst qe=fixtureGjr,i=()=>({formatMessage:({defaultMessage})=>defaultMessage});\n'+headerAdapter;
assert(servedHeader.includes(HELPER));
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto flex w-full max-w-xl flex-col p-8"><h1 class="mb-4 text-xl font-semibold text-default">Recent chats</h1><div id="root" class="[--task-row-trailing-inset:calc(var(--spacing)*1.5)]"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {$At,XAt} from '/assets/app-initial-97d3534ad35f.js';import {Fixture} from '/assets/${headerName}';window.reactRoot=XAt().createRoot(document.getElementById('root'));reactRoot.render($At().jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=pathname===join(assets,headerName)?servedHeader:pathname===join(assets,rowsName)?rows+rowAdapter:await readFile(pathname);if(pathname===join(assets,'app-initial-97d3534ad35f.js'))source=source.toString()+'\nexport {kRt as fixtureInitScope};';res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}res.statusCode=404;res.end()}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Pinned native React, CSS, Gjr/rQ/Bkr rows and verbatim production session flag helper; fixture-only host/query/localization services. No installed VS Code or real session mutation.',inputSha256:createHash('sha256').update(header).update(rows).digest('hex'),checks:[]},pending=new Map(),exceptions=[];
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
 await wait("window.fixtureReady && !!document.querySelector('[data-azrael-session-flag]')");

 const flag='[data-azrael-session-flag]';
 const point=selector=>evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
 const mouse=async(selector)=>{const p=await point(selector);await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await new Promise(r=>setTimeout(r,180))};
 const click=async(selector)=>{await mouse(selector);const p=await point(selector);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1})};
 const leave=async()=>{await evaluate('document.activeElement?.blur()');await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:10,y:10});await new Promise(r=>setTimeout(r,200))};
 const active=()=>evaluate('document.querySelector('+JSON.stringify(flag)+').getAttribute("aria-pressed")==="true"');
 const shot=async name=>{const path=join(logs,name+'.png');const clip=name==='light-flagged'?await evaluate('(()=>{const r=document.querySelector("main").getBoundingClientRect(),row=document.querySelector("[role=button]").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:Math.ceil(row.bottom-r.y+32),scale:1}})()'):undefined;await writeFile(path,Buffer.from((await send('Page.captureScreenshot',{format:'png',...(clip?{clip}:{})})).data,'base64'));summary.screenshots??=[];summary.screenshots.push(path);if(clip){summary.screenshotClips??={};summary.screenshotClips[name]=clip}};
 const noActions=()=>evaluate('fixtureEvents.every(e=>!["archive","navigate","archive-success"].includes(e.type))');
 for(const theme of ['light','dark']){
  await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme)+';document.body.dataset.vscodeThemeKind='+JSON.stringify('vscode-'+theme));await leave();
  check(theme+' inactive hidden until row hover/focus',await evaluate('getComputedStyle(document.querySelector('+JSON.stringify(flag)+')).opacity==="0"'));
  await shot(theme+'-inactive');await mouse('[role=button]');
  check(theme+' hover reveals outlined flag without button tile',await evaluate('(()=>{const b=document.querySelector('+JSON.stringify(flag)+'),s=getComputedStyle(b);return s.opacity==="1"&&s.pointerEvents==="auto"&&s.boxShadow==="none"&&s.backgroundColor==="rgba(0, 0, 0, 0)"&&s.borderTopWidth==="0px"&&b.querySelectorAll("path")[1].getAttribute("fill")==="none"})()'));
  check(theme+' flag leaves native archive clear',await evaluate('(()=>{const b=document.querySelector('+JSON.stringify(flag)+').getBoundingClientRect(),a=document.querySelector("button[aria-label^=Archive]").getBoundingClientRect();return b.right+12<=a.x})()'));await shot(theme+'-hover');await click(flag);await wait('document.querySelector('+JSON.stringify(flag)+').getAttribute("aria-pressed")==="true"');await leave();
  check(theme+' active solid red always visible',await evaluate('(()=>{const b=document.querySelector('+JSON.stringify(flag)+'),s=getComputedStyle(b);return s.opacity==="1"&&s.pointerEvents==="auto"&&b.classList.contains("text-danger")&&b.querySelectorAll("path")[1].getAttribute("fill")==="currentColor"})()'));
  const geometry=await evaluate('(()=>{const b=document.querySelector('+JSON.stringify(flag)+'),t=document.querySelector("[data-fixture-time]"),a=document.querySelector("button[aria-label=\\"Archive chat\\"]");const br=b.getBoundingClientRect(),tr=t.getBoundingClientRect(),ar=a.getBoundingClientRect();return{flag:{x:br.x,right:br.right,width:br.width},time:{x:tr.x,right:tr.right},archive:{x:ar.x,right:ar.right},margin:getComputedStyle(b).marginInlineEnd,color:getComputedStyle(b).color,foreground:getComputedStyle(document.querySelector("[role=button]")).color}})()');
  summary[theme]=geometry;
  check(theme+' flag immediately left of native time with 12px end margin',geometry.flag.right<=geometry.time.x&&geometry.time.x-geometry.flag.right<40&&geometry.margin==='12px');
  await shot(theme+'-flagged');check(theme+' flag click does not navigate/archive',await noActions());
  await click(flag);await wait('document.querySelector('+JSON.stringify(flag)+').getAttribute("aria-pressed")==="false"');check(theme+' repeat unsets',!(await active()));
  await leave();await evaluate('document.querySelector("[role=button]").focus()');await new Promise(r=>setTimeout(r,180));
  check(theme+' row focus reveals inactive control',await evaluate('getComputedStyle(document.querySelector('+JSON.stringify(flag)+')).opacity==="1"'));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  check(theme+' keyboard Tab reaches flag',await evaluate('document.activeElement===document.querySelector('+JSON.stringify(flag)+')'));
  await shot(theme+'-focus');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});await wait('document.querySelector('+JSON.stringify(flag)+').getAttribute("aria-pressed")==="true"');
  check(theme+' keyboard Space toggles without row action',await noActions());
  await evaluate('fixtureOpen=false;fixtureRerender()');await wait('!document.querySelector('+JSON.stringify(flag)+')');await evaluate('fixtureOpen=true;fixtureRerender()');await wait('!!document.querySelector('+JSON.stringify(flag)+')');check(theme+' reopening retains flag',await active());
  await evaluate('fixtureHost="remote-a";fixtureRerender()');await wait('document.querySelector('+JSON.stringify(flag)+')?.dataset.azraelSessionFlag.includes("remote-a")');check(theme+' same conversation on separate host starts unset',!(await active()));
  await click(flag);await wait('document.querySelector('+JSON.stringify(flag)+').getAttribute("aria-pressed")==="true"');
  await evaluate('fixtureHost="local";fixtureRerender()');await wait('document.querySelector('+JSON.stringify(flag)+')?.dataset.azraelSessionFlag.includes("local")');check(theme+' separate host leaves local flag set',await active());
  await click(flag);await wait('document.querySelector('+JSON.stringify(flag)+').getAttribute("aria-pressed")==="false"');
  await evaluate('fixtureHost="remote-a";fixtureRerender()');await wait('document.querySelector('+JSON.stringify(flag)+')?.dataset.azraelSessionFlag.includes("remote-a")');check(theme+' unsetting local preserves remote flag',await active());
  await click(flag);await wait('document.querySelector('+JSON.stringify(flag)+').getAttribute("aria-pressed")==="false"');await evaluate('fixtureHost="local";fixtureRerender()');await wait('document.querySelector('+JSON.stringify(flag)+')?.dataset.azraelSessionFlag.includes("local")');
 }
 check('light/dark theme foreground differs',summary.light.foreground!==summary.dark.foreground);
 await click(flag);await wait('document.querySelector('+JSON.stringify(flag)+').getAttribute("aria-pressed")==="true"');
 check('native Ce preference publisher receives keyed state',await evaluate('fixtureEvents.some(e=>e.type==="persist"&&e.key==="azrael-session-flags"&&e.value[JSON.stringify(["local","same-id"])])'));
 await send('Page.reload');await wait('window.fixtureReady && !!document.querySelector('+JSON.stringify(flag)+')');check('native persisted atom restores after complete page reload',await active());
 for(const theme of ['light','dark']){
 await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme)+';document.body.dataset.vscodeThemeKind='+JSON.stringify('vscode-'+theme)+';fixtureEvents=[];fixtureOpen=false;fixtureRerender()');await wait('!document.querySelector('+JSON.stringify(flag)+')');await evaluate('fixtureOpen=true;fixtureRerender()');await wait('!!document.querySelector('+JSON.stringify(flag)+')');
 await click('button[aria-label="Archive chat"]');await wait('[...document.querySelectorAll("button")].some(e=>e.textContent==="Confirm")');
 check(theme+' native archive opens its confirmation without navigating',await evaluate('fixtureEvents.length===0'));await shot(theme+'-archive-confirm');
 await evaluate('[...document.querySelectorAll("button")].find(e=>e.textContent==="Confirm").click()');await wait('fixtureEvents.some(e=>e.type==="archive-success")');
 check(theme+' native archive confirmation invokes original service boundary',await evaluate('fixtureEvents.some(e=>e.type==="archive"&&e.conversationId==="same-id"&&e.hostId==="local")&&!fixtureEvents.some(e=>e.type==="navigate")'));
 }
 await evaluate('fixtureOpen=false;fixtureRerender()');await wait('!document.querySelector('+JSON.stringify(flag)+')');await evaluate('fixtureOpen=true;fixtureRerender()');await wait('!!document.querySelector('+JSON.stringify(flag)+')');await click('[data-thread-title]');await wait('fixtureEvents.some(e=>e.type==="navigate")');check('native row navigation remains available',true);
 check('no browser errors',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);
 summary.events=await evaluate('fixtureEvents');
summary.visualFindings='Hover shows only the outlined flag without a button tile in both themes; keyboard focus remains visible and archive stays separated. Active red flag precedes the time label. Native trailing-inset parent token is required by the reused row.';summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
 if(chrome?.exitCode===null&&chrome?.signalCode===null)await new Promise(r=>{const t=setTimeout(r,10000);chrome.once('exit',()=>{clearTimeout(t);r()})});
 summary.browserExitCode=chrome?.exitCode;summary.browserSignalCode=chrome?.signalCode;
 const allowed=join(root,'artifacts/verification')+sep;
 if(chrome&&(chrome.exitCode!==null||chrome.signalCode!==null)&&fixture.toLowerCase().startsWith(allowed.toLowerCase())){const cleanupScript=String.raw`try {
$ErrorActionPreference='Stop'
$taskRoot = [IO.Path]::GetFullPath($env:AZRAEL_FLAGS_FIXTURE)
$expectedParent = [IO.Path]::GetFullPath((Join-Path (Get-Location) 'artifacts/verification'))
if (-not $taskRoot.StartsWith($expectedParent+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected cleanup target' }
$preview = & ./scripts/clean-verification-artifacts.ps1 -FixtureRoot $taskRoot -IncludeDiagnosedFixtures -ReportPath $env:AZRAEL_FLAGS_CLEANUP_REPORT
if ($preview.status -ne 'preview' -or $preview.candidates.Count -ne 1 -or $preview.candidates[0].status -ne 'selected') { throw ('Cleanup guarded preview refused: '+($preview|ConvertTo-Json -Depth 8 -Compress)) }
# Use native removal after the project guard; its Apply archives evidence into
# a different owner's log directory, while this task must retain only its own logs.
$live = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { ($_.CommandLine -and $_.CommandLine.Replace('/','\').Contains($taskRoot)) -or ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskRoot,[StringComparison]::OrdinalIgnoreCase)) })
if ($live.Count) { throw 'Cleanup path still referenced by a live process' }
Remove-Item -LiteralPath $taskRoot -Recurse -ErrorAction Stop
if (Test-Path -LiteralPath $taskRoot) { throw 'Fixture survived cleanup' }
Write-Output 'Guarded preview selected owned fixture; native PowerShell removal confirmed absent.'
} catch { [Console]::Error.WriteLine($_); exit 1 }

`;
 const cleanup=spawn('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command','-'],{cwd:root,windowsHide:true,env:{...process.env,AZRAEL_FLAGS_FIXTURE:fixture,AZRAEL_FLAGS_CLEANUP_REPORT:join(logs,'cleanup-preview.json')},stdio:['pipe','pipe','pipe']});let output='';cleanup.stdout.on('data',b=>output+=b);cleanup.stderr.on('data',b=>output+=b);cleanup.stdin.end(cleanupScript);summary.cleanupExitCode=await new Promise((r,j)=>{cleanup.on('error',j);cleanup.on('exit',r)});await writeFile(join(logs,'cleanup.txt'),output);summary.cleanup=summary.cleanupExitCode===0?'Owned browser exited; project guarded preview passed; native PowerShell fixture/profile removal confirmed absent':'Cleanup failed; see cleanup.txt';if(summary.cleanupExitCode!==0)process.exitCode=1}else{summary.cleanup='Browser exit uncertain; profile retained until confirmed closed';process.exitCode=1}
 summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
