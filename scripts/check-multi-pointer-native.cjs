'use strict';
// Compilation and real stdio startup preparation; app effects are a separate acceptance step.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn,spawnSync}=require('node:child_process');
const {beginArtifactRun,trackArtifactChild,finishArtifactRun}=require('./artifact-run.cjs');
const {verifyRuntime}=require('./multi-pointer-mcp.cjs');
const root=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function inventory(dir){const out=[];function visit(d,rel=''){for(const e of fs.readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const p=path.join(d,e.name),r=rel?rel+'/'+e.name:e.name;if(e.isSymbolicLink())throw Error('Linked native input');if(e.isDirectory())visit(p,r);else if(e.isFile()){const b=fs.readFileSync(p);out.push({path:r,bytes:b.length,sha256:sha(b)});}else throw Error('Unsupported native input');}}visit(dir);return out;}
async function main(){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('Native preparation requires Windows x64');
 const args=process.argv.slice(2),renderOnly=args.length===1&&args[0]==='--render-only';
 if(!renderOnly&&(args.length!==2||args[0]!=='--targets'||!path.isAbsolute(args[1])))throw Error('--targets <absolute exact target allowlist> or --render-only required');
 const targetBytes=renderOnly?null:fs.readFileSync(args[1]);if(targetBytes?.length>65536)throw Error('Target allowlist too large');
 const tool=spawnSync('C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe',['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8',windowsHide:true});
 if(tool.status!==0||!tool.stdout.trim())throw Error('Installed MSVC required');const cmake=path.join(tool.stdout.trim(),'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe');
 const source=path.join(root,'native/multi-pointer'),before=inventory(source),scripts=['multi-pointer-mcp.cjs','test-multi-pointer-mcp.cjs','check-multi-pointer-native.cjs'];
 const extra=['native/virtual-input/vendor/json/single_include/nlohmann/json.hpp','native/virtual-input/vendor/json/LICENSE.MIT',...scripts.map(s=>'scripts/'+s)];
 const selected=extra.map(p=>{const b=fs.readFileSync(path.join(root,p));return {path:p,bytes:b.length,sha256:sha(b)};});
 const run=beginArtifactRun(root,{workId:'EZ01',owner:'EZ-01-window-use-multipointer-review',runId:'mp-'+Date.now().toString(36)});
 const report={schema:1,kind:'multi-pointer-native-preparation',scope:renderOnly?'native-render-no-app-input':'target-stdio',startedAt:new Date().toISOString(),runId:run.lifecycleId,runRoot:run.runRoot,status:'running',sourceSha256:sha(JSON.stringify({native:before,selected})),native:before,selected,steps:[],applicationEffectVerified:false};
 const file=path.join(run.reports,'native-results.json');let code=1;const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
 async function step(name,exe,args,input){const fd=fs.openSync(path.join(run.logs,name+'.log'),'wx'),start=Date.now(),chunks=[];const child=trackArtifactChild(run,spawn(exe,args,{cwd:run.inputs,windowsHide:true,stdio:[input===undefined?'ignore':'pipe','pipe','pipe']}));
 child.stdout.on('data',b=>{fs.writeSync(fd,b);chunks.push(b);});child.stderr.on('data',b=>fs.writeSync(fd,b));if(input!==undefined)child.stdin.end(input);
 const outcome=await new Promise(r=>{let error;child.on('error',e=>error=e.message);child.on('close',(exitCode,signal)=>r({exitCode,signal,error}));});fs.closeSync(fd);report.steps.push({name,...outcome,elapsedMs:Date.now()-start,log:path.join(run.logs,name+'.log')});save();if(outcome.exitCode!==0||outcome.signal)throw Error(name+' failed');return Buffer.concat(chunks).toString('utf8');}
 console.log(JSON.stringify({runId:run.lifecycleId,runRoot:run.runRoot}));save();
 try{
  const frozen=path.join(run.inputs,'native/multi-pointer');fs.mkdirSync(path.dirname(frozen),{recursive:true});fs.cpSync(source,frozen,{recursive:true,force:false,errorOnExist:true});
  for(const f of selected){const d=path.join(run.inputs,f.path);fs.mkdirSync(path.dirname(d),{recursive:true});fs.copyFileSync(path.join(root,f.path),d,fs.constants.COPYFILE_EXCL);if(sha(fs.readFileSync(d))!==f.sha256)throw Error('Frozen input mismatch');}
  const targets=path.join(run.inputs,'targets.json');if(targetBytes){fs.writeFileSync(targets,targetBytes,{flag:'wx'});report.targetsSha256=sha(targetBytes);}
  if(sha(JSON.stringify(inventory(frozen)))!==sha(JSON.stringify(before)))throw Error('Frozen native mismatch');
  await step('mcp-source',process.execPath,['--test',path.join(run.inputs,'scripts/test-multi-pointer-mcp.cjs')]);
  const build=path.join(run.temporary,'build');await step('configure',cmake,['-S',frozen,'-B',build,'-G','Visual Studio 18 2026','-A','x64']);await step('compile',cmake,['--build',build,'--config','Release','--target','azrael-multi-pointer']);
  await step('compile-raw-origin-selftest',cmake,['--build',build,'--config','Release','--target','azrael-multi-pointer-raw-origin-selftest']);
  await step('raw-origin-selftest',path.join(build,'Release/azrael-multi-pointer-raw-origin-selftest.exe'),[]);
  await step('system-cursor-guard-selftest',path.join(build,'Release/azrael-multi-pointer.exe'),['--cursor-guard-selftest']);
  const renderOutput=await step('cursor-render-selftest',path.join(build,'Release/azrael-multi-pointer.exe'),['--cursor-render-selftest',run.reports]);
  const rendered=JSON.parse(renderOutput.trim());if(rendered.kind!=='cursor-render-selftest'||rendered.checks<10||rendered.applicationInputs!==0||rendered.cursorVisibilityChanged!==false)throw Error('Native rendering checks incomplete');
  report.cursorRendering=rendered;
  if(sha(JSON.stringify(inventory(source)))!==sha(JSON.stringify(before))||sha(JSON.stringify(inventory(frozen)))!==sha(JSON.stringify(before)))throw Error('Native source changed during preparation');
  for(const f of selected)if(sha(fs.readFileSync(path.join(root,f.path)))!==f.sha256||sha(fs.readFileSync(path.join(run.inputs,f.path)))!==f.sha256)throw Error('Selected input changed');
  const runtime=path.join(run.outputs,'runtime');fs.mkdirSync(runtime);fs.copyFileSync(path.join(build,'Release/azrael-multi-pointer.exe'),path.join(runtime,'azrael-multi-pointer.exe'));
  fs.writeFileSync(path.join(runtime,'THIRD_PARTY_NOTICES.md'),'# Third-party notices\n\nJSON for Modern C++ v3.11.3 (https://github.com/nlohmann/json/releases/tag/v3.11.3)\n\n'+fs.readFileSync(path.join(run.inputs,'native/virtual-input/vendor/json/LICENSE.MIT'),'utf8')+'\n\n'+fs.readFileSync(path.join(frozen,'CURSOR-NOTICES.md'),'utf8'));
  fs.writeFileSync(path.join(runtime,'manifest.json'),JSON.stringify({schema:1,kind:'azrael-multi-pointer',platform:'win32',arch:'x64',sourceSha256:report.sourceSha256,files:inventory(runtime)},null,2)+'\n');verifyRuntime(runtime);report.runtime=runtime;
  if(!renderOnly){
  const messages=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'status',arguments:{}}},{jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'stop',arguments:{}}}];
  const output=await step('mcp-native-stdio',process.execPath,[path.join(run.inputs,'scripts/multi-pointer-mcp.cjs'),'--runtime',runtime,'--targets',targets],messages.map(JSON.stringify).join('\n')+'\n');
  const replies=output.trim().split('\n').map(JSON.parse);for(const id of[1,2,3,4]){const r=replies.find(r=>r.id===id);if(!r||r.error||r.result?.isError)throw Error('Actual MCP startup failed for request '+id);}
  fs.writeFileSync(path.join(run.reports,'stdio-smoke.json'),JSON.stringify(replies,null,2)+'\n');
  }report.status='prepared';code=0;
 }catch(e){report.status='failed';report.error=e.stack;}
 finally{report.endedAt=new Date().toISOString();save();finishArtifactRun(run,{exitCode:code,producerStopped:[...run.children].every(c=>c.artifactClosed)});}
 console.log(JSON.stringify({status:report.status,exitCode:code,report:file,runId:run.lifecycleId,runtime:report.runtime,error:report.error?.split('\n')[0]}));process.exitCode=code;
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={inventory};
