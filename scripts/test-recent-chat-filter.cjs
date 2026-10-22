"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),test=require("node:test");
const {ASSET,MARKER,HELPER,injectRecentChatFilter}=require("./inject-recent-chat-filter.cjs");
const ts=require(process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH||"../extensions/azrael-ex/node_modules/typescript");
const {DISCOVERY_ASSET,DISCOVERY_MARKER,QUERY_ASSET}=require("./inject-recent-chat-filter.cjs");
const root=process.env.AZRAEL_PRESERVATION_UI_ROOT||path.resolve("artifacts/upstream-ui/26.1007.21434");
const original=fs.readFileSync(path.join(root,ASSET),"utf8");
const discovery=fs.readFileSync(path.join(root,DISCOVERY_ASSET),"utf8");
let nativeRefresh;
function nativeRefreshFixture({limit,total=600,pageSize=50,failAt,gate}={}) {
  if(!nativeRefresh){
    const result=injectRecentChatFilter(discovery,DISCOVERY_ASSET),ast=ts.createSourceFile(DISCOVERY_ASSET,result.text,99,true,1);
    let refresh;function visit(node){if(ts.isMethodDeclaration(node)&&node.name.getText(ast)==="runRecentConversationRefresh")refresh=node.getText(ast);ts.forEachChild(node,visit)}visit(ast);
    nativeRefresh=vm.runInNewContext(`({${refresh}}).runRecentConversationRefresh`,{B:id=>id,v$:thread=>thread,setTimeout});
  }
  const calls=[],snapshots=[],rows=Array.from({length:total},(_,id)=>({id:String(id),updatedAt:total-id}));
  const state={params:{getHistoryLimit:limit===undefined?undefined:()=>limit,events:{emitThreadListInvalidated(){}},host:{}},recentHistorySource:"live",recentConversationSortKey:"updated_at",threadSummaries:[],threadsById:new Map(),conversations:new Map(),pinnedConversationIds:new Set(),recentConversationIds:[],
    async loadThreadHydrationState(){},async listRecentThreads(query){calls.push(query);if(gate)await gate(calls.length);if(calls.length===failAt)throw Error("page unavailable");const start=Number(query.cursor||0),end=Math.min(total,start+Math.min(query.limit,pageSize));return {data:rows.slice(start,end),nextCursor:end<total?String(end):null}},
    recordThreadAvailability(){},getThreadSummaryFromThread:thread=>thread,shouldSurfaceThreadSummary:()=>true,replaceRecentThreadSummaries(rows){this.threadSummaries=rows},mergeRecentThreadSummaries(){},isConversationActive:()=>false,isConversationSuppressed:()=>false,
    upsertRecentConversationState(id,row){this.conversations.set(id,row);this.threadsById.set(id,row)},notifyConversationCallbacks(){},notifyAnyConversationCallbacks(){snapshots.push([...this.recentConversationIds])}};
  return {state,calls,snapshots,rows,run:(mode="routine",sort="updated_at")=>nativeRefresh.call(state,sort,mode)};
}

test("native recent discovery publishes each 50 and prefetches without scrolling",async()=>{
  const result=injectRecentChatFilter(discovery,DISCOVERY_ASSET);
  assert.equal(result.count,1);assert.equal(injectRecentChatFilter(result.text,DISCOVERY_ASSET).count,0);
  for(const damaged of ["",discovery+discovery,result.text+DISCOVERY_MARKER,result.text.replace("limit:Math.min(50,a-data.length)","limit:200")])assert.throws(()=>injectRecentChatFilter(damaged,DISCOVERY_ASSET));
  const ast=ts.createSourceFile(DISCOVERY_ASSET,result.text,99,true,1);
  assert.equal(ast.parseDiagnostics.length,0);
  const policy=result.text.match(/function ewn\(e,t,n\)\{[^}]+\}/)[0];
  const getLimit=vm.runInNewContext(`(${policy})`,{te:host=>host==="cloud"});
  assert.equal(getLimit("local",false,false),200);assert.equal(getLimit("cloud",true,false),200);
  assert.equal(getLimit("local",true,false),500);assert.equal(getLimit("local",true,true),0);
  for(const limit of [undefined,200,500]){const f=nativeRefreshFixture({limit});await f.run();assert.equal(f.state.recentConversationIds.length,200);assert.deepEqual(f.calls.map(q=>q.limit),[50,50,50,50]);assert.deepEqual(f.snapshots.map(s=>s.length),[50,100,150,200]);assert.equal(f.calls[0].background,false);assert.ok(f.calls.slice(1).every(q=>q.background))}
  const expanded=nativeRefreshFixture({limit:500});await expanded.run("expanded");assert.equal(expanded.calls.length,10);assert.equal(expanded.state.threadSummaries.length,500);assert.equal(expanded.state.recentConversationIds.length,200);assert.equal(expanded.calls[0].background,true);
  const disabled=nativeRefreshFixture({limit:0});await disabled.run("azrael-search");assert.equal(disabled.calls.length,0);assert.equal(disabled.state.recentHistorySource,"disabled");
});

