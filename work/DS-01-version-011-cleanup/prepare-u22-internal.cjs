"use strict";
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),crypto=require("node:crypto");
const root=path.resolve(__dirname,"../.."),project=path.join(root,"artifacts/build/u22c"),reports=path.join(__dirname,"reports");
const lifecycle=require(path.join(root,"scripts/artifact-lifecycle.cjs"));
const scan=cp.spawnSync("powershell.exe",["-NoProfile","-Command",String.raw`$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and (($_.ExecutablePath -match '(?i)[\\/]artifacts[\\/]build[\\/](u22c|q)([\\/]|$)') -or ($_.CommandLine -match '(?i)[\\/]artifacts[\\/]build[\\/](u22c|q)([\\/]|$)')) } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine) | ConvertTo-Json -Depth 4`],{encoding:"utf8",windowsHide:true});
if(scan.status!==0)throw Error(scan.stderr);const parsed=scan.stdout.trim()?JSON.parse(scan.stdout):[];const processes=Array.isArray(parsed)?parsed:[parsed];
if(processes.length)throw Error("Old u22c/q process still exists: "+JSON.stringify(processes));
const original=lifecycle.catalog(project);
if(original.length!==2||!original.some(r=>r.id==="version:u22c"))throw Error("Original consumer membership changed");
for(const relative of ["artifacts/logs/u22c/build-metrics.json","artifacts/logs/u22c/modules.json","artifacts/releases/u22c/build-info.json"]){
  fs.copyFileSync(path.join(project,relative),path.join(reports,"u22c-original-"+path.basename(relative)));
}
fs.copyFileSync(path.join(root,"artifacts/build/q/check-result.json"),path.join(reports,"q-original-check-result.json"));
const evidence={schema:1,user_authorized:true,project,original_records:original,original_outcome:"pending/unknown preserved; no command exit inferred",process_scan:{exitCode:scan.status,matches:processes,at:new Date().toISOString()},generation_basis:["Preserved original complete consumer catalog","Original build-metrics completion and q final check result","External installations unregistered; linked test acceptance and rollback cancelled by user"],reason:"Retire known old build and cache consumers before enclosing deletion",members:original.flatMap(r=>r.members.map(m=>({...m,present:fs.existsSync(m.path),owner:r.owner,source_id:r.id})))};
const local=path.join(project,"artifacts/maintenance/evidence/ds01-retirement.json");fs.mkdirSync(path.dirname(local),{recursive:true});fs.writeFileSync(local,JSON.stringify(evidence,null,2));fs.copyFileSync(local,path.join(reports,"u22c-internal-retirement-evidence.json"));
const version=original.find(r=>r.id==="version:u22c");
if(version.references.length!==1||version.references[0].reference_id!=="5aac4ae7ad916146c8cbd855d3d943680a5ddf74225a880e47e80d0c9821bd82")throw Error("Original outgoing cache reference changed");
const released=lifecycle.releaseReferences(project,version.id,{owner:version.owner,expected_revision:version.revision,reference_ids:version.references.map(r=>r.reference_id),reason:"User retires u22c build; stopped runtime and original consumer catalog independently preserved",evidence_ref:local,evidence_sha256:crypto.createHash("sha256").update(fs.readFileSync(local)).digest("hex")});
fs.writeFileSync(path.join(reports,"u22c-internal-reference-release.json"),JSON.stringify(released,null,2));
const requests=original.map(r=>({operation:"register",group:{id:"ds01-retirement:"+r.id,kind:r.kind,owner:r.owner,membership_complete:true,provenance_ref:"DS-01 explicit current retirement; original state unchanged",membership_source:local,members:r.members.filter(m=>fs.existsSync(m.path)).map((m,i)=>({id:"ds01-"+r.owner+"-"+i,path:m.path,kind:m.role,lifecycle_role:m.role.includes("log")?"log":"artifact",owner:r.owner,generated:true,protection_known:true,references:[]}))}}));
fs.writeFileSync(path.join(reports,"u22c-internal-register-requests.json"),JSON.stringify(requests,null,2));
console.log(JSON.stringify({processes:processes.length,released:released.references.length,groups:requests.map(r=>({id:r.group.id,members:r.group.members.length}))}));
