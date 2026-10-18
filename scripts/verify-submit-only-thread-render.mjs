import artifactRunTools from './artifact-run.cjs';
const {beginArtifactRun,trackArtifactChild}=artifactRunTools;
import { createRequire } from 'node:module';
import {spawn as nativeSpawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRun=beginArtifactRun(root,{workId:'verify-submit-only-thread-render',owner:'scripts/verify-submit-only-thread-render.mjs',paths:{...(process.env.AZRAEL_RENDER_FIXTURE_ROOT ? {temporary:resolve(process.env.AZRAEL_RENDER_FIXTURE_ROOT)} : {}),...(process.env.AZRAEL_RENDER_LOG_ROOT ? {logs:resolve(process.env.AZRAEL_RENDER_LOG_ROOT)} : {})}});
const spawn=(...args)=>trackArtifactChild(artifactRun,nativeSpawn(...args));
const confirmOwnedBrowserExit=(child,profilePath)=>artifactRunTools.confirmOwnedBrowserExit(child,profilePath,spawn);
const fixture = artifactRun.temporary;
const logs = artifactRun.logs;
const profile = join(fixture, 'chrome-profile');
const assets = join(root, 'artifacts/upstream-ui/26.1007.21434/webview/assets');
const require = createRequire(import.meta.url);
const ts = require('../extensions/azrael-ex/node_modules/typescript');
const { ASSET, PATCHED, injectSubmitOnlyThread } = require('./inject-submit-only-thread.cjs');
const native = injectSubmitOnlyThread(await readFile(join(root, 'artifacts/upstream-ui/26.1007.21434', ASSET), 'utf8'), ASSET).text;
const composer = await readFile(join(assets, 'app-initial-7a199c66e670.js'), 'utf8');
const ast = ts.createSourceFile('composer.js', composer, 99, true, 1);
const hook = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'QNa')?.getText(ast);
assert(hook, 'pinned composer prewarm hook');
// Execute QNa with native React/compiler and the transformed creation boundary.
// Only host/config/reservation services and this test input surface are adapters.
const adapter = `import {nLt,tLt,XAt} from '/assets/app-initial-97d3534ad35f.js';
const nPa=nLt(),ePa=tLt(),events=[],scope={watch:fn=>{fn({get:()=>({authLoading:false,restorationPending:false})});return()=>{}}};
const manager=new class {${PATCHED}};
const $={},rPa={},by='cloud',fPe={},Ou=()=>scope,pwa=()=>false,vk=()=>({authMethod:'apiKey'}),Hu=()=>({data:{},isPending:false}),Q2e=()=>({draftSettings:{isManuallyChanged:false}}),Jm=fn=>fn,hh=()=>false;
const reader=()=>{throw Error('Prewarm must not read session inputs')};reader[Symbol.dispose]=()=>events.push('release');
const $X=()=>({readPrewarmInputs:reader}),Px=()=>({prewarmConversation:args=>manager.prewarmConversation(args,reader),prewarmCloudConversation:args=>manager.prewarmConversation(args,reader)}),$Na=error=>window.fixtureErrors.push(String(error));
${hook}
const reservation={clear(){},schedule:fn=>fn()},block=()=>null;
function Fixture(){const [text,setText]=nPa.useState(''),[cloud,setCloud]=nPa.useState(false),controller=nPa.useMemo(()=>({getPersistedText:()=>text}),[text]);
QNa({activeCollaborationMode:{mode:'default'},agentMode:'default',cloudThreadPrototypeSelected:cloud,composerController:controller,composerMode:'local',currentLocalExecutionCwd:'project-a',currentLocalExecutionHostId:'local',currentRemoteCwd:null,hasFollowUp:false,hasText:text.length>0,isLocalModeOnRemoteHost:false,getExecutionBlockReason:block,localThreadPrewarmReservation:reservation,permissionSelection:null,projectId:'project-a',serviceName:null,serviceTier:null,shouldUseAppServerPermissionDefault:false,submitDisabled:false,workspaceRootsForLocalExecution:['project-a']});
return nPa.createElement('main',{className:'mx-auto flex w-full max-w-xl flex-col gap-4 p-8 text-default'},nPa.createElement('h1',{className:'text-xl font-semibold'},'Draft editing'),nPa.createElement('textarea',{'aria-label':'Draft',className:'min-h-24 rounded-xl border border-token-border-default bg-token-bg-primary p-4 text-default',value:text,onChange:e=>setText(e.target.value)}),nPa.createElement('button',{id:'clear',onClick:()=>setText(''),className:'rounded-lg border p-2'},'Clear'),nPa.createElement('button',{id:'cloud',onClick:()=>setCloud(!cloud),className:'rounded-lg border p-2'},cloud?'Cloud prototype':'Local'),nPa.createElement('output',{id:'status'},'Sessions created: 0'));}
window.events=events;window.reactRoot=XAt().createRoot(document.getElementById('root'));window.reactRoot.render(nPa.createElement(Fixture));window.fixtureReady=true;`;
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
const summary = { scope: 'Pinned QNa composer effect, native React/compiler/CSS and transformed thread-creation prewarm method. Synthetic host/config services and test input surface; no installed VS Code, real sessions or model calls.', inputSha256: createHash('sha256').update(native).update(hook).digest('hex'), checks: [] };
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
    for (const cloud of [false, true]) {
      if (cloud) await evaluate('document.getElementById("cloud").click()');
      const before = await evaluate('events.length');
      await evaluate('document.querySelector("textarea").focus()');
      await send('Input.insertText', { text: '입력했다가 지우는 초안' });
      await wait('document.querySelector("textarea").value.length>0 && events.length>' + before);
      await evaluate('document.getElementById("clear").click()');
      await wait('document.querySelector("textarea").value===""');
      assert.deepEqual(await evaluate('fixtureErrors'), [], 'no runtime errors');
      summary.checks.push(`${theme} ${cloud ? 'cloud-prototype' : 'local'}: input effect reaches submit-only boundary, unused reader released, clear succeeds`);
      if (cloud) await evaluate('document.getElementById("cloud").click()');
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(logs, theme + '.png'), Buffer.from(shot.data, 'base64'));
  }
  summary.outcome = 'passed';
} catch (error) { summary.outcome = 'failed'; summary.error = String(error.stack || error); process.exitCode = 1; }
finally {
  socket?.close(); server.close();
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) { chrome.kill(); await new Promise(r => { const timer = setTimeout(r, 10000); chrome.once('exit', () => { clearTimeout(timer); r(); }); }); }

  summary.browserExit=await confirmOwnedBrowserExit(chrome,profile);
  artifactRun.producerStopped=summary.browserExit.confirmed;
  summary.runRoot=artifactRun.runRoot;summary.lifecycleId=artifactRun.lifecycleId;
  summary.fixtureRemoved=false;summary.retentionReason='Retained fixture, profile and raw results for lifecycle review';
  if(!summary.browserExit.confirmed)process.exitCode=1;
  summary.exitCode=process.exitCode||0;
  await writeFile(join(logs, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ outcome: summary.outcome, checks: summary.checks, error: summary.error, cleanupExitCode: summary.cleanupExitCode, exitCode: summary.exitCode }));
}
