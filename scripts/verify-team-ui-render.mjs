import artifactRunTools from './artifact-run.cjs';
const {beginArtifactRun,trackArtifactChild}=artifactRunTools;
import {createRequire} from 'node:module';
import {spawn as nativeSpawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const artifactRun=beginArtifactRun(root,{workId:'verify-team-ui-render',owner:'scripts/verify-team-ui-render.mjs',paths:{...(process.env.AZRAEL_RENDER_FIXTURE_ROOT ? {temporary:resolve(root,process.env.AZRAEL_RENDER_FIXTURE_ROOT)} : {}),...(process.env.AZRAEL_RENDER_LOG_ROOT ? {logs:resolve(root,process.env.AZRAEL_RENDER_LOG_ROOT)} : {})}});
const spawn=(...args)=>trackArtifactChild(artifactRun,nativeSpawn(...args));
const confirmOwnedBrowserExit=(child,profilePath)=>artifactRunTools.confirmOwnedBrowserExit(child,profilePath,spawn);
const containedPath=(value,parent,label)=>{const target=resolve(root,value),allowed=resolve(root,parent)+sep;assert.ok(target.toLowerCase().startsWith(allowed.toLowerCase()),label+' must be a descendant of '+parent);return target};
const fixture=artifactRun.temporary;
const logs=artifactRun.logs,profile=join(fixture,'chrome-profile');
const assets=join(root,'artifacts/upstream-ui/26.1007.21434/webview/assets');
const require=createRequire(import.meta.url),ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
const {ASSET,injectSessionFlags}=require('./inject-session-flags.cjs');
const {HELPER,injectTeamUI}=require('./inject-team-ui.cjs');
const {injectDeferredPresentation,injectDeferredHeader}=require('./inject-deferred-turn.cjs');
const headerName=ASSET.split('/').at(-1),rowsName='app-initial-c014f9ee4429.js';
const original=await readFile(join(assets,headerName),'utf8'),header=injectTeamUI(injectSessionFlags(injectDeferredHeader(original).text,ASSET).text,ASSET).text;
assert.equal(header.split('(0,Z.jsx)(azraelFlaggedSessionRow,{').length-1,2);
assert.equal(injectTeamUI(header,ASSET).text,header);
const rows=injectDeferredPresentation(await readFile(join(assets,rowsName),'utf8')).text,file=ts.createSourceFile('rows.js',rows,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const owner=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Gjr');assert(owner);
// Adapt only external host state, navigation and archive services. Keep Gjr's
// render body, native rQ/Bkr markup, archive confirmation, and production helper.
const adapters=new Set(['ta','K','le','J','VC','Ajr','Gqn','s2n','n2n','cIe','M4t','j4t','Rjr']);
let render=owner.getText(file),edits=[];
function visit(n){if(ts.isIdentifier(n)&&adapters.has(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(file)-owner.getStart(file),end:n.end-owner.getStart(file),text:'fixture_'+n.text});ts.forEachChild(n,visit)}visit(owner);
for(const e of edits.sort((a,b)=>b.start-a.start))render=render.slice(0,e.start)+e.text+render.slice(e.end);
render=render.replace('function Gjr(','function fixtureGjr(');
const newChatOwner=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='lir');assert(newChatOwner);
const newChatRender=newChatOwner.getText(file).replace('function lir(','function fixtureNewChat(').replace(/\bwB\b/g,'fixtureNewChatAction').replace(/\ble\b/g,'fixture_le').replace(/\bJ\b/g,'fixtureNewChatState');
const rowAdapter=`
const fixture_ta=()=>({get:()=>false}),fixture_K=()=>false,fixture_le=()=>({formatMessage:({defaultMessage})=>defaultMessage}),fixture_VC=()=>null,fixture_Ajr=()=>null,fixture_Gqn=()=>false;
const fixture_J=(atom,key)=>atom===oDr?(window.fixtureTitles?.[key?.threadId]??(key?.threadId==='unflagged'?'Unflagged chat':'Review session changes')):atom===Yj?'idle':atom===Ap?{summary:{hasUnreadTurn:false},isRootResumePending:window.fixturePending}:atom===qj?{roomId:null,hasUnread:false}:atom===rc?{data:null}:null;
const fixture_Rjr=()=> 'local';
const fixture_n2n=()=>()=>{},fixture_M4t=()=>{},fixture_j4t=()=>null;
const fixture_cIe=(_store,id,host)=>{window.fixtureEvents.push({type:'navigate',id,host});return true};
const fixture_s2n=async(_store,{conversationId,hostId})=>{window.fixtureEvents.push({type:'archive',conversationId,hostId})};
${render}
const fixtureNewChatAction=()=>()=>window.fixtureEvents.push({type:"new-chat"}),fixtureNewChatState=()=>null;
${newChatRender}
export {fixtureNewChat,fir as fixtureInitNewChat,fixtureGjr,Yjr as fixtureInitRow,a3e as fixtureInitPreferences};
`;
// Render the native recent-chat trigger; adapt its host/query hooks only.
const headerTree=ts.createSourceFile('header.js',header,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const triggerOwner=headerTree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='On');assert(triggerOwner);
let trigger=triggerOwner.getText(headerTree),triggerEdits=[];
const triggerAdapters=new Set(['i','se','p','l','z','mt','Ve','te','un','nt','le','vn']);
function visitTrigger(n){if(ts.isIdentifier(n)&&triggerAdapters.has(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))triggerEdits.push({start:n.getStart(headerTree)-triggerOwner.getStart(headerTree),end:n.end-triggerOwner.getStart(headerTree),text:'fixture_header_'+n.text});ts.forEachChild(n,visitTrigger)}visitTrigger(triggerOwner);
for(const e of triggerEdits.sort((a,b)=>b.start-a.start))trigger=trigger.slice(0,e.start)+e.text+trigger.slice(e.end);
trigger=trigger.replace('function On(','function FixtureTrigger(');
function adaptHeaderFunction(name,adapters){
 const owner=headerTree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(owner);
 let source=owner.getText(headerTree),edits=[];
 function visit(n){if(ts.isIdentifier(n)&&adapters.has(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(headerTree)-owner.getStart(headerTree),end:n.end-owner.getStart(headerTree),text:'fixture_menu_'+n.text});ts.forEachChild(n,visit)}visit(owner);
 for(const e of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,e.start)+e.text+source.slice(e.end);
 return source.replace('function '+name+'(','function Fixture_'+name+'(');
}
const menuRender=adaptHeaderFunction('vn',new Set(['st','se','y','ce','mt','un','fn','qt']));
const feedRender=adaptHeaderFunction('fn',new Set(['ft','l','m','mt','pn']));
const mergeRender=adaptHeaderFunction('pn',new Set(['un']));
const previewRender=adaptHeaderFunction('Et',new Set(['st','p','Je']));
const headerAdapter=`
import {fixtureNewChat,fixtureInitNewChat,fixtureGjr,fixtureInitRow,fixtureInitPreferences} from './${rowsName}';
import {Clt as FixtureScope,Hbt as FixtureIntlContext,fixtureInitScope} from './app-initial-97d3534ad35f.js';
const FixtureReact=v();window.fixtureEvents=[];window.fixtureHost='local';window.fixtureOpen=true;
window.fixturePending=false;
window.fixtureMenu=false;window.fixturePreview=false;window.fixtureTeams=false;window.fixtureLead=false;window.fixtureLeadFailure=false;window.fixtureCancelFailure=false;globalThis.__azraelBeginTeamLeadDraft=async()=>{window.fixtureEvents.push({type:"begin-lead"});if(window.fixtureLeadFailure)throw Error("fixture failure")};globalThis.__azraelCancelTeamLeadDraft=async()=>{window.fixtureEvents.push({type:"cancel-lead"});if(window.fixtureCancelFailure)throw Error("fixture cancellation failure")};window.fixtureCurrentId=null;
const fixtureConversations=[{id:'same-id',hostId:'local',title:'Review session changes',createdAt:Date.now(),updatedAt:Date.now(),turns:[]},{id:'unflagged',hostId:'local',title:'Unflagged chat',createdAt:Date.now(),updatedAt:Date.now(),turns:[]}];
const fixtureMenuConversations=[...fixtureConversations,{id:'standalone',hostId:'local',title:'Independent session',createdAt:Date.now()-10000,updatedAt:Date.now()-10000,turns:[]}];
window.fixtureTitles={'same-id':'Review session changes',unflagged:'Unflagged chat',standalone:'Independent session'};
const fixtureMerged=fixtureConversations.map(conversation=>({kind:'local',key:conversation.id,conversation}));
const fixture_menu_st=()=>()=>{},fixture_menu_se=()=>({authMethod:'chatgpt'}),fixture_menu_y=()=>window.fixtureCurrentId?{params:{conversationId:window.fixtureCurrentId}}:null,fixture_menu_ce=()=>({data:[]}),fixture_menu_mt=()=>false,fixture_menu_un=({conversation})=>conversation.id!=="unflagged",fixture_menu_fn=(...args)=>Fixture_fn(...args),fixture_menu_ft=()=>[],fixture_menu_l=()=>[],fixture_menu_m=()=>new Map(),fixture_menu_pn=(...args)=>Fixture_pn(...args),fixture_menu_p=()=>({pathname:'/new'}),fixture_menu_Je=()=>({cancelPendingWorktree(){}}),fixture_menu_qt=()=>null;
${feedRender}
${mergeRender}
${menuRender}
${previewRender}
const fixture_header_i=()=>({formatMessage:({defaultMessage},values)=>values?'Count: '+values.count:defaultMessage}),fixture_header_se=()=>({authMethod:'chatgpt'}),fixture_header_p=()=>({pathname:'/local/session'}),fixture_header_l=()=>false,fixture_header_z=()=>({data:[{id:'same-id',turns:window.fixturePending?[{status:'deferred',rootResumeWait:{state:'waiting'}}]:[],resumeState:'ready'}]}),fixture_header_mt=()=>false,fixture_header_Ve=f=>f,fixture_header_te=()=>({data:[]}),fixture_header_un=()=>true,fixture_header_nt=()=>false,fixture_header_le=props=>props.triggerButton,fixture_header_vn=()=>null;
${trigger}
function FixtureMenuControls(){const store=f(Re);window.fixtureMenuPrefs=(type,flagOnly)=>{store.set(Pt,type);store.set(azraelSessionFlagOnlyAtom,flagOnly);window.fixtureCurrentId=null};return null}
function FixtureTeam(){azraelInitTeamUI();const store=f(Re);(0,FixtureReact.useEffect)(()=>{store.set(azraelTeamsAtom,{version:1,teams:[{id:"fixture-team",hostId:"local",leadId:"same-id",memberIds:["same-id","unflagged"]}]})},[]);return Z.jsx(azraelTeamList,{items:fixtureConversations,conversations:fixtureConversations,renderRow:conversation=>Z.jsx(azraelFlaggedSessionRow,{conversationId:conversation.id,hostId:conversation.hostId,threadSummary:conversation,disableHoverCard:true,disableEnvTooltip:true},conversation.id)})}
function FixtureRows(){const[,update]=FixtureReact.useState(0);window.fixtureRerender=()=>update(n=>n+1);return Z.jsxs('div',{children:[Z.jsx(FixtureMenuControls,{}),window.fixtureLead?Z.jsx(azraelNewLeadButton,{}):null,window.fixtureTeams?Z.jsx('div',{'data-fixture-teams':true,children:Z.jsx(FixtureTeam,{})}):null,Z.jsx('div',{'data-fixture-trigger':true,children:Z.jsx(FixtureTrigger,{})}),window.fixtureOpen?Z.jsx('div',{'data-fixture-row':true,children:(0,Z.jsx)(azraelFlaggedSessionRow,{conversationId:'same-id',hostId:window.fixtureHost,threadSummary:{id:'same-id',title:'Review session changes',hostId:window.fixtureHost},disableHoverCard:true,disableEnvTooltip:true,useStableTrailingRail:true,metaContent:(0,Z.jsx)('span',{'data-fixture-time':true,children:'12m'}),onArchiveSuccess:()=>window.fixtureEvents.push({type:'archive-success'})})}):null,window.fixtureMenu?Z.jsx('div',{'data-fixture-menu':true,children:Z.jsx(Fixture_vn,{localConversations:fixtureMenuConversations,cloudtasksQuery:{data:[],isLoading:false,isError:false},onClose:()=>window.fixtureEvents.push({type:'close'})})}):null,window.fixturePreview?Z.jsx('div',{'data-fixture-preview':true,children:Z.jsx(Fixture_Et,{mergedTasks:fixtureMerged,tasksQuery:{isLoading:false,isError:false}})}):null]})}
let fixtureInitialized=false;
function Fixture(){Pn();Dn();Nt();fixtureInitRow();fixtureInitNewChat();fixtureInitScope();if(!fixtureInitialized){fixtureInitialized=true;fixtureInitPreferences(JSON.parse(localStorage.getItem("fixture-preferences")||"{}"),(key,value)=>{const prefs=JSON.parse(localStorage.getItem("fixture-preferences")||"{}");if(value===undefined)delete prefs[key];else prefs[key]=value;localStorage.setItem("fixture-preferences",JSON.stringify(prefs));window.fixtureEvents.push({type:"persist",key,value})})}return Z.jsx(FixtureScope,{scope:Re,children:Z.jsx(FixtureIntlContext,{value:{locale:"en",formatMessage:({defaultMessage})=>defaultMessage},children:Z.jsx(FixtureRows,{})})})}
export {Fixture};
`;
// Helper is copied verbatim by injectSessionFlags. Only the native imported row
// host hooks and localization context are adapted for this isolated fixture.
const servedHeader=header.replace('e4t as Ke,eL as qe','e4t as Ke,eL as originalQe').replace('Bbt as i,','Bbt as originalIntl,').replace('OJ as ke,','OJ as originalKe,').replace('out as st,','out as originalSt,')+'\nconst ke=fixtureNewChat,st=()=>()=>window.fixtureEvents.push({type:"new-chat"}),qe=fixtureGjr,i=()=>({formatMessage:({defaultMessage})=>defaultMessage});\n'+headerAdapter;
assert(servedHeader.includes(HELPER));
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const html=`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"></head><body data-vscode-theme-kind="vscode-light"><main class="mx-auto flex w-full max-w-xl flex-col p-8"><h1 class="mb-4 text-xl font-semibold text-default">Recent chats</h1><div id="root" class="[--task-row-trailing-inset:calc(var(--spacing)*1.5)]"></div></main><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import {$At,XAt} from '/assets/app-initial-97d3534ad35f.js';import {Fixture} from '/assets/${headerName}';window.reactRoot=XAt().createRoot(document.getElementById('root'));reactRoot.render($At().jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=pathname===join(assets,headerName)?servedHeader:pathname===join(assets,rowsName)?rows+rowAdapter:await readFile(pathname);if(pathname===join(assets,'app-initial-97d3534ad35f.js'))source=source.toString()+'\nexport {kRt as fixtureInitScope};';res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}res.statusCode=404;res.end()}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Production Team UI with pinned React, CSS, native Gjr rows, lir new-chat, menu, persisted preference atom. Fixture-only transport/host/localization; Windows Chrome. No installed VS Code acceptance.',inputSha256:createHash('sha256').update(header).update(rows).digest('hex'),checks:[]},pending=new Map(),exceptions=[];
try{
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((r,j)=>{let s='';const t=setTimeout(()=>j(Error('Chrome startup timeout')),20000);chrome.stderr.on('data',c=>{s+=c;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);r(m[1])}});chrome.on('error',j)});
 socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')exceptions.push(m.params.args);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.j(Error(JSON.stringify(m.error))):p.r(m.result)}}});
 const send=(method,params={},sid=session)=>new Promise((r,j)=>{const n=++id,t=setTimeout(()=>j(Error('CDP timeout '+method)),20000);pending.set(n,{r,j,t});socket.send(JSON.stringify({id:n,method,params,...(sid?{sessionId:sid}:{})}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Wait failed: '+expression+'; '+JSON.stringify(await evaluate('({errors:fixtureErrors,events:fixtureEvents,body:document.body.innerText})')))};
 const check=(name,value)=>{assert.ok(value,name);summary.checks.push(name)};
 session=(await send('Target.attachToTarget',{targetId:(await send('Target.createTarget',{url:'about:blank'},null)).targetId,flatten:true},null)).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 await wait("window.fixtureReady && !!document.querySelector('[data-azrael-session-flag]')");

 const flag='[data-azrael-session-flag]';
 const point=selector=>evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
 const mouse=async(selector)=>{const p=await point(selector);await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await new Promise(r=>setTimeout(r,180))};
 const click=async(selector)=>{await mouse(selector);const p=await point(selector);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1})};
 const leave=async()=>{await evaluate('document.activeElement?.blur()');await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:10,y:10});await new Promise(r=>setTimeout(r,200))};
 const active=()=>evaluate('document.querySelector('+JSON.stringify(flag)+').getAttribute("aria-pressed")==="true"');
 const shot=async name=>{const path=join(logs,name+'.png');const clip=name==='light-flagged'?await evaluate('(()=>{const r=document.querySelector("main").getBoundingClientRect(),row=document.querySelector("[role=button]").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:Math.ceil(row.bottom-r.y+32),scale:1}})()'):undefined;await writeFile(path,Buffer.from((await send('Page.captureScreenshot',{format:'png',...(clip?{clip}:{})})).data,'base64'));summary.screenshots??=[];summary.screenshots.push(path);if(clip){summary.screenshotClips??={};summary.screenshotClips[name]=clip}};
 const noActions=()=>evaluate('fixtureEvents.every(e=>!["archive","navigate","archive-success"].includes(e.type))');
await evaluate('fixtureTeams=true;fixtureRerender()');await wait('!!document.querySelector("[data-azrael-team]")');
for(const theme of ['light','dark']){
await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme)+';document.body.dataset.vscodeThemeKind='+JSON.stringify('vscode-'+theme));
check(theme+' Team Lead badge and loaded members',await evaluate('document.querySelectorAll("[data-fixture-teams] [data-azrael-lead]").length===1&&document.querySelectorAll("[data-fixture-teams] [role=button]").length===2'));await shot(theme+'-team-expanded');await evaluate('fixtureEvents=[]');await click('[data-fixture-teams] [data-azrael-session-flag]');check(theme+' Team flag preserves native action isolation',await evaluate('fixtureEvents.every(e=>e.type!=="navigate"&&e.type!=="archive")'));await click('[data-fixture-teams] [data-azrael-session-flag]');
await click('[data-azrael-team] > button');await wait('document.querySelector("[data-azrael-team] > button").getAttribute("aria-expanded")==="false"');
check(theme+' collapsed members hidden and native preference persisted',await evaluate('document.querySelectorAll("[data-fixture-teams] [role=button]").length===0&&JSON.parse(localStorage.getItem("fixture-preferences"))["azrael-team-collapsed"][JSON.stringify(["local","fixture-team"]) ]===true'));await shot(theme+'-team-collapsed');await click('[data-azrael-team] > button');await wait('document.querySelector("[data-azrael-team] > button").getAttribute("aria-expanded")==="true"');await click('[data-fixture-teams] [role=button]');
check(theme+' member opens native conversation',await evaluate('fixtureEvents.some(e=>e.type==="navigate"&&e.id==="same-id")'));
}
await evaluate('fixtureTeams=false;fixtureMenu=true;fixtureRerender()');await wait('!!document.querySelector("[data-fixture-menu] [data-azrael-team]")');
const setSearch=async text=>{await evaluate('document.querySelector("[data-fixture-menu] input").focus();document.querySelector("[data-fixture-menu] input").select()');await send('Input.insertText',{text});if(!text){await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8})}await new Promise(r=>setTimeout(r,100))};
for(const theme of ['light','dark']){
await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme)+';document.body.dataset.vscodeThemeKind='+JSON.stringify('vscode-'+theme)+';fixtureMenuPrefs("recent",false)');
await wait('document.querySelectorAll("[data-fixture-menu] [role=button]").length===3');
check(theme+' native All chats groups registered child despite native exclusion and preserves standalone',await evaluate('document.querySelectorAll("[data-fixture-menu] [data-azrael-team] [role=button]").length===2&&document.querySelector("[data-fixture-menu]").textContent.includes("Independent session")'));await shot(theme+'-native-recent-team');
const firstMenuMember=await evaluate('JSON.parse(document.querySelector("[data-fixture-menu] [data-azrael-team] [role=button] [data-azrael-session-flag]").getAttribute("data-azrael-session-flag"))[1]');await evaluate('fixtureEvents=[]');await click('[data-fixture-menu] [data-azrael-team] [role=button]');await wait('fixtureEvents.some(e=>e.type==="navigate")');summary.nativePopupClick=await evaluate('fixtureEvents');check(theme+' native popup Team member navigates and closes',await evaluate('fixtureEvents.some(e=>e.type==="navigate"&&e.id==='+JSON.stringify(firstMenuMember)+')&&fixtureEvents.some(e=>e.type==="close")'));
await setSearch('Unflagged');await wait('document.querySelectorAll("[data-fixture-menu] [role=button]").length===1');check(theme+' native title search applies before grouping without forcing Lead visible',await evaluate('document.querySelectorAll("[data-fixture-menu] [data-azrael-lead]").length===0&&document.querySelector("[data-fixture-menu] [data-azrael-team] > button").textContent.includes("Review session changes")'));await setSearch('Independent');await wait('!document.querySelector("[data-fixture-menu] [data-azrael-team]")');check(theme+' native search retains standalone row',await evaluate('document.querySelectorAll("[data-fixture-menu] [role=button]").length===1'));await setSearch('');
await evaluate('fixtureMenuPrefs("local",false)');await wait('document.querySelectorAll("[data-fixture-menu] [role=button]").length===3');check(theme+' native Local chats groups registered child',await evaluate('document.querySelectorAll("[data-fixture-menu] [data-azrael-team] [role=button]").length===2'));
await evaluate('fixtureMenuPrefs("cloud",false)');await wait('!document.querySelector("[data-fixture-menu] [data-azrael-team]")');check(theme+' native Cloud chats excludes local Teams',await evaluate('document.querySelectorAll("[data-fixture-menu] [role=button]").length===0'));
await evaluate('fixtureMenuPrefs("recent",true)');await wait('document.querySelectorAll("[data-fixture-menu] [role=button]").length===0');check(theme+' native flag filter excludes unflagged Team and standalone before grouping',await evaluate('!document.querySelector("[data-fixture-menu] [data-azrael-team]")'));await evaluate('fixtureMenuPrefs("recent",false)');await wait('!!document.querySelector("[data-fixture-menu] [data-azrael-session-flag]")');await click('[data-fixture-menu] [data-azrael-team] [data-azrael-session-flag*="same-id"]');await evaluate('fixtureMenuPrefs("recent",true)');await wait('document.querySelectorAll("[data-fixture-menu] [role=button]").length===1');check(theme+' native flag filter groups only flagged member',await evaluate('document.querySelectorAll("[data-fixture-menu] [data-azrael-team] [role=button]").length===1&&document.querySelectorAll("[data-fixture-menu] [data-azrael-lead]").length===1'));await click('[data-fixture-menu] [data-azrael-session-flag]');await wait('!document.querySelector("[data-fixture-menu] [data-azrael-team]")');await evaluate('fixtureMenuPrefs("recent",false)');
}
await evaluate('fixtureMenu=false;fixtureRerender()');
await evaluate('fixtureLead=true;fixtureRerender()');await wait('!!document.querySelector("[data-azrael-new-lead-trigger] button")');
for(const theme of ['light','dark']){
await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme)+';document.body.dataset.vscodeThemeKind='+JSON.stringify('vscode-'+theme)+';fixtureEvents=[]');
await click('[data-azrael-new-lead-trigger] button');check(theme+' ordinary New chat preserved and clears intent',await evaluate('fixtureEvents.filter(e=>e.type==="new-chat").length===1&&fixtureEvents.filter(e=>e.type==="cancel-lead").length===1&&!document.querySelector("[role=menuitem]")'));
await evaluate('fixtureEvents=[]');const hold=await point('[data-azrael-new-lead-trigger] button');await send('Input.dispatchMouseEvent',{type:'mousePressed',...hold,button:'left',clickCount:1});await new Promise(r=>setTimeout(r,650));await send('Input.dispatchMouseEvent',{type:'mouseReleased',...hold,button:'left',clickCount:1});await wait('!!document.querySelector("[role=menuitem]")');check(theme+' long press opens only Lead menu and suppresses release click',await evaluate('fixtureEvents.length===0'));await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait('!document.querySelector("[role=menuitem]")');
await evaluate('fixtureEvents=[];document.querySelector("[data-azrael-new-lead-trigger] button").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}))');await wait('!!document.querySelector("[role=menuitem]")');await shot(theme+'-lead-menu');await click('[role=menuitem]');await wait('fixtureEvents.some(e=>e.type==="new-chat")');check(theme+' New Lead awaits intent and invokes native action once',await evaluate('fixtureEvents.map(e=>e.type).join(",")==="begin-lead,new-chat"'));
await evaluate('fixtureEvents=[];fixtureLeadFailure=true;document.querySelector("[data-azrael-new-lead-trigger] button").dispatchEvent(new KeyboardEvent("keydown",{key:"F10",shiftKey:true,bubbles:true,cancelable:true}))');await wait('!!document.querySelector("[role=menuitem]")');await click('[role=menuitem]');await wait('!!document.querySelector("[role=alert]")');check(theme+' rejected Lead intent surfaces error and prevents native action',await evaluate('fixtureEvents.every(e=>e.type!=="new-chat")'));await shot(theme+'-lead-error');await evaluate('fixtureLeadFailure=false');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait('!document.querySelector("[role=menuitem]")');await evaluate('fixtureEvents=[];document.querySelector("[data-azrael-new-lead-trigger] button").focus()');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});summary.keyboardState=await evaluate('({active:document.activeElement.outerHTML,events:fixtureEvents})');await wait('fixtureEvents.some(e=>e.type==="new-chat")');check(theme+' Escape after keyboard context menu preserves ordinary keyboard New chat',await evaluate('fixtureEvents.filter(e=>e.type==="new-chat").length===1&&fixtureEvents.filter(e=>e.type==="cancel-lead").length===1&&!document.querySelector("[role=menuitem]")'));await evaluate('fixtureEvents=[];fixtureCancelFailure=true');await click('[data-azrael-new-lead-trigger] button');await wait('!!document.querySelector("[role=alert]")');check(theme+' cancel rejection handled with alert and ordinary action preserved',await evaluate('fixtureEvents.map(e=>e.type).join(",")=="cancel-lead,new-chat"&&!document.querySelector("[role=menuitem]")'));await evaluate('fixtureCancelFailure=false');
}
summary.visualFindings='Team disclosure and Lead badge use native buttons, rows, and semantic CSS in light/dark themes; direct member navigation and native pref collapse pass. Lead menu uses native popup with explicit gesture-only opening and preserves ordinary click.';summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
  summary.browserExit=await confirmOwnedBrowserExit(chrome,profile);
  artifactRun.producerStopped=summary.browserExit.confirmed;
  summary.runRoot=artifactRun.runRoot;summary.lifecycleId=artifactRun.lifecycleId;
  summary.fixtureRemoved=false;summary.retentionReason='Retained fixture, profile and raw results for lifecycle review';
  if(!summary.browserExit.confirmed)process.exitCode=1;
  summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({runRoot:artifactRun.runRoot,lifecycleId:artifactRun.lifecycleId,outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
