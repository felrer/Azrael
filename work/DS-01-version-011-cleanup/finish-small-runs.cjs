"use strict";
const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"../.."),reports=path.join(__dirname,"reports");
const lifecycle=require(path.join(root,"scripts/artifact-lifecycle.cjs"));
const ids=["run:DS-01-native-output-cleanup","run:DS-01-u22c-final-cli"];
if(process.argv[2]==="prepare"){
 const requests=ids.map(id=>lifecycle.registerRequest(root,id));
 if(requests.some(r=>!r.group.membership_complete||r.group.members.some(i=>i.references.length)))throw Error("Protected run");
 fs.writeFileSync(path.join(reports,"small-run-requests.json"),JSON.stringify(requests,null,2));
 console.log(JSON.stringify(requests));
}else if(process.argv[2]==="finalize"){
 const results=ids.map(id=>lifecycle.finalize(root,id));
 fs.writeFileSync(path.join(reports,"small-run-finalize.json"),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
}else throw Error("prepare or finalize required");
