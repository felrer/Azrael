"use strict";

// A retryable error belongs to the turn that received it. When the host
// reports that context compaction has resumed, remove only those transient
// rows before the native reducer upserts the in-progress compaction item.
const COMPACTION_PROGRESS_REDUCER_ASSET = "webview/assets/app-initial-9f7d97690e9b.js";
const COMPACTION_PROGRESS_MARKER = "/*azrael-compaction-progress-v2*/";
const ITEM_STARTED_ANCHOR =
  "let d=xr(u.type===`contextCompaction`?{...u,completed:!1,startedAtMs:c,source:a.manualContextCompactions.consumeSource(l)}:u);" +
  "u.type===`contextCompaction`&&a.manualContextCompactions.removePendingItemFromTurn(r),gh(r,d)";

function injectCompactionProgress(text) {
  const markerCount = text.split(COMPACTION_PROGRESS_MARKER).length - 1;
  if (markerCount === 1) return { text, count: 0 };
  if (markerCount !== 0) {
    throw new Error(`Pinned compaction-progress marker must occur at most once: found ${markerCount}.`);
  }
  const anchorCount = text.split(ITEM_STARTED_ANCHOR).length - 1;
  if (anchorCount !== 1) {
    throw new Error(`Pinned compaction-progress anchor must occur exactly once: found ${anchorCount}.`);
  }
  const replacement =
    "let __azraelCompactionProgressExisting=u.type===`contextCompaction`?r.items.find(e=>e.type===`contextCompaction`&&e.id===u.id):null;" +
    "let d=xr(u.type===`contextCompaction`?{...u,completed:!1,startedAtMs:c,source:__azraelCompactionProgressExisting!=null?" +
    "__azraelCompactionProgressExisting.source??`automatic`:a.manualContextCompactions.consumeSource(l)}:u);" +
    "u.type===`contextCompaction`&&(r.items=r.items.filter(e=>e.type!==`error`||e.willRetry!==!0)," +
    COMPACTION_PROGRESS_MARKER +
    "a.manualContextCompactions.removePendingItemFromTurn(r)),gh(r,d)";
  return { text: text.replace(ITEM_STARTED_ANCHOR, replacement), count: 1 };
}

module.exports = {
  COMPACTION_PROGRESS_MARKER,
  COMPACTION_PROGRESS_REDUCER_ASSET,
  injectCompactionProgress,
};
