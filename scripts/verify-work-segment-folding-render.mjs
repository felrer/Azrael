import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'artifacts/verification/work-segment-folding-render');
const logs = join(root, 'artifacts/logs/work-segment-folding-20261009/implementation');
const assets = join(root, 'artifacts/upstream-ui/26.1007.21434/webview/assets');
const require = createRequire(import.meta.url);
const { productionPolicy } = require('./test-work-segment-folding.cjs');
const { injectDeferredPresentation, injectDeferredCollapsed, injectDeferredWaitRenderer } = require('./inject-deferred-turn.cjs');
const { injectWorkSegmentWaiting } = require('./inject-work-segment-folding.cjs');
const policy = productionPolicy();
const ts = require(require.resolve('typescript', { paths: [join(root, 'extensions/azrael-ex')] }));
const activityName = 'sites-end-resource-90d3046b3014.js';
const presentationName = 'app-initial-c014f9ee4429.js';
const disclosureName = 'collapsed-turn-disclosure-de639e3d6c71.js';
const nativeSources = new Map();
// Only fixture host query/telemetry/localization dependencies are substituted.
// Native XO, YO, fO, disclosure, memo caches and animation remain in their module.
function adaptFunctions(source, changes) {
  const ast = ts.createSourceFile('native.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [];
  for (const [name, aliases] of Object.entries(changes)) {
    const owner = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
    assert.ok(owner, 'Pinned native function ' + name);
    function visit(n) {
      if (ts.isIdentifier(n) && aliases[n.text] && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n))
        edits.push({ start: n.getStart(ast), end: n.end, text: aliases[n.text] });
      ts.forEachChild(n, visit);
    }
    visit(owner);
  }
  for (const e of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, e.start) + e.text + source.slice(e.end);
  return source;
}
const message = `function fixtureMessage({defaultMessage,values={}}){return defaultMessage.replace(/\\{(\\w+)\\}/g,(_,k)=>values[k]??k).replace(/\\{count, plural,.*\\}/,values.count+' previous messages')}`;
nativeSources.set(disclosureName, adaptFunctions(injectDeferredCollapsed(await readFile(join(assets, disclosureName), 'utf8')).text, { C: { r: 'fixtureMessage' } }) + '\n' + message);
nativeSources.set(presentationName, adaptFunctions(injectDeferredPresentation(await readFile(join(assets, presentationName), 'utf8')).text, { zzi: { U: 'fixtureMessage' }, Vzi: { le: 'fixtureLocale' } }) + `\n${message}\nconst fixtureLocale=()=>({locale:'en-US'});export {Cyt as fixtureProjectActivity,Gzi as fixtureInitClock};`);
const adapter = `
import {fixtureProjectActivity,fixtureInitClock} from './${presentationName}';
const fixtureLogger=()=>({logProductEvent(){}}),fixtureEnvironment=()=>({}),fixtureNoop=()=>{};
const fixtureHost=()=>({}),fixtureQuery=()=>({data:[]}),fixtureReducedMotion=()=>true,fixtureNoState=()=>null,fixtureScale=()=>1;
const fixturePolicy=input=>{${policy.body}};
const fixtureSelectHeader=(Ji,o=null,ft=null)=>{${policy.headerBody}};
window.fixtureNow=20000;Date.now=()=>fixtureNow;
window.fixtureCases=[{id:'stopped-a',l:'terminal',K:true},{id:'stopped-b',l:'active',K:false,status:'deferred'},{id:'active',l:'active',K:true}];
window.fixtureReset=()=>{fixtureCases=[{id:'stopped-a',l:'terminal',K:true},{id:'stopped-b',l:'active',K:false,status:'deferred'},{id:'active',l:'active',K:true}];fixtureRerender()};
function Fixture(){sk();fixtureInitClock();const [,update]=ak.useState(0);window.fixtureRerender=()=>update(n=>n+1);
return ok.jsx('div',{className:'flex flex-col gap-6',children:fixtureCases.map(c=>{
const input={l:c.l,b:{status:c.status??'in_progress'},K:c.K,xn:c.approval?{}:null,Cn:c.question?{completed:false}:null,wn:[],Dn:[],Pt:false,G:!!c.full,Pe:!!c.intro,$e:'on',U:true,A:1,j:2,Qe:false,fr:true};
const gates=fixturePolicy(input);
const item={id:c.id+'-body',type:c.compaction?'context-compaction':'generated-image',status:'completed',startedAtMs:12000};
const projectionStatus=c.status==='deferred'?'deferred':c.l==='active'&&c.K?'in_progress':'complete';
const initialItems=c.empty||c.waitOnly?[]:[item];
const items=fixtureProjectActivity({items:projectionStatus==='complete'?[...initialItems,{id:'fixture-final',type:'assistant-message',phase:'final_answer',delivery:'sync'}]:initialItems,status:projectionStatus,workStartedAtMs:c.waitOnly?null:12000,finalAssistantStartedAtMs:c.duration===null||projectionStatus==='in_progress'?null:20000,rootResumeWait:c.status==='deferred'&&!c.waitUnknown?{reservationId:'fixture-wait',revision:c.revision??(c.waitEnded?2:1),state:c.waitEnded?'resumed':'waiting',waitStartedAtMs:20000,waitEndedAtMs:c.waitEnded??null,resumeAtMs:c.resumeAt??80000,canWakeEarly:false}:null}).filter(i=>i.id!=='fixture-final');
const work=fixtureSelectHeader(items);
const units=items.map((i,index)=>({kind:'standalone',key:c.id+'-'+index,item:{item:i}}));
const body=ok.jsx('div',{className:'rounded-lg border border-default p-3 text-default',children:'Native activity slot: '+c.id});
const props={conversationId:'fixture-thread',hostId:'local',isReadOnly:true,isTurnInProgress:c.K,mcpServerStatuses:new Map(),renderMcpApps:false,standaloneActivityContentByItemId:new Map([[item.id,body]]),wrapSearchableContent:({item,content})=>ok.jsx('div',{'data-wait':item.type==='worked-for'&&item!==work?'':undefined,children:content})};
return ok.jsxs('section',{'data-segment':c.id,children:[ok.jsx('h2',{className:'text-sm font-semibold text-default',children:c.id}),ok.jsx(XO,{...gates,units,agentActivityProps:props,visibleAgentActivityProps:{},hasFinalAssistantStarted:!!c.final,isTurnCancelled:false,hasInlineSubagentActivity:false,workedDurationMs:c.duration===null?null:8000,workedForItem:work}),c.approval||c.question?ok.jsx('button',{'data-request':'',className:'rounded-lg border border-default p-2 text-default',onClick:()=>{window.fixtureRequestActions=(window.fixtureRequestActions??0)+1},children:c.approval?'Approve pending request':'Answer pending question'}):null]},c.id);
})})}
export {Fixture};`;
nativeSources.set(activityName, adaptFunctions(injectWorkSegmentWaiting(injectDeferredWaitRenderer(await readFile(join(assets, activityName), 'utf8')).text).text, { GO: { _e: 'fixtureLogger', vi: 'fixtureEnvironment', cc: 'fixtureNoop' }, wO: { Ie: 'fixtureHost', ba: 'fixtureQuery' }, $O: { Sd: 'fixtureReducedMotion' }, RD: { Ie: 'fixtureHost', _e: 'fixtureNoState', g: 'fixtureHost', Be: 'fixtureNoState', vi: 'fixtureScale' } }) + adapter);
const html = `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5b2ced5ef25.css"><link rel="stylesheet" href="/assets/app-initial-1805ad19110d.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto max-w-3xl p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {$At,nLt,XAt,Pbt,Nbt} from '/assets/app-initial-97d3534ad35f.js';import {Fixture} from '/assets/${activityName}';window.reactRoot=XAt().createRoot(document.getElementById('root'));Pbt();reactRoot.render($At().jsx(Nbt,{locale:'en-US',messages:{},children:$At().jsx(Fixture,{})}));window.fixtureReady=true;</script></body></html>`;
await mkdir(join(fixture, 'chrome-profile'), { recursive: true });await mkdir(logs, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html');res.end(html);return; }
    if (!req.url.startsWith('/assets/')) { res.statusCode=404;res.end();return; }
    const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);
    assert.ok(pathname.startsWith(assets+sep));
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]??'application/octet-stream');
    res.end(nativeSources.get(pathname.slice(assets.length+1))??await readFile(pathname));
  } catch(e) { res.statusCode=500;res.end(String(e)); }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let chrome,socket,session,id=0;const pending=new Map(),exceptions=[];
