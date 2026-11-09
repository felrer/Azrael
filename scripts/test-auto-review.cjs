"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const { AUTO_REVIEW_ASSETS, injectAutoReview, azraelAutoReviewStatus } = require("./inject-auto-review.cjs");
const asset = AUTO_REVIEW_ASSETS[0], original = fs.readFileSync(path.resolve(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434"), asset), "utf8");
const transformed = injectAutoReview(original, asset, ts).text;
const parsed = new Map();
function fn(text, name) { if (!parsed.has(text)) { const f = ts.createSourceFile("ui.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS); parsed.set(text,new Map(f.statements.filter(n => ts.isFunctionDeclaration(n) && n.name).map(n => [n.name.text,n.getText(f)]))); } return parsed.get(text).get(name); }
function runtime(text) {
  const names = ["QXr", "FXr", "NXr", "K_t", "q_t", "J_t", "Y_t", "X_t", "cy", "Z_t", "Q_t", "$_t", "ly", "evt", "tvt", "nvt", "rvt", "ivt", "R_t", "z_t", "sy", "L_t", "I_t", "U_t", "W_t", "uy", "RXr", "BXr", "PXr"];
  const context = vm.createContext({ e: f => f, t: x => x, mc: () => ({ default: require("node:util").isDeepStrictEqual }), Rd:()=>({default:require("node:util").isDeepStrictEqual}) });
  vm.runInContext("var avt,ovt,svt,cvt,lvt,uvt,dvt,fvt,pvt,mvt;" + names.map(n => { const source = fn(text,n);  return source; }).join("\n") + ";uy();", context);
  Object.assign(context,{service:{state:"ready",reason:null},azraelUseAutoReviewService:()=>context.service,modelSettings:{isLoading:false,model:"gpt-5"},config:{},configPending:false,requirementsPending:false,requirements:null,fPe:{},sg:{},R7e:{},WX:{c:()=>context.memo??(context.memo=Array(24).fill(Symbol.for("react.memo_cache_sentinel")))},gh:()=>({modelSettings:context.modelSettings}),X:()=>false,Hu:query=>query===context.fPe?{data:{requirements:context.requirements},isPending:context.requirementsPending}:null,Jg:()=>[{}],m4e:()=>true,xrt:()=>({data:{config:context.config},isPending:context.configPending}),tZr:{use:()=>null},QT:x=>x});
  return context;
}
const native = runtime(transformed), plain = x => JSON.parse(JSON.stringify(x));
const config = overrides => ({ isAzraelAutoReviewSupported:true,isConfigDataPending: false, isGuardianApprovalEnabledByStatsig: false, resolvedConfig: {}, ...overrides });
test("actual shared QXr uses current service readiness across all chat providers",()=>{
  const state=runtime(transformed),read=()=>state.QXr({hostId:"local",cwdOverride:"C:/workspace"});
  assert.equal(read().isConfigDataPending,false);assert.equal(read().isAzraelAutoReviewSupported,true);
  for(const model of ["devin/session","managed/llama","api/custom","gpt-5",""]){state.modelSettings={isLoading:false,model};assert.equal(read().isAzraelAutoReviewSupported,true);assert.equal(state.FXr(read()).isGuardianModeAvailable,true)}
  state.modelSettings={isLoading:false,model:"gpt-5"};state.config={model_provider:"custom"};assert.equal(read().isAzraelAutoReviewSupported,true);
  state.config={model_provider:"openai"};assert.equal(read().isAzraelAutoReviewSupported,true);assert.equal(state.FXr(read()).isGuardianModeAvailable,true);
  state.configPending=true;assert.equal(read().isConfigDataPending,true);assert.equal(read().isAzraelAutoReviewSupported,false);
  for(const status of ["checking","unconfigured","reauthRequired","unavailable","policyBlocked","unsupported"]){state.service={state:status,reason:"Service reason"};assert.equal(read().isAzraelAutoReviewSupported,false);assert.equal(read().azraelAutoReviewReason,"Service reason");assert.equal(state.FXr(read()).isGuardianModeAvailable,false)}
  assert.equal(state.FXr(config({isAzraelAutoReviewSupported:false,isAutoReviewRequiredForSelectedModel:true,hasAuthoritativeGuardianApprovalDefault:true,isGuardianApprovalEnabledByStatsig:true})).showGuardianOption,true);
  assert.equal(state.FXr(config({isAzraelAutoReviewSupported:false,requirements:{allowedApprovalsReviewers:["guardian_subagent"]}})).availableAgentModes.length,0);
});
test("service checking leaves manual and full access available while config and policy gates remain", () => {
  const state=runtime(transformed),read=()=>state.QXr({hostId:"local",cwdOverride:"C:/workspace"});
  state.service={state:"checking",reason:"Checking service"};
  const loading=read(),modes=state.FXr(loading);
  assert.equal(loading.isConfigDataPending,false);
  assert.equal(loading.isAzraelAutoReviewSupported,false);
  assert.equal(modes.availableAgentModes.includes("auto"),true);
  assert.equal(modes.canUnlock,true);
  assert.equal(modes.isGuardianModeAvailable,false);
  state.configPending=true;assert.equal(read().isConfigDataPending,true);
  state.configPending=false;state.requirementsPending=true;assert.equal(read().isConfigDataPending,true);
  state.requirementsPending=false;state.requirements={allowedSandboxModes:["read-only"]};
  assert.equal(state.FXr(read()).canUnlock,false);
  state.requirements=null;state.service={state:"ready",reason:null};
  assert.equal(read().isAzraelAutoReviewSupported,true);
});

test("native eligibility enables local option without Statsig and preserves requirements/config/pending", () => {
  assert.equal(runtime(original).FXr(config()).isGuardianModeAvailable, false);
  const enabled = native.FXr(config()); assert.equal(enabled.isGuardianModeAvailable, true); assert.equal(enabled.configNonFullAccessMode, "auto");
  for (const resolvedConfig of [{features:{guardian_approval:false}},{"features.guardian_approval":false}]) assert.equal(native.FXr(config({resolvedConfig})).isGuardianModeAvailable,false);
  for (const requirements of [{allowedApprovalsReviewers:["user"]},{allowedSandboxModes:["read-only"]},{allowedPermissionProfiles:{":read-only":true}},{allowedApprovalPolicies:["never"]}]) assert.equal(native.FXr(config({requirements})).isGuardianModeAvailable,false);
  assert.equal(native.FXr(config({isConfigDataPending:true})).isGuardianModeAvailable,false);
  assert.equal(native.FXr(config()).showGuardianOption,true);
});
test("native defaults, preferences and Full access stay unchanged", () => {
  const a=native.FXr(config()); assert.equal(a.configNonFullAccessMode,"auto"); assert.ok(a.availableAgentModes.includes("full-access"));
  assert.equal(native.RXr(a.availableAgentModes,"full-access",null,"auto","full-access"),"full-access");
  assert.equal(native.RXr(a.availableAgentModes,"auto",null,"auto","auto"),"auto");
  const preferred=native.BXr({...a,preferredNonFullAccessMode:"guardian-approvals"}); assert.equal(preferred.validPreferredNonFullAccessMode,"guardian-approvals"); assert.equal(preferred.shouldClearPreferredNonFullAccessMode,false);
  assert.equal(native.FXr(config({resolvedConfig:{sandbox_mode:"danger-full-access",approval_policy:"never"}})).customEquivalentMode,"full-access");
});
test("original ly produces exact native reviewer payload with workspaceWrite/on-request", () => {

  assert.deepEqual(plain(native.ly("guardian-approvals",["C:/workspace"])),{activePermissionProfile:{id:":workspace",extends:null},runtimeWorkspaceRoots:["C:/workspace"],sandboxPolicy:{type:"workspaceWrite",writableRoots:["C:/workspace"],excludeSlashTmp:false,excludeTmpdirEnvVar:false,networkAccess:false},approvalPolicy:"on-request",approvalsReviewer:"guardian_subagent"});
  assert.equal(native.ly("auto",[]).approvalsReviewer,"user"); assert.equal(native.ly("full-access",[]).approvalPolicy,"never");
});

test("actual native manager freshly checks service and leaves policy fallback authoritative",async()=>{
  const managerPath=AUTO_REVIEW_ASSETS[2],source=fs.readFileSync(path.resolve(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434"), managerPath),"utf8"),result=injectAutoReview(source,managerPath,ts);
  const f=ts.createSourceFile("manager.js",result.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),methods=[];
  function visit(n){if(ts.isMethodDeclaration(n)&&n.name?.getText(f)==="sendRequest"&&n.getText(f).includes("azraelReviewer"))methods.push(n);ts.forEachChild(n,visit)}visit(f);
  assert.equal(methods.length,1);
  const Native=vm.runInNewContext("(class{"+methods[0].getText(f)+"})"),manager=new Native(),calls=[];
  manager.assertActive=()=>{};manager.getConversation=()=>({latestThreadSettings:{approvalsReviewer:"guardian_subagent",approvalPolicy:"on-request",permissions:":workspace"}});
  let serviceState="ready";
  manager.requestClient={sendRequest:async(method,params)=>{calls.push({method,params});return method==="azrael/account"?{state:{serviceAccount:{state:serviceState}}}:{ok:true}}};
  const request={threadId:"thread",model:"devin/session",approvalPolicy:"on-request",permissions:":workspace",sandboxPolicy:{type:"workspaceWrite",writableRoots:["C:/workspace"],networkAccess:false},input:[{type:"text",text:"next turn"}]};
  for(const method of ["thread/start","thread/resume","turn/start"])for(const state of ["ready","unconfigured","reauthRequired","policyBlocked"]){
    calls.length=0;serviceState=state;const params={...request,model:"managed/anthropic/claude",approvalsReviewer:"guardian_subagent"};
    await manager.sendRequest(method,params);assert.deepEqual(plain(calls),[{method:"azrael/account",params:{action:"list"}},{method,params}]);
    assert.equal(params.approvalPolicy,"on-request");assert.equal(params.approvalsReviewer,"guardian_subagent");
  }
  calls.length=0;await manager.sendRequest("turn/start",request);assert.equal(calls[0].method,"azrael/account");assert.deepEqual(plain(calls[1].params),request);
  for(const params of [{...request,approvalsReviewer:"user"},{...request,approvalsReviewer:"user",approvalPolicy:"never"}]){calls.length=0;await manager.sendRequest("turn/start",params);assert.deepEqual(plain(calls),[{method:"turn/start",params}]);}
  calls.length=0;manager.requestClient.sendRequest=async(method,params)=>{calls.push({method,params});if(method!=="azrael/account")throw Error("Reviewer user denied by guardian-only requirements");return{state:{serviceAccount:{state:"unavailable"}}}};
  await assert.rejects(manager.sendRequest("turn/start",request),/guardian-only requirements/);assert.equal(calls.length,2);assert.deepEqual(plain(calls[1].params),request);
  manager.requestClient.sendRequest=async()=>{throw Error("Native service transport disconnected")};await assert.rejects(manager.sendRequest("turn/start",request),/disconnected/);
  manager.requestClient.sendRequest=async()=>({state:{}});await assert.rejects(manager.sendRequest("turn/start",request),/Update the Azrael engine/);
  assert.equal(injectAutoReview(result.text,managerPath,ts).count,0);assert.throws(()=>injectAutoReview(result.text.replace("azraelReviewer===","azraelReviewer!=="),managerPath,ts));
});

test("service status fails closed for old engines and preserves safe native reasons",()=>{
  assert.equal(azraelAutoReviewStatus({}).state,"unsupported");assert.equal(azraelAutoReviewStatus({state:{serviceAccount:{state:"invalid"}}}).state,"unsupported");
  for(const state of ["unconfigured","checking","reauthRequired","unavailable","policyBlocked"]){const status=azraelAutoReviewStatus({state:{serviceAccount:{state}}});assert.equal(status.state,state);assert.ok(status.reason)}
  assert.deepEqual(azraelAutoReviewStatus({state:{serviceAccount:{state:"ready",reason:"ignored"}}}),{state:"ready",reason:null});
  assert.equal(azraelAutoReviewStatus({state:{serviceAccount:{state:"unavailable",reason:"No eligible OpenAI reviewer model"}}}).reason,"No eligible OpenAI reviewer model");
});

test("native dropdown keeps the unavailable reason reachable even with one policy-permitted mode",()=>{
  const asset=AUTO_REVIEW_ASSETS[1],source=fs.readFileSync(path.resolve(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname,"../artifacts/upstream-ui/26.1007.21434"),asset),"utf8");
  const result=injectAutoReview(source,asset,ts),file=ts.createSourceFile("dropdown.js",result.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const owner=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="yn");let disabled;
  function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(file)==="wt")disabled=n.initializer.getText(file);ts.forEachChild(n,visit)}visit(owner);
  const check=vm.runInNewContext("(it,gt,Ct,we,Je)=>"+disabled);
  assert.equal(check(false,false,1,[],null),false);
  assert.equal(check(false,false,0,[],null),false);
  assert.equal(check(true,false,1,[],null),true);
  assert.equal(check(false,true,1,[],null),true);
  assert.equal(injectAutoReview(result.text,asset,ts).count,0);
});

test("actual service hook invalidates on account change, ignores stale responses, and disposes",async()=>{
  let state,effect,listener,dispose=0,removed=0,requests=[],focus;
  const React={useState:init=>{state??=init();return[state,next=>{state=next}]},useEffect:fn=>{effect=fn}};
  const rpc={subscribe:options=>{listener=options.listener;return{onRpcBroken(){},[Symbol.dispose](){dispose++}}},sendRequest:(method,params)=>new Promise(resolve=>requests.push({method,params,resolve}))};
  const context=vm.createContext({tZr:React,Ou:()=>({}),$:null,Px:()=>rpc,Symbol,addEventListener:(name,fn)=>{focus=fn},removeEventListener:()=>{removed++}});
  vm.runInContext(fn(transformed,"azraelAutoReviewStatus")+";"+fn(transformed,"azraelUseAutoReviewService"),context);
  context.azraelUseAutoReviewService("local");const cleanup=effect();assert.equal(state.state,"checking");assert.equal(requests[0].method,"azrael/account");
  requests[0].resolve({state:{serviceAccount:{state:"ready"}}});await new Promise(setImmediate);assert.equal(state.state,"ready");
  listener();assert.equal(state.state,"checking");focus();requests[2].resolve({state:{serviceAccount:{state:"reauthRequired"}}});await new Promise(setImmediate);
  requests[1].resolve({state:{serviceAccount:{state:"ready"}}});await new Promise(setImmediate);assert.equal(state.state,"reauthRequired");
  listener();cleanup();requests[3].resolve({state:{serviceAccount:{state:"ready"}}});await new Promise(setImmediate);assert.equal(state.state,"checking");assert.equal(dispose,1);assert.equal(removed,1);
});
module.exports = { fn, runtime };
