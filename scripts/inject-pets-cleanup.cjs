"use strict";

// Pinned to public UI 26.930.61225. Run after the distribution's other transforms.
const MAIN = "webview/assets/app-initial-532d60c9b397.js";
const SETTINGS = "webview/assets/app-initial-5120fa5fe295.js";
const NAV = "webview/assets/settings-page-76344c84191c.js";
const VISIBLE = "webview/assets/use-visible-settings-sections-4b8b7ed73a1e.js";
const HOST = "out/extension.js";
const MARKER = "/*azrael-pets-retired-v1*/";
const EMPTY_MODULES = {
  "webview/assets/pets-settings-route-bac011a7ab72.js": "function PetsSettingsRoute(){return null;}export{PetsSettingsRoute};",
  "webview/assets/pet-content-9bc3c06018e2.js": "function WorkModePetContent(){return null;}export{WorkModePetContent};",
  "webview/assets/avatar-overlay-native-page-273602c9809d.js": "function AvatarOverlayNativePage(){return null;}export{AvatarOverlayNativePage};",
  "webview/assets/use-avatar-options-8847fce3bfa1.js": "function f(){return{avatarDirectory:null,avatarOptions:[],isError:false,isFetching:false,isLoading:false};}function g(){}export{f as n,g as t};"
};
const PETS_CLEANUP_ASSETS = [MAIN, SETTINGS, NAV, VISIBLE, HOST, ...Object.keys(EMPTY_MODULES)];
function parse(text, vp) {
  const file = vp.createSourceFile("pinned-pets.js", text, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error("Pets cleanup asset failed JavaScript parsing.");
  return file;
}
function hostStatements(file, vp) {
  function wrapperFunctions(statements) {
    return statements.flatMap(statement => {
      if (!vp.isExpressionStatement(statement) || !vp.isCallExpression(statement.expression)) return [];
      const call = statement.expression;
      const target = vp.isPropertyAccessExpression(call.expression) ? call.expression.expression : call.expression;
      if (!vp.isParenthesizedExpression(target) || !vp.isFunctionExpression(target.expression)) return [];
      // Pinned bundles also contain unrelated enum initializer IIFEs.
      if (!vp.isPropertyAccessExpression(call.expression) &&
          target.expression.parameters[0]?.name.getText(file) !== "process") return [];
      return [{ call, pn: target.expression }];
    });
  }
  const wrappers = wrapperFunctions(file.statements);
  if (!wrappers.length) return file.statements;
  if (wrappers.length !== 1) throw new Error("Duplicate ordinary host process wrapper.");
  const { call, pn } = wrappers[0], runtime = call.arguments[1];
  if (!vp.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "call" ||
      pn.name || pn.asteriskToken || pn.modifiers?.length || pn.parameters.length !== 1 ||
      pn.parameters[0].getText(file) !== "process" || call.arguments.length !== 2 ||
      call.arguments[0].kind !== vp.SyntaxKind.ThisKeyword || !runtime ||
      !vp.isPropertyAccessExpression(runtime) || runtime.name.text !== "process" ||
      !vp.isCallExpression(runtime.expression) || !vp.isIdentifier(runtime.expression.expression) ||
      runtime.expression.expression.text !== "require" || runtime.expression.arguments.length !== 1 ||
      !vp.isStringLiteral(runtime.expression.arguments[0]) ||
      runtime.expression.arguments[0].text !== "./azrael-runtime.cjs" || wrapperFunctions(pn.body.statements).length) {
    throw new Error("Invalid ordinary host process wrapper.");
  }
  return pn.body.statements;
}
function injectPetsCleanup(text, relativePath, vp) {
  if (!PETS_CLEANUP_ASSETS.includes(relativePath)) return { text, count: 0 };
  const file = parse(text, vp), marked = text.includes(MARKER), edits = [];
  if (marked && text.split(MARKER).length !== 2) throw new Error("Duplicate Pets cleanup marker.");
  if (EMPTY_MODULES[relativePath]) {
    const replacement = MARKER + EMPTY_MODULES[relativePath];
    if (marked) {
      if (text !== replacement) throw new Error("Invalid retired Pets module.");
      return { text, count: 0 };
    }
    const expected = {
      "webview/assets/pets-settings-route-bac011a7ab72.js": "export{Qe as PetsSettingsRoute};",
      "webview/assets/pet-content-9bc3c06018e2.js": "export{J as WorkModePetContent};",
      "webview/assets/avatar-overlay-native-page-273602c9809d.js": "export{Ey as AvatarOverlayNativePage};",
      "webview/assets/use-avatar-options-8847fce3bfa1.js": "export{f as n,m as t};"
    }[relativePath];
    if (text.split(expected).length !== 2 || !text.includes("//# sourceMappingURL=" + relativePath.split("/").pop() + ".map")) throw new Error("Pinned Pets module exports changed.");
    parse(replacement, vp);
    return { text: replacement, count: 1 };
  }
  const statements = relativePath === HOST ? hostStatements(file, vp) : file.statements;
  const functions = new Map(statements.filter(vp.isFunctionDeclaration).map(n => [n.name?.text, n]));
  function pn(name) {
    const node = functions.get(name);
    if (!node) throw new Error(`Missing pinned Pets function: ${name}`);
    return node;
  }
  function body(name, anchor, replacement) {
    const node = pn(name), source = node.body.getText(file);
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
    const node = pn(name);
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
      if (vp.isPropertyAssignment(node) && names.includes(node.name.text)) {
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
      vp.forEachChild(node, visit);
    }
    visit(file);
    if (!marked && found.size !== Object.values(signatures).flat().length) throw new Error("Missing pinned Pets registration properties.");
  }
  if (relativePath === MAIN) {
    replace("let n=!1,r=e.map(e=>", "let n=!1,r=e.filter(e=>sA(e.id)!==`connector_openai_chatgpt_pets`).map(e=>", pn("Lbn"));
    replace("return n?r:e", "return n||r.length!==e.length?r:e", pn("Lbn"));
    replace("return e.filter(e=>e.is_enabled", "if(t!=null&&sA(t)===`connector_openai_chatgpt_pets`)return[];return e.filter(e=>e.is_enabled", pn("Kyn"));
    // Remove the dedicated subscription and its initializer, leaving generic subscribers intact.
    removeFn("HAa", "connector_openai_chatgpt_pets");
    removeFn("WAa", "create_pet");
    replace("var UAa;", "");
    replace(",c=HAa(e,t,n,r)", "", pn("fja"));
    replace("l(),s?.(),c();", "l(),s?.();", pn("fja"));
    replace("WAa(),", "", pn("mja"));
    // Shared profile/avatar bundles still import these exports. Neutral atoms preserve
    // the graph, without Pets query clients, persistence, watchers, migrations or RPC.
    body("y3r", "cloud-pets", "{return(y3r=e((()=>{K(),Mh(),Ip(),Kg(),g3r=Fi($,()=>({queryKey:[`azrael-retired-pets`],enabled:!1,initialData:[],queryFn:async()=>[]})),v3r=Jo($,()=>({isFetching:!1,isPending:!1,pet:null}))})))()}");
    body("C3r", "bp.customAvatars.load()", "{return(C3r=e((()=>{K(),Mh(),Ip(),x3r=Fi($,()=>({queryKey:[`azrael-retired-avatars`],enabled:!1,initialData:{avatarDirectory:null,avatars:[]},queryFn:async()=>({avatarDirectory:null,avatars:[]})})),S3r=Ku($,e=>({queryKey:[`azrael-retired-avatars`,e],enabled:!1,initialData:null,queryFn:async()=>null}))})))()}");
    body("A3r", "migrated-cloud-pet-ids-v1", "{return(A3r=e((()=>{K(),k3r=Xd($,{})})))()}");
    body("U3r", "cloud-pets", "{return(U3r=e((()=>{K(),H3r=Xd($,null)})))()}");
    body("$4r", "t.watch", "{return($4r=e((()=>{K(),Q4r=Xd($,!1)})))()}");
    body("r3r", "...d3r", "{return[`azrael-retired-pets`,e,t]}");
    body("o3r", "pets:await a3r", "{return{queryKey:r3r(e,t),enabled:!1,initialData:{pets:[],receivedAt:0},queryFn:async()=>({pets:[],receivedAt:0})}}");
    body("N3r", "get(V3r).mutate", "{}");
    for (const [name, anchor] of [["n3r","cloud-pet-artwork-cache"],["i3r","spritesheet_url"],["a3r","`/pets`"],["s3r","Cloud pet spritesheet"],["c3r","new URL"],["l3r","SHA-256"],["u3r","Cloud pet image"],["j3r","...L3r"],["M3r","accessory_id"],["P3r","selectedAvatarId"],["F3r","pet_"],["I3r","K_(B1,o)"]]) removeFn(name, anchor);
    replace("var e3r,t3r,R1;", "");
    replace("var d3r,f3r,p3r,z1,m3r,h3r,g3r,_3r,v3r;", "var g3r,v3r;");
    replace("var b3r,x3r,S3r;", "var x3r,S3r;");
    replace("var w3r,T3r,E3r,D3r,O3r,k3r;", "var k3r;");
    replace("var L3r,B1,R3r,z3r,B3r,V3r,H3r;", "var H3r;");
    replace("accessoryId:f.settings?.accessory_id,", "");
    replace("settings:X({accessory_id:Z().optional(),", "settings:X({");
    body("LCi", "WorkModePetContent", "{ICi=()=>null;}");
    replace("(0,e3.jsx)(ICi,{className:s?`relative -top-0.5`:void 0,size:`conversation`,trackShownImpressions:u})", "null", pn("RCi"));
  } else if (relativePath === SETTINGS) {
    // Lazy registration and labels own settings reachability; mapDeps remains inert.
    removeProperties(["pets", "chatGptPets"], { pets: ["pets:IR", "settings.nav.miniAndPets"], chatGptPets: ["settings.nav.pets.v2"] });
    replace("case`time-management`:case`pets`:", "case`time-management`:");
  } else if (relativePath === NAV) {
    replace("i=t&&e.slug===`pets`,s=i?Sn:r.component", "i=!1,s=r.component");
    const instructions = text.includes("personalization.azrael-instructions.");
    const design = text.includes("/*azrael-student-design-v1*/");
    const prefix = instructions ? `personalization.azrael-instructions.${design ? "azrael-design." : ""}` : "personalization.";
    replace(prefix + "pets.usage", prefix + "usage");
    replace(instructions ? `\`azrael-instructions\`,${design ? "`azrael-design`," : ""}\`pets\`,\`keyboard-shortcuts\`` : "`personalization`,`pets`,`keyboard-shortcuts`", instructions ? `\`azrael-instructions\`,${design ? "`azrael-design`," : ""}\`keyboard-shortcuts\`` : "`personalization`,`keyboard-shortcuts`");
  } else if (relativePath === VISIBLE) {
    removeProperties(["pets"], { pets: ["component:Xi,commandAsset:Ti"] });
    // The upstream registry still enumerates pets; retain its inert visibility
    // result so every registered slug has a defined visibility contract.
    replace("case`pets`:return{visible:!1,pending:!1};", "case`pets`:return{visible:!1,pending:!1};");
  } else if (relativePath === HOST) {
    replace("this.customAvatars=new eF(pe),this.subscriptions.push", "this.subscriptions.push");
    replace("customAvatars:this.customAvatars.rpc,", "");
    replace("customAvatars;computerUseSettings=new YN", "computerUseSettings=new YN");
    replace("var eF=class{rpc;constructor(e){this.rpc={load:()=>NFe({appServerClient:e}),loadAvatar:r=>FFe({appServerClient:e,avatarId:r})}}};", "");
    for (const [name, anchor] of [["NFe",'n.join(r,"pets")'],["FFe",'"pet.json"'],["DFe","c5(t,e,r,s.name,n)"],["c5","iUt.safeParse"],["sUt","spritesheetDataUrl"],["OFe","t.relative(e,n)"],["aUt","uUt(t)??lUt(t)"],["uUt",'"IHDR"'],["lUt",'"WEBP"'],["cUt",'"VP8X"']]) removeFn(name, anchor);
    replace("LFe();", "");
    const schemas = statements.filter(n => vp.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.text === "LFe"));
    if (marked) {
      if (schemas.length) throw new Error("Retired Pets host schema restored.");
    } else {
      if (schemas.length !== 1 || !schemas[0].getText(file).includes("rUt=1536,nUt=1872,oUt=2288,iUt=c.object(")) throw new Error("Pinned Pets host schema changed.");
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
  parse(text, vp);
  return { text, count: 1 };
}
module.exports = { PETS_CLEANUP_ASSETS, MARKER, injectPetsCleanup };
