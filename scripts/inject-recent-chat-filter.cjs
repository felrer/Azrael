"use strict";

const ASSET = "webview/assets/header-57b689833777.js";
const DISCOVERY_ASSET = "webview/assets/app-initial-97d3534ad35f.js";
const DISCOVERY_MARKER = "/*azrael-recent-chat-limit-200-v1*/";
const DISCOVERY_REPLACEMENTS = [
  ["limit:i?Math.min(a,100):a", "limit:Math.min(a,100)"],
  ["let r=this.params.getHistoryLimit?.()??50", "let r=this.params.getHistoryLimit?.()??200"],
  ["let n=this.params.getHistoryLimit?.()??50;if(t&&n<=50", "let n=this.params.getHistoryLimit?.()??200;if(t&&n<=200"],
  ["(t===`expanded`||n)&&r>50,a=i?r:50", "(t===`expanded`||n)&&r>200,a=i?r:200"],
  ["c=e.slice(0,50)}else r>50", "c=e.slice(0,200)}else r>200"],
  ["r<=50&&this.threadSummaries.length>0", "r<=200&&this.threadSummaries.length>0"],
  ["function ewn(e,t,n){return te(e)||!t&&e===`local`?50:n?0:500}", "function ewn(e,t,n){return te(e)||!t&&e===`local`?200:n?0:500}"],
];
const MARKER = "/*azrael-recent-chat-filter-v1*/";
const ORIGINAL = "let S=fn(b.data,x,null),C=l||Fe==null,w;";
const PATCHED = "let S=azraelRecentChatTasks(b.data,x),C=l||Fe==null,w;";
// Subscribe to the history menu's existing persisted type and environment atoms.
// Reuse its merge hook so sorting, subagent exclusion and pending rows stay upstream-owned.
const HELPER = "function azraelRecentChatTasks(tasks,conversations){It();let filter=l(Pt)??`recent`,environmentId=l(Ft)??null,{data:environments}=ce(),environment=environments?.find(e=>e.id===environmentId)??null,merged=fn(tasks,conversations,environment);return(0,gn.useMemo)(()=>filter===`local`?merged.filter(e=>e.kind===`local`&&e.conversation!=null):filter===`cloud`?merged.filter(yn):merged,[merged,filter])}";

function injectRecentChatFilter(text, asset) {
  if (asset === DISCOVERY_ASSET) {
    const count = value => text.split(value).length - 1;
    const applied = count(DISCOVERY_MARKER);
    if (applied === 1 && DISCOVERY_REPLACEMENTS.every(([before, after]) => count(before) === 0 && count(after) === 1)) return { text, count: 0 };
    if (applied || DISCOVERY_REPLACEMENTS.some(([before, after]) => count(before) !== 1 || count(after))) throw new Error("Recent chat discovery limit anchor changed or damaged");
    for (const [before, after] of DISCOVERY_REPLACEMENTS) text = text.replace(before, after);
    return { text: text + `\n${DISCOVERY_MARKER}\n`, count: 1 };
  }
  if (asset !== ASSET) return { text, count: 0 };
  const count = value => text.split(value).length - 1;
  if (count(MARKER) === 1 && count(PATCHED) === 1 && count(HELPER) === 1 && count(ORIGINAL) === 0) return { text, count: 0 };
  if (count(MARKER) || count(ORIGINAL) !== 1 || count(PATCHED) || count(HELPER)) throw new Error("Recent chat filter anchor changed or damaged");
  return { text: text.replace(ORIGINAL, PATCHED) + `\n${HELPER}\n${MARKER}\n`, count: 1 };
}

module.exports = { ASSET, DISCOVERY_ASSET, DISCOVERY_MARKER, MARKER, HELPER, injectRecentChatFilter };
