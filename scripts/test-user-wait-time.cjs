"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ui=require('./inject-user-wait-time.cjs'),deferred=require('./inject-deferred-turn.cjs');
const ts=require(require.resolve('typescript',{paths:[path.join(__dirname,'../extensions/azrael-ex')]}));
const root=path.join(__dirname,'../artifacts/upstream-ui/26.1007.21434');
const request=(overrides={})=>({requestId:'request-1',callId:'call-1',kind:'commandApproval',startedAtMs:1000,endedAtMs:null,durationMs:null,...overrides});
const timing=(revision=1,requests=[request()],blockedIntervals=[])=>({revision,requests,blockedIntervals});
test('request boundaries tick independently and terminal response, denial and cancellation remain frozen',()=>{
 assert.equal(ui.azraelUserWaitLabel(request(),134000),'응답 대기 2분 13초');
 const ended=request({endedAtMs:134000,durationMs:133000});
 assert.equal(ui.azraelUserWaitLabel(ended,900000),'응답까지 2분 13초');
 assert.equal(ui.azraelUserWaitLabel(null,900000),null);
});
test('request IDs take precedence; call and kind fallback must be unambiguous',()=>{
 const t=timing(1,[request(),request({requestId:'other',callId:'call-2'})]);
 assert.equal(ui.azraelUserWaitRequest(t,{requestId:'other',callId:'call-1',kind:'commandApproval'}).requestId,'other');
 assert.equal(ui.azraelUserWaitRequest(t,{callId:'call-1',kind:'commandApproval'}).requestId,'request-1');
 assert.equal(ui.azraelUserWaitRequest(t,{callId:'call-1'}),null);
 assert.equal(ui.azraelUserWaitRequest(timing(1,[request(),request({requestId:'duplicate'})]),{callId:'call-1',kind:'commandApproval'}),null);
});
test('composer matches native effective identity, never the unrelated JSONRPC envelope or another turn',()=>{
 const turn={turnId:'turn',userWaitTiming:timing(1,[request()])};
 assert.equal(ui.azraelUserWaitTurn([turn],{type:'approval',item:{type:'exec',approvalRequestId:'rpc-42',azraelWaitIdentity:{requestId:'request-1',callId:'call-1',kind:'commandApproval'}}}).turnId,'turn');
 assert.equal(ui.azraelUserWaitTurn([turn,turn],{type:'approval',item:{azraelWaitIdentity:{requestId:'request-1'}}}),null);
 const mcp={turnId:'mcp',userWaitTiming:timing(1,[request({requestId:'mcp:server:"request-1"',kind:'elicitation'})])};
 assert.equal(ui.azraelUserWaitTurn([mcp],{type:'mcpServerElicitation',requestId:'rpc-100',request:{params:{userWaitRequestId:'mcp:server:"request-1"'}}}).turnId,'mcp');
 assert.equal(ui.azraelUserWaitTurn([mcp],{type:'mcpServerElicitation',requestId:'rpc-100',request:{params:{}}}),null);
});
test('revision merge rejects stale/malformed input and cannot reopen a terminal request or interval',()=>{
 const closed=timing(3,[request({endedAtMs:134000,durationMs:133000})],[{startedAtMs:1000,endedAtMs:134000}]);
 assert.equal(ui.azraelMergeUserWaitTiming(closed,timing(2)),closed);
 assert.equal(ui.azraelMergeUserWaitTiming(closed,{...timing(4),requests:[request({startedAtMs:NaN})]}),closed);
 const updated=ui.azraelMergeUserWaitTiming(closed,timing(4,[request()],[{startedAtMs:1000,endedAtMs:null}]));
 assert.equal(updated.requests[0].endedAtMs,134000);assert.equal(updated.blockedIntervals[0].endedAtMs,134000);
 assert.equal(ui.azraelMergeUserWaitTiming(closed,timing(4,[request({startedAtMs:2000})])),closed);
 assert.equal(ui.azraelMergeUserWaitTiming(null,null),null);
 const origin={...closed,startedAtMs:900};
 assert.equal(ui.azraelMergeUserWaitTiming(origin,{...timing(4),startedAtMs:901}),origin);
 assert.equal(ui.azraelMergeUserWaitTiming(origin,timing(4)).startedAtMs,900);
 assert.equal(ui.azraelMergeUserWaitTiming(closed,{...timing(2),startedAtMs:900}).startedAtMs,900);
});
test('new background approval keeps its original completed turn and cannot alter earlier closed boundaries',()=>{
 const old=request({endedAtMs:3000,durationMs:2000});
 const blocked=[{startedAtMs:1000,endedAtMs:3000}];
 const closed=timing(3,[old],blocked);
 const late=request({requestId:'late',callId:'late-call',startedAtMs:5000});
 const next=ui.azraelMergeUserWaitTiming(closed,timing(4,[old,late],blocked));
 const turn={turnId:'original',status:'completed',durationMs:4000,userWaitTiming:next};
 const match=ui.azraelUserWaitTurn([turn,{turnId:'current'}],{item:{azraelWaitIdentity:{requestId:'late'}}});
 assert.equal(match.turnId,'original');assert.equal(match.status,'completed');assert.equal(match.durationMs,4000);
 assert.equal(ui.azraelUserWaitLabel(ui.azraelUserWaitRequest(next,{requestId:'late'}),7000),'응답 대기 2초');
 const answered=ui.azraelMergeUserWaitTiming(next,timing(5,[old,{...late,endedAtMs:8000,durationMs:3000}],blocked));
 assert.deepEqual(answered.blockedIntervals,blocked);assert.deepEqual(answered.requests[0],old);
 assert.equal(ui.azraelUserWaitLabel(ui.azraelUserWaitRequest(answered,{requestId:'late'}),99000),'응답까지 3초');
});
const preparers={
 [ui.REDUCER]:deferred.injectDeferredTurn,
 [ui.PRESENTATION]:deferred.injectDeferredPresentation,
 [ui.APPROVAL]:deferred.injectDeferredRendererNotification,
 [ui.TURN]:deferred.injectDeferredTurnView,
 [ui.PENDING]:text=>({text}),
 ['out/extension.js']:deferred.injectDeferredHostNotification,
};
for(const [asset,prepare] of Object.entries(preparers))test(asset+' exact pinned transform, parse, repeat and damage guards',()=>{
 const pristine=fs.readFileSync(path.join(root,asset),'utf8'),source=prepare(pristine).text;
 const out=ui.injectUserWaitTime(source,asset);assert.equal(out.count,1);
 assert.deepEqual(ts.createSourceFile(asset,out.text,99,true,ts.ScriptKind.JS).parseDiagnostics,[]);
 assert.equal(ui.injectUserWaitTime(out.text,asset).count,0);
 assert.throws(()=>ui.injectUserWaitTime(out.text.replace(ui.MARKER,''),asset),/damaged/);
 assert.throws(()=>ui.injectUserWaitTime(out.text.replace(ui.MARKER,ui.MARKER+ui.MARKER),asset),/damaged/);
 assert.throws(()=>ui.injectUserWaitTime(out.text.replace('azrael-user-wait-check:','azrael-user-wait-check-damaged:'),asset),/damaged/);
 const check=[...out.text.matchAll(/\/\*azrael-user-wait-check:([A-Za-z0-9+/=]+)\*\//g)][0];
 const segment=Buffer.from(check[1],'base64').toString();
 assert.throws(()=>ui.injectUserWaitTime(out.text.replace(segment,segment.slice(0,-1)+'!'),asset));
});
test('native update owner applies queued timing after restoration, never allocates a placeholder turn',()=>{
 const source=deferred.injectDeferredTurn(fs.readFileSync(path.join(root,ui.REDUCER),'utf8')).text;
 const out=ui.injectUserWaitTime(source,ui.REDUCER).text;
 const ast=ts.createSourceFile('reducer',out,99,true,ts.ScriptKind.JS);
 const names=['azraelReceiveUserWait','azraelFlushUserWait','azraelMergeUserWaitTiming'];
 const context=vm.createContext({});
 vm.runInContext('const azraelUserWaitJournals=new WeakMap();'+ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)).map(n=>n.getText(ast)).join('\n')+';globalThis.receive=azraelReceiveUserWait;globalThis.flush=azraelFlushUserWait;',context);
 let turn=null,updates=0;const manager={getConversation:()=>({})},owner={updateTurnState:(conversation,id,fn)=>{updates++;assert.equal(id,'turn');fn(turn)}},find=()=>turn;
 context.receive(manager,owner,find,'chat','turn',timing());assert.equal(updates,0);
 turn={turnId:'turn'};context.flush(manager,'chat');assert.equal(updates,1);assert.equal(turn.userWaitTiming.revision,1);
 context.receive(manager,owner,find,'chat','turn',timing(0));assert.equal(updates,1);
});
test('actual timer component schedules only ongoing request and cleans its interval',()=>{
 let effect,cleanup,ticks=0,state=134000,rendered;
 const React={useState:()=>[state,value=>{state=typeof value==='function'?value():value}],useEffect:fn=>{effect=fn}};
 const sandbox={wd:()=>React,m:()=>({jsx:(type,props)=>({type,props})}),Date:{now:()=>state},setInterval:fn=>{ticks++;rendered=fn;return 7},clearInterval:id=>{assert.equal(id,7);ticks--},azraelUserWaitLabel:ui.azraelUserWaitLabel,azraelUserWaitKind:ui.azraelUserWaitKind};
 vm.createContext(sandbox);vm.runInContext(ui.CONTEXT.replace(/export \{[^}]+\};/,''),sandbox);
 let node=sandbox.AzraelUserWaitTimer({request:request()});assert.equal(node.props.children,'응답 대기 2분 13초');cleanup=effect();assert.equal(ticks,1);
 state=135000;rendered();node=sandbox.AzraelUserWaitTimer({request:request()});assert.equal(node.props.children,'응답 대기 2분 14초');cleanup();assert.equal(ticks,0);
 node=sandbox.AzraelUserWaitTimer({request:request({endedAtMs:134000,durationMs:133000})});effect();assert.equal(ticks,0);assert.equal(node.props.children,'응답까지 2분 13초');
 assert.equal(sandbox.AzraelUserWaitTimer({request:null}),null);
 node=sandbox.AzraelUserWaitTimer({request:request({endedAtMs:134000,durationMs:133000}),history:true});assert.equal(node.props.children,'명령 승인 · 응답까지 2분 13초');
});
test('native Worked uses exact measured turn duration and freezes terminal/deferred snapshots; legacy span and resume clock stay native',()=>{
 const transformed=ui.injectUserWaitTime(deferred.injectDeferredPresentation(fs.readFileSync(path.join(root,ui.PRESENTATION),'utf8')).text,ui.PRESENTATION).text;
 const ast=ts.createSourceFile('presentation',transformed,99,true,ts.ScriptKind.JS),owner=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Vzi');
 let now=20000;
 const sandbox={Uzi:{c:()=>[]},le:()=>({locale:'ko'}),Wzi:{useState:()=>[now,()=>{}]},Hzi:()=>now,pMn:()=>{},bCi:ms=>String(ms),azraelUserWaitContext:()=>null,azraelUserWaitDuration:require('./task-work-time.cjs').azraelUserWaitDuration};
 let turn={durationMs:10000,turnStartedAtMs:2000,userWaitTiming:{revision:1,startedAtMs:1000,requests:[],blockedIntervals:[{startedAtMs:2000,endedAtMs:11000}]}};
 sandbox.X=()=>({useContext:()=>turn});vm.createContext(sandbox);vm.runInContext(owner.getText(ast),sandbox);
 assert.equal(sandbox.Vzi({status:'worked',startedAtMs:2000,completedAtMs:12000}).elapsedMs,1000);
 now=90000;assert.equal(sandbox.Vzi({status:'worked',startedAtMs:2000,completedAtMs:12000}).elapsedMs,1000);
 turn={...turn,status:'deferred',rootResumeWait:{startedAtMs:11000}};
 assert.equal(sandbox.Vzi({status:'worked',startedAtMs:2000,completedAtMs:null}).elapsedMs,1000);
 assert.equal(sandbox.Vzi({status:'azraelWaiting',startedAtMs:11000,completedAtMs:null}).elapsedMs,79000);
 turn={durationMs:10000,turnStartedAtMs:1000};
 assert.equal(sandbox.Vzi({status:'worked',startedAtMs:2000,completedAtMs:12000}).elapsedMs,10000);
});
