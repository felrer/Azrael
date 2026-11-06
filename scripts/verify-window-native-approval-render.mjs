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
const assets=join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? join(root,'artifacts/upstream-ui/26.1007.21434'),'webview/assets');
const require=createRequire(import.meta.url),ts=require('../extensions/azrael-ex/node_modules/typescript');
const {injectComputerUseCancelRequest,injectWindowApprovalTitle}=require('./inject-computer-use.cjs');
const {injectWindowApprovalClassifier}=require('./inject-window-control.cjs');
const {injectTeamApprovals,APP_ASSET,BRIDGE_ASSET}=require('./inject-team-approvals.cjs');
const production=new Map();
function extracted(source,name,adapters){const ast=ts.createSourceFile('native.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);const owner=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(owner);let text=owner.getText(ast),edits=[];function visit(n){if(ts.isIdentifier(n)&&adapters.includes(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(ast)-owner.getStart(ast),end:n.end-owner.getStart(ast),text:'fixture_'+n.text});ts.forEachChild(n,visit)}visit(owner);for(const e of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,e.start)+e.text+text.slice(e.end);return text.replace('function '+name+'(','function FixtureNative'+name+'(')}
const frontendName='app-initial-97d3534ad35f.js',frontend=injectTeamApprovals(await readFile(join(assets,frontendName),'utf8'),APP_ASSET).text;
// Execute the exact production notification branch with adapters only for its services.
const completedStart=frontend.indexOf('case`turn/completed`:{'),completedEnd=frontend.indexOf('case`turn/diff/updated`:',completedStart);
assert(completedStart>=0&&completedEnd>completedStart);
const completedBranch=frontend.slice(completedStart,completedEnd);
assert(!completedBranch.includes('.requests='));
const completeFixture=`function FixtureNativeComplete(conversation){const QTn={default:(items,p)=>items.findLast(p)},B=x=>x,tQ=(c,id)=>c.turns.find(t=>t.turnId===id),YTn=()=>({decision:'DONT_NOTIFY',shouldMarkUnread:false,hasRunnableQueuedFollowUp:false}),LTn=()=>false,hxn=()=>new Set(),vg=(c,p)=>c.turns.find(p),NTn=()=>{},PTn=()=>{};let e={},n=null,i=null,r=100;const t={method:'turn/completed',params:{threadId:conversation.id,turn:{id:'turn-fixture',status:'completed',error:null,durationMs:30}}};const a={onNotification(){},logger:{error(){},info(){}},getConversation:()=>conversation,getConversationOrThrow:()=>conversation,getHostId:()=> 'local',getStreamRole:()=>({role:'owner'}),updateConversationState(_id,fn){fn(conversation)},broadcastConversationSnapshot(){}};const o={itemStreamState:{drainBefore:()=>false,clearTurnTerminalInputBuffers(){}},threadStore:{conversations:new Map([[conversation.id,conversation]]),getThreadSummaries:()=>[],getCachedConversations:()=>[]},turnMergePolicy:{},updateTurnState(_id,id,fn){fn(conversation.turns.find(t=>t.turnId===id))},unread:{discardTurn(){},completeTurn(){}},getLastAgentMessageForTurn:()=>null,events:{emitTurnCompleted(){conversation.completedEmitted=true}}};switch(t.method){${completedBranch}}}`;
production.set(frontendName,frontend+`\nconst fixture_B=x=>x,fixture_c=x=>x,fixture_jSn=()=>{};\n${extracted(frontend,'pTn',['B','c','jSn'])}\n${completeFixture}\nexport {FixtureNativepTn,FixtureNativeComplete,createApprovalProjection,approvalResponseOrigin};`);
const mainName='app-initial-7a199c66e670.js',cardName='computer-use-app-approval-request-card-a9ef3724f471.js';
const main=await readFile(join(assets,mainName),'utf8');
production.set(mainName,main+`\nconst fixture_nha=()=>false,fixture_Hu=()=>null,fixture_st=()=>({formatMessage:d=>d.defaultMessage}),fixture_Nka=()=>{},fixture_q=({defaultMessage})=>defaultMessage;\n${extracted(main,'Ika',['nha','Hu','st','Nka','q'])}\nexport {FixtureNativeIka};`);
const card=injectWindowApprovalTitle(injectComputerUseCancelRequest(await readFile(join(assets,cardName),'utf8'),'webview/assets/'+cardName).text,'webview/assets/'+cardName).text;
production.set(cardName,card+`\nconst fixture_c=()=>({set(){}}),fixture_s=()=>true,fixture_r=()=>({formatMessage:d=>d.defaultMessage}),fixture_a=({defaultMessage,values})=>Object.entries(values??{}).reduce((s,[k,v])=>s.replace('{'+k+'}',v),defaultMessage),fixture__=()=>({getConversation:id=>window.fixtureTeam?.manager.conversations.get(id)??(window.fixtureConversation.id===id?window.fixtureConversation:null),replyWithMcpServerElicitationResponse:async(thread,id,result)=>{const origin=window.fixtureRouteResponse?.(thread,id)??{thread,id};window.fixtureReplies.push({...origin,result});await window.fixtureResponsePromise;window.fixtureResolve(origin.id)}});\nconst fixture_azraelApprovalSettingsBridge={dispatchMessage:(type,payload)=>window.fixtureSettingsEvents.push({type,...payload})};\n${extracted(card,'azraelOpenApprovalSettings',['azraelApprovalSettingsBridge'])}\nconst fixture_azraelOpenApprovalSettings=FixtureNativeazraelOpenApprovalSettings;\n${extracted(card,'E',['c','s','r','a','_','azraelOpenApprovalSettings'])}\nexport {FixtureNativeE};`);
const classifierName='app-initial-c014f9ee4429.js';production.set(classifierName,injectTeamApprovals(injectWindowApprovalClassifier(await readFile(join(assets,classifierName),'utf8'),'webview/assets/'+classifierName).text,BRIDGE_ASSET).text);
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
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto w-full max-w-3xl p-4"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureReplies=[];window.fixtureSettingsEvents=[];window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));</script><script type="module" src="/fixture.mjs"></script></body></html>`;
const moduleSource=`import {nLt,$At,XAt,FixtureNativepTn,FixtureNativeComplete,createApprovalProjection,approvalResponseOrigin} from '/assets/app-initial-97d3534ad35f.js';import {FixtureNativeIka,Zo as initCard,GTt as initParser,qTt as parseNativeElicitation} from '/assets/${mainName}';import {FixtureNativeE,n as initAppCard} from '/assets/${cardName}';import {gKt as classify,FixtureNativedLt,FixtureNativeQueueStatus} from '/assets/${classifierName}';initCard();initAppCard();initParser();const React=nLt(),$=$At(),root=XAt().createRoot(document.getElementById('root'));window.fixtureJSX=$;window.fixtureQueueShow=(question,approval)=>root.render($.jsx(FixtureNativeQueueStatus,{submission:{status:'queued',pendingQuestionCount:question,pendingApprovalCount:approval}}));window.fixtureShow=(permission='control')=>{window.fixtureTeam=null;window.fixtureResponsePromise=new Promise(r=>window.fixtureRelease=r);window.fixtureRequestId='azrael-window-consent-fixture-'+Date.now();window.fixtureConversation={id:'thread-fixture',turns:[{turnId:'turn-fixture',status:'inProgress',items:[]}],requests:[{id:window.fixtureRequestId,method:'mcpServer/elicitation/request',params:{threadId:'thread-fixture'}}]};window.fixtureParse=params=>parseNativeElicitation(params,true,x=>new URL(x));const rawParams={serverName:'azrael_window',threadId:'thread-fixture',mode:'form',message:({observation:'Window Use: Allow observation of this application window?',control:'Window Use: Allow control of this application window?',desktop:'Window Use: Allow control of the whole desktop for this conversation?'})[permission],requestedSchema:{type:'object',properties:{}},_meta:{connector_id:'window-use',connector_name:'Window Use',codex_approval_kind:'mcp_tool_call',window_use_async_approval:true,window_use_approval_state:'pending',tool_params:permission==='desktop'?{permission}:{app:'C:/Synthetic/editor.exe',permission},tool_params_display:[...(permission==='desktop'?[]:[{name:'app',display_name:'App',value:'Synthetic Editor'}]),...(permission==='desktop'?[{name:'scope',display_name:'Scope',value:'Whole desktop; this conversation only'}]:[]),{name:'permission',display_name:'Permission',value:permission},{name:'reason',display_name:'Reason',value:'<img src=x onerror=alert(1)> application work'}],persist:permission==='control'?['session','always']:['session']}};window.fixtureConversation.requests[0].params=rawParams;const request=classify(parseNativeElicitation(rawParams,true,x=>new URL(x)));window.fixtureParsedRequest=request;if(!request)throw Error('Native classifier rejected fixture');root.render($.jsx(FixtureNativeE,{ApprovalCard:FixtureNativeIka,conversationId:'thread-fixture',hostId:'local',requestId:window.fixtureRequestId,request,onRequestSettled(){}}));};window.fixtureResolve=id=>{FixtureNativepTn({updateConversationState(thread,fn){fn(window.fixtureConversation)},getConversation(){return window.fixtureConversation},getMcpServerElicitationItem(){return{}},logger:{}},{method:'serverRequest/resolved',params:{threadId:'thread-fixture',requestId:id}});if(!window.fixtureConversation.requests.length)root.render(null)};window.fixtureComplete=()=>{FixtureNativeComplete(window.fixtureConversation);const selected=FixtureNativedLt(window.fixtureConversation.requests,true).latestTurnlessElicitation;window.fixtureSelectedAfterComplete=selected;return selected};window.fixtureShowTeam=()=>{window.fixtureShow();const child=window.fixtureConversation,lead={id:'lead-fixture',requests:[],turns:[]};const manager={params:{hostId:'local'},conversations:new Map([[child.id,child],[lead.id,lead]]),updateConversationState(id,fn){fn(this.conversations.get(id))}};const projection=createApprovalProjection({registry:()=>({teams:[{hostId:'local',leadId:lead.id,memberIds:[child.id,lead.id]}]})});projection.sync(manager);const mirror=lead.requests[0];window.fixtureTeam={manager,projection,lead,child,mirror};window.fixtureRouteResponse=(thread,id)=>{const origin=approvalResponseOrigin({hostId:'local',getConversationRequests:id=>manager.conversations.get(id)?.requests??[]},thread,id);if(!origin)throw Error('Stale Team approval');return{thread:origin.conversationId,id:origin.requestId}};const request=classify(parseNativeElicitation(mirror.params,true,x=>new URL(x)));root.render($.jsx(FixtureNativeE,{ApprovalCard:FixtureNativeIka,conversationId:lead.id,hostId:'local',requestId:mirror.id,request,onRequestSettled(){}}));};window.fixtureShow();window.fixtureReady=true;`;
let socket,chrome,session,sequence=0,server,send;const pending=new Map();
const summary={scope:'Actual pinned native card render functions, React, native buttons/layout/CSS, native elicitation parser/classifier/serverRequest-resolved reducer and production cancel/classifier transforms; fixture adapters for localization/store/host replies. No installed VS Code acceptance.',checks:[]};
function check(name,condition){assert(condition,name);summary.checks.push(name)}
const exited = () => chrome?.exitCode !== null || chrome?.signalCode !== null;
try {
  server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}if(req.url==='/fixture.mjs'){res.setHeader('Content-Type','text/javascript');res.end(moduleSource);return}const path=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);assert(path.startsWith(assets+sep));res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream');res.end(production.get(path.split(sep).at(-1))??await readFile(path));}catch(e){res.statusCode=500;res.end(String(e))}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-background-mode', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${join(fixture, 'profile')}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolveEndpoint, rejectEndpoint) => {
    let stderr = '', settled = false;
    const finish = (reason, endpoint) => {
      if (settled) return; settled = true;
      clearTimeout(timer); chrome.off('error', onError); chrome.off('exit', onExit); chrome.stderr.off('data', onData);
      if (reason) {
        summary.browserStartup = { stderrTail: stderr.slice(-8192), exitCode: chrome.exitCode, signalCode: chrome.signalCode };
        rejectEndpoint(Error(reason + '; exitCode=' + chrome.exitCode + '; signalCode=' + chrome.signalCode + '; stderr tail:\n' + summary.browserStartup.stderrTail));
      } else resolveEndpoint(endpoint);
    };
    const onError = error => finish('Headless browser spawn failed: ' + error.message);
    const onExit = (code, signal) => finish('Headless browser exited before DevTools endpoint: exitCode=' + code + '; signalCode=' + signal);
    const onData = bytes => {
      stderr = (stderr + bytes.toString()).slice(-16384);
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) finish(undefined, match[1]);
    };
    const timer = setTimeout(() => finish('Headless browser startup timed out after 45000ms'), 45000);
    chrome.on('error', onError); chrome.on('exit', onExit); chrome.stderr.on('data', onData);
    if (chrome.exitCode !== null || chrome.signalCode !== null) onExit(chrome.exitCode, chrome.signalCode);
  });
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
    check(theme+' '+width+' native Window Use control app and scopes',state.text.includes('Window Use')&&state.text.includes('Allow Azrael to use Synthetic Editor?')&&state.text.includes('Allow control of this application window?')&&['Always allow','Allow this conversation','Deny','Cancel request'].every(s=>state.buttons.includes(s)));
    check(theme+' '+width+' no horizontal overflow',!state.overflow);summary.themeColors??={};summary.themeColors[theme]=state.color;if(theme==='dark')check('native theme foreground changes',summary.themeColors.light!==state.color);
    const checkSettings = async scope => {
      const layout = await evaluate(`(()=>{const card=document.querySelector('[data-codex-approval-surface]'),header=card.querySelector('[role=alert]').parentElement,first=[...card.querySelectorAll('button')].find(button=>button.textContent==='화이트리스트 설정'),group=first.parentElement,headerRect=header.getBoundingClientRect(),groupRect=group.getBoundingClientRect(),style=getComputedStyle(header);return{contentLeft:headerRect.left+parseFloat(style.paddingLeft),contentRight:headerRect.right-parseFloat(style.paddingRight),nativePadding:parseFloat(style.paddingLeft),groupLeft:groupRect.left,groupRight:groupRect.right,buttons:[...group.querySelectorAll('button')].map(button=>{const rect=button.getBoundingClientRect();return{text:button.textContent,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom}})}})()`);
      (summary.settingsLayout ??= []).push({theme,width,scope,...layout});
      check(theme+' '+width+' '+scope+' settings links stay within native content padding',layout.nativePadding>0&&layout.buttons.length===3&&layout.buttons.every(button=>button.left>=layout.contentLeft-1&&button.right<=layout.contentRight+1&&button.bottom>button.top));
      const before = await evaluate('({settings:fixtureSettingsEvents.length,replies:fixtureReplies.length,id:fixtureRequestId})');
      for (const [label,list] of [['화이트리스트 설정','controlAllowedApps'],['시큐리티 앱 설정','observationBlockedApps']]) {
        await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});button.focus();button.click();button.click()})()`);
        const result = await evaluate('({events:fixtureSettingsEvents.slice(-2),pending:!!document.querySelector("form"),replies:fixtureReplies.length,enabled:[...document.querySelectorAll("button")].filter(b=>b.textContent.includes("설정")).every(b=>!b.disabled),focused:document.activeElement?.tagName})');
        check(theme+' '+width+' '+scope+' '+label+' repeated trusted navigation stays pending',result.events.length===2&&result.events.every(event=>event.type==='mcp-response'&&event.response.id===before.id&&event.response.result.action==='settings'&&event.response.result.content.list===list&&Object.keys(event.response.result.content).length===1)&&result.pending&&result.enabled&&result.replies===before.replies&&result.focused==='BUTTON');
      }
      let expectedSettings = before.settings + 4;
      for (const [key,code,virtualKey] of [['Enter','Enter',13],[' ','Space',32]]) {
        await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtualKey});
        await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtualKey});
        expectedSettings++;
        const keyboardState = await evaluate(`({settings:fixtureSettingsEvents.length,lastSettings:fixtureSettingsEvents.at(-1),replies:fixtureReplies.length,lastReply:fixtureReplies.at(-1),pending:!!document.querySelector('form'),denyDisabled:[...document.querySelectorAll('button')].find(b=>b.textContent==='Deny')?.disabled,activeTag:document.activeElement?.tagName,activeText:document.activeElement?.textContent,errors:fixtureErrors})`);
        (summary.keyboardSettings ??= []).push({theme,width,scope,key,expectedSettings,expectedReplies:before.replies,...keyboardState});
        check(theme+' '+width+' '+scope+' '+code+' keyboard settings retains native actions',keyboardState.settings===expectedSettings&&keyboardState.replies===before.replies&&keyboardState.pending&&keyboardState.denyDisabled===false&&keyboardState.lastSettings?.response.id===before.id&&keyboardState.lastSettings?.response.result.content.list==='observationBlockedApps');
      }
    };
    await checkSettings('individual control');
    await writeFile(join(logs,theme+'-'+width+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    for(const [label,action,persist] of [['Always allow','accept','always'],['Allow this conversation','accept','session'],['Deny','decline',null],['Cancel request','cancel',null]]){
      await evaluate('window.fixtureShow()');await wait('!!document.querySelector("form")');const before=await evaluate('fixtureReplies.length');await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);await wait(`fixtureReplies.length===${before+1}`);
      const reply=await evaluate('fixtureReplies.at(-1)');check(theme+' '+width+' '+label+' native reply',reply.result.action===action&&(persist===null||reply.result._meta.persist===persist));
      check('native pending card retained',await evaluate('!!document.querySelector("form")'));await evaluate('window.fixtureRelease()');await wait('!document.querySelector("form")');
    }
    await evaluate("window.fixtureShow('observation')");await wait('!!document.querySelector("form")');
    const observationState=await evaluate("({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>b.textContent),overflow:document.documentElement.scrollWidth>innerWidth,images:document.querySelectorAll('img[src=x]').length,parsed:fixtureParsedRequest})");
    summary.observationParsed=observationState.parsed;
    await checkSettings('Security App observation');
    check(theme+' '+width+' native observation session-only classifier/parser',observationState.parsed.persistModes.length===1&&observationState.parsed.persistModes[0]==='session'&&observationState.parsed.appDisplayName==='Synthetic Editor');
    check(theme+' '+width+' native observation permission and literal reason',observationState.text.includes('Allow observation of this application window?')&&observationState.text.includes('observation')&&observationState.text.includes('<img src=x onerror=alert(1)> application work')&&observationState.images===0);
    check(theme+' '+width+' native observation no always or overflow',!observationState.buttons.includes('Always allow')&&!observationState.overflow);
    await writeFile(join(logs,theme+'-'+width+'-observation.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    for(const [label,action,persist] of [['Allow this conversation','accept','session'],['Deny','decline',null],['Cancel request','cancel',null]]){
      await evaluate("window.fixtureShow('observation')");await wait('!!document.querySelector("form")');const before=await evaluate('fixtureReplies.length');await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==="+JSON.stringify(label)+").click()");await wait('fixtureReplies.length==='+String(before+1));
      const reply=await evaluate('fixtureReplies.at(-1)');check(theme+' '+width+' native observation '+label,reply.result.action===action&&(persist===null||reply.result._meta.persist===persist));await evaluate('window.fixtureRelease()');await wait('!document.querySelector("form")');
    }
    // Reuse the theme/width matrix, exercising one native session response per new authority kind.
    for(const permission of ['desktop']){
      await evaluate(`window.fixtureShow(${JSON.stringify(permission)})`);await wait('!!document.querySelector("form")');
      const desktopState=await evaluate("({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>b.textContent),overflow:document.documentElement.scrollWidth>innerWidth,parsed:fixtureParsedRequest,params:fixtureConversation.requests[0].params,errors:fixtureErrors})");
      check(theme+' '+width+' native '+permission+' session-only classifier/parser',desktopState.parsed.persistModes.length===1&&desktopState.parsed.persistModes[0]==='session'&&!desktopState.buttons.includes('Always allow')&&['Allow this conversation','Deny','Cancel request'].every(label=>desktopState.buttons.includes(label)));
      if(permission==='desktop'){
        check(theme+' '+width+' native global desktop has no fake application',!Object.hasOwn(desktopState.params._meta.tool_params,'app')&&!Object.hasOwn(desktopState.params._meta.tool_params,'executable'));
        check(theme+' '+width+' native whole-desktop purpose and scope',desktopState.parsed.appDisplayName==='the whole desktop'&&desktopState.text.includes('Allow Azrael to use the whole desktop?')&&desktopState.text.includes('Allow control of the whole desktop for this conversation?')&&desktopState.text.includes('Whole desktop; this conversation only')&&!desktopState.text.includes('undefined'));
      }
      await checkSettings('global desktop');
      check(theme+' '+width+' native '+permission+' no render error or overflow',desktopState.errors.length===0&&!desktopState.overflow);
      await writeFile(join(logs,theme+'-'+width+'-'+permission+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
      const before=await evaluate('fixtureReplies.length');
      await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Allow this conversation').click()");await wait('fixtureReplies.length==='+String(before+1));
      const reply=await evaluate('fixtureReplies.at(-1)');
      check(theme+' '+width+' native '+permission+' session reply',reply.result.action==='accept'&&reply.result._meta.persist==='session');
      await evaluate('window.fixtureRelease()');await wait('!document.querySelector("form")');
    }
    await evaluate("window.fixtureShow('observation');window.fixtureComplete()");await wait('!!document.querySelector("form")');
    check(theme+' '+width+' native completed turn retains same pending observation request',await evaluate("fixtureConversation.turns[0].status==='completed'&&fixtureConversation.completedEmitted&&fixtureConversation.requests.length===1&&fixtureSelectedAfterComplete.requestId===fixtureRequestId&&fixtureSelectedAfterComplete.request.params._meta.tool_params.permission==='observation'&&fixtureSelectedAfterComplete.request.params._meta.window_use_async_approval===true&&fixtureSelectedAfterComplete.request.params._meta.window_use_approval_state==='pending'"));
    const repliesBefore=await evaluate('fixtureReplies.length');
    await evaluate(`(()=>{const allow=[...document.querySelectorAll('button')].find(b=>b.textContent==='Allow this conversation');allow.click();allow.click()})()`);
    await wait(`fixtureReplies.length===${repliesBefore+1}`);
    check(theme+' '+width+' native late accept replies exactly once',await evaluate(`fixtureReplies.length===${repliesBefore+1}&&fixtureReplies.at(-1).id===fixtureRequestId&&fixtureReplies.at(-1).result._meta.persist==='session'`));
    await evaluate('window.fixtureRelease()');await wait('!document.querySelector("form")');
    await evaluate('window.fixtureShow();window.fixtureResolve(window.fixtureRequestId)');await wait('!document.querySelector("form")');check(theme+' '+width+' native serverRequest/resolved removal',await evaluate('fixtureConversation.requests.length===0'));
    await evaluate('window.fixtureShowTeam()');await wait('!!document.querySelector("form")');
    check(theme+' '+width+' Team native card identifies source session',await evaluate("document.body.innerText.includes('Session thread-fixture')&&fixtureTeam.lead.turns.length===0&&fixtureTeam.child.requests[0].params.threadId==='thread-fixture'"));
    await checkSettings('Team source request');
    await writeFile(join(logs,theme+'-'+width+'-team.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Deny').click()");await wait("fixtureReplies.at(-1)?.thread==='thread-fixture'&&fixtureReplies.at(-1)?.id===fixtureRequestId&&fixtureReplies.at(-1)?.result.action==='decline'");
    check(theme+' '+width+' Team native response retains original thread/request',true);await evaluate('window.fixtureRelease()');await wait('!document.querySelector("form")');await evaluate('window.fixtureRouteResponse=null');
    for(const [question,approval,label] of [[0,2,'승인 응답 대기'],[1,0,'사용자 답변 대기 중'],[1,1,'사용자 응답 대기']]){
      await evaluate(`window.fixtureQueueShow(${question},${approval})`);await wait(`document.querySelector('[role="status"]')?.textContent===${JSON.stringify(label)}`);
      check(theme+' '+width+' native queue '+label,await evaluate(`document.querySelector('[role="status"]').getAttribute('aria-live')==='polite'&&document.documentElement.scrollWidth<=innerWidth`));
      await writeFile(join(logs,theme+'-'+width+'-queue-'+question+'-'+approval+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    }

  }
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