test("first page is visible while next page is still in flight; late failure retains it",async()=>{
  let release,started;const waiting=new Promise(r=>started=r),hold=new Promise(r=>release=r);
  const f=nativeRefreshFixture({failAt:2,gate:async n=>{if(n===2){started();await hold}}});
  const running=f.run();await waiting;
  assert.deepEqual(f.snapshots.map(s=>s.length),[50]);assert.equal(f.state.recentConversationIds.length,50);
  release();await assert.rejects(running,/page unavailable/);assert.equal(f.state.recentConversationIds.length,50);
});

test("short/empty pages keep cursors and deduplicate; search exhausts beyond 200/500 atomically",async()=>{
  const f=nativeRefreshFixture({pageSize:17,total:617});await f.run("azrael-search");
  assert.equal(f.state.recentConversationIds.length,617);assert.equal(f.state.threadSummaries.length,617);assert.deepEqual(f.snapshots.map(s=>s.length),[617]);assert.ok(f.calls.every(q=>q.limit===50));
  const short=nativeRefreshFixture({pageSize:17,total:93});await short.run();assert.equal(short.state.recentConversationIds.length,93);
  const empty=nativeRefreshFixture();let calls=0;empty.state.listRecentThreads=async()=>++calls===1?{data:[],nextCursor:"after-hidden"}:{data:[{id:"visible",updatedAt:1}],nextCursor:null};await empty.run();assert.deepEqual(Array.from(empty.state.recentConversationIds),["visible"]);
  const dup=nativeRefreshFixture();let n=0;dup.state.listRecentThreads=async()=>({data:[{id:"same",updatedAt:1}],nextCursor:++n===1?"next":null});await dup.run("azrael-search");assert.equal(dup.state.recentConversationIds.length,1);
});

test("failed or repeated-cursor exhaustive search never publishes incomplete results",async()=>{
  const f=nativeRefreshFixture({failAt:3});await assert.rejects(f.run("azrael-search"),/page unavailable/);assert.equal(f.snapshots.length,0);
  const cycle=nativeRefreshFixture();cycle.state.listRecentThreads=async()=>({data:[],nextCursor:"cycle"});await assert.rejects(cycle.run("azrael-search"),/Repeated recent history cursor/);assert.equal(cycle.snapshots.length,0);
});

test("warm refresh retains cached rows before completion, then removes stale ordinary rows but retains pinned/active",async()=>{
  const f=nativeRefreshFixture({total:75});const warm=Array.from({length:130},(_,id)=>({id:String(id),updatedAt:200-id}));
  for(const row of warm)f.state.upsertRecentConversationState(row.id,row);
  f.state.recentConversationIds=warm.map(r=>r.id);f.state.pinnedConversationIds.add("129");f.state.isConversationActive=id=>id==="128";
  await f.run();assert.equal(f.snapshots[0].length,130);assert.equal(f.state.recentConversationIds.length,77);assert.ok(f.state.recentConversationIds.includes("129"));assert.ok(f.state.recentConversationIds.includes("128"));assert.ok(!f.state.recentConversationIds.includes("127"));
});

