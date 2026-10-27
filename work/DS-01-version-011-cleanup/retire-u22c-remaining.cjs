"use strict";
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),crypto=require("node:crypto");
const [workId,signalPath]=process.argv.slice(2),root=path.resolve(__dirname,"../.."),reports=path.join(__dirname,"reports");
const output=path.join(root,"artifacts/tasks/DS-01-version-011-cleanup/runs/u22c-final-cli"),id="run:DS-01-u22c-final-cli";
const lifecycle=require(path.join(root,"scripts/artifact-lifecycle.cjs"));
const verified=JSON.parse(fs.readFileSync(path.join(reports,"native-verification-r2.json"),"utf8"));
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
async function unlocked(file){
 if(!fs.existsSync(file))return;
 await new Promise(resolve=>{const watcher=fs.watch(path.dirname(file),()=>{if(!fs.existsSync(file)){watcher.close();resolve();}});if(!fs.existsSync(file)){watcher.close();resolve();}});
}
function guard(){
 const r=cp.spawnSync("powershell.exe",["-NoProfile","-Command",String.raw`$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and (($_.ExecutablePath -match '(?i)[\\/]artifacts[\\/]build[\\/]u22c([\\/]|$)') -or ($_.CommandLine -match '(?i)[\\/]artifacts[\\/]build[\\/]u22c([\\/]|$)')) } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine) | ConvertTo-Json -Depth 4`],{encoding:"utf8",windowsHide:true});
 const parsed=r.stdout.trim()?JSON.parse(r.stdout):[],matches=Array.isArray(parsed)?parsed:[parsed];
 if(r.status!==0||matches.length)throw Error("Old u22c process guard failed");
}
function run(stage,request){
 if(sha(verified.binary)!==verified.binarySha256)throw Error("Verified executable changed");
 const file=path.join(output,stage+"-request.json");fs.writeFileSync(file,JSON.stringify(request));
 const r=cp.spawnSync(verified.binary,["--project-root",root,"--request",file],{encoding:"utf8",windowsHide:true,maxBuffer:64*1024*1024});
 fs.writeFileSync(path.join(output,stage+".json"),r.stdout||"");fs.writeFileSync(path.join(output,stage+".stderr.log"),r.stderr||"");
 fs.copyFileSync(path.join(output,stage+".json"),path.join(reports,"u22c-cli-"+stage+".json"));
 if(r.status!==0||r.signal)throw Error(`Native ${stage} exit ${r.status}: ${r.stderr}`);
 return JSON.parse(r.stdout);
}
async function main(){
 if(!workId||!signalPath||fs.existsSync(output))throw Error("Fresh output and exact completion route required");
 await unlocked(path.join(root,"artifacts/maintenance/lifecycles/catalog.lock"));
 lifecycle.recordLifecycle(root,{id,kind:"run",owner:"DS-01-version-011-cleanup",state:"pending",membership_complete:false,members:[{path:output,role:"retirement-execution",generated:true,protection_known:true}],references:[]});
 fs.mkdirSync(output,{recursive:true});
 console.log(JSON.stringify({stage:"waiting-normal-lock-release",at:new Date().toISOString()}));
 await unlocked(path.join(root,"artifacts/maintenance/maintenance.lock"));
 guard();
 console.log(JSON.stringify({stage:"fresh-review",at:new Date().toISOString()}));
 const reviewed=run("review",{operation:"review",group_ids:["cf01-viewer-u22c-version"]});
 if(reviewed.items.length!==1||reviewed.items[0].id!=="cf01-viewer-u22c-payload"||reviewed.items[0].blockers.length)throw Error("Remaining group is changed or protected");
 guard();
 const result=run("apply",{operation:"apply",decisions:reviewed.items.map(i=>({id:i.id,token:i.token,decision:"delete",reason:"User-approved remaining u22c retirement; original prior calls terminal; fresh current config-bound whole live cohort reviewed after normal lock release; all cache and external consumers retired"}))});
 const success=!result.aborted&&result.results.length===1&&result.results[0].status==="deleted"&&result.results[0].remaining===false;
 const evidence=path.join(reports,"u22c-cli-terminal.json");fs.writeFileSync(evidence,JSON.stringify({schema:1,success,nativeExitCode:0,results:result.results.map(i=>({id:i.id,status:i.status,remaining:i.remaining,error:i.error})),binarySha256:verified.binarySha256,ended:new Date().toISOString()},null,2));
 await unlocked(path.join(root,"artifacts/maintenance/lifecycles/catalog.lock"));
 const record=lifecycle.catalog(root).find(r=>r.id===id);
 lifecycle.closeLifecycle(root,id,{owner:record.owner,expected_revision:record.revision,producer_stopped_verified:true,outcome:success?"success":"failure",exit_code:success?0:1,reason:"Synchronous native owner terminal outcome and actual per-item result observed",evidence_ref:evidence,evidence_sha256:sha(evidence)});
 console.log(JSON.stringify({stage:"terminal",success,results:result.results.map(i=>({id:i.id,status:i.status,remaining:i.remaining,error:i.error}))}));
 if(!success)throw Error("Native deletion returned non-deleted result");
}
main().then(()=>finish("succeeded","Verified remaining u22c native deletion completed; inspect actual result and lifecycle closure",0)).catch(error=>{console.error(error.stack);finish("failed",String(error).slice(0,480),1);});
function finish(state,summary,exitCode){const tmp=signalPath+".tmp-"+process.pid;fs.writeFileSync(tmp,JSON.stringify({workId,state,summary,exitCode}),{flag:"wx"});fs.renameSync(tmp,signalPath);process.exitCode=exitCode;}
