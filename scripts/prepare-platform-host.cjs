"use strict";
const fs=require("node:fs"), path=require("node:path"), os=require("node:os");
const shared=require("./install-platform-release.cjs"), platform=require("./platform-runtime.cjs");
function single(text,needle,replacement) {
  if (!needle || text.split(needle).length!==2) throw new Error("Pinned preparation anchor changed or is ambiguous.");
  return text.replace(needle,replacement);
}
function psLiteral(source,name) {
  const matches=[...source.matchAll(new RegExp("\\$"+name+" = '([^']*)'","g"))];
  if (matches.length!==1) throw new Error(`Pinned preparation constant changed: ${name}`);
  return matches[0][1];
}
function brandHost(root) {
  // The PowerShell owner remains authoritative for pristine hashes and exact
  // product replacement strings. Parse its bounded literal contract; fail closed
  // if it changes rather than maintaining a second set of product rules.
  const source=fs.readFileSync(path.join(__dirname,"prepare-official-ui.ps1"),"utf8");
  const version=psLiteral(source,"expectedVersion"), packageHash=psLiteral(source,"expectedPackageHash"), script=psLiteral(source,"expectedScriptRelativePath"), scriptHash=psLiteral(source,"expectedScriptHash"), menu=psLiteral(source,"menuScriptRelativePath"), menuHash=psLiteral(source,"menuSourceHash"), hostHash=psLiteral(source,"sourceHash");
  for (const [file,hash] of [["package.json",packageHash],[script,scriptHash],[menu,menuHash],["out/extension.js",hostHash]]) shared.verifyHash(root,file,hash);
  const manifest=shared.json(path.join(root,"package.json"));
  if (manifest.publisher!=="openai" || manifest.name!=="chatgpt" || manifest.version!==version) throw new Error("Pinned UI identity mismatch.");
  const c=manifest.contributes;
  for (const slot of [c.viewsContainers.activitybar[0],c.viewsContainers.secondarySidebar[0],c.views.codexViewContainer[0],c.views.codexSecondaryViewContainer[0]]) {
    const key=Object.hasOwn(slot,"title") ? "title" : "name"; if(slot[key]!=="Codex") throw new Error("Pinned branding slot changed."); slot[key]="Azrael";
  }
  fs.writeFileSync(path.join(root,"package.json"),shared.encode(manifest));
  // Read the replacement operands from the owner, not hard-coded copies.
  const branding=/\$needle = '([^']+)'[\s\S]*?\$scriptText\.Replace\(\$needle, '([^']+)'\)/.exec(source);
  if (!branding) throw new Error("Pinned branding contract changed.");
  fs.writeFileSync(path.join(root,script),single(fs.readFileSync(path.join(root,script),"utf8"),branding[1],branding[2]));
  let menuText=fs.readFileSync(path.join(root,menu),"utf8");
  const importToken=psLiteral(source,"componentImport"); if(menuText.split(importToken).length!==2) throw new Error("Pinned menu import changed.");
  menuText=single(menuText,psLiteral(source,"original"),psLiteral(source,"replacement")); fs.writeFileSync(path.join(root,menu),menuText);
  const startup=source.slice(source.indexOf("$replacements = @("),source.indexOf("$text = [IO.File]::ReadAllText($asset)"));
  const replacements=[...startup.matchAll(/@\('([^']*)', '([^']*)'\)/g)]; if (replacements.length!==2) throw new Error("Pinned startup contract changed.");
  let host=fs.readFileSync(path.join(root,"out/extension.js"),"utf8"); for(const replacement of replacements) host=single(host,replacement[1],replacement[2]);
  const resolverOwner=fs.readFileSync(path.join(__dirname,"prepare-ordinary-vscode.ps1"),"utf8");
  const anchorSection=resolverOwner.slice(resolverOwner.indexOf("$anchors = @("),resolverOwner.indexOf("$matchingAnchors ="));
  const anchors=[...anchorSection.matchAll(/'([^']+)'/g)].map(match=>match[1]).filter(anchor=>host.includes(anchor));
  if (anchors.length!==1) throw new Error("Pinned engine resolver changed.");
  host=single(host,anchors[0],anchors[0].replace("let r=",'return require("./azrael-runtime.cjs").runtime.engine;let r='));
  const guard='if(require("vscode").env.remoteName)throw new Error("Azrael requires a local VS Code extension host.");';
  fs.writeFileSync(path.join(root,"out/extension.js"),guard+"\n(function(process){\n"+host+"\n}).call(this, require('./azrael-runtime.cjs').process);\n");
  fs.writeFileSync(path.join(root,".azrael-official-ui.json"),shared.encode({schema:1,sourceVersion:version,sourcePackageSha256:packageHash,sourceWebviewSha256:scriptHash,brandedPackageSha256:shared.sha(fs.readFileSync(path.join(root,"package.json"))),brandedWebviewSha256:shared.sha(fs.readFileSync(path.join(root,script)))}));
}
function snapshot(root) { return new Map(shared.walk(root,"",name=>/(^|\/)node_modules\/\.bin(?:\/|$)/.test(name)).map(name=>[name,shared.sha(fs.readFileSync(shared.fileAt(root,name)))])); }
function stable(root,expected) { const actual=snapshot(root); if(actual.size!==expected.size || [...expected].some(([name,hash])=>actual.get(name)!==hash)) throw new Error("Preparation source changed."); }
function normalizeCompanionModes(root,selected) {
  const tools=[];
  if(selected.os==="darwin") {
    // The locked node-pty package ships spawn-helper without executable mode
    // when dependency lifecycle scripts are intentionally disabled.
    for(const relative of [`node_modules/node-pty/prebuilds/${selected.vsixTarget}/spawn-helper`,"node_modules/node-pty/build/Release/spawn-helper"]) {
      const file=path.join(root,relative); if(!fs.existsSync(file)) continue;
      shared.inspectPath(file); if(!fs.statSync(file).isFile()) throw new Error("Companion native helper must be a regular file.");
      const sourceMode=fs.statSync(file).mode&0o777;
      fs.chmodSync(file,0o755); tools.push({path:`account-ui/${relative}`,sha256:shared.sha(fs.readFileSync(file)),sourceMode,mode:0o755});
    }
  }
  return tools;
}
async function prepare(options) {
  const release=shared.inspectPath(shared.absolute(options.release)), ui=shared.inspectPath(shared.absolute(options["ui-root"])), account=shared.inspectPath(shared.absolute(options["account-ui-root"])), output=shared.inspectPath(shared.absolute(options.output));
  for (const input of [ui,account]) shared.disjoint(input,output);
  if(shared.within(output,release)) throw new Error("Output cannot contain the release input.");
  if(fs.existsSync(output)) throw new Error("Output must be a new directory.");
  shared.version(options["host-version"]);
  const {build,selected}=shared.verifyBuild(release), uiSnapshot=snapshot(ui), accountSnapshot=snapshot(account);
  const toolDirectory={win32:"windows-x86_64",linux:"linux-x86_64",darwin:"macos-aarch64"}[selected.os];
  const rgInput=options.rg ? shared.inspectPath(shared.absolute(options.rg)) : shared.fileAt(ui,`bin/${toolDirectory}/${platform.executableName("rg",selected)}`);
  const rgBytes=fs.readFileSync(rgInput), rgSha256=shared.sha(rgBytes);
  if(selected.os!=="win32" && !(fs.statSync(rgInput).mode&0o111)) throw new Error("Target ripgrep requires executable mode.");
  const accountManifest=shared.json(shared.fileAt(account,"package.json"));
  if(accountManifest.main!=="./dist/src/extension.js" || !/^0\.(?:[3-9]|\d{2,})\./.test(accountManifest.version)) throw new Error("Integrated account UI 0.3.0 or newer required.");
  const typescript=require.resolve("typescript/lib/typescript.js",{paths:[account,path.join(__dirname,"../extensions/azrael-ex")]}), vsce=require.resolve("@vscode/vsce/vsce",{paths:[account,path.join(__dirname,"../extensions/azrael-ex")]});
  const root=path.join(output,"host"); fs.mkdirSync(output,{recursive:true}); fs.cpSync(ui,root,{recursive:true,dereference:false}); brandHost(root);
  const rgTarget=path.join(root,"bin",toolDirectory,platform.executableName("rg",selected)); fs.mkdirSync(path.dirname(rgTarget),{recursive:true}); fs.writeFileSync(rgTarget,rgBytes); if(selected.os!=="win32") fs.chmodSync(rgTarget,0o755);
  fs.cpSync(account,path.join(root,"account-ui"),{recursive:true,dereference:false,filter:file=>!path.relative(account,file).split(path.sep).some(part=>part===".git" || part===".env" || part===".bin")});
  const companionNativeTools=normalizeCompanionModes(path.join(root,"account-ui"),selected);
  const modules=["session-links.cjs","azrael-recovery.cjs","recovery-state.cjs","url-safety-transport.cjs","pdf-file-open.cjs","computer-use-approvals.cjs","use-control-settings.cjs","devin-native-host.cjs","provider-accounts-host.cjs","platform-runtime.cjs","azrael-platforms.json"];
  for (const name of modules) fs.copyFileSync(path.join(__dirname,name),path.join(root,"out",name));
  fs.copyFileSync(path.join(__dirname,"ordinary-runtime.cjs"),path.join(root,"out/azrael-runtime.cjs")); fs.copyFileSync(path.join(__dirname,"integrated-azrael-entry.cjs"),path.join(root,"integrated-azrael-entry.cjs"));
  const accountModules=["sync-shared-environment.cjs","sync-codex-environment.cjs","instruction-package.cjs","computer-use-runtime.cjs","computer-use-branding.cjs","window-control-runtime.cjs","use-control-settings.cjs","window-use-approvals.cjs","computer-use-approvals.cjs","use-settings-host.cjs","sky-control-policy.mjs","sky-controlled-service.mjs","inject-sky-control-policy.cjs","platform-runtime.cjs","azrael-platforms.json"];
  for (const name of accountModules) fs.copyFileSync(path.join(__dirname,name),path.join(root,"account-ui",name));
  const config={schema:1,platform:platform.platformIdentity(selected),engine:path.join(release,"engine",platform.executableName("codex",selected)),bridge:path.join(release,"engine",platform.executableName("azrael-bridge",selected)),engineVersion:build.engineVersion,codexHome:path.join(os.homedir(),".azrael-ex"),originalExtension:ui};
  config.devinNative=require("./devin-native-host.cjs").readBundle(release); config.providerAccounts=require("./provider-accounts-host.cjs").readBundle(release);
  if(selected.desktopControl) {
    for(const [owner,reader] of [["computerUse","computer-use-runtime.cjs"],["windowControl","window-control-runtime.cjs"]]) {
      const directory=path.join(release,owner==="computerUse" ? "computer-use" : "window-control");
      if(fs.existsSync(directory)) { const result=require("./"+reader).verifyRuntime(directory); config[owner]={directory,manifestSha256:result.manifestSha256}; fs.cpSync(directory,path.join(root,path.basename(directory)),{recursive:true}); }
    }
  }
  for (const name of Object.keys(build.sha256).filter(name=>name.startsWith("host/") && /\.(?:cjs|mjs|json)$/.test(name))) {
    const target=path.join(root,"out",name.replace(/^host\/(?:out\/)?/,"")); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.copyFileSync(shared.fileAt(release,name),target);
  }
  if(fs.existsSync(path.join(release,"host/out/azrael-runtime.json"))) {
    const produced=shared.json(shared.fileAt(release,"host/out/azrael-runtime.json")); platform.validateRuntimePlatform(produced.platform);
    if(produced.engine!==config.engine || produced.bridge!==config.bridge) throw new Error("Producer runtime selects another release.");
    Object.assign(config,produced); if(selected.os!=="win32") {delete config.computerUse;delete config.windowControl;}
  }
  fs.writeFileSync(path.join(root,"out/azrael-runtime.json"),shared.encode(config));
  await require("./namespace-azrael-host.cjs").transformExtension(root,require(typescript),options["host-version"],{typescriptSha256:shared.sha(fs.readFileSync(typescript))});
  const vsix=path.join(output,"azrael-host.vsix"), previous=process.cwd();
  try { process.chdir(root); await require("./package-local-host.cjs").packageLocalHost(vsce,vsix,ui); } finally {process.chdir(previous);}
  const files=shared.readZip(fs.readFileSync(vsix)), xml=files.get("extension.vsixmanifest");
  if (!xml) throw new Error("Packaged VSIX identity missing.");
  let text=xml.data.toString("utf8"); const identity=/<Identity\b[^>]*\/>/.exec(text); if(!identity) throw new Error("Packaged VSIX identity changed.");
  const target=identity[0].replace(/\sTargetPlatform="[^"]*"/g,"").replace("/>",` TargetPlatform="${selected.vsixTarget}" />`); text=text.replace(identity[0],target); xml.data=Buffer.from(text); fs.writeFileSync(vsix,shared.writeZip(files));
  stable(ui,uiSnapshot); stable(account,accountSnapshot); shared.verifyBuild(release);
  if(shared.sha(fs.readFileSync(rgInput))!==rgSha256) throw new Error("Ripgrep source changed.");
  const result={schema:1,platform:config.platform,hostVersion:options["host-version"],hostVsix:vsix,hostSha256:shared.sha(fs.readFileSync(vsix)),release,sourceUi:ui,sourceAccountUi:account,companionNativeTools,ripgrep:{source:rgInput,sha256:rgSha256,target:`bin/${toolDirectory}/${platform.executableName("rg",selected)}`}}; fs.writeFileSync(path.join(output,"preparation.json"),shared.encode(result)); return result;
}
module.exports={prepare,brandHost,single,psLiteral,normalizeCompanionModes};
if(require.main===module) prepare(shared.args(process.argv.slice(2))).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
