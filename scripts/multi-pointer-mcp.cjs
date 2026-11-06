'use strict';
// Standalone, explicitly launched experiment. This is not a Window Use authority adapter.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline');
const {spawn}=require('node:child_process');
const {StringDecoder}=require('node:string_decoder');
const MAX_LINE=1024*1024;
const ACTUATION=new Set(['click','drag','scroll','key','press','text']);
const field=(type,extra={})=>({type,...extra});
const pointer=()=>({pointerId:field('string',{minLength:1,maxLength:32,pattern:'^[A-Za-z0-9_-]+$'})});
const xy=()=>({x:field('integer',{minimum:-100000,maximum:100000}),y:field('integer',{minimum:-100000,maximum:100000})});
function tool(name,description,properties={},required=Object.keys(properties)){return {name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}};}
function toolDefinitions(){return [
 tool('status','Observe allowed targets, separate virtual cursors, shared physical cursor and foreground. No input.'),
 tool('collaboration','Enable or disable cooperative user/model mouse routing. User clicks are queued without cancelling model actions; stop always disables routing.',{enabled:field('boolean')}),
 tool('create_pointer','Create a colored, non-activating virtual cursor for a target from the startup allowlist. presentationOnly allows an on-screen initial cosmetic point without expanding subsequent input bounds.',{...pointer(),targetId:field('string',{minLength:1,maxLength:32,pattern:'^[A-Za-z0-9_-]+$'}),...xy(),color:field('string',{pattern:'^#[0-9A-Fa-f]{6}$'}),presentationOnly:field('boolean')},['pointerId','targetId','x','y']),
 tool('move','Move only this virtual cursor. The physical Windows cursor is unchanged.',{...pointer(),...xy()}),
 tool('desktop_target','Host adapter: pin an exact live desktop target at a visible hit. Requires immutable startup desktop:true; this method grants no app authorization.',{...pointer(),target:field('object',{properties:{hwnd:field('string',{pattern:'^0x[0-9A-Fa-f]{1,16}$'}),pid:field('integer',{minimum:1,maximum:4294967295}),processCreated:field('string',{pattern:'^0x[0-9A-Fa-f]{1,16}$'}),executable:field('string',{minLength:1,maxLength:32768})},required:['hwnd','pid','processCreated','executable'],additionalProperties:false}),...xy()}),
 tool('present_pointer','Host adapter: display a virtual pointer and activity without physical input, activation or changing its logical input position.',{...pointer(),...xy(),phase:field('string',{enum:['active','idle']}),click:field('boolean')},['pointerId','x','y','phase']),
 tool('click','Switch Windows foreground/input to this allowed target and click. Physical cursor/foreground can change.',{...pointer(),button:field('string',{enum:['left','right','middle']})}),
 tool('drag','Drag to a screen position. Verified cooperative mouse routing queues user mouse gestures; keyboard or unsupported input can still interrupt a partial drag.',{...pointer(),...xy(),durationMs:field('integer',{minimum:50,maximum:2000})},['pointerId','x','y']),
 tool('scroll','Switch Windows input to this target and send a vertical wheel delta.',{...pointer(),delta:field('integer',{minimum:-12000,maximum:12000})}),
 tool('key','Send a concrete Windows virtual-key down/up. Use left/right Shift or Ctrl; Alt, Windows and shell-switch shortcuts are unsupported. Release held keys before switching pointer.',{...pointer(),vk:field('integer',{minimum:8,maximum:254}),down:field('boolean')}),
 tool('press','Send one atomic key chord, releasing all keys before another participant runs. Keys are concrete Windows virtual keys in press order.',{...pointer(),keys:field('array',{minItems:1,maxItems:8,uniqueItems:true,items:field('integer',{minimum:8,maximum:254})})}),
 tool('text','Send Unicode text through Windows input to the activated allowed target. This does not perform IME composition.',{...pointer(),text:field('string',{minLength:1,maxLength:1024})}),
 tool('remove_pointer','Release this pointer and remove its overlay.',pointer()),
 tool('stop','Release synthetic held input and remove all virtual cursors. This does not close user apps.')
].map(def=>{if(ACTUATION.has(def.name)){def.inputSchema.properties.operationId=field('integer',{minimum:1,maximum:Number.MAX_SAFE_INTEGER,description:'Stable identity of this intended operation. Reuse for a duplicate request; never change it to replay uncertain input. Omit for a new operation.'});}return def;});}
function validateArguments(def,args){
 if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Object tool arguments required');
 const s=def.inputSchema;if(Object.keys(args).some(k=>!Object.hasOwn(s.properties,k))||s.required.some(k=>!Object.hasOwn(args,k)))throw Error('Unknown or missing tool argument');
 for(const [k,v]of Object.entries(args)){
  const d=s.properties[k];if(d.type==='array'?!Array.isArray(v):d.type==='integer'?!Number.isSafeInteger(v):d.type==='object'?(!v||typeof v!=='object'||Array.isArray(v)):typeof v!==d.type)throw Error('Invalid '+k+' type');
  if(d.type==='object')validateArguments({inputSchema:d},v);
  if(d.type==='array'&&(v.length<d.minItems||v.length>d.maxItems||new Set(v).size!==v.length||v.some(item=>!Number.isSafeInteger(item)||item<d.items.minimum||item>d.items.maximum)))throw Error('Invalid '+k+' items');
  if(d.enum&&!d.enum.includes(v)||d.minimum!==undefined&&v<d.minimum||d.maximum!==undefined&&v>d.maximum||d.minLength!==undefined&&v.length<d.minLength||d.maxLength!==undefined&&v.length>d.maxLength||d.pattern&&!new RegExp(d.pattern).test(v))throw Error('Invalid '+k+' value');
 }
 return args;
}
function plainFile(file){
 if(!path.isAbsolute(file)||file.includes('\0'))throw Error('Absolute plain file required');
 for(let p=path.resolve(file);;p=path.dirname(p)){const st=fs.lstatSync(p);if(st.isSymbolicLink()||(p===path.resolve(file)?!st.isFile():!st.isDirectory()))throw Error('Linked or non-regular input rejected');if(path.dirname(p)===p)break;}
 return path.resolve(file);
}
function verifyRuntime(directory){
 const manifestFile=plainFile(path.join(directory,'manifest.json'));const m=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
 if(m.schema!==1||m.kind!=='azrael-multi-pointer'||m.platform!=='win32'||m.arch!=='x64'||!/^[a-f0-9]{64}$/.test(m.sourceSha256)||!Array.isArray(m.files)||m.files.length!==2)throw Error('Verified multi-pointer runtime manifest required');
 let executable;const seen=new Set();
 for(const f of m.files){if(typeof f.path!=='string'||!['azrael-multi-pointer.exe','THIRD_PARTY_NOTICES.md'].includes(f.path)||seen.has(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<1)throw Error('Invalid runtime member');seen.add(f.path);const p=plainFile(path.join(directory,f.path));const b=fs.readFileSync(p);if(b.length!==f.bytes||crypto.createHash('sha256').update(b).digest('hex')!==f.sha256)throw Error('Runtime integrity mismatch');if(f.path==='azrael-multi-pointer.exe')executable=p;}
 if(!executable||fs.readdirSync(directory).some(name=>name!=='manifest.json'&&!seen.has(name)))throw Error('Runtime executable missing or unrecorded runtime file');return {directory:path.resolve(directory),executable,manifest:m,manifestSha256:crypto.createHash('sha256').update(fs.readFileSync(manifestFile)).digest('hex'),sourceSha256:m.sourceSha256};
}
function createBroker({runtimeDirectory,targetsFile}){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('Multi-pointer requires local Windows x64');
 const runtime=verifyRuntime(runtimeDirectory),targets=plainFile(targetsFile);if(fs.statSync(targets).size>65536)throw Error('Target allowlist too large');
 let child,reader,pending,sequence=0,operationSequence=0,closed=false,failed=false,stderr='';
 function fail(error){failed=true;if(pending){clearTimeout(pending.timer);pending.reject(error);pending=null;}}
 function start(){if(child)return;if(closed||failed)throw Error('Broker is closed');child=spawn(runtime.executable,['--targets',targets],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  child.stderr.on('data',b=>{stderr=(stderr+b).slice(-8192);});child.on('error',fail);child.stdin.on('error',fail);
  reader=readline.createInterface({input:child.stdout,crlfDelay:Infinity});reader.on('line',line=>{try{if(line.length>MAX_LINE)throw Error('Oversized native reply');const r=JSON.parse(line);if(r.id===null&&r.error){const e=Error(r.error.message||'Native startup failed');e.details=r.error;fail(e);child.stdin.end();return;}if(!pending||r.id!==pending.id)throw Error('Unexpected native reply identity');const p=pending;pending=null;clearTimeout(p.timer);if(r.error){const e=Error(r.error.message||'Native operation failed');e.details=r.error;p.reject(e);}else if(!Object.hasOwn(r,'result')){p.reject(Error('Missing native result'));}else p.resolve(r.result);}catch(e){fail(e);child.stdin.end();}});
  child.on('close',(code,signal)=>{closed=true;fail(Error('Native broker exited '+code+' '+(signal||'')+(stderr?': '+stderr:'')));});
 }
 async function call(method,params={}){if(failed||closed)throw Error('Native broker unavailable; no replay');if(pending)throw Error('Native operation already pending');
  if(ACTUATION.has(method)){const operationId=params.operationId??operationSequence+1;if(!Number.isSafeInteger(operationId)||operationId<1)throw Error('Operation identity exhausted or invalid');operationSequence=Math.max(operationSequence,operationId);params={...params,operationId};}
  start();const id=++sequence;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{fail(Error('Native result unknown after deadline; input is not replayed'));child.stdin.end();},10000);pending={id,resolve,reject,timer};child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 }
 async function close(){if(!child){closed=true;return {started:false};}if(closed)return {exitCode:child.exitCode,signal:child.signalCode,terminationVerified:true};child.stdin.end();return new Promise(resolve=>{const timer=setTimeout(()=>resolve({exitCode:null,signal:null,terminationVerified:false}),5000);child.once('close',(exitCode,signal)=>{clearTimeout(timer);resolve({exitCode,signal,terminationVerified:true});});});}
 return {call,close};
}
function createProtocol({call,platform=process.platform}){let initialized=false;return async message=>{
 const id=message?.id;if(!message||message.jsonrpc!=='2.0'||typeof message.method!=='string')return {jsonrpc:'2.0',id:id??null,error:{code:-32600,message:'Invalid request'}};
 if(id===undefined)return null;
 if(message.method==='initialize'){initialized=true;return {jsonrpc:'2.0',id,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'azrael-multi-pointer',version:'0.2.0'},instructions:'Windows x64 shared foreground input. Logical cursors keep separate positions. Enable collaboration explicitly and check actual capability/suppression state before claiming mouse isolation. User mouse gestures queue in verified cooperative mode; physical keyboard or unsupported input stops model input. Use atomic press instead of cross-request key holds in collaboration. Recover target foreground/occlusion with bounded preparation; inspect partial effects and never replay unknown input. Reuse operationId for the same intended operation. Delivery does not verify app effects. Stop or EOF disables routing and releases tracked model input.'}};}
 if(!initialized)return {jsonrpc:'2.0',id,error:{code:-32002,message:'Initialize first'}};
 if(message.method==='ping')return {jsonrpc:'2.0',id,result:{}};
 if(message.method==='tools/list')return {jsonrpc:'2.0',id,result:{tools:platform==='win32'?toolDefinitions():[]}};
 if(message.method!=='tools/call')return {jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}};
 try{if(platform!=='win32')throw Error('Multi-pointer unavailable on this platform');const p=message.params,def=toolDefinitions().find(d=>d.name===p?.name);if(!def)throw Error('Unsupported tool');const args=validateArguments(def,p.arguments??{});const result=await call(def.name,args);return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(result)}],isError:false}};}
 catch(e){return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify({status:'failed',message:e.message,...(e.details?{details:e.details}:{}),applicationEffectVerified:false})}],isError:true}};}
};}
async function runProtocol({input=process.stdin,output=process.stdout,protocol}){
 const decoder=new StringDecoder('utf8');let buffer='';for await(const chunk of input){buffer+=typeof chunk==='string'?chunk:decoder.write(chunk);if(Buffer.byteLength(buffer)>MAX_LINE&&!buffer.includes('\n'))throw Error('MCP request too large');let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(Buffer.byteLength(line)>MAX_LINE)throw Error('MCP request too large');if(!line.trim())continue;let response;try{response=await protocol(JSON.parse(line));}catch{response={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}};}if(response)output.write(JSON.stringify(response)+'\n');}}
 buffer+=decoder.end();
 if(buffer.trim())throw Error('Incomplete MCP request at EOF');
}
async function main(){const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!['--runtime','--targets'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('Usage: --runtime <absolute-runtime-directory> --targets <absolute-allowlist.json>');options[args[i]]=args[i+1];}if(!options['--runtime']||!options['--targets'])throw Error('Runtime and target allowlist required');
 const broker=createBroker({runtimeDirectory:options['--runtime'],targetsFile:options['--targets']});const stop=()=>{broker.close().then(()=>{process.exitCode=1;process.stdin.destroy();});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{await runProtocol({protocol:createProtocol({call:broker.call})});}finally{const state=await broker.close();process.stderr.write(JSON.stringify({event:'native_closed',...state})+'\n');if(terminationFailed(state))process.exitCode=1;}
}
function terminationFailed(state){return state.started!==false&&(state.terminationVerified!==true||state.exitCode!==0||!!state.signal);}
module.exports={toolDefinitions,validateArguments,verifyRuntime,createBroker,createProtocol,runProtocol,terminationFailed};
if(require.main===module)main().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
