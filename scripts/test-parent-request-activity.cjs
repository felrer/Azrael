"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {ASSETS,EDITS,HELPER,EXPECTED_COUNTS,injectParentRequestActivity}=require("./inject-parent-request-activity.cjs");
const root=path.resolve(__dirname,".."),ts=require(require.resolve("typescript",{paths:[path.join(root,"extensions/azrael-ex")]}));
function prepared(){return ASSETS.map(asset=>({asset,source:fs.readFileSync(path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT??path.join(root,"artifacts/upstream-ui/26.1007.21434"),asset),"utf8")})).map(x=>({...x,...injectParentRequestActivity(x.source,x.asset)}))}
function productionProjection(){
 const source=prepared()[0].text,ast=ts.createSourceFile("projection.js",source,99,true),names=["nC","ZS","Syt"],functions=names.map(name=>{const f=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(f,name);return f.getText(ast)}).join("\n");
 // Adapt only unrelated turn services. Execute the complete native nC, not a
 // duplicate of the parent-request case or a fixture projection.
 const context={svt:()=>[],D_t:()=>({replyItemIds:new Set}),z_t:()=>({}),Cl:()=>true,OMe:()=>null,IDe:()=>null,Pyt:{default:()=>null},tC:x=>x,Qit:()=>"in_progress",Cyt:({items})=>items,k_t:()=>false,H_t:()=>[],wp:x=>x};
 vm.createContext(context);vm.runInContext(functions+";this.project=nC",context);
 return items=>context.project({items,status:"inProgress",params:{input:[]},hookRuns:[]},[],{includeAeonProjection:false,includeTurnDiff:false}).items;
}
if(require.main===module){let checks=0;const check=(name,fn)=>{fn();checks++;console.log("PASS "+name)};
 for(const p of prepared()){
  check("exact count and syntax "+p.asset,()=>{assert.equal(p.count,EXPECTED_COUNTS[p.asset]);assert.equal(ts.createSourceFile(p.asset,p.text,99,true).parseDiagnostics.length,0)});
  check("verified idempotency "+p.asset,()=>assert.deepEqual(injectParentRequestActivity(p.text,p.asset),{text:p.text,count:0}));
  for(const [anchor]of EDITS[p.asset])for(const mode of ["missing","duplicate"])check(mode+" anchor fails closed",()=>assert.throws(()=>injectParentRequestActivity(mode==="missing"?p.source.replace(anchor,"changed"):p.source+anchor,p.asset),/exactly once/));
  check("tampered transformed body fails closed",()=>assert.throws(()=>injectParentRequestActivity(p.text.replace(EDITS[p.asset][0][1],"changed"),p.asset),/damaged/));
 }
 const project=productionProjection(),request={requestId:"r1",status:"pending",question:"<script>evil()</script>",context:"context",recommendation:"recommendation",blockedAction:"blocked",response:null,createdAtMs:1,updatedAtMs:1};
 const raw=(id,kind="interacted",parentRequest)=>({id,type:"subAgentActivity",kind,agentThreadId:"child",agentPath:"root/curie",...(parentRequest?{parentRequest}:{})});
 check("native nC retains separate same-agent requests and exact payload",()=>{const rows=project([raw("parent-request-r1","interacted",request),raw("parent-request-r2","interacted",{...request,requestId:"r2"})]);assert.equal(rows.length,2);assert.equal(rows[0].parentRequest,request);assert.equal(rows[0].isMessage,true);assert.notEqual(rows[0].id,rows[1].id);assert.equal(rows[0].displayName,"Curie")});
 check("ordinary reports and completion rows retain native projection",()=>{const rows=project([raw("report"),raw("complete","completed")]);assert.equal(rows[0].isMessage,true);assert.equal(rows[1].displayStatus,"completed");assert(rows.every(x=>!("parentRequest"in x)))});
 check("request details render only React text with no response controls",()=>{assert(!/dangerouslySetInnerHTML|innerHTML|postMessage|fetch\(|input|textarea/.test(HELPER));assert(HELPER.includes("aria-expanded"));assert(HELPER.includes("p.response?.retryCondition"))});
 check("dynamic names and detail values have separate content typography",()=>{assert(HELPER.includes('className:"font-content",children:n.displayName'));assert(HELPER.includes('className:"font-content whitespace-pre-wrap break-words"'));assert(HELPER.includes('aE.jsx("span",{children:labels[p.status]??labels.pending})'))});
 console.log(JSON.stringify({outcome:"passed",checks,transformCounts:EXPECTED_COUNTS}));
}
module.exports={prepared,productionProjection};
