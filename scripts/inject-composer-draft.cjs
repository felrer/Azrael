"use strict";

const COMPOSER_DRAFT_ASSET = "webview/assets/app-initial-9cbfb5c07b41.js";
const MARKER = "/*azrael-composer-draft-v3*/";
// Read the same editable payload used by the pinned host. Clone it immediately:
// attachment edits may mutate objects while preparation is awaiting native RPC.
const SNAPSHOT = `${MARKER}function __azraelComposerSnapshot(e,f){let n=e.get(EW),a={};for(let k of ["imageAttachments","imageCommentDrafts","appshotContexts","fileAttachments","pastedTextAttachments","uploadedFileAttachments","addedFiles","mcpAppModelContextAttachments","selectedTextAttachments","responseTextAnnotations","pullRequestMergeConflict","attachmentOrder"])a[k]=n[k];return JSON.parse(JSON.stringify({key:Em(e.value),text:f.getText(),persistedText:f.getPersistedText(),draft:dW(e.get(mW.drafts$)[Em(e.value)]),attachments:a,selections:[e.get(PW),e.get(hU),e.get(mU),e.get(GH),e.get(XH,KTe(e.value)),e.get(lU),e.get(cU)],apps:[f.getMentionedComputerUseApps?.(),f.getMentionedBrowserFamilies?.(),f.getComputerUseAppMentions?.()]}))}function __azraelComposerMatches(e,f,s){return s!=null&&(0,pW.default)(__azraelComposerSnapshot(e,f),s)}`;

const edits = [
  // Local custody stays visible through preparation and native dispatch. An
  // optimistic opening-input ID is not evidence that the conversation renders
  // the input. Accepted removal belongs to the queue coordinator.
  ["return n.filter(e=>(e.submissionOptions?.clientUserMessageId??e.id)!==r&&(e.submissionIntent!==`send-now`||t($ca,e.createdAt)))", "return n.filter(e=>e.pausedReason!=null||e.submission?.status===`pending`||e.submission?.status===`sending`||e.submission?.status===`queued`||e.submission?.status===`outcome-unknown`||(e.submissionOptions?.clientUserMessageId??e.id)!==r&&(e.submissionIntent!==`send-now`||t($ca,e.createdAt)))"],
  ["async function uua({", SNAPSHOT + "async function uua({"],
  ["let Ee=ve??f.getText(),De=", "let __azraelSubmitted=__azraelComposerSnapshot(e,f),__azraelCleared;const __azraelOwns=()=>__azraelComposerMatches(e,f,__azraelSubmitted),__azraelClear=n=>{if(!__azraelOwns())return!1;l(n);__azraelCleared=__azraelComposerSnapshot(e,f);return!0},__azraelRelease=(c,ok)=>c?.(ok,__azraelComposerMatches(e,f,__azraelCleared));let Ee=ve??f.getText(),De="],
  ["await H(Ne)&&(l(),e=me&&Ne.length>0)", "await H(Ne)&&(__azraelClear(),e=me&&Ne.length>0)"],
  ["at||(ct=w(),at=!0,l(nt),ne(!1),me&&_())", "at||(ct=__azraelOwns()?w():void 0,at=!0,__azraelClear(nt),ne(!1),me&&_())"],
  ["(ct(!0),ct=void 0,Re()", "(__azraelRelease(ct,!0),ct=void 0,Re()"],
  ["at&&it!=null&&ct?.(!1)&&C(it)", "at&&it!=null&&__azraelRelease(ct,!1)&&C(it)"],
  ["Ie(),fua(K,Me,e),l(nt),t?.onAccepted()", "Ie(),fua(K,Me,e),__azraelClear(nt),t?.onAccepted()"],
  ["ct?.(!0),ct=void 0,at||l(nt)", "__azraelRelease(ct,!0),ct=void 0,at||__azraelClear(nt)"],
  ["if(ct?.(!0),ct=void 0,D", "if(__azraelRelease(ct,!0),ct=void 0,D"],
  ["!at&&!we&&l(nt)", "!at&&!we&&__azraelClear(nt)"],
  ["ot=!0,ct?.(!1),at||", "ot=!0,__azraelRelease(ct,!1),at||"],
  // Always unsubscribe; an older callback must never remove another submission's
  // retained atom. Abandoning ownership releases only its own retained reference.
  ["return o=>{if(a(),e.get(yW)!==i)return!1;let s=eer(e)", "return(o,__azraelOwns=!0)=>{if(a(),e.get(yW)!==i)return!1;if(!__azraelOwns){e.set(vW,t,void 0);return!1}let s=eer(e)"],
];

const count = (text, token) => text.split(token).length - 1;
function injectComposerDraft(text) {
  if (/\/\*azrael-composer-draft-v[12]\*\//.test(text)) throw new Error("Outdated composer draft injection; use the original pinned asset.");
  if (count(text, MARKER)) {
    if (count(text, MARKER) !== 1 || edits.some(([, replacement]) => count(text, replacement) !== 1)) {
      throw new Error("Invalid or partial composer draft injection.");
    }
    return { text, count: 0 };
  }
  for (const [anchor] of edits) {
    if (count(text, anchor) !== 1) throw new Error(`Pinned composer draft anchor must occur exactly once: ${anchor.slice(0, 100)}`);
  }
  for (const [anchor, replacement] of edits) text = text.replace(anchor, replacement);
  return { text, count: 1 };
}

module.exports = { COMPOSER_DRAFT_ASSET, MARKER, SNAPSHOT, injectComposerDraft };
