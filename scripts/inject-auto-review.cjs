"use strict";

const AUTO_REVIEW_ASSETS = ["webview/assets/app-initial-7a199c66e670.js", "webview/assets/permissions-mode-dropdown-66a2c48ceb22.js", "webview/assets/app-initial-97d3534ad35f.js"];
const MARKER = "/*azrael-auto-review-v1*/";
const CHANGES = {
  FXr: [
    ["{isConfigDataPending:e,requirements:t", "{isAzraelAutoReviewSupported:z=!1,isConfigDataPending:e,requirements:t"],
    ["let l=e?[`read-only`,`auto`,`granular`,`full-access`,`custom`]:K_t(t,n),", "let l=(e?[`read-only`,`auto`,`granular`,`full-access`,`custom`]:K_t(t,n)).filter(e=>z||e!==`guardian-approvals`),"],
    ["d=a||r||o", "d=!0"],
  ],
  QXr: [
    ["{let t=(0,WX.c)(24)", "{const azraelAutoReviewService=azraelUseAutoReviewService(e.hostId);let t=(0,WX.c)(24)"],
    ["let F=m||h||g||j||E||T==null||P,", "let F=m||h||g||j||E||T==null,"],
    ["L):L=t[23],L}", "L):L=t[23],{...L,isAzraelAutoReviewSupported:!F&&azraelAutoReviewService.state===`ready`,azraelAutoReviewReason:azraelAutoReviewService.reason}}"],
  ],
  // Native preference writes occur only in selection callbacks; project the saved mode into the manual label.
  yn: [
    ["}),ct=N({availableAgentModes:tt", "}),azraelPreserveGuardian=B.isAzraelAutoReviewSupported===!1&&tt.includes(`auto`)&&ae({...B,isAzraelAutoReviewSupported:!0}).isGuardianModeAvailable,ct=N({availableAgentModes:tt"],
    ["J=k&&He!==`full-access`&&gt?`guardian-approvals`:He", "J=azraelPreserveGuardian&&He===`guardian-approvals`?`auto`:k&&He!==`full-access`&&gt?`guardian-approvals`:He"],
    ["Kt=St?", "Kt=!0?"],
    ["onClick:Ft,disabled:!gt,", "onClick:Ft,disabled:!gt,focusableWhenDisabled:!0,tooltipText:gt?void 0:B.azraelAutoReviewReason??`Requires default sandboxed permissions in this workspace`,"],
    ["children:gt?(0,$.jsx)", "children:!gt&&B.azraelAutoReviewReason?B.azraelAutoReviewReason:gt?(0,$.jsx)"],
    ["wt=it||Ct<=1", "wt=it||gt&&Ct<=1"],
  ],
};
const SUBMISSION_BEFORE='this.assertActive();let r=await this.requestClient.sendRequest(e,t,n);';
// Native admission owns policy-aware fallback/errors. Never rewrite reviewer,
// approval policy or permission fields from a stale Webview snapshot.
const SUBMISSION_AFTER='this.assertActive();if(e===`thread/start`||e===`thread/resume`||e===`turn/start`){const azraelConversation=t?.threadId==null?null:this.getConversation(t.threadId),azraelReviewer=t?.approvalsReviewer??azraelConversation?.latestThreadSettings?.approvalsReviewer;if(azraelReviewer===`guardian_subagent`){const azraelService=await this.requestClient.sendRequest(`azrael/account`,{action:`list`},n);this.assertActive();if(azraelService?.state?.serviceAccount==null)throw Error(`Update the Azrael engine to use service account Auto-review.`)}}let r=await this.requestClient.sendRequest(e,t,n);';

function azraelAutoReviewStatus(response) {
  const service = response?.state?.serviceAccount;
  const reasons = {
    unconfigured: "Connect an OpenAI service account in Accounts to use Auto-review.",
    checking: "Checking the OpenAI service account for Auto-review.",
    reauthRequired: "Sign in to the OpenAI service account again to use Auto-review.",
    unavailable: "The OpenAI service account is unavailable for Auto-review.",
    policyBlocked: "Auto-review is blocked by service account policy.",
    unsupported: "Update the Azrael engine to use service account Auto-review.",
  };
  const state = service && ["ready", ...Object.keys(reasons)].includes(service.state) ? service.state : "unsupported";
  return { state, reason: state === "ready" ? null : typeof service?.reason === "string" && service.reason.trim() ? service.reason : reasons[state] };
}

function azraelUseAutoReviewService(hostId) {
  const React = tZr, scope = Ou($);
  const [snapshot, setSnapshot] = React.useState(() => ({ hostId, state: "checking", reason: "Checking the OpenAI service account for Auto-review." }));
  React.useEffect(() => {
    let active = true, generation = 0;
    const refresh = async () => {
      if (!active) return;
      const current = ++generation;
      setSnapshot({ hostId, state: "checking", reason: "Checking the OpenAI service account for Auto-review." });
      try {
        const result = await Px(scope, hostId).sendRequest("azrael/account", { action: "list" });
        if (active && current === generation) setSnapshot({ hostId, ...azraelAutoReviewStatus(result) });
      } catch {
        if (active && current === generation) setSnapshot({ hostId, state: "unavailable", reason: "The OpenAI service account is unavailable for Auto-review." });
      }
    };
    let subscription, resolvedSubscription;
    try {
      subscription = Px(scope, hostId).subscribe({ type: "notification", key: { hostId }, methods: "azrael/account/updated", listener: refresh });
      subscription.onRpcBroken?.(refresh);
      Promise.resolve(subscription).then(value => { if (active) resolvedSubscription = value; else value?.[Symbol.dispose]?.(); }, refresh);
    } catch { /* Initial query still exposes transport/old-engine unavailability. */ }
    refresh();
    globalThis.addEventListener?.("focus", refresh);
    return () => { active = false; ++generation; subscription?.[Symbol.dispose]?.(); if (resolvedSubscription !== subscription) resolvedSubscription?.[Symbol.dispose]?.(); globalThis.removeEventListener?.("focus", refresh); };
  }, [scope, hostId]);
  return snapshot.hostId === hostId ? snapshot : { state: "checking", reason: "Checking the OpenAI service account for Auto-review." };
}

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
      if(declarations.length!==1||declarations[0].getText(file)!==(marked?"d=!0":"d=a||r||o"))throw new Error("Pinned auto-review rollout declaration drift.");
    }
  }
  if (marked) return { text, count: 0 };
  for(const edit of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,edit.start)+edit.text+text.slice(edit.end);
  if(relativePath===AUTO_REVIEW_ASSETS[0])text+='\n'+azraelAutoReviewStatus.toString()+'\n'+azraelUseAutoReviewService.toString();
  return { text: MARKER + text, count: 1 };
}

module.exports = { AUTO_REVIEW_ASSETS, MARKER, injectAutoReview, azraelAutoReviewStatus };
