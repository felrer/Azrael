'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),childProcess=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const {beginArtifactRun,finishArtifactRun}=require(path.join(root,'scripts/artifact-run.cjs'));
const lifecycle=require(path.join(root,'scripts/artifact-lifecycle.cjs'));
const python='C:/Users/felre/AppData/Local/Programs/Python/Python312/python.exe';
const helper=path.join(__dirname,'hidden-native-prep.py'),expression=path.join(__dirname,'hidden-product-expression.py');
const expectedEngine='637c0d57a76c6416324ae1683dc39abaccf79365a868527130fc3dc1bc1e9f24';
const expectedReceipt='64c38e2710ff8fe001a76f621439105587c4bc608009ecd72d8f998738da6ab3';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const engine=path.join(root,'engine'),receipt=path.join(engine,'SOURCE.json');
if(hash(fs.readFileSync(receipt))!==expectedReceipt)throw Error('Engine SOURCE changed before deployment capture');
let suffix='dnh1';
for(let attempt=1;fs.existsSync(path.join(root,'artifacts/build',suffix))||fs.existsSync(path.join(root,'artifacts/build',suffix+'i'));attempt++)suffix='dnh'+(attempt+1);
const inputRoot=path.join(root,'artifacts/build',suffix+'i'),workingRoot=path.join(root,'artifacts/build',suffix);
const owner='dn01-hidden-product-prep';
const run=beginArtifactRun(root,{workId:owner,owner,references:[{id:'handoff:dn01-hidden-product-build',kind:'dependency',reason:'Retain controller evidence and prepared project roots for explicitly approved downstream product build'}]});
const commands=[];let exitCode=1,context;
const originalSpawnSync=childProcess.spawnSync;
childProcess.spawnSync=function(command,args,options){
 let actualArgs=args;
 if(command===python){
  if(args[0]!=='-B'||args[1]!=='-c')throw Error('Unexpected supported Python invocation');
  actualArgs=['-X','utf8','-B',helper,'script',expression,...args.slice(2)];
 }
 const result=originalSpawnSync(command,actualArgs,{...options,windowsHide:true});
 const name=String(commands.length+1).padStart(3,'0'),log=path.join(run.logs,'child-'+name+'.log');
 fs.writeFileSync(log,Buffer.concat([Buffer.from(result.stdout||''),Buffer.from(result.stderr||'')]),{flag:'wx'});
 commands.push({sequence:commands.length+1,command,args,actualArgs,exitCode:result.status,signal:result.signal,error:result.error?.message,windowsHide:true,inputSha256:options?.input===undefined?null:hash(options.input),log});
 fs.writeFileSync(path.join(run.reports,'commands.json'),JSON.stringify(commands,null,2));
 return result;
};
// Load the supported owner after installing the task-local visibility wrapper.
const {prepareDeploymentWorkspace,verifyDeploymentWorkspace}=require(path.join(root,'scripts/deployment-workspace.cjs'));
(async()=>{
 try{
  const reportPath=path.join(run.reports,'deployment-context.json');
  fs.writeFileSync(path.join(run.inputs,'selection.json'),JSON.stringify({projectRoot:root,artifactProjectRoot:root,inputRoot,workingRoot,engineSourceRoot:engine,expectedEngine,expectedReceipt,pythonExecutable:python},null,2));
  context=await prepareDeploymentWorkspace({projectRoot:root,artifactProjectRoot:root,inputRoot,workingRoot,owner,runLifecycleId:run.lifecycleId,reportPath,engineSourceRoot:engine,pythonExecutable:python});
  run.record=context.runRecord;
  if(context.engine.sourceSha256!==expectedEngine||context.engine.importedReceiptSha256!==expectedReceipt)throw Error('Prepared engine differs from accepted native input');
  const verified=await verifyDeploymentWorkspace(context);
  if(verified.status!=='verified'||verified.engine.sourceSha256!==expectedEngine)throw Error('Deployment input verification differs');
  const current=lifecycle.catalog(root).find(r=>r.id===run.lifecycleId);
  run.record=lifecycle.recordLifecycle(root,{...current,expected_revision:current.revision,references:[...current.references,
   {id:context.inputLifecycleId,kind:'dependency',reason:'Immutable project inputs retained for downstream product build'},
   {id:context.workingLifecycleId,kind:'dependency',reason:'Prepared working source retained for downstream product build'}]});
  fs.writeFileSync(path.join(run.reports,'verified.json'),JSON.stringify(verified,null,2));
  const result={readiness:'READY',controllerLifecycleId:run.lifecycleId,controllerRunRoot:run.runRoot,inputRoot,immutableProjectRoot:context.immutableProjectRoot,workingRoot,immutableEngineRoot:context.immutableEngineRoot,workingEngineRoot:context.workingEngineRoot,engine:context.engine,projectSha256:context.projectSha256,reportPath,manifestSha256:context.manifestSha256,inputLifecycleId:context.inputLifecycleId,workingLifecycleId:context.workingLifecycleId,timings:context.timings,workingProducer:'pending downstream build; not marked complete',commands:commands.length};
  fs.writeFileSync(path.join(run.reports,'result.json'),JSON.stringify(result,null,2));
  exitCode=0;console.log(JSON.stringify(result));
 }catch(error){console.error(error.stack);}
 finally{
  // The supported preparation owner may have advanced the controller before failure.
  const current=lifecycle.catalog(root).find(r=>r.id===run.lifecycleId);if(current)run.record=current;
  finishArtifactRun(run,{exitCode,producerStopped:true});
  const records=lifecycle.catalog(root),ids=[run.lifecycleId,...(context?[context.inputLifecycleId,context.workingLifecycleId]:[])];
  fs.writeFileSync(path.join(run.reports,'lifecycle-handoff.json'),JSON.stringify(records.filter(r=>ids.includes(r.id)),null,2));
  childProcess.spawnSync=originalSpawnSync;
 }
 process.exitCode=exitCode;
})().catch(error=>{console.error(error.stack);process.exitCode=1;});

