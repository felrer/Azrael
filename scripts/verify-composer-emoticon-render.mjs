import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'artifacts/verification/composer-emoticon-render');
const logs = join(root, 'artifacts/logs/composer-session-emoticons/render');
const profile = join(fixture, 'chrome-profile');
const assets = join(root, 'artifacts/upstream-ui/26.1007.21434/webview/assets');
const require = createRequire(import.meta.url);
const ts = require('../extensions/azrael-ex/node_modules/typescript');
const { COMPOSER_ASSET, COMPOSER_EMOTICONS, injectUiCleanup } = require('./inject-ui-cleanup.cjs');
const native = injectUiCleanup(await readFile(join(root, 'artifacts/upstream-ui/26.1007.21434', COMPOSER_ASSET), 'utf8'),COMPOSER_ASSET,ts).text;
const ast=ts.createSourceFile('composer.js',native,99,true,1);
const hook=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='mPi').getText(ast);
const ASSET=COMPOSER_ASSET;
const adapter=`import {nLt,XAt} from '/assets/app-initial-97d3534ad35f.js';
const React=nLt();${hook}
window.faces=${JSON.stringify(COMPOSER_EMOTICONS)};
function Fixture(){const [text,setText]=React.useState(''),[session,setSession]=React.useState('thread-a');window.setSession=setSession;
const placeholder=mPi({sessionKey:['local',session]});
return React.createElement('main',{className:'mx-auto flex w-full max-w-xl flex-col gap-4 p-8 text-default'},React.createElement('textarea',{'aria-label':'Message',className:'min-h-24 rounded-xl border border-token-border-default bg-token-bg-primary p-4 text-default',placeholder,value:text,onChange:e=>setText(e.target.value)}),React.createElement('button',{id:'clear',onClick:()=>setText(''),className:'rounded-lg border p-2'},'Clear'));}
window.reactRoot=XAt().createRoot(document.getElementById('root'));window.reactRoot.render(React.createElement(Fixture));window.fixtureReady=true;`;
const html = `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"></head><body data-vscode-theme-kind="vscode-light"><div id="root"></div><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module" src="/fixture.js"></script></body></html>`;
await mkdir(profile, { recursive: true });
await mkdir(logs, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(adapter); return; }
    if (req.url.startsWith('/assets/')) {
      const file = resolve(assets, decodeURIComponent(req.url.slice(8)).split('?')[0]);
      assert(file.startsWith(assets + sep));
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream');
      res.end(file === join(assets, ASSET.split('/').at(-1)) ? native : await readFile(file)); return;
    }
    res.statusCode = 404; res.end();
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let chrome, socket, session, id = 0;
const pending = new Map();
const summary = { scope: 'Production mPi placeholder with pinned React and CSS in a synthetic textarea surface. No full composer or installed-host acceptance.', inputSha256: createHash('sha256').update(native).update(hook).digest('hex'), checks: [] };
try {
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((r, j) => { let output = ''; const timeout = setTimeout(() => j(Error('Chrome startup timeout')), 20000); chrome.stderr.on('data', c => { output += c; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); r(match[1]); } }); chrome.on('error', j); });
  socket = new WebSocket(endpoint);
  await new Promise((r, j) => { socket.addEventListener('open', r, { once: true }); socket.addEventListener('error', j, { once: true }); });
  socket.addEventListener('message', e => { const m = JSON.parse(e.data), p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timeout); m.error ? p.j(Error(JSON.stringify(m.error))) : p.r(m.result); } });
  const send = (method, params = {}, sid = session) => new Promise((r, j) => { const n = ++id, timeout = setTimeout(() => { pending.delete(n); j(Error('CDP timeout ' + method)); }, 20000); pending.set(n, { r, j, timeout }); socket.send(JSON.stringify({ id: n, method, params, ...(sid ? { sessionId: sid } : {}) })); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const wait = async expression => { for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 50)); } throw Error('Wait failed: ' + expression + '; ' + JSON.stringify(await evaluate('fixtureErrors'))); };
  session = (await send('Target.attachToTarget', { targetId: (await send('Target.createTarget', { url: 'about:blank' }, null)).targetId, flatten: true }, null)).sessionId;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await wait('window.fixtureReady && !!document.querySelector("textarea")');
  for (const theme of ['light', 'dark']) {
    await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.body.dataset.vscodeThemeKind=${JSON.stringify('vscode-' + theme)}`);
    const initial=await evaluate('document.querySelector("textarea").placeholder');
    await evaluate('document.querySelector("textarea").focus()');
    await send('Input.insertText',{text:'입력 확인'});
    await wait('document.querySelector("textarea").value.length>0');
    await evaluate('document.getElementById("clear").click()');
    await wait('document.querySelector("textarea").value===""');
    assert.equal(await evaluate('document.querySelector("textarea").placeholder'),initial);
    await evaluate('setSession("thread-b")');await wait(`document.querySelector("textarea").placeholder===localStorage.getItem('azrael-composer-emoticon-v1:["local","thread-b"]')`);
    await evaluate('setSession("thread-a")');await wait(`document.querySelector("textarea").placeholder===localStorage.getItem('azrael-composer-emoticon-v1:["local","thread-a"]')`);
    assert.equal(await evaluate('document.querySelector("textarea").placeholder'),initial);
    await evaluate(`var box=document.createElement('div');box.className='p-8 text-default';box.innerHTML=faces.map(face=>'<div style="padding:8px;font-size:16px">'+face+'</div>').join('');document.body.append(box)`);
    assert.deepEqual(await evaluate('fixtureErrors'),[]);
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(logs,theme+'.png'),Buffer.from(shot.data,'base64'));
    await evaluate('document.body.lastElementChild.remove()');
    summary.checks.push(theme+': selection stable after input/clear and session revisit; all seven candidates rendered');
  }
  const before=await evaluate('document.querySelector("textarea").placeholder');
  await send('Page.reload');await wait('window.fixtureReady && !!document.querySelector("textarea")');
  assert.equal(await evaluate('document.querySelector("textarea").placeholder'),before);
  summary.checks.push('webview reload retains stored session choice');
  summary.outcome = 'passed';
  const browserExited=new Promise(r=>chrome.once('exit',r));
  await send('Browser.close',{},null);
  await Promise.race([browserExited,new Promise((_,reject)=>setTimeout(()=>reject(Error('Browser close timeout')),20000))]);
} catch (error) { summary.outcome = 'failed'; summary.error = String(error.stack || error); process.exitCode = 1; }
finally {
  socket?.close(); server.close();
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) { chrome.kill(); await new Promise(r => { const timer = setTimeout(r, 10000); chrome.once('exit', () => { clearTimeout(timer); r(); }); }); }
  summary.browserExitCode = chrome?.exitCode; summary.browserSignalCode = chrome?.signalCode;
  if (chrome && (chrome.exitCode !== null || chrome.signalCode !== null)) {
    const cleanupScript = String.raw`$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath($env:AZRAEL_SUBMIT_FIXTURE)
$expectedParent=[IO.Path]::GetFullPath((Join-Path (Get-Location) 'artifacts/verification'))
if (-not $taskRoot.StartsWith($expectedParent+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected cleanup target' }
$preview=& ./scripts/clean-verification-artifacts.ps1 -FixtureRoot $taskRoot -IncludeDiagnosedFixtures -ReportPath $env:AZRAEL_SUBMIT_CLEANUP
if ($preview.status -ne 'preview' -or $preview.candidates.Count -ne 1 -or $preview.candidates[0].status -ne 'selected') { throw 'Cleanup preview refused' }
$live=@(Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -and $_.CommandLine.Replace('/','\').Contains($taskRoot)) -or ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskRoot,[StringComparison]::OrdinalIgnoreCase)) })
if ($live.Count) { throw 'Fixture referenced by live process' }
Remove-Item -LiteralPath $taskRoot -Recurse
if (Test-Path -LiteralPath $taskRoot) { throw 'Fixture survived cleanup' }
`;
    const cleanup = spawn('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], { cwd: root, windowsHide: true, env: { ...process.env, AZRAEL_SUBMIT_FIXTURE: fixture, AZRAEL_SUBMIT_CLEANUP: join(logs, 'cleanup-preview.json') }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; cleanup.stdout.on('data', b => output += b); cleanup.stderr.on('data', b => output += b); cleanup.stdin.end(cleanupScript);
    summary.cleanupExitCode = await new Promise((r, j) => { cleanup.on('error', j); cleanup.on('exit', r); });
    await writeFile(join(logs, 'cleanup.txt'), output);
    if (summary.cleanupExitCode !== 0) process.exitCode = 1;
  } else { summary.cleanup = 'Browser termination not confirmed; fixture retained'; process.exitCode = 1; }
  summary.exitCode = process.exitCode || 0;
  await writeFile(join(logs, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ outcome: summary.outcome, checks: summary.checks, error: summary.error, cleanupExitCode: summary.cleanupExitCode, exitCode: summary.exitCode }));
}