const summary={scope:'Production Cyt work/wait projection and Ks gating/header-selection expressions with transformed native VO/XO/YO/fO/$O/GO/disclosure and current-pin CSS. Native persistentContent renders wait units directly; no outside wait DOM. Fixture substitutes host queries, telemetry, reduced-motion preference, localization and generated-image body slot.',transformCounts:{turn:policy.result.count,activity:1,aggregate:policy.result.count+1},checks:[],limitations:['Pending requests are represented by actionable fixture buttons; native approval/question card acceptance remains separate.','Full Ks page layout and installed webview are not mounted.'],outcome:'running'};
summary.inputSha256={};for(const file of ['scripts/inject-work-segment-folding.cjs','scripts/test-work-segment-folding.cjs','scripts/verify-work-segment-folding-render.mjs','scripts/inject-deferred-turn.cjs','scripts/root-resume-wait.cjs',...['local-conversation-turn-9fb266d5c020.js',activityName,presentationName,disclosureName].map(n=>'artifacts/upstream-ui/26.1007.21434/webview/assets/'+n)])summary.inputSha256[file]=createHash('sha256').update(await readFile(join(root,file))).digest('hex');
try {
  chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+join(fixture,'chrome-profile')],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((r,j)=>{let output='';const timer=setTimeout(()=>j(Error('Chrome startup timeout')),20000);chrome.stderr.on('data',c=>{output+=c;const m=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);r(m[1])}});chrome.once('error',j)});
  socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.j(Error(JSON.stringify(m.error))):p.r(m.result)}}});
  const send=(method,params={},sid=session)=>new Promise((r,j)=>{const n=++id,timer=setTimeout(()=>j(Error('CDP timeout '+method)),20000);pending.set(n,{r,j,timer});socket.send(JSON.stringify({id:n,method,params,...(sid?{sessionId:sid}:{})}))});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Wait failed '+expression+' '+JSON.stringify(await evaluate('({errors:fixtureErrors,body:document.body.innerText})')))};
  const check=(name,value)=>{assert.ok(value,name);summary.checks.push(name)};
  session=(await send('Target.attachToTarget',{targetId:(await send('Target.createTarget',{url:'about:blank'},null)).targetId,flatten:true},null)).sessionId;
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:1000,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
  await wait("!!(window.fixtureReady&&document.querySelector('[data-segment=stopped-a] button[aria-expanded]'))");
  const expanded=id=>evaluate(`document.querySelector('[data-segment="${id}"] button[aria-expanded]')?.getAttribute('aria-expanded')`);
  const click=async(id,selector='button[aria-expanded]')=>{const rect=await evaluate(`(()=>{const r=document.querySelector('[data-segment="${id}"] ${selector}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});await new Promise(r=>setTimeout(r,300))};
  const key=async(id,key,code,vk)=>{await evaluate(`document.querySelector('[data-segment="${id}"] button[aria-expanded]').focus()`);await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk,text:key==='Enter'?'\r':key});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk});await new Promise(r=>setTimeout(r,300))};
  const shot=async name=>writeFile(join(logs,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  for(const theme of ['light','dark']) {
    await evaluate('fixtureCases=[];fixtureRerender()');await new Promise(r=>setTimeout(r,100));
    await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixtureReset()`);
    check(theme+' initial stopped activity expanded',await expanded('stopped-a')==='true'&&await expanded('stopped-b')==='true');
    check(theme+' active segment has no fold toggle',await expanded('active')===undefined);
    await click('stopped-a');check(theme+' mouse collapses stopped native activity',await expanded('stopped-a')==='false');
    await key('stopped-a','Enter','Enter',13);check(theme+' Enter expands',await expanded('stopped-a')==='true');
    await key('stopped-a',' ','Space',32);check(theme+' Space collapses',await expanded('stopped-a')==='false');
    check(theme+' sibling remains independently expanded',await expanded('stopped-b')==='true');
    await click('stopped-b');check(theme+' deferred work collapses independently',await expanded('stopped-b')==='false');
    const waitVisible=()=>evaluate("(()=>{const e=document.querySelector('[data-wait]'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.height>10&&r.width>40&&s.display!=='none'&&s.visibility!=='hidden'})()");
    check(theme+' active wait row remains visible while work is collapsed',await waitVisible());
    check(theme+' header selects actual frozen work marker',await evaluate("document.querySelector('[data-segment=stopped-b] button').innerText.includes('Worked for 8s')"));
    const waitBeforeMetadata=await evaluate("document.querySelector('[data-wait]').innerText");
    await evaluate("fixtureCases.find(c=>c.id==='stopped-b').resumeAt=95000;fixtureCases.find(c=>c.id==='stopped-b').revision=2;fixtureRerender()");
    check(theme+' wait-only metadata updates native persistent row at unchanged clock and status',waitBeforeMetadata!==await evaluate("document.querySelector('[data-wait]').innerText"));
    check(theme+' wait metadata update preserves collapsed state and real work header',await expanded('stopped-b')==='false'&&await evaluate("document.querySelector('[data-segment=stopped-b] button').innerText.includes('Worked for 8s')"));
    await shot(theme+'-active-wait');
    await click('stopped-b');check(theme+' expanded native units do not duplicate wait or work header',await evaluate("document.querySelectorAll('[data-segment=stopped-b] [data-wait]').length===1&&(document.querySelector('[data-segment=stopped-b]').innerText.match(/Worked for 8s/g)||[]).length===1"));await click('stopped-b');
    await evaluate("fixtureCases.push({id:'resume',l:'active',K:true});fixtureRerender()");check(theme+' new resume preserves old manual collapse',await expanded('stopped-a')==='false');
    await evaluate("fixtureCases=fixtureCases.map(c=>({...c,historyVersion:2,lateEvent:true}));fixtureRerender()");check(theme+' history and late event update preserve disclosure state',await expanded('stopped-a')==='false'&&await expanded('stopped-b')==='false');
    const old=await evaluate("document.querySelector('[data-segment=stopped-a] button').innerText"),active=await evaluate("document.querySelector('[data-segment=active]').innerText"),waiting=await evaluate("document.querySelector('[data-wait]').innerText");
    await evaluate('fixtureNow+=3000');await new Promise(r=>setTimeout(r,1150));
    check(theme+' stopped work clock stays frozen',old===await evaluate("document.querySelector('[data-segment=stopped-a] button').innerText"));
    check(theme+' wait clock ticks outside collapsed body',waiting!==await evaluate("document.querySelector('[data-wait]').innerText"));
    check(theme+' active work clock ticks',active!==await evaluate("document.querySelector('[data-segment=active]').innerText"));
    check(theme+' real work header stays fixed as wait clock advances',await evaluate("document.querySelector('[data-segment=stopped-b] button').innerText.includes('Worked for 8s')"));
    await evaluate("fixtureCases.find(c=>c.id==='stopped-b').waitEnded=fixtureNow;fixtureRerender()");check(theme+' ended wait row remains visible while work is collapsed',await waitVisible());
    const endedWait=await evaluate("document.querySelector('[data-wait]').innerText");await evaluate('fixtureNow+=3000');await new Promise(r=>setTimeout(r,1150));check(theme+' ended wait stays fixed',endedWait===await evaluate("document.querySelector('[data-wait]').innerText"));
    await evaluate("fixtureCases.find(c=>c.id==='stopped-b').waitUnknown=true;fixtureRerender()");check(theme+' unknown wait remains visible while collapsed',await waitVisible()&&await evaluate("document.querySelector('[data-wait]').innerText.includes('대기 시간 확인 불가')")&&await expanded('stopped-b')==='false');
    check(theme+' unknown wait does not replace frozen work header',await evaluate("document.querySelector('[data-segment=stopped-b] button').innerText.includes('Worked for 8s')"));await shot(theme+'-unknown-wait');
    await evaluate("fixtureCases.find(c=>c.id==='stopped-b').waitUnknown=false;fixtureRerender()");
    const style=await evaluate("(()=>{const e=document.querySelector('[data-segment=stopped-a] button'),s=getComputedStyle(e),r=e.getBoundingClientRect();return {color:s.color,font:s.fontFamily,width:r.width,height:r.height,border:getComputedStyle(document.querySelector('[data-segment=stopped-a] .border-t')).borderTopWidth}})()");
    summary[theme]={style};check(theme+' native disclosure geometry',style.width>40&&style.height>10&&style.border==='1px');await shot(theme+'-collapsed');
    await evaluate("fixtureCases.push({id:'approval',l:'terminal',K:false,approval:true},{id:'question',l:'terminal',K:false,question:true},{id:'empty',l:'terminal',K:false,empty:true},{id:'compaction',l:'terminal',K:false,compaction:true},{id:'completed',l:null,K:false,final:true},{id:'full',l:'terminal',K:false,full:true},{id:'intro',l:'terminal',K:false,intro:true},{id:'empty-wait',l:'terminal',K:false,status:'deferred',empty:true},{id:'wait-only',l:'terminal',K:false,status:'deferred',waitOnly:true},{id:'compaction-wait',l:'terminal',K:false,status:'deferred',compaction:true},{id:'unknown-work',l:'terminal',K:false,status:'deferred',duration:null});fixtureRerender()");
    check(theme+' pending approval and question folding excluded',await expanded('approval')===undefined&&await expanded('question')===undefined);
    await click('approval','button[data-request]');await click('question','button[data-request]');check(theme+' pending fixture requests remain actionable',await evaluate('fixtureRequestActions>=2'));
    check(theme+' empty and compaction excluded',await expanded('empty')===undefined&&await expanded('compaction')===undefined);
    check(theme+' full transcript and intro excluded',await expanded('full')===undefined&&await expanded('intro')===undefined);
    check(theme+' normal completed baseline uses native final eligibility',await expanded('completed')==='true');
    check(theme+' empty and wait-only rows have visible native wait without fold toggles',await expanded('empty-wait')===undefined&&await expanded('wait-only')===undefined&&await evaluate("['empty-wait','wait-only'].every(id=>document.querySelector('[data-segment='+id+'] [data-wait]').getBoundingClientRect().height>10)"));
    check(theme+' context compaction plus wait does not create a fold toggle',await expanded('compaction-wait')===undefined&&await evaluate("document.querySelector('[data-segment=compaction-wait] [data-wait]').getBoundingClientRect().height>10"));
    check(theme+' unknown work duration remains explicit',await evaluate("document.querySelector('[data-segment=unknown-work] button').innerText.includes('작업 시간 확인 불가')"));
    await shot(theme+'-safety');
  }
  check('native theme changes color',summary.light.style.color!==summary.dark.style.color);
  check('no uncaught browser exceptions',exceptions.length===0&&await evaluate('fixtureErrors.length===0'));
  summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
} catch(e) { summary.outcome='failed';summary.error=String(e.stack??e);summary.exceptions=exceptions;process.exitCode=1; }
finally {
  server.closeAllConnections();await new Promise(r=>server.close(r));
  if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,300));socket.close();}
  for(const p of pending.values())clearTimeout(p.timer);
  if(chrome?.exitCode===null)await new Promise(r=>{const timer=setTimeout(r,20000);chrome.once('exit',()=>{clearTimeout(timer);r()})});
  // The native process-reference guard is authoritative for cleanup; Windows
  // is checked even when spawn bookkeeping has no exit code.
  summary.browserExit={exitCode:chrome?.exitCode,signalCode:chrome?.signalCode};
  {
    const command="$ErrorActionPreference='Stop'; $target=[IO.Path]::GetFullPath($env:AZRAEL_FOLD_FIXTURE); $parent=[IO.Path]::GetFullPath($env:AZRAEL_FOLD_PARENT).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar; if(-not $target.StartsWith($parent,[StringComparison]::OrdinalIgnoreCase)){throw 'Containment failed'}; for($cursor=$target;$cursor;$cursor=[IO.Path]::GetDirectoryName($cursor)){if((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Reparse point found'}}; for($attempt=0;$attempt -lt 60;$attempt++){ $references=@(Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($target) -and $_.Name -eq 'chrome.exe'}); if($references.Count -eq 0){break}; Start-Sleep -Milliseconds 250 }; if($references.Count){throw 'Browser reference remains'}; Remove-Item -LiteralPath $target -Recurse; if(Test-Path -LiteralPath $target){throw 'Fixture remains'}";
    const cleanup=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,env:{...process.env,AZRAEL_FOLD_FIXTURE:fixture,AZRAEL_FOLD_PARENT:join(root,'artifacts/verification')},stdio:['ignore','pipe','pipe']});let output='';cleanup.stdout.on('data',c=>output+=c);cleanup.stderr.on('data',c=>output+=c);summary.cleanupExitCode=await new Promise((r,j)=>{cleanup.once('error',j);cleanup.once('exit',r)});await writeFile(join(logs,'cleanup.log'),output);if(summary.cleanupExitCode!==0)process.exitCode=1;else {summary.cleanup='No browser profile references; guarded ordinary removal verified fixture absence';chrome?.stderr?.destroy();chrome?.unref();}
  }
  summary.exitCode=process.exitCode??0;await writeFile(join(logs,'render-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks.length,error:summary.error,cleanupExitCode:summary.cleanupExitCode,exitCode:summary.exitCode}));
}
