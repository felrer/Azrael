"use strict";

const ASSET = "webview/assets/header-5e09211ec02d.js";
const MARKER = "/*azrael-recent-chat-filter-v1*/";
const ORIGINAL = "let S=fn(b.data,x,null),C=u||Se==null,w;";
const PATCHED = "let S=azraelRecentChatTasks(b.data,x),C=u||Se==null,w;";
// Subscribe to the history menu's existing persisted type and environment atoms.
// Reuse its merge hook so sorting, subagent exclusion and pending rows stay upstream-owned.
const HELPER = "function azraelRecentChatTasks(tasks,conversations){let filter=n(Pt)??`recent`,environmentId=n(Ft)??null,{data:environments}=k(),environment=environments?.find(e=>e.id===environmentId)??null,merged=fn(tasks,conversations,environment);return(0,gn.useMemo)(()=>filter===`local`?merged.filter(e=>e.kind===`local`&&e.conversation!=null):filter===`cloud`?merged.filter(yn):merged,[merged,filter])}";

function injectRecentChatFilter(text, asset) {
  if (asset !== ASSET) return { text, count: 0 };
  const count = value => text.split(value).length - 1;
  if (count(MARKER) === 1 && count(PATCHED) === 1 && count(HELPER) === 1 && count(ORIGINAL) === 0) return { text, count: 0 };
  if (count(MARKER) || count(ORIGINAL) !== 1 || count(PATCHED) || count(HELPER)) throw new Error("Recent chat filter anchor changed or damaged");
  return { text: text.replace(ORIGINAL, PATCHED) + `\n${HELPER}\n${MARKER}\n`, count: 1 };
}

module.exports = { ASSET, MARKER, HELPER, injectRecentChatFilter };
