import artifactRunTools from './artifact-run.cjs';
const {beginArtifactRun,trackArtifactChild}=artifactRunTools;
import {createRequire} from 'node:module';
import {spawn as nativeSpawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const artifactRun=beginArtifactRun(root,{workId:'verify-parent-request-activity-render',owner:'scripts/verify-parent-request-activity-render.mjs',paths:{...(process.env.AZRAEL_RENDER_FIXTURE_ROOT ? {temporary:resolve(process.env.AZRAEL_RENDER_FIXTURE_ROOT)} : {}),...(process.env.AZRAEL_RENDER_LOG_ROOT ? {logs:resolve(process.env.AZRAEL_RENDER_LOG_ROOT)} : {})}});
const spawn=(...args)=>trackArtifactChild(artifactRun,nativeSpawn(...args));
const confirmOwnedBrowserExit=(child,profilePath)=>artifactRunTools.confirmOwnedBrowserExit(child,profilePath,spawn);
const fixture=artifactRun.temporary,logs=artifactRun.logs,profile=join(fixture,'chrome-profile');
const assets=join(root,'artifacts/upstream-ui/26.1007.21434/webview/assets');
const require=createRequire(import.meta.url),{prepared,productionProjection,productionConversation}=require('./test-parent-request-activity.cjs');
const inputs=prepared(),project=productionProjection(),nativeSources=new Map();
const activityName=inputs[1].asset.split('/').at(-1);
const request={requestId:'r1',status:'pending',question:'Allow <img src=x onerror="window.injected=true"> execution?',context:'Review isolated local changes.\nPreserve existing work.',recommendation:'Proceed after checking the selected files.',blockedAction:'Apply the approved change.',createdAtMs:1,updatedAtMs:1,response:null};
const raw=(id,kind='interacted',parentRequest)=>({id,type:'subAgentActivity',kind,agentThreadId:'child',agentPath:'root/curie',...(parentRequest?{parentRequest}:{})});
const initial=project([raw('parent-request-r1','interacted',request),raw('parent-request-r2','interacted',{...request,requestId:'r2',question:'A separate decision'}),raw('completion','completed'),raw('report')]);
const conversation=productionConversation(),groupedRaw=[raw('parent-request-r1','interacted',request),{...raw('completed-b','completed'),agentThreadId:'child-b',agentPath:'root/ada'},{...raw('parent-request-r2','interacted',{...request,requestId:'r2',question:'Second agent decision'}),agentThreadId:'child-b',agentPath:'root/ada'},raw('completion','completed'),raw('parent-request-r3','interacted',{...request,requestId:'r3',question:'Another request from Curie'})];
const groupedRows=conversation.rows(groupedRaw,[{conversationId:'child',parentTurnKey:'parent',status:'done'}]),standalone=conversation.standalone(groupedRaw).map(x=>x.presentation);
for(const input of inputs)nativeSources.set(input.asset.split('/').at(-1),input.text);
const turnName=inputs[2].asset.split('/').at(-1),threadName=inputs[3].asset.split('/').at(-1);
nativeSources.set(turnName,inputs[2].text+`\nexport function FixtureWork({rows}){Gs();return Ws.jsx(Vs,{rows,status:'updated'})}`);
// Adapt only the external background-agent subscription. The full native xm
// presentation, ZT grouping and Vs renderer remain the production functions.
const subscription='i=C(Gs,r),a,o,s';assert.equal(inputs[3].text.split(subscription).length,2);
nativeSources.set(threadName,inputs[3].text.replace(subscription,'i=window.fixtureBackgroundAgents,a,o,s')+`\nexport function FixtureConversation({presentations}){Dm();return Em.jsx('div',{children:presentations.map(n=>Em.jsx(xm,{presentation:n,conversationId:'root'},n.activityKind))})}`);
// Execute production native nE (not a fixture copy), native avatar, offset and
// Wu row layout. Host context is absent; React Intl is the native provider.
nativeSources.set(activityName,inputs[1].text+`\nwindow.fixtureItems=${JSON.stringify(initial)};window.fixtureMode='direct';window.fixtureRows=${JSON.stringify(groupedRows)};window.fixturePresentations=${JSON.stringify(standalone)};window.fixtureBackgroundAgents=[];
function Fixture(){oE();const[,update]=iE.useState(0);window.fixtureRerender=()=>update(n=>n+1);return aE.jsx('div',{className:'flex min-w-0 flex-col gap-4',children:fixtureMode==='direct'?fixtureItems.map(item=>aE.jsx('div',{'data-item':item.id,children:aE.jsx(nE,{item})},item.id)):fixtureMode==='work'?aE.jsx(window.FixtureWork,{rows:fixtureRows}):aE.jsx(window.FixtureConversation,{presentations:fixturePresentations})})}
export {Fixture};`);
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5b2ced5ef25.css"><link rel="stylesheet" href="/assets/app-initial-1805ad19110d.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto w-full max-w-3xl p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {$At,XAt,Pbt,Nbt} from '/assets/app-initial-97d3534ad35f.js';import {Fixture} from '/assets/${activityName}';Pbt();window.reactRoot=XAt().createRoot(document.getElementById('root'));window.fixtureLocale='ko-KR';window.fixtureRender=()=>reactRoot.render($At().jsx(Nbt,{locale:fixtureLocale,messages:{},children:$At().jsx(Fixture,{})}));fixtureRender();window.fixtureReady=true;</script></body></html>`;
await mkdir(join(fixture,'chrome-profile'),{recursive:true});await mkdir(logs,{recursive:true});
const summary={scope:'Native nC, conversation np/ap projection, work ZT/Vs and standalone xm/ ZT/Vs render paths, individual nE disclosures, native overlapping-avatar IO and pinned CSS on Windows headless Chrome. Only background-agent subscription is adapted. No product build or installed-host acceptance.',checks:[],transformCounts:Object.fromEntries(inputs.map(x=>[x.asset,x.count])),inputSha256:{},outcome:'running'};
// Hash every selected script and all pinned UI input bytes before browser work;
// selected transform bytes are held in nativeSources for this entire run.
for(const name of ['scripts/inject-parent-request-activity.cjs','scripts/test-parent-request-activity.cjs','scripts/verify-parent-request-activity-render.mjs',...inputs.map(x=>'artifacts/upstream-ui/26.1007.21434/'+x.asset),...['app-initial-97d3534ad35f.js','app-initial-aad627bd9dff.css','app-initial-49150e6a0951.css','app-initial-f5b2ced5ef25.css','app-initial-1805ad19110d.css'].map(x=>'artifacts/upstream-ui/26.1007.21434/webview/assets/'+x)])summary.inputSha256[name]=createHash('sha256').update(await readFile(join(root,name))).digest('hex');
summary.runId='AR-ui-'+Date.now();
summary.servedSourceSha256=createHash('sha256').update([...nativeSources.values()].join('\n')).update(html).digest('hex');
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}if(!req.url.startsWith('/assets/')){res.statusCode=404;res.end();return}const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);assert(pathname.startsWith(assets+sep));res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]??'application/octet-stream');res.end(nativeSources.get(pathname.slice(assets.length+1))??await readFile(pathname))}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let chrome,socket,session,id=0;const pending=new Map(),exceptions=[];
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

  await wait("window.fixtureReady&&!!document.querySelector('[data-testid=parent-request-activity-row]')");
  await evaluate(`(async()=>{window.FixtureWork=(await import('/assets/${turnName}')).FixtureWork;window.FixtureConversation=(await import('/assets/${threadName}')).FixtureConversation})()`);
  const selector=id=>'[data-item="'+id+'"] button[aria-expanded]';
  const expanded=id=>evaluate(`document.querySelector(${JSON.stringify(selector(id))})?.getAttribute('aria-expanded')`);
  const click=async id=>{const rect=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector(id))}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});await new Promise(r=>setTimeout(r,120))};
  const key=async(id,key,code,vk)=>{await evaluate(`document.querySelector(${JSON.stringify(selector(id))}).focus()`);await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk,text:key==='Enter'?'\r':key});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk});await new Promise(r=>setTimeout(r,120))};
  const shot=async name=>writeFile(join(logs,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const clickSelector=async selector=>{const rect=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});await new Promise(r=>setTimeout(r,120))};
  const colors={};
  for(const theme of ['light','dark']){
   await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}'`);
   check(theme+' native completion and ordinary report unchanged',await evaluate(`(()=>{const a=document.querySelector('[data-item=completion]'),b=document.querySelector('[data-item=report]');return a.innerText.includes('Curie')&&a.innerText.includes('finished')&&!!a.querySelector('[data-testid=subagent-activity-row]')&&b.innerText.includes('Sent message')&&!a.querySelector('[aria-expanded]')&&!b.querySelector('[aria-expanded]')})()`));
   check(theme+' two requests from same child stay separate',await evaluate("document.querySelectorAll('[data-testid=parent-request-activity-row]').length===2"));
   check(theme+' pending Korean full label',await evaluate("document.querySelector('[data-item=parent-request-r1] button').innerText==='Curie: 판단 요청'"));
   if(await expanded('parent-request-r1')==='true')await click('parent-request-r1');
   await click('parent-request-r1');check(theme+' mouse opens independent details',await expanded('parent-request-r1')==='true'&&await expanded('parent-request-r2')==='false');
   check(theme+' native avatar and detail fields',await evaluate("!!document.querySelector('[data-item=parent-request-r1] img.icon-sm')&&document.querySelector('[data-item=parent-request-r1] dl').innerText.includes('추천')&&document.querySelector('[data-item=parent-request-r1] dl').innerText.includes('대기 중인 작업')"));
   check(theme+' dynamic typography preserves fixed status and field labels',await evaluate("(()=>{const r=document.querySelector('[data-item=parent-request-r1]'),b=r.querySelector('button'),n=b.querySelector('.font-content');return n?.textContent==='Curie'&&n.parentElement.querySelectorAll('.font-content').length===1&&[...r.querySelectorAll('dd')].every(e=>e.classList.contains('font-content'))&&[...r.querySelectorAll('dt')].every(e=>!e.classList.contains('font-content'))&&!n.parentElement.lastElementChild.classList.contains('font-content')})()"));
   check(theme+' malicious question remains inert text',await evaluate("!window.injected&&document.querySelectorAll('[data-item=parent-request-r1] img').length===1&&document.querySelector('[data-item=parent-request-r1] dd').textContent.includes('<img')"));
   await key('parent-request-r1','Enter','Enter',13);check(theme+' Enter closes',await expanded('parent-request-r1')==='false');
   await key('parent-request-r1',' ','Space',32);check(theme+' Space opens',await expanded('parent-request-r1')==='true');
   const next=project([raw('parent-request-r1','interacted',{...request,status:'resolved',updatedAtMs:2,response:{status:'resolved',decision:'Proceed',reason:'Required checks pass',retryCondition:'After a new failure'}})])[0];
   await evaluate(`fixtureItems=fixtureItems.map(x=>x.id==='parent-request-r1'?${JSON.stringify(next)}:x);fixtureRerender()`);
   await wait("document.querySelector('[data-item=parent-request-r1]').innerText.includes('판단 완료')");
   check(theme+' same-id full item update preserves open disclosure',await expanded('parent-request-r1')==='true');
   check(theme+' parent response detail renders',await evaluate("['Proceed','Required checks pass','After a new failure'].every(x=>document.querySelector('[data-item=parent-request-r1] dl').innerText.includes(x))"));
   for(const [status,label] of [['deferred','판단 보류'],['cancelled','요청 취소']]){await evaluate(`fixtureItems=fixtureItems.map(x=>x.id==='parent-request-r2'?{...x,parentRequest:{...x.parentRequest,status:'${status}'}}:x);fixtureRerender()`);await wait(`document.querySelector('[data-item=parent-request-r2]').innerText.includes('${label}')`);check(theme+' '+status+' state is separate',await expanded('parent-request-r1')==='true'&&await expanded('parent-request-r2')==='false')}
   const style=await evaluate("(()=>{const b=document.querySelector('[data-testid=parent-request-activity-row]'),r=b.getBoundingClientRect(),s=getComputedStyle(b);return{color:s.color,width:r.width,height:r.height,font:s.fontFamily}})()");colors[theme]=style.color;summary[theme]=style;check(theme+' native row has styled geometry',style.width>100&&style.height>=16&&!style.font.includes('Times New Roman'));
   check(theme+' no answer controls',await evaluate("!document.querySelector('input,textarea,select')&&document.querySelectorAll('button').length===2"));
   await shot(theme+'-expanded');
   await send('Emulation.setDeviceMetricsOverride',{width:360,height:1000,deviceScaleFactor:1,mobile:false});
   check(theme+' narrow request stays within viewport',await evaluate("document.documentElement.scrollWidth<=360&&[...document.querySelectorAll('[data-testid=parent-request-activity-row],dd')].every(e=>e.getBoundingClientRect().right<=360)"));await shot(theme+'-narrow');
   await send('Emulation.setDeviceMetricsOverride',{width:1000,height:1000,deviceScaleFactor:1,mobile:false});
   await evaluate(`fixtureItems=${JSON.stringify(initial)};fixtureRerender()`);await wait("document.querySelector('[data-item=parent-request-r1]').innerText.includes('판단 요청')");
   for(const mode of ['work','conversation']){
    await evaluate(`fixtureMode='${mode}';fixtureRows=${JSON.stringify(groupedRows)};fixturePresentations=${JSON.stringify(standalone)};fixtureRerender()`);
    await wait("!!document.querySelector('[data-testid=parent-request-activity-summary]')");
    check(theme+' '+mode+' mixed activities have separate grouped summaries',await evaluate("document.querySelectorAll('[data-testid=parent-request-activity-summary]').length===1&&document.querySelectorAll('[data-testid=subagent-activity-inline-group]').length===1"));
    check(theme+' '+mode+' requests and completions each retain native overlapping avatars',await evaluate("[...document.querySelectorAll('[data-testid=parent-request-activity-summary],[data-testid=subagent-activity-inline-group]')].every(e=>e.querySelectorAll('img').length===2&&e.innerText.includes('Curie')&&e.innerText.includes('Ada'))"));
    check(theme+' '+mode+' pending is distinct from actual completion',await evaluate("document.querySelector('[data-testid=parent-request-activity-summary]').innerText.includes('판단 요청')&&document.querySelector('[data-testid=subagent-activity-inline-group]').innerText.includes('finished')"));
    await shot(theme+'-'+mode+'-pending');
    const trigger='[data-testid=parent-request-activity-summary] [role=button]';
    await clickSelector(trigger);await wait("document.querySelectorAll('[data-testid=parent-request-activity-row]').length===3");
    check(theme+' '+mode+' grouped disclosures preserve three request identities including two from Curie',await evaluate("new Set([...document.querySelectorAll('[data-request-id]')].map(e=>e.dataset.requestId)).size===3"));
    await clickSelector('[data-request-id=r1]');await wait("!!document.querySelector('dl')");
    check(theme+' '+mode+' group details expose question without executing markup',await evaluate("document.querySelector('dl').innerText.includes('Allow <img')&&!window.injected"));
    const updatedRaw=groupedRaw.map(item=>item.parentRequest?{...item,parentRequest:{...item.parentRequest,status:'resolved',response:{status:'resolved',decision:'Proceed',reason:'Checks passed'}}}:item);
    const updatedRows=conversation.rows(updatedRaw),updatedPresentations=conversation.standalone(updatedRaw).map(x=>x.presentation);
    await evaluate(`fixtureRows=${JSON.stringify(updatedRows)};fixturePresentations=${JSON.stringify(updatedPresentations)};fixtureRerender()`);
    await wait("document.querySelector('[data-testid=parent-request-activity-summary]').innerText.includes('판단 완료')");
    check(theme+' '+mode+' response updates preserve open group and per-request detail',await evaluate("document.querySelector('[data-request-id=r1]').getAttribute('aria-expanded')==='true'&&document.querySelector('dl').innerText.includes('Proceed')&&document.querySelectorAll('[data-testid=subagent-activity-inline-group]').length===1"));
    await evaluate(`document.querySelector(${JSON.stringify(trigger)}).focus()`);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await wait("document.querySelectorAll('[data-request-id]').length===0");
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
    await wait("document.querySelectorAll('[data-request-id]').length===3");check(theme+' '+mode+' group supports Enter and Space',true);
    await shot(theme+'-'+mode+'-groups');
    await send('Emulation.setDeviceMetricsOverride',{width:360,height:1000,deviceScaleFactor:1,mobile:false});
    check(theme+' '+mode+' grouped summaries fit narrow viewport',await evaluate("document.documentElement.scrollWidth<=360&&[...document.querySelectorAll('section,dd')].every(e=>e.getBoundingClientRect().right<=360)"));
    await shot(theme+'-'+mode+'-narrow');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:1000,deviceScaleFactor:1,mobile:false});
    const mixedRaw=updatedRaw.map(item=>item.parentRequest?.requestId==='r2'?{...item,parentRequest:{...item.parentRequest,status:'deferred'}}:item);
    await evaluate(`fixtureRows=${JSON.stringify(conversation.rows(mixedRaw))};fixturePresentations=${JSON.stringify(conversation.standalone(mixedRaw).map(x=>x.presentation))};fixtureRerender()`);
    await wait("document.querySelector('[data-testid=parent-request-activity-summary]').innerText.includes('판단 응답')");
    check(theme+' '+mode+' mixed response summary preserves individual state',await evaluate("document.querySelector('[data-request-id=r2]').innerText.includes('판단 보류')&&document.querySelector('[data-request-id=r1]').innerText.includes('판단 완료')"));
    const overflowRaw=[...groupedRaw,...['eve','max'].map(name=>({...raw('parent-request-'+name,'interacted',{...request,requestId:name}),agentThreadId:name,agentPath:'root/'+name}))];
    await evaluate(`fixtureRows=${JSON.stringify(conversation.rows(overflowRaw))};fixturePresentations=${JSON.stringify(conversation.standalone(overflowRaw).map(x=>x.presentation))};fixtureRerender()`);
    check(theme+' '+mode+' four-agent summary retains native overflow',await evaluate("document.querySelector('[data-testid=parent-request-activity-summary]').querySelectorAll('img').length===4&&document.querySelector('[data-testid=parent-request-activity-summary] button[aria-controls]').innerText.includes('2')"));
    await clickSelector('[data-testid=parent-request-activity-summary] button[aria-controls]');await wait("document.querySelectorAll('[data-request-id]').length===0");
    await clickSelector('[data-testid=parent-request-activity-summary] button[aria-controls]');await wait("document.querySelectorAll('[data-request-id]').length===5");
    check(theme+' '+mode+' overflow opens all request details',true);
   }
   await evaluate("fixtureMode='direct';fixtureRerender()");await wait("!!document.querySelector('[data-item=parent-request-r1]')");
  }
  check('native light/dark text colors differ',colors.light!==colors.dark);
  await evaluate("fixtureLocale='en-US';fixtureRender()");await wait("document.querySelector('[data-item=parent-request-r1]').innerText.includes('Decision requested')");check('English status follows native Intl locale',true);await shot('english');
  check('zero browser errors',exceptions.length===0&&await evaluate('fixtureErrors.length===0'));
  summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
} catch(e) { summary.outcome='failed';summary.error=String(e.stack??e);summary.exceptions=exceptions;process.exitCode=1; }
finally {
  server.closeAllConnections();await new Promise(r=>server.close(r));
  if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,300));socket.close();}
  for(const p of pending.values())clearTimeout(p.timer);
  summary.browserExit=await confirmOwnedBrowserExit(chrome,profile);
  artifactRun.producerStopped=summary.browserExit.confirmed;
  summary.runRoot=artifactRun.runRoot;summary.lifecycleId=artifactRun.lifecycleId;
  summary.fixtureRemoved=false;summary.retentionReason='Retained fixture, profile and raw results for lifecycle review';
  if(!summary.browserExit.confirmed)process.exitCode=1;
  summary.exitCode=process.exitCode||0;
  summary.exitCode=process.exitCode??0;await writeFile(join(logs,'render-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({runRoot:artifactRun.runRoot,lifecycleId:artifactRun.lifecycleId,outcome:summary.outcome,checks:summary.checks.length,error:summary.error,cleanupExitCode:summary.cleanupExitCode,exitCode:summary.exitCode}));
}
