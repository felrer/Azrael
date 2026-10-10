"use strict";
const { createUiInputDiagnostics } = require("./ui-input-diagnostics-runtime.cjs");
const UI_INPUT_DIAGNOSTICS_ASSETS = ["webview/assets/app-initial-7a199c66e670.js", "webview/assets/app-initial-97d3534ad35f.js", "webview/assets/app-initial-c014f9ee4429.js"];
const UI_INPUT_DIAGNOSTICS_MARKER = "/*azrael-ui-input-diagnostics-v1*/";
function injectUiInputDiagnostics(text, relativePath, ts) {
  relativePath = relativePath.replace(/\\/g, "/");
  if (!UI_INPUT_DIAGNOSTICS_ASSETS.includes(relativePath)) return { text, count: 0 };
  ts ??= require("../extensions/azrael-ex/node_modules/typescript");
  const hst = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (hst.parseDiagnostics.length) throw Error("Malformed UI diagnostics asset");
  const find = predicate => { const found = []; function visit(n) { if (predicate(n)) found.push(n); ts.forEachChild(n, visit); } visit(hst); if (found.length !== 1) throw Error("Unsupported UI diagnostics anchor: " + found.length); return found[0]; };
  const markerCount = text.split(UI_INPUT_DIAGNOSTICS_MARKER).length - 1;
  if (markerCount > 1) throw Error("Duplicate UI diagnostics marker");
  const edits = [];
  if (relativePath === UI_INPUT_DIAGNOSTICS_ASSETS[0]) {
    const init = UI_INPUT_DIAGNOSTICS_MARKER + "try{globalThis.__azraelUiInputDiagnostics=(" + createUiInputDiagnostics.toString() + ")(safe=>Dm.dispatchMessage(`log-message`,{level:`warning`,message:`[azrael-ui-input] `+JSON.stringify(safe)}))}catch{}";
    if (markerCount) { if (!text.includes(init)) throw Error("Partial UI diagnostics initialization"); return { text, count: 0 }; }
    const anchor = find(n => ts.isExportDeclaration(n));
    edits.push([anchor.getStart(hst), anchor.getStart(hst), init]);
  } else if (relativePath === UI_INPUT_DIAGNOSTICS_ASSETS[1]) {
    const state = find(n => ts.isMethodDeclaration(n) && n.name.getText(hst) === "updateConversationState" && ts.isBinaryExpression(n.parent.parent) && n.parent.parent.left.getText(hst) === "dSn");
    const consume = find(n => ts.isMethodDeclaration(n) && n.name.getText(hst) === "__azraelConsume");
    const prefix = UI_INPUT_DIAGNOSTICS_MARKER + "let __azraelBefore,__azraelMutationKind=r!=null?`history`:`ordinary`,__azraelInvalidationType=null;try{__azraelInvalidationType=r==null?null:r.type===`entityKeys`?`entityKeys`:`other`;__azraelBefore=globalThis.__azraelUiInputDiagnostics?.snapshot(()=>$Z(this.conversations.get(e)))}catch{}try{";
    const suffix = "}finally{try{globalThis.__azraelUiInputDiagnostics?.compare(e,__azraelBefore,globalThis.__azraelUiInputDiagnostics?.snapshot(()=>$Z(this.conversations.get(e))),__azraelMutationKind,__azraelInvalidationType)}catch{}}";
    const stateAnchor = "if(r!=null&&!s&&(i!=null||!c)){";
    const stateReplacement = stateAnchor + "__azraelMutationKind=`optimized_history`;";
    const queuePrefix = "if(this.disposed)return;let __azraelClient,__azraelReceipt=!1,__azraelPersisted=!1;try{__azraelClient=t.id;__azraelReceipt=this.options.wasMessageAccepted?.(e,__azraelClient)===!0}catch{}try{";
    const queueSuffix = ";__azraelPersisted=!0}finally{try{globalThis.__azraelUiInputDiagnostics?.queue(e,__azraelClient,__azraelReceipt,__azraelPersisted)}catch{}}";
    if (markerCount) { if (![prefix,suffix,queuePrefix,queueSuffix,stateReplacement].every(s => text.includes(s))) throw Error("Partial UI diagnostics state injection"); return { text, count: 0 }; }
    if (!state.body.getText(hst).includes("Ur(o,t)") || !state.body.getText(hst).includes("Wr(o,e=>")) throw Error("Unsupported UI diagnostics state branches");
    if (!text.includes("/*azrael-queue-consumption-v3*/") || !consume.body.getText(hst).includes("await this.#v(e,") || !consume.body.getText(hst).startsWith("{if(this.disposed)return;")) throw Error("UI diagnostics requires queue-consumption v3");
    for (const [node,start,end] of [[state,prefix,suffix],[consume,queuePrefix,queueSuffix]]) {
      let body = text.slice(node.body.getStart(hst)+1,node.body.end-1);
      if (node === consume) body = body.slice("if(this.disposed)return;".length);
      if (node === state) {
        if (body.split(stateAnchor).length !== 2) throw Error("Unsupported UI diagnostics history branch");
        body = body.replace(stateAnchor,stateReplacement);
      }
      edits.push([node.body.getStart(hst)+1,node.body.end-1,start+body+end]);
    }
  } else {
    const vs = find(n => ts.isFunctionDeclaration(n) && n.name?.text === "nC");
    const anchor = "if(B){";
    const section = text.slice(vs.getStart(hst), vs.end), offset = section.indexOf(anchor);
    if (offset < 0 || section.split(anchor).length !== 2 || !["F=o&&xte(y),I=", "B=F||I?null:$S(", "V=B?.type===`user-message`"].every(s=>section.includes(s))) throw Error("Unsupported UI diagnostics renderer");
    const hook = UI_INPUT_DIAGNOSTICS_MARKER + "try{globalThis.__azraelUiInputDiagnostics?.render(y,F,I,B!=null,__azraelHideCallback,__azraelInputClassified,__azraelLinkedSteering)}catch{}";
    const reasonDeclaration = "let __azraelHideCallback=null,__azraelInputClassified=null,__azraelInputClassificationValue,__azraelLinkedSteering=null;";
    const reasonAnchor = "I=_?.(y.params.input)===!0||Cl(y.params.input)||y.items.some(e=>e.type===`steeringUserMessage`&&e.serverUserMessageId!=null&&(e.serverUserMessageId===y.itemsPagination?.openingUserMessageId||e.clientUserMessageId!=null&&e.clientUserMessageId===y.params.clientUserMessageId))";
    const reasonReplacement = "I=(__azraelHideCallback=_?.(y.params.input)===!0)||(__azraelInputClassificationValue=Cl(y.params.input),__azraelInputClassified=!!__azraelInputClassificationValue,__azraelInputClassificationValue)||(__azraelLinkedSteering=y.items.some(e=>e.type===`steeringUserMessage`&&e.serverUserMessageId!=null&&(e.serverUserMessageId===y.itemsPagination?.openingUserMessageId||e.clientUserMessageId!=null&&e.clientUserMessageId===y.params.clientUserMessageId)))";
    if (markerCount) { if (![hook,reasonDeclaration,reasonReplacement].every(s=>section.includes(s))) throw Error("Partial UI diagnostics renderer injection"); return { text, count: 0 }; }
    if (section.split(reasonAnchor).length !== 2) throw Error("Unsupported UI diagnostics suppression operands");
    edits.push([vs.body.getStart(hst)+1,vs.body.getStart(hst)+1,reasonDeclaration]);
    const reasonOffset = vs.getStart(hst)+section.indexOf(reasonAnchor);
    edits.push([reasonOffset,reasonOffset+reasonAnchor.length,reasonReplacement]);
    edits.push([vs.getStart(hst)+offset,vs.getStart(hst)+offset,hook]);
  }
  for (const [start,end,value] of edits.sort((a,b)=>b[0]-a[0])) text = text.slice(0,start)+value+text.slice(end);
  const checked = ts.createSourceFile(relativePath,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if (checked.parseDiagnostics.length) throw Error("Invalid UI diagnostics injection");
  return { text, count: 1 };
}
module.exports = { UI_INPUT_DIAGNOSTICS_ASSETS, UI_INPUT_DIAGNOSTICS_MARKER, injectUiInputDiagnostics };
