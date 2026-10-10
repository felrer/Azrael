import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const logs=resolve(process.env.AZRAEL_RENDER_LOG_ROOT||join(root,'artifacts/logs/missing-image'));
const fixture=resolve(process.env.AZRAEL_RENDER_FIXTURE_ROOT||join(root,'artifacts/verification/missing-image-render'));
assert(fixture.startsWith(join(root,'artifacts/verification')+sep));
assert(logs.startsWith(join(root,'artifacts/logs')+sep));
const assets=join(root,'artifacts/upstream-ui/26.1007.21434/webview/assets');
const profile=fixture;
const require=createRequire(import.meta.url);
const ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const {injectMissingImage,LOADER_ASSET,ATTACHMENT_ASSET}=require('./inject-missing-image.cjs');
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const mainName=LOADER_ASSET.split('/').at(-1),attachmentName=ATTACHMENT_ASSET.split('/').at(-1);
const main=injectMissingImage(await readFile(join(assets,mainName),'utf8'),LOADER_ASSET).text;
const attachment=injectMissingImage(await readFile(join(assets,attachmentName),'utf8'),ATTACHMENT_ASSET).text;
function named(source,name){const ast=ts.createSourceFile('fixture.js',source,99,true,1);const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(node,name);return node.getText(ast)}
const mainAdapter=`
export function fixtureRead(...args){
 const mg=async(_,{params})=>new Promise(resolve=>{window.fixtureReads.push({path:params.path,resolve})});
 const vh={warning:()=>{}};
 ${named(main,'Zwt')}
 ${named(main,'nw')}
 return nw(...args);
}
export function FixtureDialog(props){const le=()=>window.fixtureLocale;${named(main,'Cpi')}return k8.jsx(Cpi,props)}
`;
const attachmentAdapter=`
import {fixtureRead,FixtureDialog} from './${mainName}';
export function Fixture(){
 Rn();
 const f=()=>({value:{kind:'local',routeKind:'local-thread',conversationId:'fixture'}}),i=()=>window.fixtureLocale;
 const p=()=>window.fixtureQuery,m=()=> 'local',u=()=>false,wt=()=>false,vt=()=>({get:()=>false});
 const Pe=()=>({isError:false,src:null}),Je=fixtureRead,Be=FixtureDialog,te=({children})=>children,Ae=()=>{};
 ${named(attachment,'En')}
 ${named(attachment,'Dn')}
 const [src,setSrc]=In.useState('/missing.png');window.fixtureSetSource=setSrc;
 return $.jsx(Dn,{srcs:[src],conversationId:'fixture',hostId:'local',alt:'Verification image',imageSource:'uploaded',useImageDialog:true});
}
`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-1805ad19110d.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto flex w-full max-w-3xl flex-col p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureLocale={};window.fixtureReads=[];window.fixtureQuery={fetchQuery:({queryFn})=>queryFn({signal:new AbortController().signal})};window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {$At,XAt} from '/assets/app-initial-97d3534ad35f.js';import {Fixture} from '/assets/${attachmentName}';const $=$At();window.fixtureLocale={formatMessage:({defaultMessage})=>defaultMessage,formatNumber:(n,o)=>new Intl.NumberFormat('en-US',o).format(n)};window.reactRoot=XAt().createRoot(document.getElementById('root'));reactRoot.render($.jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);if(pathname===join(assets,mainName))source=main+mainAdapter;if(pathname===join(assets,attachmentName))source=attachment+attachmentAdapter;res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Transformed pinned native En/Dn, nw/Zwt and image dialog with native React/CSS; synthetic host query, locale, route/feature providers, telemetry sink and context-menu wrapper. No installed app/build.',checks:[]},pending=new Map(),exceptions=[];
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
 await wait('window.fixtureReady && fixtureReads.length>0');
 const screenshot=async name=>writeFile(join(logs,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));

 const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
 const setSource=async value=>{await evaluate('fixtureSetSource('+JSON.stringify(value)+')');await wait('fixtureReads.length>0')};
 const complete=async missing=>{await evaluate('fixtureReads.shift().resolve('+JSON.stringify(missing?{contentsBase64:null,fileNotFound:true}:{contentsBase64:image})+')')};
 for(const theme of ['light','dark']){
  await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme)+';document.body.dataset.vscodeThemeKind='+JSON.stringify('vscode-'+theme));
  if(theme==='dark')await setSource('/missing-dark.png');
  check(theme+' actual native loading spinner',await evaluate("!!document.querySelector('#root svg')&&!document.querySelector('#root [role=button]')&&!document.querySelector('#root img')"));
  await screenshot(theme+'-loading');await complete(true);
  await wait("document.querySelector('#root').innerText.includes('파일 없음')");
  check(theme+' missing text replaces spinner and trigger',await evaluate("document.querySelector('#root').innerText==='파일 없음'&&!document.querySelector('#root svg')&&!document.querySelector('#root [role=button]')"));
  const style=await evaluate("(()=>{let e=document.querySelector('#root [role=img]'),s=getComputedStyle(e),r=e.getBoundingClientRect();return {width:r.width,height:r.height,color:s.color,border:s.borderTopWidth,radius:s.borderRadius,label:e.getAttribute('aria-label')}})()");
  check(theme+' native missing geometry and accessibility',style.width===64&&style.height===64&&style.border==='1px'&&parseFloat(style.radius)>0&&style.label==='파일 없음');summary[theme]={style};
  await screenshot(theme+'-missing');await setSource('/valid-'+theme+'.png');
  check(theme+' new source clears missing immediately',await evaluate("!document.querySelector('#root').innerText.includes('파일 없음')&&!!document.querySelector('#root svg')"));
  await complete(false);await wait("!!document.querySelector('#root img')&&document.querySelector('#root img').complete&&document.querySelector('#root img').naturalWidth>0");
  check(theme+' valid native image trigger loads',await evaluate("!!document.querySelector('#root [role=button][tabindex=\"0\"]')&&!document.querySelector('#root').innerText.includes('파일 없음')"));
  await screenshot(theme+'-valid');
  await evaluate("document.querySelector('#root [role=button]').click()");await wait("!!document.querySelector('[role=dialog]')");
  check(theme+' native dialog opens by mouse',true);await screenshot(theme+'-dialog');
  await evaluate("document.querySelector('[aria-label=\"Close image preview\"]').click()");await wait("!document.querySelector('[role=dialog]')");
  await evaluate("document.querySelector('#root [role=button]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");await wait("!!document.querySelector('[role=dialog]')");
  check(theme+' native dialog opens by keyboard',true);
  await evaluate("document.querySelector('[aria-label=\"Close image preview\"]').click()");await wait("!document.querySelector('[role=dialog]')");
 }
 check('native themes change missing label color',summary.light.style.color!==summary.dark.style.color);
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
 if(chrome?.exitCode===null&&chrome?.signalCode===null)await new Promise(r=>{const t=setTimeout(r,10000);chrome.once('exit',()=>{clearTimeout(t);r()})});
 summary.browserExitCode=chrome?.exitCode;summary.browserSignalCode=chrome?.signalCode;
 const allowed=join(root,'artifacts/verification')+sep;
 if(chrome&&(chrome.exitCode!==null||chrome.signalCode!==null)&&fixture.startsWith(allowed)){const cleanupCommand=String.raw`$ErrorActionPreference='Stop'; $target=[IO.Path]::GetFullPath($env:AZRAEL_MISSING_IMAGE_FIXTURE); $allowed=[IO.Path]::GetFullPath($env:AZRAEL_MISSING_IMAGE_PARENT).TrimEnd('\')+'\'; if(-not $target.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw 'Fixture containment failed'}; for($cursor=$target;$cursor;$cursor=[IO.Path]::GetDirectoryName($cursor)){if((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Linked cleanup path'}}; for($attempt=0;$attempt -lt 20;$attempt++){ $references=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'chrome.exe' -and $_.CommandLine -and $_.CommandLine.Contains($target)}); if($references.Count -eq 0){break}; Start-Sleep -Milliseconds 250 }; if($references.Count -ne 0){throw 'Owned browser still references fixture'}; Remove-Item -LiteralPath $target -Recurse; if(Test-Path -LiteralPath $target){throw 'Fixture remains'}`;
 const cleanup=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',cleanupCommand],{windowsHide:true,env:{...process.env,AZRAEL_MISSING_IMAGE_FIXTURE:fixture,AZRAEL_MISSING_IMAGE_PARENT:join(root,'artifacts/verification')},stdio:['ignore','pipe','pipe']});let cleanupOutput='';cleanup.stdout.on('data',c=>cleanupOutput+=c);cleanup.stderr.on('data',c=>cleanupOutput+=c);const cleanupExit=await new Promise((r,j)=>{cleanup.on('error',j);cleanup.on('exit',r)});summary.cleanupExitCode=cleanupExit;summary.cleanup=cleanupExit===0?'Owned browser exited; guarded native PowerShell fixture/profile removal verified':cleanupOutput; if(cleanupExit!==0)process.exitCode=1}else{summary.cleanup='Browser exit uncertain; profile retained until confirmed closed';process.exitCode=1}
 summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
