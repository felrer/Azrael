"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");
const yazl=require(require.resolve("yazl",{paths:[path.join(__dirname,"../../extensions/azrael-ex")]}));
const toml=require(require.resolve("smol-toml",{paths:[path.join(__dirname,"../../extensions/azrael-ex")]}));
const {InstructionStore,LIMITS}=require("../instruction-package.cjs");
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
async function zip(files,modes={}) {
  const archive=new yazl.ZipFile(); const chunks=[];
  archive.outputStream.on("data",c=>chunks.push(c));
  const result=new Promise((yes,no)=>{archive.outputStream.on("end",()=>yes(Buffer.concat(chunks)));archive.outputStream.on("error",no);});
  for (const [name,text] of Object.entries(files)) archive.addBuffer(Buffer.from(text),name,{mode:modes[name] ?? 0o100644});
  archive.end(); return result;
}
async function fixture(v="1.0.0",options={}) {
  const components=[
    {id:"global",title:"Global",kind:"instructions",default:true,scope:"home",files:[{source:"instructions/AGENTS.md",target:"AGENTS.md"}]},
    {id:"agent",title:"Agent",kind:"agent",default:true,scope:"home",files:[{source:"agents/helper.toml",target:"agents/helper.toml"}]},
    {id:"skill",title:"Skill",kind:"skill",default:true,scope:"home",files:[{source:"skills/example/SKILL.md",target:"skills/example/SKILL.md"}]},
    {id:"config",title:"Config",kind:"config",default:true,scope:"home",configKeys:["enabled","default_subagent_model","default_subagent_reasoning_effort","max_concurrent_threads_per_session"],files:[{source:"config.example.toml",target:"config.toml"}]},
    {id:"work",title:"Work",kind:"playbook",default:false,scope:"workspace",files:[{source:"playbooks/work.md",target:"docs/playbooks/work.md"}]}
  ];
  const source={schemaVersion:1,instructionVersion:v,minimumAppVersion:options.minimumAppVersion || "0.4.0",components};
  const files={"azrael-environment.json":JSON.stringify(source),"instructions/AGENTS.md":`Global ${v}\n`,"agents/helper.toml":`model = "model-${v}"\n`,"skills/example/SKILL.md":`Skill ${v}\n`,"config.example.toml":`[agents]\nenabled = true\ndefault_subagent_model = "model-${v}"\ndefault_subagent_reasoning_effort = "medium"\nmax_concurrent_threads_per_session = 8\n`,"playbooks/work.md":`Work ${v}\n`,"aa/file.txt":"safe contents\n",...options.files};
  const descriptors=Object.entries(files).map(([path,text])=>({path,sha256:hash(Buffer.from(text)),size:Buffer.byteLength(text)})).sort((a,b)=>a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const documents=[{path:"instructions/AGENTS.md",title:"Global",kind:"instructions"},{path:"skills/example/SKILL.md",title:"Skill",kind:"skill"}];
  const docs=Buffer.from(JSON.stringify({documents:documents.map(d=>({...d,text:files[d.path]}))}));
  const archive=await zip({...files,...options.archiveFiles},options.modes);
  const manifest={...source,repository:"felrer/Azrael",sourceCommit:"a".repeat(40),sourceContentSha256:hash(Buffer.from(JSON.stringify(descriptors))),archive:{name:`azrael-instructions-${v}.zip`,sha256:hash(archive),size:archive.length},documentsAsset:{name:`azrael-instructions-${v}-documents.json`,sha256:hash(docs),size:docs.length},files:descriptors,documents};
  const urls={manifest:`https://github.com/felrer/Azrael/releases/download/instructions-v${v}/azrael-instructions-${v}-manifest.json`,archive:`https://github.com/felrer/Azrael/releases/download/instructions-v${v}/${manifest.archive.name}`,docs:`https://github.com/felrer/Azrael/releases/download/instructions-v${v}/${manifest.documentsAsset.name}`};
  const release={tag_name:`instructions-v${v}`,draft:false,prerelease:false,body:`Notes ${v}`,assets:[{name:`azrael-instructions-${v}-manifest.json`,browser_download_url:urls.manifest},{name:manifest.archive.name,browser_download_url:urls.archive},{name:manifest.documentsAsset.name,browser_download_url:urls.docs}]};
  return {v,manifest,archive,docs,release,urls};
}
async function context(t,fixtures,options={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"azrael-instruction-test-"));
  t.after(async()=>{assert.ok(path.basename(dir).startsWith("azrael-instruction-test-"));await fs.rm(dir,{recursive:true,force:true});});
  const calls=[];
  const request=async(url,opts)=>{
    calls.push(url); if (options.request) return options.request(url,opts);
    if (url.includes("/releases?")) return Buffer.from(JSON.stringify([...fixtures.map(f=>f.release),{draft:true,tag_name:"instructions-v99.0.0"},{draft:false,tag_name:"v0.4.0"}]));
    for (const f of fixtures) {
      if (url.endsWith(`/releases/tags/instructions-v${f.v}`)) return Buffer.from(JSON.stringify(f.release));
      if (url===f.urls.manifest) return Buffer.from(JSON.stringify(f.manifest));
      if (url===f.urls.archive) {opts.onProgress?.({received:f.archive.length,total:f.archive.length});return f.archive;}
      if (url===f.urls.docs) return f.docs;
    }
    throw new Error(`Unexpected fixture request ${url}`);
  };
  const store=new InstructionStore({stateRoot:path.join(dir,"home"),workspaceRoot:path.join(dir,"workspace"),appVersion:"0.4.0",engine:async()=>true,request,...options.store});
  return {dir,store,request,calls,home:store.homeRoot,workspace:store.workspaceRoot};
}
async function text(file) {return fs.readFile(file,"utf8");}
async function exists(file) {try{await fs.stat(file);return true;}catch(e){if(e.code==="ENOENT")return false;throw e;}}
function updateArchive(f,archive) {f.archive=archive;f.manifest.archive.sha256=hash(archive);f.manifest.archive.size=archive.length;}

