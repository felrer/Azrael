"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {test} = require("node:test");
const ts = require(path.resolve("extensions/azrael-ex/node_modules/typescript/lib/typescript.js"));
const {inheritThreadBranchSelection} = require("./thread-branch.cjs");
const {createProviderModelCatalog} = require("./provider-model-picker.cjs");
const {THREAD_BRANCH_ASSET:asset, THREAD_BRANCH_MARKER:marker, injectThreadBranch} = require("./inject-thread-branch.cjs");
const {transformAsset} = require("./namespace-azrael-host.cjs");
const pristine = fs.readFileSync(path.resolve("artifacts/upstream-ui/26.930.61225",asset),"utf8");
const transformed = transformAsset(pristine,asset,asset,ts);
function declarations(source,names) {
  const ast=ts.createSourceFile(asset,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),found={};
  function visit(n){if(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text))found[n.name.text]=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);
  for(const name of names)assert.ok(found[name],`pinned declaration ${name}`);
  return found;
}
const names=["QTn","tTn","nSn","tEn","$Tn","FQ","Xbn","Zbn","Ybn","Qbn","GTn"];
const originals=declarations(pristine,names),injected=declarations(transformed.text,names);
const row=(model,stages=["low","high"],defaultReasoningEffort="high")=>({model,supportedReasoningEfforts:stages.map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort});
const source=(model="managed/openrouter/next",provider="azrael-managed",effort="high")=>({conversationId:"source",modelProvider:provider,title:"Source",cwd:"/workspace",historyMode:"paginated",threadRuntimeStatus:{type:"running"},turns:[{turnId:"retained",model:"gpt-old",status:"completed"},{turnId:"later",status:"inProgress"}],latestModel:model,latestReasoningEffort:effort,latestThreadSettings:{model,effort},latestCollaborationMode:{mode:"default",settings:{model,reasoning_effort:effort}}});
function harness({original=false,src=source(),rows=[row(src.latestModel)],failResume=false,failBefore=false}={}){
  const requests=[],resumes=[],states=new Map([["source",src]]),events=[];
  const manager={requestClient:{getAppServerVersion:()=>"0.200.0"},logger:{warning(){}},getHostId:()=>"host",getConversation:id=>states.get(id),getThreadProjectAssignment:async()=>null,
    async sendRequest(method,params,options){requests.push({method,params,options});if(method==="model/list")return{data:rows,nextCursor:null};assert.equal(method,"thread/fork");return{thread:{id:"created",cwd:"/workspace",status:{type:"idle"}},cwd:"/workspace",model:params.model??"global-default",reasoningEffort:params.config?.model_reasoning_effort??null};},
    setConversation:state=>states.set(state.conversationId,state),updateConversationState:(id,fn)=>fn(states.get(id)),addForkedFromConversationSyntheticItem:(...args)=>events.push(args),
    async resumeConversationForUnavailableOwner(params){resumes.push(params);if(failResume)throw Error("resume fixture failed");return{status:"ready"};}};
  const capabilities={readTokenBudgetThread:()=>null,readConfig:async()=>({model:"global-default",model_reasoning_effort:"low"}),readPlacement:()=>({status:"ready",placement:null}),readThreadReferences:()=>undefined};
  const sharedCatalog=createProviderModelCatalog();
  const context={__azraelProviderCatalogV1:sharedCatalog,nEn:"0",rEn:"0",rSn:"0",B:x=>x,c:e=>e.message,
    C$:()=>null,S$:({responseCwd})=>responseCwd,AQ:t=>t,hbn:o=>({...o,latestModel:o.thread.model??"global-default",latestReasoningEffort:"low"}),Sr:x=>x,qbn:(n,model,effort,cwd,collaborationMode)=>({model,effort,cwd,collaborationMode}),Nh:()=>null,jyn:response=>response.thread.turns??[]};
  vm.createContext(context);
  if(!original){vm.runInContext(transformed.text.slice(transformed.text.indexOf(marker)),context);assert.equal(context.__azraelBranchCatalog,sharedCatalog,"bootstrap reuses the picker global catalog");}
  vm.runInContext(Object.values(original?originals:injected).join("\n"),context);
  return{context,manager,requests,resumes,states,events,async run(overrides={}){return context.QTn({capabilities,history:{mapThreadTurns:x=>x},hostMode:"default",compareSemanticVersions:()=>1,threadRecognition:{},manager,notificationDeferral:{run:async(_,fn)=>fn(()=>{})},params:{sourceConversationId:"source",lastTurnId:"retained",...overrides},beforeConversationAdded:failBefore?()=>{throw Error("identity fixture failed");}:undefined,workspaceStorage:{}});}};
}
test("pinned integrated transform parses; anchors, asset version, marker and idempotence are guarded",()=>{
  assert.equal(transformed.asset.threadBranchEdits,1);
  assert.equal(ts.createSourceFile(asset,transformed.text,99,true,ts.ScriptKind.JS).parseDiagnostics.length,0);
  const result=injectThreadBranch(pristine,asset);assert.equal(result.count,1);
  assert.deepEqual(injectThreadBranch(result.text,asset),{text:result.text,count:0});
  assert.deepEqual(injectThreadBranch(pristine,"webview/assets/app-initial-future.js"),{text:pristine,count:0});
  assert.throws(()=>injectThreadBranch("",asset),/anchor/);assert.throws(()=>injectThreadBranch(pristine+pristine,asset),/anchor/);
  assert.throws(()=>injectThreadBranch(result.text+marker,asset),/Duplicate/);
});
test("actual native branch sends and resumes inherited choice against a different global default",async()=>{
  for(const [model,provider] of [["gpt-native","openai"],["custom-model","custom-provider"],["managed/openrouter/next","azrael-managed"],["devin/next","devin"]]){
    const src=source(model,provider),before=structuredClone(src),h=harness({src,rows:[row(model)]}),result=await h.run();
    assert.equal(src.turns[0].status,"completed");assert.equal(src.turns[1].status,"inProgress");
    assert.equal(result.status,"created");assert.equal(result.conversationId,"created");assert.equal(result.synchronization.status,"complete");
    const request=h.requests.find(r=>r.method==="thread/fork").params;
    assert.equal(request.model,model);assert.equal(request.modelProvider,model.startsWith("managed/")||model.startsWith("devin/")?undefined:provider);
    assert.equal(request.lastTurnId,"retained");assert.equal(request.deferGoalContinuation,true);assert.equal(request.config.model_reasoning_effort,"high");assert.equal(request.excludeTurns,true);
    assert.equal(h.resumes[0].model,model);assert.equal(h.resumes[0].reasoningEffort,"high");
    assert.equal(h.states.get("created").latestThreadSettings.model,model);assert.equal(h.states.get("created").latestThreadSettings.effort,"high");assert.deepEqual(src,before);
  }
  const old=harness({original:true});await old.run();assert.equal(old.requests[0].params.model,undefined);assert.equal(old.resumes[0].model,null);
});
test("default and first supported effort, and no-stage explicit null survive actual native UI state update",async()=>{
  for(const [stages,def,expected] of [[["low","high"],"high","high"],[["low","high"],"missing","low"],[[],"high",null]]){
    const src=source("managed/anthropic/next","azrael-managed","unsupported"),h=harness({src,rows:[row(src.latestModel,stages,def)]});await h.run();
    assert.equal(h.resumes[0].reasoningEffort,expected);assert.equal(h.resumes[0].collaborationMode.settings.reasoning_effort,expected);assert.equal(h.states.get("created").latestThreadSettings.effort,expected);assert.equal(h.states.get("created").latestReasoningEffort,expected);
  }
});
test("source next choice overrides retained-turn selection; explicit choice and collaboration mode remain coherent",async()=>{
  const src=source(),h=harness({src,rows:[row("managed/openrouter/override")]});await h.run({model:"managed/openrouter/override",reasoningEffort:"low",collaborationMode:{mode:"plan",settings:{model:src.latestModel,reasoning_effort:"high"}}});
  const request=h.requests.find(r=>r.method==="thread/fork").params;assert.equal(request.model,"managed/openrouter/override");assert.equal(h.resumes[0].collaborationMode.settings.model,request.model);assert.equal(h.resumes[0].collaborationMode.settings.reasoning_effort,"low");
  const inherited=await inheritThreadBranchSelection({},src,"default",async()=>[row(src.latestModel)]);assert.equal(inherited.model,src.latestModel);assert.notEqual(inherited.model,src.turns[0].model);
});

