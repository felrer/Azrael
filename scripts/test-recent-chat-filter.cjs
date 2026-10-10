"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),test=require("node:test");
const {ASSET,MARKER,HELPER,injectRecentChatFilter}=require("./inject-recent-chat-filter.cjs");
const ts=require("../extensions/azrael-ex/node_modules/typescript");
const original=fs.readFileSync(path.resolve("artifacts/upstream-ui/26.1007.21434",ASSET),"utf8");
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
