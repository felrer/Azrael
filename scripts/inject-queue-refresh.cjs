"use strict";
const { ACCOUNT_QUEUE_PRESENTATION_PREFIX, ACCOUNT_QUEUE_PRESENTATION_MARKER, ACCOUNT_QUEUE_PRESENTATION_PRELUDE } = require("./inject-account-switch-queue.cjs");

const QUEUE_REFRESH_ASSET = "webview/assets/app-initial-7a199c66e670.js";
// The stable upstream coordinator now implements the invalidation algorithm.
// Pin each native boundary instead of adding a second dirty set.
const NATIVE_QUEUE_REFRESH_ANCHORS = Object.freeze([
  "function vsn({scope:e,manager:t,appServerVersion:n}){let r=t.getHostId(),i=AE(r),a=new Map,o=new Map,s=new Set,c=new Set,l=!1",
  "m=async(e,n)=>{let r=o.get(e);if(r!=null){s.add(e),await r,n?.afterMutation&&await m(e);return}",
  "do{s.delete(e),r=a.get(e)?.items,n=[];let i=null;do{let r=await t.sendRequest(`thread/queue/list`,{threadId:e,cursor:i});n.push(...r.data),i=r.nextCursor}while(i!=null)}while(!l&&(a.get(e)?.items!==r||s.has(e)));if(l)return;",
  "})().finally(()=>{o.delete(e),s.delete(e)});o.set(e,i),await i}",
]);
function injectQueueRefresh(text) {
  let nativeText = text;
  const count = value => text.split(value).length - 1;
  if (count(ACCOUNT_QUEUE_PRESENTATION_PREFIX) !== 1) throw new Error("Pinned native queue-refresh function prefix must occur exactly once");
  const markers = count(ACCOUNT_QUEUE_PRESENTATION_MARKER);
  if (markers !== 0) {
    const transformedPrefix = ACCOUNT_QUEUE_PRESENTATION_PREFIX + ACCOUNT_QUEUE_PRESENTATION_PRELUDE;
    if (markers !== 1 || count(ACCOUNT_QUEUE_PRESENTATION_PRELUDE) !== 1 || count(transformedPrefix) !== 1) {
      throw new Error("Pinned native queue-refresh presentation prelude is malformed or duplicated");
    }
    nativeText = text.replace(transformedPrefix, ACCOUNT_QUEUE_PRESENTATION_PREFIX);
  }
  for (const anchor of NATIVE_QUEUE_REFRESH_ANCHORS) {
    const found = nativeText.split(anchor).length - 1;
    if (found !== 1) throw new Error(`Pinned native queue-refresh anchor must occur exactly once: found ${found}`);
  }
  return { text, count: 0, nativeChecks: 1 };
}
module.exports = { QUEUE_REFRESH_ASSET, NATIVE_QUEUE_REFRESH_ANCHORS, injectQueueRefresh };
