'use strict';
// Focused compilation and real injection into the test's own classic EDIT process.
const fs=require('node:fs');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {beginArtifactRun,trackArtifactChild,finishArtifactRun}=require('./artifact-run.cjs');
const {verifyVirtualRuntime}=require('./window-virtual-input.cjs');
const root=path.resolve(__dirname,'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function inventory(directory) {
  const out=[];
  function visit(dir,rel='') {
    for(const item of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      const file=path.join(dir,item.name),name=rel?`${rel}/${item.name}`:item.name;
      if(item.isSymbolicLink())throw new Error('Linked native input: '+name);
      if(item.isDirectory())visit(file,name);
      else if(item.isFile())out.push({path:name,sha256:sha(fs.readFileSync(file)),bytes:fs.statSync(file).size});
      else throw new Error('Unsupported native input: '+name);
    }
  }
  visit(directory);return out;
}
function fingerprint(files){return sha(JSON.stringify(files));}
function compiler() {
  const vswhere='C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe';
  const result=spawnSync(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8',windowsHide:true});
  if(result.status!==0 || !result.stdout.trim())throw new Error('MSVC x64 toolchain unavailable');
  const installation=result.stdout.trim();
  const cmake=path.join(installation,'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe');
  if(!fs.statSync(cmake).isFile())throw new Error('Installed CMake unavailable');
  return {installation,cmake};
}
async function main() {
  if(process.platform!=='win32' || process.arch!=='x64')throw new Error('Native virtual input verification requires Windows x64');
  const tools=compiler(),source=path.join(root,'native/virtual-input');
  const before=inventory(source);if(!before.some(f=>f.path==='CMakeLists.txt'))throw new Error('Native source not ready');
  // MSBuild's compiler tracking still encounters MAX_PATH in CMake scratch trees.
  // Keep the registered run ID short while preserving its full work owner.
  const run=beginArtifactRun(root,{workId:'EZ01',owner:'EZ-01-window-use-multipointer-review',runId:'vi-'+Date.now().toString(36)});
  const frozen=path.join(run.inputs,'native'),build=path.join(run.temporary,'build');
  const report={schema:1,kind:'virtual-input-native-verification',startedAt:new Date().toISOString(),sourceSha256:fingerprint(before),inputs:before,toolchain:tools,steps:[],status:'running'};
  const reportFile=path.join(run.reports,'native-results.json');let code=1;
  async function step(name,executable,args) {
    const log=path.join(run.logs,name+'.log'),start=Date.now();
    const fd=fs.openSync(log,'wx');
    const child=trackArtifactChild(run,spawn(executable,args,{cwd:frozen,windowsHide:true,stdio:['ignore','pipe','pipe']}));
    child.stdout.on('data',d=>fs.writeSync(fd,d));child.stderr.on('data',d=>fs.writeSync(fd,d));
    const outcome=await new Promise(resolve=>{let error;child.once('error',e=>{error=e.message;});child.once('close',(exitCode,signal)=>resolve({exitCode,signal,...(error?{error}:{})}));});
    fs.closeSync(fd);report.steps.push({name,executable,args,...outcome,elapsedMs:Date.now()-start,log});
    if(outcome.exitCode!==0 || outcome.signal)throw new Error(name+' failed; '+log);
    return fs.readFileSync(log,'utf8');
  }
  try {
    fs.cpSync(source,frozen,{recursive:true,errorOnExist:true,force:false});
    if(fingerprint(inventory(frozen))!==report.sourceSha256)throw new Error('Frozen native input mismatch');
    await step('configure',tools.cmake,['-S',frozen,'-B',build,'-G','Visual Studio 18 2026','-A','x64']);
    await step('compile',tools.cmake,['--build',build,'--config','Release','--target','azrael-virtual-input','azrael-virtual-input-selftest']);
    const binaries=path.join(build,'Release');
    const output=await step('selftest',path.join(binaries,'azrael-virtual-input-selftest.exe'),[]);
    if(!/^PASS: owned classic EDIT/m.test(output))throw new Error('Native selftest did not report its behavioral assertions');
    if(fingerprint(inventory(frozen))!==report.sourceSha256 || fingerprint(inventory(source))!==report.sourceSha256)throw new Error('Native inputs changed during verification');
    const runtime=path.join(run.outputs,'runtime');fs.mkdirSync(runtime);
    for(const name of ['azrael-virtual-input.exe','azrael-virtual-input-hook.dll'])fs.copyFileSync(path.join(binaries,name),path.join(runtime,name));
    fs.copyFileSync(path.join(frozen,'THIRD_PARTY_NOTICES.md'),path.join(runtime,'THIRD_PARTY_NOTICES.md'));
    const files=inventory(runtime);
    fs.writeFileSync(path.join(runtime,'manifest.json'),JSON.stringify({schema:1,kind:'azrael-virtual-input',platform:'win32',arch:'x64',sourceSha256:report.sourceSha256,files},null,2)+'\n');
    report.runtime=verifyVirtualRuntime(runtime);report.status='passed';code=0;
  } catch(error) {report.status='failed';report.error=error.stack;}
  finally {
    report.endedAt=new Date().toISOString();fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
    finishArtifactRun(run,{exitCode:code,producerStopped:[...run.children].every(c=>c.artifactClosed)});
  }
  console.log(JSON.stringify({status:report.status,exitCode:code,report:reportFile,runId:run.lifecycleId,runtime:report.runtime??null,error:report.error?.split('\n')[0]}));
  process.exitCode=code;
}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
module.exports={inventory,fingerprint};
