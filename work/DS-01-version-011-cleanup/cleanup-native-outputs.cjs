"use strict";
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),crypto=require("node:crypto");
const [workId,signalPath]=process.argv.slice(2),root=path.resolve(__dirname,"../.."),reports=path.join(__dirname,"reports");
const lifecycle=require(path.join(root,"scripts/artifact-lifecycle.cjs"));
const id="run:DS-01-native-output-cleanup",output=path.join(root,"artifacts/tasks/DS-01-version-011-cleanup/runs/native-output-cleanup");
const verified=JSON.parse(fs.readFileSync(path.join(reports,"native-verification-r2.json"),"utf8"));
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
let binary;
async function unlocked(p){if(!fs.existsSync(p))return;await new Promise(resolve=>{const w=fs.watch(path.dirname(p),()=>{if(!fs.existsSync(p)){w.close();resolve();}});if(!fs.existsSync(p)){w.close();resolve();}});}
function run(stage,request){
 if(sha(binary)!==verified.binarySha256)throw Error("Frozen native owner changed");
 const file=path.join(output,stage+"-request.json");fs.writeFileSync(file,JSON.stringify(request));
 const r=cp.spawnSync(binary,["--project-root",root,"--request",file],{encoding:"utf8",windowsHide:true,maxBuffer:64*1024*1024});
 fs.writeFileSync(path.join(output,stage+".json"),r.stdout||"");fs.writeFileSync(path.join(output,stage+".stderr.log"),r.stderr||"");
 fs.copyFileSync(path.join(output,stage+".json"),path.join(reports,"native-output-"+stage+".json"));
 if(r.status!==0||r.signal)throw Error(`Native ${stage} exit ${r.status}: ${r.stderr}`);
 return JSON.parse(r.stdout);
}
async function main(){
 if(!workId||!signalPath||fs.existsSync(output))throw Error("Fresh cleanup output required");
 const terminal=JSON.parse(fs.readFileSync(path.join(reports,"u22c-cli-terminal.json"),"utf8"));if(!terminal.success)throw Error("Native consumer not terminal");
 await unlocked(path.join(root,"artifacts/maintenance/lifecycles/catalog.lock"));
 lifecycle.recordLifecycle(root,{id,kind:"run",owner:"DS-01-version-011-cleanup",state:"pending",membership_complete:false,members:[{path:output,role:"cleanup-execution",generated:true,protection_known:true}],references:[]});
 fs.mkdirSync(output,{recursive:true});binary=path.join(output,"maintenance_owner.exe");
 if(sha(verified.binary)!==verified.binarySha256)throw Error("Verified source binary changed");fs.copyFileSync(verified.binary,binary);
 const requests=JSON.parse(fs.readFileSync(path.join(reports,"native-output-retirement-requests.json"),"utf8"));
 await unlocked(path.join(root,"artifacts/maintenance/maintenance.lock"));
 for(let i=0;i<requests.length;i++){
  const evidence=path.join(reports,"native-evidence",i===0?"ds01n1":"ds01n2");
  if(!fs.existsSync(path.join(evidence,"inputs.json")))throw Error("Independent native evidence missing");
  const registered=run("register-"+i,requests[i]);console.log(JSON.stringify({stage:"registered",id:registered.group.id,items:registered.items.map(i=>({id:i.id,bytes:i.logical_bytes}))}));
 }
 const reviewed=run("review",{operation:"review",group_ids:requests.map(r=>r.group.id)});
 if(reviewed.items.length!==2||reviewed.items.some(i=>i.blockers.length))throw Error("Native verification outputs protected: "+JSON.stringify(reviewed.items.map(i=>({id:i.id,blockers:i.blockers}))));
 const result=run("apply",{operation:"apply",decisions:reviewed.items.map(i=>({id:i.id,token:i.token,decision:"delete",reason:"Owned test source snapshots retired after corrected native verification and actual external cleanup; exact failure/success logs, source crate and full input manifest preserved independently; no native consumer remains"}))});
 const success=!result.aborted&&result.results.length===2&&result.results.every(i=>i.status==="deleted"&&i.remaining===false);
 const evidence=path.join(reports,"native-output-cleanup-terminal.json");fs.writeFileSync(evidence,JSON.stringify({schema:1,success,nativeExitCode:0,results:result.results.map(i=>({id:i.id,status:i.status,remaining:i.remaining,error:i.error})),bytes:reviewed.items.reduce((n,i)=>n+i.logical_bytes,0),ended:new Date().toISOString()},null,2));
 if(!success)throw Error("Native output deletion incomplete");
 const finalized=requests.map(r=>lifecycle.finalize(root,r.group.id));fs.writeFileSync(path.join(reports,"native-output-finalize.json"),JSON.stringify(finalized,null,2));if(finalized.some(i=>i.status!=="finalized"))throw Error("Native output producer remains protected");
 await unlocked(path.join(root,"artifacts/maintenance/lifecycles/catalog.lock"));const record=lifecycle.catalog(root).find(r=>r.id===id);
 lifecycle.closeLifecycle(root,id,{owner:record.owner,expected_revision:record.revision,producer_stopped_verified:true,outcome:"success",exit_code:0,reason:"Synchronous native owner actual snapshot deletion and lifecycle reconciliation completed",evidence_ref:evidence,evidence_sha256:sha(evidence)});
 console.log(JSON.stringify({stage:"terminal",success,bytes:reviewed.items.reduce((n,i)=>n+i.logical_bytes,0)}));
}
main().then(()=>finish("succeeded","Native verification snapshots deleted and producers finalized; cleaner output remains for final ordinary cleanup",0)).catch(e=>{console.error(e.stack);finish("failed",String(e).slice(0,480),1);});
function finish(state,summary,exitCode){const tmp=signalPath+".tmp-"+process.pid;fs.writeFileSync(tmp,JSON.stringify({workId,state,summary,exitCode}),{flag:"wx"});fs.renameSync(tmp,signalPath);process.exitCode=exitCode;}
