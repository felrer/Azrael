"use strict";

const { BTW_MARKER, BTW_COMPOSER_ADMISSION_ANCHOR, BTW_COMPOSER_ADMISSION_REPLACEMENT } = require("./inject-btw.cjs");

const COMPOSER_DRAFT_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const MARKER = "/*azrael-composer-draft-v5*/";
// Read the same editable payload used by the pinned host. Clone it immediately:
// attachment edits may mutate objects while preparation is awaiting native RPC.
const SNAPSHOT = `${MARKER}function __azraelComposerSnapshot(e,h){let n=e.get(QG),jee={};for(let Cee of ["imageAttachments","imageCommentDrafts","appshotContexts","fileAttachments","pastedTextAttachments","uploadedFileAttachments","addedFiles","mcpAppModelContextAttachments","selectedTextAttachments","responseTextAnnotations","pullRequestMergeConflict","attachmentOrder"])jee[Cee]=n[Cee];return JSON.parse(JSON.stringify({key:g_(e.value),text:h.getText(),persistedText:h.getPersistedText(),draft:PG(e.get(RG.drafts$)[g_(e.value)]),attachments:jee,selections:[e.get(uK),e.get(OW),e.get(DW),e.get(iW),e.get(lW,jnt(e.value)),e.get(SW),e.get(xW)],apps:[h.getMentionedComputerUseApps?.(),h.getMentionedBrowserFamilies?.(),h.getComputerUseAppMentions?.()]}))}function __azraelComposerMatches(e,h,Nee){return Nee!=null&&(0,IG.default)(__azraelComposerSnapshot(e,h),Nee)}`;

// Reuse the native document-change subscription. Selection, host broadcasts and
// draft metadata are not edits; a user typing the same text again is an edit.
function __azraelComposerTrack(controller) {
  let revision = 0, clearing = false;
  const unsubscribe = $U(controller.view, changed => { if (changed && !clearing) revision++; });
  return {
    get revision() { return revision; },
    clear(action) { clearing = true; try { return action(); } finally { clearing = false; } },
    [Symbol.dispose]() { unsubscribe(); },
  };
}

function __azraelComposerEditableMatches(scope, controller, submitted) {
  const current = __azraelComposerSnapshot(scope, controller);
  delete current.draft;
  const { draft, ...editable } = submitted;
  return (0, IG.default)(current, editable);
}

// Consume only this submission's text. Keep changed non-text draft fields and
// use native expectedValue updates so a newer saved value cannot be overwritten.
function __azraelComposerConsumeSaved(scope, submitted) {
  const key = g_(scope.value);
  if (key !== submitted.key) return;
  const alias = scope.value.kind === "local" && scope.value.conversationId != null ? d_(scope.value.conversationId) : null;
  const records = scope.get(RG.drafts$);
  for (const draftKey of alias == null || alias === key ? [key] : [key, alias]) {
    const raw = records[draftKey], draft = PG(raw);
    if (draft == null || FG(draft.prompt) !== submitted.persistedText) continue;
    const remaining = { prompt: "", pullRequestChecks: [] };
    for (const field of Object.keys(draft)) {
      if (field !== "prompt" && !(0, IG.default)(draft[field], submitted.draft?.[field])) remaining[field] = draft[field];
    }
    RG.setDraft(scope, [draftKey], abr(remaining, "") ? remaining : void 0, raw);
  }
}

const HELPERS = `${__azraelComposerTrack.toString()}${__azraelComposerEditableMatches.toString()}${__azraelComposerConsumeSaved.toString()}`;

