"use strict";
const { createWebviewIdleManager, isWebviewWorkIdle } = require("./webview-idle.cjs");
const ASSET = "webview/assets/app-initial-7a199c66e670.js";
const MARKER = "/*azrael-webview-idle-v1*/";
const HOST_HELPER = `${MARKER}${createWebviewIdleManager.toString()}`;
const methods = `azraelIdle(){return this.__azraelIdle??=createWebviewIdleManager({send:(e,r)=>this.postMessageToWebview(e,r),preferences:()=>this.readPersistedAtomState(),hasPendingRequests:()=>this.pendingMcpRequests.size!==0,canRelease:async()=>this.pendingMcpRequests.size===0&&await je.commands.executeCommand("azrael.canReleaseConversationWebview")===true&&this.pendingMcpRequests.size===0,error:error=>this.logger.error("Azrael webview idle lifecycle failed",{safe:{error},sensitive:{}}),suspended:(e,snapshot)=>{let panel=this.findPanelByWebview(e),state=panel&&this.editorPanels.get(panel);if(state){state.ready=!1;if(snapshot.route?.pathname)state.initialRoute=snapshot.route.pathname}this.disposeClientCoordinationForWebview(e);this.workerBusMessageHandler.unregisterWebview(e)},content:async(e,snapshot)=>{let lifetime=this.__azraelIdleLifetime.get(e);this.registerClientCoordinationForWebview(e,lifetime.dispose,lifetime.health);this.workerBusMessageHandler.registerWebview(e);let html=require("./optional-diagnostics.cjs").injectUiInputPolicy(await this.getWebviewContent(e)),data=encodeURIComponent(JSON.stringify(snapshot)).replaceAll("'","%27");if(snapshot.route?.pathname&&!this.findPanelByWebview(e))html=html.replace("</head>",'<meta name="initial-route" content="'+Ah(snapshot.route.pathname)+'"> </head>');return html.replace("</head>",'<meta name="azrael-webview-idle-state" content="'+data+'"></head>')}})}azraelAttachIdle(e,n,s){(this.__azraelIdleLifetime??=new WeakMap).set(e,{dispose:n,health:s});let view=this.findPanelByWebview(e)??Array.from(this.sidebarViews).find(v=>v.webview===e);if(view)this.azraelIdle().attach(view,e)}`;
const hostEdits = [
  ["o?.(),this.fatalError&&", "o?.(),this.__azraelIdle?.ready(e),this.fatalError&&"],
  ["async initializeWebview(e,r,n,o){", methods + "async initializeWebview(e,r,n,o){"],
  [",s.start()}onPanelReady(e){", ",s.start(),this.azraelAttachIdle(e,n,s)}onPanelReady(e){"],
  ['case"persisted-atom-sync-request":{', 'case"azrael-webview-idle-snapshot":{this.azraelIdle().receive(e,r);break}case"persisted-atom-sync-request":{'],
  ["postMessageToWebview(e,r){if(r.type", "postMessageToWebview(e,r){if(this.__azraelIdle?.holdOutgoing(e,r))return;if(r.type"],
  ["if(!o.ready){o.pendingMessages.push(e);continue}", "if(this.__azraelIdle?.isSuspended(i))continue;if(!o.ready){o.pendingMessages.push(e);continue}"],
  ["broadcastPersistedAtomUpdate(e,r){", "broadcastPersistedAtomUpdate(e,r){if(e===\"azrael-session-flags\")this.__azraelIdle?.preferencesChanged();"],
  ["dispose(){for(let{dispose:r}of this.clientCoordinationByWebview.values())", "dispose(){this.__azraelIdle?.dispose();for(let{dispose:r}of this.clientCoordinationByWebview.values())"],
];
// Small transient state supplements the native persisted draft. No transcript is saved here.
const UI_HELPER = `${MARKER}
${isWebviewWorkIdle.toString()}
var azraelIdleScope,azraelIdleSaved,azraelIdleScrollRestored=false;
function azraelIdleReadSaved(){if(azraelIdleSaved===void 0){let meta=globalThis.document?.querySelector('meta[name="azrael-webview-idle-state"]');azraelIdleSaved=meta?.content?JSON.parse(decodeURIComponent(meta.content)):null}return azraelIdleSaved}
function azraelIdleMount(scope){azraelIdleScope=scope;let saved=azraelIdleReadSaved();if(saved?.key===jnt(scope.value)&&JSON.stringify(PG(scope.get(RG.drafts$)[g_(scope.value)]))===JSON.stringify(saved.draft)){scope.set(ZG,saved.viewState);Dyr(scope,saved.viewState.responseTextAnnotations??[]);for(let [atom,value]of [[uK,saved.selections?.[0]],[OW,saved.selections?.[1]],[DW,saved.selections?.[2]],[iW,saved.selections?.[3]],[SW,saved.selections?.[5]],[xW,saved.selections?.[6]]])if(value!==void 0)scope.set(atom,value);}
return()=>{if(azraelIdleScope===scope)azraelIdleScope=null}}
function azraelIdlePath(node){let path=[];while(node&&node!==document.documentElement){let parent=node.parentElement;if(!parent)return null;path.unshift(Array.prototype.indexOf.call(parent.children,node));node=parent}return path}
function azraelIdleCapture(){let scope=azraelIdleScope;if(!scope)return{canSuspend:false};let route=scope.get(Kf),snapshot={canSuspend:scope.value.kind==='local'&&scope.get(zNt,scope.value.hostId??'local')?.status==='ready'&&isWebviewWorkIdle(scope.get(nA,scope.value.hostId??'local'),scope.value.conversationId)&&scope.get(HG)===false&&(scope.get(DW)?.length??0)===0,key:jnt(scope.value),hostId:scope.value.hostId??'local',conversationId:scope.value.conversationId??scope.value.clientThreadId??null,route:route?{pathname:route.pathname}:null,draft:PG(scope.get(RG.drafts$)[g_(scope.value)]),viewState:scope.get(QG),selections:[scope.get(uK),scope.get(OW),scope.get(DW),scope.get(iW),scope.get(lW,jnt(scope.value)),scope.get(SW),scope.get(xW)],scroll:[]};for(let node of document.querySelectorAll('*'))if(node.scrollHeight>node.clientHeight+1&&node.clientHeight>0)snapshot.scroll.push({path:azraelIdlePath(node),top:node.scrollTop,left:node.scrollLeft,bottom:node.scrollHeight-node.scrollTop-node.clientHeight<4});let text=JSON.stringify(snapshot);if(text.includes('blob:'))return{canSuspend:false};return JSON.parse(text)}
function azraelIdleRestoreScroll(){let saved=azraelIdleReadSaved();if(!saved?.scroll?.length||azraelIdleScrollRestored||!azraelIdleScope||saved.key!==jnt(azraelIdleScope.value))return;let pending=false;for(let item of saved.scroll){let node=document.documentElement;for(let index of item.path??[])node=node?.children[index];if(!node||node.scrollHeight<=node.clientHeight||!item.bottom&&node.scrollHeight-node.clientHeight<item.top){pending=true;continue}node.scrollTop=item.bottom?node.scrollHeight:item.top;node.scrollLeft=item.left}if(!pending)azraelIdleScrollRestored=true}
if(globalThis.window){window.addEventListener('message',event=>{let message=event.data;if(message?.type!=='azrael-webview-idle-capture')return;try{Dm.dispatchMessage('azrael-webview-idle-snapshot',{id:message.id,snapshot:azraelIdleCapture()})}catch{Dm.dispatchMessage('azrael-webview-idle-snapshot',{id:message.id,snapshot:{canSuspend:false}})}});let timer=setInterval(()=>{try{azraelIdleRestoreScroll()}catch{}},250);setTimeout(()=>clearInterval(timer),30000)}
`;
const uiAnchor = "onMount(e,t){let n=obr(t.value),r=t.get(JG);";
const uiReplacement = "onMount(e,t){let azraelIdleUnmount=azraelIdleMount(t);let n=obr(t.value),r=t.get(JG);";
const watchAnchor = "return t.watch(({get:e})=>{if(i==null)return;";
const watchReplacement = "let azraelIdleWatch=t.watch(({get:e})=>{if(i==null)return;";
const endAnchor = "t.set(kbr,i,[]))})}}),Mbr=";
const endReplacement = "t.set(kbr,i,[]))});return()=>{azraelIdleUnmount();azraelIdleWatch()}}}),Mbr=";
function injectWebviewIdle(text, asset) {
  if (!["out/extension.js", ASSET].includes(asset)) return { text, count: 0 };
  const edits = asset === ASSET ? [[uiAnchor,uiReplacement],[watchAnchor,watchReplacement],[endAnchor,endReplacement]] : hostEdits;
  const helper = asset === ASSET ? UI_HELPER : HOST_HELPER;
  const count = token => text.split(token).length - 1;
  if (count(MARKER)) {
    if (count(MARKER)!==1||count(helper)!==1||edits.some(([,replacement])=>count(replacement)!==1))throw Error("Damaged webview idle transform");
    return {text,count:0};
  }
  for (const [anchor] of edits) if(count(anchor)!==1)throw Error("Pinned webview idle anchor changed: "+anchor);
  for (const [anchor,replacement] of edits) text=text.replace(anchor,replacement);
  return {text:text+"\n"+helper+"\n",count:1};
}
module.exports={ASSET,MARKER,UI_HELPER,injectWebviewIdle};
