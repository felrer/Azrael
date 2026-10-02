"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {test} = require("node:test");
const {createProviderModelCatalog, renderProviderModelList} = require("./provider-model-picker.cjs");
const injection = require("./inject-provider-model-picker.cjs");
const client = fn => () => ({sendRequest: async (method, params) => { assert.equal(method,"model/list"); return fn(params); }});
const status = (providerId,state) => ({providerId,state,modelCount:0,observedAt:123});
function harness(catalog,props) {
  const states=[],refs=[],effects=[]; let index=0, refIndex=0;
  const React={useState(initial){const i=index++; if(!(i in states)) states[i]=typeof initial==="function"?initial():initial; return [states[i],value=>{states[i]=typeof value==="function"?value(states[i]):value;}];},useRef(initial){const i=refIndex++; return refs[i]??=( {current:initial});},useEffect(fn,deps){ const key=JSON.stringify(deps.map(x=>typeof x==="object"?"object":x)); const i=index++;if(effects[i]?.key!==key){effects[i]?.cleanup?.();effects[i]={key,cleanup:fn()};}}};
  const jsx=(type,props,key)=>({type,props,key});
  return {render(){index=0;refIndex=0;return renderProviderModelList(React,jsx,{Item:"item"},catalog,props);},refs,states};
}
function nodes(tree,predicate){const output=[];function visit(node){if(!node||typeof node!=="object")return;if(predicate(node))output.push(node);const children=node.props?.children;for(const child of Array.isArray(children)?children:[children])visit(child);}visit(tree);return output;}
test("complete pagination retains hidden aliases and late OpenRouter models; deduplicates",async()=>{
 const c=createProviderModelCatalog(),calls=[]; const models=Array.from({length:230},(_,i)=>({model:i<210?`alias-${i}`:`managed/openrouter/model-${i}`,hidden:i<210}));
 const result=await c.query("host-a",client(p=>{calls.push(p);const start=Number(p.cursor??0);return {data:[...models.slice(start,start+100),models[start]],nextCursor:start+100<models.length?String(start+100):null,providerCatalogs:[status("openrouter","ready")]};}),100,()=>{});
 assert.equal(result.data.length,230);assert.equal(calls.length,3);assert.ok(calls.every(p=>p.includeHidden));assert.equal(result.data[229].__azraelCatalogHost,"host-a");assert.equal(c.snapshot("host-a").loading,false);
});
test("cursor loops, invalid models, and 100-page bound reject with sanitized errors",async()=>{
 for(const fn of [()=>({data:[],nextCursor:"loop"}),()=>({data:[{model:42}],nextCursor:null}),p=>({data:[],nextCursor:String(Number(p.cursor??0)+1)})]){
  const c=createProviderModelCatalog();await assert.rejects(c.query("a",client(fn),100,()=>{}),/다시 시도/);assert.equal(c.snapshot("a").error,true);assert.equal(c.snapshot("a").loading,false);
 }
});
test("loading, shared pending request, host isolation, retry refresh only first page",async()=>{
 const c=createProviderModelCatalog();let release,calls=[];const pending=c.query("a",client(()=>new Promise(resolve=>release=resolve)),100,()=>{});
 assert.equal(c.snapshot("a").loading,true);assert.equal(c.snapshot("b").loading,false);
 const same=c.query("a",client(()=>{throw Error("must not run");}),100,()=>{});await Promise.resolve();release({data:[],nextCursor:null,providerCatalogs:[status("openrouter","stale")]});await Promise.all([pending,same]);
 let retry; const fn=client(p=>{calls.push(p);return {data:[],nextCursor:p.cursor===null?"next":null,providerCatalogs:[status("openrouter","error")]};});
 await c.query("a",fn,100,()=>{retry=c.query("a",fn,100,()=>{});});calls=[];c.retry("a");await retry;
 assert.equal(calls[0].refresh,true);assert.equal("refresh" in calls[1],false);assert.equal(c.snapshot("b").providers.length,0);
});
test("group order, duplicate display names, name and ID search, status-only groups",()=>{
 const c=createProviderModelCatalog(),options=[{id:"managed/openrouter/a",label:"Same"},{id:"devin/b",label:{props:{displayName:"Same"}}},{id:"gpt",label:"GPT"}];
 assert.deepEqual(c.groups(options,"",[status("xai","empty")]).map(g=>g.id),["openai","devin","openrouter","xai"]);
 assert.equal(c.groups(options,"same").flatMap(g=>g.options).length,2);assert.equal(c.groups(options,"OPENROUTER/A")[0].options[0].id,options[0].id);
});
test("Google Antigravity groups next to AI Studio and searches by provider and opaque ID",()=>{
 const c=createProviderModelCatalog(),options=[{id:"managed/google-antigravity/vendor/model:alias",label:"Shared"},{id:"managed/google/gemini",label:"Shared"},{id:"managed/xai/grok",label:"Grok"}];
 const groups=c.groups(options,"");
 assert.deepEqual(groups.map(g=>g.id),["google","google-antigravity","xai"]);
 assert.deepEqual(groups.map(g=>g.label),["Google AI Studio","Google Antigravity","xAI"]);
 assert.equal(c.providerFor(options[0].id),"google-antigravity");
 assert.deepEqual(c.groups(options,"ANTIGRAVITY").map(g=>g.id),["google-antigravity"]);
 assert.equal(c.groups(options,"vendor/model:alias")[0].options[0],options[0]);
 assert.deepEqual(c.groups(options,"AI Studio").map(g=>g.id),["google"]);
 const empty=c.groups([],"",[status("google-antigravity","empty"),status("google","empty")]);
 assert.deepEqual(empty.map(g=>g.id),["google","google-antigravity"]);
 assert.equal(empty[1].status.state,"empty");
});
test("selected provider expands, callbacks preserved, headings toggle and search expands",()=>{
 const c=createProviderModelCatalog();let selections=0;const original=()=>selections++;
 const h=harness(c,{options:[{id:"gpt",label:"GPT"},{id:"devin/a",label:"Devin A",selected:true}],renderOption:o=>({type:"original",props:{...o,onSelect:original}})});
 let tree=h.render();assert.equal(nodes(tree,n=>n.type==="original").length,1);nodes(tree,n=>n.type==="original")[0].props.onSelect();assert.equal(selections,1);
 nodes(tree,n=>n.props?.["data-azrael-provider"]==="openai")[0].props.onSelect({preventDefault(){}});tree=h.render();assert.equal(nodes(tree,n=>n.type==="original").length,2);
 nodes(tree,n=>n.type==="input")[0].props.onChange({target:{value:"GPT"}});tree=h.render();assert.equal(nodes(tree,n=>n.type==="original")[0].props.id,"gpt");
});
test("search keyboard ArrowDown focuses model, Escape propagates; empty message",()=>{
 const h=harness(createProviderModelCatalog(),{options:[],renderOption:o=>o});let tree=h.render(),focused=0,stopped=0,prevented=0;
 h.refs[0].current={querySelectorAll(selector){assert.equal(selector,'[data-azrael-model-option]:not([data-disabled])');return [{closest(){return {};},focus(){throw Error("hidden model focused");}},{closest(){return null;},focus(){focused++;}}];}};
 const input=nodes(tree,n=>n.type==="input")[0];input.props.onKeyDown({key:"ArrowDown",stopPropagation(){stopped++;},preventDefault(){prevented++;}});input.props.onKeyDown({key:"Escape",stopPropagation(){stopped++;}});
 assert.deepEqual([focused,stopped,prevented],[1,1,1]);assert.ok(nodes(tree,n=>n.props?.children==="표시할 모델이 없습니다.").length);
});
test("loading/stale/error/empty render status and retry callback",async()=>{
 const c=createProviderModelCatalog();await c.query("a",client(()=>({data:[],nextCursor:null,providerCatalogs:[status("openrouter","stale"),status("devin","error"),status("openai","empty")]})),100,()=>{});
 let retries=0;const proxy={...c,retry(id){assert.equal(id,"a");retries++;}};
 const h=harness(proxy,{options:[{id:"managed/openrouter/a",catalogHost:"a",label:"A"}],renderOption:o=>o});const tree=h.render();
 for(const text of ["갱신 실패 · 이전 목록","목록 조회 실패","사용 가능한 채팅 모델 없음","다시 시도"])assert.ok(nodes(tree,n=>n.props?.children===text).length,text);
 nodes(tree,n=>n.type==="button")[0].props.onClick({preventDefault(){},stopPropagation(){}});assert.equal(retries,1);
});
test("render shows loading and disables retry while host request is pending",async()=>{
 const c=createProviderModelCatalog();let release;const pending=c.query("a",client(()=>new Promise(resolve=>release=resolve)),100,()=>{});
 const h=harness(c,{options:[{id:"gpt",catalogHost:"a",label:"GPT"}],renderOption:o=>o}),tree=h.render();
 assert.ok(nodes(tree,n=>n.props?.children==="모델 목록 불러오는 중…").length);assert.equal(nodes(tree,n=>n.type==="button")[0].props.disabled,true);
 await Promise.resolve();release({data:[],nextCursor:null});await pending;
});
test("synchronous client lookup failure clears pending and allows fresh-client recovery",async()=>{
 const c=createProviderModelCatalog();await assert.rejects(c.query("a",()=>{throw Error("sync lookup failure");},100,()=>{}),/다시 시도/);
 let called=0;const result=await c.query("a",client(()=>{called++;return {data:[{model:"recovered"}],nextCursor:null};}),100,()=>{});
 assert.equal(called,1);assert.equal(result.data[0].model,"recovered");assert.equal(c.snapshot("a").error,false);
});
test("menu reopen reuses cache; session creation and manual refresh fetch once",async()=>{
 const c=createProviderModelCatalog();let calls=0,request;
 const fn=client(p=>{calls++;if(calls>1)assert.equal(p.refresh,true);return {data:[{model:"gpt"}],nextCursor:null};});
 const invalidate=()=>request=c.query("a",fn,100,invalidate);
 const first=await c.query("a",fn,100,invalidate);
 for(let i=0;i<2;i++)harness(c,{hostId:"a",options:[],renderOption:o=>o}).render();
 assert.equal(await c.query("a",fn,100,invalidate),first);assert.equal(calls,1);
 c.sessionCreated("a");await request;assert.equal(calls,2);
 await c.query("a",fn,100,invalidate);assert.equal(calls,2);
 c.retry("a");await request;assert.equal(calls,3);
});
test("session creation during discovery schedules a forced refresh",async()=>{
 const c=createProviderModelCatalog();let release,request,calls=0;
 const fn=client(p=>{calls++;if(calls===1)return new Promise(resolve=>release=resolve);assert.equal(p.refresh,true);return {data:[],nextCursor:null};});
 const invalidate=()=>request=c.query("a",fn,100,invalidate);
 const initial=c.query("a",fn,100,invalidate);await Promise.resolve();
 c.sessionCreated("a");release({data:[],nextCursor:null});await initial;await request;assert.equal(calls,2);
});
test("failed session refresh retains cached result and retry state",async()=>{
 const c=createProviderModelCatalog();let request;
 const fn=client(()=>{throw Error("failure");});
 const invalidate=()=>request=c.query("a",fn,100,invalidate);
 const initial=await c.query("a",client(()=>({data:[{model:"gpt"}],nextCursor:null})),100,invalidate);
 c.sessionCreated("a");await assert.rejects(request);assert.equal(c.snapshot("a").error,true);
 assert.equal(await c.query("a",fn,100,invalidate),initial);
});

