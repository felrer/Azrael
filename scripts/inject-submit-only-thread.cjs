"use strict";

const ASSET = "webview/assets/app-initial-97d3534ad35f.js";
const MARKER = "/*azrael-submit-only-thread-v1*/";
// Both local and cloud-prototype composer prewarming reach this shared boundary.
// Draft persistence and normal createConversation/prepareThreadStart stay native.
const ORIGINAL = "prewarmConversation(e,t){let n=this.getRequestedThreadHistoryMode(`default`);if(this.params.prewarmedThreadManager.hasPrewarmedThread(e.cwd,e.workspaceRoots,e.serviceName,n))return t[Symbol.dispose]?.(),Promise.resolve(null);let r=(async()=>{let r;try{return r=await t(e,n),r==null?null:await new N1({...this.params,inputs:r}).preparePrewarm(e,n)}finally{r?.[Symbol.dispose]?.(),t[Symbol.dispose]?.()}})(),i=(async()=>{try{let e=await r;if(e==null)return null;let t=await this.params.requestClient.prewarmThreadStart(e.start.request,e.start.options);return this.params.setThreadReferencesSupported(B(t.thread.id),ln(e.start.request)),{response:t,shellEnvironmentPolicy:e.start.shellEnvironmentPolicy}}catch(t){if(this.params.logger.warning(`Failed to prewarm conversation`,{safe:{},sensitive:{cwd:e.cwd,error:t}}),t instanceof Ft&&t.delivery.stage===`outcome-unknown`)throw t;return null}})();return this.params.prewarmedThreadManager.setPrewarmedThreadPromise(e.cwd,e.workspaceRoots,e.serviceName,n,i,r.then(e=>e?.permissionsConfig??null,()=>null),r.then(e=>e?.instructionOverrides??null,()=>null),e.defaultFeatureOverrides,e.cloudThreadPrototype?r.then(e=>e?.start??null,()=>null):null),i.then(e=>e?.response??null)}";
const PATCHED = "prewarmConversation(e,t){return t[Symbol.dispose]?.(),Promise.resolve(null)}";
const count = (text, token) => text.split(token).length - 1;

function injectSubmitOnlyThread(text, asset) {
  if (asset !== ASSET) return { text, count: 0 };
  if (count(text, MARKER)) {
    if (count(text, MARKER) !== 1 || count(text, PATCHED) !== 1 || count(text, ORIGINAL)) {
      throw new Error("Damaged submit-only thread transformation");
    }
    return { text, count: 0 };
  }
  if (count(text, ORIGINAL) !== 1 || count(text, PATCHED)) {
    throw new Error("Pinned submit-only thread anchor must occur exactly once");
  }
  return { text: text.replace(ORIGINAL, PATCHED) + `\n${MARKER}\n`, count: 1 };
}

module.exports = { ASSET, MARKER, ORIGINAL, PATCHED, injectSubmitOnlyThread };
