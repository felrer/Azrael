'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../..'),working=path.join(root,'artifacts/build/dnh1');
const {beginArtifactRun,finishArtifactRun}=require(path.join(root,'scripts/artifact-run.cjs'));
const python='C:/Users/felre/AppData/Local/Programs/Python/Python312/python.exe',helper=path.join(__dirname,'hidden-native-prep.py'),expression=path.join(__dirname,'hidden-product-expression.py');
const previous=path.join(root,'artifacts/tasks/dn01-hidden-source-preflight/runs/20261024T150251161Z-e1c07774-cc45-411b-a284-c52aff59924c');
const preflight=JSON.parse(fs.readFileSync(path.join(previous,'reports/preflight.json')));
if(preflight.fixtures.status!=='ready'||preflight.selection.commands.length!==1||preflight.selection.commands[0].name!=='source')throw Error('Preflight scope not source-only');
const controller=path.join(root,'artifacts/tasks/dn01-hidden-product-prep/runs/20261024T141917947Z-7004354d-be08-4d0e-9124-623655c63263');
const context={...JSON.parse(fs.readFileSync(path.join(controller,'reports/deployment-context.json'))),...JSON.parse(fs.readFileSync(path.join(controller,'reports/result.json')))};
if(context.projectSha256!=='cb517a60aca9906a718d0d314712475a436e47aa01dd198f3f25a52447acc89a'||context.engine.sourceSha256!=='637c0d57a76c6416324ae1683dc39abaccf79365a868527130fc3dc1bc1e9f24')throw Error('Fixed context mismatch');
const run=beginArtifactRun(root,{workId:'dn01-hidden-source-check',owner:'hidden-source-check',references:[
 {id:'workspace:9f016b7c4bf4f898b84fc5c6',kind:'dependency',reason:'Fixed working project source checks'},
 {id:preflight.lifecycleId,kind:'evidence',reason:'Retain exact changed selection and successful fixture readiness'},
 ...(process.env.AZRAEL_SOURCE_FIXTURE_LIFECYCLE?[{id:process.env.AZRAEL_SOURCE_FIXTURE_LIFECYCLE,kind:'dependency',reason:'Exact three pristine UI reference fixtures required by source manifest validation'}]:[])]});
let exitCode=1;const commands=[];const original=cp.spawnSync;
cp.spawnSync=function(command,args,options){
 let actualArgs=args;
 if(command===python){
  if(args[0]!=='-B'||args[1]!=='-c')throw Error('Unexpected supported Python invocation');
  actualArgs=['-X','utf8','-B',helper,'script',expression,...args.slice(2)];
 }
 return original.call(this,command,actualArgs,{...options,windowsHide:true});
};
const {verifyDeploymentWorkspace}=require(path.join(root,'scripts/deployment-workspace.cjs'));
const selectionInput=JSON.parse(fs.readFileSync(path.join(previous,'inputs/selection.json')));
(async()=>{
 try{
  fs.writeFileSync(path.join(run.inputs,'selection.json'),JSON.stringify({preflight:previous,context,selection:preflight.selection},null,2));
  const before=await verifyDeploymentWorkspace(context);
  fs.writeFileSync(path.join(run.reports,'inputs-before.json'),JSON.stringify(before,null,2));
  const preload=path.join(__dirname,'hidden-source-preload.cjs').replaceAll('\\','/');
  const env={...process.env,TEMP:run.temporary,TMP:run.temporary,AZRAEL_FEATURE_PRESERVATION_TEST_ROOT:path.join(run.temporary,'feature-preservation'),PATH:'C:/Users/felre/AppData/Local/Programs/Python/Python312;C:/Program Files/WindowsApps/Microsoft.PowerShell_7.6.7.0_x64__8wekyb3d8bbwe;'+process.env.PATH,NODE_OPTIONS:[process.env.NODE_OPTIONS,'--require="'+preload+'"'].filter(Boolean).join(' ')};
  const args=[...selectionInput.common,'--log-directory',path.join(run.logs,'test-project')];
  const stdout=path.join(run.logs,'test-project.stdout.log'),stderr=path.join(run.logs,'test-project.stderr.log'),out=fs.openSync(stdout,'wx'),err=fs.openSync(stderr,'wx');let child;
  try{child=original(process.execPath,args,{cwd:working,env,windowsHide:true,stdio:['ignore',out,err]});}finally{fs.closeSync(out);fs.closeSync(err);}
  commands.push({executable:process.execPath,args,exitCode:child.status,signal:child.signal,error:child.error?.message,stdout,stderr});
  fs.writeFileSync(path.join(run.reports,'commands.json'),JSON.stringify(commands,null,2));
  const after=await verifyDeploymentWorkspace(context);
  fs.writeFileSync(path.join(run.reports,'inputs-after.json'),JSON.stringify(after,null,2));
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Frozen inputs changed during source tests');
  if(child.error||child.signal||!Number.isInteger(child.status))throw Error('Source child terminal state unresolved');
  const result={lifecycleId:run.lifecycleId,runRoot:run.runRoot,scope:preflight.selection.files,concurrency:2,exitCode:child.status,inputsBeforeEqualAfter:true,before,after,commands,separateChecks:preflight.selection.separateChecks};
  fs.writeFileSync(path.join(run.reports,'result.json'),JSON.stringify(result,null,2));
  exitCode=child.status;console.log(JSON.stringify(result));
 }catch(error){console.error(error.stack);}
 finally{cp.spawnSync=original;finishArtifactRun(run,{exitCode,producerStopped:true});}
 process.exitCode=exitCode;
})().catch(error=>{console.error(error.stack);process.exitCode=1;});

