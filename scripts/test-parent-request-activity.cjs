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
function productionConversation(){
 const inputs=prepared(),functions=(index,names)=>{const ast=ts.createSourceFile(inputs[index].asset,inputs[index].text,99,true);return names.map(name=>{const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(fn,name);return fn.getText(ast)}).join("\n")};
 const project=productionProjection(),context={Gi:x=>x,Nr:()=>null,bp:()=>null,hp:()=>[],gp:()=>false,Ns:(turn)=>({items:project(turn.items)}),dp:(_entry,block,presentation)=>({presentation,sourceTurnId:block.turnId,turnKey:block.key}),cp:()=>new Map};
 vm.createContext(context);
 vm.runInContext(functions(1,["ZT","azraelNativeActivityRows","QT","$T","JT"])+"\n"+functions(3,["mp","np","ap","azraelActivityKind"])+";this.projectActivities=ZT;this.workGroups=QT;this.classify=mp;this.standalone=np",context);
 return {
  rows:(items,agents=[],turnKey="parent")=>context.projectActivities({activityItems:project(items),backgroundAgentById:new Map(agents.map(a=>[a.conversationId,a])),laterActivityConversationIds:new Set,turnKey}),
  work:(items,agents=[],turnKey="parent")=>context.workGroups({activityItemGroups:[project(items)],backgroundAgents:agents,turnKey}),
  classify:turn=>context.classify(turn,false),
  standalone:(items,turnId="parent")=>{
   const turn={turnId,items,params:{input:[]}},entry={conversationId:"root",hostId:"host"};
   return context.standalone({canonical:true,baseEntriesByTurnId:new Map([[turnId,entry]]),blocks:items.map(item=>({type:"bem-item",presentation:"subagent",turnId,itemId:item.id,key:"block-"+item.id})),turnsById:new Map([[turnId,turn]]),turnPresentationContexts:new Map,showNux:false});
  }
 };
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
 const conversation=productionConversation(),a=raw("parent-request-r1","interacted",request),b={...raw("parent-request-r2","interacted",{...request,requestId:"r2"}),agentThreadId:"child-b",agentPath:"root/b"},c=raw("completed-a","completed"),d={...raw("completed-b","completed"),agentThreadId:"child-b",agentPath:"root/b"};
 check("parked child preserves decision and is not a completion",()=>{const rows=conversation.rows([a],[{conversationId:"child",parentTurnKey:"parent",status:"done"}]);assert.equal(rows.length,1);assert.equal(rows[0].parentRequestItem.parentRequest,request);assert.equal(rows[0].activityKind,"decision");assert.notEqual(rows[0].activityStatus,"done")});
 check("idle cannot manufacture completion from recorded started or progress activity",()=>{const rows=conversation.rows([raw("start","started"),a],[{conversationId:"child",parentTurnKey:"parent",status:"done"}]);assert.equal(rows[0].activityStatus,"active");assert(rows.every(r=>r.activityKind!=="completed"));const progress=conversation.rows([raw("mail")],[{conversationId:"child",parentTurnKey:"parent",status:"done"}]);assert.equal(progress[0].activityStatus,"updated")});
 check("later progress does not consume an actual completion event",()=>{const rows=conversation.rows([a,c,raw("later-mail")]);assert.equal(rows.filter(r=>r.activityKind==="completed").length,1);assert.equal(rows.filter(r=>r.activityKind==="decision").length,1);assert.equal(rows.filter(r=>r.activityKind==null).length,1)});
 check("interleaved work activities retain two requests and two explicit completions",()=>{const groups=conversation.work([a,d,b,c]);assert.equal(groups.length,1);const rows=groups[0].rows;assert.equal(rows.filter(r=>r.activityKind==="decision").length,2);assert.equal(rows.filter(r=>r.activityKind==="completed").length,2);assert.equal(rows[0].activityKind,"decision");assert.equal(rows.find(r=>r.activityKind==="completed").status,"done")});
 check("same child request followed by completion remains in both kinds",()=>{const rows=conversation.rows([a,c],[{conversationId:"child",parentTurnKey:"parent",status:"active"}]);assert.equal(rows.length,2);assert.equal(rows[0].activityKind,"decision");assert.equal(rows[1].activityKind,"completed");assert.equal(rows[1].activityStatus,"completed")});
 check("same-ID replay updates one request while different request IDs survive",()=>{const resolved={...a,parentRequest:{...request,status:"resolved"}};const rows=conversation.rows([a,{...a,id:"r3",parentRequest:{...request,requestId:"r3"}},resolved,c]);assert.equal(rows.filter(r=>r.activityKind==="decision").length,2);assert.equal(rows.find(r=>r.parentRequestItem?.parentRequest.requestId==="r1").parentRequestItem.parentRequest.status,"resolved")});
 check("BEM classifies request and actual completion as additional activities",()=>{const kinds=conversation.classify({turnId:"parent",params:{input:[]},items:[a,c]})[0].items;assert(kinds.every(x=>x.kind==="subagent"))});
 check("standalone conversation groups by kind across agents and keeps first anchors",()=>{const entries=conversation.standalone([a,d,b,c]);assert.equal(entries.length,2);assert.equal(entries[0].presentation.activityKind,"decision");assert.equal(entries[1].presentation.activityKind,"completed");assert.equal(entries[0].presentation.activityItems.length,2);assert.equal(entries[1].presentation.activityItems.length,2);assert.equal(entries[0].turnKey,"block-"+a.id);assert.equal(entries[1].turnKey,"block-"+d.id)});
 check("standalone request state updates preserve independent completion and turn scope",()=>{for(const status of ["pending","resolved","deferred","cancelled"]){const entries=conversation.standalone([{...a,parentRequest:{...request,status}},c],"old-parent");assert.equal(entries.length,2);assert.equal(entries[0].presentation.activityItems[0].parentRequest.status,status);assert(entries.every(x=>x.sourceTurnId==="old-parent"))}});
 console.log(JSON.stringify({outcome:"passed",checks,transformCounts:EXPECTED_COUNTS}));
}
module.exports={prepared,productionProjection,productionConversation};
