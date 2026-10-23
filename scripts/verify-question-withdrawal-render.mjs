import artifactRunTools from './artifact-run.cjs';
const {beginArtifactRun,trackArtifactChild}=artifactRunTools;
import {createRequire} from 'node:module';
import {spawn as nativeSpawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const artifactRun=beginArtifactRun(root,{workId:'verify-question-withdrawal-render',owner:'scripts/verify-question-withdrawal-render.mjs',paths:{...(process.env.AZRAEL_RENDER_FIXTURE_ROOT ? {temporary:resolve(process.env.AZRAEL_RENDER_FIXTURE_ROOT)} : {}),...(process.env.AZRAEL_RENDER_LOG_ROOT ? {logs:resolve(process.env.AZRAEL_RENDER_LOG_ROOT)} : {})}});
const spawn=(...args)=>trackArtifactChild(artifactRun,nativeSpawn(...args));
const confirmOwnedBrowserExit=(child,profilePath)=>artifactRunTools.confirmOwnedBrowserExit(child,profilePath,spawn);

const fixture=artifactRun.temporary;
const logs=artifactRun.logs;
const assets=join(root,'artifacts/upstream-ui/26.1007.21434/webview/assets'),profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);
const {QUESTION_BOUNDARY,injectQuestionWithdrawal}=require('./inject-question-withdrawal.cjs');
const ts=require('../extensions/azrael-ex/node_modules/typescript');
const indexName='app-initial-97d3534ad35f.js',rowName='app-initial-c014f9ee4429.js';
let indexSource=injectQuestionWithdrawal(await readFile(join(assets,indexName),'utf8'),'webview/assets/'+indexName).text;
indexSource+='\nfunction fixturePendingQuestions(turn,previous){Bxn();return Axn(turn,previous)}export{fixturePendingQuestions,kRt as fixtureInitScope};';
let rowSource=injectQuestionWithdrawal(await readFile(join(assets,rowName),'utf8'),'webview/assets/'+rowName).text;
const rowAst=ts.createSourceFile(rowName,rowSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const rowOwner=rowAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Gjr');assert.ok(rowOwner,'Pinned native chat row');
// Reuse the existing session-flags renderer's host-hook adaptation. Keep the
// native row render body, badge, loading indicator and CSS unchanged.
const adapters=new Set(['ta','K','le','J','VC','Ajr','Gqn','s2n','n2n','cIe','M4t','j4t','Rjr']);
let rowRender=rowOwner.getText(rowAst),rowEdits=[];
function adaptRow(node){if(ts.isIdentifier(node)&&adapters.has(node.text)&&!(ts.isPropertyAccessExpression(node.parent)&&node.parent.name===node))rowEdits.push({start:node.getStart(rowAst)-rowOwner.getStart(rowAst),end:node.end-rowOwner.getStart(rowAst),text:'fixture_'+node.text});ts.forEachChild(node,adaptRow)}adaptRow(rowOwner);
for(const edit of rowEdits.sort((a,b)=>b.start-a.start))rowRender=rowRender.slice(0,edit.start)+edit.text+rowRender.slice(edit.end);
rowRender=rowRender.replace('function Gjr(','function fixtureGjr(');
const selectorStart=rowSource.indexOf('g0t=Ir(Q,'),selectorEnd=rowSource.indexOf('},{owner:e=>e.threadId}',selectorStart);
assert.ok(selectorStart>0&&selectorEnd>selectorStart,'Pinned sidebar input selector');
const inputSelector=rowSource.slice(selectorStart+'g0t=Ir(Q,'.length,selectorEnd+1);
rowSource+=`\nconst fixture_ta=()=>({get:()=>false}),fixture_K=()=>false,fixture_le=()=>({formatMessage:({defaultMessage})=>defaultMessage}),fixture_VC=()=>null,fixture_Ajr=()=>null,fixture_Gqn=()=>false;
const fixture_s2n=async()=>{},fixture_n2n=()=>()=>{},fixture_M4t=()=>{},fixture_j4t=()=>null,fixture_cIe=()=>true,fixture_Rjr=()=>'local';
function fixtureNeedsInput(){return (${inputSelector})({hostId:'local',threadId:'thread'},{get:(atom)=>atom===Ap?{summary:{},unansweredAsyncQuestions:window.fixturePending}:atom===ab?'off':null})}
const fixture_J=(atom)=>atom===oDr?'Question withdrawal':atom===Yj?'loading':atom===oM?window.fixtureApproval?{kind:'approval',source:'approval'}:fixtureNeedsInput()?{kind:'input',source:'userInputAsync',blocking:false}:null:atom===qj?{roomId:null,hasUnread:false}:atom===rc?{data:null}:null;
${rowRender}
let fixturePreferencesInitialized=false;
function FixtureInputRow(){Yjr();if(!fixturePreferencesInitialized){a3e({},()=>{});fixturePreferencesInitialized=true}return IQ.jsx(fixtureGjr,{conversationId:'thread',hostId:'local',threadSummary:{id:'thread',hostId:'local',title:'Question withdrawal'},disableHoverCard:true,disableEnvTooltip:true,useStableTrailingRail:true})}
export{FixtureInputRow};`;
const {injectQueuedCompactionList}=require('./inject-queued-compaction.cjs');
const {injectAccountSwitchQueue}=require('./inject-account-switch-queue.cjs');
const {injectQuestionQueue,QUESTION_QUEUE_LIST_ASSET}=require('./inject-question-queue.cjs');
const queueName=QUESTION_QUEUE_LIST_ASSET.split('/').at(-1);
let queueSource=injectQueuedCompactionList(await readFile(join(assets,queueName),'utf8')).text;
queueSource=injectAccountSwitchQueue(queueSource,QUESTION_QUEUE_LIST_ASSET).text;
queueSource=injectQuestionQueue(queueSource,QUESTION_QUEUE_LIST_ASSET).text;
const queueAst=ts.createSourceFile(queueName,queueSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const nativeRows=queueAst.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='We');
assert.equal(nativeRows.length,1,'Pinned native queue row owner');
const statusExpressions=[];
function findStatus(node){
 if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isIdentifier(node.left)&&node.left.text==='G'&&ts.isConditionalExpression(node.right)&&ts.isIdentifier(node.right.condition)&&node.right.condition.text==='N')statusExpressions.push(node.right.getText(queueAst));
 ts.forEachChild(node,findStatus);
}
findStatus(nativeRows[0]);assert.equal(statusExpressions.length,1,'Pinned native queue status assignment');
// Render the transformed native expression in its original module, retaining
// its real JSX runtime and FormatMessage dependency without the row providers.
queueSource+='\nfunction FixtureQueueStatus(){const N="question-wait";return '+statusExpressions[0]+'}export{FixtureQueueStatus};';
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const adapterSource=`
import {nLt as fixtureReact,$At as fixtureJsx,Clt as FixtureScope,Hbt as FixtureIntlContext,fixtureInitScope,fixturePendingQuestions} from '/assets/app-initial-97d3534ad35f.js';
import {FixtureInputRow,W9t as fixtureRootScope} from '/assets/${rowName}';
import {ZIt as NativeButton,$It as initButton} from '/assets/app-initial-7a199c66e670.js';
import {FixtureQueueStatus} from '/assets/${queueName}';
const React=fixtureReact(),oO=fixtureJsx();initButton();
const Ji={};
window.fixtureSource={type:'agentMessage',id:'original',questions:[{title:'Which environment should receive the change?'},{title:'Keep existing settings?'}]};
window.fixtureEvents=[];
function Be(_atom,key){return key?fixtureSource:null}
function __azraelActiveQuestionItem(e){return oO.jsxs('article',{className:'rounded-lg border border-default p-3',children:[oO.jsx('p',{children:e.item.content}),oO.jsx(NativeButton,{color:'secondary',onClick:()=>fixtureEvents.push(e.item.searchItemId),children:'Answer question'})]})}
`+QUESTION_BOUNDARY+`
function FixtureBody(){const[,update]=React.useState(0);window.fixtureRerender=()=>update(n=>n+1);window.fixturePending=fixturePendingQuestions({turnId:'turn',status:'inProgress',items:[fixtureSource]},window.fixturePending);return oO.jsxs('main',{className:'mx-auto flex max-w-2xl flex-col gap-4 p-4 text-default',children:[oO.jsx('div',{'data-fixture-chat-row':true,children:oO.jsx(FixtureInputRow,{})}),oO.jsx('h1',{className:'text-lg',children:'Question history'}),...[0,1].map(i=>oO.jsx($D,{hostId:'local',conversationId:'thread',historyEntityKey:'history',item:{type:'assistant-message',searchItemId:JSON.stringify(['request_user_input_async','original',i]),content:fixtureSource.questions[i].title,requestUserInputAsync:{sourceItemId:'original',questionIndex:i}}},i)),oO.jsx('p',{id:'answer-history',children:'Previous answer: Preserve the existing settings.'}),oO.jsx('div',{'data-fixture-queue-status':true,children:oO.jsx(FixtureQueueStatus,{})})]})}
function Fixture(){fixtureInitScope();return oO.jsx(FixtureScope,{scope:fixtureRootScope,children:oO.jsx(FixtureIntlContext,{value:{locale:'en',formatMessage:({defaultMessage})=>defaultMessage},children:oO.jsx(FixtureBody,{})})})}
export {Fixture};`;
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;html,body,#root{height:100%;margin:0}</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5b2ced5ef25.css"></head><body data-vscode-theme-kind="vscode-light"><div id="root"></div><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import{$At as KEt,XAt as UEt,Pbt,Nbt}from'/assets/app-initial-97d3534ad35f.js';import{Fixture}from'/fixture.js';Pbt();window.reactRoot=UEt().createRoot(document.getElementById('root'));reactRoot.render(KEt().jsx(Nbt,{locale:'en-US',messages:{},children:KEt().jsx(Fixture,{})}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(adapterSource);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(pathname===join(assets,queueName)?queueSource:pathname===join(assets,indexName)?indexSource:pathname===join(assets,rowName)?rowSource:await readFile(pathname));return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Production withdrawal boundary, transformed pending-question index/actual badge selector and native Gjr/rQ/Bkr chat row, plus native queue status; React/button/CSS/IntlProvider with adapted host hooks and active-card provider. Full app graph, installed host, Linux and macOS unverified.',checks:[]},pending=new Map(),exceptions=[];
try{
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((r,j)=>{let s='';const t=setTimeout(()=>j(Error('Chrome startup timeout')),20000);chrome.stderr.on('data',c=>{s+=c;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);r(m[1])}});chrome.on('error',j)});
 socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')exceptions.push(m.params.args);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.j(Error(JSON.stringify(m.error))):p.r(m.result)}}});
 const send=(method,params={},sid=session)=>new Promise((r,j)=>{const n=++id,t=setTimeout(()=>j(Error('CDP timeout '+method)),20000);pending.set(n,{r,j,t});socket.send(JSON.stringify({id:n,method,params,...(sid?{sessionId:sid}:{})}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Wait failed: '+expression+'; '+JSON.stringify(await evaluate('({errors:fixtureErrors,body:document.body.innerText,row:document.querySelector("[data-fixture-chat-row]")?.innerHTML.slice(0,3500),pending:window.fixturePending})')))};
 const check=(name,value)=>{assert.ok(value,name);summary.checks.push(name)};
 session=(await send('Target.attachToTarget',{targetId:(await send('Target.createTarget',{url:'about:blank'},null)).targetId,flatten:true},null)).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 await wait("window.fixtureReady&&document.querySelectorAll('article button').length===2");
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';fixtureSource.questions.forEach(q=>q.withdrawn=false);fixtureRerender()`);
  await wait("document.querySelectorAll('article button').length===2");
  await wait("document.querySelector('[data-fixture-chat-row]').innerText.includes('Needs input')");
  check(theme+' active question needs input without a draft',await evaluate("fixturePending.questionIds.length===2"));
  await evaluate("document.querySelector('article button').click();fixtureSource.questions[0].withdrawn=true;fixtureRerender()");
  await wait("document.querySelectorAll('details').length===1&&document.querySelectorAll('article button').length===1");
  check(theme+' partial withdrawal keeps native badge and original index',await evaluate("document.querySelector('[data-fixture-chat-row]').innerText.includes('Needs input')&&fixturePending.questionIds.length===1&&fixturePending.questionIds[0]===JSON.stringify(['request_user_input_async','original',1])"));
  await writeFile(join(logs,theme+'-partial.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  check(theme+' withdrawal removes answer control',await evaluate("!document.querySelector('details').open&&document.querySelector('summary').innerText==='철회된 질문'"));
  check(theme+' source index survives partial withdrawal',await evaluate("document.querySelector('details').dataset.azraelWithdrawnQuestion===JSON.stringify(['request_user_input_async','original',0])"));
  await evaluate("document.querySelector('summary').focus()");
  check(theme+' history summary receives keyboard focus',await evaluate("document.activeElement===document.querySelector('summary')"));
  await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'char',text:'\r',unmodifiedText:'\r',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait("document.querySelector('details').open");
  check(theme+' keyboard expands inactive history',await evaluate("document.querySelector('details').innerText.includes(fixtureSource.questions[0].title)&&document.querySelector('details').querySelector('button,input,textarea')===null"));
  await evaluate("document.querySelector('summary').click();document.querySelector('article button').click()");
  check(theme+' remaining question keeps original reply ID',await evaluate("fixtureEvents.at(-1)===JSON.stringify(['request_user_input_async','original',1])"));
  await evaluate("fixtureSource.questions[1].withdrawn=true;fixtureRerender()");await wait("document.querySelectorAll('details').length===2&&document.querySelectorAll('article button').length===0");
  await wait("!document.querySelector('[data-fixture-chat-row]').innerText.includes('Needs input')");
  check(theme+' all withdrawals clear native badge',await evaluate("fixturePending===null"));
  await evaluate("fixtureApproval=true;fixtureRerender()");
  await wait("document.querySelector('[data-fixture-chat-row]').innerText.includes('Awaiting approval')");
  check(theme+' unrelated approval stays visible',true);
  await evaluate("fixtureApproval=false;fixtureRerender()");
  await wait("!document.querySelector('[data-fixture-chat-row]').innerText.includes('Awaiting approval')");
  check(theme+' earlier answer history stays visible',await evaluate("document.getElementById('answer-history').innerText.includes('Preserve the existing settings.')"));
  summary[theme]=await evaluate("(()=>{const e=document.querySelector('details'),s=getComputedStyle(e);return{color:s.color,border:s.borderColor,font:s.fontFamily,width:e.getBoundingClientRect().width,padding:s.padding}})()");
  check(theme+' native token styling',summary[theme].width>250&&summary[theme].padding!=='0px');
  summary[theme].queueStatus=await evaluate("(()=>{const e=document.querySelector('[data-fixture-queue-status] [role=status]'),s=getComputedStyle(e),r=e.getBoundingClientRect();return{text:e.innerText,color:s.color,fontSize:s.fontSize,width:r.width,height:r.height,display:s.display,position:s.position,clip:s.clip}})()");
  const status=summary[theme].queueStatus;
  check(theme+' native queue waiting status is visibly rendered',status.text==='사용자 답변 대기 중'&&status.width>50&&status.height>10&&status.display!=='none'&&status.position!=='absolute');
  await writeFile(join(logs,theme+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 check('theme foreground changes',summary.light.color!==summary.dark.color);
 check('native queue status follows theme tokens',summary.light.queueStatus.color!==summary.dark.queueStatus.color);
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:700,deviceScaleFactor:1,mobile:false});check('narrow history has no horizontal overflow',await evaluate('document.body.scrollWidth<=360'));
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
