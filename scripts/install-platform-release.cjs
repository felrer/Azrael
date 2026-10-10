"use strict";
// This file is also the shared packaging boundary. Recipients need only Node;
// no npm installation, Python, shell command construction or mutable staging.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");
const { isDeepStrictEqual } = require("node:util");
const platform = require("./platform-runtime.cjs");

const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const json = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
function args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (!/^--[a-z-]+$/.test(argv[i]) || Object.hasOwn(result, argv[i].slice(2))) throw new Error("Invalid or duplicate option.");
    const name = argv[i].slice(2);
    result[name] = name === "prepare-only" ? true : argv[++i];
    if (result[name] === undefined) throw new Error(`Missing --${name} value.`);
  }
  return result;
}
function absolute(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error("Paths must be absolute.");
  return path.resolve(value);
}
function relative(value) {
  if (typeof value !== "string" || !value || /[\\:\0]/.test(value) || value.split("/").some(p => !p || p === "." || p === "..")) throw new Error("Unsafe inventory path.");
  if (value.startsWith("/")) throw new Error("Absolute inventory path.");
  return value;
}
function inspectPath(file) {
  file = absolute(file);
  for (let current = file; ; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Symlinks/reparse points are forbidden.");
    if (path.dirname(current) === current) break;
  }
  return file;
}
function fileAt(root, name) {
  const file = inspectPath(path.join(absolute(root), relative(name)));
  if (!fs.statSync(file).isFile()) throw new Error(`Missing regular file: ${name}`);
  return file;
}
function within(a, b) { const r = path.relative(a, b); return !r || (!r.startsWith(`..${path.sep}`) && r !== ".." && !path.isAbsolute(r)); }
function disjoint(a, b) { if (within(a, b) || within(b, a)) throw new Error("Paths must not overlap."); }
function version(value) { if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(value || "")) throw new Error("Invalid release version."); return value; }
function walk(root, prefix = "", skip = () => false) {
  inspectPath(root);
  return fs.readdirSync(root, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = prefix + entry.name;
    relative(name);
    if (skip(name)) return [];
    if (entry.isSymbolicLink()) throw new Error("Runtime cannot contain symlinks.");
    return entry.isDirectory() ? walk(path.join(root, entry.name), name + "/", skip) : entry.isFile() ? [name] : (() => { throw new Error("Unsupported runtime entry."); })();
  });
}
function verifyHash(root, name, expected) {
  if (!/^[a-f\d]{64}$/i.test(expected || "") || sha(fs.readFileSync(fileAt(root, name))) !== expected.toLowerCase()) throw new Error(`Hash mismatch: ${name}`);
}
function verifyBuild(release) {
  const build = json(fileAt(release, "build-info.json"));
  const selected = platform.validateRuntimePlatform(build.platform);
  if (!build.sha256 || !Object.keys(build.sha256).length) throw new Error("Missing build hashes.");
  for (const [name, hash] of Object.entries(build.sha256)) verifyHash(release, name, hash);
  const provenance = build.engineProvenance;
  if (!/^[a-f\d]{64}$/i.test(provenance?.source?.sourceSha256 || "")) throw new Error("Missing engine source fingerprint.");
  const receipt = json(fileAt(release, "engine/azrael-engine-build.json"));
  if (!isDeepStrictEqual(receipt, provenance)) throw new Error("Engine receipt differs from build provenance.");
  if (receipt.platform) platform.validateRuntimePlatform(receipt.platform);
  for (const name of platform.engineBinaryNames(selected)) {
    verifyHash(release, "engine/" + name, provenance.binaries?.[name]);
    if (selected.os !== "win32" && !(fs.statSync(fileAt(release, "engine/" + name)).mode & 0o111)) throw new Error("Engine executable mode missing.");
  }
  return { build, selected };
}

