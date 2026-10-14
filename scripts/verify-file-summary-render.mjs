import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,extname,sep,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function containedOutput(value,fallback,allowed){
 const candidate=resolve(value||fallback),within=relative(allowed,candidate);
 if(!within||within==='..'||within.startsWith('..'+sep)||isAbsolute(within))throw Error('Render output must be contained beneath '+allowed);
 return candidate;
}
const fixture=containedOutput(process.env.AZRAEL_RENDER_FIXTURE_ROOT,join(root,'artifacts/verification/compact-file-summary-ui'),join(root,'artifacts/verification'));
const logs=containedOutput(process.env.AZRAEL_RENDER_LOG_ROOT,join(root,'artifacts/logs/compact-file-summary/render'),join(root,'artifacts/logs'));
const assets=join(root,'artifacts/upstream-ui/26.1007.21434/webview/assets'),profile=join(fixture,'chrome-profile');
const require=createRequire(import.meta.url);

const {injectUiCleanup,TURN_DIFF_ASSET}=require('./inject-ui-cleanup.cjs');
const ts=require(require.resolve('typescript',{paths:[join(root,'extensions/azrael-ex')]}));
await mkdir(profile,{recursive:true});await mkdir(logs,{recursive:true});
const mainName=TURN_DIFF_ASSET.split('/').at(-1);
const original=await readFile(join(assets,mainName),'utf8');
const main=injectUiCleanup(original,TURN_DIFF_ASSET,ts).text;
const ast=ts.createSourceFile(mainName,main,99,true,ts.ScriptKind.JS);
const beforeAst=ts.createSourceFile(mainName,original,99,true,ts.ScriptKind.JS);
const source=(tree,name)=>{const f=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(f,name);return f.getText(tree)};
const nativeBefore=source(beforeAst,'JE');
const headerBefore=nativeBefore.slice(nativeBefore.indexOf('let xe=be,Se;'),nativeBefore.indexOf('let Me;')).replaceAll('(j,','(FixtureMessage,').replaceAll('(ZE,','(FixtureReview,').replaceAll('(QE,','(FixtureTrigger,');
const adapterSource=`
window.fixtureEvents=[];
function FixtureMessage({defaultMessage}){return defaultMessage}
const fixtureIntl=()=>({locale:'ko',formatNumber:n=>String(n),formatMessage:({defaultMessage},values={})=>defaultMessage.replace(/\\{(\\w+)\\}/g,(_,key)=>values[key]??'')});
const FixtureTrigger=(${source(ast,'QE').replace('r=g()','r=fixtureIntl()')});
const FixtureReview=(${source(ast,'ZE').replaceAll('(j,','(FixtureMessage,')});
const FixtureCompactHeader=(${source(ast,'azraelTurnDiffHeader').replaceAll('(QE,','(FixtureTrigger,')});
function FixturePathWrapper({children}){return Q.jsx('div',{className:'group/turn-diff-file-row',children})}
const FixtureRowBefore=(${source(beforeAst,'tD').replaceAll('Ig,','FixturePathWrapper,').replaceAll('Yg,','FixturePathWrapper,').replaceAll('(j,','(FixtureMessage,')});
const FixtureRowAfter=(${source(ast,'tD').replaceAll('Ig,','FixturePathWrapper,').replaceAll('Yg,','FixturePathWrapper,').replaceAll('(j,','(FixtureMessage,')});
function FixtureHeaderBefore(){let t=(0,rD.c)(124),k=oD.useRef(null),be=()=>{},le=true,ue='undo',N={isPending:false},fe=()=>{},r=true,ge=()=>fixtureEvents.push('before-header'),W=undefined,z=27,B=0,ie='파일 2개를 편집했습니다';${headerBefore}return je}
function FixtureContent(){lD();const rows=['scripts/test-team-integration.cjs','work/AZ-01-team-lead-ui/01-plan.md'];return (0,Q.jsxs)('div',{className:'p-4',children:['before','after'].map(phase=>(0,Q.jsxs)('section',{'data-phase':phase,className:'mb-4',children:[(0,Q.jsx)('p',{className:'mb-2 text-secondary',children:phase==='before'?'기존':'수정'}),(0,Q.jsxs)(zr,{className:'text-base [--turn-diff-row-padding-y:0.25rem]',children:[phase==='before'?(0,Q.jsx)(FixtureHeaderBefore,{}):FixtureCompactHeader({title:'파일 2개를 편집했습니다',linesAdded:27,linesRemoved:0,single:false,onOpen:()=>fixtureEvents.push('after-header')}),(0,Q.jsx)('div',{className:'flex flex-col border-t border-default',children:rows.map((path,index)=>(0,Q.jsx)(phase==='before'?FixtureRowBefore:FixtureRowAfter,{displayPath:path,path,linesAdded:index===0?26:1,linesRemoved:0,onOpen:e=>fixtureEvents.push({path,modified:e.ctrlKey||e.metaKey})},path))})]}),phase==='after'?(0,Q.jsx)('div',{'data-single':true,className:'mt-4',children:(0,Q.jsx)(zr,{children:FixtureCompactHeader({title:'test.cjs 수정됨',linesAdded:1,linesRemoved:0,single:true,onOpen:()=>fixtureEvents.push('single')})})}):null]},phase))})}
function Fixture(){lD();return Q.jsx(window.__REACT_INTL_CONTEXT__.Provider,{value:fixtureIntl(),children:Q.jsx(FixtureContent,{})})}
export{Fixture};`;
const html=`<!doctype html><html data-theme="light" data-codex-window-type="extension"><head><meta charset="utf-8"><style>@layer theme,base,components,utilities;html,body,#root{height:100%;margin:0}</style><link rel="stylesheet" href="/assets/app-initial-aad627bd9dff.css"><link rel="stylesheet" href="/assets/app-initial-49150e6a0951.css"><link rel="stylesheet" href="/assets/app-initial-f5b2ced5ef25.css"></head><body data-vscode-theme-kind="vscode-light"><div id="root"></div><script>globalThis.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script><script type="module">import{$At as KEt,XAt as UEt}from'/assets/app-initial-97d3534ad35f.js';import{Fixture}from'/assets/${mainName}';window.reactRoot=UEt().createRoot(document.getElementById('root'));reactRoot.render(KEt().jsx(Fixture,{}));window.fixtureReady=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 if(req.url.startsWith('/assets/')){const pathname=resolve(assets,decodeURIComponent(req.url.slice(8)).split('?')[0]);if(!pathname.startsWith(assets+sep))throw Error('Invalid asset');let source=await readFile(pathname);if(pathname===join(assets,mainName))source=main+adapterSource;res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(pathname)]||'application/octet-stream');res.end(source);return}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let socket,session,id=0,chrome;
const summary={scope:'Production compact header and native file-row/card/React/CSS before/after; synthetic host, title localization, file-menu and inline-diff wrapper boundaries. Windows Chrome; package and installed app separate.',checks:[]},pending=new Map(),exceptions=[];
try{
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((r,j)=>{let s='';const t=setTimeout(()=>j(Error('Chrome startup timeout')),20000);chrome.stderr.on('data',c=>{s+=c;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);r(m[1])}});chrome.on('error',j)});
 socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')exceptions.push(m.params.args);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.j(Error(JSON.stringify(m.error))):p.r(m.result)}}});
 const send=(method,params={},sid=session)=>new Promise((r,j)=>{const n=++id,t=setTimeout(()=>j(Error('CDP timeout '+method)),20000);pending.set(n,{r,j,t});socket.send(JSON.stringify({id:n,method,params,...(sid?{sessionId:sid}:{})}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Wait failed: '+expression+'; '+JSON.stringify(await evaluate('({errors:fixtureErrors,body:document.body.innerText})')))};
 const check=(name,value)=>{assert.ok(value,name);summary.checks.push(name)};
 session=(await send('Target.attachToTarget',{targetId:(await send('Target.createTarget',{url:'about:blank'},null)).targetId,flatten:true},null)).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:950,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});

 await wait("window.fixtureReady && !!document.querySelector('[data-phase=after]')");
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.dataset.vscodeThemeKind='vscode-${theme}';document.documentElement.style.setProperty('--vscode-foreground','${theme==='light'?'#202123':'#eee'}');document.documentElement.style.setProperty('--vscode-descriptionForeground','${theme==='light'?'#666':'#aaa'}');document.documentElement.style.setProperty('--vscode-editor-background','${theme==='light'?'#fff':'#212121'}');document.documentElement.style.setProperty('--color-codex-git-added','${theme==='light'?'#4d8600':'#9acb6c'}');document.documentElement.style.setProperty('--color-codex-git-deleted','${theme==='light'?'#d00000':'#ff7777'}');document.body.style.background='${theme==='light'?'#fff':'#212121'}'`);
  const state=await evaluate(`(()=>{const before=document.querySelector('[data-phase=before]'),after=document.querySelector('[data-phase=after]'),card=after.querySelector('[class*=resource-card-max-width]'),header=after.querySelector('[class*=turn-diff-header]'),text=header.querySelector('.inline-flex'),parts=[...text.children].map(e=>e.getBoundingClientRect()),icon=header.querySelector('.size-6'),rows=after.querySelectorAll('[class*=turn-diff-file-row] button');return {before:before.querySelector('[class*=resource-card-max-width]').getBoundingClientRect().height,after:card.getBoundingClientRect().height,header:header.getBoundingClientRect().height,icon:icon.getBoundingClientRect().width,glyph:icon.firstElementChild.getBoundingClientRect().width,parts:parts.map(r=>({top:r.top,bottom:r.bottom})),rows:[...rows].map(e=>e.getBoundingClientRect().height),color:getComputedStyle(header).color,added:getComputedStyle(header.querySelector('.text-codex-git-added')).color,removed:getComputedStyle(header.querySelector('.text-codex-git-deleted')).color,token:getComputedStyle(header).getPropertyValue('--color-codex-git-added'),text:header.innerText,buttons:header.querySelectorAll('button').length}})()`);
  summary[theme]=state;
  check(theme+' header removes actions',state.buttons===0&&!state.text.includes('View changes')&&!state.text.includes('Undo'));
  check(theme+' title and stats align',Math.abs(state.parts[0].top-state.parts[1].top)<5);
  check(theme+' native stats preserve values and colors',state.text.includes('+27')&&state.text.includes('-0')&&state.added!==state.removed);
  check(theme+' compact icon',state.icon===24&&state.glyph===16);
  check(theme+' shorter card and rows',state.after<state.before&&state.rows.every(h=>h===32));
  summary[theme]=state;
  await writeFile(join(logs,theme+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("document.querySelector('[data-phase=after] [class*=turn-diff-file-row] button').click()");
  check(theme+' native row click',await evaluate("fixtureEvents.at(-1)?.path==='scripts/test-team-integration.cjs'"));
  await evaluate("document.querySelector('[data-phase=after] [class*=turn-diff-file-row] button').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}))");
  check(theme+' modifier reaches native callback',await evaluate('fixtureEvents.at(-1)?.modified===true'));
  await evaluate("document.querySelector('[data-single] button').focus()");
  await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'char',text:'\r',unmodifiedText:'\r',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  check(theme+' single header keyboard open',await evaluate("fixtureEvents.at(-1)==='single'"));
 }
 check('theme foreground changes',summary.light.color!==summary.dark.color);
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:700,deviceScaleFactor:1,mobile:false});
 check('narrow card has no horizontal overflow',await evaluate('document.body.scrollWidth<=360'));
 await writeFile(join(logs,'narrow.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 check('no browser exceptions',exceptions.length===0&&(await evaluate('fixtureErrors')).length===0);summary.outcome='passed';await evaluate('reactRoot.unmount()');await send('Browser.close',{},null).catch(()=>{});
}catch(e){summary.outcome='failed';summary.error=String(e.stack||e);summary.exceptions=exceptions;process.exitCode=1}
finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:++id,method:'Browser.close'}))}catch{}await new Promise(r=>setTimeout(r,250));socket.close()}
 for(const p of pending.values())clearTimeout(p.t);
 if(chrome&&chrome.exitCode===null&&chrome.signalCode===null)await new Promise(r=>{const t=setTimeout(r,30000);chrome.once('exit',()=>{clearTimeout(t);r()})});
 const browserExited=chrome!=null&&(chrome.exitCode!==null||chrome.signalCode!==null);
 if(browserExited){const cleaned=spawnSync('powershell.exe',['-NoProfile','-Command','$taskFixture = $env:AZRAEL_DIFF_FIXTURE; Remove-Item -LiteralPath $taskFixture -Recurse; if (Test-Path -LiteralPath $taskFixture) { exit 1 }'],{windowsHide:true,env:{...process.env,AZRAEL_DIFF_FIXTURE:fixture},encoding:'utf8'});if(cleaned.status!==0)throw Error('Fixture cleanup failed: '+cleaned.stderr);summary.cleanup='Owned browser exited; contained fixture/profile removed'}else{summary.cleanup='Browser exit uncertain; profile retained until confirmed closed';process.exitCode=1}
 summary.exitCode=process.exitCode||0;await writeFile(join(logs,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({outcome:summary.outcome,checks:summary.checks,error:summary.error,cleanup:summary.cleanup,exitCode:summary.exitCode}));
}
