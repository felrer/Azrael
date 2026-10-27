'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const {beginArtifactRun,finishArtifactRun}=require(path.join(root,'scripts/artifact-run.cjs'));
const python='C:/Users/felre/AppData/Local/Programs/Python/Python312/python.exe';
const helper=path.join(__dirname,'hidden-native-prep.py');
const selected=['codex-rs/project-maintenance/src/paths.rs','codex-rs/project-maintenance/Cargo.toml','codex-rs/Cargo.lock'];
const expectedCurrent='1a097f655316e16e4be0f7f5c93f28a84c5149512782ef44c827b6348d5e96fd';
const baselineSha='12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6';
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const receipt=path.join(root,'engine/SOURCE.json');
if(digest(receipt)!==expectedCurrent)throw Error('Current SOURCE changed; reassessment required');
const run=beginArtifactRun(root,{workId:'dn01-hidden-native-prep',owner:'hidden-native-prep',
 references:[{id:'handoff:dn01-hidden-native-source',reason:'Retain original baseline and frozen engine input until native validation/build consumer releases them'}]});
const commands=[];let exitCode=1;
function execute(name,executable,args){
 const log=path.join(run.logs,name+'.log'),fd=fs.openSync(log,'wx');
 let result;try{result=spawnSync(executable,args,{cwd:root,windowsHide:true,stdio:['ignore',fd,fd]});}finally{fs.closeSync(fd);}
 commands.push({name,executable,args,exitCode:result.status,signal:result.signal,error:result.error?.message,log});
 fs.writeFileSync(path.join(run.reports,'commands.json'),JSON.stringify(commands,null,2));
 if(result.error||result.status!==0)throw Error(name+' failed; '+log);
}
function script(name,file,args){execute(name,python,['-X','utf8','-B',helper,'script',path.join(root,'scripts',file),...args]);}
try{
 const archive=path.join(run.outputs,'original-engine.tar'),baseline=path.join(run.temporary,'original-baseline'),frozen=path.join(run.outputs,'engine');
 fs.mkdirSync(baseline);
 fs.copyFileSync(receipt,path.join(run.inputs,'SOURCE.before.json'));
 fs.writeFileSync(path.join(run.inputs,'anchors.json'),JSON.stringify({baselineSha,expectedCurrent,commit:'ccbcbf93906a72cc7654aa9c57c670d5e2e3831d',selected},null,2));
 execute('raw-git-archive','git',['-c','core.autocrlf=false','archive','--format=tar','--output='+archive,'ccbcbf93906a72cc7654aa9c57c670d5e2e3831d:engine']);
 execute('recover-original-baseline',python,['-X','utf8','-B',helper,'baseline',archive,baseline,path.join(__dirname,'temp-delete-evidence-20261024/original-blob-recovery.json'),path.join(run.reports,'baseline-recovery.json')]);
 script('baseline-check','import-engine-source.py',['--check','--snapshot-only','--destination',baseline]);
 if(digest(receipt)!==expectedCurrent)throw Error('Current SOURCE changed before recorder');
 script('record-exact-local-delta','record-engine-local-changes.py',['--destination',path.join(root,'engine'),'--baseline',baseline,'--baseline-receipt-sha256',baselineSha,'--current-receipt-sha256',expectedCurrent,...selected.flatMap(name=>['--expected-path',name])]);
 fs.copyFileSync(receipt,path.join(run.reports,'SOURCE.after.json'));
 execute('freeze-engine-source',python,['-X','utf8','-B',helper,'copy',path.join(root,'engine'),frozen,path.join(run.reports,'frozen-source.json')]);
 script('frozen-import-check','import-engine-source.py',['--check','--snapshot-only','--destination',frozen]);
 script('frozen-source-snapshot','engine-provenance.py',['snapshot','--root',frozen,'--file',path.join(run.reports,'engine-snapshot.json')]);
 const result={lifecycleId:run.lifecycleId,runRoot:run.runRoot,baseline,frozen,receiptBefore:expectedCurrent,receiptAfter:digest(receipt),selected,snapshot:JSON.parse(fs.readFileSync(path.join(run.reports,'engine-snapshot.json'))),commands};
 fs.writeFileSync(path.join(run.reports,'result.json'),JSON.stringify(result,null,2));
 exitCode=0;console.log(JSON.stringify(result));
}catch(error){console.error(error.stack);}
finally{finishArtifactRun(run,{exitCode,producerStopped:true});}
process.exitCode=exitCode;

