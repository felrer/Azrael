"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const test = require("node:test");
const ts = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const { PETS_CLEANUP_ASSETS, MARKER, injectPetsCleanup } = require("./inject-pets-cleanup.cjs");
const { transformAsset } = require("./namespace-azrael-host.cjs");
const upstream = path.resolve(__dirname, "../artifacts/upstream-ui/26.928.31416");
const MAIN = PETS_CLEANUP_ASSETS[0];
function parse(source, name) {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(file.parseDiagnostics.length, 0, name);
  return file;
}
function exportsOf(file) {
  return file.statements.filter(ts.isExportDeclaration).flatMap(n => n.exportClause?.elements?.map(e => e.name.text) ?? []).sort();
}
test("Pets retirement in actual generated bundles and shared import contracts", async () => {
  const generated = new Map(), originals = new Map(), parsed = new Map();
  for (const asset of PETS_CLEANUP_ASSETS) {
    const filename = path.join(upstream, asset), source = fs.readFileSync(filename, "utf8");
    originals.set(asset, source);
    const result = transformAsset(source, asset, filename, ts);
    assert.equal(result.asset.petsCleanupEdits, 1, asset);
    assert.ok(result.text.startsWith(MARKER));
    assert.deepEqual(injectPetsCleanup(result.text, asset, ts), { text: result.text, count: 0 });
    const file = parse(result.text, asset);
    assert.deepEqual(exportsOf(file), exportsOf(parse(source, asset)), `${asset} preserves imported export names`);
    generated.set(asset, result.text); parsed.set(asset, file);
    console.log(`PASS ${asset}: petsCleanupEdits=1; JS parsed; exports preserved; idempotent; bytes=${Buffer.byteLength(result.text)}`);
  }
  const main = generated.get(MAIN), mainFile = parsed.get(MAIN);
  const functions = new Map(mainFile.statements.filter(ts.isFunctionDeclaration).map(n => [n.name.text, n.getText(mainFile)]));
  for (const name of ["XEa","QEa","a2r","s2r","c2r","u2r","d2r","f2r","p2r","P2r","F2r","L2r","R2r","z2r"]) assert.equal(functions.has(name), false, name);
  for (const needle of ["vm.customAvatars", "migrated-cloud-pet-ids-v1", "cloud-pet-artwork-cache", "last-observed-cloud-pet-selection-v1", "`/pets`", "accessory_id"]) assert.equal(main.includes(needle), false, needle);
  assert.ok(functions.get("bDa").includes("o=xDa(e,n),s=cDa(e,t,n,r),l=_Da(e,t,n,r)"));
  assert.ok(functions.get("bDa").includes("methods:[`skills/changed`"));
  assert.equal(functions.get("qxi").includes("jsx)(Gxi"), false);
  assert.equal(functions.get("Kxi"), "function Kxi(){Gxi=()=>null;}");
  const host = generated.get("out/extension.js");
  for (const needle of ["customAvatars", "var rF=class", "function PFe", "function kFe", "function EFe", "function a5(", "function eUt(", "function IFe(", "function tUt(", "function rUt(", "function nUt(", "function oUt(", "Jqt=c.object(", "MFe();"]) assert.equal(host.includes(needle), false, needle);
  for (const asset of PETS_CLEANUP_ASSETS.slice(5)) assert.equal(parsed.get(asset).statements.some(ts.isImportDeclaration), false, `${asset} has no feature imports`);
  const settings = generated.get(PETS_CLEANUP_ASSETS[1]), nav = generated.get(PETS_CLEANUP_ASSETS[2]), visible = generated.get(PETS_CLEANUP_ASSETS[3]);
  assert.equal(settings.includes("pets:_R"), false);
  assert.equal(settings.includes("chatGptPets:"), false);
  assert.equal(settings.includes("settings.nav.miniAndPets"), false);
  assert.equal(nav.includes("personalization.pets.usage"), false);
  assert.equal(nav.includes("`personalization`,`pets`,`keyboard-shortcuts`"), false);
  assert.equal(visible.includes("pets:{component:Zi"), false);
  // Evaluate the real normalized inventory and direct actions from the generated bundle.
  const context = vm.createContext({ Wyn: e => e, Gyn: ({logoUrl}) => logoUrl, Yvn: () => null, $vn: () => [], tyn: x => x });
  vm.runInContext(["Dk","Uyn","Qvn"].map(n => functions.get(n)).join("\n") + ";this.normalize=Uyn;this.actions=Qvn", context);
  const pets = [{id:"connector_openai_chatgpt_pets"},{id:"asdk_app_openai_chatgpt_pets"}];
  const other = [{id:"connector_calendar",name:"Pets"},{id:"connector_drive",name:"Drive"}];
  const inventory = [...other, ...pets];
  assert.deepEqual(Array.from(context.normalize({apps:inventory,connectorLogoSrcByCacheKey:{}})), other);
  assert.equal(context.normalize({apps:other,connectorLogoSrcByCacheKey:{}}), other, "unchanged connector inventory preserves identity");
  const actions = [{name:"create_pet",is_enabled:true},{name:"ordinary",is_enabled:true}];
  for (const app of pets) assert.equal(context.actions({actions,appId:app.id}).length, 0);
  assert.deepEqual(Array.from(context.actions({actions,appId:"connector_calendar"}), a => a.name), ["create_pet","ordinary"]);
  assert.deepEqual(Array.from(context.actions({actions,appId:null}), a => a.name), ["create_pet","ordinary"]);
  console.log("PASS actual app normalization and action bypass: both canonical IDs denied; unrelated connectors/display names/actions preserved");
  // Execute shared neutral adapters with atom constructors, proving no RPC,
  // persistence or subscriptions are required by these exported initializers.
  const definitions = [], queries = [], atom = (_scope, value, options) => {
    assert.equal(options, undefined); definitions.push(value); return value;
  };
  const adapterContext = vm.createContext({ e: factory => factory, q(){}, rp(){}, lp(){}, K_(){}, $:{}, Gf:atom,
    Fd:(_scope, define) => { const spec=define(); queries.push(spec); return spec; },
    sf:(_scope, define) => { const spec=define("custom:test"); queries.push(spec); return spec; },
    ff:(_scope, define) => { const spec=define("pet_test"); definitions.push(spec); return spec; }
  });
  vm.runInContext("var y2r,x2r,w2r,T2r,M2r,G2r,t2r;" + ["S2r","E2r","N2r","K2r","n2r","o2r","l2r","I2r"].map(n=>functions.get(n)).join("\n") + ";S2r();E2r();N2r();K2r();n2r();this.catalog=l2r(null,null)", adapterContext);
  queries.push(adapterContext.catalog);
  for (const query of queries) { assert.equal(query.enabled, false); await query.queryFn(); }
  assert.ok(definitions.some(value=>value?.pet===null));
  console.log("PASS neutral shared exports execute without custom-avatar RPC, persistence, subscriptions, selection mutation or cloud queries");
  assert.throws(()=>injectPetsCleanup(originals.get(MAIN).replace("let n=!1,r=e.map(e=>", "let n=!1,r=e.slice().map(e=>"), MAIN, ts), /anchor changed/);
  assert.throws(()=>injectPetsCleanup(main.replace("function I2r(e,t,n){}", "function I2r(e,t,n){throw Error('restored')}"), MAIN, ts), /Invalid retired/);
  assert.throws(()=>injectPetsCleanup(generated.get(PETS_CLEANUP_ASSETS[5])+";", PETS_CLEANUP_ASSETS[5], ts), /Invalid retired/);
  assert.deepEqual(injectPetsCleanup("untouched", "unrelated.js", ts), {text:"untouched",count:0});
  console.log("PASS fail-closed drift/tampering and unrelated asset identity");
});
