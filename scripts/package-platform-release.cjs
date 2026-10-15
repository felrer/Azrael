"use strict";
const fs=require("node:fs"), path=require("node:path"), {spawnSync}=require("node:child_process");
const {isDeepStrictEqual}=require("node:util");
const shared=require("./install-platform-release.cjs"), platform=require("./platform-runtime.cjs");
const lifecycle=require("./artifact-lifecycle.cjs");
function isMachO(bytes) {
  return bytes.length >= 4 && ["feedface","cefaedfe","feedfacf","cffaedfe","cafebabe","bebafeca","cafebabf","bfbafeca"].includes(bytes.subarray(0,4).toString("hex"));
}
function verifySigning(receipt, entries, selected) {
  const fail=message=>{throw new Error("Mac signing receipt: "+message);};
  if(receipt?.schema!==1 || receipt.status!=="passed" || receipt.policy!=="adhoc-without-notarization" || !isDeepStrictEqual(receipt.platform,platform.platformIdentity(selected)) || !Array.isArray(receipt.files)) fail("invalid policy/status/platform.");
  const native=[...entries].filter(([,entry])=>isMachO(entry.data));
  if(!native.length || receipt.files.length!==native.length) fail("native inventory mismatch.");
  for(const [name,item] of native) {
    const matches=receipt.files.filter(file=>file.path===name), file=matches[0];
    if(matches.length!==1 || file.verified!==true || !["adhoc","identity"].includes(file.signature) || !["preserved","signed-adhoc"].includes(file.action) || (file.action==="signed-adhoc" && file.signature!=="adhoc") || !/^[0-9a-f]{64}$/.test(file.beforeSha256 || "")) fail("missing signature metadata for "+name);
    if(file.action==="preserved" && file.beforeSha256!==file.sha256) fail("preserved signature hash mismatch for "+name);
    if(file.sha256!==shared.sha(item.data)) fail("final hash mismatch for "+name);
  }
  return receipt;
}
function packageRelease(options) {
  const release=shared.inspectPath(shared.absolute(options.release)), host=shared.inspectPath(shared.absolute(options["host-vsix"]));
  const output=shared.inspectPath(shared.absolute(options.output)), version=shared.version(options.version);
  shared.disjoint(release,output); shared.disjoint(host,output);
  if (fs.existsSync(output)) throw new Error("Output must be a new directory.");
  const {build,selected}=shared.verifyBuild(release);
  const hostBytes=fs.readFileSync(host), hostFiles=shared.readZip(hostBytes);
  const config=JSON.parse(hostFiles.get("extension/out/azrael-runtime.json")?.data.toString("utf8") || "null");
  if (!config) throw new Error("Host template is missing runtime identity.");
  platform.validateRuntimePlatform(config.platform);
  if (path.resolve(config.engine)!==path.join(release,"engine",platform.executableName("azrael",selected))) throw new Error("Host template selects a different release.");
  const files=new Map();
  const forbidden=/(^|\/)(?:\.env(?:\..*)?|auth\.json|accounts\.json|sessions|cache|\.codex|\.azrael-ex|node_modules\/\.cache)(?:\/|$)/i;
  // Runtime files must be declared by the build, not discovered from user state.
  const names=new Set(["build-info.json","engine/azrael-engine-build.json",...Object.keys(build.sha256)]);
  for (const name of names) {
    shared.relative(name);
    if (forbidden.test(name)) throw new Error(`State/secret/cache path cannot be packaged: ${name}`);
    if (selected.os!=="win32" && /^(computer-use|window-control)\//.test(name)) throw new Error("Unix desktop runtime is outside the selected contract.");
    const source=shared.fileAt(release,name), stat=fs.statSync(source);
    const mode=selected.os==="win32" ? 0o644 : (stat.mode&0o111 ? 0o755 : 0o644);
    files.set("runtime/"+name,{data:fs.readFileSync(source),mode});
  }
  let signing, signingReceiptSha256, hostSigningReceiptSha256;
  if(selected.os==="darwin") {
    if(!build.sha256["macos-signing.json"]) throw new Error("Mac signing receipt must be bound to build hashes.");
    const runtimeEntries=new Map([...files].map(([name,item])=>[name.slice(8),item]));
    const runtimeReceipt=shared.json(shared.fileAt(release,"macos-signing.json"));
    verifySigning(runtimeReceipt,runtimeEntries,selected);
    const hostReceiptBytes=fs.readFileSync(shared.fileAt(path.dirname(host),"macos-host-signing.json")),hostReceipt=JSON.parse(hostReceiptBytes);
    const hostEntries=new Map([...hostFiles].filter(([name])=>name.startsWith("extension/")).map(([name,item])=>[name.slice(10),item]));
    verifySigning(hostReceipt,hostEntries,selected);
    const preparation=shared.json(shared.fileAt(path.dirname(host),"preparation.json"));
    if(preparation.hostSha256!==shared.sha(hostBytes) || !isDeepStrictEqual(preparation.signing,hostReceipt)) throw new Error("Mac host signing preparation binding mismatch.");
    files.set("host-signing.json",{data:hostReceiptBytes,mode:0o644});
    signingReceiptSha256=build.sha256["macos-signing.json"];hostSigningReceiptSha256=shared.sha(hostReceiptBytes);
    signing={policy:runtimeReceipt.policy,status:"passed"};
  }
  files.set("host-template.vsix",{data:hostBytes,mode:0o644});
  for (const name of ["install-platform-release.cjs","platform-runtime.cjs","azrael-platforms.json"]) files.set(name,{data:fs.readFileSync(path.join(__dirname,name)),mode:0o644});
  let bootstrap="node",bootstrapNote="Use a compatible Node runtime to run the installer.";
  if(build.sha256["devin-native-build.json"]) {
    const native=shared.json(shared.fileAt(release,"devin-native-build.json")); platform.validateRuntimePlatform(native.platform);
    if(native.node?.bundled || (native.node?.path && shared.within(release,native.node.path))) {
      const relative=shared.relative(path.relative(release,shared.absolute(native.node.path)).split(path.sep).join("/"));
      const entry=files.get("runtime/"+relative);
      if(!entry || path.basename(relative)!==platform.executableName("node",selected) || shared.sha(entry.data)!==native.node.sha256 ||
          (selected.os!=="win32" && !(entry.mode&0o111)) || (config.devinNative?.node && path.resolve(config.devinNative.node)!==path.resolve(native.node.path))) {
        throw new Error("Bundled installer Node must match the contained executable inventory.");
      }
      bootstrap="runtime/"+relative; bootstrapNote=`Bundled installer Node: ${bootstrap}`;
    }
  }
  const macGuidance=selected.os==="darwin" ? "Distribution: adhoc-without-notarization. This distribution is not Developer ID-signed or Apple-notarized; ad-hoc signatures do not establish developer identity. macOS ARM64 is the target; support is qualified only by the named macOS version and environment in the release verification. Verify the SHA-256 checksums before installing. If Gatekeeper blocks a trusted item, open System Settings > Privacy & Security > Open Anyway after attempting to launch it. Follow https://support.apple.com/en-lamr/102445 . VS Code extensions may contain several native helpers: the actual installed extension and helper launch paths must be tested on the qualified target. Contact the release repository support if a helper remains blocked.\n" : "";
  files.set("INSTALL.txt",{data:Buffer.from(`Extract this archive into a new directory. Run: ${bootstrap} install-platform-release.cjs --package ABSOLUTE_EXTRACTED_DIRECTORY --prepare-only\n${bootstrapNote}\nOmit --prepare-only to install the prepared VSIX into VS Code. State remains in ~/.azrael-ex. Updates and rollback select an explicit side-by-side version.\n${macGuidance}`),mode:0o644});
  const inventory=[...files].map(([name,item])=>({path:name,sha256:shared.sha(item.data),size:item.data.length,mode:item.mode}));
  const manifest={schema:2,version,platform:platform.platformIdentity(selected),files:inventory,provenance:{buildInfoSha256:shared.sha(fs.readFileSync(path.join(release,"build-info.json"))),engine:build.engineProvenance,hostTemplateSha256:shared.sha(hostBytes),...(signing ? {signingReceiptSha256,hostSigningReceiptSha256} : {})},...(signing ? {signing} : {}),distribution:selected.os==="darwin" ? "adhoc-without-notarization" : "local-package"};
  // Recheck frozen inputs before writing a package, then verify the written copy.
  shared.verifyBuild(release);
  if (shared.sha(fs.readFileSync(host))!==shared.sha(hostBytes)) throw new Error("Host input changed during packaging.");
  const archive=output+(selected.os==="win32" ? ".zip" : ".tar.gz");
  const lifecycleRoot=options["project-root"] || path.resolve(__dirname,"..");
  const parent=lifecycle.catalog(lifecycleRoot).find(record=>record.id===options["lifecycle-id"]);
  if(options["lifecycle-id"] && (!parent || parent.kind!=="version" || !parent.members.some(member=>member.path===release && member.role==="release"))) throw new Error("Explicit lifecycle does not own selected release.");
  const related=lifecycle.catalog(lifecycleRoot).find(record=>record.kind==="version" && record.members.some(member=>member.path===release && member.role==="release"));
  const lifecycleRecord=parent ? {...parent,members:[{path:output,role:"package"},{path:archive,role:"archive"}]} :
    {id:`platform-package:${output}`,kind:"run",owner:"package-platform-release",version,members:[{path:output,role:"package"},{path:archive,role:"archive"}],references:[{id:related?.id || `release:${release}`,reason:"packaging-input"}]};
  lifecycle.recordLifecycle(lifecycleRoot,{...lifecycleRecord,state:"pending",membership_complete:false});
  try {
  fs.mkdirSync(output,{recursive:true});
  for (const [name,item] of files) { const target=path.join(output,name); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,item.data,{flag:"wx",mode:item.mode}); fs.chmodSync(target,item.mode); }
  fs.writeFileSync(path.join(output,"release-manifest.json"),shared.encode(manifest),{flag:"wx"});
  shared.verifyPackage(output);
  if (fs.existsSync(archive)) throw new Error("Archive destination already exists.");
  if (selected.os==="win32") { files.set("release-manifest.json",{data:shared.encode(manifest),mode:0o644}); fs.writeFileSync(archive,shared.writeZip(files),{flag:"wx"}); }
  else { const result=spawnSync("tar",["-czf",archive,"-C",output,"--",...shared.walk(output)],{encoding:"utf8",shell:false}); if (result.error || result.status!==0) throw new Error("Release archive creation failed."); }
  lifecycle.recordLifecycle(lifecycleRoot,{...lifecycleRecord,state:"complete",membership_complete:true});
  return {output,archive,platform:manifest.platform,version,files:inventory.length};
  } catch(error) {
    try { lifecycle.recordLifecycle(lifecycleRoot,{...lifecycleRecord,state:"failed",membership_complete:false}); }
    catch(metadataError) { error.message+=`; lifecycle update failed: ${metadataError.message}`; }
    throw error;
  }
}
module.exports={packageRelease,verifySigning,isMachO};
if (require.main===module) { try { console.log(JSON.stringify(packageRelease(shared.args(process.argv.slice(2))))); } catch(error) { console.error(error.message); process.exitCode=1; } }