const original=process.env.PROVIDER_PICKER_ORIGINAL||path.resolve("artifacts/upstream-ui/26.928.31416");
const ts=require(path.resolve("extensions/azrael-ex/node_modules/typescript/lib/typescript.js"));
test("pinned upstream already accepts max and ultra effort labels",()=>{
 const source=fs.readFileSync(path.join(original,injection.PROVIDER_PICKER_ASSET),"utf8");
 assert.ok(source.includes("function WC(e){return e===`none`||e===`minimal`||e===`low`||e===`medium`||e===`high`||e===`xhigh`||e===`max`||e===`ultra`"));
 const transformed=injection.injectProviderModelPicker(source,injection.PROVIDER_PICKER_ASSET).text;
 assert.ok(transformed.includes("function q_r({additionalAvailableModels:e"));
 assert.ok(transformed.includes("__azraelProviderCatalog"));
 assert.ok(transformed.includes("te=(R===void 0||R)&&(!p?.startsWith(`managed/`)||uZ(h,p).length>0)"));
});
test("actual unified native options preserve provider efforts, saving guard and completion",()=>{
 const asset=injection.PROVIDER_PICKER_ASSET,source=injection.injectProviderModelPicker(fs.readFileSync(path.join(original,asset),"utf8"),asset).text;
 const ast=ts.createSourceFile(asset,source,99,true,ts.ScriptKind.JS);let callback;
 function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==="__azraelProviderCatalog.modelEffort"){let p=n;while(p&&!ts.isArrowFunction(p))p=p.parent;callback=p;}ts.forEachChild(n,visit);}visit(ast);assert.ok(callback);
 let chosen,complete=0;const context={t:null,s:null,p:"gpt",u:"gpt",j:"high",he:(...args)=>{chosen=args;return true;},E:()=>complete++,__azraelProviderCatalog:createProviderModelCatalog()};
 const select=()=>vm.runInNewContext(callback.getText(ast),context)();
 context.t={model:"devin/a",supportedReasoningEfforts:[{reasoningEffort:"high"},{reasoningEffort:"low"}],defaultReasoningEffort:"low"};select();assert.deepEqual(chosen,["devin/a","high"]);assert.equal(complete,1);
 context.j="unsupported";select();assert.deepEqual(chosen,["devin/a","low"]);
 for(const row of [
  {model:"managed/openrouter/z-ai/glm-5.3",supportedReasoningEfforts:["low","high","max"].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:"max"},
  {model:"managed/openrouter/unknown",supportedReasoningEfforts:[]},
  {model:"managed/anthropic/claude-unknown-future",supportedReasoningEfforts:[]},
  {model:"managed/google/gemini",supportedReasoningEfforts:["low","high"].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:"high"},
  {model:"managed/google-antigravity/gemini-pro",supportedReasoningEfforts:["medium","high","max"].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:"medium"},
 ]){context.t=row;select();assert.deepEqual(chosen,[row.model,row.defaultReasoningEffort??null]);}
 context.s={isSaving:true};chosen=null;const prior=complete;select();assert.equal(chosen,null);assert.equal(complete,prior);
});
test("native React binding and unified compiled memo/key contract remain intact",()=>{
 const asset=injection.PROVIDER_PICKER_ASSET,source=injection.injectProviderModelPicker(fs.readFileSync(path.join(original,asset),"utf8"),asset).text;
 const ast=ts.createSourceFile(asset,source,99,true,ts.ScriptKind.JS),functions={};
 function visit(n){if(ts.isFunctionDeclaration(n)&&["xYi","Rea","__AzraelProviderModelList"].includes(n.name?.text))functions[n.name.text]=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);
 assert.ok(functions.xYi.includes("(0,X8.useId)"));assert.ok(functions.xYi.includes("He=c.providerGroups?(0,Z8.jsx)(__AzraelProviderModelList"));assert.ok(functions.xYi.includes("t[99]!==c||"));
 assert.ok(source.includes("if(e.type===`completed`&&e.method===`thread/start`)__azraelProviderCatalog.sessionCreated(e.hostId)"));
 assert.ok(functions.Rea.includes("t[131]!==g?"));assert.ok(functions.Rea.includes("t[131]=g"));assert.ok(functions.Rea.includes("(0,zea.c)(132)"));
 assert.ok(functions.xYi.includes('t.closest(`[data-azrael-provider-models]`)'));
 assert.ok(functions.xYi.includes('children:e.label},e.id)'));assert.ok(functions.__AzraelProviderModelList.includes('(X8,Z8.jsx,yz,__azraelProviderCatalog,props)'));
});
test("empty scoped host shows remote error, retry refreshes correct host",async()=>{
 const c=createProviderModelCatalog();let retried,calls=0;
 const failing=client(()=>{throw Error("private error");});
 const retryClient=client(p=>{calls++;assert.equal(p.refresh,true);return {data:[],nextCursor:null,providerCatalogs:[status("openrouter","empty")]};});
 await assert.rejects(c.query("remote",failing,100,()=>{retried=c.query("remote",retryClient,100,()=>{});}));
 const h=harness(c,{hostId:"remote",options:[],renderOption:o=>o});const tree=h.render();
 assert.ok(nodes(tree,n=>n.props?.children==="목록 갱신 실패 · 다시 시도해 주세요").length);
 nodes(tree,n=>n.type==="button")[0].props.onClick({preventDefault(){},stopPropagation(){}});await retried;assert.equal(calls,1);
});
test("ambiguous empty scope cannot refresh another host or register a phantom host",async()=>{
 const c=createProviderModelCatalog();let invalidated=0;
 for(const id of ["a","b"])await c.query(id,client(()=>({data:[],nextCursor:null})),100,()=>invalidated++);
 const h=harness(c,{options:[],renderOption:o=>o}),tree=h.render();assert.equal(c.singleHost(),undefined);
 const button=nodes(tree,n=>n.type==="button")[0];assert.equal(button.props.disabled,true);button.props.onClick({preventDefault(){},stopPropagation(){}});assert.equal(invalidated,0);
 const one=createProviderModelCatalog();one.snapshot(undefined);one.subscribe(undefined,()=>{})();assert.equal(one.singleHost(),undefined);one.snapshot("real");assert.equal(one.singleHost(),"real");
});
test("post-sharing tag scopes empty arrays without polluting enumerable data",()=>{
 const c=createProviderModelCatalog(),shared=[],result={data:{models:shared}};
 assert.equal(c.tag(result,"a"),result);assert.equal(shared.__azraelCatalogHost,"a");assert.deepEqual(Object.keys(shared),[]);
 c.tag(result,"b");assert.equal(shared.__azraelCatalogHost,"b");assert.equal(c.tag({data:undefined},"a").data,undefined);
 const asset=injection.PROVIDER_QUERY_ASSET,transformed=injection.injectProviderModelPicker(fs.readFileSync(path.join(original,asset),"utf8"),asset).text;
 assert.ok(transformed.includes("__azraelProviderCatalog.tag(mIe({"));assert.ok(transformed.includes("useHiddenModels:m.useHiddenModels}),i)"));
});
test("capture keyboard reaches search and refresh while skipping hidden or inert rows",()=>{
 const h=harness(createProviderModelCatalog(),{hostId:"a",options:[],renderOption:o=>o}),tree=h.render();let focused;
 const element=(id,hidden=false)=>({id,matches:selector=>id==="search"&&selector==="[data-azrael-model-search]",closest:()=>hidden?{}:null,contains:()=>false,focus(){focused=id;}});
 const search=element("search"),hidden=element("hidden",true),refresh=element("refresh"),model=element("model");
 const menu={querySelectorAll:()=>[search,hidden,refresh,model]};h.refs[0].current={closest:()=>menu};
 let stopped=0;const fire=(target,key,shiftKey=false)=>tree.props.onKeyDownCapture({target,key,shiftKey,preventDefault(){},stopPropagation(){stopped++;}});
 fire(model,"ArrowDown");assert.equal(focused,"search");fire(search,"Tab");assert.equal(focused,"refresh");fire(refresh,"ArrowDown");assert.equal(focused,"model");fire(search,"Tab",true);assert.equal(focused,"model");fire(search,"ArrowDown");assert.equal(stopped,4);fire(model,"Escape");assert.equal(stopped,4);
});
for(const asset of injection.PROVIDER_PICKER_ASSETS)test(`pinned transformation parses, idempotent, drift and duplicate anchors reject: ${asset}`,()=>{
 const source=fs.readFileSync(path.join(original,asset),"utf8"),result=injection.injectProviderModelPicker(source,asset);assert.equal(result.count,1);
 assert.equal(ts.createSourceFile(asset,result.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length,0);
 assert.deepEqual(injection.injectProviderModelPicker(result.text,asset),{text:result.text,count:0});
 assert.throws(()=>injection.injectProviderModelPicker("",asset),/anchor/);assert.throws(()=>injection.injectProviderModelPicker(source+source,asset),/anchor/);
 const out=path.resolve("artifacts/verification/provider-model-picker-transformed");fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,path.basename(asset)),result.text);
 if(asset===injection.PROVIDER_PICKER_ASSET){assert.ok(result.text.includes("he(t.model,__azraelProviderCatalog.modelEffort"));assert.ok(result.text.includes("He=c.providerGroups?"));}
});


