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
const artifactRun=beginArtifactRun(root,{workId:'verify-provider-context-render',owner:'scripts/verify-provider-context-render.mjs',paths:{...(process.env.AZRAEL_RENDER_FIXTURE_ROOT ? {temporary:resolve(root,process.env.AZRAEL_RENDER_FIXTURE_ROOT)} : {}),...(process.env.AZRAEL_RENDER_LOG_ROOT ? {logs:resolve(root,process.env.AZRAEL_RENDER_LOG_ROOT)} : {})}});
const spawn=(...args)=>trackArtifactChild(artifactRun,nativeSpawn(...args));
const confirmOwnedBrowserExit=(child,profilePath)=>artifactRunTools.confirmOwnedBrowserExit(child,profilePath,spawn);
const containedPath=(value,parent,label)=>{const target=resolve(root,value),allowed=resolve(root,parent)+sep;assert.ok(target.toLowerCase().startsWith(allowed.toLowerCase()),label+' must be a descendant of '+parent);return target};
const fixture=artifactRun.temporary;
const logs=artifactRun.logs;
const assets=join(root,"artifacts/upstream-ui/26.1007.21434/webview/assets");
const profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);
const {renderSettings,savePolicy,compactionPreview}=require('./inject-provider-context.cjs');
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const adapterSource=`import {nLt,$At,XAt} from '/assets/app-initial-97d3534ad35f.js';
import {W3 as Card,G3,Q3 as Row,t6} from '/assets/app-initial-c014f9ee4429.js';
import {ZIt as Button,$It} from '/assets/app-initial-7a199c66e670.js';
G3();t6();$It();const React=nLt(),$=$At();
${savePolicy.toString()}
${compactionPreview.toString()}
${renderSettings.toString()}
const makePolicy=(providerId,modelId,contextWindow,threshold)=>({providerId,modelId,contextWindow,autoCompactBaseTokens:contextWindow,safeContextWindow:Math.floor(contextWindow*.95),pricing:{status:'confirmed',inputTokenThreshold:threshold,sourceUrl:'https://example.com/pricing'}});
window.fixtureData={config:{model:'managed/anthropic/large',provider_auto_compact:{anthropic:{models:{'managed/anthropic/sibling':{percentage:70}}},openai:{percentage:80}}},contextPolicies:[makePolicy('anthropic','managed/anthropic/large',1048576,200000),makePolicy('anthropic','managed/anthropic/small',200000,null),{...makePolicy('anthropic','managed/anthropic/claude-opus-5-5',1000000,null),pricing:{status:'reference',inputTokenThreshold:null}},{...makePolicy('openai','managed/openai/gpt-6.1-sol',1000000,272000),autoCompactBaseTokens:272000}]};
window.fixtureRequests=[];window.fixtureState={ko:false,fail:false,hold:true};
for(const [modelId,capacity] of [['gpt-6.1-sol',1000000],['gpt-5.2-codex',400000],['codex-mini-latest',200000],['subscription-limited',872000]])fixtureData.contextPolicies.push({...makePolicy('openai',modelId,capacity,null),pricing:{status:'no-surcharge',inputTokenThreshold:null,sourceUrl:null}});
const client={async sendRequest(method,params){fixtureRequests.push({method,params});if(method==='config/batchWrite'){if(fixtureState.fail)throw Error('synthetic write rejected');const match=params.edits[0].keyPath.match(/^provider_auto_compact\\.(".*?")\\.models\\.(".*")$/);const provider=JSON.parse(match[1]),model=JSON.parse(match[2]);fixtureData.config.provider_auto_compact[provider]??={};fixtureData.config.provider_auto_compact[provider].models??={};fixtureData.config.provider_auto_compact[provider].models[model]=params.edits[0].value}if(fixtureState.hold)await new Promise(resolve=>window.fixtureRelease=()=>{fixtureState.hold=false;resolve()});return structuredClone(fixtureData)}};
function Fixture(){const [,update]=React.useState(0);window.fixtureRerender=()=>update(x=>x+1);return renderSettings(React,$.jsx,client,fixtureState.ko,{Button,Card,Row})}
window.fixtureMount=()=>reactRoot.render($.jsx(Fixture,{key:Math.random()}));window.reactRoot=XAt().createRoot(document.getElementById('root'));reactRoot.render($.jsx(Fixture,{}));window.fixtureReady=true;`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5b2ced5ef25.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto flex w-full max-w-3xl flex-col p-8"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module" src="/fixture.mjs"></script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url==='/fixture.mjs'){res.setHeader('Content-Type','text/javascript');res.end(adapterSource);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Production model compaction settings with pinned React/Card/Row/Button/CSS, synthetic host in light/dark/narrow. No build or model requests.',checks:[]},pending=new Map(),exceptions=[];
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
 await wait("window.fixtureReady && !!window.fixtureRelease");
 check('loading state',await evaluate("document.body.innerText.includes('Loading')"));await evaluate('fixtureRelease()');await wait("!!document.querySelector('select')");
 const text=()=>evaluate('document.body.innerText');
 const set=async(selector,value)=>{await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await new Promise(r=>setTimeout(r,80))};
 const save=()=>evaluate("document.querySelector('button[type=submit]').click()");
 const effective=()=>evaluate("document.querySelector('[data-azrael-compaction-preview]').innerText");
 check('exact600K default',(await effective())==='600,000 tokens');
 await save();await wait("document.body.innerText.includes('Saved')");check('untouched token default persists empty model entry',await evaluate("Object.keys(fixtureData.config.provider_auto_compact.anthropic.models['managed/anthropic/large']).length===0"));
 await set('input[name=percentage]','50');check('percentage slider sync',await evaluate("document.querySelector('[type=range]').value==='50'"));check('percentage token preview',(await effective())==='524,288 tokens');
 await set('[type=range]','75');check('slider percentage sync',await evaluate("document.querySelector('[name=percentage]').value==='75'"));await save();await wait("document.body.innerText.includes('Saved')");
 check('exact model save keeps sibling/provider settings',await evaluate("fixtureData.config.provider_auto_compact.anthropic.models['managed/anthropic/large'].percentage===75&&fixtureData.config.provider_auto_compact.anthropic.models['managed/anthropic/sibling'].percentage===70&&fixtureData.config.provider_auto_compact.openai.percentage===80"));
 await set('select[aria-label=Model]','managed/anthropic/small');check('small model capacity boundary/default',(await text()).includes('200K')&&(await text()).includes('No surcharge')&&(await effective())==='190,000 tokens');
 await set('select[aria-label=Model]','managed/anthropic/large');await set('[name=percentage]','500');check('safe cap',(await effective())==='996,147 tokens'&&(await text()).includes('Safe limit'));
 await evaluate('fixtureState.fail=true');await save();await wait("!!document.querySelector('[role=alert]')");check('failed save keeps draft',await evaluate("document.querySelector('[name=percentage]').value==='500'&&fixtureData.config.provider_auto_compact.anthropic.models['managed/anthropic/large'].percentage===75"));await evaluate('fixtureState.fail=false');await save();await wait("document.body.innerText.includes('Saved')&&!document.querySelector('[role=alert]')");
 await evaluate("document.querySelector('button[type=button]').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await wait("document.querySelector('[data-azrael-compaction-preview]').innerText==='600,000 tokens'");check('keyboard reset restores exact600K',await evaluate("Object.keys(fixtureData.config.provider_auto_compact.anthropic.models['managed/anthropic/large']).length===0"));
 await set('select[aria-label=Model]','managed/anthropic/claude-opus-5-5');check('Opus one-million sixty percent exact600K',await evaluate("document.querySelector('[name=percentage]').value==='60'")&&(await effective())==='600,000 tokens');await evaluate('document.activeElement.blur()');
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}'`);
  summary[theme]=await evaluate("(()=>{const e=document.querySelector('[data-azrael-provider-context]'),s=getComputedStyle(e),b=getComputedStyle(document.querySelector('button'));return {foreground:s.color,buttonBackground:b.backgroundColor,buttonHeight:document.querySelector('button').getBoundingClientRect().height}})()");check(theme+' native button geometry',summary[theme].buttonHeight>=24);
  await writeFile(join(logs,theme+'-settings.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 check('distinct theme button backgrounds',summary.light.buttonBackground!==summary.dark.buttonBackground);
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:1100,deviceScaleFactor:1,mobile:false});await evaluate('fixtureState.ko=true;fixtureRerender()');await wait("document.body.innerText.includes('자동 압축')");check('Korean labels',await evaluate("!!document.querySelector('select[aria-label=제공자]')&&!!document.querySelector('input[aria-label=\"자동 압축 백분율\"]')"));
 check('narrow model selector readable',await evaluate("document.querySelector('select[aria-label=모델]').getBoundingClientRect().width>=200&&document.querySelector('select[aria-label=모델]').selectedOptions[0].text==='claude-opus-5-5'"));
 check('narrow page no overflow',await evaluate("document.documentElement.scrollWidth<=360"));await writeFile(join(logs,'dark-narrow-ko.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});await evaluate("fixtureState.ko=false;document.documentElement.dataset.theme='light';document.body.dataset.vscodeThemeKind='vscode-light';delete fixtureData.config.provider_auto_compact.openai.percentage;fixtureMount()");await wait("!!document.querySelector('select[aria-label=Provider]')");await set('select[aria-label=Provider]','openai');check('OpenAI baseline258400',(await effective())==='258,400 tokens');await evaluate('document.activeElement.blur()');await writeFile(join(logs,'light-openai.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 for(const [model,pct,tokens] of [['gpt-6.1-sol','30','300,000 tokens'],['gpt-5.2-codex','75','300,000 tokens'],['codex-mini-latest','95','190,000 tokens'],['subscription-limited','34','300,000 tokens']]){
  await set('select[aria-label=Model]',model);check('subscription default '+model,(await effective())===tokens&&await evaluate(`document.querySelector('[name=percentage]').value===${JSON.stringify(pct)}&&document.body.innerText.includes('No surcharge')`));
  await save();await wait("document.body.innerText.includes('Saved')");check('untouched subscription default stays exact '+model,await evaluate(`Object.keys(fixtureData.config.provider_auto_compact.openai.models[${JSON.stringify(model)}]).length===0`)&&(await effective())===tokens);
 }
 await set('select[aria-label=Model]','gpt-6.1-sol');await set('[name=percentage]','45');await save();await wait("document.body.innerText.includes('Saved')");check('subscription model custom setting',(await effective())==='450,000 tokens');await evaluate("[...document.querySelectorAll('button')].find(x=>x.innerText==='Reset to default').click()");await wait("document.querySelector('[data-azrael-compaction-preview]').innerText==='300,000 tokens'");check('subscription reset exact300K',(await effective())==='300,000 tokens');
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';document.activeElement.blur()`);await writeFile(join(logs,theme+'-openai-subscription.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 await evaluate('fixtureData.contextPolicies=[];fixtureMount()');await wait("document.body.innerText.includes('No models available')");check('empty model list visible',await evaluate("!document.querySelector('select')"));
 summary.events=await evaluate('fixtureRequests');
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
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
