"use strict";

const PAGINATED_HISTORY_ASSET = "webview/assets/app-initial-efe028fd535e.js";
const PAGINATED_HISTORY_MARKER = "/*azrael-paginated-history-v1*/";
const ORIGINAL = "function wTn(e,t,n,r){let i=e;return(t==null||typeof t.approvalPolicy==`object`&&`granular`in t.approvalPolicy)&&(i={...e,config:{...e.config,\"features.request_permissions_tool\":!0}}),i.ephemeral!==!0&&(n===`paginated`||yt(r,`defaultPaginatedHistory`))?{...i,historyMode:n}:i}";
const PATCHED = ORIGINAL.replace("i.ephemeral!==!0&&(n===`paginated`||yt(r,`defaultPaginatedHistory`))?{...i,historyMode:n}:i", 'i.ephemeral!==!0?{...i,historyMode:`paginated`}:i');

function occurrences(text, value) {
  return text.split(value).length - 1;
}

function injectPaginatedHistory(text, asset) {
  if (asset !== PAGINATED_HISTORY_ASSET) return { text, count: 0 };
  const markers = occurrences(text, PAGINATED_HISTORY_MARKER);
  if (markers > 1) throw new Error("Duplicate paginated history marker");
  if (markers === 1) {
    if (occurrences(text, PATCHED) !== 1 || occurrences(text, ORIGINAL) !== 0) {
      throw new Error("Damaged paginated history anchor in marked asset");
    }
    return { text, count: 0 };
  }
  const anchors = occurrences(text, ORIGINAL);
  if (anchors !== 1 || occurrences(text, PATCHED) !== 0) {
    throw new Error(`Paginated history anchor must occur once (found ${anchors})`);
  }
  return { text: text.replace(ORIGINAL, PATCHED) + `\n${PAGINATED_HISTORY_MARKER}\n`, count: 1 };
}

module.exports = { PAGINATED_HISTORY_ASSET, PAGINATED_HISTORY_MARKER, injectPaginatedHistory };
