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
// Extract product declarations rather than maintaining a second composer/bridge.
function declaration(source, name) {
  const tree = typeof source === 'string' ? ts.createSourceFile('native.js', source, 99, true, 1) : source;
  const node = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!node) throw Error('Missing native fixture declaration: ' + name);
  return node.getText(tree);
}
const shared = await readFile(join(assets, 'app-initial-97d3534ad35f.js'), 'utf8');
const common = await readFile(join(assets, 'app-initial-c014f9ee4429.js'), 'utf8');
const helpers = ['azraelUseImageSketchBridge', 'azraelRequestImageSketch', 'azraelImageSketchIcon'].map(name => declaration(ast, name)).join('\n');
const nativeComposer = declaration(ast, 'cda');
const nativeScope = declaration(shared, 'BRt');
const nativeStableCallback = declaration(common, 'Nv');
// Fail closed if the fixture would silently lose the actual lazy/state boundary.
for (const anchor of ['UPe()', 'e.createSketchComposerState', 'Host:e.SketchComposerHost', 'azraelUseImageSketchBridge(l,w,m,a,r)']) {
  if (!nativeComposer.includes(anchor)) throw Error('Native composer fixture contract changed: ' + anchor);
}
const html = `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style>${['app-initial-aad627bd9dff.css','app-initial-49150e6a0951.css','app-initial-f5b2ced5ef25.css','app-initial-1805ad19110d.css'].map(n=>`<link rel="stylesheet" href="/assets/${n}">`).join('')}</head><body data-vscode-theme-kind="vscode-light"><div id="root"></div><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module" src="/fixture.js"></script></body></html>`;
const adapter = `import {nLt,XAt,Abt,Vbt,tLt as nativeMemo} from '/assets/app-initial-97d3534ad35f.js';
import {Lv as Lightbox,Rv as initLightbox,Hf as UPe} from '/assets/app-initial-c014f9ee4429.js';
const React=nLt(),g5=React,VRt=React,iit=React,fda=nativeMemo(),rit=fda;
Abt();initLightbox();
// Native compiler output and callback implementation; only the app's event
// instrumentation guard is absent in this isolated React root.
const Qrt=()=>false;
${nativeStableCallback}
const Jm=Nv,pda={jsx:(type,props)=>{if(props.state)window.fixture.state=props.state;return React.createElement(type,props)}};
const intl={locale:'en',formatMessage:(m,v)=>m.defaultMessage?.replace(/\\{(\\w+)\\}/g,(_,k)=>v?.[k]??k)??m.id,formatNumber:(n,o)=>new Intl.NumberFormat('en',o).format(n),formatDate:()=>'',formatTime:()=>''};
const Theme=React.createContext(false),ScopeContext=React.createContext(null),Dh={name:'fixture-composer'},hx={name:'toast'};
const node={id:'thread-a/host-a'},otherNode={id:'thread-b/host-a'};
const chain={node,value:{thread:'a',host:'a'}};
// Bounded application scope environment for the unmodified native BRt hook.
// BRt itself creates distinct component-local wrappers with one descriptor/node.
const oq=()=>ScopeContext,OK=(chain)=>chain.node,YIt=(node)=>node===otherNode?{thread:'b',host:'a'}:chain.value,GIt=()=>({});
const xK=()=>true,CK=()=>({get:()=>toastService});
${nativeScope}
const Ou=(descriptor)=>{const scope=BRt(descriptor);window.fixture.receiverScope=scope;return scope};
const st=()=>intl,U_=()=>React.useContext(Theme),lda=()=>true;
function toast(kind,message){const el=document.getElementById('status');el.dataset.kind=kind;el.textContent=message;let closed=false;return{close(){if(!closed&&el.textContent===message)el.textContent='Ready';closed=true}}}
const toastService={info:message=>toast('info',message),danger:message=>toast('danger',message)};
// App toast service is an explicit visible fixture sink; request/bridge logic is product code.
const azraelImageSketchToasts=()=>toastService;
${helpers}
${nativeComposer}
const canvas=document.createElement('canvas');canvas.width=800;canvas.height=500;const ctx=canvas.getContext('2d');ctx.fillStyle='#d5e7f1';ctx.fillRect(0,0,800,500);ctx.fillStyle='#4a8b66';ctx.fillRect(80,80,260,300);ctx.fillStyle='#e9b86c';ctx.fillRect(420,120,260,260);ctx.fillStyle='#172b3c';ctx.font='28px sans-serif';ctx.fillText('Photo — 800 × 500',235,450);const src=canvas.toDataURL();
window.fixture={src,results:[],saveHistory:[],boundaries:{composer:'native transformed cda',lazyLoader:'native UPe',scopeHook:'native BRt with fixture context resolution',state:'native createSketchComposerState',host:'native SketchComposerHost',lightbox:'native Lightbox',mocked:['scope context resolution','locale/theme','event instrumentation guard','toast sink','attachment repository']}};
let repository={items:[{id:'source-photo',name:'photo.png',type:'image/png',src},{id:'unrelated-file',name:'notes.txt',type:'text/plain'}],selected:{src,uploadId:'source-photo'},lastReplaceUploadId:null,saveCount:0};
const repositoryListeners=new Set(),attachmentListeners=new Set();
function publishRepository(next){repository=next;attachmentListeners.forEach(cb=>cb(repository.items.map(item=>item.id)));repositoryListeners.forEach(cb=>cb())}
const subscribeRepository=cb=>(repositoryListeners.add(cb),()=>repositoryListeners.delete(cb)),getRepository=()=>repository;
function nativeSnapshot(){const active=window.fixture.state?.getSnapshot().active;return active?{id:active.id,uploadId:active.uploadId,background:active.azraelBackground?{src:active.azraelBackground.src,width:active.azraelBackground.width,height:active.azraelBackground.height}:null,document:active.editor.getSnapshot().document,savedDocument:active.savedDocument}:null}
window.fixture.nativeSnapshot=nativeSnapshot;
Object.defineProperties(window.fixture,{repository:{get:()=>repository},attachmentEvidence:{get:()=>({count:repository.items.length,ids:repository.items.map(item=>item.id),replacedId:repository.lastReplaceUploadId,selectedUploadId:repository.selected.uploadId,saveCount:repository.saveCount})}});
window.fixture.removeSelectedAttachment=()=>publishRepository({...repository,items:repository.items.filter(item=>item.id!==repository.selected.uploadId)});
const attachments={subscribe:cb=>{attachmentListeners.add(cb);cb(repository.items.map(item=>item.id));return()=>attachmentListeners.delete(cb)},createFileName:()=> 'annotated.png',track:event=>{window.fixture.lastNativeTrack=event},save:async(file,options)=>{
 const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)});
 if(options.signal.aborted||!options.isAvailable())throw Error('Attachment save is no longer available');
 const replaceId=options.replaceUploadId,index=replaceId==null?-1:repository.items.findIndex(item=>item.id===replaceId);
 if(replaceId!=null&&index<0){window.fixture.rejectedSave={replaceUploadId:replaceId,reason:'target missing',ids:repository.items.map(item=>item.id)};throw Error('Replacement attachment no longer exists')}
 const uploadId=replaceId??'result-'+(repository.saveCount+1),item={id:uploadId,name:file.name,type:file.type,src:data},items=repository.items.slice();
 if(replaceId!=null)items[index]=item;else items.push(item);
 const saved={name:file.name,type:file.type,size:file.size,data,uploadId,replaceUploadId:replaceId??null,nativeSnapshot:nativeSnapshot()};
 window.fixture.saved=saved;window.fixture.saveHistory.push(saved);
 // Native state owns queue/completion and editable documents. This sink only
 // emulates the ordered host attachment repository, including target loss.
 publishRepository({items,selected:{src:data,uploadId},lastReplaceUploadId:replaceId??null,saveCount:repository.saveCount+1});
 document.querySelector('#status').textContent=(replaceId==null?'Attached ':'Replaced ')+file.name;
 options.onQueued(uploadId);options.onComplete('success');
}};
function Preview({composerRef,canOpen,setCanOpen,sourceMode,photoContext,selected}){
 const scope=BRt(Dh);window.fixture.requesterScope=scope;
 const [open,setOpen]=React.useState(false);const current=React.useRef({open:false,generation:0});current.current.open=open;
 React.useEffect(()=>()=>{current.current.open=false;current.current.generation++},[]);
 function request(wrongScope=false){const generation=current.current.generation;const requestScope=wrongScope?{node:otherNode,scope:scope.scope}:scope;
 const imageSource=sourceMode==='invalid'?'/invalid-image.png':sourceMode==='slow'?'/slow-image.svg?nonce='+Date.now():selected.src;
 return azraelRequestImageSketch(requestScope,imageSource,()=>current.current.open&&current.current.generation===generation,()=>setOpen(false),intl.locale,photoContext==='draft'?selected.uploadId:undefined).then(status=>{window.fixture.results.push(status);document.querySelector('#terminal').textContent=status;return status});}
 window.fixture.request=request;window.fixture.cancel=()=>{current.current.generation++;setOpen(false)};
 window.fixture.identity={sameWrapper:scope===window.fixture.receiverScope,sameNode:scope.node===window.fixture.receiverScope?.node,sameDescriptor:scope.scope===window.fixture.receiverScope?.scope};
 return React.createElement(React.Fragment,null,
 React.createElement('button',{className:'m-2 rounded-lg border p-3',onClick:()=>{current.current.generation++;setOpen(true)}},'Preview photo'),
 React.createElement('button',{className:'m-2 rounded-lg border p-3',onClick:()=>composerRef.current?.openNew()},'New sketch'),
 React.createElement(Lightbox,{src:selected.src,alt:'Photo',open,onOpenChange:value=>{current.current.generation++;setOpen(value)},toolbarActions:[
 {ariaLabel:'Sketch on image',icon:azraelImageSketchIcon(React.createElement),onClick:()=>request()},
 {ariaLabel:'Request other scope',icon:React.createElement('span',null,'Other scope'),onClick:()=>request(true)},
 {ariaLabel:'Request while sketch busy',icon:React.createElement('span',null,'Busy'),onClick:async()=>{if(!composerRef.current?.openNew())return;for(let attempt=0;attempt<100;attempt++){if(composerRef.current?.isOpen()){await request();return}await new Promise(done=>setTimeout(done,50))}throw Error('Native composer did not open for busy fixture')}},
 {ariaLabel:'Cancel image load',icon:React.createElement('span',null,'Cancel load'),onClick:()=>{current.current.generation++;document.querySelector('#terminal').textContent='cancellation requested'}},
 {ariaLabel:'Disable composer during load',icon:React.createElement('span',null,'Disable'),onClick:()=>setCanOpen(false)}
 ]}));
}
function App(){const [dark,setDark]=React.useState(false),[canOpen,setCanOpen]=React.useState(true),[sourceMode,setSourceMode]=React.useState('valid'),[photoContext,setPhotoContext]=React.useState('draft');const repositoryView=React.useSyncExternalStore(subscribeRepository,getRepository,getRepository);const composerRef=React.useRef(null);
 window.fixture.composerRef=composerRef;
 return React.createElement(Vbt.Provider,{value:intl},React.createElement(Theme.Provider,{value:dark},React.createElement(ScopeContext.Provider,{value:chain},React.createElement('main',{className:'p-8 text-default'},
 React.createElement('h1',null,'Native composer image sketch fixture'),
 React.createElement('p',null,'Native cda → lazy loader → state → Host. Separate native scope wrappers share a thread and host.'),
 React.createElement(cda,{ref:composerRef,composerId:'thread-a/host-a',canOpenSketch:canOpen,canEditSketch:true,attachments}),
 React.createElement(Preview,{composerRef,canOpen,setCanOpen,sourceMode,photoContext,selected:repositoryView.selected}),
 React.createElement('button',{className:'m-2 rounded-lg border p-3',onClick:()=>setCanOpen(!canOpen)},canOpen?'Disable composer':'Enable composer'),
 React.createElement('button',{className:'m-2 rounded-lg border p-3',onClick:()=>{const next=!dark;document.documentElement.dataset.theme=next?'dark':'light';document.documentElement.classList.toggle('dark',next);document.body.dataset.vscodeThemeKind=next?'vscode-dark':'vscode-light';setDark(next)}},dark?'Light theme':'Dark theme'),
 React.createElement('label',null,'Image source ',React.createElement('select',{value:sourceMode,onChange:e=>setSourceMode(e.target.value),className:'rounded-lg border p-3'},['valid','invalid','slow'].map(value=>React.createElement('option',{key:value,value},value)))),
 React.createElement('label',null,'Photo context ',React.createElement('select',{value:photoContext,onChange:e=>setPhotoContext(e.target.value),className:'rounded-lg border p-3'},React.createElement('option',{value:'draft'},'Composer attachment (replace)'),React.createElement('option',{value:'sent'},'Sent photo (append)'))),
 React.createElement('p',{id:'attachment-evidence'},'Attachments: '+repositoryView.items.length+' | IDs: '+repositoryView.items.map(item=>item.id).join(', ')+' | Replaced: '+(repositoryView.lastReplaceUploadId??'none')),
 React.createElement('ul',{id:'attachment-list'},repositoryView.items.map(item=>React.createElement('li',{key:item.id,'data-upload-id':item.id},item.id+' - '+item.name))),
 React.createElement('button',{className:'m-2 rounded-lg border p-3',onClick:window.fixture.removeSelectedAttachment},'Remove selected attachment'),
 React.createElement('p',{id:'status',role:'status',className:'fixed bottom-6 right-6 z-[1000] max-w-md rounded-lg border bg-token-main-surface-primary p-3 shadow-lg'},'Ready'),React.createElement('p',null,'Terminal result: ',React.createElement('output',{id:'terminal'},'none')),
 React.createElement('img',{id:'result',src:repositoryView.selected.src,hidden:repositoryView.saveCount===0,alt:'Annotated attachment',className:'max-w-lg'})
 ))));}
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
    if (url.pathname === '/slow-image.svg') {
      await new Promise(done => setTimeout(done, 2500));
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'no-store');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#d5e7f1"/></svg>'); return;
    }
    if (url.pathname === '/invalid-image.png') {
      res.setHeader('Content-Type', 'image/png');res.end('invalid image fixture');return;
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
