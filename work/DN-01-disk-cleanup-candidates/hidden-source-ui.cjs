'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),working=path.join(root,'artifacts/build/dnh1');
const {beginArtifactRun,finishArtifactRun}=require(path.join(root,'scripts/artifact-run.cjs'));
const lifecycle=require(path.join(root,'scripts/artifact-lifecycle.cjs'));
const selected=[['header-57b689833777.js',36967],['app-initial-97d3534ad35f.js',7600734],['app-initial-7a199c66e670.js',6116253]];
const prefix='artifacts/upstream-ui/26.1007.21434/webview/assets/';
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run=beginArtifactRun(root,{workId:'dn01-hidden-source-ui',owner:'hidden-source-ui',references:[{id:'workspace:9f016b7c4bf4f898b84fc5c6',kind:'dependency',reason:'Three exact pristine reference fixtures for fixed working project SOURCE validation'}]});
let exitCode=1,fixtureRecord,copyCompleted=false;const fixtureId='work:dn01-hidden-source-ui:'+run.runId;
const owner='hidden-source-ui';let child;
try{
 const artifactPaths=manifest=>{
  const result=new Set();function walk(v){if(typeof v==='string'&&v.startsWith('artifacts/'))result.add(v);else if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')Object.values(v).forEach(walk);}walk(manifest);return [...result].sort();
 };
 const exact=selected.map(([name])=>prefix+name).sort();
 for(const project of [root,working]){
  const actual=artifactPaths(JSON.parse(fs.readFileSync(path.join(project,'scripts/azrael-feature-contracts.json'),'utf8')));
  if(JSON.stringify(actual)!==JSON.stringify(exact))throw Error('Additional or changed artifact dependency; scope decision required');
 }
 const files=selected.map(([name,size])=>{
  const source=path.join(root,prefix,name),target=path.join(working,prefix,name),stat=fs.lstatSync(source);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==size)throw Error('Original fixture differs: '+name);
  if(fs.existsSync(target))throw Error('Fixture destination already exists: '+target);
  return {name,source,target,size,sha256:sha(source),identity:{dev:stat.dev,ino:stat.ino,mtimeMs:stat.mtimeMs}};
 });
 fs.writeFileSync(path.join(run.inputs,'planned-fixtures.json'),JSON.stringify({files,temporaryBudgetBytes:150*1024*1024,basis:'Prior 33-case scope uses only short synthetic fixture writes and mocked native/build execution; no downloads or large file generation.'},null,2));
 fixtureRecord=lifecycle.recordLifecycle(root,{id:fixtureId,kind:'work',owner,state:'pending',membership_complete:false,members:files.map(f=>({path:f.target,role:'fixture',generated:true,protection_known:true})),references:[],expected_revision:0});
 run.record=lifecycle.recordLifecycle(root,{...run.record,expected_revision:run.record.revision,references:[...run.record.references,{id:fixtureId,kind:'dependency',reason:'Retain exact approved UI fixtures and copy provenance through downstream source/product acceptance'}]});
 for(const file of files){
  fs.mkdirSync(path.dirname(file.target),{recursive:true});
  fs.copyFileSync(file.source,file.target,fs.constants.COPYFILE_EXCL);
  const stat=fs.lstatSync(file.source),copy=fs.lstatSync(file.target);
  if(!copy.isFile()||copy.isSymbolicLink()||copy.size!==file.size||sha(file.source)!==file.sha256||sha(file.target)!==file.sha256||stat.dev!==file.identity.dev||stat.ino!==file.identity.ino||stat.mtimeMs!==file.identity.mtimeMs)throw Error('Original/copy identity changed: '+file.name);
 }
 const evidence=path.join(run.reports,'fixture-copy.json');
 fs.writeFileSync(evidence,JSON.stringify({fixtureId,files,totalBytes:files.reduce((s,f)=>s+f.size,0),sourceAndCopyHashesMatch:true},null,2));
 fixtureRecord=lifecycle.closeLifecycle(root,fixtureId,{owner,expected_revision:fixtureRecord.revision,producer_stopped_verified:true,outcome:'success',exit_code:0,reason:'Exactly three approved UI reference files copied exclusively; original and copy hashes/identities verified',evidence_ref:evidence,evidence_sha256:sha(evidence)});
 copyCompleted=true;
 const stdout=path.join(run.logs,'source-check.stdout.log'),stderr=path.join(run.logs,'source-check.stderr.log'),out=fs.openSync(stdout,'wx'),err=fs.openSync(stderr,'wx');
 try{child=spawnSync(process.execPath,[path.join(__dirname,'hidden-source-check.cjs')],{cwd:root,env:{...process.env,AZRAEL_SOURCE_FIXTURE_LIFECYCLE:fixtureId},windowsHide:true,stdio:['ignore',out,err]});}finally{fs.closeSync(out);fs.closeSync(err);}
 const result={lifecycleId:run.lifecycleId,runRoot:run.runRoot,fixtureId,fixtureRecordRevision:fixtureRecord.revision,totalBytes:files.reduce((s,f)=>s+f.size,0),files,child:{exitCode:child.status,signal:child.signal,error:child.error?.message,stdout,stderr}};
 fs.writeFileSync(path.join(run.reports,'result.json'),JSON.stringify(result,null,2));
 if(child.error||child.signal||!Number.isInteger(child.status))throw Error('Source check child unresolved');
 exitCode=child.status;console.log(JSON.stringify(result));
}catch(error){console.error(error.stack);
 if(fixtureRecord&&!copyCompleted&&!fixtureRecord.producer){
  const evidence=path.join(run.reports,'fixture-failure.json');fs.writeFileSync(evidence,JSON.stringify({error:error.stack,fixtureId},null,2));
  fixtureRecord=lifecycle.closeLifecycle(root,fixtureId,{owner,expected_revision:fixtureRecord.revision,producer_stopped_verified:true,outcome:'failure',exit_code:1,reason:'Approved fixture preparation failed; partial outputs retained',evidence_ref:evidence,evidence_sha256:sha(evidence)});
 }
}finally{finishArtifactRun(run,{exitCode,producerStopped:true});}
process.exitCode=exitCode;

