"use strict";

const PAGINATED_HISTORY_ASSET = "webview/assets/app-initial-97d3534ad35f.js";
const PAGINATED_HISTORY_MARKER = "/*azrael-paginated-history-v2*/";
const PREVIOUS_MARKER = "/*azrael-paginated-history-v1*/";
const ORIGINAL = "function CDn(e,t,n,r,i){let a=Te(e.config,r,i),o=a===e.config?e:{...e,config:a};return(t==null||typeof t.approvalPolicy==`object`&&`granular`in t.approvalPolicy)&&(o={...o,config:{...o.config,\"features.request_permissions_tool\":!0}}),o.ephemeral!==!0&&(n===`paginated`||On(r,`defaultPaginatedHistory`))?{...o,historyMode:n}:o}";
const PATCHED = ORIGINAL.replace("o.ephemeral!==!0&&(n===`paginated`||On(r,`defaultPaginatedHistory`))?{...o,historyMode:n}:o", "o.ephemeral!==!0?{...o,historyMode:`paginated`}:o");
const EARLY_HISTORY = 'ce&&le.then(async t=>{t?.thread.historyMode===`paginated`&&c()&&await rwn(e,{conversationId:f,initialPage:!0,isCurrentResumeAttempt:()=>!L&&c()&&e.getStreamRole(f)?.role!==`follower`,mapThreadTurns:o.mapThreadTurns,requestOptions:se,thread:t.thread,turnMergePolicy:o.turnMergePolicy,workspaceRoots:_})}).catch(t=>{e.logger.warning(`Failed to read early native history`,{safe:{},sensitive:{conversationId:f,error:t}})});';
const AFTER_RESUME_HISTORY = "/*azrael-history-after-resume*/";

function occurrences(text, value) {
  return text.split(value).length - 1;
}

function injectPaginatedHistory(text, asset) {
  if (asset !== PAGINATED_HISTORY_ASSET) return { text, count: 0 };
  if (occurrences(text, PREVIOUS_MARKER) !== 0) {
    throw new Error("Previous paginated history transform requires pristine input");
  }
  const markers = occurrences(text, PAGINATED_HISTORY_MARKER);
  if (markers > 1) throw new Error("Duplicate paginated history marker");
  if (markers === 1) {
    if (occurrences(text, PATCHED) !== 1 || occurrences(text, ORIGINAL) !== 0 ||
        occurrences(text, AFTER_RESUME_HISTORY) !== 1 || occurrences(text, EARLY_HISTORY) !== 0) {
      throw new Error("Damaged paginated history anchor in marked asset");
    }
    return { text, count: 0 };
  }
  const anchors = occurrences(text, ORIGINAL);
  if (anchors !== 1 || occurrences(text, PATCHED) !== 0 ||
      occurrences(text, EARLY_HISTORY) !== 1 || occurrences(text, AFTER_RESUME_HISTORY) !== 0) {
    throw new Error(`Paginated history anchor must occur once (found ${anchors})`);
  }
  // Keep metadata preparation, post-resume snapshot paging and conflict recovery.
  // Ordinal cursors do not prove that pre-resume body pages are still current.
  return { text: text.replace(ORIGINAL, PATCHED).replace(EARLY_HISTORY, AFTER_RESUME_HISTORY) + `\n${PAGINATED_HISTORY_MARKER}\n`, count: 1 };
}

module.exports = { PAGINATED_HISTORY_ASSET, PAGINATED_HISTORY_MARKER, injectPaginatedHistory };
