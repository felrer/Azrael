import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve, join, sep, dirname } from 'node:path';
import { Script } from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const fixture = resolve(process.env.AZRAEL_RENDER_FIXTURE_ROOT || join(root, 'artifacts/verification/window-errors-render'));
const logs = resolve(process.env.AZRAEL_RENDER_LOG_ROOT || join(root, 'artifacts/logs/window-use-errors/ui'));
assert.equal(dirname(fixture).toLowerCase(), join(root, 'artifacts/verification').toLowerCase(), 'fixture must be an immediate verification child');
assert(logs.toLowerCase().startsWith((join(root, 'artifacts/logs') + sep).toLowerCase()), 'logs must stay inside project artifact logs');
const readmeTarget = process.env.AZRAEL_RENDER_README_TARGET_IMAGE;
const targetImagePath = join(root, 'artifacts/logs/readme-native-ui-20261011/accounts/standalone-light-1050-collapsed.png');
if (readmeTarget) assert.equal(resolve(readmeTarget).toLowerCase(), targetImagePath.toLowerCase(), 'README target must be the privacy-safe account fixture');
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
const summary = { scope: 'Production Window Use webview and error handler, mocked VS Code host and isolated headless browser; no user window control or installed UI acceptance.', checks: [] };
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
  const messages = [windowError('approval_timeout', '승인 응답을 아직 받지 못해 대기 시간이 초과됐습니다.'), windowError('approval_declined', 'Application approval refused'), windowError('cancelled', 'Application approval cancelled'), windowError('unclassified', '')].map(e => errorPayload(e).message);
  for (const theme of ['light', 'dark']) {
    await evaluate(`document.documentElement.style.setProperty('--vscode-foreground','${theme === 'light' ? '#202020' : '#ececec'}');document.body.style.background='${theme === 'light' ? '#ffffff' : '#181818'}';document.body.dataset.vscodeThemeKind='vscode-${theme}';document.getElementById('conversation').textContent=''`);
    for (const text of messages) await evaluate(`window.postMessage(${JSON.stringify({ type: 'error', text })},'*');new Promise(r=>setTimeout(r,0))`);
    const state = await evaluate(`({text:document.getElementById('conversation').textContent,color:getComputedStyle(document.getElementById('conversation')).color,overflow:document.documentElement.scrollWidth>innerWidth})`);
    check(theme + ' exact error messages', messages.every(m => state.text.includes(m))); check(theme + ' error text stays in page', !state.overflow);
    check(theme + ' selected theme applied', state.color === (theme === 'light' ? 'rgb(32, 32, 32)' : 'rgb(236, 236, 236)'));
    await evaluate(`document.querySelector('button[data-type="resume"]').click()`);
    const request = await evaluate('lastUiRequest'); check(theme + ' existing resume interaction', request.type === 'resume' && request.nonce === host.panelNonce);
    posts.length = 0; receive(request); for (let n = 0; n < 10 && !posts.length; n++) await new Promise(r => setImmediate(r));
    const actualError = posts.pop(); summary.lastHostError = { type: actualError?.type, text: actualError?.text }; check(theme + ' no selection renders correct cause', actualError?.text === '창을 먼저 선택해주세요.');
    await evaluate(`window.postMessage(${JSON.stringify(actualError)},'*');new Promise(r=>setTimeout(r,0))`);
    check(theme + ' host error reaches displayed conversation', (await evaluate('document.getElementById("conversation").textContent')).includes(actualError.text));
    const shot = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(logs, theme + '.png'), Buffer.from(shot.data, 'base64'));
  }
  if (readmeTarget) {
    const png = await readFile(targetImagePath);
    assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'README target must be PNG');
    const widthPx = png.readUInt32BE(16), heightPx = png.readUInt32BE(20);
    const stateMessage = { type: 'state', threadId: 'demo-fixture', value: {
      targetId: 'demo-fixture', state: 'ready', status: 'Demo fixture — no native input executed',
      window: { title: 'Azrael accounts — demo fixture', widthPx, heightPx, dpi: 96, minimized: false },
      restoreAllowed: false, observationId: 'demo-observation', frameTimestamp: '2026-10-11T00:00:00.000Z',
      widthPx, heightPx, dpi: 96, elementsTruncated: false, elements: [],
      image: { mimeType: 'image/png', data: png.toString('base64') }
    } };
    summary.readmeBoundary = 'Production Window Use panel rendered in an isolated Windows browser with synthetic selected-window state and a production account UI preview containing example.com demo data. No real window selection, capture, native input or native-control acceptance is demonstrated.';
    summary.readmeTarget = { path: targetImagePath, widthPx, heightPx, title: stateMessage.value.window.title };
    await send('Emulation.setDeviceMetricsOverride', { width: 1150, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const theme of ['light', 'dark']) {
      await evaluate(`document.documentElement.style.setProperty('--vscode-foreground','${theme === 'light' ? '#202020' : '#ececec'}');document.body.style.background='${theme === 'light' ? '#ffffff' : '#181818'}';document.body.dataset.vscodeThemeKind='vscode-${theme}';document.getElementById('conversation').textContent='';window.postMessage(${JSON.stringify(stateMessage)},'*');new Promise(r=>setTimeout(r,0))`);
      await evaluate(`document.getElementById('image').decode()`);
      const layout = await evaluate(`({title:document.getElementById('status').textContent,imageWidth:document.getElementById('image').naturalWidth,imageHeight:document.getElementById('image').naturalHeight,elements:document.getElementById('elements').textContent,overflow:document.documentElement.scrollWidth>innerWidth,height:document.documentElement.scrollHeight})`);
      check(theme + ' README synthetic selected target rendered', layout.title.includes('Azrael accounts — demo fixture') && layout.title.includes('ready'));
      check(theme + ' README account preview decoded', layout.imageWidth === widthPx && layout.imageHeight === heightPx);
      check(theme + ' README no fabricated automation elements', layout.elements === '[]');
      check(theme + ' README controls and preview fit width', !layout.overflow);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1150, height: layout.height, scale: 1 } });
      await writeFile(join(logs, theme + '-readme-panel.png'), Buffer.from(shot.data, 'base64'));
    }
  }
  summary.outcome = 'passed'; await send('Browser.close', {}, null).catch(() => {});
} catch (error) { summary.outcome = 'failed'; summary.error = error.message; process.exitCode = 1; }
finally {
  if (socket?.readyState === WebSocket.OPEN && chrome && !exited()) await send('Browser.close', {}, null).catch(() => {});
  socket?.close(); for (const p of pending.values()) clearTimeout(p.timer); await host.dispose(); await new Promise(r => server?.close(r) ?? r());
  if (chrome && !exited()) await Promise.race([new Promise(r => chrome.once('exit', r)), new Promise(r => setTimeout(r, 5000))]);
  if (!chrome || exited()) {
    const cleanup = async apply => {
      const reportPath = join(logs, apply ? 'cleanup.json' : 'cleanup-preview.json');
      // Keep the cleanup command static: its process guard must not mistake its
      // own literal argument path for a process still using the browser profile.
      const child = spawn('pwsh', ['-NoProfile', '-Command', '& $env:AZRAEL_RENDER_CLEANUP_SCRIPT -ProjectRoot $env:AZRAEL_RENDER_PROJECT_ROOT -FixtureRoot $env:AZRAEL_RENDER_FIXTURE_ROOT -IncludeDiagnosedFixtures -ReportPath $env:AZRAEL_RENDER_CLEANUP_REPORT -Apply:([bool]::Parse($env:AZRAEL_RENDER_CLEANUP_APPLY))'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AZRAEL_RENDER_CLEANUP_SCRIPT: join(root, 'scripts/clean-verification-artifacts.ps1'), AZRAEL_RENDER_PROJECT_ROOT: root, AZRAEL_RENDER_FIXTURE_ROOT: fixture, AZRAEL_RENDER_CLEANUP_REPORT: reportPath, AZRAEL_RENDER_CLEANUP_APPLY: String(apply) } });
      let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
      const exitCode = await new Promise((r, j) => { child.once('error', j); child.once('exit', r); });
      await writeFile(join(logs, apply ? 'cleanup.log' : 'cleanup-preview.log'), output);
      check('guarded cleanup ' + (apply ? 'apply' : 'preview') + ' succeeded', exitCode === 0);
    };
    try {
      await cleanup(false); await cleanup(true);
      summary.fixtureRemoved = await access(fixture).then(() => false, error => { if (error.code === 'ENOENT') return true; throw error; });
      check('fixture absence verified after cleanup', summary.fixtureRemoved);
    } catch (error) { summary.fixtureRemoved = false; summary.retentionReason = error.message; summary.outcome = 'failed'; process.exitCode = 1; }
  }
  else { summary.fixtureRemoved = false; summary.retentionReason = 'Owned browser has not confirmed exit; remove after its exit.'; process.exitCode = 1; }
  summary.exitCode = process.exitCode || 0; await writeFile(join(logs, 'result.json'), JSON.stringify(summary, null, 2) + '\n');
}
