"use strict";

const MARKER = "/*azrael-project-drafts-v2*/";
const DRAFT_STORES = ["composer-prompt-drafts-v2", "composer-prompt-drafts-v1"];
const NEW_KEYS = ["new-conversation", "panel-new-conversation"];
const PREFIX = "azrael-project-draft:";
// Keep conversation drafts global. Only unsent new-chat entries need ownership.
function projectDraftKey(key, project) {
  return NEW_KEYS.includes(key) ? PREFIX + JSON.stringify([project?.id ?? null, key]) : key;
}
function projectDraftView(value, project) {
  if (value == null || typeof value !== "object") return value;
  const view = Object.create(null);
  for (const [key, draft] of Object.entries(value)) {
    if (!NEW_KEYS.includes(key) && !key.startsWith(PREFIX)) view[key] = draft;
  }
  for (const key of NEW_KEYS) {
    const scoped = projectDraftKey(key, project);
    if (Object.hasOwn(value, scoped)) view[key] = value[scoped];
  }
  return view;
}
function projectDraftUpdate(update, project) {
  return { ...update, entries: Object.fromEntries(Object.entries(update.entries).map(([key, entry]) => [projectDraftKey(key, project), entry])) };
}
const HELPERS = `${MARKER}const DRAFT_STORES=${JSON.stringify(DRAFT_STORES)},NEW_KEYS=${JSON.stringify(NEW_KEYS)},PREFIX=${JSON.stringify(PREFIX)};${projectDraftKey.toString()}${projectDraftView.toString()}${projectDraftUpdate.toString()}`;
const edits = [
  ['function GX(t){', HELPERS + 'function GX(t){'],
  ['async sendPersistedAtomState(e){let r=await this.readPersistedAtomState();', 'async sendPersistedAtomState(e){let r={...await this.readPersistedAtomState()},p=await this.fetchWrapper.extensionFetchHandler.getWorkspaceProject();for(let k of DRAFT_STORES)r[k]=projectDraftView(r[k],p);'],
  ['broadcastPersistedAtomUpdate(e,r){let n=r===void 0;', 'async broadcastPersistedAtomUpdate(e,r){if(DRAFT_STORES.includes(e))r=projectDraftView(r,await this.fetchWrapper.extensionFetchHandler.getWorkspaceProject());let n=r===void 0;'],
  ['await this.globalState.updatePersistedAtomValue(r.key,r.deleted?void 0:r.value,r.recordUpdate);', 'if(DRAFT_STORES.includes(r.key)){let p=await this.fetchWrapper.extensionFetchHandler.getWorkspaceProject();if(r.recordUpdate==null)throw new Error("Composer drafts require record updates");await this.globalState.updatePersistedAtomValue(r.key,void 0,projectDraftUpdate(r.recordUpdate,p))}else await this.globalState.updatePersistedAtomValue(r.key,r.deleted?void 0:r.value,r.recordUpdate);'],
];
const count = (text, token) => text.split(token).length - 1;
function injectProjectDrafts(text) {
  if (count(text, MARKER)) {
    if (count(text, MARKER) !== 1 || edits.some(([, replacement]) => count(text, replacement) !== 1)) throw new Error("Invalid project draft injection");
    return { text, count: 0 };
  }
  for (const [anchor] of edits) if (count(text, anchor) !== 1) throw new Error(`Pinned project draft anchor must occur once: ${anchor}`);
  for (const [anchor, replacement] of edits) text = text.replace(anchor, replacement);
  return { text, count: 1 };
}
module.exports = { MARKER, HELPERS, projectDraftKey, projectDraftView, projectDraftUpdate, injectProjectDrafts };
