"use strict";

const QUEUE_CONSUMPTION_ASSET = "webview/assets/app-initial-9f7d97690e9b.js";
const QUEUE_CONSUMPTION_MARKER = "/*azrael-queue-consumption-v2*/";

// Both legacy and metadata-bearing local messages share acceptance receipts.
// Keep a receipt for accepted IDs for this coordinator's lifetime: stale storage
// snapshots must not make accepted input eligible again. Persist removal before
// releasing the existing host send lock. Never deduplicate by message text.
function injectQueueConsumption(text) {
  const count = text.split(QUEUE_CONSUMPTION_MARKER).length - 1;
  if (count > 1) throw new Error("Duplicate queue-consumption marker");
  if (text.includes("/*azrael-queue-consumption-v1*/")) throw new Error("Outdated queue-consumption marker; use the original pinned asset");
  const edits = [
    ["Mkn=class extends aJ{options;", "Mkn=class extends aJ{" + QUEUE_CONSUMPTION_MARKER + "__azraelAccepted=new Map;__azraelUnsent(e,t){let n=this.__azraelAccepted.get(e);return n==null||t==null?t:t.filter(e=>!n.has(e.id))}__azraelWasAccepted(e,t){return t?.submission!=null&&(this.options.wasMessageAccepted?.(e,t.id)||this.serverQueue?.findByClientMessageId(e,t.id)!=null)}async __azraelConsume(e,t,n){if(this.disposed)return;let r=this.__azraelAccepted.get(e);r==null&&this.__azraelAccepted.set(e,r=new Set);r.add(t.id);this.running.has(e)&&this.rerun.add(e);await this.#_(e,e=>e.filter(e=>e.id!==t.id),n)}options;"],
    ["this.messages.clear(),this.pending.clear(),this.loadedState=void 0", "this.messages.clear(),this.__azraelAccepted.clear(),this.pending.clear(),this.loadedState=void 0"],
    ["b.status===`sent`&&(o=!0,this.disposed||this.mutate(e,e=>e.filter(e=>!(0,QQ.default)(e,r)),u)),c.onResult?.(e,r,b)", "try{if(b.status===`sent`){o=!0;if(!this.disposed){await this.__azraelConsume(e,r,u)}}}finally{c.onResult?.(e,r,b)}"],
    ["n.pausedReason!=null&&n.submission?.status!==`sending`&&n.submission?.status!==`outcome-unknown`", "n.pausedReason!=null&&n.submission?.status!==`sending`&&n.submission?.status!==`outcome-unknown`&&!this.__azraelWasAccepted(e,n)"],
    ["async#c(e,t,n){if(t?.submission==null||t.submission.status===`pending`||t.submission.status===`queued`)return;let r=t.submission;this.options.wasMessageAccepted(e,t.id)||this.serverQueue?.findByClientMessageId(e,t.id)!=null?await this.#_(e,e=>e.filter(e=>!(0,QQ.default)(e,t)),n)", "async#c(e,t,n){if(t?.submission==null)return;let r=t.submission;this.__azraelWasAccepted(e,t)?await this.__azraelConsume(e,t,n)"],
    ["a?.pausedReason==null||r.submission.status===`outcome-unknown`", "a?.pausedReason==null||r.submission.status===`outcome-unknown`||this.__azraelWasAccepted(e,r)"],
    ["if(!d()||r==null||!t.tryAcquireStartTurn(e)", "if(r!=null&&this.__azraelWasAccepted(e,r)){if(d(!1))await this.#c(e,r,u);return}if(!d()||r==null||!t.tryAcquireStartTurn(e)"],
    ["o=a.status===`sent`||a.serverAccepted===!0||this.serverQueue?.findByClientMessageId(e,t.id)!=null,o&&await this.#_(e,e=>e.filter(e=>!(0,QQ.default)(e,r)),u),a.status===`sent`&&n?.operation.onResult?.(e,t,{status:`sent`,kind:`start`,turnId:a.turnId}),l?.result.resolve(a),this.accepted.get(e)?.get(t.id)===l&&this.#f(e,t.id);return", "o=a.status===`sent`||a.serverAccepted===!0||this.serverQueue?.findByClientMessageId(e,t.id)!=null;try{o&&await this.__azraelConsume(e,t,u)}finally{a.status===`sent`&&n?.operation.onResult?.(e,t,{status:`sent`,kind:`start`,turnId:a.turnId}),l?.result.resolve(a),this.accepted.get(e)?.get(t.id)===l&&this.#f(e,t.id)}return"],
    ["if(r?.submission!=null&&!this.disposed){", "if(r?.submission!=null&&!this.disposed&&!this.__azraelAccepted.get(e)?.has(r.id)){"],
    ["if(!o&&!this.disposed&&r!=null&&(n!=null||this.options.getStreamRole(e)?.role===`owner`)){", "if(!o&&!this.disposed&&r!=null&&!this.__azraelAccepted.get(e)?.has(r.id)&&(n!=null||this.options.getStreamRole(e)?.role===`owner`)){"],
    ["#p(e){let t=this.messages.get(e);if(t!=null)return t.messages;", "#p(e){let t=this.messages.get(e);if(t!=null)return this.__azraelUnsent(e,t.messages);"],
    ["return n.isLoading&&r==null?void 0:r?.[e]??$Q", "return n.isLoading&&r==null?void 0:this.__azraelUnsent(e,r?.[e]??$Q)"],
    ["return n};read=e=>{let t=this.readMessages(e);", "for(let[e,t]of Object.entries(n)){let r=this.__azraelUnsent(e,t);r.length===0?delete n[e]:n[e]=r}return n};read=e=>{let t=this.readMessages(e);"],
    ["let a=this.#p(e)??$Q;", "let __azraelTransform=t;t=n=>this.__azraelUnsent(e,__azraelTransform(n));let a=this.#p(e)??$Q;"],
    ["#v(e,t){this.messages.set(e,{messages:t,refreshing:!1})", "#v(e,t){this.messages.set(e,{messages:this.__azraelUnsent(e,t),refreshing:!1})"],
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

