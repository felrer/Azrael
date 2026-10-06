"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), test = require("node:test");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { createUiInputDiagnostics } = require("./ui-input-diagnostics-runtime.cjs");
const { UI_INPUT_DIAGNOSTICS_ASSETS: assets, UI_INPUT_DIAGNOSTICS_MARKER: marker, injectUiInputDiagnostics: inject } = require("./inject-ui-input-diagnostics.cjs");
const { injectQueueConsumption } = require("./inject-queue-consumption.cjs");
const thread = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222", canary = "PRIVATE-CANARY-input-and-error";
const turn = (kinds = ["params"]) => ({ params: { threadId: thread, clientUserMessageId: kinds.includes("params") ? id : undefined, input: kinds.includes("params") ? [canary] : [] }, items: kinds.filter(k=>k!=="params").map(k=>k==="user"?{type:"userMessage",clientId:id,content:[canary]}:{type:"steeringUserMessage",clientUserMessageId:id,input:[canary]}) });
const roots = [path.join(__dirname,"../artifacts/upstream-ui/26.930.61225")];
const transformed = new Map();
function method(source, name, signature) {
  const ast = ts.createSourceFile("asset.js",source,99,true,1); let found=[];
  function visit(n){if(ts.isMethodDeclaration(n)&&n.name.getText(ast)===name&&(!signature||n.body.getText(ast).includes(signature)))found.push(n);ts.forEachChild(n,visit)}visit(ast);
  assert.equal(found.length,1);return source.slice(found[0].getStart(ast),found[0].end);
}
test("selected pinned assets transform, parse, and reject partial or duplicate instrumentation", () => {
  for(const root of roots) for(const asset of assets) {
    const original=fs.readFileSync(path.join(root,asset),"utf8");
    const queued=asset===assets[1]?injectQueueConsumption(original).text:original;
    const output=inject(queued,asset,ts); assert.equal(output.count,1);
    assert.equal(inject(output.text,asset,ts).count,0);
    transformed.set(root+asset,output.text);
    assert.throws(()=>inject(output.text+marker,asset,ts),/Duplicate/);
    const partial=output.text.replace(root===roots[0]&&asset===assets[0]?"globalThis.__azraelUiInputDiagnostics=":"__azraelUiInputDiagnostics", "BROKEN_DIAGNOSTICS");
    assert.throws(()=>inject(partial,asset,ts),/Partial|Unsupported/);
  }
  const state=fs.readFileSync(path.join(roots[0],assets[1]),"utf8");
  assert.throws(()=>inject(state,assets[1],ts),/Unsupported/);
  assert.throws(()=>inject("{",assets[0],ts),/Malformed/);
  assert.equal(inject("anything","unrelated.js",ts).count,0);
});
test("serialized initialization uses the real host channel and catches sync and async failures", async () => {
  const source=transformed.get(roots[0]+assets[0]), start=source.indexOf(marker), end=source.indexOf("export{",start);
  const logs=[], context={xp:{dispatchMessage:(channel,payload)=>logs.push({channel,payload})}};
  vm.runInNewContext(source.slice(start,end),context);
  context.__azraelUiInputDiagnostics.queue(thread,id,true,false);
  assert.equal(logs[0].channel,"log-message");assert.equal(logs[0].payload.level,"warning");assert.ok(logs[0].payload.message.startsWith("[azrael-ui-input] "));
  assert.doesNotThrow(()=>createUiInputDiagnostics(()=>{throw Error(canary)}).queue(thread,id,true,false));
  createUiInputDiagnostics(()=>Promise.reject(Error(canary))).queue(thread,id,true,false);
  await new Promise(resolve=>setImmediate(resolve));
  const host=require("./namespace-azrael-host.cjs").rewriteJavaScript(fs.readFileSync(path.join(roots[0],"out/extension.js"),"utf8"),"extension.js",ts).text;
  assert.match(host,/case"log-message":\{let\{level:n,message:o\}=r;if\(!\w+\(n\)\)break;\w+\(\)\.log\(n,o,r\.tags\)/);
  assert.match(host,/\.window\.createOutputChannel\("Azrael",\{log:!0\}\)/);
});
test("identity remains while representations change, invalid identifiers and malformed snapshots never leak", () => {
  const logs=[],d=createUiInputDiagnostics(x=>logs.push(x)), snap=k=>d.snapshot(()=>[turn(k)]);
  d.compare(thread,snap(["params","user"]),snap(["user","steering"]));
  assert.equal(logs[0].event,"representation_changed");
  assert.deepEqual(logs[0].beforeKinds,["params","user"]);assert.deepEqual(logs[0].afterKinds,["user","steering"]);
  d.compare(thread,snap(["user","steering"]),d.snapshot(()=>[]));assert.equal(logs[1].event,"state_removed");
  d.compare(thread,snap(["params"]),snap(["steering"]));assert.equal(logs[2].beforeRepresentationCount,1);assert.equal(logs[2].afterRepresentationCount,1);assert.deepEqual(logs[2].beforeKinds,["params"]);assert.deepEqual(logs[2].afterKinds,["steering"]);
  const custom={params:{clientUserMessageId:canary,input:[canary]},items:[null,{type:"userMessage",clientId:canary,content:[canary]}]};
  assert.equal(d.snapshot(()=>[custom]).size,0);
  assert.equal(d.snapshot(()=>{throw Error(canary)}),null);
  const before=logs.length;d.compare(thread,snap(["params"]),null);d.queue(canary,id,true,false);assert.equal(logs.length,before);
  assert.ok(!JSON.stringify(logs).includes(canary));
  assert.equal(d.snapshot(()=>Array.from({length:501},(_,i)=>({params:{clientUserMessageId:`${i.toString(16).padStart(8,"0")}-1111-4111-8111-111111111111`,input:[canary]},items:[]}))),null);
  assert.equal(d.snapshot(()=>[{params:{},items:Array(10001).fill(null)}]),null);
});
test("actual state method observes both update branches, no-op, exceptions and unavailable diagnostics", () => {
  for(const root of roots){
    const real=method(transformed.get(root+assets[1]),"updateConversationState","this.conversations.get(e)"), logs=[],d=createUiInputDiagnostics(x=>logs.push(x));
    const context={globalThis:{__azraelUiInputDiagnostics:d},hZ:s=>s.turns,Ir:(s,fn)=>{const n={...s,turns:[...s.turns]};fn(n);return n},nee:(s,fn)=>{const n={...s,turns:[...s.turns]};fn(n);return[n,[]]},Ryn:()=>[],Fbn:()=>({})};
    const Store=vm.runInNewContext(`(class{${real}})`,context);
    for(const fast of [true,false]){
      const obj=new Store();obj.conversations=new Map([[thread,{turns:[turn(["params","user"])]}]]);obj.params={logger:{error(){}},canBroadcastPatchesToFollowers:()=>false,reconcileServerQueueReceipts(){}};obj.setConversation=s=>obj.conversations.set(thread,s);obj.notifyConversationCallbacks=()=>{};
      const opts=fast?{knownHistoryInvalidation:{type:"entityKeys"},knownChangedItems:[]}:{};
      obj.updateConversationState(thread,s=>{s.turns=[turn(["steering"])]},opts);
      assert.ok(logs.some(x=>x.event==="representation_changed"&&x.mutationKind===(fast?"optimized_history":"ordinary")&&x.historyInvalidationType===(fast?"entityKeys":null)));
      obj.updateConversationState(thread,s=>{s.turns=[]},opts);assert.ok(logs.some(x=>x.event==="state_removed"));
      const boom=Error(canary);assert.throws(()=>obj.updateConversationState(thread,()=>{throw boom},opts),e=>e===boom);
      context.globalThis.__azraelUiInputDiagnostics={snapshot(){throw boom},compare(){throw boom}};
      assert.doesNotThrow(()=>obj.updateConversationState(thread,s=>{},opts));context.globalThis.__azraelUiInputDiagnostics=d;
      if(!fast){obj.conversations.set(thread,{turns:[turn()],unconfirmedTurnSubmissions:[{terminal:true}]});obj.updateConversationState(thread,s=>{s.turns=[]},{knownHistoryInvalidation:{type:canary}});assert.ok(logs.some(x=>x.mutationKind==="history"&&x.historyInvalidationType==="other"));}
    }
    assert.ok(!JSON.stringify(logs).includes(canary));
  }
});
test("actual queue method preserves persistence return/error and captures receipt before consume", async () => {
  const real=method(transformed.get(roots[0]+assets[1]),"__azraelConsume"),logs=[],d=createUiInputDiagnostics(x=>logs.push(x));
  const Queue=vm.runInNewContext(`(class{__azraelAccepted=new Map;running=new Set;rerun=new Set;options;writes=[];failure;async #_(e,fn,n){this.writes.push(fn([{id:${JSON.stringify(id)}},{id:'next'}]));if(this.failure)throw this.failure}${real}})`,{globalThis:{__azraelUiInputDiagnostics:d}});
  const q=new Queue();q.options={wasMessageAccepted:()=>!q.__azraelAccepted.has(thread)};
  assert.equal(await q.__azraelConsume(thread,{id},"owner"),undefined);assert.equal(q.writes[0].length,1);assert.equal(logs[0].receiptAccepted,true);assert.equal(logs[0].persistenceSucceeded,true);
  const boom=Error(canary);q.failure=boom;await assert.rejects(q.__azraelConsume(thread,{id},"owner"),e=>e===boom);assert.equal(logs[1].persistenceSucceeded,false);
  q.options.wasMessageAccepted=()=>{throw boom};q.failure=null;await q.__azraelConsume(thread,{id},"owner");assert.equal(logs[2].receiptAccepted,false);assert.ok(!JSON.stringify(logs).includes(canary));
  q.disposed=true;const writes=q.writes.length;await q.__azraelConsume(thread,{id},"owner");assert.equal(q.writes.length,writes);assert.equal(logs.length,3);
});
test("actual renderer hook deduplicates unchanged suppression and logs changed reasons only", () => {
  const source=transformed.get(roots[0]+assets[2]),hook=source.slice(source.indexOf(marker),source.indexOf("if(B){",source.indexOf(marker))),logs=[],d=createUiInputDiagnostics(x=>logs.push(x)),ctx={globalThis:{__azraelUiInputDiagnostics:d},y:turn(["params","user","steering"]),F:true,I:false,B:null,__azraelHideCallback:false,__azraelInputClassified:false,__azraelLinkedSteering:false};
  vm.runInNewContext(hook,ctx);vm.runInNewContext(hook,ctx);assert.equal(logs.length,1);ctx.I=true;vm.runInNewContext(hook,ctx);assert.equal(logs.length,2);ctx.B={};vm.runInNewContext(hook,ctx);assert.equal(logs.length,2);ctx.B=null;vm.runInNewContext(hook,ctx);assert.equal(logs.length,3);
  assert.equal(logs[0].matchingUserCount,1);assert.equal(logs[0].matchingSteeringCount,1);assert.ok(!JSON.stringify(logs).includes(canary));
});
test("actual renderer suppression operands retain short-circuit order, return values and thrown exceptions", () => {
  const source=transformed.get(roots[0]+assets[2])??inject(fs.readFileSync(path.join(roots[0],assets[2]),"utf8"),assets[2],ts).text,ast=ts.createSourceFile("renderer.js",source,99,true,1);let expression;
  function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==="BS"){for(const stmt of n.body.statements)if(ts.isVariableStatement(stmt))for(const decl of stmt.declarationList.declarations)if(decl.name.getText(ast)==="I")expression=decl.initializer.getText(ast);}ts.forEachChild(n,visit)}visit(ast);assert.ok(expression);
  const declaration="let __azraelHideCallback=null,__azraelInputClassified=null,__azraelInputClassificationValue,__azraelLinkedSteering=null;";
  const body="(()=>{"+declaration+"let I="+expression+";globalThis.__azraelUiInputDiagnostics.render(y,false,I,false,__azraelHideCallback,__azraelInputClassified,__azraelLinkedSteering);return({I,callback:__azraelHideCallback,classifier:__azraelInputClassified,linked:__azraelLinkedSteering})})()";
  for(const [callback,classified,linked,expected]of [[true,true,true,[true,null,null]],[false,true,true,[false,true,null]],[false,false,true,[false,false,true]],[false,false,false,[false,false,false]]]){
    const calls=[],logs=[],y=turn();if(linked)y.items.push({type:"steeringUserMessage",clientUserMessageId:id,serverUserMessageId:"server-private-id",input:[canary]});
    const nativeSome=y.items.some;y.items.some=function(fn){calls.push("linked");return nativeSome.call(this,fn)};
    const ctx={y,_:()=>{calls.push("callback");return callback},Ol:()=>{calls.push("classifier");return classified},__azraelUiInputDiagnostics:createUiInputDiagnostics(x=>logs.push(x))};
    const result=vm.runInNewContext(body,ctx);assert.deepEqual([result.callback,result.classifier,result.linked],expected);assert.deepEqual(calls,callback?["callback"]:classified?["callback","classifier"]:["callback","classifier","linked"]);
    assert.equal(logs[0].shouldHideCallback,expected[0]);assert.equal(logs[0].inputClassifier,expected[1]);assert.equal(logs[0].linkedOpeningSteering,expected[2]);assert.ok(!JSON.stringify(logs).includes(canary));assert.ok(!JSON.stringify(logs).includes("server-private-id"));
  }
  const value={private:canary},ctx={y:turn(),_:()=>false,Ol:()=>value,__azraelUiInputDiagnostics:createUiInputDiagnostics(()=>{})};assert.equal(vm.runInNewContext(body,ctx).I,value);
  const boom=Error(canary);ctx._=()=>{throw boom};assert.throws(()=>vm.runInNewContext(body,ctx),e=>e===boom);
  ctx._=()=>false;ctx.Ol=()=>{throw boom};assert.throws(()=>vm.runInNewContext(body,ctx),e=>e===boom);
});
test("bounded rate, repeat and render caches, without timers", () => {
  let time=0;const logs=[],d=createUiInputDiagnostics(x=>logs.push(x),()=>time);
  for(let i=0;i<150;i++)d.queue(thread,id,true,true);assert.equal(logs.length,100);time=60000;d.queue(thread,id,false,false);assert.equal(logs[100].droppedCount,50);
  const log2=[],r=createUiInputDiagnostics(x=>log2.push(x),()=>time);
  for(let i=0;i<520;i++){time+=60000;const cid=`${i.toString(16).padStart(8,"0")}-1111-4111-8111-111111111111`;r.compare(thread,new Map([[cid,new Set(["params"])]]),new Map());}
  const first="00000000-1111-4111-8111-111111111111";r.compare(thread,new Map([[first,new Set(["params"])]]),new Map());assert.equal(log2.length,521);
  for(let i=0;i<260;i++){time+=60000;const t=turn();t.params.clientUserMessageId=`${i.toString(16).padStart(8,"0")}-1111-4111-8111-111111111111`;r.render(t,true,false,false);}
  const t=turn();t.params.clientUserMessageId=first;const count=log2.length;r.render(t,true,false,false);assert.equal(log2.length,count+1);
});
test("loaded-turn scan timing is bounded and recorded", () => {
  const d=createUiInputDiagnostics(()=>{}), turns=Array.from({length:100},()=>turn(["params","user","steering"]));
  const start=performance.now();for(let i=0;i<1000;i++)assert.equal(d.snapshot(()=>turns).size,1);
  console.log(`diagnostics profiler: 1000 snapshots of 100 loaded turns / 200 items: ${(performance.now()-start).toFixed(1)} ms`);
});
