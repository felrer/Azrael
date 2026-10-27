'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),{beginArtifactRun,finishArtifactRun}=require(path.join(root,'scripts/artifact-run.cjs'));
const python='C:/Users/felre/AppData/Local/Programs/Python/Python312/python.exe',helper=path.join(__dirname,'hidden-native-prep.py');
const previous=path.join(root,'artifacts/tasks/dn01-hidden-native-prep/runs/20261024T140108015Z-a53822db-1c9a-4590-98c8-d356e115b61b');
const expected='64c38e2710ff8fe001a76f621439105587c4bc608009ecd72d8f998738da6ab3';
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const receipt=path.join(root,'engine/SOURCE.json');
if(digest(receipt)!==expected)throw Error('Updated SOURCE changed; reassessment required');
const previousProducer=JSON.parse(fs.readFileSync(path.join(previous,'reports/producer.json')));
if(previousProducer.exitCode!==1||previousProducer.producerStopped!==true)throw Error('Previous producer unresolved');
const run=beginArtifactRun(root,{workId:'dn01-hidden-native-freeze',owner:'hidden-native-prep',
 paths:{outputs:path.join(root,'artifacts/verification/dn01-hidden-native-input')},
 references:[{id:previousProducer.lifecycleId,reason:'Retain original validated baseline, successful exact-delta recorder evidence and failed long-path verification evidence'},
 {id:'handoff:dn01-hidden-native-source',reason:'Frozen engine input for downstream native checks and build; retain until consumers release'}]});
let exitCode=1;const commands=[];
function execute(name,args){
 const log=path.join(run.logs,name+'.log'),fd=fs.openSync(log,'wx');let result;
 try{result=spawnSync(python,['-X','utf8','-B',helper,...args],{cwd:root,windowsHide:true,stdio:['ignore',fd,fd]});}finally{fs.closeSync(fd);}
 commands.push({name,executable:python,args,exitCode:result.status,signal:result.signal,error:result.error?.message,log});
 fs.writeFileSync(path.join(run.reports,'commands.json'),JSON.stringify(commands,null,2));
 if(result.error||result.status!==0)throw Error(name+' failed; '+log);
}
try{
 const frozen=path.join(run.outputs,'engine'),baseline=path.join(previous,'temporary/original-baseline');
 fs.writeFileSync(path.join(run.inputs,'reuse.json'),JSON.stringify({previousProducer,baseline,receiptBefore:expected,reason:'Only copy validation path handling changed; reuse successful guarded recording and original validated baseline. Short owned output avoids downstream Windows path limits.'},null,2));
 execute('freeze-engine-source',['copy',path.join(root,'engine'),frozen,path.join(run.reports,'frozen-source.json')]);
 execute('frozen-import-check',['script',path.join(root,'scripts/import-engine-source.py'),'--check','--snapshot-only','--destination',frozen]);
 execute('frozen-source-snapshot',['script',path.join(root,'scripts/engine-provenance.py'),'snapshot','--root',frozen,'--file',path.join(run.reports,'engine-snapshot.json')]);
 if(digest(receipt)!==expected)throw Error('SOURCE changed while freezing');
 const result={lifecycleId:run.lifecycleId,runRoot:run.runRoot,previousProducer:previousProducer.lifecycleId,baseline,frozen,receiptSha256:expected,snapshot:JSON.parse(fs.readFileSync(path.join(run.reports,'engine-snapshot.json'))),commands};
 fs.writeFileSync(path.join(run.reports,'result.json'),JSON.stringify(result,null,2));exitCode=0;console.log(JSON.stringify(result));
}catch(error){console.error(error.stack);}finally{finishArtifactRun(run,{exitCode,producerStopped:true});}
process.exitCode=exitCode;

