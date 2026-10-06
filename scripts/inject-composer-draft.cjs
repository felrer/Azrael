"use strict";

const COMPOSER_DRAFT_ASSET = "webview/assets/app-initial-532d60c9b397.js";
const MARKER = "/*azrael-composer-draft-v3*/";
// Read the same editable payload used by the pinned host. Clone it immediately:
// attachment edits may mutate objects while preparation is awaiting native RPC.
const SNAPSHOT = `${MARKER}function __azraelComposerSnapshot(e,h){let n=e.get(vG),jee={};for(let Cee of ["imageAttachments","imageCommentDrafts","appshotContexts","fileAttachments","pastedTextAttachments","uploadedFileAttachments","addedFiles","mcpAppModelContextAttachments","selectedTextAttachments","responseTextAnnotations","pullRequestMergeConflict","attachmentOrder"])jee[Cee]=n[Cee];return JSON.parse(JSON.stringify({key:Sp(e.value),text:h.getText(),persistedText:h.getPersistedText(),draft:$W(e.get(rG.drafts$)[Sp(e.value)]),attachments:jee,selections:[e.get(kG),e.get(rW),e.get(nW),e.get(NU),e.get(RU,lOe(e.value)),e.get(ZU),e.get(XU)],apps:[h.getMentionedComputerUseApps?.(),h.getMentionedBrowserFamilies?.(),h.getComputerUseAppMentions?.()]}))}function __azraelComposerMatches(e,h,Nee){return Nee!=null&&(0,tG.default)(__azraelComposerSnapshot(e,h),Nee)}`;

const edits = [
  // Local custody stays visible through preparation and native dispatch. An
  // optimistic opening-input ID is not evidence that the conversation renders
  // the input. Accepted removal belongs to the queue coordinator.
  ["return n.filter(e=>(e.submissionOptions?.clientUserMessageId??e.id)!==r&&(e.submissionIntent!==`send-now`||t(Lda,e.createdAt)))", "return n.filter(e=>e.pausedReason!=null||e.submission?.status===`pending`||e.submission?.status===`sending`||e.submission?.status===`queued`||e.submission?.status===`outcome-unknown`||(e.submissionOptions?.clientUserMessageId??e.id)!==r&&(e.submissionIntent!==`send-now`||t(Lda,e.createdAt)))"],
  ["async function Jfa({", SNAPSHOT + "async function Jfa({"],
  ["let De=ye??f.getText(),Oe=", "let __azraelSubmitted=__azraelComposerSnapshot(e,f),__azraelCleared;const __azraelOwns=()=>__azraelComposerMatches(e,f,__azraelSubmitted),__azraelClear=n=>{if(!__azraelOwns())return!1;l(n);__azraelCleared=__azraelComposerSnapshot(e,f);return!0},__azraelRelease=(c,Ik)=>c?.(Ik,__azraelComposerMatches(e,f,__azraelCleared));let De=ye??f.getText(),Oe="],
  ["await H(Ie)&&(l(),t=he&&Ie.length>0)", "await H(Ie)&&(__azraelClear(),t=he&&Ie.length>0)"],
  ["ut||(dt=Me&&e?.optimisticSteer===!0,mt=w({clearSavedDraft:dt}),ut=!0,l(st),re(!1),he&&_())", "ut||(dt=Me&&e?.optimisticSteer===!0,mt=__azraelOwns()?w({clearSavedDraft:dt}):void 0,ut=!0,__azraelClear(st),re(!1),he&&_())"],
  ["(mt(!0),mt=void 0,Ve()", "(__azraelRelease(mt,!0),mt=void 0,Ve()"],
  ["ut&&lt!=null&&mt?.(!1)&&C(lt)", "ut&&lt!=null&&__azraelRelease(mt,!1)&&C(lt)"],
  ["ze(),Xfa(te,Fe,e),l(st),t?.onAccepted()", "ze(),Xfa(te,Fe,e),__azraelClear(st),t?.onAccepted()"],
  ["mt?.(!0),mt=void 0,ut||l(st)", "__azraelRelease(mt,!0),mt=void 0,ut||__azraelClear(st)"],
  ["if(mt?.(!0),mt=void 0,D", "if(__azraelRelease(mt,!0),mt=void 0,D"],
  ["!ut&&!Te&&l(st)", "!ut&&!Te&&__azraelClear(st)"],
  ["ft=!0,mt?.(!1),ut||", "ft=!0,__azraelRelease(mt,!1),ut||"],
  // Always unsubscribe; an older callback must never remove another submission's
  // retained atom. Abandoning ownership releases only its own retained reference.
  ["return t=>{if(o(),e.get(lG)!==a)return!1;let s=crr(e)", "return(t,__azraelOwns=!0)=>{if(o(),e.get(lG)!==a)return!1;if(!__azraelOwns){e.set(cG,n,void 0);return!1}let s=crr(e)"],
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
