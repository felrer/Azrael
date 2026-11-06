'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const owner=require('../../scripts/artifact-run.cjs');
const root=path.resolve(__dirname,'../..');
const active=cp.execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-Process chkdsk,defrag -ErrorAction SilentlyContinue).Count"],{encoding:'utf8',windowsHide:true}).trim();
if(active!=='0') throw Error('Disk check/optimization active; do not overlap read probe');
const manifestPath=path.join(root,'artifacts/tasks/FT-02-k-inputs/runs/20261105T001605110Z-1f65e40b-a129-4267-96bf-d798291a90cc/reports/deployment-workspace.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const inputRelative=path.relative(root,fs.realpathSync(manifest.inputRoot));
if(!inputRelative||inputRelative.startsWith('..')||path.isAbsolute(inputRelative)) throw Error('Input root must remain within project');
const groups=new Map();
for(const entry of manifest.immutableInventory.files){
  if(!entry.path.startsWith('project/')||entry.path.startsWith('project/.git/')) continue;
  const group=entry.path.split('/')[1];
  if(!groups.has(group)) groups.set(group,[]);
  groups.get(group).push(entry);
}
const selected=[];
for(const group of groups.values()){
  for(let i=0;i<Math.min(20,group.length);i++) selected.push(group[Math.floor(i*group.length/Math.min(20,group.length))]);
}
const run=owner.beginArtifactRun(root,{workId:'FU-01-build-read-probe',owner:'FU-01-cpu-cooling-diagnosis',references:[{id:manifest.inputLifecycleId,kind:'dependency',reason:'Read-only probe consumes exact frozen build inputs'}]});
for(const name of ['probe-build-reads.py','monitor.py','start-build-read-probe.cjs']) fs.copyFileSync(path.join(__dirname,name),path.join(run.inputs,name),fs.constants.COPYFILE_EXCL);
const selection=path.join(run.inputs,'selection.json');
fs.writeFileSync(selection,JSON.stringify({manifestPath,root:manifest.inputRoot,files:selected},null,2));
const log=fs.openSync(path.join(run.logs,'probe.log'),'wx');
const child=owner.trackArtifactChild(run,cp.spawn('C:/Users/felre/AppData/Local/Programs/Python/Python313/python.exe',['-B',path.join(run.inputs,'probe-build-reads.py'),selection,run.outputs],{cwd:root,windowsHide:true,stdio:['ignore',log,log]}));
console.log(JSON.stringify({runRoot:run.runRoot,selected:selected.length,pid:child.pid}));
child.on('error',error=>console.error(error));
child.on('close',(exitCode,signal)=>{
  fs.closeSync(log);
  fs.writeFileSync(path.join(run.reports,'result.json'),JSON.stringify({exitCode,signal,endedUtc:new Date().toISOString()}));
  owner.finishArtifactRun(run,{exitCode,signal,producerStopped:true});
  console.log(JSON.stringify({exitCode,signal,runRoot:run.runRoot}));
  process.exitCode=exitCode??1;
});