test("serialized helper preserves click-time provider and collaboration settings during delayed discovery",async()=>{
 const h=harness(),src=source("native-click","custom-click","high");
 src.latestCollaborationMode={mode:"plan",settings:{model:"native-click",reasoning_effort:"high",developer_instructions:"click instructions"}};
 let release;const pending=h.context.__azraelInheritBranch({},src,"default",()=>new Promise(resolve=>{release=resolve;}));
 assert.equal(typeof release,"function","discovery is awaiting its catalog");
 src.modelProvider="custom-later";src.latestModel="native-later";src.latestReasoningEffort="low";
 src.latestThreadSettings.model="native-later";src.latestThreadSettings.effort="low";
 src.latestCollaborationMode.mode="default";Object.assign(src.latestCollaborationMode.settings,{model:"native-later",reasoning_effort:"low",developer_instructions:"later instructions"});
 release([row("native-click")]);const result=await pending;
 assert.equal(result.model,"native-click");assert.equal(result.modelProvider,"custom-click");assert.equal(result.reasoningEffort,"high");
 assert.equal(result.collaborationMode.mode,"plan");assert.equal(result.collaborationMode.settings.model,"native-click");assert.equal(result.collaborationMode.settings.reasoning_effort,"high");assert.equal(result.collaborationMode.settings.developer_instructions,"click instructions");
 assert.equal(src.latestCollaborationMode.settings.model,"native-later","helper does not reverse concurrent source updates");
});
test("missing helper model, catalog entry and discovery failures abort before native fork",async()=>{
  for(const options of [{src:source(undefined)},{rows:[]}]){
    if(options.src){options.src.latestModel=undefined;options.src.latestThreadSettings={};options.src.latestCollaborationMode=undefined;}
    const h=harness(options);await assert.rejects(h.run(),/원본|모델 목록/);assert.equal(h.requests.filter(r=>r.method==="thread/fork").length,0);
  }
  await assert.rejects(inheritThreadBranchSelection({},source(),"default",async()=>{throw Error("catalog unavailable");}),/catalog unavailable/);
  assert.equal(await inheritThreadBranchSelection({},null,"default",()=>{throw Error("must not discover");}) instanceof Object,true);
  const native=harness({original:true});native.manager.getConversation=()=>undefined;await assert.rejects(native.context.nSn(native.manager,{sourceConversationId:"missing"},()=>1),/Source conversation not found/);
});
test("native modern target-turn path retains lastTurnId without introducing client rollback",async()=>{
  let params;const h=harness();h.manager.forkConversationFromLatest=async p=>(params=p,{status:"created",conversationId:"created"});
  await h.context.nSn(h.manager,{sourceConversationId:"source",targetTurnId:"retained"},()=>1);assert.equal(params.lastTurnId,"retained");assert.equal(h.requests.length,0);
  assert.equal(injected.nSn,originals.nSn,"native cutoff routing remains unchanged; engine cutoff is outside this fixture");
});
test("native created ID survives identity and post-create resume setup failures",async()=>{
  for(const opts of [{failResume:true},{failBefore:true}]){const h=harness(opts),result=await h.run();assert.equal(result.status,"created");assert.equal(result.conversationId,"created");assert.equal(result.synchronization.status,"failed");assert.match(result.synchronization.message,/fixture failed/);}
});
test("non-default, ephemeral and side-conversation selection scopes retain native behavior",async()=>{
  for(const [params,mode] of [[{},"other"],[{ephemeral:true},"default"],[{sideConversation:true},"default"]])assert.equal(await inheritThreadBranchSelection(params,source(),mode,()=>{throw Error("must not discover");}),params);
});

