"use strict";

const AUTO_REVIEW_ASSETS = ["webview/assets/app-initial-7a199c66e670.js", "webview/assets/permissions-mode-dropdown-66a2c48ceb22.js", "webview/assets/app-initial-97d3534ad35f.js"];
const MARKER = "/*azrael-auto-review-v1*/";
const CHANGES = {
  FXr: [
    ["{isConfigDataPending:e,requirements:t", "{isAzraelAutoReviewSupported:z=!1,isConfigDataPending:e,requirements:t"],
    ["let l=e?[`read-only`,`auto`,`granular`,`full-access`,`custom`]:K_t(t,n),", "let l=(e?[`read-only`,`auto`,`granular`,`full-access`,`custom`]:K_t(t,n)).filter(e=>z||e!==`guardian-approvals`),"],
    ["d=a||r||o", "d=z"],
  ],
  QXr: [
    ["{let t=(0,WX.c)(24)", "{const azraelAutoReviewModel=gh(e.conversationId).modelSettings;let t=(0,WX.c)(24)"],
    ["let F=m||h||g||j||E||T==null||P,", "let F=m||h||g||j||E||T==null||azraelAutoReviewModel.isLoading,"],
    ["L):L=t[23],L}", "L):L=t[23],{...L,isAzraelAutoReviewSupported:!F&&azraelAutoReviewModel.isLoading===!1&&typeof azraelAutoReviewModel.model===`string`&&azraelAutoReviewModel.model.trim().length>0&&!azraelAutoReviewModel.model.startsWith(`devin/`)&&!azraelAutoReviewModel.model.startsWith(`managed/`)&&(N?.model_provider==null||N.model_provider===`openai`)}}"],
  ],
  // Native preference writes occur only in selection callbacks; project the saved mode into the manual label.
  yn: [
    ["}),ct=N({availableAgentModes:tt", "}),azraelPreserveGuardian=B.isAzraelAutoReviewSupported===!1&&ae({...B,isAzraelAutoReviewSupported:!0}).isGuardianModeAvailable,ct=N({availableAgentModes:tt"],
    ["J=k&&He!==`full-access`&&gt?`guardian-approvals`:He", "J=azraelPreserveGuardian&&He===`guardian-approvals`?`auto`:k&&He!==`full-access`&&gt?`guardian-approvals`:He"],
  ],
};
const SUBMISSION_BEFORE='this.assertActive();let r=await this.requestClient.sendRequest(e,t,n);';
const SUBMISSION_AFTER='this.assertActive();if(e===`thread/start`||e===`thread/resume`||e===`turn/start`){const azraelConversation=t?.threadId==null?null:this.getConversation(t.threadId),azraelModel=t?.collaborationMode?.settings?.model??t?.model??azraelConversation?.latestModel,azraelProvider=t?.modelProvider??t?.config?.model_provider??azraelConversation?.modelProvider,azraelSupported=typeof azraelModel===`string`&&azraelModel.trim().length>0&&!azraelModel.startsWith(`devin/`)&&!azraelModel.startsWith(`managed/`)&&(azraelProvider==null||azraelProvider===`openai`);if(!azraelSupported)t={...t,approvalsReviewer:`user`}}let r=await this.requestClient.sendRequest(e,t,n);';

function injectAutoReview(text, relativePath, ts) {
  if (!AUTO_REVIEW_ASSETS.includes(relativePath)) return { text, count: 0 };
  if (!ts) throw new Error("Auto-review injection requires the installed TypeScript parser.");
  const file = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error("Auto-review asset failed JavaScript parsing.");
  const marked = text.split(MARKER).length - 1;
  if (marked > 1) throw new Error("Duplicate auto-review marker.");
  if(relativePath===AUTO_REVIEW_ASSETS[2]){
    const methods=[];function visit(node){if(ts.isMethodDeclaration(node)&&node.name?.getText(file)==='sendRequest'&&node.getText(file).includes('this.requestClient.sendRequest(e,t,n)'))methods.push(node);ts.forEachChild(node,visit)}visit(file);
    if(methods.length!==1)throw new Error('Pinned native auto-review request manager drift.');
    const owner=methods[0],source=owner.getText(file),expected=marked?SUBMISSION_AFTER:SUBMISSION_BEFORE;
    if(source.split(expected).length!==2)throw new Error('Pinned auto-review submission anchor drift.');
    if(marked)return{text,count:0};
    const start=owner.getStart(file)+source.indexOf(SUBMISSION_BEFORE);
    return{text:MARKER+text.slice(0,start)+SUBMISSION_AFTER+text.slice(start+SUBMISSION_BEFORE.length),count:1};
  }
  // Policy eligibility must remain separate from the local rollout switch.
  const edits=[];
  const targets=relativePath===AUTO_REVIEW_ASSETS[0]?['FXr','QXr']:['yn'];
  for (const name of targets) {
    const changes=CHANGES[name];
    const functions=file.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
    if(functions.length!==1)throw new Error(`Pinned auto-review ${name} function drift.`);
    const owner=functions[0],source=owner.getText(file),start=owner.getStart(file);
    if(name==="FXr")for(const guard of ["u=rvt(n??void 0)??!0","K_t(t,n)","m=d&&u||p?l:f","showGuardianOption:d"])
      if(source.split(guard).length!==2)throw new Error(`Pinned auto-review policy anchor drift: ${guard}`);
    for(const [before,after] of changes){
      const expected=marked?after:before;
      if(source.split(expected).length!==2)throw new Error(`Pinned auto-review ${name} anchor drift: ${expected.slice(0,80)}`);
      if(!marked){const pos=start+source.indexOf(before);edits.push({start:pos,end:pos+before.length,text:after})}
    }
    if(name==="FXr"){
      const declarations=[];function visit(node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==="d")declarations.push(node);ts.forEachChild(node,visit)}visit(owner);
      if(declarations.length!==1||declarations[0].getText(file)!==(marked?"d=z":"d=a||r||o"))throw new Error("Pinned auto-review rollout declaration drift.");
    }
  }
  if (marked) return { text, count: 0 };
  for(const edit of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,edit.start)+edit.text+text.slice(edit.end);
  return { text: MARKER + text, count: 1 };
}

module.exports = { AUTO_REVIEW_ASSETS, MARKER, injectAutoReview };
