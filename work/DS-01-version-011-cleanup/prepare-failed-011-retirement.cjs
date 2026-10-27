"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),cp=require("node:child_process");
const root=path.resolve(__dirname,"../.."),reports=path.join(__dirname,"reports"),l=require(path.join(root,"scripts/artifact-lifecycle.cjs"));
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const observed=JSON.parse(fs.readFileSync(path.join(reports,"failed-deployment-investigation.json"),"utf8"));
const projects=observed.results.filter(p=>p.releases.some(r=>r.hostVersions.includes("2026.0.11")&&r.lifecycle?.state==="failed"));
const proc=cp.spawnSync("powershell.exe",["-NoProfile","-Command","Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress"],{encoding:"utf8",windowsHide:true,maxBuffer:16*1024*1024});if(proc.status!==0)throw Error("Process inspection failed");
const processes=JSON.parse(proc.stdout),requests=[];
for(const project of projects){
 const pr=path.resolve(root,project.project),selected=project.releases.filter(r=>r.hostVersions.includes("2026.0.11")&&r.lifecycle?.state==="failed");
 const active=processes.filter(p=>[p.ExecutablePath,p.CommandLine].some(s=>s?.toLowerCase().includes(pr.toLowerCase()))).map(p=>({pid:p.ProcessId,name:p.Name}));if(active.length)throw Error("Active old source consumer: "+JSON.stringify(active));
 const originals=l.catalog(pr),versions=selected.map(r=>originals.find(v=>v.id===r.lifecycle.id));if(versions.some(v=>!v||v.state!=="failed"))throw Error("Version changed");
 const backup=path.join(reports,"failed-011-"+path.basename(pr)+"-original-catalog.json");if(!fs.existsSync(backup))fs.writeFileSync(backup,JSON.stringify(originals,null,2),{flag:"wx"});
 const metrics=selected.map(r=>{const file=path.resolve(root,r.metrics.path),bytes=fs.readFileSync(file),m=JSON.parse(bytes);if(m.status!=="failed"||!m.completedUtc||m.stages.some(s=>!s.completedUtc))throw Error("Unresolved original producer: "+r.name);const copy=path.join(reports,"failed-011-"+r.name+"-metrics.json");if(!fs.existsSync(copy))fs.writeFileSync(copy,bytes,{flag:"wx"});return {name:r.name,path:file,sha256:sha(bytes),status:m.status,completedUtc:m.completedUtc,stages:m.stages.map(s=>({name:s.name,exitCode:s.exitCode,terminated:s.terminated,completedUtc:s.completedUtc}))};});
 const proof=path.join(pr,"artifacts/tasks/DS-01-version-011-cleanup/reports/failed-011-retirement.json"),evidenceId="work:DS-01-failed-011-retirement-evidence";
 if(fs.existsSync(proof))throw Error("Fresh evidence path required");
 l.recordLifecycle(pr,{id:evidenceId,kind:"work",owner:"DS-01-version-011-cleanup",state:"pending",membership_complete:false,members:[{path:proof,role:"retirement-evidence",generated:true,protection_known:true}],references:[]});
 fs.mkdirSync(path.dirname(proof),{recursive:true});
 fs.writeFileSync(proof,JSON.stringify({at:new Date().toISOString(),authorization:"User explicitly requests deletion attempt for failed old deployments, excluding all 2026.0.12 work; cancel obsolete exact 2026.0.11 pending installation handoff",versions:versions.map(v=>v.id),metrics,originalCatalogBackup:backup,activeOldSourceConsumers:active,terminationBasis:"Original complete failed deployment receipts with every launched stage completed, combined with current process check; not PID absence alone",outcomePolicy:"Preserve failure and original recorded exit; no unrecorded top-level exit invented",scope:"Only selected 2026.0.11 version cohorts; retain source parents, caches and all 2026.0.12/0.13 work"},null,2),{flag:"wx"});
 const evidence={evidence_ref:proof,evidence_sha256:sha(fs.readFileSync(proof))};
 let er=l.catalog(pr).find(r=>r.id===evidenceId);l.recordLifecycle(pr,{...er,state:"complete",membership_complete:true,expected_revision:er.revision});
 for(const v of versions){if(!v.producer)l.closeLifecycle(pr,v.id,{owner:v.owner,expected_revision:v.revision,producer_stopped_verified:true,outcome:"failure",exit_code:null,reason:"Retire completed failed 2026.0.11 deployment; original failed metrics and all completed stage outcomes retained independently; top-level numeric exit unrecorded",...evidence});}
 for(const record of l.catalog(pr)){
  const refs=record.references.filter(ref=>versions.some(v=>v.id===ref.id));if(!refs.length)continue;
  if(!(record.id.startsWith("work:deployment-temporary:")&&record.state==="complete")&&record.id!=="work:pending-install:w11w")throw Error("Unexpected inbound consumer "+record.id);
  l.releaseReferences(pr,record.id,{owner:record.owner,expected_revision:record.revision,reference_ids:refs.map(r=>r.reference_id),reason:"User cancels obsolete failed 2026.0.11 installation and deployment handoff; exact consumers stopped; newer version work excluded",...evidence});
 }
 for(const v of versions)requests.push({project_root:pr,request:l.registerRequest(pr,v.id)});
 console.log(JSON.stringify({project:project.project,versions:versions.map(v=>v.id),prepared:true}));
}
fs.writeFileSync(path.join(reports,"failed-011-register-requests.json"),JSON.stringify(requests,null,2),{flag:"wx"});
