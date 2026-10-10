import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';

const root = resolve(import.meta.dirname, '..');
const fixture = join(root, 'artifacts/verification/work-completion-render');
const logs = join(root, 'artifacts/logs/work-completion');
await mkdir(fixture, { recursive: true }); await mkdir(logs, { recursive: true });
const require = createRequire(import.meta.url);
const ts = require(require.resolve('typescript', { paths: [join(root, 'extensions/azrael-ex')] }));
const load = async (name, imports) => {
  const exports = {};
  runInNewContext(ts.transpileModule(await readFile(join(root, 'extensions/azrael-ex/src', name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: id => imports[id], setInterval, clearInterval });
  return exports;
};
const protocol = await load('rootResumeProtocol', { './protocol': { isRecord: value => !!value && typeof value === 'object' && !Array.isArray(value) } });
let html, view, receive, server, chrome, socket, send, session, sequence = 0;
const pending = new Map(), requests = [], warnings = [];
const webview = { onDidReceiveMessage(fn) { receive = fn; }, set html(value) { html = value; } };
const panel = { webview, visible: true, reveal() {}, onDidChangeViewState() {}, onDidDispose() {}, dispose() {} };
const { RootResumeView } = await load('rootResumeView', { './rootResumeProtocol': protocol, vscode: { ViewColumn: { Active: 1 }, window: {
  createWebviewPanel() { return panel; }, async showWarningMessage(message) { warnings.push(message); return '예약 취소'; }, showErrorMessage() {}
} } });
const service = new EventEmitter(); service.rootResumeAvailable = true;
const base = { id: 'mixed', rootThreadId: 'root', originatingTurnId: 'origin', rootTurnId: 'origin', callId: 'call', resumeTurnId: 'resume', resumeAtMs: Date.now() + 3600000, createdAtMs: 0, updatedAtMs: 0, revision: 7, state: 'waiting', agentTasks: [], completionTasks: [], reason: '작업 종료 대기', wakeReason: null, lastError: null };
service.rootResumeReservations = protocol.parseRootResumeResponse({ reservations: [
  { ...base, agentTasks: [{ threadId: 'child', agentPath: '/root/child', turnId: 'turn-child' }], completionTasks: ['exec:session-123', 'cell:<job>'] },
  { ...base, id: 'jobs', reason: '작업만 대기', completionTasks: ['exec:session-456'] },
  { ...base, id: 'agents', reason: '하위 에이전트 대기', agentTasks: [{ threadId: 'child-2', agentPath: '/root/second', turnId: 'turn-2' }] },
  { ...base, id: 'timed', reason: '예약 시각 대기' }
] }).reservations;
service.rootResume = async request => { requests.push(request); return { reservations: service.rootResumeReservations }; };
const summary = { scope: 'Windows Chrome CDP, transpiled production RootResumeView and protocol with mocked VS Code/account service. No installed host or native runtime acceptance.', checks: [] };
const check = (name, condition) => { assert(condition, name); summary.checks.push(name); };
const exited = () => chrome && (chrome.exitCode !== null || chrome.signalCode !== null);
try {
  view = new RootResumeView(service); view.show(); await new Promise(r => setTimeout(r, 0));
  server = createServer(async (req, res) => {
    if (req.url === '/message') { let body = ''; for await (const chunk of req) body += chunk; await receive(JSON.parse(body)); res.end('ok'); return; }
    const nonce = html.match(/<script nonce="([^"]+)"/)[1];
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Inject only the VS Code API boundary; markup, styles and events remain production code.
    res.end(html.replace("default-src 'none';", "default-src 'none'; connect-src 'self';").replace('<body>', `<body><script nonce="${nonce}">globalThis.acquireVsCodeApi=()=>({postMessage(m){globalThis.messageDone=fetch('/message',{method:'POST',body:JSON.stringify(m)})}})</script>`));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${join(fixture, 'profile')}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => { let output = ''; const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 20000); chrome.on('error', reject); chrome.stderr.on('data', data => { output += data; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } }); });
  socket = new WebSocket(endpoint); await new Promise((r, j) => { socket.addEventListener('open', r, { once: true }); socket.addEventListener('error', j, { once: true }); });
  socket.addEventListener('message', event => { const message = JSON.parse(event.data), request = pending.get(message.id); if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(Error(JSON.stringify(message.error))) : request.resolve(message.result); } });
  send = (method, params = {}, sid = session) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => reject(Error('CDP timed out: ' + method)), 10000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
  const target = await send('Target.createTarget', { url: 'about:blank' }, null); session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await send('Page.enable'); await send('Runtime.enable');
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
  for (let n = 0; n < 100 && !await evaluate('!!document.querySelector(".card")'); n++) await new Promise(r => setTimeout(r, 25));
  for (const theme of ['light', 'dark']) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1400, deviceScaleFactor: 1, mobile: false });
    const foreground = theme === 'light' ? '#202020' : '#ececec', background = theme === 'light' ? '#ffffff' : '#181818';
    await evaluate(`(()=>{const s=document.documentElement.style;for(const [key,value] of Object.entries(${JSON.stringify({ '--vscode-font-family': 'Arial, sans-serif', '--vscode-editor-font-family': 'Consolas, monospace', '--vscode-foreground': foreground, '--vscode-descriptionForeground': theme === 'light' ? '#666666' : '#aaaaaa', '--vscode-panel-border': theme === 'light' ? '#dedede' : '#444444', '--vscode-badge-background': theme === 'light' ? '#ececec' : '#333333', '--vscode-badge-foreground': foreground, '--vscode-button-background': '#0969da', '--vscode-button-foreground': '#ffffff', '--vscode-button-hoverBackground': '#0858bb', '--vscode-button-secondaryBackground': theme === 'light' ? '#ececec' : '#333333', '--vscode-button-secondaryForeground': foreground, '--vscode-charts-blue': theme === 'light' ? '#0969da' : '#75b4ff' })}))s.setProperty(key,value);document.body.style.background=${JSON.stringify(background)};})()`);
    const state = await evaluate(`(()=>{const cards=[...document.querySelectorAll('.card')];return {count:cards.length,conditions:cards.map(c=>c.querySelector('.condition').textContent),literal:cards[0].textContent.includes('cell:<job>'),items:cards[0].querySelectorAll('li').length,color:getComputedStyle(document.body).color,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
    check(theme + ' shows all four reservation conditions and literal IDs', state.count === 4 && state.literal && state.items === 3 && state.conditions[0] === '다음 하위 에이전트와 작업이 모두 종료되면 조기 재개 · 예약 시각에 재개' && state.conditions[1] === '다음 작업이 모두 종료되면 조기 재개 · 예약 시각에 재개' && state.conditions[2].includes('하위 에이전트가 모두') && state.conditions[3] === '예약 시각에 재개');
    check(theme + ' foreground and viewport', !state.overflow && state.color === (theme === 'light' ? 'rgb(32, 32, 32)' : 'rgb(236, 236, 236)'));
    await writeFile(join(logs, `management-${theme}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    for (const action of ['resume', 'cancel']) {
      const previous = requests.length;
      await evaluate(`document.querySelector('[data-action="${action}"][data-id="mixed"]').click();globalThis.messageDone`);
      check(theme + ' ' + action + ' routes selected ID/revision', requests.length === previous + 1 && requests.at(-1).action === action && requests.at(-1).reservationId === 'mixed' && requests.at(-1).revision === 7);
    }
    check(theme + ' cancel confirmation explains continuing jobs', warnings.at(-1).includes('작업은 계속 실행'));
  }
  summary.outcome = 'passed';
} catch (error) { summary.outcome = 'failed'; summary.error = error.stack; process.exitCode = 1; }
finally {
  if (socket?.readyState === WebSocket.OPEN && !exited()) await send('Browser.close', {}, null).catch(() => {});
  socket?.close(); for (const request of pending.values()) clearTimeout(request.timer); view?.dispose(); await new Promise(r => server?.close(r) ?? r());
  if (chrome && !exited()) await Promise.race([new Promise(r => chrome.once('exit', r)), new Promise(r => setTimeout(r, 5000))]);
  summary.browserExited = !chrome || exited(); summary.fixtureCleanup = 'Remove owned fixture with native PowerShell after confirmed browser exit.';
  if (!summary.browserExited) process.exitCode = 1;
  summary.exitCode = process.exitCode || 0; await writeFile(join(logs, 'management-render-result.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
}
