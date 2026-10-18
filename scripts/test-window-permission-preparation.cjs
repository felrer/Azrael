'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWindowOwner}=require('./window-control-policy.cjs');
const {toolDefinitions,callResult,pipeRequest}=require('./window-control-mcp.cjs');
const {EventEmitter}=require('node:events');
const app={hwnd:'fixture',pid:3,processCreated:'created',executable:'C:/fixture/editor.exe',title:'Fixture',minimized:false,widthPx:800,heightPx:600,dpi:96};
async function fixture(t){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'window-permission-prep-'));
 let windows=[app];const calls=[],prepared=[];
 const owner=createWindowOwner({codexHome:home,occupancyDirectory:path.join(home,'occupancy'),authorize:async()=>true,approve:()=>assert.fail('Preparation cannot perform target app control'),
  backend:{async request(method){calls.push(method);if(method==='listWindows')return windows;assert.fail('Preparation cannot invoke native input, create a child or launch an app');}},
  requestStage:async(thread,args,identity,apps)=>{prepared.push({thread,args,identity,apps});return {authorized:true,prepared:true,appsAuthorized:true,appResults:apps.map((_,index)=>({index,authorized:true}))};}});
 t.after(async()=>{owner.dispose();await fs.rm(home,{recursive:true});});
 return {owner,calls,prepared,setWindows(value){windows=value;},async candidates(){return (await owner.call('thread','list_windows',{})).candidates;}};
}
test('preparation resolves observed candidates without selecting, starting a child or sending input',async t=>{
 const f=await fixture(t),candidate=(await f.candidates())[0];
 const result=await f.owner.call('thread','prepare_permissions',{stage:3,reason:'Prepare known editor',candidateIds:[candidate.candidateId]});
 assert.equal(result.prepared,true);assert.equal(f.prepared.length,1);
 assert.deepEqual(f.prepared[0],{thread:'thread',args:{stage:3,reason:'Prepare known editor',prepareOnly:true},identity:undefined,apps:[app]});
 assert.deepEqual(f.calls,['listWindows','listWindows']);
 assert.equal((await f.owner.call('thread','status',{})).state,'unbound');
});
test('stale, forged, duplicate, excessive and unexpected preparation scopes fail before approval',async t=>{
 const f=await fixture(t),id=(await f.candidates())[0].candidateId;
 for(const args of [{candidateIds:['forged']},{candidateIds:[id,id]},{candidateIds:Array.from({length:9},(_,i)=>'candidate'+i)},{executable:app.executable},{prepareOnly:true}]){
  await assert.rejects(f.owner.call('thread','prepare_permissions',{stage:3,reason:'Prepare',...args}));
 }
 f.setWindows([{...app,processCreated:'replacement'}]);
 await assert.rejects(f.owner.call('thread','prepare_permissions',{stage:3,reason:'Prepare',candidateIds:[id]}));
 assert.equal(f.prepared.length,0);
});
test('preparing current-window control still requires a selected live target',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.owner.call('thread','prepare_permissions',{stage:2,reason:'Prepare'}));
 assert.equal(f.prepared.length,0);
});
test('preparation MCP schema and output preserve bounded opaque authority results',()=>{
 const schema=toolDefinitions().find(t=>t.name==='prepare_permissions').inputSchema;
 assert.equal(schema.properties.candidateIds.maxItems,8);assert.equal(schema.additionalProperties,false);
 assert.deepEqual(schema.required,['stage','reason']);
 const result=JSON.parse(callResult({prepared:true,appsAuthorized:false,appResults:[{index:0,authorized:false,code:'approval_declined',executable:app.executable,secret:'hidden'}]}).content[0].text);
 assert.deepEqual(result,{prepared:true,appsAuthorized:false,appResults:[{index:0,authorized:false,code:'approval_declined'}]});
});
test('relay approval progress permits 50-second responses and restores operation timeout',async()=>{
 const timeouts=[];
 const connect=()=>{
  const socket=new EventEmitter();socket.setTimeout=ms=>{timeouts.push(ms);return socket;};socket.destroy=()=>{};
  socket.write=()=>{
   for(const value of [{progress:{stage:'approval'}},{progress:{stage:'approval'}},{progress:{stage:'running'}},{result:{ok:true}}]) socket.emit('data',Buffer.from(JSON.stringify(value)+'\n'));
  };
  queueMicrotask(()=>socket.emit('connect'));return socket;
 };
 assert.deepEqual(await pipeRequest('mock',{}, {connect}),{ok:true});
 assert.deepEqual(timeouts,[30000,60000,60000,30000]);
 timeouts.length=0;
 await pipeRequest('mock',{}, {connect,timeoutMs:360000});
 assert.deepEqual(timeouts,[360000,60000,60000,360000]);
});
