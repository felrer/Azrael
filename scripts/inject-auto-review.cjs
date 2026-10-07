"use strict";

const AUTO_REVIEW_ASSETS = ["webview/assets/app-initial-532d60c9b397.js", "webview/assets/permissions-mode-dropdown-50ba72a19bff.js", "webview/assets/app-initial-efe028fd535e.js"];
const MARKER = "/*azrael-auto-review-v1*/";
const CHANGES = {
  FSr: [
    ["{isConfigDataPending:e,requirements:t", "{isAzraelAutoReviewSupported:z=!1,isConfigDataPending:e,requirements:t"],
    ["let c=e?[`read-only`,`auto`,`granular`,`full-access`,`custom`]:qft(t,n),", "let c=(e?[`read-only`,`auto`,`granular`,`full-access`,`custom`]:qft(t,n)).filter(e=>z||e!==`guardian-approvals`),"],
    ["u=i||r||a", "u=z"],
  ],
  ZSr: [
    ["{let t=(0,kY.c)(21)", "{const azraelAutoReviewModel=wh(e.conversationId).modelSettings;let t=(0,kY.c)(21)"],
    ["let I=m||h||g||A||T||F,", "let I=m||h||g||A||T||azraelAutoReviewModel.isLoading,"],
    ["R):R=t[20],R}", "R):R=t[20],{...R,isAzraelAutoReviewSupported:!I&&azraelAutoReviewModel.isLoading===!1&&typeof azraelAutoReviewModel.model===`string`&&azraelAutoReviewModel.model.trim().length>0&&!azraelAutoReviewModel.model.startsWith(`devin/`)&&!azraelAutoReviewModel.model.startsWith(`managed/`)&&(M?.model_provider==null||M.model_provider===`openai`)}}"],
  ],
  wn: [
    ["}),ot=Nt({availableAgentModes:Xe", "}),azraelPreserveGuardian=A.isAzraelAutoReviewSupported===!1&&me({...A,isAzraelAutoReviewSupported:!0}).isGuardianModeAvailable,ot=Nt({availableAgentModes:Xe"],
    ["Ot=J==null&&ut&&K!==`guardian-approvals`&&K!==`full-access`&&K!==`custom`", "Ot=J==null&&ut&&(azraelPreserveGuardian&&K===`guardian-approvals`||K!==`guardian-approvals`&&K!==`full-access`&&K!==`custom`)"],
    ["()=>{bt&&pt(null)},[pt,bt]", "()=>{bt&&!azraelPreserveGuardian&&pt(null)},[pt,bt,azraelPreserveGuardian]"],
    ["()=>{if(rt||ee||J!=null", "()=>{if(azraelPreserveGuardian&&K===`guardian-approvals`||rt||ee||J!=null"],
    ["[n,Ne,nt,Je,Pe,r,Ht,q,rt,ee,Ie,K,Ut,Ye,gt,J,ut,Wt,ze,Ve,lt,Ue,He,zt,_t]", "[n,Ne,nt,Je,Pe,r,Ht,q,rt,ee,Ie,K,Ut,Ye,gt,J,ut,Wt,ze,Ve,lt,Ue,He,zt,_t,azraelPreserveGuardian]"],
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
  const targets=relativePath===AUTO_REVIEW_ASSETS[0]?['FSr','ZSr']:['wn'];
  for (const name of targets) {
    const changes=CHANGES[name];
    const functions=file.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
    if(functions.length!==1)throw new Error(`Pinned auto-review ${name} function drift.`);
    const owner=functions[0],source=owner.getText(file),start=owner.getStart(file);
    if(name==="FSr")for(const guard of ["l=Xy(n??void 0)??!0","qft(t,n)","p=u&&l||f?c:d","showGuardianOption:u"])
      if(source.split(guard).length!==2)throw new Error(`Pinned auto-review policy anchor drift: ${guard}`);
    for(const [before,after] of changes){
      const expected=marked?after:before;
      if(source.split(expected).length!==2)throw new Error(`Pinned auto-review ${name} anchor drift: ${expected.slice(0,80)}`);
      if(!marked){const pos=start+source.indexOf(before);edits.push({start:pos,end:pos+before.length,text:after})}
    }
    if(name==="FSr"){
      const declarations=[];function visit(node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==="u")declarations.push(node);ts.forEachChild(node,visit)}visit(owner);
      if(declarations.length!==1||declarations[0].getText(file)!==(marked?"u=z":"u=i||r||a"))throw new Error("Pinned auto-review rollout declaration drift.");
    }
  }
  if (marked) return { text, count: 0 };
  for(const edit of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,edit.start)+edit.text+text.slice(edit.end);
  return { text: MARKER + text, count: 1 };
}

module.exports = { AUTO_REVIEW_ASSETS, MARKER, injectAutoReview };