test("query hook exposes exhaustive refresh through native host admission and sort mapping",async()=>{
  const source=fs.readFileSync(path.join(root,QUERY_ASSET),"utf8"),result=injectRecentChatFilter(source,QUERY_ASSET);
  assert.equal(result.count,1);assert.equal(injectRecentChatFilter(result.text,QUERY_ASSET).count,0);
  const ast=ts.createSourceFile(QUERY_ASSET,result.text,99,true,1);assert.equal(ast.parseDiagnostics.length,0);
  const owner=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="Uva");assert.ok(owner);
  const calls=[],registry={},scope={};const manager={getHostId:()=>"local"};
  const snapshot=[{id:"beyond-200",hostId:"local"}],hosts=new Set();
  const context={Ou:()=>scope,$:{},gGe:()=>({enabledRemoteHostIdSet:hosts}),Fva:opts=>{assert.equal(opts.enabledRemoteHostIds,hosts);assert.equal(opts.appServerRegistry,registry);return snapshot},Yva:{c:()=>Array(12).fill(Symbol())},Vva:()=>registry,Xva:{useCallback:f=>f},jva:(s,r)=>{assert.equal(s,scope);assert.equal(r,registry);return[manager]},Px:(s,h)=>({refreshRecentConversations:o=>{calls.push({s,h,o})}}),R3e:s=>"mapped-"+s,Qg:"updated",Kva:()=>({data:[]}),Wva(){}};
  const hook=vm.runInNewContext(`(${owner.getText(ast)})`,context),feed=hook();assert.equal(await feed.loadAll(),snapshot);
  assert.equal(calls[0].h,"local");assert.equal(calls[0].o.mode,"azrael-search");assert.equal(calls[0].o.sortKey,"mapped-updated");
  let suppressed=false,current={...snapshot[0],title:"Renamed"};registry.getForHostId=()=>({getConversation:()=>current,isConversationSuppressedAfterArchive:()=>suppressed});
  assert.equal(feed.resolveSearchRows(snapshot)[0],current);suppressed=true;assert.equal(feed.resolveSearchRows(snapshot).length,0);suppressed=false;current=null;assert.equal(feed.resolveSearchRows(snapshot).length,0);
  for(const damaged of [source+source,result.text.replace("mode:`azrael-search`","mode:`routine`")])assert.throws(()=>injectRecentChatFilter(damaged,QUERY_ASSET));
});

test("production transformation composes history/flags/query modules and binds all cache targets",()=>{
  const namespace=require('./namespace-azrael-host.cjs');
  for(const asset of [ASSET,DISCOVERY_ASSET,QUERY_ASSET]){
    const full=path.join(root,asset),source=fs.readFileSync(full,"utf8"),result=namespace.transformAsset(source,asset,full,ts);
    assert.equal(result.asset.recentChatFilterEdits,1);
    assert.equal(ts.createSourceFile(asset,result.text,99,true,1).parseDiagnostics.length,0);
    assert.equal(injectRecentChatFilter(result.text,asset).count,0);
    assert.ok(Object.hasOwn(namespace.getAssetTransformRules(asset),'inject-recent-chat-filter.cjs'));
  }
});
test("latest native recent menu callback preserves merged order and persisted environment",()=>{
  const result=injectRecentChatFilter(original,ASSET);assert.equal(result.count,1);assert.equal(injectRecentChatFilter(result.text,ASSET).count,0);
  assert.equal(ts.createSourceFile(ASSET,result.text,99,true,1).parseDiagnostics.length,0);
  for(const damaged of ["",original+original,result.text+MARKER,result.text.replace(HELPER,"")])assert.throws(()=>injectRecentChatFilter(damaged,ASSET));
  const rows=[{kind:"local",conversation:{id:"a"}},{kind:"remote",task:{}},{kind:"local",pendingThreadStart:{}}];
  const env={id:"selected"};let selected="recent",observed;
  const context={It(){},Pt:"filter",Ft:"environment",l:atom=>atom==="filter"?selected:"selected",ce:()=>({data:[env]}),gn:{useMemo:fn=>fn()},yn:row=>row.kind==="remote",fn:(tasks,conversations,environment)=>{observed={tasks,conversations,environment};return rows}};
  vm.createContext(context);vm.runInContext(HELPER,context);
  const tasks={},conversations=[];assert.equal(context.azraelRecentChatTasks(tasks,conversations),rows);assert.deepEqual(observed,{tasks,conversations,environment:env});
  selected="local";assert.deepEqual(Array.from(context.azraelRecentChatTasks(tasks,conversations)),[rows[0]]);
  selected="cloud";assert.deepEqual(Array.from(context.azraelRecentChatTasks(tasks,conversations)),[rows[1]]);
});