test("managed model efforts use exact declared stages and defaults; native models retain selection",()=>{
 const c=createProviderModelCatalog();const rows=[{model:"managed/openrouter/z-ai/glm-5.3",supportedReasoningEfforts:["low","high","max"].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:"max"}];
 const efforts=c.efforts(rows,rows[0].model,()=>{throw Error("native fallback must not run");});
 assert.equal(c.selectEffort("medium",efforts,()=>"medium"),"max");
 assert.equal(c.selectEffort("low",efforts,()=>"medium"),"low");
 const unknown=c.efforts([],"managed/openrouter/unknown",()=>[]);assert.equal(unknown.length,0);assert.equal(c.selectEffort("medium",unknown,()=>"medium"),null);
 const automatic=c.efforts([{model:"managed/openrouter/auto",supportedReasoningEfforts:[{reasoningEffort:"low"}]}],"managed/openrouter/auto",()=>[]);
 assert.deepEqual(automatic.map(option=>option.reasoningEffort),["low"]);assert.equal(c.selectEffort("medium",automatic,()=>"medium"),"low");
 const anthropic=[{model:"managed/anthropic/claude-opus-5-5",supportedReasoningEfforts:["low","medium","high","xhigh","max"].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:"medium"}];
 const anthropicEfforts=c.efforts(anthropic,anthropic[0].model,()=>{throw Error("native fallback must not run");});
 assert.deepEqual(anthropicEfforts.map(option=>option.reasoningEffort),["low","medium","high","xhigh","max"]);
 assert.equal(c.selectEffort("unsupported",anthropicEfforts,()=>"high"),"medium");
 const absent=c.efforts([{model:"managed/anthropic/claude-unknown-future",supportedReasoningEfforts:[]}],"managed/anthropic/claude-unknown-future",()=>[]);
 assert.deepEqual(absent.map(option=>option.reasoningEffort),[]);assert.equal(c.selectEffort("medium",absent,()=>"medium"),null);
 const google=c.efforts([{model:"managed/google/gemini",supportedReasoningEfforts:[{reasoningEffort:"high"}],defaultReasoningEffort:"high"}],"managed/google/gemini",()=>[]);
 assert.deepEqual(google.map(option=>option.reasoningEffort),["high"]);
 const antigravity=c.efforts([{model:"managed/google-antigravity/gemini-pro",supportedReasoningEfforts:["medium","high","max"].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:"medium"}],"managed/google-antigravity/gemini-pro",()=>[]);
 assert.deepEqual(antigravity.map(option=>option.reasoningEffort),["medium","high","max"]);
 assert.equal(c.selectEffort("low",antigravity,()=>"low"),"medium");
 assert.deepEqual(c.efforts(rows,"devin/a",()=>["native"]),["native"]);assert.equal(c.selectEffort("high",[],()=>"native"),"native");
});

