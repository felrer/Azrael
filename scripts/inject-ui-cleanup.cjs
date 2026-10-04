"use strict";

const COMPOSER_ASSET = "webview/assets/app-initial-9cbfb5c07b41.js";
const PERMISSIONS_ASSET = "webview/assets/permissions-mode-dropdown-81883922faea.js";
const UI_CLEANUP_ASSETS = [COMPOSER_ASSET, PERMISSIONS_ASSET];
const MARKER = "/*azrael-ui-cleanup-v1*/";

function parse(text, ts) {
  const file = ts.createSourceFile("pinned-ui.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error("UI cleanup asset failed JavaScript parsing.");
  return file;
}
function injectUiCleanup(text, relativePath, ts) {
  if (!UI_CLEANUP_ASSETS.includes(relativePath)) return { text, count: 0 };
  const file = parse(text, ts), edits = [], seen = new Set();
  const functions = new Map();
  for (const node of file.statements) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      if (functions.has(node.name.text)) throw new Error("Duplicate pinned UI function.");
      functions.set(node.name.text, node);
    }
  }
  const marked = text.includes(MARKER);
  function requireFunction(name) {
    const node = functions.get(name);
    if (!node) throw new Error(`Missing pinned UI function: ${name}`);
    return node;
  }
  function replace(owner, anchor, replacement, expected = 1) {
    const start = owner ? owner.getStart(file) : 0, end = owner ? owner.end : text.length;
    const source = text.slice(start, end), occurrences = source.split(anchor).length - 1;
    if (marked) {
      if (occurrences !== (anchor === replacement ? expected : 0) || (replacement && !["null", "void 0"].includes(replacement) && source.split(replacement).length - 1 !== expected))
        throw new Error(`Invalid UI cleanup replacement: ${anchor.slice(0, 80)}`);
      return;
    }
    if (occurrences !== expected) throw new Error(`Pinned UI cleanup anchor changed: ${anchor.slice(0, 80)}`);
    let pos = start;
    for (let i = 0; i < expected; i++) {
      pos = text.indexOf(anchor, pos);
      edits.push({ start: pos, end: pos + anchor.length, replacement });
      pos += anchor.length;
    }
  }
  if (relativePath === COMPOSER_ASSET) {
    const placeholder = requireFunction("c_i");
    if (marked) {
      if (placeholder.body.getText(file) !== '{return "-";}') throw new Error("Invalid cleaned composer placeholder.");
    } else {
      if (!placeholder.body.getText(file).includes("composer.placeholder.localFollowUp.locally") || !placeholder.body.getText(file).includes("if(u!=null)return u")) throw new Error("Pinned placeholder variants changed.");
      edits.push({ start: placeholder.body.getStart(file), end: placeholder.body.end, replacement: '{return "-";}' });
    }
    // These components exclusively register and dispatch the removed actions.
    // Remove their bodies and declarations, then sever every JSX mounting route.
    for (const [name, id, dispatch] of [["Oaa", "plan-mode", "C"], ["Via", "goal", "y"], ["FQi", "sketch", "b"]]) {
      if (marked) {
        if (functions.has(name)) throw new Error(`Removed UI registration restored: ${name}`);
      } else {
        const node = requireFunction(name), source = node.getText(file);
        if (!source.includes(`id:\`${id}\``) || !source.includes(`D6(${dispatch})`)) throw new Error(`Pinned action registration changed: ${name}`);
        edits.push({ start: node.getStart(file), end: node.end, replacement: "" });
      }
    }
    for (const [name, body] of [["kaa", '{return e.mode==="default"}'], ["Aaa", '{return e.mode===`plan`}'], ["Hia", '{return e.mode==="default"}']]) {
      if (marked) {
        if (functions.has(name)) throw new Error(`Removed UI action helper restored: ${name}`);
      } else {
        const node = requireFunction(name);
        if (node.body.getText(file) !== body) throw new Error(`Pinned action helper changed: ${name}`);
        edits.push({ start: node.getStart(file), end: node.end, replacement: "" });
      }
    }
    replace(requireFunction("Gia"), ',Wia=e=>e.replace(/^go+(?=a?l?$)/i,`go`)', "");
    replace(null, "var Uia,Wia;", "var Uia;");
    const launcher = requireFunction("Loa"), composer = requireFunction("Gfa");
    replace(launcher, "(0,W7.jsx)(Oaa,{conversationId:F,onEnablePlanMode:d})", "null");
    replace(launcher, "(0,W7.jsx)(Via,{conversationId:F,enabled:Be,isExtendedGoalCommand:k,onOpenGoalEditor:f})", "void 0");
    replace(composer, "(0,o9.jsx)(FQi,{ref:Se,executionHostId:Kr,canSave:hl,isSubmitting:ec||In,addImageAttachment:Ra.addImageAttachment,onAttachmentAdded:Le})", "void 0");
    replace(launcher, "onEnablePlanMode:d,onOpenGoalEditor:f,", "");
    // Remove the now-unused callback dependencies from memoized mounts.
    replace(launcher, "t[86]!==F||t[87]!==d||t[88]!==B", "t[86]!==F||t[88]!==B");
    replace(launcher, "t[86]=F,t[87]=d,t[88]=B", "t[86]=F,t[88]=B");
    replace(launcher, "t[92]!==F||t[93]!==k||t[94]!==f||t[95]!==Be", "t[92]!==F||t[93]!==k||t[95]!==Be");
    replace(launcher, "t[92]=F,t[93]=k,t[94]=f,t[95]=Be", "t[92]=F,t[93]=k,t[95]=Be");
    replace(composer, "onEnablePlanMode:Tc,onOpenGoalEditor:wc,", "");
    replace(composer, "wc=Sp(()=>{Yi(`pendingThreadGoalObjective`,``),Ya()}),", "");
    replace(requireFunction("rPi"), "`command:goal`,`command:plan-mode`,", "");
    const catalog = requireFunction("RVn");
    replace(catalog, "UVn(e.system_hint)||e.system_hint===`sketch`&&u?.canEditSketch===!0&&!a&&!o&&!c&&!l", "e.system_hint!==`sketch`&&UVn(e.system_hint)");
    replace(catalog, "if(e.system_hint===`sketch`)return{kind:`local_action`,systemHint:`sketch`,disabled:u?.canOpenSketch!==!0,description:e.description,Icon:{16:qKt,20:JKt},searchAliases:Array.from(new Set([e.action_label??e.name,e.name,...e.aliases,...e.regex_matches??[]])),title:e.action_label??e.name};", "");
    replace(requireFunction("sQi"), "if(n.kind===`local_action`){n.disabled||a?.(`sketch`);return}", "if(n.kind===`local_action`)return;");
    // The shared ChatGPT composer also publishes an imperative capability.
    // Remove its creation handlers; retain the capability's false result for
    // consumers while persisted sketch attachment editing remains available.
    replace(requireFunction("h0i"), ",os;t[280]===gn?os=t[281]:(os=e=>{Ao.current?.openNew()&&Bm(gn,cfe,{systemHintId:`sketch`})},t[280]=gn,t[281]=os);let ss=os,cs=!Ne&&!Me&&!xn&&(an?rs:as)?.some(E0i)===!0,ls;t[282]===cs?ls=t[283]:(ls=e=>cs&&(Ao.current?.openNew(e)??!1),t[282]=cs,t[283]=ls);let us=Sp(ls),", ",ss=void 0,cs=!1,us=()=>!1;let ");
  } else {
    // Permission policy, eligibility, confirmation and selection callbacks stay
    // intact. Match the ordinary approval option's neutral presentation.
    replace(null, "At=kt?`warning`:`tertiary`,Y=kt?An:`text-tertiary`", "At=`tertiary`,Y=`text-tertiary`");
    replace(null, "leftIconClassName:p(`icon-sm`,An)", "leftIconClassName:p(`icon-sm`)");
    replace(null, "rightIconClassName:p(`icon-xs`,An)", "rightIconClassName:p(`icon-xs`)");
    replace(null, "className:An,children:!St||q", "className:`text-codex-description`,children:!St||q");
    replace(null, "className:An,children:(0,$.jsx)(s,{id:`composer.permissionsDropdown.fullAccess.optionLabel`", "className:`text-default`,children:(0,$.jsx)(s,{id:`composer.permissionsDropdown.fullAccess.optionLabel`");
    replace(null, "let o=i.kind===`agent-mode`&&i.agentMode===`full-access`?xn:`text-codex-description`", "let o=`text-codex-description`");
  }
  if (marked) {
    if (text.split(MARKER).length !== 2) throw new Error("Duplicate UI cleanup marker.");
    return { text, count: 0 };
  }
  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) {
    if (seen.has(edit.start)) throw new Error("Overlapping UI cleanup edits.");
    seen.add(edit.start);
    text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  }
  text = MARKER + text;
  parse(text, ts);
  return { text, count: 1 };
}
module.exports = { UI_CLEANUP_ASSETS, COMPOSER_ASSET, PERMISSIONS_ASSET, MARKER, injectUiCleanup };