test("GitHub release identity, documents before download, drafts and compatibility",async t=>{
  const fixtures=[await fixture(),await fixture("2.0.0",{minimumAppVersion:"1.0.0"}),await fixture("1.1.0-beta.1")]; fixtures[2].release.prerelease=true;
  const {store,calls}=await context(t,fixtures);
  const releases=await store.listReleases();assert.deepEqual(releases.map(r=>[r.version,r.compatible,r.prerelease]),[["2.0.0",false,false],["1.1.0-beta.1",true,true],["1.0.0",true,false]]);
  assert.equal(releases[2].notes,"Notes 1.0.0");
  const docs=await store.getDocuments("1.0.0");assert.equal(docs[0].text,"Global 1.0.0\n");assert.equal(calls.some(u=>u.endsWith(".zip")),false);
  assert.deepEqual((await store.getState()).downloadedVersions,[]);
});
test("complete download, progress, persistent state and compatible pin/unpin",async t=>{
  const {store,home,request}=await context(t,[await fixture(),await fixture("2.0.0",{minimumAppVersion:"1.0.0"})]);
  let progress=0;const state=await store.download("1.0.0",{onProgress:p=>progress=p.received});assert.ok(progress>0);assert.deepEqual(state.downloadedVersions,["1.0.0"]);assert.equal(state.appliedVersion,null);
  await store.pin("1.0.0");assert.equal((await new InstructionStore({stateRoot:home,appVersion:"0.4.0",request}).getState()).pinnedVersion,"1.0.0");
  await assert.rejects(store.pin("2.0.0"),/incompatible/);assert.equal((await store.getState()).pinnedVersion,"1.0.0");await store.pin(null);assert.equal((await store.getState()).pinnedVersion,null);
  await assert.rejects(store.download("2.0.0"),/incompatible/);
});
test("cached-only documents succeed after restart and never request missing or corrupt data",async t=>{
  const f=await fixture();const {store,home}=await context(t,[f]);await store.download(f.v);let calls=0;
  const restarted=new InstructionStore({stateRoot:home,appVersion:"0.4.0",request:async()=>{calls++;throw new Error("cached-only must not request network");}});
  const records=await restarted.getDocuments(f.v,{cachedOnly:true});assert.equal(records[0].text,"Global 1.0.0\n");assert.equal(calls,0);
  const docsFile=path.join(store.cache(f.v),"documents.json");const original=await fs.readFile(docsFile);await fs.rm(docsFile);await assert.rejects(restarted.getDocuments(f.v,{cachedOnly:true}),/Missing cached documents/);assert.equal(await exists(docsFile),false);assert.equal(calls,0);
  await fs.writeFile(docsFile,"corrupt");await assert.rejects(restarted.getDocuments(f.v,{cachedOnly:true}),/checksum/);assert.equal(await text(docsFile),"corrupt");assert.equal(calls,0);
  await fs.writeFile(docsFile,original);await assert.rejects(restarted.getDocuments("1.1.0",{cachedOnly:true}),/not downloaded/);assert.equal(calls,0);
});
test("pin permits its own version and guards apply/rollback until explicitly unpinned",async t=>{
  const {store,home}=await context(t,[await fixture(),await fixture("1.1.0")]);await store.download("1.0.0");await store.download("1.1.0");await store.pin("1.0.0");
  await store.apply("1.0.0",["global"]);await store.rollback("1.0.0");const before=await text(path.join(home,"AGENTS.md"));
  await assert.rejects(store.apply("1.1.0",["global"]),/is pinned; unpin/);await assert.rejects(store.rollback("1.1.0"),/is pinned; unpin/);assert.equal(await text(path.join(home,"AGENTS.md")),before);assert.equal((await store.getState()).appliedVersion,"1.0.0");
  await store.pin(null);await store.apply("1.1.0",["global"]);assert.equal((await store.getState()).appliedVersion,"1.1.0");
});
test("identical unmanaged files are adopted without rewriting and retain original bytes",async t=>{
  const {store,home}=await context(t,[await fixture(),await fixture("1.1.0")]);await store.download("1.0.0");await store.download("1.1.0");const file=path.join(home,"AGENTS.md");await fs.writeFile(file,"Global 1.0.0\n");
  const plan=await store.planApply("1.0.0",["global"]);assert.deepEqual(plan.conflicts,[]);assert.deepEqual(plan.diffs,[]);const before=await fs.stat(file);await store.apply("1.0.0",["global"]);const after=await fs.stat(file);assert.equal(after.mtimeMs,before.mtimeMs);
  let state=await store.getState();assert.equal(state.managed[file].original,Buffer.from("Global 1.0.0\n").toString("base64"));assert.deepEqual(state.selectedComponentIds,["global"]);
  await store.apply("1.1.0",["global"]);assert.equal(await text(file),"Global 1.1.0\n");await store.apply("1.1.0",[]);assert.equal(await text(file),"Global 1.0.0\n");state=await store.getState();assert.deepEqual(state.managed,{});
});
test("install/update/rollback merge only agent keys and preserve unrelated files",async t=>{
  const {store,home,workspace}=await context(t,[await fixture(),await fixture("1.1.0")]);
  await fs.mkdir(home,{recursive:true});await fs.writeFile(path.join(home,"config.toml"),'model = "keep-root"\n[agents]\ncustom_setting = "keep"\n[providers.mine]\ncredential = "keep"\n');
  await fs.mkdir(path.join(home,"skills/example"),{recursive:true});await fs.writeFile(path.join(home,"skills/example/custom.txt"),"keep");
  await store.download("1.0.0");await store.download("1.1.0");
  const plan=await store.planApply("1.0.0",["global","agent","skill","config","work"]);assert.equal(plan.conflicts.length,0);assert.equal(plan.diffs.length,5);
  const state=await store.apply("1.0.0",plan.components);assert.equal(state.appliedVersion,"1.0.0");assert.equal(await text(path.join(workspace,"docs/playbooks/work.md")),"Work 1.0.0\n");
  let config=toml.parse(await text(path.join(home,"config.toml")));assert.equal(config.model,"keep-root");assert.equal(config.providers.mine.credential,"keep");assert.equal(config.agents.custom_setting,"keep");assert.equal(config.agents.default_subagent_model,"model-1.0.0");
  await store.apply("1.1.0",plan.components);assert.equal(await text(path.join(home,"AGENTS.md")),"Global 1.1.0\n");await store.rollback("1.0.0");assert.equal(await text(path.join(home,"AGENTS.md")),"Global 1.0.0\n");
  await store.apply("1.0.0",[]);assert.equal(await exists(path.join(home,"AGENTS.md")),false);assert.equal(await exists(path.join(home,"skills/example/SKILL.md")),false);assert.equal(await text(path.join(home,"skills/example/custom.txt")),"keep");
  config=toml.parse(await text(path.join(home,"config.toml")));assert.equal(config.agents.enabled,undefined);assert.equal(config.agents.custom_setting,"keep");
});
test("workspace A/B selections and versions remain bound while home updates and rollback preserve foreign paths",async t=>{
  const {store:a,home,workspace:workspaceA,dir,request}=await context(t,[await fixture(),await fixture("1.1.0")]);await a.download("1.0.0");await a.download("1.1.0");await a.apply("1.0.0",["global","work"]);
  const fileA=path.join(workspaceA,"docs/playbooks/work.md"),workspaceB=path.join(dir,"workspace-b"),fileB=path.join(workspaceB,"docs/playbooks/work.md");
  const make=workspaceRoot=>new InstructionStore({stateRoot:home,workspaceRoot,appVersion:"0.4.0",request,engine:async()=>true});const b=make(workspaceB);let state=await b.getState();assert.deepEqual(state.selectedComponentIds,["global"]);assert.equal(state.currentWorkspaceVersion,null);assert.deepEqual(state.retainedWorkspaceVersions,[{root:workspaceA,version:"1.0.0",repository:"felrer/Azrael"}]);
  const originalA=state.managed[fileA];assert.equal(originalA.root,workspaceA);
  // Reject any incidental filesystem access to A while B is active.
  const originalLstat=fs.lstat,originalRead=fs.readFile;
  const foreign=file=>String(file)===workspaceA || String(file).startsWith(workspaceA+path.sep);
  fs.lstat=async(file,...args)=>{assert.equal(foreign(file),false,"foreign workspace lstat");return originalLstat(file,...args);};
  fs.readFile=async(file,...args)=>{assert.equal(foreign(file),false,"foreign workspace read");return originalRead(file,...args);};
  try {await b.apply("1.1.0",["global"]);assert.deepEqual((await b.getState()).managed[fileA],originalA);await b.apply("1.1.0",["global","work"]);}finally{fs.lstat=originalLstat;fs.readFile=originalRead;}
  assert.equal(await text(fileA),"Work 1.0.0\n");assert.equal(await text(fileB),"Work 1.1.0\n");state=await a.getState();assert.equal(state.appliedVersion,"1.1.0");assert.equal(state.currentWorkspaceVersion,"1.0.0");assert.deepEqual(state.selectedComponentIds,["global","work"]);
  await fs.writeFile(fileB,"B local edit");const originalB=(await a.getState()).managed[fileB];await a.apply("1.1.0",state.selectedComponentIds);assert.equal(await text(fileA),"Work 1.1.0\n");assert.equal(await text(fileB),"B local edit");assert.deepEqual((await a.getState()).managed[fileB],originalB);
  const withoutWorkspace=make(undefined);state=await withoutWorkspace.getState();assert.deepEqual(state.selectedComponentIds,["global"]);assert.equal(state.currentWorkspaceVersion,null);assert.equal(state.retainedWorkspaceVersions.length,2);await withoutWorkspace.rollback("1.0.0");
  assert.equal(await text(path.join(home,"AGENTS.md")),"Global 1.0.0\n");assert.equal(await text(fileA),"Work 1.1.0\n");assert.equal(await text(fileB),"B local edit");assert.equal((await a.getState()).currentWorkspaceVersion,"1.1.0");assert.equal((await b.planApply("1.1.0",["global","work"])).conflicts.some(c=>c.target===fileB),true);
});
test("legacy workspace receipts derive their binding without traversing foreign roots",async t=>{
  const {store:a,home,workspace:workspaceA,dir,request}=await context(t,[await fixture(),await fixture("1.1.0")]);await a.download("1.0.0");await a.download("1.1.0");await a.apply("1.0.0",["global","work"]);const fileA=path.join(workspaceA,"docs/playbooks/work.md");
  const legacy=JSON.parse(await text(a.file("state.json")));delete legacy.homeComponentIds;delete legacy.workspaceSelections;for(const r of Object.values(legacy.managed)){delete r.componentId;delete r.root;delete r.appliedVersion;delete r.repository;}await fs.writeFile(a.file("state.json"),JSON.stringify(legacy));
  const b=new InstructionStore({stateRoot:home,workspaceRoot:path.join(dir,"workspace-b"),appVersion:"0.4.0",request,engine:async()=>true});assert.deepEqual((await b.getState()).selectedComponentIds,["global"]);await b.apply("1.1.0",["global"]);assert.deepEqual((await b.getState()).managed[fileA],legacy.managed[fileA]);assert.equal(await text(fileA),"Work 1.0.0\n");
  let state=await a.getState();assert.deepEqual(state.selectedComponentIds,["global","work"]);assert.equal(state.currentWorkspaceVersion,"1.0.0");await a.apply("1.1.0",state.selectedComponentIds);state=await a.getState();assert.equal(state.managed[fileA].root,workspaceA);assert.equal(state.managed[fileA].appliedVersion,"1.1.0");
});
test("malformed foreign workspace and home receipts are rejected lexically",async t=>{
  const {store:a,home,dir,request}=await context(t,[await fixture()]);await a.download("1.0.0");await a.apply("1.0.0",["global","work"]);const good=JSON.parse(await text(a.file("state.json")));const b=new InstructionStore({stateRoot:home,workspaceRoot:path.join(dir,"workspace-b"),appVersion:"0.4.0",request,engine:async()=>true});
  const workspaceTarget=Object.keys(good.managed).find(target=>good.managed[target].scope==="workspace");const homeTarget=path.join(home,"AGENTS.md");
  for(const mutate of [s=>s.managed[workspaceTarget].root=path.join(dir,"wrong-root"),s=>s.managed[workspaceTarget].relative="../escape.md",s=>s.managed[workspaceTarget].relative="auth.json",s=>s.managed[workspaceTarget].sha256="invalid",s=>s.managed[workspaceTarget].config=true,s=>s.managed[homeTarget].relative="agents/other.toml",s=>s.workspaceSelections={"../relative-root":{selectedComponentIds:["work"],appliedVersion:"1.0.0",repository:"felrer/Azrael"}}]){const bad=JSON.parse(JSON.stringify(good));mutate(bad);await fs.writeFile(a.file("state.json"),JSON.stringify(bad));await assert.rejects(b.getState(),/receipt|Unsafe package path/);await assert.rejects(b.apply("1.0.0",["global"]),/receipt|Unsafe package path/);}
  await fs.writeFile(a.file("state.json"),JSON.stringify(good));assert.equal(await text(workspaceTarget),"Work 1.0.0\n");assert.equal(await text(homeTarget),"Global 1.0.0\n");
});
test("unmanaged files and local managed edits conflict without overwrite",async t=>{
  const {store,home}=await context(t,[await fixture(),await fixture("1.1.0")]);await store.download("1.0.0");await store.download("1.1.0");
  await fs.writeFile(path.join(home,"AGENTS.md"),"owned by user");let plan=await store.planApply("1.0.0",["global"]);assert.match(plan.conflicts[0].reason,/Unmanaged/);await assert.rejects(store.apply("1.0.0",["global"]),/conflicts/);assert.equal(await text(path.join(home,"AGENTS.md")),"owned by user");
  await fs.rm(path.join(home,"AGENTS.md"));await store.apply("1.0.0",["global"]);await fs.writeFile(path.join(home,"AGENTS.md"),"local edit");
  plan=await store.planApply("1.1.0",["global"]);assert.match(plan.conflicts[0].reason,/local changes/);assert.equal(plan.conflicts[0].current,"local edit");await assert.rejects(store.rollback("1.1.0"),/conflicts/);await assert.rejects(store.apply("1.0.0",[]),/conflicts/);assert.equal((await store.getState()).appliedVersion,"1.0.0");
});
test("managed config local edits block update and component removal",async t=>{
  const {store,home}=await context(t,[await fixture(),await fixture("1.1.0")]);await store.download("1.0.0");await store.download("1.1.0");await store.apply("1.0.0",["config"]);
  const file=path.join(home,"config.toml");await fs.writeFile(file,(await text(file)).replace('"model-1.0.0"','"user-model"'));
  const p=await store.planApply("1.1.0",["config"]);assert.match(p.conflicts[0].reason,/agents.default_subagent_model/);await assert.rejects(store.apply("1.0.0",[]),/conflicts/);assert.match(await text(file),/user-model/);
});
test("config restores retained original key values and unrelated later edits",async t=>{
  const {store,home}=await context(t,[await fixture()]);await store.download("1.0.0");await fs.writeFile(path.join(home,"config.toml"),'model="root"\n[agents]\nenabled=true\n');
  await store.apply("1.0.0",["config"]);const file=path.join(home,"config.toml");await fs.writeFile(file,(await text(file)).replace('model = "root"','model = "changed"'));await store.apply("1.0.0",[]);
  const config=toml.parse(await text(file));assert.equal(config.model,"changed");assert.equal(config.agents.enabled,true);assert.equal(config.agents.default_subagent_model,undefined);
});
test("cache immutability and cached source corruption",async t=>{
  const f=await fixture();const {store}=await context(t,[f]);await store.download(f.v);f.manifest.sourceCommit="b".repeat(40);await assert.rejects(store.download(f.v),/Immutable/);f.manifest.sourceCommit="a".repeat(40);
  await fs.writeFile(path.join(store.cache(f.v),"package/instructions/AGENTS.md"),"corrupt");await assert.rejects(store.planApply(f.v),/checksum/);assert.equal((await store.getState()).appliedVersion,null);
});
test("repository switching keeps applied ownership and rejects same-version cache replacement",async t=>{
  const f=await fixture();const {store,home,request}=await context(t,[f]);await store.download(f.v);await store.apply(f.v,["global"]);await store.pin(f.v);
  const switched=new InstructionStore({stateRoot:home,repository:"different/Instructions",appVersion:"0.4.0",engine:async()=>true,request:async(url,options)=>request(url.replace("different/Instructions","felrer/Azrael"),options)});
  let state=await switched.getState();assert.equal(state.repository,"different/Instructions");assert.equal(state.appliedRepository,"felrer/Azrael");assert.equal(state.pinnedRepository,"felrer/Azrael");assert.deepEqual(state.downloadedVersions,[]);
  f.manifest.repository="different/Instructions";await assert.rejects(switched.download(f.v),/Immutable/);await switched.pin(null);state=await switched.getState();assert.equal(state.appliedRepository,"felrer/Azrael");assert.equal(state.pinnedRepository,null);assert.equal(await text(path.join(home,"AGENTS.md")),"Global 1.0.0\n");
});
test("corrupt archive/docs and source digest rejected before installation",async t=>{
  const f=await fixture();const {store}=await context(t,[f]);const original=f.archive;f.archive=Buffer.from("bad");await assert.rejects(store.download(f.v),/checksum/);assert.deepEqual((await store.getState()).downloadedVersions,[]);f.archive=original;
  const docs=f.docs;f.docs=Buffer.from("bad");await assert.rejects(store.getDocuments(f.v),/checksum/);f.docs=docs;f.manifest.sourceContentSha256="0".repeat(64);await assert.rejects(store.getManifest(f.v),/content digest/);
});
test("unexpected ZIP files are rejected even with a matching archive hash",async t=>{
  const f=await fixture("1.0.0",{archiveFiles:{"unexpected.md":"evil"}});const {store}=await context(t,[f]);await assert.rejects(store.download(f.v),/Unexpected archive/);assert.deepEqual((await store.getState()).downloadedVersions,[]);
});
test("ZIP path traversal rejected independently of manifest",async t=>{
  const f=await fixture();updateArchive(f,Buffer.from(f.archive.toString("latin1").replaceAll("aa/file.txt","../file.txt"),"latin1"));const {store}=await context(t,[f]);await assert.rejects(store.download(f.v),/invalid relative path|Unsafe package path/);assert.deepEqual((await store.getState()).downloadedVersions,[]);
});
test("ZIP symlink rejected",async t=>{
  const f=await fixture("1.0.0",{modes:{"aa/file.txt":0o120777}});const {store}=await context(t,[f]);await assert.rejects(store.download(f.v),/symlink/);
});
test("missing and duplicate ZIP entries cannot claim a complete package",async t=>{
  const f=await fixture();const {store}=await context(t,[f]);
  const source=Object.fromEntries(f.manifest.files.map(entry=>[entry.path,entry.path==="azrael-environment.json" ? JSON.stringify({schemaVersion:f.manifest.schemaVersion,instructionVersion:f.v,minimumAppVersion:f.manifest.minimumAppVersion,components:f.manifest.components}) : "placeholder"]));
  delete source["instructions/AGENTS.md"];
  // Keep remaining bytes correct by obtaining their verified download first.
  await store.download(f.v);for(const name of Object.keys(source))source[name]=await text(path.join(store.cache(f.v),"package",name));await fs.rm(store.cache(f.v),{recursive:true});updateArchive(f,await zip(source));
  await assert.rejects(store.download(f.v),/missing files/);
  const archive=new yazl.ZipFile();const chunks=[];archive.outputStream.on("data",c=>chunks.push(c));const ready=new Promise(r=>archive.outputStream.on("end",r));archive.addBuffer(Buffer.from("safe contents\n"),"aa/file.txt");archive.addBuffer(Buffer.from("safe contents\n"),"aa/file.txt");archive.end();await ready;updateArchive(f,Buffer.concat(chunks));await assert.rejects(store.download(f.v),/Duplicate/);
});
test("manifest Windows aliases, reserved names, case collisions and excessive sizes rejected",async t=>{
  for (const name of ["NUL.txt","COM¹.txt","bad. ","PROGRA~1/a.txt","Case/x.txt","case/y.txt"]) {
    const f=await fixture("1.0.0",{files:name==="Case/x.txt" || name==="case/y.txt" ? {"Case/x.txt":"a","case/y.txt":"b"} : {[name]:"a"}});const {store}=await context(t,[f]);await assert.rejects(store.getManifest(f.v),/Unsafe|alias/);
  }
  const f=await fixture();f.manifest.files[0].size=LIMITS.file+1;const {store}=await context(t,[f]);await assert.rejects(store.getManifest(f.v),/manifest file/);
});
test("untrusted release identity, host and managed target scope rejected",async t=>{
  const f=await fixture();const {store}=await context(t,[f]);f.release.tag_name="instructions-v1.2.0";await assert.rejects(store.getManifest(f.v),/release/);f.release.tag_name=`instructions-v${f.v}`;
  f.release.assets[0].browser_download_url="https://evil.example/manifest";await assert.rejects(store.getManifest(f.v),/host/);f.release.assets[0].browser_download_url=f.urls.manifest;f.manifest.components[0].files[0].target="auth.json";await assert.rejects(store.getManifest(f.v),/scope/);
});
test("cancellation leaves no version cache or active changes",async t=>{
  const f=await fixture();const {store}=await context(t,[f]);const controller=new AbortController();controller.abort();await assert.rejects(store.download(f.v,{signal:controller.signal}),/cancelled/);assert.deepEqual((await store.getState()).downloadedVersions,[]);assert.equal((await store.getState()).appliedVersion,null);
});
test("symlinked cache root and target ancestor refused",async t=>{
  const {store,home,dir}=await context(t,[await fixture()]);await store.download("1.0.0");await fs.mkdir(path.join(dir,"outside"));await fs.symlink(path.join(dir,"outside"),path.join(home,"skills"),"junction");await assert.rejects(store.planApply("1.0.0",["skill"]),/Symlink/);
  const secondHome=path.join(dir,"home2");await fs.mkdir(secondHome);await fs.symlink(path.join(dir,"outside"),path.join(secondHome,"azrael"),"junction");const second=new InstructionStore({stateRoot:secondHome,appVersion:"0.4.0"});await assert.rejects(second.pin(null),/Symlink/);
});
test("concurrent target edits during native validation stop commit",async t=>{
  const {store,home}=await context(t,[await fixture()]);await store.download("1.0.0");store.engine=async()=>{await fs.writeFile(path.join(home,"AGENTS.md"),"concurrent edit");return true;};await assert.rejects(store.apply("1.0.0",["global"]),/changed concurrently/);assert.equal(await text(path.join(home,"AGENTS.md")),"concurrent edit");assert.equal((await store.getState()).appliedVersion,null);
});
test("native validation failure preserves files and state",async t=>{
  const {store,home}=await context(t,[await fixture()]);await store.download("1.0.0");store.engine=async({configPath})=>{assert.equal((toml.parse(await text(configPath))).agents.enabled,true);return false;};await assert.rejects(store.apply("1.0.0"),/validation failed/);assert.equal(await exists(path.join(home,"AGENTS.md")),false);assert.equal((await store.getState()).appliedVersion,null);assert.equal((await store.getState()).recoveryRequired,false);
});
test("handled commit failure rolls back previously written target and receipt",async t=>{
  const {store,home}=await context(t,[await fixture()]);await store.download("1.0.0");const original=fs.rename;let failed=false;
  fs.rename=async(from,to)=>{if(to===path.join(home,"agents/helper.toml") && !failed){failed=true;throw new Error("simulated disk failure");}return original(from,to);};
  try{await assert.rejects(store.apply("1.0.0",["global","agent"]),/simulated disk failure/);}finally{fs.rename=original;}
  assert.equal(failed,true);assert.equal(await exists(path.join(home,"AGENTS.md")),false);assert.equal((await store.getState()).appliedVersion,null);assert.equal((await store.getState()).recoveryRequired,false);
});
test("writer lock and per-instance busy flag prevent competing mutations",async t=>{
  const {store,home,request}=await context(t,[await fixture()]);await store.download("1.0.0");let started;const reached=new Promise(r=>started=r);let resume;const wait=new Promise(r=>resume=r);store.engine=async()=>{started();await wait;return true;};const applying=store.apply("1.0.0",["global"]);await reached;
  await assert.rejects(store.pin(null),/already in progress/);const competing=new InstructionStore({stateRoot:home,appVersion:"0.4.0",request});await assert.rejects(competing.pin(null),/writer lock/);resume();await applying;assert.equal((await store.getState()).appliedVersion,"1.0.0");
});
test("interruption journal blocks mutations; recovery restores backups",async t=>{
  const {store,home}=await context(t,[await fixture()]);await store.download("1.0.0");const target=path.join(home,"AGENTS.md");await fs.writeFile(target,"partially committed");
  const journal={schemaVersion:1,repository:"felrer/Azrael",state:null,targets:[{target,before:null,after:Buffer.from("partially committed").toString("base64")}]};await fs.writeFile(store.file("journal.json"),JSON.stringify(journal));
  assert.equal((await store.getState()).recoveryRequired,true);await assert.rejects(store.pin(null),/recovery required/);await store.recover();assert.equal(await exists(target),false);assert.equal((await store.getState()).recoveryRequired,false);
  await fs.writeFile(target,"new local edit");await fs.writeFile(store.file("journal.json"),JSON.stringify(journal));await assert.rejects(store.recover(),/newer local edits/);assert.equal(await text(target),"new local edit");
});

