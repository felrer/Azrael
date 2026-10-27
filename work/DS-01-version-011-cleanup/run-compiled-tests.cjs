"use strict";
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),crypto=require("node:crypto");
const root=path.resolve(__dirname,"../.."), output=path.join(root,"artifacts/verification/ds01n1");
const deps=path.join(root,"artifacts/cache/cargo/e6800e57b513189b18e235159d5808a618fd56e99b4e3ae13f0b16d4075f1388/target/debug/deps");
const source=path.join(output,"engine/codex-rs/project-maintenance");
const targets=["azrael_project_maintenance",...fs.readdirSync(path.join(source,"tests")).filter(n=>n.endsWith(".rs")).map(n=>n.slice(0,-3))];
const env={...process.env,TEMP:path.join(output,"temp"),TMP:path.join(output,"temp")};
const results=[];
for(const name of targets){
  const candidates=fs.readdirSync(deps).filter(n=>n.startsWith(name+"-")&&n.endsWith(".exe")).map(n=>path.join(deps,n)).filter(n=>fs.statSync(n).mtimeMs>=Date.parse("2026-10-25T12:27:24Z"));
  if(candidates.length!==1)throw Error(`Ambiguous compiled target ${name}: ${candidates}`);
  const exe=candidates[0], sha256=crypto.createHash("sha256").update(fs.readFileSync(exe)).digest("hex");
  const listed=cp.spawnSync(exe,["--list","--format=terse"],{env,cwd:source,encoding:"utf8",windowsHide:true});
  if(listed.status!==0||!listed.stdout.match(/: test\r?$/m))throw Error(`Test selection failed ${name}: ${listed.stderr}`);
  const result=cp.spawnSync(exe,["--test-threads=1"],{env,cwd:source,encoding:"utf8",windowsHide:true,maxBuffer:16*1024*1024});
  fs.writeFileSync(path.join(output,name+".log"),(result.stdout||"")+(result.stderr||""));
  results.push({target:name,exe,sha256,exitCode:result.status,signal:result.signal,summary:(result.stdout||"").split(/\r?\n/).filter(l=>l.startsWith("test result:"))});
  fs.writeFileSync(path.join(output,"direct-results.json"),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results.at(-1)));
}
process.exitCode=results.every(r=>r.exitCode===0)?0:1;
