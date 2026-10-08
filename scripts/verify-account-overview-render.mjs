import { createRequire } from 'node:module';
import Module from 'node:module';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname, join, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logs = join(root, 'artifacts/logs/accounts-usage-redesign');
const fixture = join(root, 'artifacts/verification/accounts-usage-redesign');
const assets = join(root, 'artifacts/upstream-ui/26.930.61225/webview/assets');
await mkdir(join(fixture, 'chrome-profile'), { recursive: true });
await mkdir(logs, { recursive: true });
const require = createRequire(import.meta.url), originalLoad = Module._load;
Module._load = function(request, parent, main) {
  if (request === 'vscode') return { window: { showErrorMessage() {}, showInformationMessage() {}, showWarningMessage() {} } };
  return originalLoad.call(this, request, parent, main);
};
const { UsageView } = require('../extensions/azrael-ex/dist/src/usageView.js');
Module._load = originalLoad;
const { AzraelAccountSettings } = require('./inject-account-settings.cjs');
const resetAt = Math.floor(Date.now() / 1000) + 5 * 86400 + 18 * 3600;
const profiles = [
  { id: 'saved-a', workspaceAccountId: 'internal-workspace-a', userId: 'hidden-user-a', email: 'personal@example.com', autoSwitchAllowed: true },
  { id: 'saved-b', workspaceAccountId: 'internal-workspace-b', userId: 'hidden-user-b', email: 'work@example.com', autoSwitchAllowed: false },
];
const window = (usedPercent, windowDurationMins) => ({ usedPercent, windowDurationMins, resetsAt: resetAt });
const usageData = id => ({ accountId: id, rateLimits: { primary: window(id === 'saved-a' ? 10 : 92, 300), secondary: window(70, 10080), planType: null }, rateLimitsByLimitId: null, rateLimitResetCredits: null });
const snapshot = { providers: [
  { id: 'anthropic', label: 'Anthropic', authKind: 'oauth', inferenceConnected: true, accounts: [{ id: 'claude-a', label: 'claude@example.com', selected: true, needsReauth: false, autoSwitchAllowed: true }] },
  { id: 'google', label: 'Google', authKind: 'oauth', inferenceConnected: true, accounts: [{ id: 'gemini-a', label: 'gemini@example.com', selected: true, needsReauth: false }] },
], availableProviders: [] };
let view, panel, surface, subscriber, emitted, updates = 0;
const actions = [], requests = [];
function createView() {
  view?.dispose();
  const service = Object.assign(new EventEmitter(), { changesEnabled: true, state: { profiles, activeProfileId: 'saved-a' }, async refresh() { return this.state; }, async devin() { return { enabled: true, loggedIn: true, email: 'cli@example.com' }; } });
  const usage = { get: id => ({ data: usageData(id) }), dueResetProfiles: () => [], async refresh(id, ws) { requests.push(['openai', id, ws]); } };
  const providers = { enabled: true, snapshot, async refresh() { return snapshot; }, async quota(providerId, accountId) { requests.push([providerId, accountId]); return { providerId, accountId, status: 'ok', source: 'synthetic', observedAt: Date.now(), rows: providerId === 'anthropic' ? [{ label: '5시간', usedPercent: 1, resetsAt: resetAt }, { label: 'Fable', usedPercent: 0, resetsAt: resetAt }] : [{ label: 'Pro', usedPercent: 0, resetsAt: resetAt }] }; }, async setAutoSwitch(providerId, accountId, enabled) { actions.push({ providerId, accountId, enabled }); }, dispose() {} };
  const devin = { snapshot: undefined, async refresh() { requests.push(['devin-cli']); this.snapshot = { daily: window(0, 1440), weekly: window(24, 10080) }; }, cancelRefresh() {}, dispose() {} };
  view = new UsageView(service, usage, devin, providers);
  let source = '';
  panel = { visible: true, webview: {}, dispose() {} };
  Object.defineProperty(panel.webview, 'html', { get: () => source, set: value => { source = value; if (surface === 'standalone') { emitted = value.slice(value.indexOf('<body>') + 6, value.lastIndexOf('<script nonce=')); updates++; } } });
  view.panel = panel;
}
const boot = `globalThis.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));let fixtureRoot;globalThis.fixturePending=0;globalThis.fixtureNode=s=>(fixtureRoot||document).querySelector(s);globalThis.fixtureNodes=s=>[...(fixtureRoot||document).querySelectorAll(s)];globalThis.fixtureSend=async message=>{fixturePending++;try{const r=await fetch('/action',{method:'POST',body:JSON.stringify(message)}),data=await r.json();if(data.error)throw Error(data.error);if(data.html){if(fixtureRoot)fixtureSubscriber({clientId:fixtureClientId,html:data.html});else document.body.innerHTML=data.html;}}finally{fixturePending--;}};globalThis.acquireVsCodeApi=()=>({postMessage:m=>void fixtureSend(m)});`;
const embeddedBoot = `globalThis.fixtureClientId=null;globalThis.fixtureSubscriber=null;globalThis.azraelAccountBridge={dispatchMessage(type,p){if(p.action==='mount'){fixtureClientId=p.clientId;fixtureSend({fixtureMount:true,clientId:p.clientId})}else if(p.action==='action')fixtureSend(p.message)},subscribe(type,fn){fixtureSubscriber=fn;return()=>{fixtureSubscriber=null}}};const effects=[];globalThis.Q={useRef:()=>({current:null}),useEffect:fn=>effects.push(fn)};globalThis.$={jsx:(type,props)=>({type,props})};${AzraelAccountSettings.toString()};const component=AzraelAccountSettings();const mount=document.createElement(component.type);component.props.ref.current=mount;document.body.append(mount);effects.forEach(fn=>fn());fixtureRoot=mount.shadowRoot;`;
const css = '<link rel="stylesheet" href="/assets/app-initial-668342ae9abd.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css">';
const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/assets/')) { const path = resolve(assets, decodeURIComponent(req.url.slice(8))); assert(path.startsWith(assets + sep)); res.setHeader('Content-Type', extname(path) === '.css' ? 'text/css' : 'application/octet-stream'); res.end(await readFile(path)); return; }
    if (req.url === '/action') {
      let body = ''; for await (const chunk of req) body += chunk;
      const message = JSON.parse(body), before = updates;
      if (message.fixtureMount) { view.embedded.set({ postMessage(m) { emitted = m.html; updates++; return true; } }, { clientId: message.clientId }); view.render(); }
      else { actions.push(message); await view.onMessage(message); }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ html: updates > before ? emitted : null })); return;
    }
    if (req.url.startsWith('/?')) {
      surface = new URL(req.url, 'http://localhost').searchParams.get('surface'); createView(); await view.refresh();
      let html = panel.webview.html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
      if (surface === 'embedded') html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body><script>${boot}${embeddedBoot}</script></body></html>`;
      else html = html.replace('<head>', '<head>' + css).replace('<body>', '<body><script>' + boot + '</script>');
      res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(html); return;
    }
    res.statusCode = 404; res.end();
  } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e.stack || e) })); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let chrome, socket, session, seq = 0; const pending = new Map();
const summary = { scope: 'Compiled production UsageView and CSS; generated standalone handlers; actual embedded settings bridge function with synthetic React lifecycle/host services; pinned native CSS. No installed-host or live account claim.', checks: [], screenshots: [] };
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${join(fixture, 'chrome-profile')}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((r,j) => { let text='';const timer=setTimeout(()=>j(Error('Chrome startup timeout')),20000);chrome.on('error',j);chrome.stderr.on('data',b=>{text+=b;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);r(m[1]);}}); });
  socket = new WebSocket(endpoint); await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}});
  const send=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject,timer:setTimeout(()=>reject(Error(method+' timeout')),20000)});socket.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(50);}throw Error('Timed out: '+expression);};
  const check=(name,ok)=>{assert.ok(ok,name);summary.checks.push(name);};
  session=(await send('Target.attachToTarget',{targetId:(await send('Target.createTarget',{url:'about:blank'},null)).targetId,flatten:true},null)).sessionId;
  await send('Page.enable');await send('Runtime.enable');await send('Page.bringToFront');
  for (const surfaceName of ['standalone','embedded']) for (const theme of ['light','dark']) for (const width of [1050,420]) {
    const prefix=`${surfaceName}-${theme}-${width}`;
    await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?surface=${surfaceName}`});
    await wait("typeof fixtureNodes==='function'&&fixtureNodes('.account-summary').length===5&&fixturePending===0");
    await evaluate(`document.documentElement.dataset.theme='${theme}';document.documentElement.style.setProperty('--vscode-foreground','${theme==='light'?'#202123':'#eee'}');document.documentElement.style.setProperty('--vscode-editor-background','${theme==='light'?'#fff':'#212121'}');document.documentElement.style.setProperty('--vscode-descriptionForeground','${theme==='light'?'#666':'#aaa'}');document.body.style.background='${theme==='light'?'#fff':'#212121'}'`);
    check(prefix+' all collapsed gauges',await evaluate("fixtureNodes('.track[role=progressbar]').length===9&&fixtureNodes('.account-summary').every(e=>e.getAttribute('aria-expanded')==='false')"));
    check(prefix+' white readable surface and gray badge',await evaluate("(()=>{const main=getComputedStyle(fixtureNode('main')),badge=getComputedStyle(fixtureNode('.current-login'));const rgb=badge.backgroundColor.match(/\\d+/g)?.slice(0,3).map(Number);return main.backgroundColor==='rgb(255, 255, 255)'&&rgb?.length===3&&Math.max(...rgb)-Math.min(...rgb)<8;})()"));
    check(prefix+' hidden metadata removed',await evaluate("!fixtureNode('main').textContent.match(/요금제 확인 필요|hidden-user|internal-workspace|마지막 갱신|관측|출처/)"));
    check(prefix+' relative reset only',await evaluate("fixtureNodes('.reset').every(e=>!e.textContent.match(/\\d{1,2}[\\/:-]\\d{1,2}/))"));
    check(prefix+' no horizontal overflow',await evaluate("document.documentElement.scrollWidth<=innerWidth&&fixtureNode('main').scrollWidth<=fixtureNode('main').clientWidth"));
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(logs,prefix+'-collapsed.png'),Buffer.from(shot.data,'base64'));summary.screenshots.push(prefix+'-collapsed.png');
    await evaluate("fixtureNode('.account-summary .track').click()");await wait("fixtureNode('.account-summary').getAttribute('aria-expanded')==='true'&&fixturePending===0");
    check(prefix+' gauge expands management without account switch',await evaluate("!!fixtureNode('[data-action=openaiReauth]')&&!!fixtureNode('[data-action=openaiRemove]')")&&!actions.some(a=>['openaiSwitch','providerSelect'].includes(a.action)));
    await evaluate("fixtureNode('.account-summary').focus()");await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});await wait("fixtureNode('.account-summary').getAttribute('aria-expanded')==='false'&&fixturePending===0");
    check(prefix+' keyboard collapses management',true);
    await evaluate("fixtureNode('.provider-account .account-summary').click()");await wait("!!fixtureNode('[data-action=setAutoSwitch][data-provider=anthropic]')&&fixturePending===0");
    await evaluate("fixtureNode('[data-action=setAutoSwitch][data-provider=anthropic]').click()");await wait('fixturePending===0');
    check(prefix+' auto switch carries provider account identity',actions.some(a=>a.action==='setAutoSwitch'&&a.providerId==='anthropic'&&a.accountId==='claude-a'&&a.enabled===false));
    await evaluate("fixtureNode('.account-summary').click()");await wait("fixtureNode('.account-summary').getAttribute('aria-expanded')==='true'&&fixturePending===0");
    const expanded=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(logs,prefix+'-expanded.png'),Buffer.from(expanded.data,'base64'));summary.screenshots.push(prefix+'-expanded.png');
    check(prefix+' no browser page errors',await evaluate('fixtureErrors.length===0'));
  }
  check('collapsed summary identities refreshed',profiles.every(p=>requests.some(r=>r[0]==='openai'&&r[1]===p.id&&r[2]===p.workspaceAccountId))&&requests.some(r=>r[0]==='anthropic')&&requests.some(r=>r[0]==='google')&&requests.some(r=>r[0]==='devin-cli'));
  summary.outcome='passed';await send('Browser.close',{},null);
} catch(e) { summary.outcome='failed';summary.error=String(e.stack||e);process.exitCode=1; }
finally {
  view?.dispose();server.closeAllConnections();await new Promise(r=>server.close(r));
  if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++seq,method:'Browser.close'}));}catch{}await delay(250);socket.close();}
  for(const p of pending.values())clearTimeout(p.timer);
  if(chrome?.exitCode===null&&chrome?.signalCode===null)await new Promise(r=>{const timer=setTimeout(r,5000);chrome.once('exit',()=>{clearTimeout(timer);r();});});
  summary.browserExited=!!chrome&&(chrome.exitCode!==null||chrome.signalCode!==null);
  await writeFile(join(fixture,'check-result.json'),JSON.stringify(summary,null,2));
  if(summary.browserExited){
    const cleanup=spawn('pwsh',['-NoProfile','-Command','$overviewFixture=Join-Path (Get-Location) "artifacts/verification/accounts-usage-redesign"; & ./scripts/clean-verification-artifacts.ps1 -FixtureRoot $overviewFixture -IncludeDiagnosedFixtures -Apply -ReportPath (Join-Path (Get-Location) "artifacts/logs/accounts-usage-redesign/cleanup-report.json")'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';cleanup.stdout.on('data',b=>text+=b);cleanup.stderr.on('data',b=>text+=b);summary.cleanupExitCode=await new Promise((r,j)=>{cleanup.on('error',j);cleanup.on('exit',r);});await writeFile(join(logs,'cleanup.log'),text);summary.fixtureRemoved=await access(fixture).then(()=>false,()=>true);if(summary.cleanupExitCode!==0||!summary.fixtureRemoved)process.exitCode=1;
  }else{summary.retentionReason='Browser exit unconfirmed; remove profile after exit';process.exitCode=1;}
  summary.exitCode=process.exitCode||0;await writeFile(join(logs,'overview-render-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks.length,error:summary.error,exitCode:summary.exitCode,fixtureRemoved:summary.fixtureRemoved}));
}
