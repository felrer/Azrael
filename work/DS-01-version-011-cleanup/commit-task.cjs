"use strict";
// Isolate this task's tree and publish its index changes under Git's own lock
// protocol, preserving every unrelated staged entry.
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),crypto=require("node:crypto");
const root=path.resolve(__dirname,"../.."),reports=path.join(__dirname,"reports");
const full=["engine/codex-rs/project-maintenance/src/apply.rs","engine/codex-rs/project-maintenance/src/groups.rs","engine/codex-rs/project-maintenance/src/lib.rs","engine/codex-rs/project-maintenance/src/retirement.rs","engine/codex-rs/project-maintenance/src/nested_retirement.rs","engine/codex-rs/project-maintenance/tests/nested_retirement.rs","docs/ops/project-maintenance.md","work/DS-01-version-011-cleanup/01-plan.md"];
const architecture="docs/architecture/project-maintenance.md",inventory="scripts/azrael-feature-contracts.json",owned=[...full,architecture,inventory].sort();
function git(args,index,input,optional=false){const r=cp.spawnSync("git",args,{cwd:root,env:{...process.env,...(index?{GIT_INDEX_FILE:index}:{})},input,encoding:"utf8",windowsHide:true,maxBuffer:32*1024*1024});if(r.status!==0){if(optional&&r.status===1)return null;throw Error(`git ${args[0]} exit ${r.status}: ${r.stderr} ${r.stdout}`);}return r.stdout;}
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function blob(index,file,text){const hash=git(["hash-object","-w","--stdin"],undefined,text).trim();git(["update-index","--add","--cacheinfo",`100644,${hash},${file}`],index);}
function assertVerified(){const receipt=JSON.parse(fs.readFileSync(path.join(reports,"integrated-native-verification.json"),"utf8"));const current=require(path.join(root,"scripts/freeze-platform-inputs.cjs")).inventoryTree(path.join(root,"engine/codex-rs/project-maintenance"));if(receipt.nativeExitCode!==0||receipt.nativeTestsPassed!==120||current.sha256!==receipt.crateSha256)throw Error("Current native source differs from integrated passing verification");}
function stageFingerprint(index,exclude){return git(["ls-files","--stage","-z"],index).split("\0").filter(Boolean).filter(line=>!exclude.includes(line.slice(line.indexOf("\t")+1))).sort();}
const temporary=path.join(reports,"task-commit-"+crypto.randomUUID()+".index");
const publication=temporary+".publication";
let lockFd,lockIdentity,cas=false,lockPath;
try{
 assertVerified();
 const head=git(["rev-parse","HEAD"]).trim(),ref=git(["symbolic-ref","-q","HEAD"],undefined,undefined,true)||"HEAD";
 if(git(["diff","--cached","--name-only","--",...owned]).trim())throw Error("Task paths contain preexisting staged changes");
 const hookSetting=git(["config","--get","core.hooksPath"],undefined,undefined,true);
 const hookRoot=hookSetting?path.resolve(root,hookSetting.trim()):path.resolve(root,git(["rev-parse","--git-path","hooks"]).trim());
 for(const hook of ["pre-commit","prepare-commit-msg","commit-msg","post-commit"]){if(fs.existsSync(path.join(hookRoot,hook)))throw Error("Active commit hook requires the normal hook workflow");}
 git(["read-tree",head],temporary);git(["add","--",...full],temporary);
 const currentDoc=fs.readFileSync(path.join(root,architecture),"utf8"),heading="### 중첩 소유 항목의 단계적 폐기",anchor="### 관리 경계 폐기";
 const start=currentDoc.indexOf(heading),end=currentDoc.indexOf(anchor,start);if(start<0||end<=start)throw Error("Owned architecture block missing");
 const baseDoc=git(["show",`${head}:${architecture}`]);if(baseDoc.includes(heading)||!baseDoc.includes(anchor))throw Error("Architecture baseline changed");
 blob(temporary,architecture,baseDoc.replace(anchor,currentDoc.slice(start,end).replace(/\r\n/g,"\n")+anchor));
 const baseInventory=git(["show",`${head}:${inventory}`]),needle='        "engine/codex-rs/project-maintenance/src/retirement.rs",';
 if(baseInventory.split(needle).length!==2||baseInventory.includes('"engine/codex-rs/project-maintenance/src/nested_retirement.rs"'))throw Error("Feature ownership baseline changed");
 blob(temporary,inventory,baseInventory.replace(needle,needle+'\n        "engine/codex-rs/project-maintenance/src/nested_retirement.rs",\n        "engine/codex-rs/project-maintenance/tests/nested_retirement.rs",'));
 const names=git(["diff","--cached","--name-only"],temporary).trim().split(/\r?\n/).sort();if(JSON.stringify(names)!==JSON.stringify(owned))throw Error("Unexpected task tree paths");
 git(["diff","--cached","--check"],temporary);const stat=git(["diff","--cached","--stat"],temporary);
 fs.writeFileSync(path.join(reports,"task-commit-diff.patch"),git(["diff","--cached","--binary"],temporary));
 if(!process.argv.includes("--commit")){console.log(stat);console.log("Prepared only; no branch or user index mutation.");}
 else{
  const cleanup=JSON.parse(fs.readFileSync(path.join(reports,"final-task-cleanup.json"),"utf8"));if(!cleanup.complete)throw Error("Task cleanup not complete");
  const indexPath=path.resolve(root,git(["rev-parse","--git-path","index"]).trim());lockPath=indexPath+".lock";lockFd=fs.openSync(lockPath,"wx");lockIdentity=fs.fstatSync(lockFd);
  if(git(["rev-parse","HEAD"]).trim()!==head||(git(["symbolic-ref","-q","HEAD"],undefined,undefined,true)||"HEAD")!==ref)throw Error("HEAD changed; prepare on the new base");
  if(git(["diff","--cached","--name-only","--",...owned]).trim())throw Error("Concurrent staged change on task paths");
  assertVerified();
  const originalUnrelated=stageFingerprint(undefined,owned);fs.copyFileSync(indexPath,publication);
  const entries=git(["ls-files","--stage","-z","--",...owned],temporary).split("\0").filter(Boolean).map(line=>{const tab=line.indexOf("\t"),[mode,hash,stage]=line.slice(0,tab).split(" ");if(stage!=="0")throw Error("Unmerged task index");return `${mode} ${hash}\t${line.slice(tab+1)}\n`;}).join("");
  git(["update-index","--index-info"],publication,entries);
  if(JSON.stringify(stageFingerprint(publication,owned))!==JSON.stringify(originalUnrelated))throw Error("Unrelated index entries changed");
  const tree=git(["write-tree"],temporary).trim();
  const commit=git(["commit-tree",tree,"-p",head,"-m","Support staged retirement of nested artifact groups","-m","Require same-owner complete cohorts, parent defer/child delete decisions, bound evidence and fresh tokens. Force enclosing re-registration after nested deletion. Preserve current-profile state and retire verified old test/build artifacts through their owners. Windows integrated native verification: 120 passed." ]).trim();
  git(["update-ref","-m","task: nested artifact retirement",ref.trim(),commit,head]);cas=true;
  const currentLock=fs.statSync(lockPath);if(currentLock.dev!==lockIdentity.dev||currentLock.ino!==lockIdentity.ino)throw Error("Git index lock replaced");
  fs.writeFileSync(lockFd,fs.readFileSync(publication));fs.fsyncSync(lockFd);fs.closeSync(lockFd);lockFd=undefined;fs.renameSync(lockPath,indexPath);lockPath=undefined;
  const preserved=JSON.stringify(stageFingerprint(undefined,owned))===JSON.stringify(originalUnrelated);if(!preserved)throw Error("Unrelated staging verification failed");
  fs.writeFileSync(path.join(reports,"task-commit.json"),JSON.stringify({commit,parent:head,paths:owned,unrelatedIndexPreserved:preserved,validation:"Windows native120 passed; exact current crate/input reuse verified",at:new Date().toISOString()},null,2));console.log(JSON.stringify({commit,unrelatedIndexPreserved:preserved}));
 }
}finally{
 if(lockFd!==undefined){fs.closeSync(lockFd);if(!cas){const now=fs.statSync(lockPath);if(now.dev===lockIdentity.dev&&now.ino===lockIdentity.ino)fs.unlinkSync(lockPath);}}
 for(const file of [temporary,publication])if(fs.existsSync(file))fs.unlinkSync(file);
}
