"use strict";
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),crypto=require("node:crypto");
const project="C:/Users/felre/av18",reports=path.join(__dirname,"reports");
const verified=JSON.parse(fs.readFileSync(path.join(reports,"native-verification-r2.json"),"utf8"));
if(crypto.createHash("sha256").update(fs.readFileSync(verified.binary)).digest("hex")!==verified.binarySha256)throw Error("Verified binary changed");
function guard(){
 const r=cp.spawnSync("powershell.exe",["-NoProfile","-Command",String.raw`$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and (($_.ExecutablePath -match '(?i)[\\/]av18[\\/]artifacts[\\/]f([\\/]|$)') -or ($_.CommandLine -match '(?i)[\\/]av18[\\/]artifacts[\\/]f([\\/]|$)')) } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine) | ConvertTo-Json -Depth 4`],{encoding:"utf8",windowsHide:true});
 const parsed=r.stdout.trim()?JSON.parse(r.stdout):[];const matches=Array.isArray(parsed)?parsed:[parsed];
 if(r.status!==0||matches.length)throw Error("External profile process guard failed");
}
function run(stage,request){
 const requestPath=path.join(project,`artifacts/maintenance/ds01-parent-${stage}.json`);fs.writeFileSync(requestPath,JSON.stringify(request));
 const r=cp.spawnSync(verified.binary,["--project-root",project,"--request",requestPath],{encoding:"utf8",windowsHide:true,maxBuffer:64*1024*1024});
 fs.writeFileSync(path.join(reports,`av18-parent-${stage}.json`),r.stdout||"");fs.writeFileSync(path.join(reports,`av18-parent-${stage}.stderr.log`),r.stderr||"");
 if(r.status!==0||r.signal)throw Error(`Native ${stage} exit ${r.status}: ${r.stderr}`);
 return JSON.parse(r.stdout);
}
guard();
const nested=JSON.parse(fs.readFileSync(path.join(reports,"av18-nested-apply.stdout.json"),"utf8"));
if(nested.aborted||!nested.results.some(i=>i.id==="session6-recovery-external-026"&&i.status==="deleted"&&i.remaining===false))throw Error("Nested retirement not complete");
const evidence="artifacts/maintenance/evidence/ds01-parent-retirement.json";
fs.writeFileSync(path.join(project,evidence),JSON.stringify({schema:1,user_authorized:true,original_evidence:JSON.parse(fs.readFileSync(path.join(reports,"av18-retirement-evidence.json"),"utf8").replace(/^\uFEFF/,"")),nested_result:nested,reason:"Nested claim retired; full current enclosing content registered before ordinary reviewed retirement",original_pending_outcome_preserved:true},null,2));
fs.copyFileSync(path.join(project,evidence),path.join(reports,"av18-parent-retirement-evidence.json"));
const registered=run("register",{operation:"register",group:{id:"run:window-use-u18-isolated",kind:"run",owner:"CF-01-window-use-admin-setup",membership_complete:true,provenance_ref:evidence,membership_source:evidence,members:[{id:"ds01-av18-fixture",path:"artifacts/f",kind:"fixture",owner:"CF-01-window-use-admin-setup",generated:true,protection_known:true,references:[]}]}});
console.log(JSON.stringify({stage:"registered",items:registered.items.map(i=>({id:i.id,bytes:i.logical_bytes,needsRegistration:i.nested_retirement_requires_registration}))}));
guard();const reviewed=run("review",{operation:"review",group_ids:["run:window-use-u18-isolated"]});
if(reviewed.items.length!==1||reviewed.items.some(i=>i.blockers.length))throw Error("Enclosing retirement protected: "+JSON.stringify(reviewed.items.map(i=>({id:i.id,blockers:i.blockers}))));
const result=run("apply",{operation:"apply",decisions:reviewed.items.map(i=>({id:i.id,token:i.token,decision:"delete",reason:"User retires full old external test profile; child claim retired; current full content registered and fresh ordinary review passed"}))});
console.log(JSON.stringify({stage:"deleted",aborted:result.aborted,results:result.results.map(i=>({id:i.id,status:i.status,remaining:i.remaining,error:i.error}))}));
if(result.aborted||result.results.some(i=>i.status!=="deleted"||i.remaining!==false))throw Error("Enclosing deletion incomplete");
