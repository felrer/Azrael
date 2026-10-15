// Scoped native UI fixture: node scripts/image-sketch-render-fixture.mjs [--run-id ID].
// Exercise the printed loopback URL with the browser skill; Ctrl+C ends the server.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, join, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const runId = process.argv.length === 2 ? new Date().toISOString().replace(/[:.]/g, '-') : process.argv.length === 4 && process.argv[2] === '--run-id' ? process.argv[3] : '';
if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(runId)) throw Error('Invalid --run-id');
const run = join(root, 'artifacts/tasks/BN-01-image-sketch/runs', runId);
const lifecycle = require('./artifact-lifecycle.cjs');
for (const file of [run, lifecycle.registryPath(root, 'run:BN-01-image-sketch:' + runId)]) {
  try { await lstat(file); throw Error('Run identity already exists: ' + runId); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
lifecycle.recordLifecycle(root, { id: 'run:BN-01-image-sketch:' + runId, kind: 'run', owner: 'image-sketch-render-fixture',
  state: 'pending', membership_complete: false, members: [{ path: run, role: 'run' }] });
await mkdir(dirname(run), { recursive: true });
await mkdir(run);
const assets = join(root, 'artifacts/upstream-ui/26.1007.21434/webview/assets');
const { injectImageSketch, COMPOSER_ASSET } = require('./inject-image-sketch.cjs');
const ts = require('../extensions/azrael-ex/node_modules/typescript');
const composer = injectImageSketch(await readFile(join(root, 'artifacts/upstream-ui/26.1007.21434', COMPOSER_ASSET), 'utf8'), COMPOSER_ASSET).text;
const ast = ts.createSourceFile('composer.js', composer, 99, true, 1);
const helpers = ['azraelUseImageSketchBridge', 'azraelRequestImageSketch', 'azraelImageSketchIcon'].map(name => ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === name).getText(ast)).join('\n');
const html = `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style>${['app-initial-aad627bd9dff.css','app-initial-49150e6a0951.css','app-initial-f5b2ced5ef25.css','app-initial-1805ad19110d.css'].map(n=>`<link rel="stylesheet" href="/assets/${n}">`).join('')}</head><body data-vscode-theme-kind="vscode-light"><div id="root"></div><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module" src="/fixture.js"></script></body></html>`;
const adapter = `import {nLt,XAt,Abt,Vbt} from '/assets/app-initial-97d3534ad35f.js';
import {Lv as Lightbox,Rv as initLightbox} from '/assets/app-initial-c014f9ee4429.js';
import {r as initHost,t as Host} from '/assets/composer-host-68250d08cc40.js';
import {createSketchComposerState} from '/assets/composer-state-ce2239a4a82f.js';
const React=nLt(),g5=React;Abt();initLightbox();initHost();
${helpers}
const intl={locale:'en',formatMessage:(m,v)=>m.defaultMessage?.replace(/\\{(\\w+)\\}/g,(_,k)=>v?.[k]??k)??m.id,formatNumber:(n,o)=>new Intl.NumberFormat('en',o).format(n),formatDate:()=>'',formatTime:()=>''};
const canvas=document.createElement('canvas');canvas.width=800;canvas.height=500;const ctx=canvas.getContext('2d');ctx.fillStyle='#d5e7f1';ctx.fillRect(0,0,800,500);ctx.fillStyle='#4a8b66';ctx.fillRect(80,80,260,300);ctx.fillStyle='#e9b86c';ctx.fillRect(420,120,260,260);ctx.fillStyle='#172b3c';ctx.font='28px sans-serif';ctx.fillText('Photo — 800 × 500',235,450);const src=canvas.toDataURL();
const scope={}, scopeRef={composerId:'fixture',canOpenSketch:true,canEditSketch:true,isDarkMode:false};
let notify;const state=createSketchComposerState(()=>scopeRef,{subscribe:cb=>(notify=cb,()=>{}),createFileName:()=> 'annotated.png',track:()=>{},save:async(file,options)=>{const reader=new FileReader();reader.readAsDataURL(file);await new Promise(r=>reader.onload=r);document.querySelector('#result').src=reader.result;document.querySelector('#result').hidden=false;document.querySelector('#status').textContent='Attached '+file.name;options.onQueued('result');notify(['result']);options.onComplete('success');}});
window.fixture={state,scope,src};
function App(){const [open,setOpen]=React.useState(false),[dark,setDark]=React.useState(false);const openRef=React.useRef(false);openRef.current=open;const stateRef=React.useRef({state});
const openSketch=React.useCallback(options=>{const accepted=state.openNew(options);options?.azraelOnOpened?.(accepted);return accepted},[]);
azraelUseImageSketchBridge(scope,openSketch,stateRef,true,'fixture',()=>{document.querySelector('#status').textContent='Image failed to load'});
return React.createElement(Vbt.Provider,{value:intl},React.createElement('main',{className:'p-8 text-default'},React.createElement('h1',null,'Image sketch fixture'),React.createElement('button',{className:'m-2 rounded-lg border p-3',onClick:()=>setOpen(true)},'Preview photo'),React.createElement('button',{className:'m-2 rounded-lg border p-3',onClick:()=>state.openNew()},'New sketch'),React.createElement('button',{className:'m-2 rounded-lg border p-3',onClick:()=>{const next=!dark;scopeRef.isDarkMode=next;document.documentElement.dataset.theme=next?'dark':'light';document.documentElement.classList.toggle('dark',next);document.body.dataset.vscodeThemeKind=next?'vscode-dark':'vscode-light';setDark(next)}},dark?'Light theme':'Dark theme'),React.createElement('p',{id:'status'},'Ready'),React.createElement('img',{id:'result',hidden:true,alt:'Annotated attachment',className:'max-w-lg'}),React.createElement(Lightbox,{src,alt:'Photo',open,onOpenChange:setOpen,toolbarActions:[{ariaLabel:'Sketch on image',icon:azraelImageSketchIcon(React.createElement),onClick:()=>azraelRequestImageSketch(scope,src,()=>openRef.current,()=>setOpen(false))}]}),React.createElement(Host,{state,canOpenSketch:true,canEditSketch:true,isDarkMode:dark})));}
XAt().createRoot(document.getElementById('root')).render(React.createElement(App));`;
await writeFile(join(run, 'fixture.html'), html);
await writeFile(join(run, 'fixture.js'), adapter);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(await readFile(join(run, 'fixture.html'))); return;
    }
    if (url.pathname === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(await readFile(join(run, 'fixture.js'))); return;
    }
    if (url.pathname.startsWith('/assets/')) {
      const file = resolve(assets, decodeURIComponent(url.pathname.slice(8)));
      if (!file.startsWith(assets + sep)) throw Error('Asset outside pinned input');
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream');
      const data = await readFile(file);
      let text = extname(file) === '.js' ? injectImageSketch(data.toString(), 'webview/assets/' + file.slice(assets.length + 1).replaceAll('\\', '/')).text : data;
      // The fixture has no application scope: fix UI scale and reduced motion.
      // Drawing, tools, dialogs, state and export remain native code.
      if (file.endsWith('editor-5445e38990c9.js')) text = text.replaceAll('ie()', '1').replaceAll('c(Te)', '!0');
      if (file.endsWith('composer-host-68250d08cc40.js')) text = text.replaceAll('v()', '1').replaceAll('i(x)', '!0');
      res.end(text); return;
    }
    res.statusCode = 404; res.end();
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const address = `http://127.0.0.1:${server.address().port}`;
await writeFile(join(run, 'server.json'), JSON.stringify({ address, pid: process.pid }));
console.log(address);
process.stdin.resume();
function shutdown() { server.close(() => {
  lifecycle.recordLifecycle(root, { id: 'run:BN-01-image-sketch:' + runId, kind: 'run', owner: 'image-sketch-render-fixture',
    state: 'complete', membership_complete: true, members: [{ path: run, role: 'run' }] });
  process.exit(0);
}); }
process.stdin.on('data', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