test("actual generated release assets agree with backend and native staged validation",async t=>{
  const assetRoot=process.env.AZRAEL_INSTRUCTION_RELEASE_ASSETS || path.join(__dirname,"../../artifacts/instructions/review-1.0.0");
  const manifestFile=path.join(assetRoot,"azrael-instructions-1.0.0-manifest.json");
  if (!await exists(manifestFile)) {t.skip("Generate release assets or set AZRAEL_INSTRUCTION_RELEASE_ASSETS for integration coverage");return;}
  const manifest=JSON.parse(await text(manifestFile));const v=manifest.instructionVersion;
  const urls={manifest:`https://github.com/felrer/Azrael/releases/download/instructions-v${v}/azrael-instructions-${v}-manifest.json`,archive:`https://github.com/felrer/Azrael/releases/download/instructions-v${v}/${manifest.archive.name}`,docs:`https://github.com/felrer/Azrael/releases/download/instructions-v${v}/${manifest.documentsAsset.name}`};
  const release={tag_name:`instructions-v${v}`,draft:false,prerelease:false,assets:[{name:`azrael-instructions-${v}-manifest.json`,browser_download_url:urls.manifest},{name:manifest.archive.name,browser_download_url:urls.archive},{name:manifest.documentsAsset.name,browser_download_url:urls.docs}]};
  const f={v,manifest,urls,release,archive:await fs.readFile(path.join(assetRoot,manifest.archive.name)),docs:await fs.readFile(path.join(assetRoot,manifest.documentsAsset.name))};
  let engine;
  const latestFile=path.join(__dirname,"../../artifacts/latest.json");
  if (await exists(latestFile)) {const latest=JSON.parse(await text(latestFile));const candidate=path.join(latest.releaseDirectory,"engine",process.platform==="win32" ? "codex.exe" : "codex");if(await exists(candidate))engine=candidate;}
  if (engine) t.diagnostic(`Native validator: existing artifact ${engine}; features list only; isolated CODEX_HOME`);
  else t.diagnostic("No existing native artifact available; generated-asset integration uses injected validator");
  const {store,home,workspace}=await context(t,[f],{store:{repository:manifest.repository,...engine && {engine}}});
  const docs=await store.getDocuments(v);assert.equal(docs.length,manifest.documents.length);await store.download(v);
  const offline=new InstructionStore({stateRoot:home,appVersion:"0.4.0",repository:manifest.repository,request:async()=>{assert.fail("Generated cached-only preview attempted network");}});assert.deepEqual(await offline.getDocuments(v,{cachedOnly:true}),docs);
  const ids=manifest.components.map(c=>c.id);const plan=await store.planApply(v,ids);assert.deepEqual(plan.conflicts,[]);assert.equal(plan.components.length,9);
  const state=await store.apply(v,ids);assert.equal(state.appliedVersion,v);assert.deepEqual(state.selectedComponentIds,ids);assert.equal(state.installedRepository,manifest.repository);assert.ok(Object.keys(state.managed).length>9);
  for(const c of manifest.components)for(const file of c.files){const target=path.join(c.scope==="home" ? home : workspace,file.target);assert.equal(await exists(target),true);}
  const receipt=JSON.parse(await text(store.file("state.json")));assert.equal(receipt.appliedVersion,v);assert.deepEqual(receipt.selectedComponentIds,ids);assert.deepEqual((await store.planApply(v,ids)).diffs,[]);
  t.diagnostic(`Verified generated assets ${assetRoot}; ${manifest.files.length} archive files; ${ids.length} components; ${Object.keys(receipt.managed).length} managed targets`);
});