test("absent collaboration mode produces a complete default selection and null effort",async()=>{
 const src=source("managed/google/automatic");src.latestCollaborationMode=undefined;src.latestThreadSettings={model:src.latestModel,effort:"high"};
 const result=await inheritThreadBranchSelection({},src,"default",async()=>[row(src.latestModel,[])]);
 assert.deepEqual(result.collaborationMode,{mode:"default",settings:{developer_instructions:null,model:src.latestModel,reasoning_effort:null}});assert.equal(result.deferGoalContinuation,true);
});

test("native branch UI gates preserve ordinary turns and release deferred turns",()=>{
 function expressions(relative){
  const text=fs.readFileSync(path.resolve("artifacts/upstream-ui/26.930.61225",relative),"utf8"),changed=transformAsset(text,relative,relative,ts).text;
  function extract(value){const ast=ts.createSourceFile(relative,value,99,true,ts.ScriptKind.JS),out={};function visit(n){
   if(ts.isPropertyAssignment(n)&&n.name.getText(ast)==="onForkTurnMessage"&&n.initializer.getText(ast).startsWith("!a&&"))out.readOnly=n.initializer.getText(ast);
   if(ts.isPropertyAssignment(n)&&n.name.getText(ast)==="onFork"&&n.initializer.getText(ast)==="G?void 0:de")out.turn=n.initializer.getText(ast);
   if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==="G"&&n.initializer?.getText(ast).includes("qe===`inProgress`"))out.progress=n.initializer.getText(ast);
   ts.forEachChild(n,visit);
  }visit(ast);return out;}
  const original=extract(text),transformed=extract(changed);
  const normalized={...transformed};
  if(normalized.progress)normalized.progress=normalized.progress.replace(/^y\.status===`deferred`\?false:/,"");
  assert.deepEqual(normalized,original);return transformed;
 }
 const gate=expressions("webview/assets/local-conversation-thread-8f3221bfc636.js").readOnly;assert.ok(gate);
 const callback=()=>{};for(const readOnly of [false,true])assert.equal(vm.runInNewContext(gate,{a:readOnly,H:true,W:true,it:true,gn:callback}),readOnly?undefined:callback);
 const turn=expressions("webview/assets/local-conversation-turn-4aa6f571456a.js");assert.ok(turn.progress);assert.ok(turn.turn);
 for(const [status,nativeStatus,blocked] of [["inProgress","completed",true],["completed","in_progress",false],[null,"in_progress",true],[null,"completed",false],["inProgress","deferred",false],[null,"deferred",false]]){
  const K=vm.runInNewContext(turn.progress,{qe:status,y:{status:nativeStatus}});assert.equal(K,blocked);assert.equal(vm.runInNewContext(turn.turn,{G:K,de:callback}),blocked?undefined:callback);
 }
});
