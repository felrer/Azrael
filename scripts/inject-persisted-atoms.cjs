"use strict";

const MARKER = "/*azrael-persisted-atoms-v1*/";
const edits = [
  ['constructor(e){this.storage=e}pendingUpdates=new Map;', 'constructor(e){this.storage=e;this.atomStore=require("./persisted-atoms.cjs").getStore(e)}' + MARKER + 'pendingUpdates=new Map;'],
  ['async getStored(e){if(GX(e))', 'async getStored(e){if(e===Re.PERSISTED_ATOM_STATE){await this.atomStore.flush();return this.atomStore.snapshot()}if(GX(e))'],
  ['update(e,r){return GX(e)?', 'update(e,r){if(e===Re.PERSISTED_ATOM_STATE)return this.atomStore.replace(r).then(()=>{const store=this.atomStore;this.onDidUpdateEntryEmitter.fire({key:e,get value(){return store.snapshot()}})});return GX(e)?'],
  ['async updatePersistedAtomValue(e,r,n){let o=Re.PERSISTED_ATOM_STATE;try{await this.enqueueUpdate(o,async()=>{let i=this.storage.get(o),s=i!=null&&typeof i=="object"?{...i}:{},a=n==null?r:$Ke(s[e]??(n.legacyStorageKey==null?void 0:s[n.legacyStorageKey]),n);a===void 0?delete s[e]:s[e]=a,await this.storage.update(o,s),this.onDidUpdateEntryEmitter.fire({key:o,value:s}),this.pendingPersistedAtomUpdates.set(e,a)})}finally{this.pendingUpdates.has(o)||(this.pendingPersistedAtomUpdates.forEach((i,s)=>{this.onDidUpdatePersistedAtomEmitter.fire({key:s,value:i})}),this.pendingPersistedAtomUpdates.clear())}}',
    'async updatePersistedAtomValue(e,r,n){const result=await this.atomStore.update(e,r,n,$Ke);if(!result.changed&&n==null)return;const store=this.atomStore;this.onDidUpdateEntryEmitter.fire({key:Re.PERSISTED_ATOM_STATE,get value(){return store.snapshot()}});this.pendingPersistedAtomUpdates.set(e,result.value);if(!this.atomNotifyScheduled){this.atomNotifyScheduled=true;queueMicrotask(()=>{this.atomNotifyScheduled=false;this.pendingPersistedAtomUpdates.forEach((value,key)=>this.onDidUpdatePersistedAtomEmitter.fire({key,value}));this.pendingPersistedAtomUpdates.clear()})}}'],
  ['async resetPersistedAtoms(){await this.update(Re.PERSISTED_ATOM_STATE,{}),this.pendingPersistedAtomUpdates.clear(),this.onDidResetPersistedAtomsEmitter.fire()}',
    'async resetPersistedAtoms(){await this.atomStore.reset();const store=this.atomStore;this.onDidUpdateEntryEmitter.fire({key:Re.PERSISTED_ATOM_STATE,get value(){return store.snapshot()}});this.pendingPersistedAtomUpdates.clear();this.onDidResetPersistedAtomsEmitter.fire()}'],
  ['async dumpNuxState(){let e=Object.entries(Re);for(let[r,n]of e){let o=this.storage.get(n);', 'async dumpNuxState(){let e=Object.entries(Re);for(let[r,n]of e){let o=await this.getStored(n);'],
];
const count = (text, token) => text.split(token).length - 1;
function injectPersistedAtoms(text) {
  if (text.includes(MARKER)) {
    if (count(text, MARKER) !== 1 || edits.some(([, replacement]) => count(text, replacement) !== 1)) throw new Error("Invalid persisted atom injection");
    return { text, count: 0 };
  }
  for (const [anchor] of edits) if (count(text, anchor) !== 1) throw new Error(`Pinned persisted atom anchor must occur once: ${anchor.slice(0, 80)}`);
  for (const [anchor, replacement] of edits) text = text.replace(anchor, replacement);
  return { text, count: 1 };
}
module.exports = { MARKER, injectPersistedAtoms };
