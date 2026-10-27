'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),working=path.join(root,'artifacts/build/dnh1');
const {beginArtifactRun,finishArtifactRun}=require(path.join(root,'scripts/artifact-run.cjs'));
const changed=['engine/codex-rs/project-maintenance/src/paths.rs','engine/codex-rs/project-maintenance/Cargo.toml','engine/codex-rs/Cargo.lock','engine/SOURCE.json','scripts/test-project-maintenance.cjs','scripts/azrael-feature-contracts.json','docs/architecture/project-maintenance.md'];
const run=beginArtifactRun(root,{workId:'dn01-hidden-source-preflight',owner:'hidden-source-preflight',references:[{id:'workspace:9f016b7c4bf4f898b84fc5c6',kind:'dependency',reason:'Source selection and fixture readiness for fixed downstream working project'}]});
let exitCode=1;const commands=[];
try{
 const common=['scripts/test-project.cjs','--changed-only','--test-concurrency','2',...changed.flatMap(p=>['--changed',p])];
 const preload=path.join(__dirname,'hidden-source-preload.cjs').replaceAll('\\','/');
 const env={...process.env,PATH:'C:/Users/felre/AppData/Local/Programs/Python/Python312;C:/Users/felre/.cargo/bin;C:/Program Files/WindowsApps/Microsoft.PowerShell_7.6.7.0_x64__8wekyb3d8bbwe;'+process.env.PATH,NODE_OPTIONS:[process.env.NODE_OPTIONS,'--require="'+preload+'"'].filter(Boolean).join(' ')};
 fs.writeFileSync(path.join(run.inputs,'selection.json'),JSON.stringify({working,changed,common,concurrency:2},null,2));
 for(const [name,flag] of [['list','--list'],['fixtures','--check-fixtures']]){
  const stdout=path.join(run.logs,name+'.stdout.json'),stderr=path.join(run.logs,name+'.stderr.log'),out=fs.openSync(stdout,'wx'),err=fs.openSync(stderr,'wx');let result;
  try{result=spawnSync(process.execPath,[...common,flag],{cwd:working,env,windowsHide:true,stdio:['ignore',out,err]});}finally{fs.closeSync(out);fs.closeSync(err);}
  commands.push({name,args:[...common,flag],exitCode:result.status,signal:result.signal,error:result.error?.message,stdout,stderr});fs.writeFileSync(path.join(run.reports,'commands.json'),JSON.stringify(commands,null,2));
  if(result.error||result.status!==0)throw Error(name+' failed; '+stdout+'; '+stderr);
 }
 const list=JSON.parse(fs.readFileSync(path.join(run.logs,'list.stdout.json'),'utf8')),fixtures=JSON.parse(fs.readFileSync(path.join(run.logs,'fixtures.stdout.json'),'utf8'));
 fs.writeFileSync(path.join(run.reports,'preflight.json'),JSON.stringify({runRoot:run.runRoot,lifecycleId:run.lifecycleId,selection:list,fixtures,commands},null,2));
 exitCode=0;console.log(JSON.stringify({runRoot:run.runRoot,lifecycleId:run.lifecycleId,files:list.files,commands:list.commands,fixtures,separateChecks:list.separateChecks}));
}catch(error){console.error(error.stack);}finally{finishArtifactRun(run,{exitCode,producerStopped:true});}
process.exitCode=exitCode;