test("transformed reasoning choices expose declared managed slider stages and defaults",()=>{
 const asset=injection.PROVIDER_PICKER_ASSET,source=injection.injectProviderModelPicker(fs.readFileSync(path.join(original,asset),"utf8"),asset).text;
 const ast=ts.createSourceFile(asset,source,99,true,ts.ScriptKind.JS),functions={};
 function visit(n){if(ts.isFunctionDeclaration(n)&&["uZ","Hzr","E_r","D_r","__azraelReasoningLabel"].includes(n.name?.text))functions[n.name.text]=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);
 const context={__azraelProviderCatalog:createProviderModelCatalog(),WC:()=>true,LNt:["medium"],CGe:()=>"medium",Ig:value=>value,z8:{max:{defaultMessage:"Max"}}};
 vm.createContext(context);vm.runInContext(Object.values(functions).join("\n"),context);
 for(const model of ["z-ai/glm-5.3","z-ai/glm-5.3:batch","z-ai/glm-5.3-flash","z-ai/glm-5.3-flash:batch"]){
  const row={model:`managed/openrouter/${model}`,displayName:model,supportedReasoningEfforts:["low","high","max"].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:"max"};
  const options=context.uZ([row],row.model),power=context.E_r([row]);
  assert.deepEqual(Array.from(options,e=>e.reasoningEffort),["low","high","max"]);assert.equal(context.Hzr("medium",options),"max");assert.equal(power.length,3);assert.equal(power.find(e=>e.reasoningEffort==="max").model,row.model);
 }
 assert.equal(context.D_r({selectedPowerSelection:{model:"managed/openrouter/model",reasoningEffort:"xhigh"},fallbackPowerSelection:{id:"low"}}),undefined);
 const automatic=context.E_r([{model:"managed/openrouter/unknown",supportedReasoningEfforts:[]}]);assert.equal(automatic.length,0);assert.equal(context.__azraelReasoningLabel(null).defaultMessage,"Automatic");
 const anthropic={model:"managed/anthropic/claude-opus-5-5",displayName:"Opus 5.5",supportedReasoningEfforts:["low","medium","high","xhigh","max"].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:"medium"};
 assert.deepEqual(Array.from(context.uZ([anthropic],anthropic.model),e=>e.reasoningEffort),["low","medium","high","xhigh","max"]);
 assert.equal(context.Hzr("unsupported",context.uZ([anthropic],anthropic.model)),"medium");
 assert.deepEqual(Array.from(context.E_r([anthropic]),e=>e.reasoningEffort),["low","medium","high","xhigh","max"]);
 assert.deepEqual(Array.from(context.E_r([{model:"managed/anthropic/claude-unknown-future",supportedReasoningEfforts:[]}]),e=>e.reasoningEffort),[]);
 for(const row of [
  {model:"managed/google/gemini",supportedReasoningEfforts:["low","high"].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:"high"},
  {model:"managed/google-antigravity/gemini-pro",supportedReasoningEfforts:["medium","high","max"].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:"medium"},
 ]){
  const expected=row.supportedReasoningEfforts.map(option=>option.reasoningEffort);
  assert.deepEqual(Array.from(context.uZ([row],row.model),e=>e.reasoningEffort),expected);
  assert.deepEqual(Array.from(context.E_r([row]),e=>e.reasoningEffort),expected);
  assert.equal(context.Hzr("unsupported",context.uZ([row],row.model)),row.defaultReasoningEffort);
 }
});


