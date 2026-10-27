"use strict";
const fs=require("node:fs"), path=require("node:path"), assert=require("node:assert/strict"), crypto=require("node:crypto");
const repo=path.join(__dirname,".."), artifactRun=process.env.AZRAEL_PACKAGING_TEST_ROOT ? null : require('./artifact-run.cjs').beginArtifactRun(repo,{workId:'platform-packaging-checks',owner:'scripts/test-platform-packaging.cjs'});
const fixtureProject=path.join(process.env.AZRAEL_PACKAGING_TEST_ROOT || artifactRun.temporary,"portable-packaging-"+crypto.randomUUID()), root=path.join(fixtureProject,"artifacts/fixture");
fs.mkdirSync(root,{recursive:true});
const frozen=path.join(root,"scripts"); fs.mkdirSync(frozen);
for(const name of ["install-platform-release.cjs","package-platform-release.cjs","artifact-lifecycle.cjs","maintenance-lock-owner.cjs","maintenance-lock-worker.cjs","maintenance-owner-config.cjs","prepare-platform-host.cjs","platform-runtime.cjs","azrael-platforms.json","prepare-official-ui.ps1","prepare-ordinary-vscode.ps1"]) fs.copyFileSync(path.join(__dirname,name),path.join(frozen,name));
const s=require(path.join(frozen,"install-platform-release.cjs")), p=require(path.join(frozen,"platform-runtime.cjs")), pack=require(path.join(frozen,"package-platform-release.cjs"));
const lifecycle=require(path.join(frozen,"artifact-lifecycle.cjs"));
let checks=0; function check(name,fn) {fn(); checks++;console.log("PASS "+name);}
function put(root,name,data) {const file=path.join(root,name); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,data);return file;}
// On Mac this is explicitly a public-packaging metadata fixture. It validates
// receipt bindings using synthetic Mach-O bytes, never claims real signatures.
function packageFixture(options) {
  if(process.platform==="darwin") {
    const descriptor=p.resolvePlatform(),metadata=s.json(path.join(options.release,"build-info.json"));
    const native=new Map();
    for(const name of Object.keys(metadata.sha256)) {const bytes=fs.readFileSync(path.join(options.release,name));if(pack.isMachO(bytes)) native.set(name,{data:bytes});}
    const receipt=entries=>({schema:1,status:"passed",platform:p.platformIdentity(descriptor),policy:"adhoc-without-notarization",files:[...entries].map(([name,item])=>({path:name,beforeSha256:s.sha(item.data),sha256:s.sha(item.data),action:"preserved",signature:"adhoc",verified:true}))});
    const runtimeReceipt=receipt(native);put(options.release,"macos-signing.json",s.encode(runtimeReceipt));metadata.sha256["macos-signing.json"]=s.sha(s.encode(runtimeReceipt));put(options.release,"build-info.json",s.encode(metadata));
    const hostEntries=s.readZip(fs.readFileSync(options["host-vsix"]));hostEntries.set("extension/bin/signing-fixture",{data:Buffer.from("cffaedfe01020304","hex"),mode:0o755});
    const bytes=s.writeZip(hostEntries);fs.writeFileSync(options["host-vsix"],bytes);
    const hostReceipt=receipt(new Map([["bin/signing-fixture",hostEntries.get("extension/bin/signing-fixture")]]));put(path.dirname(options["host-vsix"]),"macos-host-signing.json",s.encode(hostReceipt));put(path.dirname(options["host-vsix"]),"preparation.json",s.encode({signing:hostReceipt,hostSha256:s.sha(bytes)}));
  }
  return pack.packageRelease({...options,"project-root":fixtureProject});
}
const release=path.join(root,"release");fs.mkdirSync(release);
const selected=p.resolvePlatform(), binaries={};for(const name of p.engineBinaryNames()) binaries[name]=s.sha(fs.readFileSync(put(release,"engine/"+name,process.platform==="darwin" ? Buffer.from("cffaedfe01020304","hex") : "frozen fixture "+name)));
if(process.platform!=="win32") for(const name of p.engineBinaryNames()) fs.chmodSync(path.join(release,"engine",name),0o755);
const provenance={schema:1,platform:p.platformIdentity(),source:{sourceSha256:"a".repeat(64)},binaries};
put(release,"engine/azrael-engine-build.json",s.encode(provenance));
const build={platform:p.platformIdentity(),engineVersion:"0.160.0",engineProvenance:provenance,sha256:Object.fromEntries(Object.entries(binaries).map(([name,hash])=>["engine/"+name,hash]))};put(release,"build-info.json",s.encode(build));
const nodePath=put(release,"node/"+p.executableName("node"),process.platform==="darwin" ? Buffer.from("cffaedfe01020305","hex") : "bundled node fixture");
if(process.platform!=="win32") fs.chmodSync(nodePath,0o755);
const nodeHash=s.sha(fs.readFileSync(nodePath));
const nativeManifest={schema:1,platform:p.platformIdentity(),node:{path:nodePath,sha256:nodeHash},files:{}};
put(release,"devin-native-build.json",s.encode(nativeManifest));build.sha256["node/"+p.executableName("node")]=nodeHash;build.sha256["devin-native-build.json"]=s.sha(s.encode(nativeManifest));put(release,"build-info.json",s.encode(build));
const config={schema:1,platform:p.platformIdentity(),engine:path.join(release,"engine",p.executableName("azrael")),bridge:path.join(release,"engine",p.executableName("azrael-bridge")),codexHome:path.join(root,"unused-state"),engineVersion:build.engineVersion,devinNative:{helper:path.join(release,"providers/devin/helper.mjs"),node:path.join(release,"node",p.executableName("node"))}};
const host=put(root,"template.vsix",s.writeZip(new Map([["extension/out/azrael-runtime.json",{data:s.encode(config)}],["extension.vsixmanifest",{data:Buffer.from('<PackageManifest><Metadata><Identity Id="azrael" /></Metadata></PackageManifest>')}]])));
const output=path.join(root,"package");
check("package frozen runtime and schema2 inventory",()=>{packageFixture({release,"host-vsix":host,output,version:"1.2.3"});assert.equal(s.verifyPackage(output).schema,2);});
const packageRecord=destination=>lifecycle.catalog(fixtureProject).find(record=>record.id===`platform-package:${destination}`);
check("standalone package references a protected real imported input owner",()=>{
  const consumer=packageRecord(output),input=lifecycle.catalog(fixtureProject).find(record=>record.id===consumer.references[0].id);
  assert(input);assert.equal(input.owner,"package-platform-release:imported-input");assert.equal(input.state,"retained");assert.equal(input.membership_complete,false);
  const registration=lifecycle.registerRequest(fixtureProject,input.id).group;
  assert.equal(registration.membership_complete,false);assert(registration.members.every(member=>member.protection_known===false && member.references.includes(`${consumer.id}:packaging-input`)));
  assert.equal(input.members.some(member=>member.path===release),false);
});
check("imported input owner is reused without promoting its retained state",()=>{
  const before=lifecycle.catalog(fixtureProject).find(record=>record.id===packageRecord(output).references[0].id),destination=path.join(root,"reused-input-package");
  const unknown=put(release,"source-not-declared.txt","original source sentinel");
  pack.packageRelease({"project-root":fixtureProject,release,"host-vsix":host,output:destination,version:"1.2.3"});
  assert.equal(packageRecord(destination).references[0].id,before.id);assert.deepEqual(lifecycle.catalog(fixtureProject).find(record=>record.id===before.id),before);
  assert(before.members.every(member=>member.path!==unknown));assert.equal(fs.readFileSync(unknown,"utf8"),"original source sentinel");
});
check("failed packaging records pending before output and preserves the failed outcome",()=>{
  const destination=path.join(root,"failed-package"),archive=destination+(selected.os==="win32" ? ".zip" : ".tar.gz"),record=lifecycle.recordLifecycle,seen=[];
  put(root,path.basename(archive),"existing archive sentinel");
  lifecycle.recordLifecycle=(project,request)=>{if(request.id===`platform-package:${destination}`) {seen.push(request.state);if(request.state==="pending") assert.equal(fs.existsSync(destination),false);}return record(project,request);};
  try {assert.throws(()=>pack.packageRelease({"project-root":fixtureProject,release,"host-vsix":host,output:destination,version:"1.2.3"}),/Archive destination already exists/);} finally {lifecycle.recordLifecycle=record;}
  assert.deepEqual(seen,["pending","failed"]);assert.equal(packageRecord(destination).state,"failed");assert.equal(packageRecord(destination).membership_complete,false);assert.equal(fs.readFileSync(archive,"utf8"),"existing archive sentinel");
});
check("explicit lifecycle must be a version that owns the selected release",()=>{
  const invalid=lifecycle.recordLifecycle(fixtureProject,{id:"invalid-explicit",kind:"run",owner:"packaging-fixture",state:"retained",membership_complete:false,members:[{path:path.join(root,"not-a-release"),role:"release"}]});
  const wrong=lifecycle.recordLifecycle(fixtureProject,{...invalid,id:"wrong-explicit",kind:"version"});
  for(const id of ["missing-explicit",invalid.id,wrong.id,packageRecord(output).references[0].id]) {
    const destination=path.join(root,"invalid-explicit-"+s.sha(id).slice(0,8));
    assert.throws(()=>pack.packageRelease({"project-root":fixtureProject,"lifecycle-id":id,release,"host-vsix":host,output:destination,version:"1.2.3"}),/Explicit lifecycle/);assert.equal(fs.existsSync(destination),false);
  }
});
check("source paths cannot be adopted as generated packaging inputs",()=>{
  const destination=path.join(root,"source-refused-package");assert.throws(()=>pack.packageRelease({"project-root":root,release,"host-vsix":host,output:destination,version:"1.2.3"}),/Source or management\/user state/);assert.equal(fs.existsSync(destination),false);assert.equal(lifecycle.catalog(root).length,0);
});
function copyReleaseFixture(name) {
  const copy=path.join(root,name);fs.cpSync(release,copy,{recursive:true});
  const metadata=s.json(path.join(copy,"devin-native-build.json"));metadata.node.path=path.join(copy,"node",p.executableName("node"));put(copy,"devin-native-build.json",s.encode(metadata));
  const info=s.json(path.join(copy,"build-info.json"));info.sha256["devin-native-build.json"]=s.sha(s.encode(metadata));put(copy,"build-info.json",s.encode(info));
  const template=put(root,name+".vsix",s.writeZip(new Map([["extension/out/azrael-runtime.json",{data:s.encode({...config,engine:path.join(copy,"engine",p.executableName("azrael")),bridge:path.join(copy,"engine",p.executableName("azrael-bridge")),devinNative:{...config.devinNative,node:metadata.node.path}})}],["extension.vsixmanifest",{data:Buffer.from('<PackageManifest><Metadata><Identity Id="azrael" /></Metadata></PackageManifest>')}]])));
  return {release:copy,"host-vsix":template};
}
check("existing release version owner is reused and explicit ownership remains supported",()=>{
  const fixture=copyReleaseFixture("owned-release"),owner=lifecycle.recordLifecycle(fixtureProject,{id:"existing-release-owner",kind:"version",owner:"packaging-fixture",version:"1.2.3",state:"retained",membership_complete:false,members:[{path:fixture.release,role:"release"}]}),destination=path.join(root,"owned-package");
  packageFixture({...fixture,output:destination,version:"1.2.3"});assert.equal(packageRecord(destination).references[0].id,owner.id);assert.deepEqual(lifecycle.catalog(fixtureProject).find(record=>record.id===owner.id),owner);
  const explicitOutput=path.join(root,"explicit-package");pack.packageRelease({...fixture,"project-root":fixtureProject,"lifecycle-id":owner.id,output:explicitOutput,version:"1.2.3"});
  assert(lifecycle.catalog(fixtureProject).find(record=>record.id===owner.id).members.some(member=>member.path===explicitOutput && member.role==="package"));
  const after=lifecycle.catalog(fixtureProject).find(record=>record.id===owner.id);assert.equal(after.state,owner.state);assert.equal(after.membership_complete,owner.membership_complete);
});
check("imported identity changes, path changes and overlapping ownership stay distinct",()=>{
  const fixture=copyReleaseFixture("identity-release"),destination=path.join(root,"identity-package");packageFixture({...fixture,output:destination,version:"1.2.3"});
  const input=packageRecord(destination).references[0].id;assert.notEqual(input,packageRecord(output).references[0].id);
  const file=path.join(fixture.release,"build-info.json"),before=fs.readFileSync(file);fs.writeFileSync(file,Buffer.concat([before,Buffer.from("\n")]));
  const changed=path.join(root,"changed-identity-package");assert.throws(()=>pack.packageRelease({...fixture,"project-root":fixtureProject,output:changed,version:"1.2.3"}),/Conflicting imported packaging input ownership/);assert.equal(fs.existsSync(changed),false);fs.writeFileSync(file,before);
  const conflict=copyReleaseFixture("conflicting-release");lifecycle.recordLifecycle(fixtureProject,{id:"overlapping-input-owner",kind:"run",owner:"packaging-fixture",state:"retained",membership_complete:false,members:[{path:path.join(conflict.release,"build-info.json"),role:"input"}]});
  const blocked=path.join(root,"conflicting-package");assert.throws(()=>packageFixture({...conflict,output:blocked,version:"1.2.3"}),/Conflicting imported packaging input ownership/);assert.equal(fs.existsSync(blocked),false);
});
check("imported ID collisions cannot replace an existing owner's identity",()=>{
  const before=lifecycle.recordLifecycle;let attempted=false;
  lifecycle.recordLifecycle=(project,request)=>{
    if(request.owner==="package-platform-release:imported-input") {attempted=true;before(project,{...request,owner:"different-owner"});}
    return before(project,request);
  };
  const fixture=copyReleaseFixture("collision-release"),destination=path.join(root,"collision-package");
  try {assert.throws(()=>packageFixture({...fixture,output:destination,version:"1.2.3"}),/Conflicting lifecycle identity/);} finally {lifecycle.recordLifecycle=before;}
  assert(attempted);assert.equal(fs.existsSync(destination),false);
  assert.throws(()=>pack.packageRelease({...fixture,"project-root":fixtureProject,output:destination,version:"1.2.3"}),/Conflicting imported packaging input identity/);assert.equal(fs.existsSync(destination),false);
});
check("explicit version state is preserved and concurrent changes are never overwritten",()=>{
  for(const [state,complete] of [["pending",false],["failed",false],["retained",true],["complete",false],["complete",true]]) {
    const fixture=copyReleaseFixture(`explicit-${state}-${complete}`),id=`explicit-${state}-${complete}`,destination=path.join(root,id+"-package");
    lifecycle.recordLifecycle(fixtureProject,{id,kind:"version",owner:"packaging-fixture",state,membership_complete:complete,members:[{path:fixture.release,role:"release"}]});
    packageFixture({...fixture,"lifecycle-id":id,output:destination,version:"1.2.3"});const after=lifecycle.catalog(fixtureProject).find(record=>record.id===id);assert.equal(after.state,state);assert.equal(after.membership_complete,complete);
  }
  const failedFixture=copyReleaseFixture("explicit-failure-release"),failedId="explicit-failure",failedOutput=path.join(root,"explicit-failure-package");
  lifecycle.recordLifecycle(fixtureProject,{id:failedId,kind:"version",owner:"packaging-fixture",state:"complete",membership_complete:true,members:[{path:failedFixture.release,role:"release"}]});
  put(root,path.basename(failedOutput)+(selected.os==="win32" ? ".zip" : ".tar.gz"),"existing archive");assert.throws(()=>packageFixture({...failedFixture,"lifecycle-id":failedId,output:failedOutput,version:"1.2.3"}),/Archive destination already exists/);
  const failed=lifecycle.catalog(fixtureProject).find(record=>record.id===failedId);assert.equal(failed.state,"failed");assert.equal(failed.membership_complete,false);
  const fixture=copyReleaseFixture("concurrent-release"),id="concurrent-version",destination=path.join(root,"concurrent-package");
  lifecycle.recordLifecycle(fixtureProject,{id,kind:"version",owner:"packaging-fixture",state:"retained",membership_complete:false,members:[{path:fixture.release,role:"release"}]});
  const record=lifecycle.recordLifecycle;let concurrent;
  lifecycle.recordLifecycle=(project,request)=>{const result=record(project,request);if(request.id===id && request.state==="pending") concurrent=record(project,{...result,state:"retained",membership_complete:false,references:[{id:"concurrent-consumer",reason:"fixture"}],expected_revision:result.revision});return result;};
  try {assert.throws(()=>packageFixture({...fixture,"lifecycle-id":id,output:destination,version:"1.2.3"}),/Stale lifecycle revision/);} finally {lifecycle.recordLifecycle=record;}
  assert.deepEqual(lifecycle.catalog(fixtureProject).find(record=>record.id===id),concurrent);
});
check("producer-shaped bundled Node bootstrap matches inventoried path",()=>{
  const shaped=path.join(root,"producer-release");fs.cpSync(release,shaped,{recursive:true});
  const relative="runtime/node/"+p.executableName("node"),target=path.join(shaped,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.renameSync(path.join(shaped,"node",p.executableName("node")),target);
  const native={...nativeManifest,node:{...nativeManifest.node,path:target,bundled:true}},metadata={...build,sha256:{...build.sha256}};delete metadata.sha256["node/"+p.executableName("node")];metadata.sha256[relative]=nodeHash;metadata.sha256["devin-native-build.json"]=s.sha(s.encode(native));put(shaped,"devin-native-build.json",s.encode(native));put(shaped,"build-info.json",s.encode(metadata));
  const shapedHost=put(root,"producer.vsix",s.writeZip(new Map([["extension/out/azrael-runtime.json",{data:s.encode({...config,engine:path.join(shaped,"engine",p.executableName("azrael")),bridge:path.join(shaped,"engine",p.executableName("azrael-bridge")),devinNative:{...config.devinNative,node:target}})}],["extension.vsixmanifest",{data:Buffer.from('<PackageManifest><Metadata><Identity Id="azrael" /></Metadata></PackageManifest>')}]])));
  const shapedOutput=path.join(root,"producer-package");pack.packageRelease({"project-root":fixtureProject,release:shaped,"host-vsix":shapedHost,output:shapedOutput,version:"1.2.4"});assert(fs.readFileSync(path.join(shapedOutput,"INSTALL.txt"),"utf8").includes("runtime/"+relative));s.verifyPackage(shapedOutput);
  native.node.sha256="0".repeat(64);put(shaped,"devin-native-build.json",s.encode(native));metadata.sha256["devin-native-build.json"]=s.sha(s.encode(native));put(shaped,"build-info.json",s.encode(metadata));assert.throws(()=>pack.packageRelease({"project-root":fixtureProject,release:shaped,"host-vsix":shapedHost,output:path.join(root,"bad-bootstrap"),version:"1.2.5"}),/Bundled installer Node/);
});
check("minimal package explicitly requires external Node without advertising a bundle",()=>{
  const minimal=path.join(root,"minimal-release");fs.mkdirSync(minimal);fs.cpSync(path.join(release,"engine"),path.join(minimal,"engine"),{recursive:true});
  const metadata={...build,sha256:Object.fromEntries(Object.entries(build.sha256).filter(([name])=>name.startsWith("engine/")))};put(minimal,"build-info.json",s.encode(metadata));
  const minimalConfig={...config,engine:path.join(minimal,"engine",p.executableName("azrael")),bridge:path.join(minimal,"engine",p.executableName("azrael-bridge"))};delete minimalConfig.devinNative;
  const minimalHost=put(root,"minimal.vsix",s.writeZip(new Map([["extension/out/azrael-runtime.json",{data:s.encode(minimalConfig)}],["extension.vsixmanifest",{data:Buffer.from('<PackageManifest><Metadata><Identity Id="azrael" /></Metadata></PackageManifest>')}]]))),minimalOutput=path.join(root,"minimal-package");
  pack.packageRelease({"project-root":fixtureProject,release:minimal,"host-vsix":minimalHost,output:minimalOutput,version:"1.2.6"});const guidance=fs.readFileSync(path.join(minimalOutput,"INSTALL.txt"),"utf8");assert.match(guidance,/Run: node install-platform-release/);assert.match(guidance,/Use a compatible Node runtime/);assert(!guidance.includes("Bundled installer Node:"));s.verifyPackage(minimalOutput);
});
if(process.platform!=="win32") {
  check("native tar.gz extraction verifies inventory",()=>{const extracted=path.join(root,"extracted");fs.mkdirSync(extracted);const result=require("node:child_process").spawnSync("tar",["-xzf",output+".tar.gz","-C",extracted],{encoding:"utf8",shell:false});assert.equal(result.status,0,result.stderr);s.verifyPackage(extracted);});
  check("native tar.gz retains executable modes",()=>{const executable=path.join(root,"extracted/runtime/engine",p.executableName("azrael"));assert.equal(fs.statSync(executable).mode&0o777,0o755);fs.accessSync(executable,fs.constants.X_OK);});
}
check("ZIP mode roundtrip",()=>{const bytes=s.writeZip(new Map([["bin/rg",{data:Buffer.from("rg"),mode:0o755}]]));assert.equal(s.readZip(bytes).get("bin/rg").mode,0o755);});
if(process.platform!=="win32") check("selected companion helper becomes executable and ZIP retains mode",()=>{
  const companion=path.join(root,"companion-mode"), name="node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper";
  const file=put(companion,name,'#!/bin/sh\nprintf "fixture-helper-ok"\n'),other=put(companion,name.replace("darwin-arm64","darwin-x64"),"other target");
  fs.chmodSync(file,0o644); fs.chmodSync(other,0o644);
  const tools=require(path.join(frozen,"prepare-platform-host.cjs")).normalizeCompanionModes(companion,{os:"darwin",vsixTarget:"darwin-arm64"});
  assert.equal(tools[0].sourceMode,0o644); assert.equal(tools[0].mode,0o755);assert.equal(fs.statSync(other).mode&0o777,0o644);
  fs.accessSync(file,fs.constants.X_OK);assert.equal(require("node:child_process").execFileSync(file,[],{encoding:"utf8"}),"fixture-helper-ok");
  assert.equal(s.readZip(s.writeZip(new Map([[name,{data:fs.readFileSync(file),mode:fs.statSync(file).mode&0o777}]]))).get(name).mode,0o755);
  fs.unlinkSync(file);fs.symlinkSync(other,file);assert.throws(()=>require(path.join(frozen,"prepare-platform-host.cjs")).normalizeCompanionModes(companion,{os:"darwin",vsixTarget:"darwin-arm64"}),/symlink/i);fs.unlinkSync(file);
});
check("path traversal refused before mutation",()=>{const manifest=s.json(path.join(output,"release-manifest.json"));manifest.files[0].path="../outside";const file=path.join(output,"release-manifest.json"),original=fs.readFileSync(file);fs.writeFileSync(file,s.encode(manifest));assert.throws(()=>s.verifyPackage(output),/Unsafe/);fs.writeFileSync(file,original);});
check("wrong platform refused",()=>{const manifest=s.json(path.join(output,"release-manifest.json")),file=path.join(output,"release-manifest.json"),original=fs.readFileSync(file);manifest.platform.os=selected.os==="win32" ? "linux" : "win32";fs.writeFileSync(file,s.encode(manifest));assert.throws(()=>s.verifyPackage(output),/platform/);fs.writeFileSync(file,original);});
check("tampered runtime refused before destination creation",()=>{const file=path.join(output,"runtime/engine",p.executableName("azrael")),original=fs.readFileSync(file),destination=path.join(root,"tampered-install");fs.writeFileSync(file,"tampered");assert.throws(()=>s.install({package:output,"install-root":destination,"state-root":path.join(root,"state"),"prepare-only":true}),/Hash mismatch/);assert.equal(fs.existsSync(destination),false);fs.writeFileSync(file,original);});
check("invalid executable inventory mode refused",()=>{const manifest=s.json(path.join(output,"release-manifest.json")),file=path.join(output,"release-manifest.json"),original=fs.readFileSync(file);manifest.files[0].mode=0o777;fs.writeFileSync(file,s.encode(manifest));assert.throws(()=>s.verifyPackage(output),/inventory/);fs.writeFileSync(file,original);});
check("unlisted state files refused",()=>{const file=put(output,"auth.json","secret fixture");assert.throws(()=>s.verifyPackage(output),/Uninventoried/);fs.unlinkSync(file);});
const moved=path.join(root,"relocated-package");fs.renameSync(output,moved);
const state=path.join(root,"state"),stateFile=put(state,"auth.json","existing state sentinel");
check("relocated prepare-only install preserves state and binds runtime",()=>{const receipt=s.install({package:moved,"install-root":path.join(root,"installations"),"state-root":state,"prepare-only":true,code:path.join(root,"nonexistent-code")});assert.equal(receipt.preparedOnly,true);assert.equal(fs.readFileSync(stateFile,"utf8"),"existing state sentinel");const actual=JSON.parse(s.readZip(fs.readFileSync(receipt.hostVsix)).get("extension/out/azrael-runtime.json").data);assert.equal(actual.engine,path.join(receipt.runtime,"engine",p.executableName("azrael")));assert.equal(actual.devinNative.node,path.join(receipt.runtime,"node",p.executableName("node")));assert.equal(actual.codexHome,state);assert.equal(s.json(path.join(receipt.runtime,"devin-native-build.json")).node.path,actual.devinNative.node);assert.equal(receipt.transformations.length,2);s.verifyBuild(receipt.runtime);});
check("side-by-side destination cannot be overwritten",()=>assert.throws(()=>s.install({package:moved,"install-root":path.join(root,"installations"),"state-root":state,"prepare-only":true}),/already exists/));
check("ordinary Codex state refused",()=>assert.throws(()=>s.install({package:moved,"install-root":path.join(root,"other-installations"),"state-root":path.join(require("node:os").homedir(),".codex"),"prepare-only":true}),/overlap/));
check("state/runtime overlap refused",()=>assert.throws(()=>s.install({package:moved,"install-root":state,"state-root":state,"prepare-only":true}),/overlap/));
check("ZIP archive traversal rejected",()=>assert.throws(()=>s.writeZip(new Map([["../evil",{data:Buffer.from("bad")}]])),/Unsafe/));
check("ZIP compressed entry tamper rejected",()=>{const data=s.writeZip(new Map([["safe",{data:Buffer.from("hello")}]]));data[34]^=255;assert.throws(()=>s.readZip(data));});
check("pinned branding owner operands and anchors",()=>{const target=path.join(root,"branding");for(const name of ["package.json","out/extension.js","webview/assets/app-initial-7a199c66e670.js","webview/assets/profile-dropdown-items-93d2a2e5b8d6.js"])put(target,name,fs.readFileSync(path.join(repo,"artifacts/upstream-ui/26.1007.21434",name)));require(path.join(frozen,"prepare-platform-host.cjs")).brandHost(target);assert.equal(s.json(path.join(target,"package.json")).contributes.viewsContainers.activitybar[0].title,"Azrael");assert.match(fs.readFileSync(path.join(target,"out/extension.js"),"utf8"),/runtime.engine/);});


check("Mac public signing receipts bind all native bytes and metadata",()=>{
 const selected=p.resolvePlatform("darwin","arm64"),data=Buffer.from("cffaedfe01020304","hex"),entries=new Map([["engine/azrael",{data}]]);
 const receipt={schema:1,status:"passed",platform:p.platformIdentity(selected),policy:"adhoc-without-notarization",files:[{path:"engine/azrael",beforeSha256:"a".repeat(64),sha256:s.sha(data),action:"signed-adhoc",signature:"adhoc",verified:true}]};
 assert.equal(pack.verifySigning(receipt,entries,selected),receipt);
 assert.throws(()=>pack.verifySigning(null,entries,selected),/invalid policy/);
 assert.throws(()=>pack.verifySigning({...receipt,files:[]},entries,selected),/inventory mismatch/);
 assert.throws(()=>pack.verifySigning({...receipt,files:[{...receipt.files[0],verified:false}]},entries,selected),/metadata/);
 assert.throws(()=>pack.verifySigning({...receipt,files:[{...receipt.files[0],sha256:"0".repeat(64)}]},entries,selected),/hash mismatch/);
 assert.throws(()=>pack.verifySigning({...receipt,files:[{...receipt.files[0],signature:"unsigned"}]},entries,selected),/metadata/);
 assert.equal(pack.verifySigning({...receipt,files:[{...receipt.files[0],action:"preserved",signature:"identity",beforeSha256:s.sha(data)}]},entries,selected).files[0].signature,"identity");
});
// The caller owns review and cleanup, including failed fixtures and metadata.
console.log(JSON.stringify({checks,platform:p.platformIdentity(),nativeUnixExecution:false,fixtureProject,retained:true,...(artifactRun?{runRoot:artifactRun.runRoot,lifecycleId:artifactRun.lifecycleId}:{})}));
