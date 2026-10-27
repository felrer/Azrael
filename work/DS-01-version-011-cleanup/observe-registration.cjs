"use strict";
const fs=require("node:fs"),path=require("node:path");
const [workId,signalPath]=process.argv.slice(2),root=path.resolve(__dirname,"../.."),directory=path.join(root,"artifacts/maintenance");
if(!workId||!signalPath)throw Error("Exact completion route required");
let ended=false,watcher,secondWatcher,timer;
const either=process.argv.includes("--either");
const cleanup=process.argv.includes("--cleanup");
const unlock=process.argv.includes("--unlock");
function finish(state,summary,exitCode){
 if(ended)return;ended=true;watcher?.close();secondWatcher?.close();clearTimeout(timer);
 const temporary=signalPath+".tmp-"+process.pid;fs.writeFileSync(temporary,JSON.stringify({workId,state,summary,exitCode}),{flag:"wx"});fs.renameSync(temporary,signalPath);
 console.log(JSON.stringify({state,summary,exitCode}));process.exitCode=exitCode;
}
function inspect(){
 if(ended)return;
 if(either){
  try{
   const result=JSON.parse(fs.readFileSync(path.join(__dirname,"reports/av18-parent-apply.json"),"utf8"));
   if(Array.isArray(result.results)&&result.results.length){
    const success=!result.aborted&&result.results.every(i=>i.status==="deleted"&&i.remaining===false);
    finish(success?"succeeded":"failed","av18 native apply returned; inspect original session and actual results",success?0:1);return;
   }
  }catch(error){if(error.code!=="ENOENT"&&!(error instanceof SyntaxError))throw error;}
 }
 if(fs.existsSync(path.join(directory,"maintenance.lock")))return;
 if(unlock){finish("succeeded","Primary native maintenance lock absent; obtain a fresh review before another apply",0);return;}
 try{
  const m=JSON.parse(fs.readFileSync(path.join(directory,"manifest.json"),"utf8")),g=m.groups["cf01-viewer-u22c-version"];
  if(cleanup){
   if(g?.cleanup_status==="deleted"&&g.members.every(id=>m.items[id]?.cleanup_status==="deleted"&&m.items[id]?.remaining===false))
    finish("succeeded","q/u22c native deletion committed and lock released; inspect original apply result",0);
   return;
  }
  const threshold=Date.parse("2026-10-25T12:44:00Z");
  if(g?.registered_at_ms>=threshold&&g.members.length===2&&g.members.every(id=>m.items[id]?.measured_at_ms>=threshold)&&m.items["cf01-viewer-u22c-payload"].logical_bytes<5e9)
   finish("succeeded","Current q/u22c registration committed and native lock released; inspect original tool return before cleanup",0);
 }catch(error){if(error.code!=="ENOENT"&&!(error instanceof SyntaxError))finish("failed",String(error),1);}
}
watcher=fs.watch(directory,inspect);
if(either)secondWatcher=fs.watch(path.join(__dirname,"reports"),inspect);
timer=setTimeout(()=>finish("failed","Registration readiness was not observed within ten minutes; native outcome remains unclassified",1),10*60*1000);
inspect();
