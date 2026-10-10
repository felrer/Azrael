"use strict";

const { BTW_MARKER, BTW_COMPOSER_ADMISSION_ANCHOR, BTW_COMPOSER_ADMISSION_REPLACEMENT } = require("./inject-btw.cjs");

const COMPOSER_DRAFT_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const MARKER = "/*azrael-composer-draft-v3*/";
// Read the same editable payload used by the pinned host. Clone it immediately:
// attachment edits may mutate objects while preparation is awaiting native RPC.
const SNAPSHOT = `${MARKER}function __azraelComposerSnapshot(e,h){let n=e.get(QG),jee={};for(let Cee of ["imageAttachments","imageCommentDrafts","appshotContexts","fileAttachments","pastedTextAttachments","uploadedFileAttachments","addedFiles","mcpAppModelContextAttachments","selectedTextAttachments","responseTextAnnotations","pullRequestMergeConflict","attachmentOrder"])jee[Cee]=n[Cee];return JSON.parse(JSON.stringify({key:g_(e.value),text:h.getText(),persistedText:h.getPersistedText(),draft:PG(e.get(RG.drafts$)[g_(e.value)]),attachments:jee,selections:[e.get(uK),e.get(OW),e.get(DW),e.get(iW),e.get(lW,jnt(e.value)),e.get(SW),e.get(xW)],apps:[h.getMentionedComputerUseApps?.(),h.getMentionedBrowserFamilies?.(),h.getComputerUseAppMentions?.()]}))}function __azraelComposerMatches(e,h,Nee){return Nee!=null&&(0,IG.default)(__azraelComposerSnapshot(e,h),Nee)}`;

const edits = [
  // Local custody stays visible through preparation and native dispatch. An
  // optimistic opening-input ID is not evidence that the conversation renders
  // the input. Accepted removal belongs to the queue coordinator.
  ["return n.filter(e=>!xyr(e)&&!r.includes(xv(e))&&(e.submissionIntent!==`send-now`||e.pausedReason!=null||e.submission?.status===`outcome-unknown`||t(Cyr,e.createdAt)))", "return n.filter(e=>e.pausedReason!=null||e.submission?.status===`pending`||e.submission?.status===`sending`||e.submission?.status===`queued`||e.submission?.status===`outcome-unknown`||!xyr(e)&&!r.includes(xv(e))&&(e.submissionIntent!==`send-now`||e.pausedReason!=null||e.submission?.status===`outcome-unknown`||t(Cyr,e.createdAt)))"],
  ["async function zMa({", SNAPSHOT + "async function zMa({"],
  [BTW_COMPOSER_ADMISSION_ANCHOR, "let __azraelSubmitted=__azraelComposerSnapshot(e,p),__azraelCleared;const __azraelOwns=()=>__azraelComposerMatches(e,p,__azraelSubmitted),__azraelClear=n=>{if(!__azraelOwns())return!1;u(n);__azraelCleared=__azraelComposerSnapshot(e,p);return!0},__azraelRelease=(l,Ik)=>l?.(Ik,__azraelComposerMatches(e,p,__azraelCleared));" + BTW_COMPOSER_ADMISSION_ANCHOR],
  ["await U(ze)&&(u(),t=ye&&ze.length>0)", "await U(ze)&&(__azraelClear(),t=ye&&ze.length>0)"],
  ["mt||(ht=Fe&&e?.optimisticSteer===!0,vt=T({clearSavedDraft:ht}),mt=!0,u(ut),ie(!1),ye&&v())", "mt||(ht=Fe&&e?.optimisticSteer===!0,vt=__azraelOwns()?T({clearSavedDraft:ht}):void 0,mt=!0,__azraelClear(ut),ie(!1),ye&&v())"],
  ["(vt(!0),vt=void 0,We()", "(__azraelRelease(vt,!0),vt=void 0,We()"],
  ["mt&&pt!=null&&vt?.(!1)&&w(n==null?pt:{...pt,context:{...pt.context,worktreeRecovery:n}})", "mt&&pt!=null&&__azraelRelease(vt,!1)&&w(n==null?pt:{...pt,context:{...pt.context,worktreeRecovery:n}})"],
  ["He(),VMa(G,Re,e),u(ut),t?.onAccepted()", "He(),VMa(G,Re,e),__azraelClear(ut),t?.onAccepted()"],
  ["vt?.(!0),vt=void 0,mt||u(ut)", "__azraelRelease(vt,!0),vt=void 0,mt||__azraelClear(ut)"],
  ["if(vt?.(!0),vt=void 0,O", "if(__azraelRelease(vt,!0),vt=void 0,O"],
  ["!mt&&!Oe&&u(ut)", "!mt&&!Oe&&__azraelClear(ut)"],
  ["gt=!0,vt?.(!1),mt||", "gt=!0,__azraelRelease(vt,!1),mt||"],
  // Always unsubscribe; an older callback must never remove another submission's
  // retained atom. Abandoning ownership releases only its own retained reference.
  ["return t=>{if(o(),e.get(WG)!==a)return!1;let s=cbr(e)", "return(t,__azraelOwns=!0)=>{if(o(),e.get(WG)!==a)return!1;if(!__azraelOwns){e.set(UG,n,void 0);return!1}let s=cbr(e)"],
];

const count = (text, token) => text.split(token).length - 1;
function validReplacement(text, anchor, replacement) {
  if (anchor !== BTW_COMPOSER_ADMISSION_ANCHOR) return count(text, replacement) === 1;
  const composed = replacement.replace(BTW_COMPOSER_ADMISSION_ANCHOR, BTW_COMPOSER_ADMISSION_REPLACEMENT);
  const originalCount = count(text, replacement), composedCount = count(text, composed), markers = count(text, BTW_MARKER);
  return originalCount === 1 && composedCount === 0 && markers === 0 ||
    originalCount === 0 && composedCount === 1 && markers === 1;
}
function injectComposerDraft(text) {
  if (/\/\*azrael-composer-draft-v[12]\*\//.test(text)) throw new Error("Outdated composer draft injection; use the original pinned asset.");
  if (count(text, MARKER)) {
    if (count(text, MARKER) !== 1 || edits.some(([anchor, replacement]) => !validReplacement(text, anchor, replacement))) {
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