test("actual native managed selection, power options and slider gate handle missing defaults and stages",()=>{
 const asset=injection.PROVIDER_PICKER_ASSET,source=injection.injectProviderModelPicker(fs.readFileSync(path.join(original,asset),"utf8"),asset).text;
 const ast=ts.createSourceFile(asset,source,99,true,ts.ScriptKind.JS),declarations=[];let callback,sliderGate;
 function visit(n){
  if(ts.isFunctionDeclaration(n)&&["uZ","Hzr","E_r","GJi","__azraelReasoningLabel"].includes(n.name?.text))declarations.push(n.getText(ast));
  if(ts.isCallExpression(n)&&n.expression.getText(ast)==="__azraelProviderCatalog.modelEffort"){let p=n;while(p&&!ts.isArrowFunction(p))p=p.parent;callback=p?.getText(ast);}
  if(ts.isVariableDeclaration(n)&&n.name?.getText(ast)==="te"&&n.initializer?.getText(ast).includes("uZ(h,p).length>0"))sliderGate=n.initializer.getText(ast);
  ts.forEachChild(n,visit);
 }visit(ast);assert.ok(callback,"native model-selection callback");assert.ok(sliderGate,"native slider visibility condition");
 let chosen,completed=0;
 const context={__azraelProviderCatalog:createProviderModelCatalog(),WC:e=>["none","minimal","low","medium","high","xhigh","max","ultra"].includes(e),LNt:["medium"],CGe:()=>"medium",Ig:value=>value,z8:{low:{defaultMessage:"Low"}},JJi:{low:{defaultMessage:"Low"}},t:null,s:null,p:"gpt",u:"gpt",j:"medium",R:undefined,h:[],he:(...args)=>{chosen=args;return true;},E:()=>completed++};
 vm.createContext(context);vm.runInContext(declarations.join("\n"),context);
 const rows=[
  [{model:"managed/anthropic/claude-opus-5",supportedReasoningEfforts:["low","medium","high","max"]},"medium","medium"],
  [{model:"managed/anthropic/claude-opus-5",supportedReasoningEfforts:["low","medium","high","max"]},"unsupported","low"],
  [{model:"managed/anthropic/no-medium",supportedReasoningEfforts:["high","max"]},"medium","high"],
  [{model:"managed/anthropic/invalid-default",supportedReasoningEfforts:["max","high"],defaultReasoningEffort:"medium"},"medium","max"],
  [{model:"managed/anthropic/explicit-default",supportedReasoningEfforts:["low","medium","high"],defaultReasoningEffort:"high"},"unsupported","high"],
  [{model:"managed/anthropic/explicit-default",supportedReasoningEfforts:["low","medium","high"],defaultReasoningEffort:"high"},"low","low"],
 ];
 for(const provider of ["openai","anthropic","openrouter","google","google-antigravity","xai"]){
  rows.push([{model:`managed/${provider}/empty`,supportedReasoningEfforts:[]},"high",null]);
  rows.push([{model:`managed/${provider}/omitted`},"max",null]);
  rows.push([{model:`managed/${provider}/default`,supportedReasoningEfforts:["high","max"],defaultReasoningEffort:"max"},"medium","max"]);
 }
 for(const [fixture,previous,expected] of rows){
  const row={...fixture,displayName:fixture.model};
  if(row.supportedReasoningEfforts)row.supportedReasoningEfforts=row.supportedReasoningEfforts.map(reasoningEffort=>({reasoningEffort}));
  const stages=fixture.supportedReasoningEfforts??[];
  context.t=row;context.j=previous;context.p="gpt";context.h=[row];context.R=undefined;
  const choices=context.uZ([row],row.model),power=context.E_r([row]);
  assert.deepEqual(Array.from(choices,e=>e.reasoningEffort),stages,row.model);
  assert.deepEqual(Array.from(power,e=>e.reasoningEffort),stages,row.model);
  assert.equal(context.Hzr(previous,choices),expected,row.model);
  chosen=undefined;const before=completed;vm.runInContext(callback,context)();
  assert.deepEqual(chosen,[row.model,expected],row.model);assert.equal(completed,before+1);
  assert.ok(chosen[1]===null||stages.includes(chosen[1]),"selection must not send a stale unsupported effort");
  context.p=row.model;assert.equal(vm.runInContext(sliderGate,context),stages.length>0,row.model);
  context.R=false;assert.equal(vm.runInContext(sliderGate,context),false);
 }
 context.p="gpt";context.h=[];context.R=undefined;assert.equal(vm.runInContext(sliderGate,context),true,"native slider availability is preserved");
});

