"use strict";
const fs=require("node:fs"), path=require("node:path"), {spawnSync}=require("node:child_process");
const shared=require("./install-platform-release.cjs"), platform=require("./platform-runtime.cjs");
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
  if (path.resolve(config.engine)!==path.join(release,"engine",platform.executableName("codex",selected))) throw new Error("Host template selects a different release.");
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
  files.set("INSTALL.txt",{data:Buffer.from(`Extract this archive into a new directory. Run: ${bootstrap} install-platform-release.cjs --package ABSOLUTE_EXTRACTED_DIRECTORY --prepare-only\n${bootstrapNote}\nOmit --prepare-only to install the prepared VSIX into VS Code. State remains in ~/.azrael-ex. Updates and rollback select an explicit side-by-side version. macOS public distribution remains deferred.\n`),mode:0o644});
  const inventory=[...files].map(([name,item])=>({path:name,sha256:shared.sha(item.data),size:item.data.length,mode:item.mode}));
  const manifest={schema:2,version,platform:platform.platformIdentity(selected),files:inventory,provenance:{buildInfoSha256:shared.sha(fs.readFileSync(path.join(release,"build-info.json"))),engine:build.engineProvenance,hostTemplateSha256:shared.sha(hostBytes)},distribution:selected.os==="darwin" ? "local-only-public-distribution-deferred" : "local-package"};
  // Recheck frozen inputs before writing a package, then verify the written copy.
  shared.verifyBuild(release);
  if (shared.sha(fs.readFileSync(host))!==shared.sha(hostBytes)) throw new Error("Host input changed during packaging.");
  fs.mkdirSync(output,{recursive:true});
  for (const [name,item] of files) { const target=path.join(output,name); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,item.data,{flag:"wx",mode:item.mode}); fs.chmodSync(target,item.mode); }
  fs.writeFileSync(path.join(output,"release-manifest.json"),shared.encode(manifest),{flag:"wx"});
  shared.verifyPackage(output);
  const archive=output+(selected.os==="win32" ? ".zip" : ".tar.gz");
  if (fs.existsSync(archive)) throw new Error("Archive destination already exists.");
  if (selected.os==="win32") { files.set("release-manifest.json",{data:shared.encode(manifest),mode:0o644}); fs.writeFileSync(archive,shared.writeZip(files),{flag:"wx"}); }
  else { const result=spawnSync("tar",["-czf",archive,"-C",output,"--",...shared.walk(output)],{encoding:"utf8",shell:false}); if (result.error || result.status!==0) throw new Error("Release archive creation failed."); }
  return {output,archive,platform:manifest.platform,version,files:inventory.length};
}
module.exports={packageRelease};
if (require.main===module) { try { console.log(JSON.stringify(packageRelease(shared.args(process.argv.slice(2))))); } catch(error) { console.error(error.message); process.exitCode=1; } }
