const fs=require('node:fs'),path=require('node:path');
const root=process.cwd(),out=path.join(root,'artifacts/tasks/DN-01-disk-cleanup-candidates/runs/log-version-cleanup-20261024-r1/reports');
fs.mkdirSync(out,{recursive:true});
const records=require(path.join(root,'scripts/artifact-lifecycle.cjs')).catalog(root);
fs.writeFileSync(path.join(out,'producer-catalog.json'),JSON.stringify(records));
const native=JSON.parse(fs.readFileSync(path.join(root,'work/DN-01-disk-cleanup-candidates/log-native.json'),'utf8'));
const norm=p=>path.resolve(p).toLowerCase(),under=(p,r)=>p===r||p.startsWith(r+path.sep);
const claims=[...records.filter(g=>g.id!=='work:BI-01-legacy-custody:20261019').flatMap(g=>g.members.map(m=>({path:norm(m.path),group:g.id,kind:g.kind,state:g.state,version:g.version}))),...native.map(m=>({path:norm(m.path),group:m.lifecycle_group_id,native:true}))];
const errors=[],entries=[],logroot=path.join(root,'artifacts/logs');
function walk(p,top,depth=0){
 const s=fs.lstatSync(p); if(s.isSymbolicLink()){top.links.push(p);return;}
 const own=claims.filter(c=>under(norm(p),c.path));
 if(own.length&&p!==top.path){const exact=own.filter(c=>norm(p)===c.path);if(exact.length){top.managed.push({path:p,claims:exact});return;}}
 if(s.isDirectory()){for(const e of fs.readdirSync(p))try{walk(path.join(p,e),top,depth+1)}catch(e){errors.push({path:path.join(p,e),error:e.message});}return;}
 top.bytes+=s.size;top.files++;
 if(depth<=3&&/\.(json|log|txt|md)$/i.test(p)&&s.size<256*1024){
  const text=fs.readFileSync(p,'utf8');const hits=[...new Set(text.match(/\b2026\.0\.\d+\b/g)||[])];
  if(hits.length)top.versionEvidence.push({path:p,versions:hits});
 }
}
for(const name of fs.readdirSync(logroot)){
 const p=path.join(logroot,name),top={name,path:p,bytes:0,files:0,links:[],managed:[],claims:claims.filter(c=>under(norm(p),c.path)),versionEvidence:[]};
 if(top.claims.length){top.managed.push({path:p,claims:top.claims});}else try{walk(p,top)}catch(e){errors.push({path:p,error:e.message});}
 entries.push(top);
}
const report={at:new Date().toISOString(),scope:logroot,entries,errors};
fs.writeFileSync(path.join(out,'log-inventory.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({entries:entries.length,unmanagedBytes:entries.reduce((n,e)=>n+e.bytes,0),errors:errors.length,top:entries.filter(e=>e.bytes).sort((a,b)=>b.bytes-a.bytes).slice(0,22).map(e=>({name:e.name,MiB:Math.round(e.bytes/2**20),files:e.files,versions:[...new Set(e.versionEvidence.flatMap(e=>e.versions))]}))}));