test("actual native reasoning aria labels safely format null and unsupported efforts",()=>{
 const asset=injection.PROVIDER_PICKER_ASSET,source=injection.injectProviderModelPicker(fs.readFileSync(path.join(original,asset),"utf8"),asset).text;
 const ast=ts.createSourceFile(asset,source,99,true,ts.ScriptKind.JS),declarations=[];
 function visit(n){if(ts.isFunctionDeclaration(n)&&["GJi","__azraelReasoningLabel"].includes(n.name?.text))declarations.push(n.getText(ast));ts.forEachChild(n,visit);}visit(ast);
 const nativeLabel={id:"test.reasoning.low",defaultMessage:"Low"},context={JJi:{low:nativeLabel},z8:{},intl:{formatMessage(message,values){assert.ok(message,"formatMessage requires a label descriptor");assert.ok(message.id,"FormatJS requires a message id");return values?`${values.model}, locked`:message.defaultMessage;}}};
 vm.createContext(context);vm.runInContext(declarations.join("\n"),context);
 for(const effort of [null,undefined,"unsupported"]){assert.equal(context.GJi({modelLabel:"Opus 5",reasoningEffort:effort},context.intl),"Opus 5 Automatic");}
 assert.equal(context.GJi({modelLabel:"Opus 5",reasoningEffort:"low"},context.intl),"Opus 5 Low");
 assert.equal(context.GJi({modelLabel:"Opus 5",reasoningEffort:null,sliderLabel:"Custom slider label"},context.intl),"Custom slider label");
 assert.equal(context.GJi({modelLabel:"Opus 5",reasoningEffort:null,isLocked:true},context.intl),"Opus 5, locked");
});

