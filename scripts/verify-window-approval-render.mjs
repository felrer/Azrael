import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { Script } from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const fixture = join(root, 'artifacts/verification/window-approval-render');
const logs = join(root, 'artifacts/logs/window-use-in-app-approval/panel');
assert(fixture.startsWith(join(root, 'artifacts/verification') + sep));
await mkdir(fixture, { recursive: true }); await mkdir(logs, { recursive: true });
const require = createRequire(import.meta.url);
const { createHost } = require('./window-control-host.cjs');
const { windowError, errorPayload } = require('./window-control-errors.cjs');
let html, receive, socket, chrome, session, sequence = 0, server, send;
const posts = [], pending = new Map();
const webview = { onDidReceiveMessage(fn) { receive = fn; }, postMessage(m) { posts.push(m); return Promise.resolve(true); }, set html(value) { html = value; } };
const host = createHost({ runtime: { codexHome: join(fixture, 'home') }, occupancyDirectory: join(fixture, 'occupancy'), backend: { request: async () => [], dispose: async () => {} }, approvals: {}, vscode: { ViewColumn: { One: 1 }, window: { createWebviewPanel() { return { webview, onDidDispose() {}, reveal() {}, dispose() {} }; } } } });
host.open();
// VS Code supplies this API before the production webview script executes.
html = html.replace('<body>', `<body><script nonce="${host.panelNonce}">globalThis.acquireVsCodeApi=()=>({postMessage(m){globalThis.lastUiRequest=m}})</script>`);
const summary = { scope: 'Production dedicated Window Use approval panel, response routing and terminal states, mocked VS Code host and isolated headless browser; no user window control or installed UI acceptance.', checks: [] };
function check(name, condition) { assert(condition, name); summary.checks.push(name); }
const exited = () => chrome?.exitCode !== null || chrome?.signalCode !== null;
try {
  for (const [, source] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new Script(source);
  check('production webview scripts parse', true);
  server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
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
  for (let n = 0; n < 100 && !await evaluate('!!document.getElementById("conversation")'); n++) await new Promise(r => setTimeout(r, 25));
  const request = { id: 'azrael-window-consent-render', method: 'mcpServer/elicitation/request', params: { threadId: '12345678-1234-1234-1234-123456789abc', _meta: { tool_params_display: [{ name: 'app', value: '<한글 창 제목> — App consent' }] } } };
  for (const theme of ['light', 'dark']) for (const width of [900, 360]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 880, deviceScaleFactor: 1, mobile: false });
    const colors = theme === 'light' ? { foreground:'#202020', background:'#ffffff', widget:'#f7f7f7', border:'#dedede', secondary:'#ececec', description:'#666666' } : { foreground:'#ececec', background:'#181818', widget:'#202020', border:'#444444', secondary:'#333333', description:'#aaaaaa' };
    await evaluate(`(()=>{const c=${JSON.stringify(colors)};const s=document.documentElement.style;for(const [key,value] of Object.entries({'--vscode-foreground':c.foreground,'--vscode-editor-background':c.background,'--vscode-editorWidget-background':c.widget,'--vscode-widget-border':c.border,'--vscode-button-secondaryBackground':c.secondary,'--vscode-button-secondaryForeground':c.foreground,'--vscode-descriptionForeground':c.description,'--vscode-button-background':'#0969da','--vscode-button-foreground':'#ffffff','--vscode-focusBorder':'#0969da'}))s.setProperty(key,value);document.body.style.background=c.background;document.getElementById('conversation').textContent='';})()`);
    const display = async () => evaluate(`window.postMessage(${JSON.stringify({type:'approval',request})},'*');new Promise(r=>setTimeout(r,0))`);
    await display();
    const state = await evaluate(`({visible:!document.getElementById('approval').hidden, app:document.getElementById('approval-app').textContent, heading:document.getElementById('approval-heading').textContent, overflow:document.getElementById('approval').getBoundingClientRect().right>innerWidth, color:getComputedStyle(document.getElementById('approval-app')).color})`);
    check(theme+width+' production consent visible with safe literal title', state.visible && state.app === request.params._meta.tool_params_display[0].value && state.heading === 'Window Use 승인');
    check(theme+width+' approval fits viewport', !state.overflow); check(theme+width+' theme foreground applied',state.color === (theme==='light'?'rgb(32, 32, 32)':'rgb(236, 236, 236)'));
    let shot = await send('Page.captureScreenshot',{format:'png'});await writeFile(join(logs,theme+'-'+width+'-waiting.png'),Buffer.from(shot.data,'base64'));
    for (const choice of ['session','always','decline','cancel']) {
      await display(); await evaluate(`document.querySelector('[data-approval="${choice}"]').click()`);
      const response = await evaluate('lastUiRequest');
      check(theme+width+' '+choice+' response routes by panel/request/thread identity',response.nonce===host.panelNonce&&response.requestId===request.id&&response.threadId===request.params.threadId&&response.type==='approval-response'&&response.result.action===(['session','always'].includes(choice)?'accept':choice));
      if(['session','always'].includes(choice))check(theme+width+' '+choice+' scope',response.result.content.persist===choice);
      check(theme+width+' '+choice+' disables duplicate response', await evaluate(`[...document.querySelectorAll('[data-approval]')].every(b=>b.disabled)`));
    }
    for (const approvalState of ['expired','cancelled','declined','accepted']) {
      await display(); await evaluate(`window.postMessage(${JSON.stringify({type:'approval-resolved',requestId:request.id,threadId:request.params.threadId,approvalState})},'*');new Promise(r=>setTimeout(r,0))`);
      await evaluate(`globalThis.lastUiRequest=null;document.querySelector('[data-approval="always"]').click()`);
      check(theme+width+' '+approvalState+' disables late clicks',await evaluate(`lastUiRequest===null&&[...document.querySelectorAll('[data-approval]')].every(b=>b.disabled)`));
      if(approvalState==='expired'){check(theme+width+' timeout explains no response/no action',await evaluate(`document.getElementById('approval-state').textContent.includes('승인 응답을 받지 못해')&&document.getElementById('approval-state').textContent.includes('창 제어는 실행되지 않았습니다.')`));shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(logs,theme+'-'+width+'-expired.png'),Buffer.from(shot.data,'base64'));}
    }
    const error = {type:'error',text:errorPayload(windowError('approval_timeout','승인 응답을 아직 받지 못해 대기 시간이 초과됐습니다.')).message};
    await evaluate(`window.postMessage(${JSON.stringify(error)},'*');new Promise(r=>setTimeout(r,0))`);
    check(theme+width+' tool error remains visible',await evaluate(`document.getElementById('conversation').textContent.includes(${JSON.stringify(error.text)})`));
  }
  summary.outcome = 'passed'; await send('Browser.close', {}, null).catch(() => {});
} catch (error) { summary.outcome = 'failed'; summary.error = error.message; process.exitCode = 1; }
finally {
  if (socket?.readyState === WebSocket.OPEN && chrome && !exited()) await send('Browser.close', {}, null).catch(() => {});
  socket?.close(); for (const p of pending.values()) clearTimeout(p.timer); await host.dispose(); await new Promise(r => server?.close(r) ?? r());
  if (chrome && !exited()) await Promise.race([new Promise(r => chrome.once('exit', r)), new Promise(r => setTimeout(r, 5000))]);
  if (!chrome || exited()) { await rm(fixture, { recursive: true, force: true }); summary.fixtureRemoved = true; }
  else { summary.fixtureRemoved = false; summary.retentionReason = 'Owned browser has not confirmed exit; remove after its exit.'; process.exitCode = 1; }
  summary.exitCode = process.exitCode || 0; await writeFile(join(logs, 'result.json'), JSON.stringify(summary, null, 2) + '\n');
}
