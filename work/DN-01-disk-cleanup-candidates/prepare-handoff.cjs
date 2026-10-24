const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.cwd(),life=require(path.join(root,'scripts/artifact-lifecycle.cjs'));
const run=path.join(root,'artifacts/tasks/DN-01-disk-cleanup-candidates/runs/formal-custody-handoff-20261024-r3'),reports=path.join(run,'reports');
fs.mkdirSync(path.join(reports,'provenance'),{recursive:true});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),norm=p=>path.resolve(p).toLowerCase(),inside=(a,b)=>a===b||b.startsWith(a+path.sep),overlap=(a,b)=>inside(a,b)||inside(b,a);
const rows=JSON.parse(fs.readFileSync(path.join(root,'artifacts/tasks/DN-01-disk-cleanup-candidates/runs/log-version-cleanup-20261024-r1/reports/version-groups.json'),'utf8')).rows;
const records=life.catalog(root),source=records.find(g=>g.id==='work:BI-01-legacy-custody:20261019');
const native=JSON.parse(fs.readFileSync(path.join(root,'work/DN-01-disk-cleanup-candidates/log-native.json'),'utf8'));
const others=records.filter(g=>g.id!==source.id).flatMap(g=>g.members.map(m=>({path:norm(m.path),group:g.id})));
const candidates=rows.filter(r=>r.custodialClaimCount&&['old-version-candidate-deferred','version-unresolved-preserve','mixed-or-invalid-version-preserve'].includes(r.category));
const result={at:new Date().toISOString(),source_id:source.id,source_revision:source.revision,entries:[],deferred:[]};
for(const c of candidates){
 const p=path.resolve(c.path),key=norm(p),reasons=[];
 if(!fs.existsSync(p)){result.deferred.push({path:p,reasons:['already absent']});continue;}
 if(!source.members.some(m=>norm(m.path)===key)||source.members.some(m=>norm(m.path)!==key&&inside(norm(m.path),key)))reasons.push('no exact custody root or partial ancestor');
 if(others.some(m=>overlap(key,m.path))||native.some(m=>m.remaining&&overlap(key,norm(m.path))))reasons.push('other producer/native ownership overlap');
 if(reasons.length){result.deferred.push({path:p,reasons});continue;}
 let files=0,bytes=0,anchor=null,code=0;const suspicious=[];
 function visit(q,d=0){const s=fs.lstatSync(q);if(s.isSymbolicLink()){suspicious.push('link:'+q);return;}
  const name=path.basename(q).toLowerCase();
  if(['.azrael-ex','.codex','.ssh','.git'].includes(name)||/^(?:original-state|backup|backups|recovery)$/.test(name)){suspicious.push('state-or-recovery:'+q);return;}
  if(s.isDirectory()){for(const n of fs.readdirSync(q))visit(path.join(q,n),d+1);return;}
  files++;bytes+=s.size;if(/\.(?:ps1|cjs|js|ts|py)$/i.test(q))code++;
  if(d<=2&&s.size&&s.size<=256*1024&&/\.(?:log|json)$/i.test(q)){
    const b=fs.readFileSync(q),t=b.toString('utf8');
    const generated=/(?:"(?:exitCode|exit_code|status|completed|checks|releaseVersion|passed|outcome|schema|generatedAt|test|command|argv|sha256|durationMs|fixtures?)"\s*:|\b(?:PASS|FAIL|TAP version|test result:|exit code|AssertionError|Traceback|Error:|running \d+ tests|powershell|node --test)\b)/i.test(t);
    if(generated&&(!anchor||(/(?:completion|build-result|summary|result)\.json$/i.test(q)&&!/(?:completion|build-result|summary|result)\.json$/i.test(anchor.path))))anchor={path:q,buffer:b};
  }
 }
 try{visit(p)}catch(e){reasons.push('inspection:'+e.message);}
 if(suspicious.length)reasons.push(...suspicious.slice(0,4));
 // Standalone text traces require their own recognizable generator output.
 // Directories require a terminal/result manifest or a concrete generated trace.
 if(!anchor)reasons.push('no recognized generation evidence within bounded inspection');
 if(reasons.length){result.deferred.push({path:p,files,bytes,reasons});continue;}
 const original=anchor.path,proof=path.join(reports,'provenance',hash(key).slice(0,20)+'.json');
 const originalBytes=anchor.buffer,metadata={path:p,observedAt:result.at,files,bytes,codeFiles:code,anchorOriginalPath:original,anchorOriginalSha256:hash(originalBytes),anchorContent:originalBytes.toString('utf8'),basis:'Actual generated command/test/build result content under project artifacts/logs; complete metadata inspection found no linked/user-state/recovery boundary. Historical test outcome is preserved, not promoted to passing.'};
 fs.writeFileSync(proof,JSON.stringify(metadata,null,2));
 result.entries.push({path:p,files,bytes,proof,proofSha256:hash(fs.readFileSync(proof)),codeFiles:code,category:c.category});
}
fs.writeFileSync(path.join(reports,'handoff-candidates.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({ready:result.entries.length,bytes:result.entries.reduce((n,e)=>n+e.bytes,0),deferred:result.deferred.length,pilot:result.entries.find(e=>path.basename(e.path)==='app-release-2026.0.4'),largest:result.entries.slice().sort((a,b)=>b.bytes-a.bytes).slice(0,8).map(e=>({path:e.path,MiB:e.bytes/2**20,code:e.codeFiles}))}));
