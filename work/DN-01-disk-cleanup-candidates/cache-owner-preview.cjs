'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const modules=process.argv[2]==='modules';
if(process.argv.length>3||(process.argv[2]&&!modules))throw Error('Only optional modules preview is supported');
const {beginArtifactRun,finishArtifactRun}=require(path.join(root,'scripts/artifact-run.cjs'));
const run=beginArtifactRun(root,{workId:modules?'dn01-module-cache-preview':'dn01-cache-owner-preview',owner:'disk-cleanup-cache-review'});
const sources=modules?['work/DN-01-disk-cleanup-candidates/module-cache-preview.ps1','scripts/build-module-cache.ps1','scripts/artifact-lifecycle.ps1']:['scripts/clean-engine-caches.ps1','scripts/artifact-lifecycle.ps1'];
const snapshot=()=>Object.fromEntries(sources.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
let exitCode=1;
try {
  const before=snapshot();fs.writeFileSync(path.join(run.inputs,'owner-sources.json'),JSON.stringify(before,null,2));
  const executable='C:/Program Files/WindowsApps/Microsoft.PowerShell_7.6.7.0_x64__8wekyb3d8bbwe/pwsh.exe';
  const args=['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(root,sources[0]),'-ProjectRoot',root];
  const stdout=path.join(run.logs,'preview.stdout.log'),stderr=path.join(run.logs,'preview.stderr.log');
  const out=fs.openSync(stdout,'wx'),err=fs.openSync(stderr,'wx');let result;
  try{result=cp.spawnSync(executable,args,{cwd:root,windowsHide:true,stdio:['ignore',out,err]});}finally{fs.closeSync(out);fs.closeSync(err);}
  if(result.error||result.signal||!Number.isInteger(result.status))throw Error('Preview terminal outcome unresolved: '+(result.error?.message||result.signal));
  if(JSON.stringify(before)!==JSON.stringify(snapshot()))throw Error('Preview owner sources changed');
  const report=JSON.parse(fs.readFileSync(stdout,'utf8').replace(/^\uFEFF/,''));
  const evidence={lifecycleId:run.lifecycleId,runRoot:run.runRoot,executable,args,exitCode:result.status,sourceUnchanged:true,report};
  fs.writeFileSync(path.join(run.reports,'result.json'),JSON.stringify(evidence,null,2));
  exitCode=result.status;
  console.log(JSON.stringify({runRoot:run.runRoot,exitCode,status:report.status,errors:report.errors,candidates:report.candidates.filter(x=>x.status!=='unmanaged')}));
}catch(error){console.error(error.stack);}finally{finishArtifactRun(run,{exitCode,producerStopped:true});}
process.exitCode=exitCode;
