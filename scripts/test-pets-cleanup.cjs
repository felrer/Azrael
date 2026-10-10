"use strict";
const assert = require("node:assert/strict"), ms = require("node:fs"), path = require("node:path"), Sm = require("node:vm");
const test = require("node:test");
const vp = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const { PETS_CLEANUP_ASSETS, MARKER, injectPetsCleanup } = require("./inject-pets-cleanup.cjs");
const { transformAsset } = require("./namespace-azrael-host.cjs");
const upstream = path.resolve(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434"));
const MAIN = PETS_CLEANUP_ASSETS[0];
function parse(source, name) {
  const file = vp.createSourceFile(name, source, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS);
  assert.equal(file.parseDiagnostics.length, 0, name);
  return file;
}
function exportsOf(file) {
  return file.statements.filter(vp.isExportDeclaration).flatMap(n => n.exportClause?.elements?.map(e => e.name.text) ?? []).sort();
}
test("host Pets retirement supports the ordinary runtime process wrapper", () => {
  const asset = "out/extension.js", source = ms.readFileSync(path.join(upstream, asset), "utf8");
  const prefix = "(function(process){\n", suffix = "\n}).call(this, require('./azrael-runtime.cjs').process);\n";
  const wrapped = prefix + source + suffix;
  const result = transformAsset(wrapped, asset, path.join(upstream, asset), vp);
  assert.equal(result.asset.petsCleanupEdits, 1);
  assert.equal(result.text.split(prefix).length - 1, 1);
  assert.equal(result.text.split(suffix).length - 1, 1);
  for (const retired of ["async function lLe(", "function cLe(", "function aLe(", "BUt=c.object(", "customAvatars"]) assert.equal(result.text.includes(retired), false, retired);
  parse(result.text, asset);
  assert.deepEqual(injectPetsCleanup(result.text, asset, vp), { text: result.text, count: 0 });
  assert.throws(() => injectPetsCleanup(wrapped + wrapped, asset, vp), /Duplicate ordinary host/);
  assert.throws(() => injectPetsCleanup(wrapped.replace(".process);", ".unknown);"), asset, vp), /Invalid ordinary host process wrapper/);
});
test("Pets retirement in actual generated bundles and shared import contracts", async () => {
  const generated = new Map(), originals = new Map(), parsed = new Map();
  for (const asset of PETS_CLEANUP_ASSETS) {
    const filename = path.join(upstream, asset), source = ms.readFileSync(filename, "utf8");
    originals.set(asset, source);
    const result = transformAsset(source, asset, filename, vp);
    assert.equal(result.asset.petsCleanupEdits, 1, asset);
    assert.equal(result.text.split(MARKER).length - 1, 1);
    assert.deepEqual(injectPetsCleanup(result.text, asset, vp), { text: result.text, count: 0 });
    const file = parse(result.text, asset);
    const expectedExports = exportsOf(parse(source, asset));
    if (asset === "webview/assets/app-initial-c014f9ee4429.js") expectedExports.push("azraelDesignStore", "useAzraelDesignState", "__azraelOpenBtwPanel");
    assert.deepEqual(exportsOf(file), expectedExports.sort(), `${asset} preserves imported export names and owned design and side-question exports`);
    generated.set(asset, result.text); parsed.set(asset, file);
    console.log(`PASS ${asset}: petsCleanupEdits=1; qS parsed; exports preserved; idempotent; bytes=${Buffer.byteLength(result.text)}`);
  }
  const main = generated.get(MAIN), mainFile = parsed.get(MAIN);
  const functions = new Map(mainFile.statements.filter(vp.isFunctionDeclaration).map(n => [n.name.text, n.getText(mainFile)]));
  for (const name of ["BZa","HZa","Rpi","Bpi","Vpi","Upi","Wpi","Gpi","Kpi","pmi","mmi","gmi","_mi","vmi"]) assert.equal(functions.has(name), false, name);
  for (const needle of ["vm.customAvatars", "migrated-cloud-pet-ids-v1", "cloud-pet-artwork-cache", "last-observed-cloud-pet-selection-v1", "`/pets`", "accessory_id"]) assert.equal(main.includes(needle), false, needle);
  assert.ok(functions.get("uQa").includes("s=dQa(e,n),c=QZa(e,t,n,r)"));
  assert.ok(functions.get("uQa").includes("methods:[`skills/changed`"));
  assert.equal(functions.get("mRi").includes("jsx)(fRi"), false);
  assert.equal(functions.get("pRi"), "function pRi(){fRi=()=>null;}");
  const host = generated.get("out/extension.js");
  for (const needle of ["customAvatars", "var mF=class", "function lLe", "function cLe", "function aLe", "function k5(", "function qUt(", "function uLe(", "function UUt(", "function $Ut(", "function WUt(", "function HUt(", "BUt=c.object(", "dLe();"]) assert.equal(host.includes(needle), false, needle);
  for (const asset of PETS_CLEANUP_ASSETS.slice(5)) assert.equal(parsed.get(asset).statements.some(vp.isImportDeclaration), false, `${asset} has to feature imports`);
  const settings = generated.get(PETS_CLEANUP_ASSETS[1]), nav = generated.get(PETS_CLEANUP_ASSETS[2]), visible = generated.get(PETS_CLEANUP_ASSETS[3]);
  assert.equal(settings.includes("pets:lB"), false);
  assert.equal(settings.includes("chatGptPets:"), false);
  assert.equal(settings.includes("settings.nav.miniAndPets"), false);
  assert.equal(nav.includes("personalization.pets.usage"), false);
  assert.equal(nav.includes("`personalization`,`pets`,`keyboard-shortcuts`"), false);
  assert.equal(visible.includes("pets:{component:Ji"), false);
  // Evaluate the real normalized inventory and direct actions from the generated bundle.
  const context = Sm.createContext({ rAn: e => e, iAn: ({logoUrl}) => logoUrl, ikn: () => null, ckn: () => [], ukn: x => x });
  Sm.runInContext(["fk","nAn","skn"].map(n => functions.get(n)).join("\n") + ";this.normalize=nAn;this.actions=skn", context);
  const pets = [{id:"connector_openai_chatgpt_pets"},{id:"asdk_app_openai_chatgpt_pets"}];
  const other = [{id:"connector_calendar",name:"Pets"},{id:"connector_drive",name:"Drive"}];
  const inventory = [...other, ...pets];
  assert.deepEqual(Array.from(context.normalize({apps:inventory,connectorLogoSrcByCacheKey:{}})), other);
  assert.equal(context.normalize({apps:other,connectorLogoSrcByCacheKey:{}}), other, "unchanged connector inventory preserves identity");
  const actions = [{name:"create_pet",is_enabled:true},{name:"ordinary",is_enabled:true}];
  for (const app of pets) assert.equal(context.actions({actions,appId:app.id}).length, 0);
  assert.deepEqual(Array.from(context.actions({actions,appId:"connector_calendar"}), o => o.name), ["create_pet","ordinary"]);
  assert.deepEqual(Array.from(context.actions({actions,appId:null}), o => o.name), ["create_pet","ordinary"]);
  console.log("PASS actual app normalization and action bypass: both canonical IDs denied; unrelated connectors/display names/actions preserved");
  // Execute shared neutral adapters with atom constructors, proving no RPC,
  // persistence or subscriptions are required by these exported initializers.
  const definitions = [], queries = [], atom = (_scope, value, options) => {
    assert.equal(options, undefined); definitions.push(value); return value;
  };
  const adapterContext = Sm.createContext({ e: factory => factory, Z(){}, Rh(){}, q_(){}, R_(){}, $:{}, Vd:atom,
    Pl:(_scope, define) => { const spec=define(); queries.push(spec); return spec; },
    Uc:(_scope, define) => { const spec=define("custom:test"); queries.push(spec); return spec; },
    _c:(_scope, define) => { const spec=define("pet_test"); definitions.push(spec); return spec; }
  });
  Sm.runInContext("var Qpi,emi,rmi,imi,dmi,wmi,Ppi;" + ["tmi","ami","fmi","Tmi","Fpi","zpi","Hpi","hmi"].map(n=>functions.get(n)).join("\n") + ";tmi();ami();fmi();Tmi();Fpi();this.catalog=Hpi(null,null)", adapterContext);
  queries.push(adapterContext.catalog);
  for (const query of queries) { assert.equal(query.enabled, false); await query.queryFn(); }
  assert.ok(definitions.some(value=>value?.pet===null));
  console.log("PASS neutral shared exports execute without custom-avatar RPC, persistence, subscriptions, selection mutation or cloud queries");
  assert.throws(()=>injectPetsCleanup(originals.get(MAIN).replace("let n=!1,r=e.map(e=>", "let n=!1,r=e.slice().map(e=>"), MAIN, vp), /anchor changed/);
  assert.throws(()=>injectPetsCleanup(main.replace("function hmi(e,t,n){}", "function hmi(e,t,n){throw Error('restored')}"), MAIN, vp), /Invalid retired/);
  assert.throws(()=>injectPetsCleanup(generated.get(PETS_CLEANUP_ASSETS[5])+";", PETS_CLEANUP_ASSETS[5], vp), /Invalid retired/);
  assert.deepEqual(injectPetsCleanup("untouched", "unrelated.js", vp), {text:"untouched",count:0});
  console.log("PASS fail-closed drift/tampering and unrelated asset identity");
});

test("Pets retirement preserves the ordinary host process wrapper and rejects wrapper drift", () => {
  const asset = "out/extension.js", original = ms.readFileSync(path.join(upstream, asset), "utf8");
  const prefix = 'if(require("vscode").env.remoteName || require("vscode").workspace.getConfiguration("chatgpt").get("runCodexInWindowsSubsystemForLinux")) throw new Error("This azrael relepoe requires local Windows VS Code. Disable Codex WSL execution for this window or use the official extension in the remote host.");\n(function(process){\n';
  const suffix = "\n}).call(this, require('./azrael-runtime.cjs').process);\n";
  const wrapped = prefix + original + suffix, retired = injectPetsCleanup(wrapped, asset, vp);
  const pristine = injectPetsCleanup(original, asset, vp);
  assert.equal(retired.count, 1);
  assert.equal(retired.text.split(MARKER).length, 2);
  assert.equal(retired.text, MARKER + prefix + pristine.text.slice(MARKER.length) + suffix,
    "wrapper and every unrelated host byte are preserved");
  assert.deepEqual(injectPetsCleanup(retired.text, asset, vp), { text: retired.text, count: 0 });
  const file = parse(retired.text, asset);
  const wrapper = file.statements.find(n => vp.isExpressionStatement(n) && vp.isCallExpression(n.expression));
  const body = wrapper.expression.expression.expression.expression.body;
  for (const name of ["lLe","cLe","aLe","k5","qUt","uLe","UUt","$Ut","WUt","HUt"]) {
    assert.equal(body.statements.some(n => vp.isFunctionDeclaration(n) && n.name?.text === name), false, name);
  }
  assert.equal(body.statements.some(n => vp.isVariableStatement(n) &&
    n.declarationList.declarations.some(u => u.name.text === "dLe")), false);
  // Execute the preserved wrapper shell without invoking the full extension startup.
  const proxy = { env: { sentinel: "scoped" } }, ambient = { env: { sentinel: "ambient" } };
  const context = Sm.createContext({ process: ambient, require: name => {
    if (name === "vscode") return { env: {}, workspace: { getConfiguration: () => ({ get: () => false }) } };
    assert.equal(name, "./azrael-runtime.cjs"); return { process: proxy };
  } });
  Sm.runInContext(retired.text.slice(0, body.getStart(file) + 1) +
    "this.observedProcess=process;" + retired.text.slice(body.end - 1), context);
  assert.equal(context.observedProcess, proxy);
  assert.equal(context.process, ambient);
  for (const source of [
    wrapped.replace("(function(process)", "(function(other)"),
    wrapped.replace("./azrael-runtime.cjs", "./unexpected-runtime.cjs"),
    wrapped.replace("}).call(this,", "}).call(null,"),
    wrapped.replace("}).call(this,", "}).apply(this,"),
    wrapped + "(function(process){}).call(this, require('./azrael-runtime.cjs').process);",
    prefix + wrapped + suffix,
    retired.text.replace("./azrael-runtime.cjs", "./unexpected-runtime.cjs"),
  ]) assert.throws(() => injectPetsCleanup(source, asset, vp), /(?:Invalid|Duplicate) ordinary host process wrapper/);
  assert.throws(() => injectPetsCleanup(wrapped.replace('n.join(r,"pets")', 'n.join(r,"changed")'), asset, vp),
    /Pinned Pets helper changed: lLe/);
  assert.throws(() => injectPetsCleanup(retired.text + MARKER, asset, vp), /Duplicate Pets cleanup marker/);
});
