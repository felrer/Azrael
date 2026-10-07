import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep, extname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const fixture = join(root, 'artifacts/verification/window-errors-render');
const logs = join(root, 'artifacts/logs/window-use-in-app-approval/native-ui');
assert(fixture.startsWith(join(root, 'artifacts/verification') + sep));
await mkdir(fixture, { recursive: true }); await mkdir(logs, { recursive: true });
const assets=join(root,'artifacts/upstream-ui/26.930.61225/webview/assets');
const require=createRequire(import.meta.url),ts=require('../extensions/azrael-ex/node_modules/typescript');
const {injectComputerUseCancelRequest,injectWindowApprovalTitle}=require('./inject-computer-use.cjs');
const {injectWindowApprovalClassifier}=require('./inject-window-control.cjs');
const production=new Map();
function extracted(source,name,adapters){const ast=ts.createSourceFile('native.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);const owner=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(owner);let text=owner.getText(ast),edits=[];function visit(n){if(ts.isIdentifier(n)&&adapters.includes(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(ast)-owner.getStart(ast),end:n.end-owner.getStart(ast),text:'fixture_'+n.text});ts.forEachChild(n,visit)}visit(owner);for(const e of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,e.start)+e.text+text.slice(e.end);return text.replace('function '+name+'(','function FixtureNative'+name+'(')}
const frontendName='app-initial-efe028fd535e.js',frontend=await readFile(join(assets,frontendName),'utf8');
production.set(frontendName,frontend+`\nconst fixture_B=x=>x,fixture_O=x=>x,fixture_mxn=()=>{};\n${extracted(frontend,'PCn',['B','O','mxn'])}\nexport {FixtureNativePCn};`);
const mainName='app-initial-532d60c9b397.js',cardName='computer-use-app-approval-request-card-eebb16443520.js';
const main=await readFile(join(assets,mainName),'utf8');
production.set(mainName,main+`\nconst fixture_P6i=()=>false,fixture_Qd=()=>null,fixture__d=()=>({formatMessage:d=>d.defaultMessage}),fixture_Wla=()=>{},fixture_Q=({defaultMessage})=>defaultMessage;\n${extracted(main,'qla',['P6i','Qd','_d','Wla','Q'])}\nexport {FixtureNativeqla};`);
const card=injectWindowApprovalTitle(injectComputerUseCancelRequest(await readFile(join(assets,cardName),'utf8'),'webview/assets/'+cardName).text,'webview/assets/'+cardName).text;
production.set(cardName,card+`\nconst fixture_i=()=>({set(){}}),fixture_r=()=>true,fixture_s=()=>({formatMessage:d=>d.defaultMessage}),fixture_c=({defaultMessage,values})=>Object.entries(values??{}).reduce((s,[k,v])=>s.replace('{'+k+'}',v),defaultMessage),fixture_m=()=>({replyWithMcpServerElicitationResponse:async(thread,id,result)=>{window.fixtureReplies.push({thread,id,result});await window.fixtureResponsePromise;window.fixtureResolve(id)}});\n${extracted(card,'E',['i','r','s','c','m'])}\nexport {FixtureNativeE};`);
const classifierName='app-initial-5120fa5fe295.js';production.set(classifierName,injectWindowApprovalClassifier(await readFile(join(assets,classifierName),'utf8'),'webview/assets/'+classifierName).text);
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-668342ae9abd.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto w-full max-w-3xl p-4"><div id="root"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureReplies=[];window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));</script><script type="module" src="/fixture.mjs"></script></body></html>`;
const moduleSource=`import {ZOt,KEt,UEt,FixtureNativePCn} from '/assets/app-initial-efe028fd535e.js';import {FixtureNativeqla,Lo as initCard,_xt as initParser,yxt as parseNativeElicitation} from '/assets/${mainName}';import {FixtureNativeE,n as initAppCard} from '/assets/${cardName}';import {kVt as classify} from '/assets/${classifierName}';initCard();initAppCard();initParser();const React=ZOt(),$=KEt(),root=UEt().createRoot(document.getElementById('root'));window.fixtureShow=(connector='window-use')=>{window.fixtureResponsePromise=new Promise(r=>window.fixtureRelease=r);window.fixtureRequestId='azrael-window-consent-fixture-'+Date.now();window.fixtureConversation={requests:[{id:window.fixtureRequestId,method:'mcpServer/elicitation/request',params:{threadId:'thread-fixture'}}]};const request=classify(parseNativeElicitation({serverName:'azrael_window',threadId:'thread-fixture',mode:'form',message:'Access the selected application window.',requestedSchema:{type:'object',properties:{}},_meta:{connector_id:connector,connector_name:connector==='window-use'?'Window Use':'Computer Use',codex_approval_kind:'mcp_tool_call',tool_params:{app:'C:/Synthetic/editor.exe'},tool_params_display:[{name:'app',display_name:'App',value:'Synthetic Editor'}],persist:['session','always']}},true,x=>new URL(x)));window.fixtureParsedRequest=request;if(!request)throw Error('Native classifier rejected fixture');root.render($.jsx(FixtureNativeE,{ApprovalCard:FixtureNativeqla,conversationId:'thread-fixture',hostId:'local',requestId:window.fixtureRequestId,request,onRequestSettled(){}}));};window.fixtureResolve=id=>{FixtureNativePCn({manager:{updateConversationState(thread,fn){fn(window.fixtureConversation)},getMcpServerElicitationItem(){return{}},logger:{}},notificationContext:{threadStore:{conversations:new Map([['thread-fixture',window.fixtureConversation]])}}},{method:'serverRequest/resolved',params:{threadId:'thread-fixture',requestId:id}});if(!window.fixtureConversation.requests.length)root.render(null)};window.fixtureShow();window.fixtureReady=true;`;
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
    await evaluate('window.fixtureShow();window.fixtureResolve(window.fixtureRequestId)');await wait('!document.querySelector("form")');check(theme+' '+width+' native serverRequest/resolved removal',await evaluate('fixtureConversation.requests.length===0'));
  }
  await evaluate("window.fixtureShow('computer-use')");await wait('!!document.querySelector("form")');check('unrelated Computer Use card preserved',(await evaluate('document.body.innerText')).includes('Allow ChatGPT to use Synthetic Editor?'));
  summary.outcome = 'passed'; await send('Browser.close', {}, null).catch(() => {});
} catch (error) { summary.outcome = 'failed'; summary.error = error.message; process.exitCode = 1; }
finally {
  if (socket?.readyState === WebSocket.OPEN && chrome && !exited()) await send('Browser.close', {}, null).catch(() => {});
  socket?.close(); for (const p of pending.values()) clearTimeout(p.timer); await new Promise(r => server?.close(r) ?? r());
  if (chrome && !exited()) await Promise.race([new Promise(r => chrome.once('exit', r)), new Promise(r => setTimeout(r, 5000))]);
  if (!chrome || exited()) { await rm(fixture, { recursive: true, force: true }); summary.fixtureRemoved = true; }
  else { summary.fixtureRemoved = false; summary.retentionReason = 'Owned browser has not confirmed exit; remove after its exit.'; process.exitCode = 1; }
  summary.exitCode = process.exitCode || 0; await writeFile(join(logs, 'result.json'), JSON.stringify(summary, null, 2) + '\n');
}
