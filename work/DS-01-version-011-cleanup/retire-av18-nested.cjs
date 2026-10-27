"use strict";
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),crypto=require("node:crypto");
const root=path.resolve(__dirname,"../.."),project="C:/Users/felre/av18",reports=path.join(__dirname,"reports");
const verification=JSON.parse(fs.readFileSync(path.join(reports,"native-verification-r2.json"),"utf8"));
if(crypto.createHash("sha256").update(fs.readFileSync(verification.binary)).digest("hex")!==verification.binarySha256)throw Error("Verified executable changed");
const scan=cp.spawnSync("powershell.exe",["-NoProfile","-Command",String.raw`$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and (($_.ExecutablePath -match '(?i)[\\/]av18[\\/]artifacts[\\/]f([\\/]|$)') -or ($_.CommandLine -match '(?i)[\\/]av18[\\/]artifacts[\\/]f([\\/]|$)')) } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine) | ConvertTo-Json -Depth 4`],{encoding:"utf8",windowsHide:true});
if(scan.status!==0)throw Error(scan.stderr);const parsed=scan.stdout.trim()?JSON.parse(scan.stdout):[];const processes=Array.isArray(parsed)?parsed:[parsed];if(processes.length)throw Error("External profile is running");
const evidence="artifacts/maintenance/evidence/ds01-nested-retirement.json";
fs.mkdirSync(path.dirname(path.join(project,evidence)),{recursive:true});
fs.writeFileSync(path.join(project,evidence),JSON.stringify({schema:1,user_authorized:true,scope:"Complete av18 external test profile and nested manual recovery retired",original_tree_terminal:"av18-original-tree-terminal.json",independent_evidence:"av18-retirement-evidence.json",current_process_matches:processes,scan_exit:scan.status,scan_at:new Date().toISOString(),native_verification:verification,original_pending_outcome_preserved:true},null,2));
fs.copyFileSync(path.join(project,evidence),path.join(reports,"av18-nested-retirement-evidence.json"));
const descriptor={parent:"ds01-av18-fixture",child:"session6-recovery-external-026",owner:"CF-01-window-use-admin-setup",reason:"User retires full external test profile; nested claim removed first while enclosing claim remains protected pending registration",evidence_ref:evidence};
function run(stage,request){
  const requestPath=path.join(project,`artifacts/maintenance/ds01-nested-${stage}.json`);fs.writeFileSync(requestPath,JSON.stringify(request));
  const result=cp.spawnSync(verification.binary,["--project-root",project,"--request",requestPath],{encoding:"utf8",windowsHide:true,maxBuffer:32*1024*1024});
  fs.writeFileSync(path.join(reports,`av18-nested-${stage}.stdout.json`),result.stdout||"");fs.writeFileSync(path.join(reports,`av18-nested-${stage}.stderr.log`),result.stderr||"");
  if(result.status!==0||result.signal)throw Error(`Native ${stage} exit ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}
const review=run("review",{operation:"review",ids:[descriptor.parent,descriptor.child],retire_nested_member:descriptor});
console.log(JSON.stringify({stage:"review",items:review.items.map(i=>({id:i.id,blockers:i.blockers}))}));
if(review.items.length!==2||review.items.some(i=>i.blockers.length))throw Error("Native pair review protected");
const result=run("apply",{operation:"apply",retire_nested_member:descriptor,decisions:review.items.map(i=>({id:i.id,token:i.token,decision:i.id===descriptor.parent?"defer":"delete",reason:"Explicit whole-group decisions for nested retirement",revisit_condition:"Fully register enclosing current content after child retirement and obtain fresh ordinary review"}))});
console.log(JSON.stringify({stage:"apply",aborted:result.aborted,results:result.results.map(i=>({id:i.id,status:i.status,remaining:i.remaining,error:i.error}))}));
if(result.aborted||!result.results.some(i=>i.id===descriptor.child&&i.status==="deleted"&&i.remaining===false))throw Error("Nested retirement incomplete");
