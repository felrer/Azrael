"use strict";
const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"../.."),lifecycle=require(path.join(root,"scripts/artifact-lifecycle.cjs"));
const roots=new Set([root]),errors=[];
function dirs(dir){try{return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()).map(e=>path.join(dir,e.name));}catch(e){if(e.code!=="ENOENT")errors.push({path:dir,error:e.message});return [];}}
for(const parent of ["artifacts","artifacts/build","artifacts/workspaces"])for(const p of dirs(path.join(root,parent)))if(fs.existsSync(path.join(p,"project-maintenance.json")))roots.add(p);
const catalog=lifecycle.catalog(root),results=[];
function json(file){try{return JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));}catch(e){if(e.code!=="ENOENT")errors.push({path:file,error:e.message});return null;}}
for(const project of roots){
 const records=lifecycle.catalog(project),versions=records.filter(r=>r.kind==="version");
 const versionsByPath=new Map(versions.flatMap(r=>r.members.map(m=>[path.resolve(m.path).toLowerCase(),r])));
 const releases=dirs(path.join(project,"artifacts/releases")).map(release=>{
  const info=json(path.join(release,"build-info.json")),record=versionsByPath.get(release.toLowerCase());
  const metricsPath=path.join(project,"artifacts/logs","deploy-"+path.basename(release),"deployment-metrics.json"),metrics=json(metricsPath);
  const hostVersions=[...new Set((metrics?.stages??[]).flatMap(s=>(s.arguments??[]).flatMap((a,i,all)=>a==="-HostVersion"?[all[i+1]]:[])))];
  return {path:path.relative(root,release),name:path.basename(release),hostVersions,packageVersion:info?.packageVersion??null,metrics:metrics?{path:path.relative(root,metricsPath),status:metrics.status,error:metrics.error,stages:metrics.stages.map(s=>({name:s.name,exitCode:s.exitCode,terminated:s.terminated}))}:null,lifecycle:record?{id:record.id,state:record.state,revision:record.revision,references:record.references,inbound:records.filter(c=>c.references.some(r=>r.id===record.id)).map(c=>c.id),members:record.members.map(m=>({path:path.relative(root,m.path),role:m.role,present:fs.existsSync(m.path)}))}:null};
 });
 const deployments=dirs(path.join(project,"artifacts/deployments")).map(p=>({path:path.relative(root,p),packageStages:dirs(path.join(p,"package")).map(s=>path.basename(s))}));
 const sourceClaims=catalog.filter(r=>r.members.some(m=>path.resolve(m.path).toLowerCase()===project.toLowerCase())).map(r=>({id:r.id,state:r.state,revision:r.revision,producer:r.producer??null,references:r.references,inbound:catalog.filter(c=>c.references.some(ref=>ref.id===r.id)).map(c=>c.id)}));
 if(releases.length||deployments.length)results.push({project:path.relative(root,project)||".",releases,deployments,sourceClaims});
}
const report={at:new Date().toISOString(),scope:"Windows local metadata investigation; configured root and immediate project roots under artifacts/build/workspaces/artifacts; no deletion or payload hashing",rootsInspected:roots.size,results,errors};
fs.writeFileSync(path.join(__dirname,"reports/failed-deployment-investigation.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify({rootsInspected:roots.size,projects:results.length,releases:results.flatMap(r=>r.releases).length,failed:results.flatMap(r=>r.releases).filter(r=>r.lifecycle?.state==="failed").map(r=>({path:r.path,hostVersions:r.hostVersions,status:r.metrics?.status,inbound:r.lifecycle.inbound.length})),other:results.flatMap(r=>r.releases).filter(r=>r.lifecycle?.state!=="failed").map(r=>({path:r.path,hostVersions:r.hostVersions,state:r.lifecycle?.state??"unregistered"})),errors},null,2));
