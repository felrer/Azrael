"use strict";

const COMPOSER_ASSET = "webview/assets/app-initial-532d60c9b397.js";
const PERMISSIONS_ASSET = "webview/assets/permissions-mode-dropdown-50ba72a19bff.js";
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
    const placeholder = requireFunction("pyi");
    if (marked) {
      if (placeholder.body.getText(file) !== '{return "^•⩊•^";}') throw new Error("Invalid cleaned composer placeholder.");
    } else {
      if (!placeholder.body.getText(file).includes("composer.placeholder.localFollowUp.locally") || !placeholder.body.getText(file).includes("if(u!=null)return u")) throw new Error("Pinned placeholder variants changed.");
      edits.push({ start: placeholder.body.getStart(file), end: placeholder.body.end, replacement: '{return "^•⩊•^";}' });
    }
    // These components exclusively register and dispatch the removed actions.
    // Remove their bodies and declarations, then sever every JSX mounting route.
    for (const [name, id, dispatch] of [["fca", "plan-mode", "C"], ["wsa", "goal", "y"]]) {
      if (marked) {
        if (functions.has(name)) throw new Error(`Removed UI registration restored: ${name}`);
      } else {
        const node = requireFunction(name), source = node.getText(file);
        if (!source.includes(`id:\`${id}\``) || !source.includes(`M6(${dispatch})`)) throw new Error(`Pinned action registration changed: ${name}`);
        edits.push({ start: node.getStart(file), end: node.end, replacement: "" });
      }
    }
    for (const [name, body] of [["pca", '{return e.mode==="default"}'], ["mca", '{return e.mode===`plan`}'], ["Tsa", '{return e.mode==="default"}']]) {
      if (marked) {
        if (functions.has(name)) throw new Error(`Removed UI action helper restored: ${name}`);
      } else {
        const node = requireFunction(name);
        if (node.body.getText(file) !== body) throw new Error(`Pinned action helper changed: ${name}`);
        edits.push({ start: node.getStart(file), end: node.end, replacement: "" });
      }
    }
    replace(requireFunction("Osa"), ",Dsa=e=>e.replace(/^go+(?=a?l?$)/i,`go`)", "");
    replace(null, "var Esa,Dsa;", "var Esa;");
    const launcher = requireFunction("xla"), composer = requireFunction("kha");
    // Retire only these slash-menu registrations; model/reasoning toolbar
    // controls and shared fork/init/review services remain independently usable.
    for (const [name, id] of [["nca", "model"], ["xsa", "fork"], ["Msa", "init"], ["Sca", "reasoning"], ["Xoa", "review-mode"], ["nsa", "review-mode"]]) {
      if (marked) {
        if (functions.has(name)) throw new Error(`Removed slash registration restored: ${name}`);
      } else {
        const node = requireFunction(name), source = node.getText(file);
        if (!source.includes(`id:\`${id}\``) || !source.includes("M6(")) throw new Error(`Pinned slash registration changed: ${name}`);
        edits.push({ start: node.getStart(file), end: node.end, replacement: "" });
      }
    }
    for (const anchor of [
      "(0,V7.jsx)(nca,{conversationId:P,permissionsCwdOverride:m,permissionsHostId:h,serviceTierDefaults:v})",
      "(0,V7.jsx)(Sca,{conversationId:P,permissionsCwdOverride:m,permissionsHostId:h})",
      "(0,V7.jsx)(Msa,{cwd:g,enabled:he,hostId:L.hostId,onSubmitInitPrompt:p})",
      "(0,V7.jsx)(xsa,{showWorktreeOption:!1,isWorktreeThread:pe,onForkIntoLocal:_e,onForkIntoWorktree:Se})",
    ]) replace(launcher, anchor, "null");
    const reviewLauncher = requireFunction("esa");
    replace(reviewLauncher, "(0,L7.jsx)(Xoa,{conversationId:r,cwd:i,gitRoot:d,hostConfig:a})", "null");
    replace(reviewLauncher, "(0,L7.jsx)(nsa,{enabled:f})", "null", 2);
    replace(launcher, "(0,V7.jsx)(fca,{conversationId:P,onEnablePlanMode:d})", "null");
    replace(launcher, "(0,V7.jsx)(wsa,{conversationId:P,enabled:Be,isExtendedGoalCommand:O,onOpenGoalEditor:f})", "void 0");
    replace(launcher, "onEnablePlanMode:d,onOpenGoalEditor:f,", "");
    // Remove the now-unused callback dependencies from memoized mounts.
    replace(launcher, "t[86]!==P||t[87]!==d||t[88]!==z", "t[86]!==P||t[88]!==z");
    replace(launcher, "t[86]=P,t[87]=d,t[88]=z", "t[86]=P,t[88]=z");
    replace(launcher, "t[92]!==P||t[93]!==O||t[94]!==f||t[95]!==Be", "t[92]!==P||t[93]!==O||t[95]!==Be");
    replace(launcher, "t[92]=P,t[93]=O,t[94]=f,t[95]=Be", "t[92]=P,t[93]=O,t[95]=Be");
    replace(composer, "onEnablePlanMode:Ac,onOpenGoalEditor:kc,", "");
    replace(composer, "kc=Cm(()=>{na(`pendingThreadGoalObjective`,``),eo()}),", "");
    replace(requireFunction("iLi"), "`command:goal`,`command:plan-mode`,", "");
  } else {
    // Permission policy, eligibility, confirmation and selection callbacks stay
    // intact. Match the ordinary approval option's neutral presentation.
    replace(null, "At=kt?`warning`:`tertiary`,Y=kt?An:`text-tertiary`", "At=`tertiary`,Y=`text-tertiary`");
    replace(null, "leftIconClassName:l(`icon-sm`,An)", "leftIconClassName:l(`icon-sm`)");
    replace(null, "rightIconClassName:l(`icon-xs`,An)", "rightIconClassName:l(`icon-xs`)");
    replace(null, "className:An,children:!St||q", "className:`text-codex-description`,children:!St||q");
    replace(null, "className:An,children:(0,$.jsx)(h,{id:`composer.permissionsDropdown.fullAccess.optionLabel`", "className:`text-default`,children:(0,$.jsx)(h,{id:`composer.permissionsDropdown.fullAccess.optionLabel`");
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