test("native reset selects the declared OpenRouter default or first stage and has no selection without stages",()=>{
 const asset=injection.PROVIDER_PICKER_ASSET,source=injection.injectProviderModelPicker(fs.readFileSync(path.join(original,asset),"utf8"),asset).text;
 const ast=ts.createSourceFile(asset,source,99,true,ts.ScriptKind.JS);let reset;const declarations=[];
 function visit(n){if(ts.isFunctionDeclaration(n)&&["aJ","E_r","uZ"].includes(n.name?.text))declarations.push(n.getText(ast));if(ts.isVariableDeclaration(n)&&n.name?.text==="pt"&&n.initializer?.getText(ast).startsWith("aJ(ft,"))reset=n.initializer.getText(ast);ts.forEachChild(n,visit);}visit(ast);assert.ok(reset);
 const model="managed/openrouter/~openai/gpt-sol-latest",context={Ee:model,lt:{model:"gpt",defaultReasoningEffort:"medium"},__azraelProviderCatalog:createProviderModelCatalog(),Ig:value=>value,WC:()=>true};
 vm.createContext(context);vm.runInContext(declarations.join("\n"),context);
 for(const [fixture,expected] of [
  [{supportedReasoningEfforts:[{reasoningEffort:"high"},{reasoningEffort:"max"}]},"high"],
  [{supportedReasoningEfforts:[{reasoningEffort:"high"},{reasoningEffort:"max"}],defaultReasoningEffort:"max"},"max"],
  [{supportedReasoningEfforts:[]},null],
  [{},null],
 ]){
  const row={model,displayName:"GPT Sol",...fixture};
  context.et=context.uZ([row],model);context.ft=context.E_r([row]);
  assert.equal(context.et.__azraelDefaultEffort,expected);
  const selected=vm.runInContext(reset,context);
  if(expected===null){assert.equal(context.ft.length,0);assert.equal(selected,undefined);}
  else{assert.equal(selected.reasoningEffort,expected);assert.ok(context.ft.includes(selected));}
 }
});


