import artifactRunTools from './artifact-run.cjs';
const {beginArtifactRun,trackArtifactChild}=artifactRunTools;
import {createRequire} from 'node:module';
import {spawn as nativeSpawn,} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const artifactRun=beginArtifactRun(root,{workId:'verify-context-compaction-render',owner:'scripts/verify-context-compaction-render.mjs',paths:{...(process.env.AZRAEL_RENDER_FIXTURE_ROOT ? {temporary:resolve(root,process.env.AZRAEL_RENDER_FIXTURE_ROOT)} : {}),...(process.env.AZRAEL_RENDER_LOG_ROOT ? {logs:resolve(root,process.env.AZRAEL_RENDER_LOG_ROOT)} : {}),...(process.env.AZRAEL_RENDER_EVIDENCE_ROOT ? {outputs:resolve(root,process.env.AZRAEL_RENDER_EVIDENCE_ROOT)} : {})}});
const spawn=(...args)=>trackArtifactChild(artifactRun,nativeSpawn(...args));
const confirmOwnedBrowserExit=(child,profilePath)=>artifactRunTools.confirmOwnedBrowserExit(child,profilePath,spawn);
const containedPath=(value,parent,label)=>{const target=resolve(root,value),allowed=resolve(root,parent)+sep;assert.ok(target.toLowerCase().startsWith(allowed.toLowerCase()),label+' must be a descendant of '+parent);return target};
const fixture=artifactRun.temporary;
const logs=artifactRun.logs;
const evidence=process.env.AZRAEL_RENDER_EVIDENCE_ROOT ? artifactRun.outputs : logs;
const assets=join(root,"artifacts/upstream-ui/26.1007.21434/webview/assets");
const profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);
const ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const {injectProviderContext,CONTEXT_ASSET}=require('./inject-provider-context.cjs');
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});await mkdir(evidence,{recursive:true});
const mainName="app-initial-7a199c66e670.js";
const main=injectProviderContext(await readFile(join(assets,mainName),'utf8'),CONTEXT_ASSET).text;
const ast=ts.createSourceFile('main.js',main,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function adapt(name,replacements,newName){const owner=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(owner,name);let render=owner.getText(ast),edits=[];function visit(n){if(ts.isIdentifier(n)&&replacements[n.text]&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(ast)-owner.getStart(ast),end:n.end-owner.getStart(ast),text:replacements[n.text]});ts.forEachChild(n,visit)}visit(owner);for(const e of edits.sort((a,b)=>b.start-a.start))render=render.slice(0,e.start)+e.text+render.slice(e.end);return render.replace('function '+name+'(','function '+newName+'(')}
const usage=adapt('aCa',{},'fixtureUsage');
const native=adapt('__azraelNativeContextGauge',{st:'fixtureIntl',q:'FixtureMessage',wr:'FixtureNumber'},'fixtureNativeGauge');
const wrapper=adapt('XSa',{st:'fixtureIntl',Ou:'fixtureWl',Px:'fixtureHx',nA:'fixtureManagerAtom',__azraelNativeContextGauge:'fixtureNativeGauge'},'fixtureGauge');
// Only host/store and localization are adapted. The transformed card/action,
// native gauge, hover card, button, React and pinned theme CSS render directly.
const adapterSource=`
const fixtureIntl=()=>({locale:window.fixtureState.locale,formatMessage:({defaultMessage},values)=>defaultMessage.replace('{percent}',values?.percent??''),formatNumber:x=>String(x)});
function FixtureMessage({defaultMessage}){return defaultMessage}
function FixtureNumber({value}){return value}
window.fixtureState={id:'chat-a',locale:'en',mode:'pending',settingsMode:'ok',performance:{turnId:'turn-a',outputTokens:355,requestDurationMs:2000,completedRequests:2,unmeasuredRequests:0}};window.fixtureEvents=[];window.fixtureSettingEvents=[];window.fixtureSubmits=0;window.fixtureSettings=new Map();
const fixtureManagerAtom={};const fixtureStore={get(atom,id){return atom===fixtureManagerAtom?fixtureManager:'local'}};
const fixtureWl=()=>fixtureStore;
const fixtureSettingListeners=new Set();
const fixtureServices={getConversation(id){return {latestThreadSettings:fixtureState.settingsMode==='read-error'?{}:{autoCompactionEnabled:fixtureSettings.get(id)??true}}},addConversationHistoryInvalidationListener(fn){fixtureSettingListeners.add(fn);return()=>fixtureSettingListeners.delete(fn)},async sendRequest(method,params){fixtureSettingEvents.push({method,params});if(['error','read-error'].includes(fixtureState.settingsMode))throw Error('synthetic setting failure');if(method==='thread/settings/update'){if(fixtureState.settingsMode==='pending')await new Promise(resolve=>window.fixtureSettingResolve=resolve);fixtureSettings.set(params.threadId,params.autoCompactionEnabled);for(const fn of fixtureSettingListeners)fn({conversationId:params.threadId});return{}}return{thread:{autoCompactionEnabled:fixtureSettings.get(params.threadId)??true}}},compactThread(...args){window.fixtureEvents.push({args,host:'local'});if(fixtureState.mode==='error')return Promise.reject(Error('synthetic failure'));return new Promise(resolve=>window.fixtureResolve=resolve)}};
const fixtureManager={getConversation:fixtureServices.getConversation,addConversationHistoryInvalidationListener:fixtureServices.addConversationHistoryInvalidationListener};
const fixtureRpc={sendRequest:fixtureServices.sendRequest,compactThread:fixtureServices.compactThread};const fixtureHx=()=>fixtureRpc;
${usage}
${native}
${wrapper}
const policy={providerId:'openai',modelId:'gpt-6-astra',contextWindow:1000000,safeContextWindow:950000,autoCompactTokenLimit:600000,inputTokens:247263,inputTokensEstimated:true,pricing:{status:'confirmed',inputTokenThreshold:272000,sourceUrl:'https://example.com/pricing'}};
window.fixturePolicy=policy;
function Fixture(){gw();_A();$Sa();const React=wd(),[,update]=React.useState(0);window.fixtureRerender=()=>update(n=>n+1);return y7.jsxs('form',{onSubmit:e=>{e.preventDefault();fixtureSubmits++},className:'flex flex-col gap-4',children:[y7.jsx('textarea',{'aria-label':'Draft',defaultValue:'Unsent draft',className:'border p-3'}),y7.jsx('div',{'data-attachment':'image.png',children:'image.png'}),y7.jsx(fixtureGauge,{conversationId:fixtureState.id,contextUsage:fixtureUsage({modelContextWindow:1000000,last:{totalTokens:247263},contextPolicy:policy,responsePerformance:fixtureState.performance})})]})}
export {Fixture};`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5b2ced5ef25.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto flex w-full max-w-3xl flex-col p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {$At,XAt} from '/assets/app-initial-97d3534ad35f.js';import {Fixture} from '/assets/${mainName}';const $=$At();window.reactRoot=XAt().createRoot(document.getElementById('root'));reactRoot.render($.jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);if(pathname===join(assets,mainName))source=main+adapterSource;res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Production transformed context hover card, native gauge/button/React/CSS in light/dark; synthetic host/localization. No build or model requests.',checks:[]},pending=new Map(),exceptions=[];
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
 await wait("window.fixtureReady && !!document.querySelector('[data-azrael-pricing-boundary]')");
 const open=async()=>{await evaluate("document.querySelector('[data-azrael-pricing-boundary]').focus()");await wait("document.querySelector('[data-azrael-context-compaction]')?.dataset.azraelContextCompaction===(fixtureState.id??'') && !!document.querySelector('[data-azrael-context-compaction] button')")};
 const card=()=>evaluate("(()=>{const e=document.querySelector('[data-azrael-context-compaction]'),b=e.querySelector('button'),s=getComputedStyle(b);return {text:e.innerText,disabled:b.disabled,type:b.type,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,color:s.color,background:s.backgroundColor}})()");
 const click=()=>evaluate("document.querySelector('[data-azrael-context-compaction] button').click()");
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixtureState.id='chat-${theme}';fixtureState.locale='en';fixtureState.mode='pending';fixtureRerender()`);await open();
  check(theme+' auto-compaction donut and tooltip agree',await evaluate("(()=>{const gauge=document.querySelector('[data-azrael-pricing-boundary]'),circle=gauge.querySelectorAll('circle')[1];return Math.abs(Number(circle.getAttribute('stroke-dashoffset'))-58.7895)<0.0001&&gauge.getAttribute('aria-label').includes('600,000 tokens (41.2%)')&&gauge.getAttribute('aria-label').includes('1,000,000 tokens (24.7%)')})()"));
  await wait("document.querySelector('[data-azrael-pricing-boundary]').getAttribute('aria-label').includes('177.5 tokens/s')");
  check(theme+' measured TPS visible and accessible',await evaluate("document.body.innerText.includes('Current response average TPS')&&document.body.innerText.includes('177.5 tokens/s')"));
  for(const [name,performance,expected] of [['partial',{turnId:'turn-a',outputTokens:355,requestDurationMs:2000,completedRequests:2,unmeasuredRequests:1},'177.5 tokens/s · partial'],['reset',{turnId:'turn-b',outputTokens:0,requestDurationMs:0,completedRequests:0,unmeasuredRequests:0},'Waiting for measurement'],['missing',null,'Unavailable'],['invalid',{turnId:'turn-c',outputTokens:355,requestDurationMs:0,completedRequests:1,unmeasuredRequests:0},'Unavailable']]){
   await evaluate('fixtureState.performance='+JSON.stringify(performance)+';fixtureRerender()');await open();await wait('document.body.innerText.includes('+JSON.stringify(expected)+')');check(theme+' TPS '+name,await evaluate(`document.querySelector('[data-azrael-pricing-boundary]').getAttribute('aria-label').includes(${JSON.stringify(expected)})`));
  }
  await evaluate("fixtureState.performance={turnId:'turn-a',outputTokens:355,requestDurationMs:2000,completedRequests:2,unmeasuredRequests:1};fixtureRerender()");await open();
  const minuteSamples=[{minute:0,outputTokens:100,requestDurationMs:1000},{minute:1,outputTokens:160,requestDurationMs:2000},{minute:3,outputTokens:100,requestDurationMs:1000}];
  await evaluate('fixtureState.performance={...fixtureState.performance,graphEstimated:true,truncatedMinutes:false,minuteSamples:'+JSON.stringify(minuteSamples)+'};fixtureRerender()');await open();
  await wait("!!document.querySelector('[data-azrael-response-tps-graph]')");
  check(theme+' estimated graph points and tool gap',await evaluate("(()=>{const g=document.querySelector('[data-azrael-response-tps-graph]');return g.querySelectorAll('circle').length===3&&g.querySelectorAll('line').length===1&&g.getAttribute('aria-label').includes('1 min: 100.0 tokens/s')&&g.innerText.includes('estimated')})()"));
  await evaluate("fixtureState.performance={...fixtureState.performance,minuteSamples:[{minute:4,outputTokens:0,requestDurationMs:1000}],truncatedMinutes:true};fixtureState.locale='ko-KR';fixtureRerender()");await open();
  await wait("document.querySelector('[data-azrael-response-tps-graph]')?.getAttribute('aria-label').includes('5분: 0.0 토큰/초')");
  check(theme+' localized zero single-point and truncated graph',await evaluate("(()=>{const g=document.querySelector('[data-azrael-response-tps-graph]');return g.querySelectorAll('circle').length===1&&g.querySelector('circle').getAttribute('cy')==='78'&&g.innerText.includes('최근 120분')&&g.innerText.includes('추정')})()"));
  await evaluate("fixtureState.performance={...fixtureState.performance,minuteSamples:[{minute:0,outputTokens:10,requestDurationMs:0}]};fixtureRerender()");await open();await wait("!document.querySelector('[data-azrael-response-tps-graph]')");check(theme+' invalid minute samples hide graph',true);
  await evaluate('fixtureState.locale="en";fixtureState.performance={...fixtureState.performance,truncatedMinutes:false,minuteSamples:'+JSON.stringify(minuteSamples)+'};fixtureRerender()');await open();await wait("!!document.querySelector('[data-azrael-response-tps-graph]')");
  const graphEnd=new Date(2026,9,23,12,40).getTime(),graphStart=graphEnd-40*60000;
  const timedPerformance={turnId:'waiting',startedAtUnixMs:graphEnd,observedAtUnixMs:graphEnd,outputTokens:0,requestDurationMs:0,completedRequests:0,unmeasuredRequests:0,graphEstimated:false,minuteSamples:[],history:[
   {turnId:'earlier',startedAtUnixMs:graphStart-30000,minuteSamples:[{minute:0,outputTokens:100,requestDurationMs:1000,mode:'standard'},{minute:1,outputTokens:100,requestDurationMs:3000,mode:'standard'},{minute:3,outputTokens:0,requestDurationMs:1000,mode:'fast'},{minute:4,outputTokens:400,requestDurationMs:1000,mode:'fast'},{minute:4,outputTokens:300,requestDurationMs:1000,mode:'ultrafast'},{minute:5,outputTokens:200,requestDurationMs:1000,mode:null}]},
   {turnId:'prior',startedAtUnixMs:graphEnd-8*60000,minuteSamples:[{minute:0,outputTokens:50,requestDurationMs:1000,mode:'standard'}]}
  ]};
  await evaluate('fixtureState.performance='+JSON.stringify(timedPerformance)+';fixtureRerender()');await open();
  await wait("!!document.querySelector('[data-tps-average-toggle] [role=switch]')");
  check(theme+' history retained while current mean waits',await evaluate("document.body.innerText.includes('Waiting for measurement')&&document.querySelectorAll('[data-azrael-response-tps-graph] circle').length===7&&document.querySelector('[data-turn-boundary=waiting]').getAttribute('x1')==='264'"));
  check(theme+' requests and mode changes are never joined',await evaluate("document.querySelectorAll('[data-tps-join]').length===2&&document.querySelectorAll('[data-turn-boundary]').length===2"));
  check(theme+' local HH:mm timestamps below plot',await evaluate("(()=>{const labels=[...document.querySelectorAll('[data-turn-timestamp]')],lines=[...document.querySelectorAll('[data-turn-boundary]')];return labels.map(e=>e.textContent).join(',')==='12:32,12:40'&&labels.every(e=>/^\\d{2}:\\d{2}$/.test(e.textContent)&&e.getBoundingClientRect().top>lines[0].getBoundingClientRect().bottom)})()"));
  check(theme+' average toggle defaults off',await evaluate("document.querySelector('[data-tps-average-toggle] [role=switch]').getAttribute('aria-checked')==='false'&&!document.querySelector('[data-mode-average]')"));
  await evaluate("document.querySelector('[data-tps-average-toggle] [role=switch]').click()");
  await wait("document.querySelectorAll('[data-mode-average]').length===3");
  check(theme+' weighted mode averages and neutral unknown',await evaluate("(()=>{const standard=document.querySelector('[data-mode-average=standard]');return Math.abs(Number(standard.dataset.tps)-200/4500*1000)<1e-8&&document.querySelector('[data-tps-average-labels]').innerText.includes('Standard: 44.4 tokens/s')&&document.querySelectorAll('[data-mode=unknown]').length===1&&!document.querySelector('[data-mode-average=unknown]')})()"));
  summary[theme+'ModeColors']=await evaluate("(()=>{const g=document.querySelector('[data-azrael-response-tps-graph]'),probe=document.createElement('span'),ctx=document.createElement('canvas').getContext('2d',{willReadFrequently:true});document.body.append(probe);const measure=css=>{probe.style.color=css;const color=getComputedStyle(probe).color;ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3),linear=rgb.map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4});return {color,rgb,luminance:linear[0]*0.2126+linear[1]*0.7152+linear[2]*0.0722}};const result={standard:measure(getComputedStyle(g.querySelector('[data-mode=standard]')).fill),fast:measure(getComputedStyle(g.querySelector('[data-mode=fast]')).fill),ultrafast:measure(getComputedStyle(g.querySelector('[data-mode=ultrafast]')).fill),baseFast:measure('var(--color-chart-orange)'),baseUltrafast:measure('var(--color-purple)')};probe.remove();return result})()");
  const modeColors=summary[theme+'ModeColors'];
  check(theme+' themed orange darker and purple brighter',modeColors.fast.luminance<modeColors.baseFast.luminance&&modeColors.ultrafast.luminance>modeColors.baseUltrafast.luminance);
  check(theme+' mode brightness gap within tolerance',Math.abs(modeColors.fast.luminance-modeColors.ultrafast.luminance)<0.05);
  await evaluate("document.querySelector('[data-tps-average-toggle] [role=switch]').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await wait("!document.querySelector('[data-mode-average]')");check(theme+' native average switch keyboard toggle',true);
  await evaluate("document.querySelector('[data-tps-average-toggle] [role=switch]').click()");await wait("!!document.querySelector('[data-mode-average]')");
  for(const width of [1000,474,360]){
   await send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:false});await open();await evaluate('new Promise(r=>setTimeout(r,180))');
   check(theme+' TPS tooltip fits '+width,await evaluate("(()=>{const e=document.querySelector('[data-azrael-context-compaction]').closest('[data-radix-popper-content-wrapper]')||document.querySelector('[data-azrael-context-compaction]').parentElement;const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&e.scrollWidth<=e.clientWidth+1})()"));
   check(theme+' graph fits '+width,await evaluate("(()=>{const g=document.querySelector('[data-azrael-response-tps-graph] svg'),r=g.getBoundingClientRect();return r.width>100&&r.left>=0&&r.right<=innerWidth&&r.height<160})()"));
   summary[theme+'TimestampAlignment'+width]=await evaluate("[...document.querySelectorAll('[data-turn-timestamp]')].map(e=>{const r=e.getBoundingClientRect(),line=[...document.querySelectorAll('[data-turn-boundary]')].find(l=>l.dataset.turnBoundary===e.dataset.turnTimestamp).getBoundingClientRect();return {id:e.dataset.turnTimestamp,center:(r.left+r.right)/2,lineX:line.left,error:Math.abs((r.left+r.right)/2-line.left)}})");
   check(theme+' timestamps centered on request boundaries '+width,summary[theme+'TimestampAlignment'+width].every(e=>e.error<1));
   await writeFile(join(evidence,theme+'-tps-graph-'+width+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  const closeTurns=[0,1,2].map(i=>({turnId:'close-'+i,startedAtUnixMs:graphEnd-3000+i*1000,minuteSamples:[]}));
  await evaluate('fixtureState.performance={...fixtureState.performance,history:'+JSON.stringify(closeTurns)+'};fixtureRerender()');await open();
  await wait("document.querySelectorAll('[data-turn-timestamp]').length===4");
  summary[theme+'CloseTimestamps']=await evaluate("[...document.querySelectorAll('[data-turn-timestamp]')].map(e=>({text:e.textContent,row:e.dataset.timestampRow,rect:e.getBoundingClientRect().toJSON()}))");
  check(theme+' close request timestamps stay readable at 360px',await evaluate("(()=>{const labels=[...document.querySelectorAll('[data-turn-timestamp]')],rects=labels.map(e=>e.getBoundingClientRect());return labels.length===4&&labels.every(e=>/^\\d{2}:\\d{2}$/.test(e.textContent))&&rects.every((r,i)=>rects.slice(i+1).every(s=>r.bottom<=s.top||s.bottom<=r.top||r.right<=s.left||s.right<=r.left))})()"));
  check(theme+' close request timestamps retain boundary alignment',await evaluate("[...document.querySelectorAll('[data-turn-timestamp]')].every(e=>{const r=e.getBoundingClientRect(),line=[...document.querySelectorAll('[data-turn-boundary]')].find(l=>l.dataset.turnBoundary===e.dataset.turnTimestamp).getBoundingClientRect();return Math.abs((r.left+r.right)/2-line.left)<1})"));
  await writeFile(join(evidence,theme+'-tps-close-timestamps-360.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("fixtureState.id+='-averages-new';fixtureRerender()");await open();await wait("document.querySelector('[data-tps-average-toggle] [role=switch]')?.getAttribute('aria-checked')==='false'");check(theme+' different conversation starts averages off',true);
  await evaluate("fixtureState.id='chat-"+theme+"';fixtureRerender()");await open();
  await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});
  await evaluate("fixtureState.performance={turnId:'turn-a',outputTokens:355,requestDurationMs:2000,completedRequests:2,unmeasuredRequests:0};fixtureRerender()");await open();
  const idle=await card();check(theme+' native button geometry and non-submit type',idle.type==='button'&&idle.width>80&&idle.height>20);summary[theme]={idle};
  const switchSelector='[data-azrael-thread-auto-compaction] [role=switch]';
  await wait(`document.querySelector('${switchSelector}')?.getAttribute('aria-checked')==='true'`);
  check(theme+' native switch geometry',await evaluate(`(()=>{const r=document.querySelector('${switchSelector}').getBoundingClientRect();return r.width>=28&&r.height>=16})()`));
  await evaluate("fixturePolicy.inputTokens=800000;fixtureRerender()");await open();
  await evaluate(`document.querySelector('${switchSelector}').click()`);
  await wait(`document.querySelector('${switchSelector}')?.getAttribute('aria-checked')==='false' && document.querySelector('[data-azrael-pricing-boundary]')?.dataset.azraelContextLap==='2'`);
  check(theme+' confirmed switch instantly resets gauge to additional capacity',await evaluate("Number(document.querySelector('[data-azrael-pricing-boundary] svg').querySelectorAll('circle')[1].getAttribute('stroke-dashoffset'))===50"));
  await evaluate("new Promise(resolve=>setTimeout(resolve,180))");
  await writeFile(join(logs,theme+'-auto-compaction-off.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate(`document.querySelector('${switchSelector}').focus()`);await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});await open();
  await wait(`document.querySelector('${switchSelector}')?.getAttribute('aria-checked')==='true'`);check(theme+' keyboard switch restores first lap',await evaluate("document.querySelector('[data-azrael-pricing-boundary]').dataset.azraelContextLap==='1'"));
  const beforePending=await evaluate("fixtureSettingEvents.filter(e=>e.method==='thread/settings/update').length");
  await evaluate(`fixtureState.settingsMode='pending';document.querySelector('${switchSelector}').click()`);await wait(`document.querySelector('${switchSelector}')?.disabled`);await evaluate(`document.querySelector('${switchSelector}').click()`);check(theme+' switch pending duplicate guard',await evaluate(`fixtureSettingEvents.filter(e=>e.method==='thread/settings/update').length===${beforePending+1}`));
  await evaluate("fixtureState.id+='-pending-new';fixtureRerender()");await open();await evaluate("fixtureSettingResolve()");await wait(`document.querySelector('${switchSelector}')?.getAttribute('aria-checked')==='true'`);check(theme+' stale save cannot change selected thread',true);
  await evaluate(`fixtureState.id='chat-${theme}';fixtureSettings.set(fixtureState.id,true);fixtureState.settingsMode='ok';fixtureRerender()`);await open();
  await evaluate("fixtureState.settingsMode='error';fixtureRerender()");await evaluate(`document.querySelector('${switchSelector}').click()`);await wait("!!document.querySelector('[data-azrael-thread-auto-compaction] [role=alert]')");
  check(theme+' failed save preserves confirmed switch',await evaluate(`document.querySelector('${switchSelector}').getAttribute('aria-checked')==='true'`));
  await evaluate("fixtureState.settingsMode='ok';document.querySelector('[data-azrael-thread-auto-compaction] button:not([role=switch])').click()");await wait(`document.querySelector('${switchSelector}')?.getAttribute('aria-checked')==='false'`);
  await evaluate("fixtureState.id+='-new';fixturePolicy.inputTokens=247263;fixtureRerender()");await open();await wait(`document.querySelector('${switchSelector}')?.getAttribute('aria-checked')==='true'`);check(theme+' new thread defaults enabled',true);
  await evaluate(`fixtureState.id='chat-${theme}';fixtureSettings.set(fixtureState.id,true);fixtureRerender()`);await open();
  await evaluate("fixtureState.id+='-read-error';fixtureState.settingsMode='read-error';fixtureRerender()");await open();await wait("!!document.querySelector('[data-azrael-thread-auto-compaction] [role=alert]')");check(theme+' failed initial read disables switch',await evaluate(`document.querySelector('${switchSelector}').disabled`));
  await evaluate("fixtureState.settingsMode='ok';document.querySelector('[data-azrael-thread-auto-compaction] button:not([role=switch])').click()");await wait(`document.querySelector('${switchSelector}')?.getAttribute('aria-checked')==='true' && !document.querySelector('${switchSelector}').disabled`);check(theme+' failed read retry confirms setting',true);
  await evaluate(`fixtureState.id='chat-${theme}';fixtureRerender()`);await open();
  if(process.env.AZRAEL_RENDER_README_CAPTURE==='1'){
   const clip=await evaluate("(()=>{const nodes=['[data-azrael-pricing-boundary]','[data-azrael-context-compaction]'].map(s=>document.querySelector(s).getBoundingClientRect());const x=Math.max(0,Math.floor(Math.min(...nodes.map(r=>r.left))-8)),y=Math.max(0,Math.floor(Math.min(...nodes.map(r=>r.top))-8));return {x,y,width:Math.ceil(Math.max(...nodes.map(r=>r.right))+8)-x,height:Math.ceil(Math.max(...nodes.map(r=>r.bottom))+8)-y,scale:2}})()");
   assert.ok(clip.width>0&&clip.height>0,'README capture has visible native content');
   await writeFile(join(logs,theme+'-readme-card.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:true})).data,'base64'));
   summary[theme].readmeCapture={file:theme+'-readme-card.png',clip};
  }
  await click();await wait("document.querySelector('[data-azrael-context-compaction] button').disabled");check(theme+' visible pending status',(await card()).text.includes('Requesting compaction'));await click();check(theme+' duplicate guard',await evaluate(`fixtureEvents.filter(e=>e.args[0]==='chat-${theme}').length===1`));
  await evaluate('fixtureResolve()');await wait("document.querySelector('[data-azrael-context-compaction]').innerText.includes('Compaction requested')");
  await writeFile(join(logs,theme+'-card.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("fixtureState.mode='error';fixtureRerender()");await click();await wait("document.querySelector('[data-azrael-context-compaction] [role=alert]')?.innerText.includes('failed')");check(theme+' error and retry affordance',(await card()).text.includes('Retry compaction'));
  await evaluate("fixtureState.mode='pending';fixtureRerender()");await evaluate("document.querySelector('[data-azrael-context-compaction] button').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await open();await wait("document.querySelector('[data-azrael-context-compaction] button')?.disabled");await evaluate('fixtureResolve()');
  check(theme+' draft attachments and no submit',await evaluate("document.querySelector('textarea').value==='Unsent draft'&&document.querySelector('[data-attachment]').dataset.attachment==='image.png'&&fixtureSubmits===0"));
 }
 await evaluate("fixtureState.id=null;fixtureState.locale='ko-KR';fixtureRerender()");await open();await wait("document.querySelector('[data-azrael-context-compaction]').innerText.includes('대화를 선택')");check('missing ID disabled localized control',(await card()).disabled);
 summary.events=await evaluate('fixtureEvents');check('ID-only RPC',summary.events.every(e=>e.args.length===1&&typeof e.args[0]==='string'));
 summary.browserErrors=await evaluate('fixtureErrors');check('no browser exceptions',exceptions.length===0&&summary.browserErrors.length===0);summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
  summary.browserExit=await confirmOwnedBrowserExit(chrome,profile);
  artifactRun.producerStopped=summary.browserExit.confirmed;
  summary.runRoot=artifactRun.runRoot;summary.lifecycleId=artifactRun.lifecycleId;
  summary.fixtureRemoved=false;summary.retentionReason='Retained fixture, profile and raw results for lifecycle review';
  if(!summary.browserExit.confirmed)process.exitCode=1;
  summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({runRoot:artifactRun.runRoot,lifecycleId:artifactRun.lifecycleId,outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
