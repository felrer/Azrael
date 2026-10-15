"use strict";

const QUEUE_CONSUMPTION_ASSET = "webview/assets/app-initial-97d3534ad35f.js";
const QUEUE_CONSUMPTION_MARKER = "/*azrael-queue-consumption-v3*/";

// Both legacy and metadata-bearing local messages share acceptance receipts.
// Keep a receipt for accepted IDs for this coordinator's lifetime: stale storage
// snapshots must not make accepted input eligible again. Persist removal before
// releasing the existing host send lock. Never deduplicate by message text.
// A locally accepted handle belongs to the queue, even when native dispatch
// fails or loses admission. Complete that handle as queued without duplicating
// its draft or changing uncertain delivery; explicit send-now still rejects.
function injectQueueConsumption(text) {
  const count = text.split(QUEUE_CONSUMPTION_MARKER).length - 1;
  if (count > 1) throw new Error("Duplicate queue-consumption marker");
  if (/\/\*azrael-queue-consumption-v[12]\*\//.test(text)) throw new Error("Outdated queue-consumption marker; use the original pinned asset");
  const edits = [
    ["ljn=class extends DY{options;", "ljn=class extends DY{" + QUEUE_CONSUMPTION_MARKER + "__azraelAccepted=new Map;__azraelUnsent(e,t){let n=this.__azraelAccepted.get(e);return n==null||t==null?t:t.filter(e=>!n.has(e.id))}__azraelWasAccepted(e,t){return t?.submission!=null&&(this.options.wasMessageAccepted?.(e,t.id)||this.serverQueue?.findByClientMessageId(e,t.id)!=null)}async __azraelConsume(e,t,n){if(this.disposed)return;let r=this.__azraelAccepted.get(e);r==null&&this.__azraelAccepted.set(e,r=new Set);r.add(t.id);this.running.has(e)&&this.rerun.add(e);await this.#v(e,e=>e.filter(e=>e.id!==t.id),n)}options;"],
    ["this.messages.clear(),this.pending.clear(),this.loadedState=void 0", "this.messages.clear(),this.__azraelAccepted.clear(),this.pending.clear(),this.loadedState=void 0"],
    ["b.status===`sent`&&(o=!0,this.disposed||this.mutate(e,e=>e.filter(e=>!(0,F1.default)(e,r)),u)),c.onResult?.(e,r,b)", "try{if(b.status===`sent`){o=!0;if(!this.disposed){await this.__azraelConsume(e,r,u)}}}finally{c.onResult?.(e,r,b)}"],
    ["n.pausedReason!=null&&n.submission?.status!==`sending`&&n.submission?.status!==`outcome-unknown`", "n.pausedReason!=null&&n.submission?.status!==`sending`&&n.submission?.status!==`outcome-unknown`&&!this.__azraelWasAccepted(e,n)"],
    ["async#l(e,t,n){if(t?.submission==null||t.submission.status===`pending`||t.submission.status===`queued`)return;let r=t.submission;this.options.wasMessageAccepted(e,t.id)||this.serverQueue?.findByClientMessageId(e,t.id)!=null?await this.#v(e,e=>e.filter(e=>!(0,F1.default)(e,t)),n)", "async#l(e,t,n){if(t?.submission==null)return;let r=t.submission;this.__azraelWasAccepted(e,t)?await this.__azraelConsume(e,t,n)"],
    ["a?.pausedReason==null||r.submission.status===`outcome-unknown`", "a?.pausedReason==null||r.submission.status===`outcome-unknown`||this.__azraelWasAccepted(e,r)"],
    ["if(!d()||r==null||!t.tryAcquireStartTurn(e)", "if(r!=null&&this.__azraelWasAccepted(e,r)){if(d(!1))await this.#l(e,r,u);return}if(!d()||r==null||!t.tryAcquireStartTurn(e)"],
    ["o=a.status===`sent`||a.serverAccepted===!0||this.serverQueue?.findByClientMessageId(e,t.id)!=null,o&&await this.#v(e,e=>e.filter(e=>!(0,F1.default)(e,r)),u),a.status===`sent`&&n?.operation.onResult?.(e,t,{status:`sent`,kind:`start`,turnId:a.turnId}),l?.result.resolve(a),this.accepted.get(e)?.get(t.id)===l&&this.#p(e,t.id);return", "o=a.status===`sent`||a.serverAccepted===!0||this.serverQueue?.findByClientMessageId(e,t.id)!=null;try{o&&await this.__azraelConsume(e,t,u)}finally{if(a.status===`sent`){n?.operation.onResult?.(e,t,{status:`sent`,kind:`start`,turnId:a.turnId}),l?.result.resolve(a),this.accepted.get(e)?.get(t.id)===l&&this.#p(e,t.id)}else await this.__azraelCompleteQueued(e,t,l)}return"],
    ["if(r?.submission!=null&&!this.disposed){", "if(r?.submission!=null&&!this.disposed&&!this.__azraelAccepted.get(e)?.has(r.id)){"],
    ["if(!o&&!this.disposed&&r!=null&&(n!=null||this.options.getStreamRole(e)?.role===`owner`)){", "if(!o&&!this.disposed&&r!=null&&!this.__azraelAccepted.get(e)?.has(r.id)&&(n!=null||this.options.getStreamRole(e)?.role===`owner`)){"],
    ["#m(e){let t=this.messages.get(e);if(t!=null)return t.messages;", "#m(e){let t=this.messages.get(e);if(t!=null)return this.__azraelUnsent(e,t.messages);"],
    ["return n.isLoading&&r==null?void 0:r?.[e]??I1", "return n.isLoading&&r==null?void 0:this.__azraelUnsent(e,r?.[e]??I1)"],
    ["return n};read=e=>{let t=this.readMessages(e);", "for(let[e,t]of Object.entries(n)){let r=this.__azraelUnsent(e,t);r.length===0?delete n[e]:n[e]=r}return n};read=e=>{let t=this.readMessages(e);"],
    ["let a=this.#m(e)??I1;", "let __azraelTransform=t;t=n=>this.__azraelUnsent(e,__azraelTransform(n));let a=this.#m(e)??I1;"],
    ["#y(e,t){this.messages.set(e,{messages:t,refreshing:!1})", "#y(e,t){this.messages.set(e,{messages:this.__azraelUnsent(e,t),refreshing:!1})"],
    ["#p(e,t){let n=this.accepted.get(e);", "async __azraelCompleteQueued(e,t,n){if(n==null)return;try{let r=this.#m(e)?.find(e=>e.id===t.id);if(r?.submission?.status===`pending`&&this.options.getStreamRole(e)?.role===`owner`)await this.#v(e,e=>e.map(e=>e.id===r.id&&e.submission?.status===`pending`?{...e,submission:{...e.submission,status:`queued`}}:e),`owner`)}catch(t){this.options.logger.warning(`Failed to persist locally accepted queue result`,{safe:{},sensitive:{conversationId:e,error:t}})}finally{n.result.resolve({status:`queued`,messageId:t.id}),this.accepted.get(e)?.get(t.id)===n&&this.#p(e,t.id)}}#p(e,t){let n=this.accepted.get(e);"],
    ["finally{l?.result.reject(i),this.accepted.get(e)?.get(r.id)===l&&this.#p(e,r.id)}return", "finally{await this.__azraelCompleteQueued(e,r,l)}if(n!=null)throw i;return"],
    ["if(r?.submission?.status===`sending`&&this.options.getStreamRole(e)?.role===`owner`)", "if(r?.submission!=null&&r.submission.status!==`outcome-unknown`&&this.options.getStreamRole(e)?.role===`owner`)"],
    ["submission:{...e.submission,status:`pending`}}:e),u)}s&&r!=null", "submission:{...e.submission,status:`queued`}}:e),u)}s&&r!=null"],
    ["finally{try{await a?.release(o)}", "finally{r!=null&&await this.__azraelCompleteQueued(e,r,this.accepted.get(e)?.get(r.id));try{await a?.release(o)}"],
    ["await this.#v(e,e=>a!=null&&!e.some(e=>(0,F1.default)(e,t))?e:this.#r(e,{...t,submission:t.submission==null&&!this.#g(t)?void 0:{hostId:this.options.hostId,...t.submission,status:`queued`,queueModeOverride:`queue`,editPosition:n}},n)", "await this.#v(e,i=>a!=null&&!i.some(e=>(0,F1.default)(e,t))?i:this.__azraelQueuePosition(e,i,{...t,submission:t.submission==null&&!this.#g(t)?void 0:{hostId:this.options.hostId,...t.submission,status:`queued`,queueModeOverride:`queue`,editPosition:n}},n)"],
    ["#r(e,t,n){if(n==null)", "__azraelQueuePosition(e,t,n,r){return this.accepted.get(e)?.has(n.id)&&t.some(e=>e.id===n.id)?t.map(e=>e.id===n.id?n:e):this.#r(t,n,r)}#r(e,t,n){if(n==null)"],
  ];
  if (count === 1) {
    for (const [, replacement] of edits) {
      if (text.split(replacement).length - 1 !== 1) throw new Error("Partial queue-consumption injection");
    }
    return { text, count: 0 };
  }
  for (const [anchor, replacement] of edits) {
    const found = text.split(anchor).length - 1;
    if (found !== 1) throw new Error(`Pinned queue-consumption anchor must occur exactly once: found ${found}: ${anchor.slice(0, 90)}`);
    text = text.replace(anchor, replacement);
  }
  return { text, count: 1 };
}

module.exports = { QUEUE_CONSUMPTION_ASSET, QUEUE_CONSUMPTION_MARKER, injectQueueConsumption };
