"use strict";
const fs=require("node:fs"), path=require("node:path"), assert=require("node:assert/strict"), crypto=require("node:crypto");
const repo=path.join(__dirname,".."), root=path.join(repo,"artifacts/verification","portable-packaging-"+crypto.randomUUID());
fs.mkdirSync(root,{recursive:true});
const frozen=path.join(root,"scripts"); fs.mkdirSync(frozen);
for(const name of ["install-platform-release.cjs","package-platform-release.cjs","prepare-platform-host.cjs","platform-runtime.cjs","azrael-platforms.json","prepare-official-ui.ps1","prepare-ordinary-vscode.ps1"]) fs.copyFileSync(path.join(__dirname,name),path.join(frozen,name));
const s=require(path.join(frozen,"install-platform-release.cjs")), p=require(path.join(frozen,"platform-runtime.cjs")), pack=require(path.join(frozen,"package-platform-release.cjs"));
let checks=0; function check(name,fn) {fn(); checks++;console.log("PASS "+name);}
function put(root,name,data) {const file=path.join(root,name); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,data);return file;}
const release=path.join(root,"release");fs.mkdirSync(release);
const selected=p.resolvePlatform(), binaries={};for(const name of p.engineBinaryNames()) binaries[name]=s.sha(fs.readFileSync(put(release,"engine/"+name,"frozen fixture "+name)));
if(process.platform!=="win32") for(const name of p.engineBinaryNames()) fs.chmodSync(path.join(release,"engine",name),0o755);
const provenance={schema:1,platform:p.platformIdentity(),source:{sourceSha256:"a".repeat(64)},binaries};
put(release,"engine/azrael-engine-build.json",s.encode(provenance));
const build={platform:p.platformIdentity(),engineVersion:"0.160.0",engineProvenance:provenance,sha256:Object.fromEntries(Object.entries(binaries).map(([name,hash])=>["engine/"+name,hash]))};put(release,"build-info.json",s.encode(build));
const nodePath=put(release,"node/"+p.executableName("node"),"bundled node fixture");
if(process.platform!=="win32") fs.chmodSync(nodePath,0o755);
const nodeHash=s.sha(fs.readFileSync(nodePath));
const nativeManifest={schema:1,platform:p.platformIdentity(),node:{path:nodePath,sha256:nodeHash},files:{}};
put(release,"devin-native-build.json",s.encode(nativeManifest));build.sha256["node/"+p.executableName("node")]=nodeHash;build.sha256["devin-native-build.json"]=s.sha(s.encode(nativeManifest));put(release,"build-info.json",s.encode(build));
const config={schema:1,platform:p.platformIdentity(),engine:path.join(release,"engine",p.executableName("codex")),bridge:path.join(release,"engine",p.executableName("azrael-bridge")),codexHome:path.join(root,"unused-state"),engineVersion:build.engineVersion,devinNative:{helper:path.join(release,"providers/devin/helper.mjs"),node:path.join(release,"node",p.executableName("node"))}};
const host=put(root,"template.vsix",s.writeZip(new Map([["extension/out/azrael-runtime.json",{data:s.encode(config)}],["extension.vsixmanifest",{data:Buffer.from('<PackageManifest><Metadata><Identity Id="azrael" /></Metadata></PackageManifest>')}]])));
const output=path.join(root,"package");
check("package frozen runtime and schema2 inventory",()=>{pack.packageRelease({release,"host-vsix":host,output,version:"1.2.3"});assert.equal(s.verifyPackage(output).schema,2);});
check("producer-shaped bundled Node bootstrap matches inventoried path",()=>{
  const shaped=path.join(root,"producer-release");fs.cpSync(release,shaped,{recursive:true});
  const relative="runtime/node/"+p.executableName("node"),target=path.join(shaped,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.renameSync(path.join(shaped,"node",p.executableName("node")),target);
  const native={...nativeManifest,node:{...nativeManifest.node,path:target,bundled:true}},metadata={...build,sha256:{...build.sha256}};delete metadata.sha256["node/"+p.executableName("node")];metadata.sha256[relative]=nodeHash;metadata.sha256["devin-native-build.json"]=s.sha(s.encode(native));put(shaped,"devin-native-build.json",s.encode(native));put(shaped,"build-info.json",s.encode(metadata));
  const shapedHost=put(root,"producer.vsix",s.writeZip(new Map([["extension/out/azrael-runtime.json",{data:s.encode({...config,engine:path.join(shaped,"engine",p.executableName("codex")),bridge:path.join(shaped,"engine",p.executableName("azrael-bridge")),devinNative:{...config.devinNative,node:target}})}],["extension.vsixmanifest",{data:Buffer.from('<PackageManifest><Metadata><Identity Id="azrael" /></Metadata></PackageManifest>')}]])));
  const shapedOutput=path.join(root,"producer-package");pack.packageRelease({release:shaped,"host-vsix":shapedHost,output:shapedOutput,version:"1.2.4"});assert(fs.readFileSync(path.join(shapedOutput,"INSTALL.txt"),"utf8").includes("runtime/"+relative));s.verifyPackage(shapedOutput);
  native.node.sha256="0".repeat(64);put(shaped,"devin-native-build.json",s.encode(native));metadata.sha256["devin-native-build.json"]=s.sha(s.encode(native));put(shaped,"build-info.json",s.encode(metadata));assert.throws(()=>pack.packageRelease({release:shaped,"host-vsix":shapedHost,output:path.join(root,"bad-bootstrap"),version:"1.2.5"}),/Bundled installer Node/);
});
check("minimal package explicitly requires external Node without advertising a bundle",()=>{
  const minimal=path.join(root,"minimal-release");fs.mkdirSync(minimal);fs.cpSync(path.join(release,"engine"),path.join(minimal,"engine"),{recursive:true});
  const metadata={...build,sha256:Object.fromEntries(Object.entries(build.sha256).filter(([name])=>name.startsWith("engine/")))};put(minimal,"build-info.json",s.encode(metadata));
  const minimalConfig={...config,engine:path.join(minimal,"engine",p.executableName("codex")),bridge:path.join(minimal,"engine",p.executableName("azrael-bridge"))};delete minimalConfig.devinNative;
  const minimalHost=put(root,"minimal.vsix",s.writeZip(new Map([["extension/out/azrael-runtime.json",{data:s.encode(minimalConfig)}],["extension.vsixmanifest",{data:Buffer.from('<PackageManifest><Metadata><Identity Id="azrael" /></Metadata></PackageManifest>')}]]))),minimalOutput=path.join(root,"minimal-package");
  pack.packageRelease({release:minimal,"host-vsix":minimalHost,output:minimalOutput,version:"1.2.6"});const guidance=fs.readFileSync(path.join(minimalOutput,"INSTALL.txt"),"utf8");assert.match(guidance,/Run: node install-platform-release/);assert.match(guidance,/Use a compatible Node runtime/);assert(!guidance.includes("Bundled installer Node:"));s.verifyPackage(minimalOutput);
});
if(process.platform!=="win32") {
  check("native tar.gz extraction verifies inventory",()=>{const extracted=path.join(root,"extracted");fs.mkdirSync(extracted);const result=require("node:child_process").spawnSync("tar",["-xzf",output+".tar.gz","-C",extracted],{encoding:"utf8",shell:false});assert.equal(result.status,0,result.stderr);s.verifyPackage(extracted);});
  check("native tar.gz retains executable modes",()=>{const executable=path.join(root,"extracted/runtime/engine",p.executableName("codex"));assert.equal(fs.statSync(executable).mode&0o777,0o755);fs.accessSync(executable,fs.constants.X_OK);});
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
check("tampered runtime refused before destination creation",()=>{const file=path.join(output,"runtime/engine",p.executableName("codex")),original=fs.readFileSync(file),destination=path.join(root,"tampered-install");fs.writeFileSync(file,"tampered");assert.throws(()=>s.install({package:output,"install-root":destination,"state-root":path.join(root,"state"),"prepare-only":true}),/Hash mismatch/);assert.equal(fs.existsSync(destination),false);fs.writeFileSync(file,original);});
check("invalid executable inventory mode refused",()=>{const manifest=s.json(path.join(output,"release-manifest.json")),file=path.join(output,"release-manifest.json"),original=fs.readFileSync(file);manifest.files[0].mode=0o777;fs.writeFileSync(file,s.encode(manifest));assert.throws(()=>s.verifyPackage(output),/inventory/);fs.writeFileSync(file,original);});
check("unlisted state files refused",()=>{const file=put(output,"auth.json","secret fixture");assert.throws(()=>s.verifyPackage(output),/Uninventoried/);fs.unlinkSync(file);});
const moved=path.join(root,"relocated-package");fs.renameSync(output,moved);
const state=path.join(root,"state"),stateFile=put(state,"auth.json","existing state sentinel");
check("relocated prepare-only install preserves state and binds runtime",()=>{const receipt=s.install({package:moved,"install-root":path.join(root,"installations"),"state-root":state,"prepare-only":true,code:path.join(root,"nonexistent-code")});assert.equal(receipt.preparedOnly,true);assert.equal(fs.readFileSync(stateFile,"utf8"),"existing state sentinel");const actual=JSON.parse(s.readZip(fs.readFileSync(receipt.hostVsix)).get("extension/out/azrael-runtime.json").data);assert.equal(actual.engine,path.join(receipt.runtime,"engine",p.executableName("codex")));assert.equal(actual.devinNative.node,path.join(receipt.runtime,"node",p.executableName("node")));assert.equal(actual.codexHome,state);assert.equal(s.json(path.join(receipt.runtime,"devin-native-build.json")).node.path,actual.devinNative.node);assert.equal(receipt.transformations.length,2);s.verifyBuild(receipt.runtime);});
check("side-by-side destination cannot be overwritten",()=>assert.throws(()=>s.install({package:moved,"install-root":path.join(root,"installations"),"state-root":state,"prepare-only":true}),/already exists/));
check("ordinary Codex state refused",()=>assert.throws(()=>s.install({package:moved,"install-root":path.join(root,"other-installations"),"state-root":path.join(require("node:os").homedir(),".codex"),"prepare-only":true}),/overlap/));
check("state/runtime overlap refused",()=>assert.throws(()=>s.install({package:moved,"install-root":state,"state-root":state,"prepare-only":true}),/overlap/));
check("ZIP archive traversal rejected",()=>assert.throws(()=>s.writeZip(new Map([["../evil",{data:Buffer.from("bad")}]])),/Unsafe/));
check("ZIP compressed entry tamper rejected",()=>{const data=s.writeZip(new Map([["safe",{data:Buffer.from("hello")}]]));data[34]^=255;assert.throws(()=>s.readZip(data));});
check("pinned branding owner operands and anchors",()=>{const target=path.join(root,"branding");for(const name of ["package.json","out/extension.js","webview/assets/app-initial-7a199c66e670.js","webview/assets/profile-dropdown-items-93d2a2e5b8d6.js"])put(target,name,fs.readFileSync(path.join(repo,"artifacts/upstream-ui/26.1007.21434",name)));require(path.join(frozen,"prepare-platform-host.cjs")).brandHost(target);assert.equal(s.json(path.join(target,"package.json")).contributes.viewsContainers.activitybar[0].title,"Azrael");assert.match(fs.readFileSync(path.join(target,"out/extension.js"),"utf8"),/runtime.engine/);});
console.log(JSON.stringify({checks,fixtureRoot:root,frozenSources:frozen,platform:p.platformIdentity(),nativeUnixExecution:false}));