// ZIP32 VSIX codec: reject ambiguous paths, symlinks, encrypted/unsupported
// entries, mismatched local headers and CRCs before rewriting any content.
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function readZip(buffer) {
  let end = -1;
  for (let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--) if (buffer.readUInt32LE(i) === 0x06054b50 && i+22+buffer.readUInt16LE(i+20) === buffer.length) { end=i; break; }
  if (end < 0 || buffer.readUInt16LE(end+4) || buffer.readUInt16LE(end+6) || buffer.readUInt16LE(end+8) !== buffer.readUInt16LE(end+10)) throw new Error("Invalid/multipart ZIP.");
  const count=buffer.readUInt16LE(end+10), offset=buffer.readUInt32LE(end+16);
  if (offset+buffer.readUInt32LE(end+12) !== end) throw new Error("Invalid ZIP directory.");
  const files = new Map(), seen = new Set(); let cursor=offset, total=0;
  for (let i=0;i<count;i++) {
    if (buffer.readUInt32LE(cursor)!==0x02014b50) throw new Error("Invalid ZIP entry.");
    const flags=buffer.readUInt16LE(cursor+8), method=buffer.readUInt16LE(cursor+10), crc=buffer.readUInt32LE(cursor+16), packed=buffer.readUInt32LE(cursor+20), size=buffer.readUInt32LE(cursor+24);
    const length=buffer.readUInt16LE(cursor+28), extra=buffer.readUInt16LE(cursor+30), comment=buffer.readUInt16LE(cursor+32), local=buffer.readUInt32LE(cursor+42), mode=buffer.readUInt32LE(cursor+38)>>>16;
    const raw=buffer.subarray(cursor+46,cursor+46+length), name=raw.toString("utf8"), directory=name.endsWith("/");
    relative(directory ? name.slice(0,-1) : name);
    if (seen.has(name.toLowerCase()) || flags&1 || ![0,8].includes(method) || (mode&0o170000)===0o120000 || size>512*1024*1024 || (total+=size)>2*1024*1024*1024) throw new Error("Unsafe ZIP entry.");
    seen.add(name.toLowerCase());
    if (local>=offset || buffer.readUInt32LE(local)!==0x04034b50 || buffer.readUInt16LE(local+8)!==method || buffer.readUInt16LE(local+6)!==flags) throw new Error("ZIP local header mismatch.");
    const localNameLength=buffer.readUInt16LE(local+26), start=local+30+localNameLength+buffer.readUInt16LE(local+28);
    if (!raw.equals(buffer.subarray(local+30,local+30+localNameLength)) || start+packed>offset) throw new Error("ZIP local path mismatch.");
    const compressed=buffer.subarray(start,start+packed), data=method===0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed,{maxOutputLength:Math.max(1,size)});
    if (data.length!==size || crc32(data)!==crc) throw new Error("ZIP checksum mismatch.");
    if (!directory) files.set(name,{data,mode:mode&0o777 || 0o644});
    cursor+=46+length+extra+comment;
  }
  if (cursor!==end) throw new Error("ZIP directory length mismatch.");
  return files;
}
function writeZip(files) {
  const chunks=[], central=[]; let offset=0;
  for (const [name,{data,mode=0o644}] of [...files].sort(([a],[b])=>a.localeCompare(b))) {
    relative(name); const filename=Buffer.from(name), compressed=zlib.deflateRawSync(data), crc=crc32(data);
    const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(0x800,6); local.writeUInt16LE(8,8); local.writeUInt32LE(crc,14); local.writeUInt32LE(compressed.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(filename.length,26);
    const header=Buffer.alloc(46); header.writeUInt32LE(0x02014b50); header.writeUInt16LE(0x314,4); header.writeUInt16LE(20,6); header.writeUInt16LE(0x800,8); header.writeUInt16LE(8,10); header.writeUInt32LE(crc,16); header.writeUInt32LE(compressed.length,20); header.writeUInt32LE(data.length,24); header.writeUInt16LE(filename.length,28); header.writeUInt32LE(((0o100000|mode)<<16)>>>0,38); header.writeUInt32LE(offset,42);
    chunks.push(local,filename,compressed); central.push(header,filename); offset+=local.length+filename.length+compressed.length;
  }
  if (files.size>=65535) throw new Error("ZIP64 is unsupported.");
  const directory=Buffer.concat(central), end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size,8); end.writeUInt16LE(files.size,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,directory,end]);
}
function verifyPackage(root, environment) {
  const manifest=json(fileAt(root,"release-manifest.json"));
  if (manifest.schema!==2 || !Array.isArray(manifest.files)) throw new Error("Unsupported release manifest.");
  version(manifest.version); platform.validateRuntimePlatform(manifest.platform, environment);
  const seen=new Set();
  for (const item of manifest.files) {
    relative(item.path);
    if (seen.has(item.path.toLowerCase()) || !Number.isSafeInteger(item.size) || item.size<0 || ![0o644,0o755].includes(item.mode)) throw new Error("Invalid inventory entry.");
    seen.add(item.path.toLowerCase()); verifyHash(root,item.path,item.sha256);
    const stat=fs.statSync(fileAt(root,item.path));
    if (stat.size!==item.size || (manifest.platform.os!=="win32" && process.platform!=="win32" && (stat.mode&0o777)!==item.mode)) throw new Error("Inventory size/mode mismatch.");
  }
  for (const name of walk(root)) if (name!=="release-manifest.json" && !seen.has(name.toLowerCase())) throw new Error("Uninventoried package file.");
  if (!seen.has("host-template.vsix") || !seen.has("runtime/build-info.json")) throw new Error("Incomplete release inventory.");
  const {build}=verifyBuild(path.join(root,"runtime"));
  if (manifest.provenance?.buildInfoSha256!==sha(fs.readFileSync(fileAt(root,"runtime/build-info.json"))) ||
      manifest.provenance?.hostTemplateSha256!==sha(fs.readFileSync(fileAt(root,"host-template.vsix"))) ||
      !isDeepStrictEqual(manifest.provenance?.engine,build.engineProvenance)) throw new Error("Release provenance mismatch.");
  if (JSON.stringify(platform.platformIdentity(platform.resolvePlatform(build.platform?.os,build.platform?.arch)))!==JSON.stringify(manifest.platform)) throw new Error("Runtime/package platform mismatch.");
  return manifest;
}
function relocateValue(value, previous, selected) {
  if (typeof value === "string" && path.isAbsolute(value) && within(previous,value)) return path.join(selected,path.relative(previous,value));
  if (Array.isArray(value)) return value.map(item=>relocateValue(item,previous,selected));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,relocateValue(item,previous,selected)]));
  return value;
}
function codeInvocation(command, vsix) {
  if (process.platform!=="win32") return {command,args:["--install-extension",vsix]};
  let selected=command;
  if(!path.isAbsolute(selected)) {
    for(const directory of (process.env.PATH || "").split(path.delimiter)) {
      const candidate=path.join(directory,selected.endsWith(".cmd") ? selected : selected+".cmd");
      if(fs.existsSync(candidate)) {selected=candidate;break;}
    }
  }
  if(/\.cmd$/i.test(selected)) {
    const root=path.dirname(path.dirname(selected)), executable=path.join(root,"Code.exe"), cli=path.join(root,"resources/app/out/cli.js");
    if(!fs.existsSync(executable) || !fs.existsSync(cli)) throw new Error("Cannot resolve VS Code executable and CLI from code.cmd. Supply --code with the selected VS Code executable.");
    return {command:executable,args:[cli,"--install-extension",vsix],env:{...process.env,ELECTRON_RUN_AS_NODE:"1"}};
  }
  return {command:selected,args:["--install-extension",vsix]};
}
function install(options) {
  const source=inspectPath(absolute(options.package)), manifest=verifyPackage(source);
  const releases=inspectPath(absolute(options["install-root"] || platform.defaultReleasesRoot()));
  const state=inspectPath(absolute(options["state-root"] || path.join(os.homedir(),".azrael-ex")));
  const ordinary=inspectPath(path.join(os.homedir(),".codex"));
  disjoint(state,ordinary); disjoint(releases,ordinary); disjoint(releases,state); disjoint(source,releases); disjoint(source,state);
  const destination=path.join(releases,`${manifest.version}-${platform.resolvePlatform().vsixTarget}`);
  inspectPath(destination);
  if (fs.existsSync(destination)) throw new Error("Selected installation already exists. Choose an explicit different version for side-by-side installation/rollback.");
  const files=readZip(fs.readFileSync(fileAt(source,"host-template.vsix")));
  const configEntry=files.get("extension/out/azrael-runtime.json");
  if (!configEntry) throw new Error("Host runtime configuration missing.");
  const config=JSON.parse(configEntry.data.toString("utf8")); platform.validateRuntimePlatform(config.platform);
  const oldRuntime=path.dirname(path.dirname(config.engine));
  const runtime=path.join(destination,"runtime"), relocated=relocateValue(config,oldRuntime,runtime);
  relocated.engine=path.join(runtime,"engine",platform.executableName("codex")); relocated.bridge=path.join(runtime,"engine",platform.executableName("azrael-bridge")); relocated.codexHome=state;
  configEntry.data=encode(relocated);
  const vsix=writeZip(files);
  const transformations=[];
  const devinName="runtime/devin-native-build.json", devinEntry=manifest.files.find(item=>item.path===devinName);
  let devinBytes;
  if (devinEntry) {
    const native=json(fileAt(source,devinName));
    if (!within(oldRuntime,native.node?.path || "")) throw new Error("Devin Node must be bundled inside the selected runtime.");
    const nodeRelative="runtime/"+path.relative(oldRuntime,native.node.path).split(path.sep).join("/");
    if (!manifest.files.some(item=>item.path===nodeRelative && item.sha256===native.node.sha256.toLowerCase())) throw new Error("Bundled Devin Node missing from inventory.");
    native.node.path=path.join(runtime,path.relative(oldRuntime,native.node.path)); devinBytes=encode(native);
    transformations.push({path:devinName,sourceSha256:devinEntry.sha256,installedSha256:sha(devinBytes)});
  }
  // All inputs and rewritten host are verified before creating any destination.
  fs.mkdirSync(destination,{recursive:true});
  for (const item of manifest.files.filter(item=>item.path.startsWith("runtime/"))) {
    const target=path.join(destination,item.path); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.copyFileSync(fileAt(source,item.path),target); fs.chmodSync(target,item.mode);
  }
  if (devinBytes) {
    fs.writeFileSync(path.join(runtime,"devin-native-build.json"),devinBytes);
    const installedBuild=json(path.join(runtime,"build-info.json")); installedBuild.sha256["devin-native-build.json"]=sha(devinBytes);
    const bytes=encode(installedBuild); fs.writeFileSync(path.join(runtime,"build-info.json"),bytes);
    transformations.push({path:"runtime/build-info.json",sourceSha256:manifest.files.find(item=>item.path==="runtime/build-info.json").sha256,installedSha256:sha(bytes)});
  }
  verifyBuild(runtime);
  const selectedVsix=path.join(destination,"azrael-host.vsix"); fs.writeFileSync(selectedVsix,vsix,{flag:"wx"});
  const receipt={schema:1,version:manifest.version,platform:manifest.platform,packageSha256:sha(fs.readFileSync(path.join(source,"release-manifest.json"))),runtime,stateRoot:state,hostVsix:selectedVsix,hostSha256:sha(vsix),transformations,preparedOnly:!!options["prepare-only"]};
  fs.writeFileSync(path.join(destination,"installation.json"),encode(receipt),{flag:"wx"});
  if (!options["prepare-only"]) {
    const invocation=codeInvocation(options.code || "code",selectedVsix);
    const result=spawnSync(invocation.command,invocation.args,{stdio:"inherit",shell:false,env:invocation.env});
    if (result.error || result.status!==0) throw new Error(`VS Code installation failed (${result.status ?? result.error?.code}). Prepared runtime retained for review.`);
    receipt.installed=true; fs.writeFileSync(path.join(destination,"installation.json"),encode(receipt));
  }
  return receipt;
}
module.exports={sha,json,encode,args,absolute,relative,inspectPath,fileAt,walk,verifyHash,verifyBuild,verifyPackage,version,within,disjoint,readZip,writeZip,relocateValue,codeInvocation,install};
if (require.main===module) { try { console.log(JSON.stringify(install(args(process.argv.slice(2))))); } catch(error) { console.error(error.message); process.exitCode=1; } }