const edits = [
  // Local custody stays visible through preparation and native dispatch. An
  // optimistic opening-input ID is not evidence that the conversation renders
  // the input. Accepted removal belongs to the queue coordinator.
  ["return n.filter(e=>!xyr(e)&&!r.includes(xv(e))&&(e.submissionIntent!==`send-now`||e.pausedReason!=null||e.submission?.status===`outcome-unknown`||t(Cyr,e.createdAt)))", "return n.filter(e=>e.pausedReason!=null||e.submission?.status===`pending`||e.submission?.status===`sending`||e.submission?.status===`queued`||e.submission?.status===`outcome-unknown`||!xyr(e)&&!r.includes(xv(e))&&(e.submissionIntent!==`send-now`||e.pausedReason!=null||e.submission?.status===`outcome-unknown`||t(Cyr,e.createdAt)))"],
  ["async function zMa({", SNAPSHOT + HELPERS + "async function zMa({"],
  [BTW_COMPOSER_ADMISSION_ANCHOR, "let __azraelSubmitted=__azraelComposerSnapshot(e,p),__azraelCleared,__azraelTracker=de.u(__azraelComposerTrack(p)),__azraelRevision=__azraelTracker.revision;const __azraelOwnsText=()=>__azraelTracker.revision===__azraelRevision&&g_(e.value)===__azraelSubmitted.key&&p.getText()===__azraelSubmitted.text&&p.getPersistedText()===__azraelSubmitted.persistedText,__azraelOwns=()=>__azraelOwnsText()&&__azraelComposerMatches(e,p,__azraelSubmitted),__azraelClear=n=>{if(!__azraelOwnsText())return!1;__azraelTracker.clear(()=>__azraelComposerEditableMatches(e,p,__azraelSubmitted)?u(n):p.setText(``));__azraelCleared=__azraelComposerSnapshot(e,p);return!0},__azraelAcceptedClear=n=>{let cleared=__azraelClear(n);cleared&&__azraelComposerConsumeSaved(e,__azraelSubmitted);return cleared},__azraelRelease=(l,Ik)=>l?.(Ik,__azraelTracker.revision===__azraelRevision&&__azraelComposerMatches(e,p,__azraelCleared),__azraelTracker.revision===__azraelRevision&&__azraelCleared!=null&&g_(e.value)===__azraelCleared.key&&p.getText()===__azraelCleared.text&&p.getPersistedText()===__azraelCleared.persistedText,__azraelSubmitted);" + BTW_COMPOSER_ADMISSION_ANCHOR],
  ["await U(ze)&&(u(),t=ye&&ze.length>0)", "await U(ze)&&(__azraelAcceptedClear(),t=ye&&ze.length>0)"],
  ["mt||(ht=Fe&&e?.optimisticSteer===!0,vt=T({clearSavedDraft:ht}),mt=!0,u(ut),ie(!1),ye&&v())", "mt||(ht=Fe&&e?.optimisticSteer===!0,vt=__azraelOwnsText()?T({clearSavedDraft:ht&&__azraelOwns()}):void 0,mt=!0,__azraelClear(ut),ie(!1),ye&&v())"],
  ["(vt(!0),vt=void 0,We()", "(__azraelRelease(vt,!0),vt=void 0,We()"],
  ["mt&&pt!=null&&vt?.(!1)&&w(n==null?pt:{...pt,context:{...pt.context,worktreeRecovery:n}})", "mt&&pt!=null&&__azraelRelease(vt,!1)&&w(n==null?pt:{...pt,context:{...pt.context,worktreeRecovery:n}})"],
  ["He(),VMa(G,Re,e),u(ut),t?.onAccepted()", "He(),VMa(G,Re,e),__azraelAcceptedClear(ut),t?.onAccepted()"],
  ["vt?.(!0),vt=void 0,mt||u(ut)", "__azraelRelease(vt,!0),vt=void 0,mt||__azraelAcceptedClear(ut)"],
  ["if(vt?.(!0),vt=void 0,O", "if(__azraelRelease(vt,!0),vt=void 0,O"],
  ["!mt&&!Oe&&u(ut)", "!mt&&!Oe&&__azraelAcceptedClear(ut)"],
  ["gt=!0,vt?.(!1),mt||", "gt=!0,__azraelRelease(vt,!1),mt||"],
  // A successful release must not rehydrate an old saved prompt through xMa.
  // Failed submissions still restore only while the editable state is owned.
  ["let a={draft:PG(e.get(RG.drafts$)[n])};e.set(UG,n,a)", "let a={draft:PG(e.get(RG.drafts$)[n]),__azraelRestoreAllowed:!1};e.set(UG,n,a)"],
  ["return t=>{if(o(),e.get(WG)!==a)return!1;let s=cbr(e)", "return(t,__azraelOwns=!0,__azraelCanDiscard=!1,__azraelSubmitted)=>{if(o(),e.get(WG)!==a){t&&__azraelCanDiscard&&__azraelSubmitted&&e.get(WG)==null&&__azraelComposerConsumeSaved(e,__azraelSubmitted);return!1}a.__azraelRestoreAllowed=!t&&__azraelOwns;if(t&&__azraelSubmitted){__azraelCanDiscard&&__azraelComposerConsumeSaved(e,__azraelSubmitted);e.set(UG,n,void 0);return!1}if(!__azraelOwns){e.set(UG,n,void 0);return!1}let s=cbr(e)"],
  ["else if(t.get(WG)!=null)return;e=!1;let n=Lyr(l);", "else if(t.get(WG)!=null)return;e=!1;if(f.__azraelRestoreAllowed===!1)return;let n=Lyr(l);"],
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
  if (/\/\*azrael-composer-draft-v[1234]\*\//.test(text)) throw new Error("Outdated composer draft injection; use the original pinned asset.");
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