test("pinned header executes without shadowing and resolves real filter hook aliases", () => {
  const injector = require('./inject-recent-chat-filter.cjs');
  const root = process.env.AZRAEL_PRESERVATION_UI_ROOT || path.resolve(__dirname, '../artifacts/upstream-ui/26.1007.21434');
  const source = fs.readFileSync(path.join(root, injector.ASSET), 'utf8');
  const result = injector.injectRecentChatFilter(source, injector.ASSET);
  // Execute the real header setup, including its declarations, so a renamed
  // local cannot silently shadow a query hook used earlier in the same scope.
  const ts = require(process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH || require.resolve('typescript', { paths: [path.resolve(__dirname, '../extensions/azrael-ex')] }));
  const ast = ts.createSourceFile(injector.ASSET, result.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const header = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Fn');
  const setupEnd = header.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'S')).end;
  const setup = result.text.slice(header.body.getStart(ast) + 1, setupEnd);
  const renderContext = { Bn: { c: () => Array(66).fill(Symbol()) }, p: () => ({ pathname: '/' }), Ln: () => {},
    nt: () => false, In: null, z: () => ({ data: [] }), te: () => ({ data: [] }), Fe: null,
    azraelRecentChatTasks: () => ['rendered-header'] };
  assert.deepEqual(Array.from(vm.runInNewContext(`(function(e){${setup};return S})({})`, renderContext)), ['rendered-header']);
  assert.throws(() => vm.runInNewContext(`(function(e){${setup.replace('C=l||Fe==null,w;', 'C=l||Fe==null,te;')};return S})({})`, renderContext), /before initialization/);
  assert.equal(result.count, 1);
  assert.equal(injector.injectRecentChatFilter(result.text, injector.ASSET).count, 0);
  assert.throws(() => injector.injectRecentChatFilter(source + source, injector.ASSET));
  const local = { kind: 'local', conversation: {} }, cloud = { kind: 'cloud' }, orphan = { kind: 'local' };
  let filter = 'recent';
  const environment = { id: 'selected' };
  // Resolve hook aliases from the actual pinned imports rather than inventing
  // callable mocks for similarly named module initializers.
  const importAliases = new Map(ast.statements.filter(ts.isImportDeclaration).flatMap(node =>
    node.importClause?.namedBindings?.elements?.map(e => [e.propertyName?.text ?? e.name.text, e.name.text]) ?? []));
  assert.equal(importAliases.get('Slt'), 'l');
  assert.equal(importAliases.get('t$'), 'ce');
  assert.match(injector.HELPER, /It\(\);let filter=l\(Pt\)/);
  assert.match(injector.HELPER, /environmentId=l\(Ft\).*environments}=ce\(\)/);
  const context = { It: () => {}, Pt: 'filter', Ft: 'environment', l: atom => atom === 'filter' ? filter : 'selected', ce: () => ({ data: [environment] }),
    fn: (_tasks, _conversations, selected) => { assert.equal(selected, environment); return [local, cloud, orphan]; },
    gn: { useMemo: action => action() }, yn: row => row.kind === 'cloud' };
  vm.createContext(context);
  vm.runInContext(injector.HELPER, context);
  assert.deepEqual(Array.from(context.azraelRecentChatTasks([], [])), [local, cloud, orphan]);
  filter = 'local'; assert.deepEqual(Array.from(context.azraelRecentChatTasks([], [])), [local]);
  filter = 'cloud'; assert.deepEqual(Array.from(context.azraelRecentChatTasks([], [])), [cloud]);
});
