import artifactRunTools from './artifact-run.cjs';
const {beginArtifactRun,trackArtifactChild}=artifactRunTools;
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {spawn as nativeSpawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, sep, extname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const artifactRun=beginArtifactRun(root,{workId:'verify-window-native-approval-render',owner:'scripts/verify-window-native-approval-render.mjs',paths:{...(process.env.AZRAEL_RENDER_FIXTURE_ROOT ? {temporary:resolve(process.env.AZRAEL_RENDER_FIXTURE_ROOT)} : {}),...(process.env.AZRAEL_RENDER_LOG_ROOT ? {logs:resolve(process.env.AZRAEL_RENDER_LOG_ROOT)} : {})}});
const spawn=(...args)=>trackArtifactChild(artifactRun,nativeSpawn(...args));
const confirmOwnedBrowserExit=(child,profilePath)=>artifactRunTools.confirmOwnedBrowserExit(child,profilePath,spawn);
const fixture = artifactRun.temporary;
const logs = artifactRun.logs;
await mkdir(fixture, { recursive: true }); await mkdir(logs, { recursive: true });
const assets=join(root,'artifacts/upstream-ui/26.1007.21434/webview/assets');
const require=createRequire(import.meta.url),ts=require('../extensions/azrael-ex/node_modules/typescript');
const {injectComputerUseCancelRequest,injectWindowApprovalTitle}=require('./inject-computer-use.cjs');
const {injectWindowApprovalClassifier}=require('./inject-window-control.cjs');
const production=new Map();
function extracted(source,name,adapters){const ast=ts.createSourceFile('native.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);const owner=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(owner);let text=owner.getText(ast),edits=[];function visit(n){if(ts.isIdentifier(n)&&adapters.includes(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(ast)-owner.getStart(ast),end:n.end-owner.getStart(ast),text:'fixture_'+n.text});ts.forEachChild(n,visit)}visit(owner);for(const e of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,e.start)+e.text+text.slice(e.end);return text.replace('function '+name+'(','function FixtureNative'+name+'(')}
const frontendName='app-initial-97d3534ad35f.js',frontend=await readFile(join(assets,frontendName),'utf8');
// Execute the exact production notification branch with adapters only for its services.
const completedStart=frontend.indexOf('case`turn/completed`:{'),completedEnd=frontend.indexOf('case`turn/diff/updated`:',completedStart);
assert(completedStart>=0&&completedEnd>completedStart);
const completedBranch=frontend.slice(completedStart,completedEnd);
assert(!completedBranch.includes('.requests='));
const completeFixture=`function FixtureNativeComplete(conversation){const QTn={default:(items,p)=>items.findLast(p)},B=x=>x,tQ=(c,id)=>c.turns.find(t=>t.turnId===id),YTn=()=>({decision:'DONT_NOTIFY',shouldMarkUnread:false,hasRunnableQueuedFollowUp:false}),LTn=()=>false,hxn=()=>new Set(),vg=(c,p)=>c.turns.find(p),NTn=()=>{},PTn=()=>{};let e={},n=null,i=null,r=100;const t={method:'turn/completed',params:{threadId:conversation.id,turn:{id:'turn-fixture',status:'completed',error:null,durationMs:30}}};const a={onNotification(){},logger:{error(){},info(){}},getConversation:()=>conversation,getConversationOrThrow:()=>conversation,getHostId:()=> 'local',getStreamRole:()=>({role:'owner'}),updateConversationState(_id,fn){fn(conversation)},broadcastConversationSnapshot(){}};const o={itemStreamState:{drainBefore:()=>false,clearTurnTerminalInputBuffers(){}},threadStore:{conversations:new Map([[conversation.id,conversation]]),getThreadSummaries:()=>[],getCachedConversations:()=>[]},turnMergePolicy:{},updateTurnState(_id,id,fn){fn(conversation.turns.find(t=>t.turnId===id))},unread:{discardTurn(){},completeTurn(){}},getLastAgentMessageForTurn:()=>null,events:{emitTurnCompleted(){conversation.completedEmitted=true}}};switch(t.method){${completedBranch}}}`;
production.set(frontendName,frontend+`\nconst fixture_B=x=>x,fixture_c=x=>x,fixture_jSn=()=>{};\n${extracted(frontend,'pTn',['B','c','jSn'])}\n${completeFixture}\nexport {FixtureNativepTn,FixtureNativeComplete};`);
const mainName='app-initial-7a199c66e670.js',cardName='computer-use-app-approval-request-card-a9ef3724f471.js';
const main=await readFile(join(assets,mainName),'utf8');
production.set(mainName,main+`\nconst fixture_nha=()=>false,fixture_Hu=()=>null,fixture_st=()=>({formatMessage:d=>d.defaultMessage}),fixture_Nka=()=>{},fixture_q=({defaultMessage})=>defaultMessage;\n${extracted(main,'Ika',['nha','Hu','st','Nka','q'])}\nexport {FixtureNativeIka};`);
const card=injectWindowApprovalTitle(injectComputerUseCancelRequest(await readFile(join(assets,cardName),'utf8'),'webview/assets/'+cardName).text,'webview/assets/'+cardName).text;
production.set(cardName,card+`\nconst fixture_c=()=>({set(){}}),fixture_s=()=>true,fixture_r=()=>({formatMessage:d=>d.defaultMessage}),fixture_a=({defaultMessage,values})=>Object.entries(values??{}).reduce((s,[k,v])=>s.replace('{'+k+'}',v),defaultMessage),fixture__=()=>({replyWithMcpServerElicitationResponse:async(thread,id,result)=>{window.fixtureReplies.push({thread,id,result});await window.fixtureResponsePromise;window.fixtureResolve(id)}});\n${extracted(card,'E',['c','s','r','a','_'])}\nexport {FixtureNativeE};`);
const classifierName='app-initial-c014f9ee4429.js';production.set(classifierName,injectWindowApprovalClassifier(await readFile(join(assets,classifierName),'utf8'),'webview/assets/'+classifierName).text);
const classifier=production.get(classifierName);
production.set(classifierName,classifier+`\nconst fixture_BJe=params=>window.fixtureParse(params),fixture_ns=x=>x;\n${extracted(classifier,'dLt',['BJe','ns'])}\nexport {FixtureNativedLt};`);
const queueName='queued-message-list-616ed03f7f35.js';
let queue=await readFile(join(assets,queueName),'utf8');
queue=require('./inject-queued-compaction.cjs').injectQueuedCompactionList(queue).text;
queue=require('./inject-account-switch-queue.cjs').injectAccountSwitchQueue(queue,'webview/assets/'+queueName).text;
queue=require('./inject-question-queue.cjs').injectQuestionQueue(queue,'webview/assets/'+queueName).text;
const queueAst=ts.createSourceFile(queueName,queue,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const queueOwner=queueAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='We');
let queueStatus,queueWait;
function findQueueStatus(node){if(ts.isVariableDeclaration(node)&&node.name.getText(queueAst)==='N')queueWait=node.initializer.getText(queueAst);if(ts.isBinaryExpression(node)&&node.left.getText(queueAst)==='G'&&node.right.getText(queueAst).includes('role:`status`'))queueStatus=node.right.getText(queueAst);ts.forEachChild(node,findQueueStatus)}
findQueueStatus(queueOwner);assert(queueWait&&queueStatus);
production.set(classifierName,production.get(classifierName)+`\nfunction FixtureNativeQueueStatus({submission:u}){const $=window.fixtureJSX,c=({defaultMessage})=>defaultMessage,l=false,N=${queueWait};return ${queueStatus}}\nexport {FixtureNativeQueueStatus};`);
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto w-full max-w-3xl p-4"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureReplies=[];window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));</script><script type="module" src="/fixture.mjs"></script></body></html>`;
const moduleSource=`import {nLt,$At,XAt,FixtureNativepTn,FixtureNativeComplete} from '/assets/app-initial-97d3534ad35f.js';import {FixtureNativeIka,Zo as initCard,GTt as initParser,qTt as parseNativeElicitation} from '/assets/${mainName}';import {FixtureNativeE,n as initAppCard} from '/assets/${cardName}';import {gKt as classify,FixtureNativedLt,FixtureNativeQueueStatus} from '/assets/${classifierName}';initCard();initAppCard();initParser();const React=nLt(),$=$At(),root=XAt().createRoot(document.getElementById('root'));window.fixtureJSX=$;window.fixtureQueueShow=(question,approval)=>root.render($.jsx(FixtureNativeQueueStatus,{submission:{status:'queued',pendingQuestionCount:question,pendingApprovalCount:approval}}));window.fixtureShow=(connector='window-use',stage=false,overrides=null)=>{window.fixtureResponsePromise=new Promise(r=>window.fixtureRelease=r);window.fixtureRequestId='azrael-window-consent-fixture-'+Date.now();window.fixtureConversation={id:'thread-fixture',turns:[{turnId:'turn-fixture',status:'inProgress',items:[]}],requests:[{id:window.fixtureRequestId,method:'mcpServer/elicitation/request',params:{threadId:'thread-fixture'}}]};window.fixtureParse=params=>parseNativeElicitation(params,true,x=>new URL(x));const rawParams={serverName:'azrael_window',threadId:'thread-fixture',mode:'form',message:stage?'단계: Window Use 3단계\\n실행 위치: Windows 사용자 데스크톱\\n이유: <img src=x onerror=alert(1)> 문서 편집\\n이 작업 동안 현재 창을 제어합니다.':'Access the selected application window.',requestedSchema:{type:'object',properties:{}},_meta:{connector_id:connector,connector_name:connector==='window-use'?'Window Use':'Computer Use',codex_approval_kind:'mcp_tool_call',...(stage?{window_use_approval_kind:'stage',window_use_async_approval:true,window_use_approval_state:'pending'}:{}),tool_params:{app:stage?'Window Use 3단계':'C:/Synthetic/editor.exe'},tool_params_display:[{name:'app',display_name:'App',value:stage?'Window Use 3단계':'Synthetic Editor'},...(stage?[{name:'stage',display_name:'단계',value:'3단계'},{name:'location',display_name:'실행 위치',value:'Windows 사용자 데스크톱'},{name:'reason',display_name:'이유',value:'<img src=x onerror=alert(1)> 문서 편집'}]:[])],persist:stage?['session']:['session','always']}};if(overrides){rawParams.message=overrides.message;rawParams._meta.tool_params_display=overrides.tool_params_display;}window.fixtureConversation.requests[0].params=rawParams;const request=classify(parseNativeElicitation(rawParams,true,x=>new URL(x)));window.fixtureParsedRequest=request;if(!request)throw Error('Native classifier rejected fixture');root.render($.jsx(FixtureNativeE,{ApprovalCard:FixtureNativeIka,conversationId:'thread-fixture',hostId:'local',requestId:window.fixtureRequestId,request,onRequestSettled(){}}));};window.fixtureResolve=id=>{FixtureNativepTn({updateConversationState(thread,fn){fn(window.fixtureConversation)},getConversation(){return window.fixtureConversation},getMcpServerElicitationItem(){return{}},logger:{}},{method:'serverRequest/resolved',params:{threadId:'thread-fixture',requestId:id}});if(!window.fixtureConversation.requests.length)root.render(null)};window.fixtureComplete=()=>{FixtureNativeComplete(window.fixtureConversation);const selected=FixtureNativedLt(window.fixtureConversation.requests,true).latestTurnlessElicitation;window.fixtureSelectedAfterComplete=selected;return selected};window.fixtureShow();window.fixtureReady=true;`;
let socket,chrome,session,sequence=0,server,send;const pending=new Map();
const summary={scope:'Actual pinned native card render functions, React, native buttons/layout/CSS, native elicitation parser/classifier/serverRequest-resolved reducer and production cancel/classifier transforms; fixture adapters for localization/store/host replies. No installed VS Code acceptance.',checks:[]};
function check(name,condition){assert(condition,name);summary.checks.push(name)}
const exited = () => chrome?.exitCode !== null || chrome?.signalCode !== null;
try {
  server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}if(req.url==='/fixture.mjs'){res.setHeader('Content-Type','text/javascript');res.end(moduleSource);return}const path=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);assert(path.startsWith(assets+sep));res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream');res.end(production.get(path.split(sep).at(-1))??await readFile(path));}catch(e){res.statusCode=500;res.end(String(e))}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${join(fixture, 'profile')}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((r, j) => { let text = ''; const timer = setTimeout(() => j(Error('Headless browser startup timed out')), 20000); chrome.on('error', j); chrome.stderr.on('data', bytes => { text += bytes; const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); r(match[1]); } }); });
  socket = new WebSocket(endpoint); await new Promise((r, j) => { socket.addEventListener('open', r, { once: true }); socket.addEventListener('error', j, { once: true }); });
  socket.addEventListener('message', e => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
  send = (method, params = {}, sid = session) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => reject(Error('Browser command timed out: ' + method)), 10000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
  const target = await send('Target.createTarget', { url: 'about:blank' }, null);
  session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await send('Page.enable'); await send('Runtime.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 760, deviceScaleFactor: 1, mobile: false });
  const evaluate = async expression => { const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value; };
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,40))}throw Error('Wait failed '+expression+' '+JSON.stringify(await evaluate('({errors:fixtureErrors,body:document.body.innerText})')))};
  await wait('window.fixtureReady && !!document.querySelector("form")');
  for(const theme of ['light','dark'])for(const width of [900,360]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:760,deviceScaleFactor:1,mobile:false});
    await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';document.documentElement.className='${theme}';window.fixtureShow()`);await wait('!!document.querySelector("form")');
    const state=await evaluate(`({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>b.textContent),overflow:document.documentElement.scrollWidth>innerWidth,color:getComputedStyle(document.querySelector('[data-codex-approval-surface]')).color})`);
    check(theme+' '+width+' native Window Use/app and scopes',state.text.includes('Window Use')&&state.text.includes('Allow Azrael to use Synthetic Editor?')&&['Always allow','Allow this conversation','Deny','Cancel request'].every(s=>state.buttons.includes(s)));
    check(theme+' '+width+' no horizontal overflow',!state.overflow);summary.themeColors??={};summary.themeColors[theme]=state.color;if(theme==='dark')check('native theme foreground changes',summary.themeColors.light!==state.color);
    await writeFile(join(logs,theme+'-'+width+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    for(const [label,action,persist] of [['Always allow','accept','always'],['Allow this conversation','accept','session'],['Deny','decline',null],['Cancel request','cancel',null]]){
      await evaluate('window.fixtureShow()');await wait('!!document.querySelector("form")');const before=await evaluate('fixtureReplies.length');await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);await wait(`fixtureReplies.length===${before+1}`);
      const reply=await evaluate('fixtureReplies.at(-1)');check(theme+' '+width+' '+label+' native reply',reply.result.action===action&&(persist===null||reply.result._meta.persist===persist));
      check('native pending card retained',await evaluate('!!document.querySelector("form")'));await evaluate('window.fixtureRelease()');await wait('!document.querySelector("form")');
    }
    await evaluate("window.fixtureShow('window-use',true)");await wait('!!document.querySelector("form")');
    const stageState=await evaluate(`({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>b.textContent),overflow:document.documentElement.scrollWidth>innerWidth,images:document.querySelectorAll('img[src="x"]').length,parsed:fixtureParsedRequest})`);
    summary.stageParsed=stageState.parsed;
    check(theme+' '+width+' native stage session-only classifier/parser',stageState.parsed.persistModes.length===1&&stageState.parsed.persistModes[0]==='session'&&stageState.parsed.appDisplayName==='Window Use 3단계');
    check(theme+' '+width+' native stage scope/reason literal',stageState.text.includes('Window Use 3단계')&&stageState.text.includes('Windows 사용자 데스크톱')&&stageState.text.includes('<img src=x onerror=alert(1)> 문서 편집')&&stageState.images===0);
    check(theme+' '+width+' native stage no always or overflow',!stageState.buttons.includes('Always allow')&&!stageState.overflow);
    await writeFile(join(logs,theme+'-'+width+'-stage.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    const logoffPresentation=require('./window-control-host.cjs').logoffApproval({identity:{childSessionId:10},health:'abnormal',ownerPresent:true},'소유권 복구 실패 후 종료');
    await evaluate(`window.fixtureShow('window-use',true,${JSON.stringify(logoffPresentation)})`);await wait('!!document.querySelector("form")');
    const logoffState=await evaluate(`({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>b.textContent),overflow:document.documentElement.scrollWidth>innerWidth})`);
    check(theme+' '+width+' explicit logoff identity and loss warning',logoffState.text.includes('Windows 자식 세션 10')&&logoffState.text.includes('저장하지 않은 작업')&&logoffState.text.includes('현재 상태: 비정상 / 입력 소유자: 있음')&&logoffState.text.includes('이번 종료 요청에만 적용'));
    check(theme+' '+width+' explicit logoff session-only and no overflow',!logoffState.overflow&&!logoffState.buttons.includes('Always allow'));
    await writeFile(join(logs,theme+'-'+width+'-logoff.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    for(const [label,action,persist] of [['Allow this conversation','accept','session'],['Deny','decline',null],['Cancel request','cancel',null]]){
      await evaluate("window.fixtureShow('window-use',true)");await wait('!!document.querySelector("form")');const before=await evaluate('fixtureReplies.length');await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);await wait(`fixtureReplies.length===${before+1}`);
      const reply=await evaluate('fixtureReplies.at(-1)');check(theme+' '+width+' native stage '+label,reply.result.action===action&&(persist===null||reply.result._meta.persist===persist));await evaluate('window.fixtureRelease()');await wait('!document.querySelector("form")');
    }
    await evaluate("window.fixtureShow('window-use',true);window.fixtureComplete()");await wait('!!document.querySelector("form")');
    check(theme+' '+width+' native completed turn retains same pending request',await evaluate(`fixtureConversation.turns[0].status==='completed'&&fixtureConversation.completedEmitted&&fixtureConversation.requests.length===1&&fixtureSelectedAfterComplete.requestId===fixtureRequestId&&fixtureSelectedAfterComplete.request.params._meta.window_use_async_approval===true&&fixtureSelectedAfterComplete.request.params._meta.window_use_approval_state==='pending'`));
    const repliesBefore=await evaluate('fixtureReplies.length');
    await evaluate(`(()=>{const allow=[...document.querySelectorAll('button')].find(b=>b.textContent==='Allow this conversation');allow.click();allow.click()})()`);
    await wait(`fixtureReplies.length===${repliesBefore+1}`);
    check(theme+' '+width+' native late accept replies exactly once',await evaluate(`fixtureReplies.length===${repliesBefore+1}&&fixtureReplies.at(-1).id===fixtureRequestId&&fixtureReplies.at(-1).result._meta.persist==='session'`));
    await evaluate('window.fixtureRelease()');await wait('!document.querySelector("form")');
    await evaluate('window.fixtureShow();window.fixtureResolve(window.fixtureRequestId)');await wait('!document.querySelector("form")');check(theme+' '+width+' native serverRequest/resolved removal',await evaluate('fixtureConversation.requests.length===0'));
    for(const [question,approval,label] of [[0,2,'승인 응답 대기'],[1,0,'사용자 답변 대기 중'],[1,1,'사용자 응답 대기']]){
      await evaluate(`window.fixtureQueueShow(${question},${approval})`);await wait(`document.querySelector('[role="status"]')?.textContent===${JSON.stringify(label)}`);
      check(theme+' '+width+' native queue '+label,await evaluate(`document.querySelector('[role="status"]').getAttribute('aria-live')==='polite'&&document.documentElement.scrollWidth<=innerWidth`));
      await writeFile(join(logs,theme+'-'+width+'-queue-'+question+'-'+approval+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    }

  }
  await evaluate("window.fixtureShow('computer-use')");await wait('!!document.querySelector("form")');check('unrelated Computer Use card preserved',(await evaluate('document.body.innerText')).includes('Allow ChatGPT to use Synthetic Editor?'));
  summary.outcome = 'passed'; await send('Browser.close', {}, null).catch(() => {});
} catch (error) { summary.outcome = 'failed'; summary.error = error.message; process.exitCode = 1; }
finally {
  if (socket?.readyState === WebSocket.OPEN && chrome && !exited()) await send('Browser.close', {}, null).catch(() => {});
  socket?.close(); for (const p of pending.values()) clearTimeout(p.timer); await new Promise(r => server?.close(r) ?? r());
  summary.browserExit=await confirmOwnedBrowserExit(chrome,join(fixture,'profile'));
  artifactRun.producerStopped=summary.browserExit.confirmed;
  summary.runRoot=artifactRun.runRoot;summary.lifecycleId=artifactRun.lifecycleId;
  summary.fixtureRemoved=false;summary.retentionReason='Retained fixture, profile and raw results for lifecycle review';
  if(!summary.browserExit.confirmed)process.exitCode=1;
  summary.exitCode=process.exitCode||0; await writeFile(join(logs, 'result.json'), JSON.stringify(summary, null, 2) + '\n');
}