test("paginated model discovery preserves native request priority options",async()=>{
 const catalog=createProviderModelCatalog(),calls=[],options={priority:"background"};
 await catalog.query("priority-host",()=>({sendRequest:async(method,params,requestOptions)=>{calls.push({method,params,requestOptions});return {data:[],nextCursor:params.cursor===null?"next":null};}}),100,()=>{},options);
 assert.equal(calls.length,2);for(const call of calls){assert.equal(call.method,"model/list");assert.equal(call.requestOptions,options);assert.deepEqual(call.requestOptions,{priority:"background"});}
});

test("branch catalog reads without invalidate preserve picker refresh callback",async()=>{
 const catalog=createProviderModelCatalog();let calls=0,pending;
 const fetch=client(params=>{calls++;if(calls>1)assert.equal(params.refresh,true);return {data:[{model:"managed/openrouter/branch"}],nextCursor:null};});
 const invalidate=()=>pending=catalog.query("shared-host",fetch,100,invalidate);
 const first=await catalog.query("shared-host",fetch,100,invalidate);
 assert.equal(await catalog.query("shared-host",fetch,100,undefined,{priority:"background"}),first);
 catalog.retry("shared-host");assert.ok(pending,"picker retry still invokes its callback");await pending;assert.equal(calls,2);
 await catalog.query("shared-host",fetch,100);catalog.sessionCreated("shared-host");await pending;assert.equal(calls,3);
});
