"use strict";

// Applied after injectDeferredTurnView. Keep native disclosure state and keys;
// only the stopped projection's eligibility changes.
const WORK_SEGMENT_FOLDING_ASSET = "webview/assets/local-conversation-turn-9fb266d5c020.js";
const WORK_SEGMENT_FOLDING_ACTIVITY_ASSET = "webview/assets/sites-end-resource-90d3046b3014.js";
const edits = [
  ["if(la){let e=ga(Ya,{includeGeneratedImages:!0,mcpServerStatuses:zi,groupStartItems:ln})",
    "if(la){let azraelStoppedFold=(l===`terminal`||b.status===`deferred`&&!K)&&xn==null&&(Cn==null||Cn.completed)&&!wn.some(ic)&&!Dn.some(rc);let e=ga(Ya,{includeGeneratedImages:!0,mcpServerStatuses:zi,groupStartItems:ln})"],
  ["allowCollapseBeforeFinal:Pt,units:t", "allowCollapseBeforeFinal:Pt||azraelStoppedFold,units:t"],
  ["forceExpanded:G||!Pt&&$e!==`off`&&(U||A!=null&&j!=null&&A>=j-1)",
    "forceExpanded:G||!azraelStoppedFold&&!Pt&&$e!==`off`&&(U||A!=null&&j!=null&&A>=j-1)"],
  ["disableCollapse:l!=null||G||Pe", "disableCollapse:l!=null&&!azraelStoppedFold||G||Pe"],
  ["preventAutoCollapse:Pt&&K||Qe||fr", "preventAutoCollapse:azraelStoppedFold||Pt&&K||Qe||fr"],
  ["sa=o??ft??(0,wc.default)(Ji,tc)??null",
    "sa=o??ft??(0,wc.default)(Ji,e=>tc(e)&&e.rootResumeWait==null&&e.status!==`azraelWaitUnknown`)??null"],
];

function injectWorkSegmentFolding(text) {
  if (text.includes("azraelStoppedFold")) throw new Error("Pinned work-segment folding already transformed or tampered.");
  // Verify every original before any edit, and every replacement afterwards.
  for (const [anchor, replacement] of edits) {
    if (text.split(anchor).length !== 2 || text.includes(replacement))
      throw new Error("Pinned work-segment folding anchor must occur exactly once: " + anchor);
  }
  for (const [anchor, replacement] of edits) text = text.replace(anchor, replacement);
  for (const [anchor, replacement] of edits) {
    if (text.includes(anchor) || text.split(replacement).length !== 2)
      throw new Error("Pinned work-segment folding replacement verification failed: " + anchor);
  }
  return { text, count: edits.length };
}

function injectWorkSegmentWaiting(text) {
  const anchor = "if(l.kind===`standalone`&&l.item.item.type===`worked-for`){c=l.item.item;continue}";
  const replacement = "if(l.kind===`standalone`&&l.item.item.type===`worked-for`){if(l.item.item.rootResumeWait!=null||l.item.item.status===`azraelWaitUnknown`){a.push(l);o.push(l);continue}c=l.item.item;continue}";
  if (text.split(anchor).length !== 2 || text.includes(replacement))
    throw new Error("Pinned work-segment waiting anchor must occur exactly once.");
  text = text.replace(anchor, replacement);
  if (text.includes(anchor) || text.split(replacement).length !== 2)
    throw new Error("Pinned work-segment waiting replacement verification failed.");
  return { text, count: 1 };
}

module.exports = { WORK_SEGMENT_FOLDING_ASSET, WORK_SEGMENT_FOLDING_ACTIVITY_ASSET,
  injectWorkSegmentFolding, injectWorkSegmentWaiting };
