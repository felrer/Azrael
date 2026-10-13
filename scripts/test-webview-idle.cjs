"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const { createWebviewIdleManager } = require("./webview-idle.cjs");
const { ASSET, MARKER, UI_HELPER, injectWebviewIdle } = require("./inject-webview-idle.cjs");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
function fixture({sidebar=false}={}) {
  let now=0, id=0, visibility, closed, preferences={}, sent=[], pendingCapture, errors=[];
  const timers=new Map(), clock={Date:{now:()=>now},setTimeout(fn,ms){timers.set(++id,{fn,at:now+ms});return id},clearTimeout(id){timers.delete(id)}};
  const view={visible:true,onDidDispose(fn){closed=fn;return{dispose(){}}}};
  view[sidebar?"onDidChangeVisibility":"onDidChangeViewState"]=fn=>{visibility=fn;return{dispose(){}}};
  const webview={html:"native-ui"};
  let suspendCount=0, restoreCount=0, contentResolver;
  const manager=createWebviewIdleManager({
    send(w,m){sent.push(m);pendingCapture=m.id},preferences:async()=>preferences,
    suspended(){suspendCount++},error:e=>errors.push(e),
    content:async(w,s)=>{restoreCount++;return contentResolver?await contentResolver(s):"native-ui-restored"},
  },clock);
  manager.attach(view,webview);
  const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
  return {manager,view,webview,sent,errors,timers,flush,
    count:()=>({suspendCount,restoreCount}),flags(value){preferences={"azrael-session-flags":value}},
    setContent(fn){contentResolver=fn},close(){closed()},
    async visible(value){view.visible=value;visibility();await flush()},
    async tick(ms){now+=ms;for(const [id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn()}await flush()},
    async capture(snapshot={canSuspend:true,hostId:"local",conversationId:"a",draft:{prompt:"unsent"},viewState:{fileAttachments:["a.txt"]}}){manager.receive(webview,{type:"azrael-webview-idle-snapshot",id:pendingCapture,snapshot});await flush()},
  };
}
test("continuous hidden hour, retained tab, snapshot and fresh renderer on return",async()=>{
  const f=fixture();await f.visible(false);await f.tick(3599999);assert.equal(f.sent.length,0);
  await f.tick(1);await f.capture();assert.equal(f.manager.isSuspended(f.webview),true);
  assert.ok(!f.webview.html.includes("native-ui"));assert.equal(f.count().suspendCount,1);
  assert.equal(f.manager.snapshot(f.webview).draft.prompt,"unsent");
  await f.visible(true);assert.equal(f.webview.html,"native-ui-restored");assert.equal(f.count().restoreCount,1);
  await f.visible(false);await f.tick(3599999);assert.equal(f.sent.length,1);f.close();assert.equal(f.timers.size,0);
});
test("sidebar visibility and display reset; non-active visible split stays retained",async()=>{
  const f=fixture({sidebar:true});await f.tick(7200000);assert.equal(f.sent.length,0);
  await f.visible(false);await f.tick(3000000);await f.visible(true);await f.visible(false);
  await f.tick(600000);assert.equal(f.sent.length,0);f.close();
});
test("flag lookup scopes hosts, checks after capture, and flag removal rechecks overdue view",async()=>{
  const f=fixture();await f.visible(false);await f.tick(3600000);
  f.flags({'["local","a"]':true});await f.capture();assert.equal(f.manager.isSuspended(f.webview),false);
  f.flags({'["remote","a"]':true});f.manager.preferencesChanged();await f.tick(0);await f.capture();
  assert.equal(f.manager.isSuspended(f.webview),true);f.close();
});
test("show/dispose race invalidates capture; missing or unsafe state retries without deletion",async()=>{
  const f=fixture();await f.visible(false);await f.tick(3600000);await f.visible(true);await f.capture();assert.equal(f.count().suspendCount,0);
  await f.visible(false);await f.tick(3600000);await f.capture({canSuspend:false});assert.equal(f.count().suspendCount,0);
  await f.tick(60000);await f.tick(5000);assert.equal(f.count().suspendCount,0);assert.equal(f.timers.size,1);f.close();
});
test("async restoration race and failure preserve saved state for next show",async()=>{
  const f=fixture();await f.visible(false);await f.tick(3600000);await f.capture();
  let finish;f.setContent(()=>new Promise(r=>finish=r));await f.visible(true);await f.visible(false);finish("late");await f.flush();assert.notEqual(f.webview.html,"late");
  f.setContent(()=>{throw Error("read failed")});await f.visible(true);assert.equal(f.errors.length,1);assert.equal(f.manager.isSuspended(f.webview),true);
  f.setContent(null);await f.visible(false);await f.visible(true);assert.equal(f.webview.html,"native-ui-restored");f.close();
});
test("suspended history is dropped; deliberate navigation and approvals wait for ready",async()=>{
  const f=fixture();await f.visible(false);await f.tick(3600000);await f.capture();
  assert.equal(f.manager.holdOutgoing(f.webview,{type:"history-update",largeHistory:[1,2,3]}),true);
  assert.equal(f.manager.holdOutgoing(f.webview,{type:"navigate-to-route",path:"/local/b"}),true);
  await f.visible(true);assert.equal(f.manager.holdOutgoing(f.webview,{type:"mcp-request-delivery",requestId:"approval"}),true);
  assert.equal(f.manager.holdOutgoing(f.webview,{type:"persisted-atom-sync",state:{}}),false);
  f.manager.ready(f.webview);assert.equal(f.sent.at(-2).path,"/local/b");assert.equal(f.sent.at(-1).requestId,"approval");
  assert.equal(f.sent.some(m=>m.type==="history-update"),false);f.close();
});
test("native composer mount restores attachments and native prompt without submitting",()=>{
  const atoms=Object.fromEntries(["ZG","mK","Wbr","uK","OW","DW","iW","SW","xW","HG","Kf","QG","lW"].map(x=>[x,x]));
  const saved={key:"a",draft:{prompt:"draft text",pullRequestChecks:[]},viewState:{fileAttachments:[{path:"a.txt"}],responseTextAnnotations:[]},selections:[[],[],[],[],[],null,0]};
  const state=new Map(),writes=[];
  const scope={value:{kind:"local",conversationId:"a"},set(a,...v){state.set(a,v.at(-1));writes.push(a)},get(a){return a==="QG"?saved.viewState:a==="Kf"?{pathname:"/local/a"}:a==="HG"?false:a==="drafts"?{a:saved.draft}:state.get(a)}};
  const ctx={...atoms,RG:{drafts$:"drafts"},g_:v=>v.conversationId,jnt:()=>"a",PG:x=>x,Dyr:()=>{},document:{querySelector:()=>({content:encodeURIComponent(JSON.stringify(saved))}),querySelectorAll:()=>[]}};
  vm.createContext(ctx);vm.runInContext(UI_HELPER,ctx);const unmount=ctx.azraelIdleMount(scope);
  assert.equal(scope.get("drafts").a.prompt,"draft text");assert.equal(state.get("ZG").fileAttachments[0].path,"a.txt");
  assert.equal(ctx.azraelIdleCapture().canSuspend,true);assert.equal(ctx.azraelIdleCapture().conversationId,"a");
  saved.viewState.fileAttachments.push({url:"blob:unsafe"});assert.equal(ctx.azraelIdleCapture().canSuspend,false);
  unmount();assert.equal(ctx.azraelIdleCapture().canSuspend,false);
  state.clear();ctx.azraelIdleSaved={...saved,draft:{prompt:"older draft"}};
  ctx.azraelIdleMount(scope);assert.equal(state.has("ZG"),false,"a newer native draft is never overwritten by the snapshot");
});
test("pinned host/UI transforms validate exact anchors, syntax and idempotence",()=>{
  for(const asset of ["out/extension.js",ASSET]){
    const original=fs.readFileSync("artifacts/upstream-ui/26.1007.21434/"+asset,"utf8"),patched=injectWebviewIdle(original,asset);
    assert.equal(patched.count,1);assert.equal(injectWebviewIdle(patched.text,asset).count,0);
    assert.equal(ts.createSourceFile(asset,patched.text,99,true,1).parseDiagnostics.length,0);
    assert.throws(()=>injectWebviewIdle(original+original,asset));assert.throws(()=>injectWebviewIdle(patched.text+MARKER,asset));
  }
});
test("production host callbacks reconnect before HTML, retain native requests and refresh route",async()=>{
  const source=injectWebviewIdle(fs.readFileSync("artifacts/upstream-ui/26.1007.21434/out/extension.js","utf8"),"out/extension.js").text;
  const tree=ts.createSourceFile("host.js",source,99,true,1);let method;
  function visit(n){if(ts.isMethodDeclaration(n)&&n.name.getText(tree)==="azraelIdle")method=n.getText(tree);ts.forEachChild(n,visit)}visit(tree);assert.ok(method);
  let callbacks;const order=[],webview={},panel={},state={ready:true,initialRoute:"/local/old"};
  const context={WeakMap,JSON,encodeURIComponent,Ah:x=>x,require:()=>({injectUiInputPolicy:html=>html}),createWebviewIdleManager:options=>{callbacks=options;return{};}};
  vm.createContext(context);const host=vm.runInContext(`({${method}})`,context);
  Object.assign(host,{editorPanels:new Map([[panel,state]]),sidebarViews:new Set(),__azraelIdleLifetime:new WeakMap([[webview,{dispose:"dispose-listener",health:"health"}]]),findPanelByWebview:()=>panel,disposeClientCoordinationForWebview:()=>order.push("detach-client"),workerBusMessageHandler:{unregisterWebview:()=>order.push("detach-worker"),registerWebview:()=>order.push("connect-worker")},registerClientCoordinationForWebview:()=>order.push("connect-client"),getWebviewContent:async()=>{order.push("fresh-content");return"<head></head>latest native state"},logger:{error(){}},clearPendingRequestsForWebview:()=>assert.fail("native pending approvals must survive"),postMessageToWebview(){},readPersistedAtomState:async()=>({})});
  host.azraelIdle();callbacks.suspended(webview,{route:{pathname:"/local/a"}});assert.equal(state.ready,false);assert.equal(state.initialRoute,"/local/a");
  const html=await callbacks.content(webview,{key:"a",draft:{prompt:"unsent"}});assert.ok(html.includes("azrael-webview-idle-state"));assert.ok(html.includes("latest native state"));
  assert.deepEqual(order,["detach-client","detach-worker","connect-client","connect-worker","fresh-content"]);
});
test("production namespace pipeline and cache own both renderer and host lifecycle",()=>{
  const {transformAsset,getAssetTransformRules}=require("./namespace-azrael-host.cjs");
  for(const asset of ["out/extension.js",ASSET]){
    const result=transformAsset(fs.readFileSync("artifacts/upstream-ui/26.1007.21434/"+asset,"utf8"),asset,asset,ts);
    assert.equal(result.asset.webviewIdleEdits,1);assert.ok(result.text.includes(MARKER));
    assert.ok(getAssetTransformRules(asset)["inject-webview-idle.cjs"]);
  }
});
