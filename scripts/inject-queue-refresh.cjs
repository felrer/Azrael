"use strict";

const QUEUE_REFRESH_ASSET = "webview/assets/app-initial-532d60c9b397.js";
// The stable upstream coordinator now implements the invalidation algorithm.
// Pin each native boundary instead of adding a second dirty set.
const NATIVE_QUEUE_REFRESH_ANCHORS = Object.freeze([
  "function wen({scope:e,manager:t,appServerVersion:n}){let r=t.getHostId(),i=kO(r),a=new Map,o=new Map,s=new Set,c=new Set,l=!1",
  "p=async(e,n)=>{let r=o.get(e);if(r!=null){s.add(e),await r,n?.afterMutation&&await p(e);return}",
  "do{s.delete(e),r=a.get(e)?.items,n=[];let i=null;do{let r=await t.sendRequest(`thread/queue/list`,{threadId:e,cursor:i});n.push(...r.data),i=r.nextCursor}while(i!=null)}while(!l&&(a.get(e)?.items!==r||s.has(e)));if(l)return;",
  "})().finally(()=>{o.delete(e),s.delete(e)});o.set(e,i),await i}",
]);
function injectQueueRefresh(text) {
  for (const anchor of NATIVE_QUEUE_REFRESH_ANCHORS) {
    const found = text.split(anchor).length - 1;
    if (found !== 1) throw new Error(`Pinned native queue-refresh anchor must occur exactly once: found ${found}`);
  }
  return { text, count: 0, nativeChecks: 1 };
}
module.exports = { QUEUE_REFRESH_ASSET, NATIVE_QUEUE_REFRESH_ANCHORS, injectQueueRefresh };
