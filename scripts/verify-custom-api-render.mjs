import { createRequire } from 'node:module';
import Module from 'node:module';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, join, sep, extname } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..'), logs = join(root, 'artifacts/logs/custom-api-models/ui'), fixture = join(root, 'artifacts/verification/custom-api-ui');
const assets = join(root, 'artifacts/upstream-ui/26.1007.21434/webview/assets');
await mkdir(join(fixture, 'chrome-profile'), { recursive: true }); await mkdir(logs, { recursive: true });
const require = createRequire(import.meta.url), load = Module._load;
Module._load = function(id, parent, main) { return id === 'vscode' ? { window: {} } : load.call(this, id, parent, main); };
const { UsageView } = require('../extensions/azrael-ex/dist/src/usageView.js'); Module._load = load;
const { CustomApiManagement } = require('../extensions/azrael-ex/dist/src/customApiManagement.js');
let manager, view, html, connections, requests, fail, passwords, textQueue, choiceQueue;
function reset() {
  view?.dispose(); connections = []; requests = []; fail = false; passwords = [];
  textQueue = ['Local API', 'http://localhost:4321/v1', 'private-test-secret', '180000', '1', 'vendor/model', 'Manual model', '64000', '8000', 'Discovered model', '32000', '4096'];
  choiceQueue = ['chat', 'secret', '사용 안 함', '사용', '모델 추가', 'vendor/discovered'];
  const backend = { enabled: true, dispose() {}, async request(req) {
    requests.push({ action: req.action, hasKey: !!req.apiKey });
    if (fail) throw Error('private-test-secret raw server error');
    if (req.action === 'discover') return { modelIds: ['vendor/discovered'] };
    if (req.action === 'delete') connections = connections.filter(c => c.id !== req.id);
    if (req.action === 'upsert') { const c = { ...req.connection, id: req.connection.id || 'a'.repeat(32) }; connections = [...connections.filter(v => v.id !== c.id), c]; }
    return { connections: structuredClone(connections) };
  } };
  let capabilityPrompt = 0;
  manager = new CustomApiManagement(backend, { text: async (prompt, value, password) => { passwords.push({ prompt, value, password }); return textQueue.shift(); }, choose: async () => choiceQueue.shift(), checks: async () => capabilityPrompt++ === 0 ? ['도구 호출 지원을 직접 확인함', 'thinking 파라미터 전송 (지원 서버만)'] : [], confirm: async () => true }, () => view?.render());
  const service = Object.assign(new EventEmitter(), { changesEnabled: true, state: { profiles: [] } });
  view = new UsageView(service, { get: () => undefined }, { dispose() {}, cancelRefresh() {} }, undefined, undefined, undefined, undefined, undefined, manager);
  const panel = { visible: true, webview: {}, dispose() {} };
  Object.defineProperty(panel.webview, 'html', { set: v => html = v }); view.panel = panel;
}
const boot = `globalThis.pending=0;globalThis.acquireVsCodeApi=()=>({postMessage:async m=>{pending++;try{const r=await fetch('/action',{method:'POST',body:JSON.stringify(m)});document.body.innerHTML=(await r.json()).body;}finally{pending--;}}});`;
const css = '<link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css">';
const server = createServer(async(req,res) => {
  if (req.url.startsWith('/assets/')) { const path=resolve(assets,req.url.slice(8));assert(path.startsWith(assets+sep));res.setHeader('Content-Type',extname(path)==='.css'?'text/css':'application/octet-stream');res.end(await readFile(path));return; }
  if (req.url === '/action') { let raw='';for await(const chunk of req)raw+=chunk;await view.onMessage(JSON.parse(raw));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({body:html.slice(html.indexOf('<body>')+6,html.lastIndexOf('<script nonce='))}));return; }
  if (req.url === '/fail') { fail=true;res.end('ok');return; }
  reset();await manager.refresh();view.render();res.setHeader('Content-Type','text/html');res.end(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'').replace('<head>','<head>'+css).replace('<body>','<body><script>'+boot+'</script>'));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let chrome,socket,session,seq=0;const pending=new Map(), summary={scope:'Compiled production UsageView, generic standalone events and API management handlers; synthetic host dialogs/backend; pinned native CSS; light/dark 1050/420px.',checks:[],screenshots:[]};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try {
  chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${join(fixture,'chrome-profile')}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((r,j)=>{let output='';const timer=setTimeout(()=>j(Error('Chrome timeout')),20000);chrome.on('error',j);chrome.stderr.on('data',b=>{output+=b;const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);r(match[1]);}});});
  socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
  const send=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject,timer:setTimeout(()=>reject(Error(method+' timeout')),20000)});socket.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(50);}throw Error(expression);};
  const check=(label,result)=>{assert.ok(result,label);summary.checks.push(label);};
  session=(await send('Target.attachToTarget',{targetId:(await send('Target.createTarget',{url:'about:blank'},null)).targetId,flatten:true},null)).sessionId;await send('Page.enable');await send('Runtime.enable');await send('Page.bringToFront');
  let light;
  for (const theme of ['light','dark']) for (const width of [1050,420]) {
    const prefix=theme+'-'+width;await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
    await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});await wait("!!document.querySelector('[data-custom-api]')");
    await evaluate(`document.documentElement.dataset.theme='${theme}';document.documentElement.style.setProperty('--vscode-editor-background','${theme==='light'?'#fff':'#212121'}');document.documentElement.style.setProperty('--vscode-foreground','${theme==='light'?'#202123':'#eee'}');`);
    check(prefix+' empty API add state',await evaluate("document.querySelector('[data-custom-api]').textContent.includes('등록된 API 연결이 없습니다')"));
    await evaluate("document.querySelector('[data-action=apiAdd]').click()");await wait("pending===0&&!!document.querySelector('.api-connection')");
    check(prefix+' key password and blank initial endpoint',passwords[1].value===''&&passwords[2].password===true);
    check(prefix+' no secret in markup',!html.includes('private-test-secret'));
    await evaluate("document.querySelector('[data-action=apiModels]').click()");await wait("pending===0&&document.querySelector('[data-custom-api]').textContent.includes('vendor/model')");
    check(prefix+' explicit verified model limits',connections[0].models[0].contextWindow===64000&&connections[0].models[0].supportsTools===true);
    check(prefix+' independent thinking transmission checkbox',connections[0].models[0].sendThinkingParameter===true&&connections[0].models[0].enableThinking===false);
    check(prefix+' no automatic discovery',requests.every(r=>r.action!=='discover'));
    await evaluate("document.querySelector('[data-action=apiDiscover]').click()");await wait("pending===0&&document.querySelector('[data-custom-api]').textContent.includes('vendor/discovered')");
    check(prefix+' explicit discovery limits and unknown tools',connections[0].models[1].contextWindow===32000&&connections[0].models[1].supportsTools===false);
    check(prefix+' thinking transmission defaults off',connections[0].models[1].sendThinkingParameter===false);
    const colors=await evaluate("(()=>{const c=getComputedStyle(document.querySelector('main'));return[c.backgroundColor,c.color]})()");if(theme==='light')light=colors;else check(prefix+' dark differs from light',colors[0]!==light[0]&&colors[1]!==light[1]);
    check(prefix+' no horizontal overflow',await evaluate('document.documentElement.scrollWidth<=innerWidth'));
    await evaluate("document.querySelector('[data-custom-api]').scrollIntoView()");const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(logs,prefix+'.png'),Buffer.from(shot.data,'base64'));summary.screenshots.push(prefix+'.png');
    check(prefix+' native button receives keyboard focus',await evaluate("(()=>{const b=document.querySelector('[data-action=apiToggle]');b.focus();return document.activeElement===b&&!b.disabled})()"));
    await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});await wait("pending===0&&document.querySelector('.api-connection .card-heading > span').textContent==='비활성'");
    check(prefix+' keyboard disable persisted',connections[0].enabled===false);
    await evaluate("fetch('/fail').then(()=>document.querySelector('[data-action=apiToggle]').click())");await wait("pending===0&&!!document.querySelector('[role=alert]')");
    check(prefix+' failed save retains connection and safe error',connections[0].enabled===false&&!html.includes('private-test-secret'));
  }
  summary.outcome='passed';await send('Browser.close',{},null);
} catch(error) { summary.outcome='failed';summary.error=String(error.stack||error);summary.actions=requests;process.exitCode=1; }
finally {
  view?.dispose();server.closeAllConnections();await new Promise(r=>server.close(r));
  if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++seq,method:'Browser.close'}));}catch{}socket.close();}for(const p of pending.values())clearTimeout(p.timer);
  if(chrome?.exitCode===null&&chrome?.signalCode===null)await new Promise(r=>{const timer=setTimeout(r,15000);chrome.once('exit',()=>{clearTimeout(timer);r();});});
  await writeFile(join(fixture,'check-result.json'),JSON.stringify(summary,null,2));
  // The guarded cleaner independently verifies live process references. A Chrome
  // launcher can close before Node reports its exit; uncertain paths stay intact.
  summary.browserExitReported=!!chrome&&(chrome.exitCode!==null||chrome.signalCode!==null);
  if(chrome) {
    const cleanup=spawn('pwsh',['-NoProfile','-Command','& ./scripts/clean-verification-artifacts.ps1 -FixtureRoot $env:API_FIXTURE -IncludeDiagnosedFixtures -Apply -ReportPath $env:API_CLEANUP_REPORT'],{cwd:root,env:{...process.env,API_FIXTURE:fixture,API_CLEANUP_REPORT:join(logs,'cleanup-report.json')},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';cleanup.stdout.on('data',b=>output+=b);cleanup.stderr.on('data',b=>output+=b);summary.cleanupExitCode=await new Promise((r,j)=>{cleanup.on('error',j);cleanup.on('exit',r);});await writeFile(join(logs,'cleanup.log'),output);summary.fixtureRemoved=await access(fixture).then(()=>false,()=>true);if(summary.cleanupExitCode!==0||!summary.fixtureRemoved)process.exitCode=1;
  } else { summary.retentionReason='Chrome exit unconfirmed';process.exitCode=1; }
  summary.exitCode=process.exitCode||0;await writeFile(join(logs,'render-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}
