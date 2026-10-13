'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {ASSET,HELPER,injectTaskWorkTime}=require('./inject-task-work-time.cjs');
const ts=require(require.resolve('typescript',{paths:[path.join(__dirname,'../extensions/azrael-ex')]}));
const source=fs.readFileSync(path.join(__dirname,'../artifacts/upstream-ui/26.1007.21434',ASSET),'utf8');
test('thread-only guarded transform and idempotence',()=>{assert.equal(injectTaskWorkTime(source,'other.js').count,0);const result=injectTaskWorkTime(source,ASSET);assert.equal(result.count,1);assert.ok(result.text.includes(HELPER));assert.equal(injectTaskWorkTime(result.text,ASSET).count,0);assert.throws(()=>injectTaskWorkTime(source.replace('T?(0,Qh.jsx)(ch,{conversationId:t,entries:Sn,','changed'),ASSET));assert.throws(()=>injectTaskWorkTime(result.text.replace('/*azrael-task-work-time-v1*/','/*azrael-task-work-time-v1*//*azrael-task-work-time-v1*/'),ASSET));const ast=ts.createSourceFile('thread.js',result.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.deepEqual(ast.parseDiagnostics,[])});
test('inject shared self-contained helpers and native preference, component contract',()=>{for(const name of ['azraelTaskTimeGroups','azraelTaskTimeLabel','azraelCreateTaskTimeHistory','azraelMergeTaskTimeTurns'])assert.ok(HELPER.includes('function '+name+'('));assert.ok(HELPER.includes("azrael-task-work-time-boundaries"));assert.ok(HELPER.includes('useSyncExternalStore'));assert.ok(HELPER.includes('setInterval(()=>setNow(Date.now()),1000)'));assert.ok(HELPER.includes('export {azraelTaskWorkTimePanel,azraelTaskTimeVirtualList}'))});
test('full native namespace pipeline retains mounted panel and parses',()=>{const {transformAsset}=require('./namespace-azrael-host.cjs');const result=transformAsset(source,ASSET,path.join(__dirname,'../artifacts/upstream-ui/26.1007.21434',ASSET),ts);assert.ok(result.text.includes('T?(0,Qh.jsx)(ch,{azraelTaskTime:{manager:Tr(D,i),conversationId:t,hostId:i,liveTurns:D.get(Fr,t)??[]},conversationId:t,entries:Sn,'));assert.deepEqual(ts.createSourceFile('transformed.js',result.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics,[])});

test('summary is owned and measured by both native virtual list paths',()=>{const out=injectTaskWorkTime(source,ASSET).text;assert.ok(out.includes('(0,vh.jsx)(azraelTaskTimeVirtualList,{azraelTaskTime:e.azraelTaskTime,entries:r,'));assert.ok(out.includes('(0,Qh.jsx)(azraelTaskTimeVirtualList,{azraelTaskTime:{'));assert.ok(!out.includes('(0,Qh.jsx)(azraelTaskWorkTimePanel,{manager:'));assert.ok(HELPER.includes("type:'gap',estimatedHeightPx:76"));for(const anchor of ['(0,vh.jsx)(eu,{entries:r,','(0,Qh.jsx)(eu,{collapseEmptyRows:q,entries:Sn,'])assert.throws(()=>injectTaskWorkTime(source.replace(anchor,'changed'),ASSET))});

test('list owns history, disclosure state, and exact native turn mapping',()=>{
 const panel=HELPER.slice(HELPER.indexOf('function azraelTaskWorkTimePanel'),HELPER.indexOf('function azraelTaskTimeVirtualList'));
 assert.ok(!panel.includes('useSyncExternalStore'));
 assert.ok(HELPER.includes('model.setExpanded'));
 assert.ok(HELPER.includes('entry.turn?.turnId??entry.turnId??entry.sourceTurnId??entry.presentation?.turnId'));
 assert.ok(!HELPER.includes('entry.turnSearchKey'));
 assert.ok(!HELPER.includes('retainedTurnKeys:retained'));
});

test('native row observer transform is guarded, cached by owner, parses and is idempotent',()=>{
 const {ROW_ASSET,injectTaskWorkTime}=require('./inject-task-work-time.cjs');
 const source=fs.readFileSync(path.join(__dirname,'../artifacts/upstream-ui/26.1007.21434',ROW_ASSET),'utf8'),out=injectTaskWorkTime(source,ROW_ASSET);
 assert.equal(out.count,1);assert.equal(injectTaskWorkTime(out.text,ROW_ASSET).count,0);
 assert.deepEqual(ts.createSourceFile('rows.js',out.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics,[]);
 assert.throws(()=>injectTaskWorkTime(source.replace('let e=new ResizeObserver(e=>{let t=new Map,n=!1;','changed'),ROW_ASSET));
 const owner=fs.readFileSync(path.join(__dirname,'namespace-azrael-host.cjs'),'utf8');assert.ok(owner.includes('"inject-task-work-time.cjs": [TASK_WORK_TIME_ASSET, TASK_TIME_ROW_ASSET]'));
});
test('row observer batches newest measurements and cancels unmounted targets and disposal',()=>{
 const vm=require('node:vm'),{azraelTaskTimeRowObserver}=require('./inject-task-work-time.cjs');let delivery,disconnected=false;
 const frames=new Map();let sequence=0;const calls=[];
 const context={Map,ResizeObserver:class{constructor(callback){delivery=callback}disconnect(){disconnected=true}unobserve(){}},requestAnimationFrame:callback=>{frames.set(++sequence,callback);return sequence},cancelAnimationFrame:id=>frames.delete(id)};
 const create=vm.runInNewContext('('+azraelTaskTimeRowObserver.toString()+')',context),observer=create(entries=>calls.push(entries)),target={};
 delivery([{target,height:10}]);delivery([{target,height:20}]);assert.equal(frames.size,1);assert.equal(calls.length,0);
 const callback=[...frames.values()][0];frames.clear();callback();assert.equal(calls[0][0].height,20);
 delivery([{target,height:30}]);observer.unobserve(target);assert.equal(frames.size,0);
 delivery([{target,height:40}]);observer.disconnect();assert.equal(frames.size,0);assert.equal(disconnected,true);
 delivery([{target,height:50}]);assert.equal(frames.size,0);assert.equal(calls.length,1);
});

test('namespace dispatch transforms pristine native row asset and second pass is idempotent',()=>{
 const {ROW_ASSET,azraelTaskTimeRowObserver}=require('./inject-task-work-time.cjs'),{transformAsset}=require('./namespace-azrael-host.cjs');
 const filename=path.join(__dirname,'../artifacts/upstream-ui/26.1007.21434',ROW_ASSET),input=fs.readFileSync(filename,'utf8');
 const output=transformAsset(input,ROW_ASSET,filename,ts);
 assert.equal(output.asset?.taskWorkTimeEdits,1,'native namespace dispatch must reach row injector');
 assert.notEqual(output.text,input);
 assert.ok(output.text.includes(azraelTaskTimeRowObserver.toString()));
 assert.equal(output.text.split('let e=azraelTaskTimeRowObserver(e=>{let t=new Map,n=!1;').length-1,1);
 assert.deepEqual(ts.createSourceFile('native-row-pipeline.js',output.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics,[]);
 const repeated=transformAsset(output.text,ROW_ASSET,filename,ts);
 assert.equal(repeated.text,output.text);assert.equal(repeated.asset,null);
});
