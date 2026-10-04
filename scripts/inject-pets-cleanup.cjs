"use strict";

// Pinned to public UI 26.928.31416. Run after the distribution's other transforms.
const MAIN = "webview/assets/app-initial-9cbfb5c07b41.js";
const SETTINGS = "webview/assets/app-initial-4bd9e54bcd58.js";
const NAV = "webview/assets/settings-page-94cbae2cfc9d.js";
const VISIBLE = "webview/assets/use-visible-settings-sections-e0e40d34ba3b.js";
const HOST = "out/extension.js";
const MARKER = "/*azrael-pets-retired-v1*/";
const EMPTY_MODULES = {
  "webview/assets/pets-settings-route-2cb7159605da.js": "function PetsSettingsRoute(){return null;}export{PetsSettingsRoute};",
  "webview/assets/pet-content-fbc121db2098.js": "function WorkModePetContent(){return null;}export{WorkModePetContent};",
  "webview/assets/avatar-overlay-native-page-41808b973a67.js": "function AvatarOverlayNativePage(){return null;}export{AvatarOverlayNativePage};",
  "webview/assets/use-avatar-options-4ff0addea007.js": "function f(){return{avatarDirectory:null,avatarOptions:[],isError:false,isFetching:false,isLoading:false};}function m(){}export{f as n,m as t};"
};
const PETS_CLEANUP_ASSETS = [MAIN, SETTINGS, NAV, VISIBLE, HOST, ...Object.keys(EMPTY_MODULES)];
function parse(text, ts) {
  const file = ts.createSourceFile("pinned-pets.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error("Pets cleanup asset failed JavaScript parsing.");
  return file;
}
function injectPetsCleanup(text, relativePath, ts) {
  if (!PETS_CLEANUP_ASSETS.includes(relativePath)) return { text, count: 0 };
  const file = parse(text, ts), marked = text.includes(MARKER), edits = [];
  if (marked && text.split(MARKER).length !== 2) throw new Error("Duplicate Pets cleanup marker.");
  if (EMPTY_MODULES[relativePath]) {
    const replacement = MARKER + EMPTY_MODULES[relativePath];
    if (marked) {
      if (text !== replacement) throw new Error("Invalid retired Pets module.");
      return { text, count: 0 };
    }
    const expected = {
      "webview/assets/pets-settings-route-2cb7159605da.js": "export{Ze as PetsSettingsRoute};",
      "webview/assets/pet-content-fbc121db2098.js": "export{J as WorkModePetContent};",
      "webview/assets/avatar-overlay-native-page-41808b973a67.js": "export{Sy as AvatarOverlayNativePage};",
      "webview/assets/use-avatar-options-4ff0addea007.js": "export{f as n,m as t};"
    }[relativePath];
    if (text.split(expected).length !== 2 || !text.includes("//# sourceMappingURL=" + relativePath.split("/").pop() + ".map")) throw new Error("Pinned Pets module exports changed.");
    parse(replacement, ts);
    return { text: replacement, count: 1 };
  }
  const functions = new Map(file.statements.filter(ts.isFunctionDeclaration).map(n => [n.name?.text, n]));
  function fn(name) {
    const node = functions.get(name);
    if (!node) throw new Error(`Missing pinned Pets function: ${name}`);
    return node;
  }
  function body(name, anchor, replacement) {
    const node = fn(name), source = node.body.getText(file);
    if (marked) {
      if (source !== replacement) throw new Error(`Invalid retired Pets function: ${name}`);
    } else {
      if (!source.includes(anchor)) throw new Error(`Pinned Pets function changed: ${name}`);
      edits.push({ start: node.body.getStart(file), end: node.body.end, replacement });
    }
  }
  function removeFn(name, anchor) {
    if (marked) {
      if (functions.has(name)) throw new Error(`Retired Pets function restored: ${name}`);
      return;
    }
    const node = fn(name);
    if (!node.getText(file).includes(anchor)) throw new Error(`Pinned Pets helper changed: ${name}`);
    edits.push({ start: node.getStart(file), end: node.end, replacement: "" });
  }
  function replace(anchor, replacement, owner = null) {
    const start = owner ? owner.getStart(file) : 0, end = owner ? owner.end : text.length;
    const source = text.slice(start, end);
    if (marked) {
      const oldCount = source.split(anchor).length - 1;
      if (oldCount !== (replacement.includes(anchor) ? 1 : 0) || (replacement && !source.includes(replacement))) throw new Error(`Invalid Pets replacement: ${anchor.slice(0, 70)}`);
      return;
    }
    if (source.split(anchor).length !== 2) throw new Error(`Pinned Pets anchor changed: ${anchor.slice(0, 70)}`);
    const pos = text.indexOf(anchor, start);
    edits.push({ start: pos, end: pos + anchor.length, replacement });
  }
  function removeProperties(names, signatures) {
    const found = new Set();
    function visit(node) {
      if (ts.isPropertyAssignment(node) && names.includes(node.name.text)) {
        const key = node.name.text, source = node.getText(file);
        const signature = signatures[key].find(s => source.includes(s));
        if (!signature) return;
        if (marked || found.has(signature)) throw new Error(`Retired or duplicate Pets property: ${key}`);
        found.add(signature);
        // All pinned properties have a following sibling; consume their comma.
        const next = text.slice(node.end).match(/^\s*,/);
        if (!next) throw new Error(`Pets property separator changed: ${key}`);
        edits.push({ start: node.getStart(file), end: node.end + next[0].length, replacement: "" });
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    if (!marked && found.size !== Object.values(signatures).flat().length) throw new Error("Missing pinned Pets registration properties.");
  }
  if (relativePath === MAIN) {
    replace("let n=!1,r=e.map(e=>", "let n=!1,r=e.filter(e=>Dk(e.id)!==`connector_openai_chatgpt_pets`).map(e=>", fn("Uyn"));
    replace("return n?r:e", "return n||r.length!==e.length?r:e", fn("Uyn"));
    replace("return e.filter(e=>e.is_enabled", "if(t!=null&&Dk(t)===`connector_openai_chatgpt_pets`)return[];return e.filter(e=>e.is_enabled", fn("Qvn"));
    // Remove the dedicated subscription and its initializer, leaving generic subscribers intact.
    removeFn("XEa", "connector_openai_chatgpt_pets");
    removeFn("QEa", "create_pet");
    replace("var ZEa;", "");
    replace(",c=XEa(e,t,n,r)", "", fn("bDa"));
    replace("l(),s?.(),c();", "l(),s?.();", fn("bDa"));
    replace("QEa(),", "", fn("SDa"));
    // Shared profile/avatar bundles still import these exports. Neutral atoms preserve
    // the graph, without Pets query clients, persistence, watchers, migrations or RPC.
    body("S2r", "cloud-pets", "{return(S2r=e((()=>{q(),rp(),lp(),K_(),y2r=Fd($,()=>({queryKey:[`azrael-retired-pets`],enabled:!1,initialData:[],queryFn:async()=>[]})),x2r=ff($,()=>({isFetching:!1,isPending:!1,pet:null}))})))()}");
    body("E2r", "vm.customAvatars.load()", "{return(E2r=e((()=>{q(),rp(),lp(),w2r=Fd($,()=>({queryKey:[`azrael-retired-avatars`],enabled:!1,initialData:{avatarDirectory:null,avatars:[]},queryFn:async()=>({avatarDirectory:null,avatars:[]})})),T2r=sf($,e=>({queryKey:[`azrael-retired-avatars`,e],enabled:!1,initialData:null,queryFn:async()=>null}))})))()}");
    body("N2r", "migrated-cloud-pet-ids-v1", "{return(N2r=e((()=>{q(),M2r=Gf($,{})})))()}");
    body("K2r", "cloud-pets", "{return(K2r=e((()=>{q(),G2r=Gf($,null)})))()}");
    body("n2r", "t.watch", "{return(n2r=e((()=>{q(),t2r=Gf($,!1)})))()}");
    body("o2r", "...m2r", "{return[`azrael-retired-pets`,e,t]}");
    body("l2r", "pets:await c2r", "{return{queryKey:o2r(e,t),enabled:!1,initialData:{pets:[],receivedAt:0},queryFn:async()=>({pets:[],receivedAt:0})}}");
    body("I2r", "get(W2r).mutate", "{}");
    for (const [name, anchor] of [["a2r","cloud-pet-artwork-cache"],["s2r","spritesheet_url"],["c2r","`/pets`"],["u2r","Cloud pet spritesheet"],["d2r","new URL"],["f2r","SHA-256"],["p2r","Cloud pet image"],["P2r","...B2r"],["F2r","accessory_id"],["L2r","selectedAvatarId"],["R2r","pet_"],["z2r","Tg(o$,o)"]]) removeFn(name, anchor);
    replace("var r2r,i2r,i$;", "");
    replace("var m2r,h2r,g2r,a$,_2r,v2r,y2r,b2r,x2r;", "var y2r,x2r;");
    replace("var C2r,w2r,T2r;", "var w2r,T2r;");
    replace("var D2r,O2r,k2r,A2r,j2r,M2r;", "var M2r;");
    replace("var B2r,o$,V2r,H2r,U2r,W2r,G2r;", "var G2r;");
    replace("accessoryId:f.settings?.accessory_id,", "");
    replace("settings:Q({accessory_id:Y().optional(),", "settings:Q({");
    body("Kxi", "WorkModePetContent", "{Gxi=()=>null;}");
    replace("(0,b4.jsx)(Gxi,{className:s?`relative -top-0.5`:void 0,size:`conversation`,trackShownImpressions:u})", "null", fn("qxi"));
  } else if (relativePath === SETTINGS) {
    // Lazy registration and labels own settings reachability; mapDeps remains inert.
    removeProperties(["pets", "chatGptPets"], { pets: ["pets:_R", "settings.nav.miniAndPets"], chatGptPets: ["settings.nav.pets.v2"] });
    replace("case`time-management`:case`pets`:", "case`time-management`:");
  } else if (relativePath === NAV) {
    replace("i=t&&e.slug===`pets`,a=i?Sn:r.component", "i=!1,a=r.component");
    const instructions = text.includes("personalization.azrael-instructions.");
    replace(instructions ? "personalization.azrael-instructions.pets.usage" : "personalization.pets.usage", instructions ? "personalization.azrael-instructions.usage" : "personalization.usage");
    replace(instructions ? "`azrael-instructions`,`pets`,`keyboard-shortcuts`" : "`personalization`,`pets`,`keyboard-shortcuts`", instructions ? "`azrael-instructions`,`keyboard-shortcuts`" : "`personalization`,`keyboard-shortcuts`");
  } else if (relativePath === VISIBLE) {
    removeProperties(["pets"], { pets: ["component:Zi,commandAsset:Di"] });
    replace("case`pets`:return{visible:!1,pending:!1};", "");
  } else if (relativePath === HOST) {
    replace("this.customAvatars=new rF(pe),this.subscriptions.push", "this.subscriptions.push");
    replace("customAvatars:this.customAvatars.rpc,", "");
    replace("customAvatars;computerUseSettings=new eF", "computerUseSettings=new eF");
    replace("var rF=class{rpc;constructor(e){this.rpc={load:()=>PFe({appServerClient:e}),loadAvatar:r=>kFe({appServerClient:e,avatarId:r})}}};", "");
    for (const [name, anchor] of [["PFe",'n.join(r,"pets")'],["kFe",'"pet.json"'],["EFe","a5(t,e,r,s.name,n)"],["a5","Jqt.safeParse"],["eUt","spritesheetDataUrl"],["IFe","t.relative(e,n)"],["tUt","rUt(t)??nUt(t)"],["rUt",'"IHDR"'],["nUt",'"WEBP"'],["oUt",'"VP8X"']]) removeFn(name, anchor);
    replace("MFe();", "");
    const schemas = file.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.text === "MFe"));
    if (marked) {
      if (schemas.length) throw new Error("Retired Pets host schema restored.");
    } else {
      if (schemas.length !== 1 || !schemas[0].getText(file).includes('Qqt=1536,Xqt=1872,Yqt=2288,Jqt=c.object(')) throw new Error("Pinned Pets host schema changed.");
      edits.push({ start: schemas[0].getStart(file), end: schemas[0].end, replacement: "" });
    }
  }
  if (marked) return { text, count: 0 };
  edits.sort((a,b) => b.start-a.start);
  let previous = text.length;
  for (const edit of edits) {
    if (edit.end > previous) throw new Error("Overlapping Pets cleanup edits.");
    previous = edit.start;
    text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  }
  text = MARKER + text;
  parse(text, ts);
  return { text, count: 1 };
}
module.exports = { PETS_CLEANUP_ASSETS, MARKER, injectPetsCleanup };
