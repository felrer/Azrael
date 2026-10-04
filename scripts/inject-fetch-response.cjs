"use strict";

const MARKER = "/*azrael-fetch-response-v1*/";
const ANCHOR = "bodyJsonString:JSON.stringify(o)";
const NORMALIZED_ANCHOR = "bodyJsonString:JSON.stringify(o===void 0?null:o)";
// Pin the native VS Code success envelope as well as the unique serializer.
const ENVELOPE = 'return{type:"fetch-response",responseType:"success",requestId:e.requestId,status:200,headers:{},';
const TAIL = '}}throw new Error("HTTP requests must use the HTTP fetch service.")';
const ORIGINAL = ENVELOPE + ANCHOR + TAIL;
const PATCHED = ENVELOPE + NORMALIZED_ANCHOR + MARKER + TAIL;
const occurrences = (text, value) => text.split(value).length - 1;

function injectFetchResponse(text) {
  const originalCount = occurrences(text, ANCHOR);
  const normalizedCount = occurrences(text, NORMALIZED_ANCHOR);
  const markers = occurrences(text, MARKER);
  if (markers === 1 && originalCount === 0 && normalizedCount === 1 && occurrences(text, PATCHED) === 1) {
    return { text, count: 0 };
  }
  if (markers || normalizedCount) throw new Error("Invalid pinned fetch-response normalization marker or envelope");
  if (originalCount !== 1 || occurrences(text, ORIGINAL) !== 1) {
    throw new Error(`Pinned fetch-response success serializer must occur exactly once in its envelope: found ${originalCount}`);
  }
  return { text: text.replace(ORIGINAL, PATCHED), count: 1 };
}

module.exports = { MARKER, ANCHOR, NORMALIZED_ANCHOR, injectFetchResponse };
