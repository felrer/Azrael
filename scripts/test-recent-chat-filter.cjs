"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),test=require("node:test");
const {ASSET,MARKER,HELPER,injectRecentChatFilter}=require("./inject-recent-chat-filter.cjs");
const ts=require(process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH||"../extensions/azrael-ex/node_modules/typescript");
const {DISCOVERY_ASSET,DISCOVERY_MARKER}=require("./inject-recent-chat-filter.cjs");
const root=process.env.AZRAEL_PRESERVATION_UI_ROOT||path.resolve("artifacts/upstream-ui/26.1007.21434");
const original=fs.readFileSync(path.join(root,ASSET),"utf8");
const discovery=fs.readFileSync(path.join(root,DISCOVERY_ASSET),"utf8");
test("native recent discovery requests 200, follows cursors and preserves expanded/disabled policy",async()=>{
  const result=injectRecentChatFilter(discovery,DISCOVERY_ASSET);
  assert.equal(result.count,1);assert.equal(injectRecentChatFilter(result.text,DISCOVERY_ASSET).count,0);
  for(const damaged of ["",discovery+discovery,result.text+DISCOVERY_MARKER,result.text.replace("c=e.slice(0,200)","c=e.slice(0,50)")])assert.throws(()=>injectRecentChatFilter(damaged,DISCOVERY_ASSET));
  const ast=ts.createSourceFile(DISCOVERY_ASSET,result.text,99,true,1);
  assert.equal(ast.parseDiagnostics.length,0);
  let refresh;function visit(node){if(ts.isMethodDeclaration(node)&&node.name.getText(ast)==="runRecentConversationRefresh")refresh=node.getText(ast);ts.forEachChild(node,visit)}visit(ast);
  assert.ok(refresh);
  const native=vm.runInNewContext(`({${refresh}}).runRecentConversationRefresh`,{B:id=>id,v$:thread=>thread});
  const policy=result.text.match(/function ewn\(e,t,n\)\{[^}]+\}/)[0];
  const getLimit=vm.runInNewContext(`(${policy})`,{te:host=>host==="cloud"});
  assert.equal(getLimit("local",false,false),200);assert.equal(getLimit("cloud",true,false),200);
  assert.equal(getLimit("local",true,false),500);assert.equal(getLimit("local",true,true),0);
  async function run(limit,mode,pageSize=100){
    const calls=[],rows=Array.from({length:600},(_,id)=>({id:String(id),updatedAt:id}));
    const state={params:{getHistoryLimit:limit===undefined?undefined:()=>limit,events:{emitThreadListInvalidated(){}},host:{}},recentHistorySource:"live",recentConversationSortKey:"updated_at",threadSummaries:[],threadsById:new Map(),conversations:new Map(),pinnedConversationIds:new Set(),recentConversationIds:[],
      async loadThreadHydrationState(){},async listRecentThreads(query){calls.push(query);const start=Number(query.cursor||0),end=start+Math.min(query.limit,pageSize);return {data:rows.slice(start,end),nextCursor:String(end)}},
      recordThreadAvailability(){},getThreadSummaryFromThread:thread=>thread,shouldSurfaceThreadSummary:()=>true,replaceRecentThreadSummaries(rows){this.threadSummaries=rows},mergeRecentThreadSummaries(){},isConversationActive:()=>false,isConversationSuppressed:()=>false,
      upsertRecentConversationState(id,row){this.conversations.set(id,row)},notifyConversationCallbacks(){},notifyAnyConversationCallbacks(){}};
    await native.call(state,"updated_at",mode);return {state,calls};
  }
  for(const limit of [undefined,200,500]){const {state,calls}=await run(limit,"routine",37);assert.equal(state.recentConversationIds.length,200);assert.deepEqual(calls.map(q=>q.limit),[100,100,100,89,52,15]);assert.equal(calls[0].background,false)}
  const expanded=await run(500,"expanded");assert.equal(expanded.calls.length,5);assert.equal(expanded.state.threadSummaries.length,500);assert.equal(expanded.state.recentConversationIds.length,200);assert.equal(expanded.calls[0].background,true);
  const disabled=await run(0,"expanded");assert.equal(disabled.calls.length,0);assert.equal(disabled.state.recentHistorySource,"disabled");
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
