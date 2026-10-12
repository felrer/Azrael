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
const logs = resolve(process.env.AZRAEL_RENDER_LOG_ROOT || join(root, 'artifacts/logs/accounts-usage-redesign'));
const fixture = resolve(process.env.AZRAEL_RENDER_FIXTURE_ROOT || join(root, 'artifacts/verification/accounts-usage-redesign'));
assert(fixture.startsWith(join(root, 'artifacts/verification') + sep));
assert(logs.startsWith(join(root, 'artifacts/logs') + sep));
const assets = join(root, 'artifacts/upstream-ui/26.1007.21434/webview/assets');
await mkdir(join(fixture, 'chrome-profile'), { recursive: true });
await mkdir(logs, { recursive: true });
const require = createRequire(import.meta.url), originalLoad = Module._load, resetNotices = [];
Module._load = function(request, parent, main) {
  if (request === 'vscode') return { window: { showErrorMessage(message) { resetNotices.push(message); }, showInformationMessage(message) { resetNotices.push(message); }, showWarningMessage() {} } };
  return originalLoad.call(this, request, parent, main);
};
const { UsageView } = require('../extensions/azrael-ex/dist/src/usageView.js');
const { providerHeadingHtml } = require('../extensions/azrael-ex/dist/src/usagePresentation.js');
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
const unsafeModel = '<img src=x onerror="globalThis.modelInjectionExecuted=true">';
const model = (provider, name, amount, unpriced = 0) => ({ provider, model: name, amount, unpriced });
const dayOneModels = [model('openai', 'shared-model', 1.25), model('other-provider', 'shared-model', 2.5), model('openai', 'unknown-model', 0, 2), model('openai', unsafeModel, .75), ...Array.from({ length: 26 }, (_, i) => model('openai', `extra-model-${String(i).padStart(2, '0')}`, 0))];
const dayTwoModels = [model('openai', 'shared-model', 3.75), model('other-provider', 'shared-model', 1.5), model('openai', 'unknown-model', 0, 1), model('openai', unsafeModel, .25)];
const projectSnapshot = { currency: 'USD', days: [
  { date: '2024-02-05', projects: [{ id: 'alpha', name: 'Alpha project', amount: 4.5, unpriced: 2, models: dayOneModels }, { id: 'beta', name: 'Beta project', amount: 7, unpriced: 0, models: [model('openai', 'beta-only', 7)] }] },
  { date: '2024-02-06', projects: [{ id: 'alpha', name: 'Alpha project', amount: 5.5, unpriced: 1, models: dayTwoModels }] },
  { date: '2024-01-31', projects: [{ id: 'alpha', name: 'Alpha project', amount: 999, unpriced: 0, models: [model('openai', 'outside-month', 999)] }] },
] };
const monthlyModels = dayOneModels.map(value => { const other = dayTwoModels.find(item => item.provider === value.provider && item.model === value.model); return { ...value, amount: value.amount + (other?.amount ?? 0), unpriced: value.unpriced + (other?.unpriced ?? 0) }; });
let view, panel, surface, subscriber, emitted, updates = 0;
const actions = [], requests = [];
let resetOutcome = 'reset', resetCalls = [];
function createView() {
  view?.dispose();
  const service = Object.assign(new EventEmitter(), { changesEnabled: true, state: { profiles, activeProfileId: 'saved-a' }, async refresh() { return this.state; }, async projectUsage(year) { requests.push(['projectUsage', year]); return structuredClone(projectSnapshot); }, async devin() { return { enabled: true, loggedIn: true, email: 'cli@example.com' }; } });
  const usage = { get: id => ({ data: usageData(id) }), dueResetProfiles: () => [], async refresh(id, ws) { requests.push(['openai', id, ws]); } };
  const providers = { enabled: true, snapshot, async refresh() { return snapshot; }, async quota(providerId, accountId) { requests.push([providerId, accountId]); return { providerId, accountId, status: 'ok', source: 'synthetic', observedAt: Date.now(), rows: providerId === 'anthropic' ? [{ label: '5시간', usedPercent: 1, resetsAt: resetAt }, { label: 'Fable', usedPercent: 0, resetsAt: resetAt }] : [{ label: 'Pro', usedPercent: 0, resetsAt: resetAt }] }; }, async resetUsage(providerId, accountId) { resetCalls.push({providerId,accountId}); await new Promise(resolve => setTimeout(resolve, 450)); if(resetOutcome==='failure') throw Error('Synthetic reset transport failure'); return resetOutcome; }, async setAutoSwitch(providerId, accountId, enabled) { actions.push({ providerId, accountId, enabled }); }, dispose() {} };
  const devin = { snapshot: undefined, async refresh() { requests.push(['devin-cli']); this.snapshot = { daily: window(0, 1440), weekly: window(24, 10080) }; }, cancelRefresh() {}, dispose() {} };
  view = new UsageView(service, usage, devin, providers);
  view.costMonth = '2024-02';
  let source = '';
  panel = { visible: true, webview: {}, dispose() {} };
  Object.defineProperty(panel.webview, 'html', { get: () => source, set: value => { source = value; if (surface === 'standalone') { emitted = value.slice(value.indexOf('<body>') + 6, value.lastIndexOf('<script nonce=')); updates++; } } });
  view.panel = panel;
}
const boot = `globalThis.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));let fixtureRoot;globalThis.fixturePending=0;globalThis.fixtureNode=s=>(fixtureRoot||document).querySelector(s);globalThis.fixtureNodes=s=>[...(fixtureRoot||document).querySelectorAll(s)];globalThis.fixtureSend=async message=>{fixturePending++;try{const r=await fetch('/action',{method:'POST',body:JSON.stringify(message)}),data=await r.json();if(data.error)throw Error(data.error);if(data.html){if(fixtureRoot)fixtureSubscriber({clientId:fixtureClientId,html:data.html});else document.body.innerHTML=data.html;}}finally{fixturePending--;}};let fixtureState;globalThis.acquireVsCodeApi=()=>({postMessage:m=>void fixtureSend(m),getState:()=>fixtureState,setState:s=>fixtureState=s});`;
const embeddedBoot = `globalThis.fixtureClientId=null;globalThis.fixtureSubscriber=null;globalThis.azraelAccountBridge={dispatchMessage(type,p){if(p.action==='mount'){fixtureClientId=p.clientId;fixtureSend({fixtureMount:true,clientId:p.clientId})}else if(p.action==='action')fixtureSend(p.message)},subscribe(type,fn){fixtureSubscriber=fn;return()=>{fixtureSubscriber=null}}};const effects=[];globalThis.Q={useRef:()=>({current:null}),useEffect:fn=>effects.push(fn)};globalThis.$={jsx:(type,props)=>({type,props})};${AzraelAccountSettings.toString()};const component=AzraelAccountSettings();const mount=document.createElement(component.type);component.props.ref.current=mount;document.body.append(mount);effects.forEach(fn=>fn());fixtureRoot=mount.shadowRoot;`;
const css = '<link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css">';
const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/assets/')) { const path = resolve(assets, decodeURIComponent(req.url.slice(8))); assert(path.startsWith(assets + sep)); res.setHeader('Content-Type', extname(path) === '.css' ? 'text/css' : 'application/octet-stream'); res.end(await readFile(path)); return; }
    if (req.url === '/action') {
      let body = ''; for await (const chunk of req) body += chunk;
      const message = JSON.parse(body), before = updates;
      if (message.fixtureMount) { view.embedded.set({ postMessage(m) { emitted = m.html; updates++; return true; } }, { clientId: message.clientId }); view.render(); }
      else if (message.fixtureResetSnapshot) view.render();
      else if (message.fixtureResetOutcome) resetOutcome = message.fixtureResetOutcome;
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
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
    await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?surface=${surfaceName}`});
    await wait("typeof fixtureNodes==='function'&&fixtureNodes('.account-summary').length===5&&fixturePending===0");
    await evaluate(`document.documentElement.dataset.theme='${theme}';document.documentElement.style.setProperty('--vscode-foreground','${theme==='light'?'#202123':'#eee'}');document.documentElement.style.setProperty('--vscode-editor-background','${theme==='light'?'#fff':'#212121'}');document.documentElement.style.setProperty('--vscode-descriptionForeground','${theme==='light'?'#666':'#aaa'}');document.body.style.background='${theme==='light'?'#fff':'#212121'}'`);
    check(prefix+' all collapsed gauges',await evaluate("fixtureNodes('.track[role=progressbar]').length===9&&fixtureNodes('.account-summary').every(e=>e.getAttribute('aria-expanded')==='false')"));
    const themeColors=await evaluate("(()=>{const main=getComputedStyle(fixtureNode('main')),badge=getComputedStyle(fixtureNode('.current-login'));const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d',{willReadFrequently:true});const rgb=color=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);return Array.from(context.getImageData(0,0,1,1).data).slice(0,3);};return {background:main.backgroundColor,foreground:main.color,badgeBackground:badge.backgroundColor,backgroundRgb:rgb(main.backgroundColor),foregroundRgb:rgb(main.color),badgeRgb:rgb(badge.backgroundColor)};})()");
    summary.themeColors??=[];summary.themeColors.push({prefix,...themeColors});
    const bg=themeColors.backgroundRgb,fg=themeColors.foregroundRgb,badge=themeColors.badgeRgb;
    check(prefix+' readable native themed surface and neutral badge',bg?.length===3&&fg?.length===3&&badge?.length===3&&Math.abs(bg.reduce((a,b)=>a+b,0)-fg.reduce((a,b)=>a+b,0))>240&&Math.max(...badge)-Math.min(...badge)<8);
    if(theme==='dark'){const light=summary.themeColors.find(s=>s.prefix===`${surfaceName}-light-${width}`);check(prefix+' actual dark colors differ from light',!!light&&themeColors.background!==light.background&&themeColors.foreground!==light.foreground&&themeColors.background!=='rgb(255, 255, 255)');}
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
    check(prefix+' reset button appears only for expanded Anthropic',await evaluate("fixtureNodes('[data-action=providerResetUsage]').length===1&&fixtureNode('[data-action=providerResetUsage]').dataset.provider==='anthropic'"));
    const resetBefore=resetCalls.length,quotaBefore=requests.filter(r=>r[0]==='anthropic').length;
    resetOutcome='reset';
    await evaluate("fixtureNode('[data-action=providerResetUsage]').click();fixtureSend({fixtureResetSnapshot:true})");
    await wait("fixtureNode('[data-action=providerResetUsage]').disabled===true");
    check(prefix+' reset busy button is disabled and labelled',await evaluate("fixtureNode('[data-action=providerResetUsage]').getAttribute('aria-busy')==='true'&&fixtureNode('[data-action=providerResetUsage]').textContent==='리셋 중…'"));
    await evaluate("fixtureNode('[data-action=providerResetUsage]').click()");await wait('fixturePending===0');
    check(prefix+' reset executes once for the correct account and refreshes usage',resetCalls.length===resetBefore+1&&resetCalls.at(-1).accountId==='claude-a'&&requests.filter(r=>r[0]==='anthropic').length>quotaBefore);
    check(prefix+' reset button recovers after success',await evaluate("!fixtureNode('[data-action=providerResetUsage]').disabled"));
    for(const [outcome,notice] of [['noCredit','사용 가능한 무료 리셋이 없습니다.'],['nothingToReset','초기화할 사용량이 없어 리셋하지 않았습니다.'],['cooldown','지금은 무료 리셋을 사용할 수 없습니다.'],['failure','Synthetic reset transport failure']]){
      resetOutcome=outcome;await evaluate("fixtureNode('[data-action=providerResetUsage]').focus()");
      check(prefix+' reset keyboard focus '+outcome,await evaluate("(fixtureNode('[data-action=providerResetUsage]').getRootNode().activeElement)===fixtureNode('[data-action=providerResetUsage]')"));
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await wait('fixturePending>0');await wait('fixturePending===0');
      check(prefix+' reset '+outcome+' notice and button recovery',resetNotices.at(-1)?.startsWith(notice)&&await evaluate("!fixtureNode('[data-action=providerResetUsage]').disabled"));
    }
    await evaluate("fixtureNode('.account-summary').click()");await wait("fixtureNode('.account-summary').getAttribute('aria-expanded')==='true'&&fixturePending===0");
    const expanded=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(logs,prefix+'-expanded.png'),Buffer.from(expanded.data,'base64'));summary.screenshots.push(prefix+'-expanded.png');
    check(prefix+' no browser page errors',await evaluate('fixtureErrors.length===0'));
    await wait("fixtureNodes('.provider-icon img').every(e=>e.complete&&e.naturalWidth>0)");
    check(prefix+' official logos loaded and one variant visible',await evaluate("fixtureNodes('.provider-icon').every(e=>Array.from(e.children).filter(c=>getComputedStyle(c).display!=='none').length===1)"));
    await wait("fixtureNode('.puc-month').textContent.includes('2024.02')&&fixtureNodes('.puc-project').length===2");
    check(prefix+' project month total preserves incomplete status',await evaluate("fixtureNode('.puc-total').textContent===new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(17)+' · ?×3'"));
    const tooltipCases = [
      { name: 'monthly-alpha', selector: '.puc-project', models: monthlyModels, amount: 10, unpriced: 3, label: 'Alpha project', projects: [] },
      { name: 'monthly-beta', selector: '.puc-project:nth-child(2)', models: [model('openai', 'beta-only', 7)], amount: 7, unpriced: 0, label: 'Beta project', projects: [] },
      { name: 'day-one', selector: '.puc-cell[data-date="2024-02-05"]', models: [...dayOneModels, model('openai', 'beta-only', 7)], amount: 11.5, unpriced: 2, label: '2024-02-05', projects: [['Beta project', 7, 0], ['Alpha project', 4.5, 2]] },
      { name: 'day-two', selector: '.puc-cell[data-date="2024-02-06"]', models: dayTwoModels, amount: 5.5, unpriced: 1, label: '2024-02-06', projects: [['Alpha project', 5.5, 1]] },
    ];
    for (const item of tooltipCases) {
      const selector=JSON.stringify(item.selector);
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width-2,y:2});
      await evaluate(`fixtureNode(${selector}).scrollIntoView({block:'center',inline:'center'})`);
      await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await evaluate(`fixtureNode(${selector}).focus()`);
      check(prefix+' '+item.name+' keyboard focus reveals tooltip',await evaluate(`fixtureNode(${selector}).matches(':focus-visible')&&getComputedStyle(fixtureNode(${selector}).querySelector('.puc-tooltip')).display==='block'`));
      const initialBounds=await evaluate(`(()=>{const r=fixtureNode(${selector}).querySelector('.puc-tooltip').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,viewportHeight:innerHeight};})()`);
      summary.initialTooltipBounds??=[];summary.initialTooltipBounds.push({prefix,name:item.name,...initialBounds});
      if(initialBounds.top<0||initialBounds.bottom>1100){
        const naturalShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const naturalName=prefix+'-'+item.name+'-natural-bounds.png';await writeFile(join(logs,naturalName),Buffer.from(naturalShot.data,'base64'));summary.screenshots.push(naturalName);
        await evaluate(`fixtureNode(${selector}).querySelector('.puc-tooltip').scrollIntoView({block:'nearest',inline:'nearest'})`);
      }
      const expected={ models:item.models, amount:item.amount, unpriced:item.unpriced, label:item.label, projects:item.projects };
      check(prefix+' '+item.name+' exact monetary model and project scope',await evaluate(`(()=>{const expected=${JSON.stringify(expected)},tip=fixtureNode(${selector}).querySelector('.puc-tooltip'),money=value=>new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(value),amount=(value,count)=>(value===0&&count>0?'—':money(value))+(count?' · ?×'+count:'');const rows=Array.from(tip.querySelectorAll('.puc-tip-model')).map(row=>Array.from(row.children).map(child=>child.textContent));const wanted=expected.models.map(item=>[item.model+' · '+item.provider,amount(item.amount,item.unpriced)]);const projectRows=Array.from(tip.querySelectorAll('.puc-tip-row:not(.puc-tip-model)')).map(row=>Array.from(row.children).map(child=>child.textContent));return tip.querySelector('strong').textContent===expected.label&&tip.querySelector('.puc-tip-total').textContent===amount(expected.amount,expected.unpriced)&&JSON.stringify(rows.sort())===JSON.stringify(wanted.sort())&&JSON.stringify(projectRows)===JSON.stringify(expected.projects.map(([name,value,count])=>[name,amount(value,count)]));})()`));
      check(prefix+' '+item.name+' model HTML escaped',await evaluate(`!fixtureNode(${selector}).querySelector('.puc-tooltip img')&&!globalThis.modelInjectionExecuted`));
      check(prefix+' '+item.name+' incomplete styling preserved',await evaluate(`fixtureNode(${selector}).${item.selector.startsWith('.puc-project') ? "querySelector('.puc-bar')." : ''}classList.contains('puc-incomplete')===${item.unpriced>0}`));
      await evaluate(`fixtureNode(${selector}).blur();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      await evaluate(`fixtureNode(${selector}).scrollIntoView({block:'center',inline:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const target=await evaluate(`(()=>{const r=fixtureNode(${selector}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',...target});
      if(item.selector.startsWith('.puc-cell')){
        // Tooltip bounds must not scroll ancestors when pointer selection starts with focus.
        await evaluate(`fixtureNode('.puc-nav').focus({preventScroll:true});globalThis.selectedCellBefore=fixtureNode(${selector})`);
        const before=await evaluate(`({left:fixtureNode('.puc-calendar-scroll').scrollLeft,top:scrollY})`);
        await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...target});
        await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...target});
        await wait('fixturePending===0');
        check(prefix+' '+item.name+' same month preserves existing day node',await evaluate(`selectedCellBefore===fixtureNode(${selector})`));
        check(prefix+' '+item.name+' pointer selection preserves horizontal and page scroll',await evaluate(`fixtureNode('.puc-calendar-scroll').scrollLeft===${before.left}&&scrollY===${before.top}`));
      }
      check(prefix+' '+item.name+' mouse hover reveals tooltip',await evaluate(`getComputedStyle(fixtureNode(${selector}).querySelector('.puc-tooltip')).display==='block'`));
      const geometry=await evaluate(`(()=>{const t=fixtureNode(${selector}).querySelector('.puc-tooltip'),r=t.getBoundingClientRect(),s=getComputedStyle(t);return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scrollHeight:t.scrollHeight,clientHeight:t.clientHeight,overflow:s.overflowY,color:s.color,background:s.backgroundColor};})()`);
      summary.tooltipGeometry??=[];summary.tooltipGeometry.push({prefix,name:item.name,...geometry});
      check(prefix+' '+item.name+' visible tooltip fits viewport',geometry.left>=0&&geometry.right<=width&&geometry.top>=0&&geometry.bottom<=1100);
      check(prefix+' '+item.name+' tooltip uses theme palette',geometry.color!==geometry.background);
      if(item.models.length>20){
        check(prefix+' '+item.name+' long list has bounded scrolling',geometry.scrollHeight>geometry.clientHeight&&geometry.clientHeight<=360&&geometry.overflow==='auto');
        const tipTarget=await evaluate(`(()=>{const r=fixtureNode(${selector}).querySelector('.puc-tooltip').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        if(item.selector.startsWith('.puc-project')){
          const gap=await evaluate(`(()=>{const r=fixtureNode(${selector}).getBoundingClientRect();return{x:r.x+20,y:r.y-4};})()`);
          await send('Input.dispatchMouseEvent',{type:'mouseMoved',...gap});
          check(prefix+' '+item.name+' hover survives gap into model tooltip',await evaluate(`getComputedStyle(fixtureNode(${selector}).querySelector('.puc-tooltip')).display==='block'`));
        }
        await send('Input.dispatchMouseEvent',{type:'mouseMoved',...tipTarget});
        await send('Input.dispatchMouseEvent',{type:'mouseWheel',...tipTarget,deltaX:0,deltaY:180});
        await wait(`fixtureNode(${selector}).querySelector('.puc-tooltip').scrollTop>0`);
        check(prefix+' '+item.name+' mouse scroll keeps tooltip open',await evaluate(`getComputedStyle(fixtureNode(${selector}).querySelector('.puc-tooltip')).display==='block'`));
        await evaluate(`fixtureNode(${selector}).querySelector('.puc-tooltip').scrollTop=0`);
      }
      const tooltipShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      const screenshotName=prefix+'-'+item.name+'-models.png';await writeFile(join(logs,screenshotName),Buffer.from(tooltipShot.data,'base64'));summary.screenshots.push(screenshotName);
    }
    if(surfaceName==='embedded'){
      const before=await evaluate(`({left:fixtureNode('.puc-calendar-scroll').scrollLeft,top:scrollY})`);
      await evaluate(`fixtureNode('.puc-nav[data-month="2024-03"]').click()`);
      await wait("fixturePending===0&&fixtureNode('.puc-month').textContent.includes('2024.03')");
      check(prefix+' month change preserves available calendar and page scroll',await evaluate(`fixtureNode('.puc-calendar-scroll').scrollLeft===${before.left}&&scrollY===Math.min(${before.top},Math.max(0,document.scrollingElement.scrollHeight-innerHeight))`));
    }
    check(prefix+' project model fixture has no browser errors',await evaluate('fixtureErrors.length===0'));
    if(process.env.AZRAEL_RENDER_PROVIDER_BRAND_CAPTURE==='1'&&surfaceName==='standalone'&&width===1050){
      const brands=[['openai','OpenAI'],['anthropic','Anthropic'],['google','Google'],['google-antigravity','Google Antigravity'],['google-gemini-cli','Gemini CLI'],['devin-cli','Devin'],['openrouter','OpenRouter'],['xai','xAI']];
      const markup='<section id="brand-capture">'+brands.map(([id,label])=>providerHeadingHtml(id,label,0)).join('')+'</section>';
      await evaluate(`fixtureNode('main').insertAdjacentHTML('beforeend',${JSON.stringify(markup)});document.getElementById('brand-capture').scrollIntoView()`);
      await wait("Array.from(document.querySelectorAll('#brand-capture img')).every(e=>e.complete&&e.naturalWidth>0)");
      check(prefix+' all original provider assets decode',await evaluate("Array.from(document.querySelectorAll('#brand-capture .provider-icon')).every(e=>Array.from(e.children).filter(c=>getComputedStyle(c).display!=='none').length===1)"));
      const clip=await evaluate("(()=>{const r=document.getElementById('brand-capture').getBoundingClientRect();return{x:r.x,y:r.y+scrollY,width:r.width,height:r.height,scale:2};})()");
      const brandsShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});
      await writeFile(join(logs,'provider-brands-'+theme+'.png'),Buffer.from(brandsShot.data,'base64'));
      summary.screenshots.push('provider-brands-'+theme+'.png');
    }
  }
  check('collapsed summary identities refreshed',profiles.every(p=>requests.some(r=>r[0]==='openai'&&r[1]===p.id&&r[2]===p.workspaceAccountId))&&requests.some(r=>r[0]==='anthropic')&&requests.some(r=>r[0]==='google')&&requests.some(r=>r[0]==='devin-cli'));
  check('production project usage refresh requests deterministic fixture year',requests.filter(r=>r[0]==='projectUsage').length>=8&&requests.filter(r=>r[0]==='projectUsage').every(r=>r[1]===2024));
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
    const cleanup=spawn('pwsh',['-NoProfile','-Command','& ./scripts/clean-verification-artifacts.ps1 -FixtureRoot $env:AZRAEL_RENDER_CLEANUP_FIXTURE -IncludeDiagnosedFixtures -Apply -ReportPath $env:AZRAEL_RENDER_CLEANUP_REPORT'],{cwd:root,env:{...process.env,AZRAEL_RENDER_CLEANUP_FIXTURE:fixture,AZRAEL_RENDER_CLEANUP_REPORT:join(logs,'cleanup-report.json')},windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';cleanup.stdout.on('data',b=>text+=b);cleanup.stderr.on('data',b=>text+=b);summary.cleanupExitCode=await new Promise((r,j)=>{cleanup.on('error',j);cleanup.on('exit',r);});await writeFile(join(logs,'cleanup.log'),text);summary.fixtureRemoved=await access(fixture).then(()=>false,()=>true);if(summary.cleanupExitCode!==0||!summary.fixtureRemoved)process.exitCode=1;
  }else{summary.retentionReason='Browser exit unconfirmed; remove profile after exit';process.exitCode=1;}
  summary.resetNotices=resetNotices;summary.resetCalls=resetCalls;summary.exitCode=process.exitCode||0;await writeFile(join(logs,'overview-render-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks.length,error:summary.error,exitCode:summary.exitCode,fixtureRemoved:summary.fixtureRemoved}));
}
