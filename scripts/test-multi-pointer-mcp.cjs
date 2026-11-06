'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Readable,Writable}=require('node:stream');
const {createProtocol,runProtocol,toolDefinitions,validateArguments,terminationFailed}=require('./multi-pointer-mcp.cjs');
// Retained: future tool additions/transport edits can otherwise bypass the launch-bound native API or corrupt chunked Unicode.
test('MCP admits only declared bounded input after initialization and hides tools on unsupported platforms',async()=>{
 let calls=0;const p=createProtocol({platform:'win32',call:async()=>{calls++;throw Error('application outcome unknown');}});
 const request=(id,method,params)=>({jsonrpc:'2.0',id,method,params});
 assert.equal((await p(request(1,'tools/list'))).error.code,-32002);
 const init=await p(request(2,'initialize',{protocolVersion:'2024-11-05'}));assert.equal(init.result.protocolVersion,'2024-11-05');
 for(const args of [{name:'bind',arguments:{}},{name:'click',arguments:{pointerId:'a',button:'left',pid:1}},{name:'drag',arguments:{pointerId:'a',x:4,y:5,durationMs:9999}}])assert.equal((await p(request(3,'tools/call',args))).result.isError,true);
 assert.equal(calls,0);
 const failure=await p(request(4,'tools/call',{name:'text',arguments:{pointerId:'a',text:'한글'}}));assert.equal(failure.result.isError,true);assert.equal(JSON.parse(failure.result.content[0].text).applicationEffectVerified,false);assert.equal(calls,1);
 const off=createProtocol({platform:'linux',call:async()=>assert.fail('unsupported host executed input')});await off(request(1,'initialize'));assert.deepEqual((await off(request(2,'tools/list'))).result.tools,[]);
 const move=toolDefinitions().find(t=>t.name==='move');assert.throws(()=>validateArguments(move,{pointerId:'../x',x:1,y:2}));assert.throws(()=>validateArguments(move,{pointerId:'a',x:NaN,y:2}));
 const press=toolDefinitions().find(t=>t.name==='press');for(const keys of [[],[65,65],[1],[255],['65'],Array.from({length:9},(_,i)=>65+i)])assert.throws(()=>validateArguments(press,{pointerId:'a',keys}));
 assert.deepEqual(validateArguments(press,{pointerId:'a',keys:[162,65]}),{pointerId:'a',keys:[162,65]});
 const cooperation=toolDefinitions().find(t=>t.name==='collaboration');assert.throws(()=>validateArguments(cooperation,{enabled:1}));assert.deepEqual(validateArguments(cooperation,{enabled:true}),{enabled:true});
 // Transport shutdown edits must preserve native failure/unknown termination rather than reporting parent success.
 assert.equal(terminationFailed({started:false}),false);assert.equal(terminationFailed({exitCode:0,signal:null,terminationVerified:true}),false);
 for(const state of [{exitCode:2,terminationVerified:true},{exitCode:null,terminationVerified:false},{exitCode:0,signal:'SIGTERM',terminationVerified:true},{exitCode:0}])assert.equal(terminationFailed(state),true);
});
test('JSONL transport preserves split Unicode and emits no replies for notifications',async()=>{
 const packets=[{jsonrpc:'2.0',id:1,method:'initialize'},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'text',arguments:{pointerId:'a',text:'한글😀'}}}];
 const b=Buffer.from(packets.map(JSON.stringify).join('\n')+'\n');const boundary=b.indexOf(Buffer.from('한'))+1;
 const chunks=[b.subarray(0,boundary),b.subarray(boundary,boundary+2),b.subarray(boundary+2)];let output='',observed;
 await runProtocol({input:Readable.from(chunks),output:new Writable({write(c,e,done){output+=c;done();}}),protocol:createProtocol({platform:'win32',call:async(method,args)=>{observed=args.text;return {applicationEffectVerified:false};}})});
 const replies=output.trim().split('\n').map(JSON.parse);assert.equal(replies.length,2);assert.equal(replies[1].id,2);assert.equal(observed,'한글😀');
});
