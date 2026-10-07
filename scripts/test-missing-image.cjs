"use strict";
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const ts=require('../extensions/azrael-ex/node_modules/typescript');
const {ASSETS,injectMissingImage,MARKER}=require('./inject-missing-image.cjs');
const root=path.join(__dirname,'../artifacts/upstream-ui/26.930.61225');
const inputs=ASSETS.map(asset=>{const source=fs.readFileSync(path.join(root,asset),'utf8');return {asset,source,result:injectMissingImage(source,asset)}});
function named(source,name){const ast=ts.createSourceFile('fixture.js',source,99,true,1);const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(node,name);return node.getText(ast)}
test('pinned transforms parse, are idempotent and reject anchor drift',()=>{
 for(const {asset,source,result} of inputs){assert.equal(result.count,1);assert.equal(ts.createSourceFile(asset,result.text,99,false,1).parseDiagnostics.length,0);assert.deepEqual(injectMissingImage(result.text,asset),{text:result.text,count:0});assert.throws(()=>injectMissingImage('changed upstream',asset),/anchor must be unique/);assert.throws(()=>injectMissingImage(source+source,asset),/anchor must be unique/);assert.throws(()=>injectMissingImage(result.text.replace(MARKER,MARKER+MARKER),asset),/Invalid missing-image/)}
 assert.deepEqual(injectMissingImage('unrelated','other.js'),{text:'unrelated',count:0});
});
test('actual host read route separates absent files from permission failures',async()=>{
 const source=inputs[0].result.text,ast=ts.createSourceFile('host.js',source,99,true,1);let route;
 function visit(n){if(ts.isPropertyAssignment(n)&&n.name.getText(ast)==='"read-file-binary"')route=n.initializer.getText(ast);ts.forEachChild(n,visit)}visit(ast);assert.ok(route);
 let failure=null;
 const context={Buffer,Error,TN:async()=>null,bX:x=>x,oA:async()=>null,LZ:{isAbsolute:()=>true},BZ:()=>[],Yf:{Uri:{file:x=>x},workspace:{}},wn:{workspace:{fs:{readFile:async()=>{if(failure)throw failure;return Buffer.from('image')}}}}};
 context.FZ=vm.runInNewContext('('+named(source,'FZ')+')',context);
 context.jl=vm.runInNewContext('('+named(source,'jl')+')',context);
 const read=vm.runInNewContext('('+route+')',context).bind({appServerClient:{}});
 assert.equal((await read({path:'/image.png'})).contentsBase64,Buffer.from('image').toString('base64'));
 for(const code of ['ENOENT','FileNotFound']){failure=Object.assign(new Error('absent'),{code});assert.deepEqual(JSON.parse(JSON.stringify(await read({path:'/absent.png'}))),{contentsBase64:null,fileNotFound:true})}
 for(const code of ['EACCES','ABORT_ERR']){failure=Object.assign(new Error(code),{code});await assert.rejects(read({path:'/image.png'}),/Unable to read file/)}
 assert.deepEqual(JSON.parse(JSON.stringify(await read({path:'https://example.com/image.png'}))),{contentsBase64:null});
});
test('actual BC/mSt invoke missing callback only for explicit absence',async()=>{
 const source=inputs[1].result.text;let response,signalSeen,warnings=0;
 const context={VC:x=>x,gSt:()=> 'image/png',hg:async(_,{signal})=>{signalSeen=signal;if(response instanceof Error)throw response;return response},dg:()=>[],uh:{FIVE_MINUTES:1},al:()=>false,Eh:{warning:()=>warnings++},AbortSignal};
 context.mSt=vm.runInNewContext('('+named(source,'mSt')+')',context);const read=vm.runInNewContext('('+named(source,'BC')+')',context);
 const query={fetchQuery:({queryFn})=>queryFn({signal:new AbortController().signal})};let missing=0;
 const call=()=>read('/image.png','local',query,undefined,'thread',undefined,()=>missing++);
 response={contentsBase64:null,fileNotFound:true};assert.equal(await call(),null);assert.equal(missing,1);
 for(response of [{contentsBase64:null},{contentsBase64:null,fileNotFound:false},new Error('permission'),Object.assign(new Error('cancelled'),{name:'AbortError'})]){assert.equal(await call(),null);assert.equal(missing,1)}
 assert.equal(warnings,2);assert.ok(signalSeen instanceof AbortSignal);
 response={contentsBase64:'aW1hZ2U='};assert.equal(await call(),'data:image/png;base64,aW1hZ2U=');assert.equal(missing,1);
});
