"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const {CAPACITY_RETRY_ASSET:asset,CAPACITY_RETRY_MARKER:marker,injectCapacityRetryStop}=require("./inject-capacity-retry-stop.cjs");
const {transformAsset}=require("./namespace-azrael-host.cjs");
const ts=require("../extensions/azrael-ex/node_modules/typescript");
const pristine=fs.readFileSync((process.env.AZRAEL_PRESERVATION_UI_ROOT??"artifacts/upstream-ui/26.1007.21434")+"/"+asset,"utf8");
const transformed=injectCapacityRetryStop(pristine,asset);
const fn=transformed.text.slice(transformed.text.indexOf("function CNi(e)"),transformed.text.indexOf("function wNi(e)"));
function harness(){
 const cells=[],requests=[];let cursor=0,now=0,tick,delay,owner=true,ready=true,admit=true,fail=false;
 const hooks={useState(initial){const idx=cursor++;if(!(idx in cells))cells[idx]=typeof initial==="function"?initial():initial;return[cells[idx],value=>{cells[idx]=value}]},useRef(initial){const idx=cursor++;return cells[idx]??=( {current:initial})}};
 const jsx=(type,props)=>({type,props});
 const context={u7:hooks,d7:{jsx,jsxs:jsx},ta:()=>({get:()=>ready?"ready":"loading"}),Q:0,J:key=>key==="owner"?{role:owner?"owner":"observer"}:true,kg:"enabled",EKe:"owner",fs:0,Tme:()=>({activeMode:"default"}),le:()=>({locale:"ko"}),SDe:()=>admit,ZTe:()=>{},COe:(a,r,n,p)=>{requests.push({r,n,...p});return fail?Promise.reject(Error("fixture delivery failure")):Promise.resolve()},pMn:(callback,ms)=>{tick=callback;delay=ms},mNi:"retry",Ou:"button",Date:{now:()=>now},Set};
 vm.createContext(context);vm.runInContext(fn,context);
 return {requests,context,render(props={}){cursor=0;return context.CNi({conversationId:"thread",hostId:"host",turnId:"failed",retryDelaySeconds:10,...props})},tick(){tick()},advance(){now+=11000},get delay(){return delay},remount(){cells.length=0},setOwner(v){owner=v},setReady(v){ready=v},setAdmit(v){admit=v},setFail(v){fail=v}};
}
test("guarded transform and integrated pinned asset parse",()=>{
 assert.equal(transformed.count,1);assert.equal(injectCapacityRetryStop(transformed.text,asset).count,0);
 assert.equal(injectCapacityRetryStop(pristine,"future.js").count,0);
 assert.throws(()=>injectCapacityRetryStop("",asset),/anchor/);
 assert.throws(()=>injectCapacityRetryStop(pristine+pristine,asset),/anchor/);
 assert.throws(()=>injectCapacityRetryStop(transformed.text+marker,asset),/Duplicate/);
 const result=transformAsset(pristine,asset,asset,ts);assert.equal(result.asset.capacityRetryStopEdits,1);
 assert.equal(ts.createSourceFile(asset,result.text,99,true,ts.ScriptKind.JS).parseDiagnostics.length,0);
});
test("stop blocks already queued timer synchronously and survives card remount",()=>{
 const h=harness(),tree=h.render();assert.equal(h.delay,1000);
 tree.props.children[1].props.onClick();h.advance();h.tick();assert.equal(h.requests.length,0);
 let next=h.render();assert.equal(h.delay,null);assert.equal(next.props.children[1],null);
 h.remount();next=h.render();h.tick();assert.equal(h.requests.length,0);
 next.props.children[0].props.onClick();assert.equal(h.requests[0].turnTrigger,"capacity_retry_manual");
});
test("new turn and other host/thread retain automatic retry and duplicate admission is blocked",()=>{
 const h=harness();h.render().props.children[1].props.onClick();h.advance();
 for(const props of [{turnId:"new"},{hostId:"other"},{conversationId:"other"}]){
  h.remount();h.render(props);assert.equal(h.delay,1000);h.advance();h.tick();h.tick();
 }
 assert.equal(h.requests.length,3);assert.ok(h.requests.every(x=>x.turnTrigger==="capacity_retry_automatic"));
});
test("native owner, ready and admission guards remain active",()=>{
 for(const setter of ["setReady","setAdmit"]){const h=harness();h[setter](false);const tree=h.render();tree.props.children[0].props.onClick();assert.equal(h.requests.length,0)}
 const h=harness();h.setOwner(false);assert.equal(h.render().props.children[1],null);assert.equal(h.delay,null);
});

test("failed retry leaves manual retry available without restarting automatic submissions",async()=>{
 const h=harness();h.setFail(true);h.render().props.children[0].props.onClick();
 await new Promise(resolve=>setImmediate(resolve));
 const tree=h.render();assert.equal(tree.props.children[0].props.disabled,false);assert.equal(h.delay,null);
 h.setFail(false);tree.props.children[0].props.onClick();assert.equal(h.requests.length,2);
});
