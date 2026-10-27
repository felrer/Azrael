"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const root=path.resolve(__dirname,"../.."), task=__dirname, reports=path.join(task,"reports");
const lifecycle=require(path.join(root,"scripts/artifact-lifecycle.cjs"));
const cargo=require(path.join(root,"scripts/cargo-target-owner.cjs"));
const freeze=require(path.join(root,"scripts/freeze-platform-inputs.cjs"));
const target=path.join(root,"artifacts/cache/cargo/e6800e57b513189b18e235159d5808a618fd56e99b4e3ae13f0b16d4075f1388/target");
const lock=path.join(root,"artifacts/maintenance/lifecycles/catalog.lock");
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
async function unlocked(){
  if(!fs.existsSync(lock))return;
  console.log(JSON.stringify({stage:"waiting-for-existing-catalog-owner",started:new Date().toISOString()}));
  await new Promise(resolve=>{const watcher=fs.watch(path.dirname(lock),()=>{if(!fs.existsSync(lock)){watcher.close();resolve();}});if(!fs.existsSync(lock)){watcher.close();resolve();}});
}
async function main(){
  await unlocked();
  const prior=cargo.inspectTargetOwner({targetDirectory:target});
  if(!prior.exists||prior.owner.status!=="success"||prior.owner.exitCode!==0||prior.token!=="04b999c7-e25c-4356-9180-3c0ce4d97b7a")throw Error("Original terminal owner changed");
  fs.writeFileSync(path.join(reports,"r1-terminal-owner.json"),JSON.stringify(prior,null,2));
  // The synchronous producer's persisted exit is reused, never fabricated by recovery.
  cargo.finishTargetOwner({owner:prior.owner,ownerPath:prior.ownerPath,leasePath:prior.leasePath,pendingRecord:true},{status:prior.owner.exitCode,pid:prior.owner.producerPid,signal:prior.owner.signal});
  const evidence=path.join(reports,"r1-verification-terminal.json");
  fs.writeFileSync(evidence,JSON.stringify({schema:1,wrapperExit:1,directTestExit:1,originalSelectionExit:0,reason:"Catalog close collision; direct native tests found required enclosing registration guard",directResults:path.join(root,"artifacts/verification/ds01n1/direct-results.json"),observed:new Date().toISOString()},null,2));
  let record=lifecycle.catalog(root).find(r=>r.id==="run:DS-01-native-nested-retirement-r1");
  lifecycle.closeLifecycle(root,record.id,{owner:record.owner,expected_revision:record.revision,producer_stopped_verified:true,outcome:"failure",exit_code:1,reason:"Observed terminal wrapper and native test failure",evidence_ref:evidence,evidence_sha256:sha(evidence)});
  const output=path.join(root,"artifacts/verification/ds01n2"),id="run:DS-01-native-nested-retirement-r2";
  if(fs.existsSync(output))throw Error("Fresh r2 output required");
  lifecycle.recordLifecycle(root,{id,kind:"run",owner:"DS-01-version-011-cleanup",state:"pending",membership_complete:false,members:[{path:output,role:"verification"}],references:[]});
  fs.mkdirSync(output,{recursive:true});
  freeze.copyTree(path.join(root,"artifacts/verification/ds01n1/engine"),path.join(output,"engine"));
  freeze.copyTree(path.join(root,"engine/codex-rs/project-maintenance"),path.join(output,"engine/codex-rs/project-maintenance"));
  fs.writeFileSync(path.join(output,"inputs.json"),JSON.stringify(freeze.inventoryTree(path.join(output,"engine"))));
  fs.writeFileSync(path.join(output,"provenance.json"),JSON.stringify({base:"ds01n1",baseInputsSha256:sha(path.join(root,"artifacts/verification/ds01n1/inputs.json")),overlay:"engine/codex-rs/project-maintenance",started:new Date().toISOString()}));
  const temp=path.join(output,"temp");fs.mkdirSync(temp);
  const env={...process.env,PATH:`C:/Users/felre/.cargo/bin;${process.env.PATH}`,RUSTUP_TOOLCHAIN:"stable",CARGO_TARGET_DIR:target,TEMP:temp,TMP:temp,INSTA_PENDING_DIR:path.join(output,"pending")};
  const result=require(path.join(root,"scripts/cargo-verification.cjs")).runCargoTest(path.join(output,"engine"),["test","-p","azrael-project-maintenance","--locked","--offline","--","--test-threads=1"],{env,isolateHostEnvironment:true,capture:true});
  fs.writeFileSync(path.join(output,"cargo.stdout.log"),result.stdout||"");fs.writeFileSync(path.join(output,"cargo.stderr.log"),result.stderr||"");
  fs.writeFileSync(path.join(output,"result.json"),JSON.stringify({exitCode:result.status,signal:result.signal,error:result.error?.message,ended:new Date().toISOString()}));
  console.log(JSON.stringify({stage:"tests-terminal",exitCode:result.status,signal:result.signal,output}));
  if(Number.isInteger(result.status)&&!result.signal){
    await unlocked();record=lifecycle.catalog(root).find(r=>r.id===id);
    lifecycle.closeLifecycle(root,id,{owner:record.owner,expected_revision:record.revision,producer_stopped_verified:true,outcome:result.status===0?"success":"failure",exit_code:result.status,reason:"Observed synchronous native verification terminal result",evidence_ref:path.join(output,"result.json"),evidence_sha256:sha(path.join(output,"result.json"))});
  }
  process.exitCode=result.status??1;
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
