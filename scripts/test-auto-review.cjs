"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const { AUTO_REVIEW_ASSETS, MARKER, injectAutoReview } = require("./inject-auto-review.cjs");
const asset = AUTO_REVIEW_ASSETS[0], original = fs.readFileSync(path.resolve(__dirname, "../artifacts/upstream-ui/26.930.61225", asset), "utf8");
const transformed = injectAutoReview(original, asset, ts).text;
const parsed = new Map();
function fn(text, name) { if (!parsed.has(text)) { const f = ts.createSourceFile("ui.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS); parsed.set(text,new Map(f.statements.filter(n => ts.isFunctionDeclaration(n) && n.name).map(n => [n.name.text,n.getText(f)]))); } return parsed.get(text).get(name); }
function runtime(text) {
  const names = ["ZSr", "FSr", "NSr", "qft", "Jft", "Yft", "Xft", "Ky", "qy", "Jy", "Zft", "Qft", "Yy", "$ft", "ept", "tpt", "Xy", "npt", "zft", "Bft", "Gy", "Rft", "Lft", "Wft", "Gft", "Zy", "BSr", "USr", "PSr"];
  const context = vm.createContext({ e: f => f, t: x => x, ma: () => ({ default: require("node:util").isDeepStrictEqual }) });
  vm.runInContext("var rpt,ipt,apt,opt,spt,cpt,lpt,upt,dpt;" + names.map(n => { const source = fn(text,n); assert.ok(source, n); return source; }).join("\n") + ";Zy();", context);
  Object.assign(context,{modelSettings:{isLoading:false,model:"gpt-5"},config:{},configPending:false,requirementsPending:false,requirements:null,mm:{},Tm:{},kY:{c:()=>context.memo??(context.memo=Array(21).fill(Symbol.for("react.memo_cache_sentinel")))},wh:()=>({modelSettings:context.modelSettings}),q:()=>false,Qd:query=>query===context.mm?{data:{requirements:context.requirements},isPending:context.requirementsPending}:null,gm:()=>[{}],e9e:()=>true,LWe:()=>({data:{config:context.config},isPending:context.configPending}),eCr:{use:()=>null}});
  return context;
}
const native = runtime(transformed), plain = x => JSON.parse(JSON.stringify(x));
const config = overrides => ({ isAzraelAutoReviewSupported:true,isConfigDataPending: false, isGuardianApprovalEnabledByStatsig: false, resolvedConfig: {}, ...overrides });
test("typed pinned transform changes only FSr rollout declaration and rejects corruption", () => {
  assert.ok(transformed.replace(MARKER, "").replace(fn(transformed,"FSr"), fn(original,"FSr")).replace(fn(transformed,"ZSr"),fn(original,"ZSr")) === original);
  assert.equal(injectAutoReview(transformed, asset, ts).count, 0);
  assert.deepEqual(injectAutoReview(original, "other.js", ts), {text: original, count: 0});
  for (const text of [original + MARKER, transformed + MARKER, original.replace("u=i||r||a", "u=r"), original.replace("function FSr(", "function changed("), transformed.replace(fn(transformed,"FSr"),fn(transformed,"FSr").replace("u=z", "u=!0")), original.replace("l=Xy(n??void 0)??!0", "l=!0"),original.replace("let I=m||h||g||A||T||F,","let I=T,"),transformed.replace("isAzraelAutoReviewSupported:!I","isAzraelAutoReviewSupported:!0")]) assert.throws(() => injectAutoReview(text,asset,ts));
  const dropdownPath=AUTO_REVIEW_ASSETS[1],dropdown=fs.readFileSync(path.resolve(__dirname,"../artifacts/upstream-ui/26.930.61225",dropdownPath),"utf8"),result=injectAutoReview(dropdown,dropdownPath,ts);
  assert.equal(result.count,1);assert.equal(injectAutoReview(result.text,dropdownPath,ts).count,0);
  assert.ok(result.text.replace(MARKER,"").replace(fn(result.text,"wn"),fn(dropdown,"wn"))===dropdown);
  assert.throws(()=>injectAutoReview(result.text.replace("bt&&!azraelPreserveGuardian&&pt(null)","bt&&pt(null)"),dropdownPath,ts));
  assert.throws(()=>injectAutoReview(dropdown+MARKER,dropdownPath,ts));
});
test("actual shared ZSr tracks provider/model switches without stale memo and ignores rollout-only pending",()=>{
  const state=runtime(transformed),read=()=>state.ZSr({hostId:"local",cwdOverride:"C:/workspace"});
  assert.equal(read().isConfigDataPending,false);assert.equal(read().isAzraelAutoReviewSupported,true);
  for(const modelSettings of [{isLoading:false,model:"devin/session"},{isLoading:false,model:"managed/llama"},{isLoading:true,model:"gpt-5"},{isLoading:false,model:""},{model:"gpt-5"}]){state.modelSettings=modelSettings;assert.equal(read().isAzraelAutoReviewSupported,false);assert.equal(state.FSr(read()).isGuardianModeAvailable,false)}
  state.modelSettings={isLoading:false,model:"gpt-5"};state.config={model_provider:"custom"};assert.equal(read().isAzraelAutoReviewSupported,false);
  state.config={model_provider:"openai"};assert.equal(read().isAzraelAutoReviewSupported,true);assert.equal(state.FSr(read()).isGuardianModeAvailable,true);
  state.configPending=true;assert.equal(read().isConfigDataPending,true);assert.equal(read().isAzraelAutoReviewSupported,false);
  assert.equal(state.FSr(config({isAzraelAutoReviewSupported:false,isAutoReviewRequiredForSelectedModel:true,hasAuthoritativeGuardianApprovalDefault:true,isGuardianApprovalEnabledByStatsig:true})).showGuardianOption,false);
  assert.equal(state.FSr(config({isAzraelAutoReviewSupported:false,requirements:{allowedApprovalsReviewers:["guardian_subagent"]}})).availableAgentModes.length,0);
});
test("native eligibility enables local option without Statsig and preserves requirements/config/pending", () => {
  assert.equal(runtime(original).FSr(config()).isGuardianModeAvailable, false);
  const enabled = native.FSr(config()); assert.equal(enabled.isGuardianModeAvailable, true); assert.equal(enabled.configNonFullAccessMode, "auto");
  for (const resolvedConfig of [{features:{guardian_approval:false}},{"features.guardian_approval":false}]) assert.equal(native.FSr(config({resolvedConfig})).isGuardianModeAvailable,false);
  for (const requirements of [{allowedApprovalsReviewers:["user"]},{allowedSandboxModes:["read-only"]},{allowedPermissionProfiles:{":read-only":true}},{allowedApprovalPolicies:["never"]}]) assert.equal(native.FSr(config({requirements})).isGuardianModeAvailable,false);
  assert.equal(native.FSr(config({isConfigDataPending:true})).isGuardianModeAvailable,false);
  assert.equal(native.FSr(config()).showGuardianOption,true);
});
test("native defaults, preferences and Full access stay unchanged", () => {
  const a=native.FSr(config()); assert.equal(a.configNonFullAccessMode,"auto"); assert.ok(a.availableAgentModes.includes("full-access"));
  assert.equal(native.BSr(a.availableAgentModes,"full-access",null,"auto","full-access"),"full-access");
  assert.equal(native.BSr(a.availableAgentModes,"auto",null,"auto","auto"),"auto");
  const preferred=native.USr({...a,preferredNonFullAccessMode:"guardian-approvals"}); assert.equal(preferred.validPreferredNonFullAccessMode,"guardian-approvals"); assert.equal(preferred.shouldClearPreferredNonFullAccessMode,false);
  assert.equal(native.FSr(config({resolvedConfig:{sandbox_mode:"danger-full-access",approval_policy:"never"}})).customEquivalentMode,"full-access");
});
test("original Yy produces exact native reviewer payload with workspaceWrite/on-request", () => {
  assert.equal(fn(original,"Yy"),fn(transformed,"Yy"));
  assert.deepEqual(plain(native.Yy("guardian-approvals",["C:/workspace"])),{activePermissionProfile:{id:":workspace",extends:null},runtimeWorkspaceRoots:["C:/workspace"],sandboxPolicy:{type:"workspaceWrite",writableRoots:["C:/workspace"],excludeSlashTmp:false,excludeTmpdirEnvVar:false,networkAccess:false},approvalPolicy:"on-request",approvalsReviewer:"guardian_subagent"});
  assert.equal(native.Yy("auto",[]).approvalsReviewer,"user"); assert.equal(native.Yy("full-access",[]).approvalPolicy,"never");
});
test("production namespace integration runs the registered guarded transform", () => {
  const { transformAsset } = require("./namespace-azrael-host.cjs");
  const result = transformAsset(original, asset, asset, ts);
  assert.ok(result.text.includes(MARKER),"Namespace must register auto-review injector");
});
test("actual native manager atomically submits next-turn reviewer; rejection propagates",async()=>{
  const managerPath=AUTO_REVIEW_ASSETS[2],source=fs.readFileSync(path.resolve(__dirname,"../artifacts/upstream-ui/26.930.61225",managerPath),"utf8"),result=injectAutoReview(source,managerPath,ts);
  assert.equal(injectAutoReview(result.text,managerPath,ts).count,0);
  const f=ts.createSourceFile("manager.js",result.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),methods=[];
  function visit(n){if(ts.isMethodDeclaration(n)&&n.name?.getText(f)==="sendRequest"&&n.getText(f).includes("azraelSupported"))methods.push(n);ts.forEachChild(n,visit)}visit(f);assert.equal(methods.length,1);
  const Native=vm.runInNewContext(`(class{${methods[0].getText(f)}})`),manager=new Native(),calls=[];
  manager.assertActive=()=>{};manager.getConversation=()=>({latestModel:"gpt-5",modelProvider:"openai",latestThreadSettings:{approvalsReviewer:"guardian_subagent",approvalPolicy:"on-request",permissions:":workspace"}});
  manager.requestClient={sendRequest:async(method,params)=>{calls.push({method,params});return{ok:true}}};
  const request={threadId:"thread",model:"devin/session",approvalPolicy:"on-request",permissions:":workspace",sandboxPolicy:{type:"workspaceWrite",writableRoots:["C:/workspace"],networkAccess:false},input:[{type:"text",text:"next turn"}]};
  await manager.sendRequest("turn/start",request);assert.deepEqual(plain(calls),[{method:"turn/start",params:{...request,approvalsReviewer:"user"}}]);
  assert.equal(request.approvalsReviewer,undefined);assert.ok(!calls.some(c=>c.method==="turn/settings/update"));
  for(const method of ["thread/start","thread/resume"]){calls.length=0;await manager.sendRequest(method,{...request,model:"managed/llama",approvalsReviewer:"guardian_subagent"});assert.equal(calls.length,1);assert.deepEqual(plain(calls[0].params),{...request,model:"managed/llama",approvalsReviewer:"user"})}
  calls.length=0;await manager.sendRequest("turn/start",{...request,model:"gpt-5"});assert.equal(calls.length,1);assert.equal(calls[0].method,"turn/start");
  calls.length=0;await manager.sendRequest("turn/start",{...request,model:"gpt-5",collaborationMode:{settings:{model:"devin/session"}},approvalsReviewer:"guardian_subagent"});assert.equal(calls[0].params.approvalsReviewer,"user");
  calls.length=0;await manager.sendRequest("turn/start",{...request,model:"devin/session",collaborationMode:{settings:{model:"gpt-5"}},approvalsReviewer:"guardian_subagent"});assert.equal(calls[0].params.approvalsReviewer,"guardian_subagent");
  calls.length=0;await manager.sendRequest("turn/start",{...request,model:"gpt-5",modelProvider:"custom"});assert.equal(calls[0].method,"turn/start");assert.equal(calls[0].params.approvalsReviewer,"user");
  calls.length=0;manager.requestClient.sendRequest=async(method,params)=>{calls.push({method,params});throw Error("Reviewer user denied by guardian-only requirements")};
  await assert.rejects(manager.sendRequest("turn/start",request),/guardian-only requirements/);assert.equal(calls.length,1);assert.equal(calls[0].method,"turn/start");
  assert.throws(()=>injectAutoReview(result.text.replace("if(!azraelSupported)t=","if(azraelSupported)t="),managerPath,ts));
});
module.exports = { fn, runtime };
