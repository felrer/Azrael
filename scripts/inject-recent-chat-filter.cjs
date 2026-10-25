"use strict";
const { createHash } = require("node:crypto");

const ASSET = "webview/assets/header-57b689833777.js";
const DISCOVERY_ASSET = "webview/assets/app-initial-97d3534ad35f.js";
const QUERY_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const DISCOVERY_MARKER = "/*azrael-recent-chat-pages-50-v2*/";
const QUERY_MARKER = "/*azrael-recent-chat-search-v1*/";
const DISCOVERY_REPLACEMENTS = [
  ["limit:i?Math.min(a,100):a", "limit:Math.min(a,100)"],
  ["let r=this.params.getHistoryLimit?.()??50", "let r=this.params.getHistoryLimit?.()??200"],
  ["let n=this.params.getHistoryLimit?.()??50;if(t&&n<=50", "let n=this.params.getHistoryLimit?.()??200;if(t&&n<=200"],
  ["(t===`expanded`||n)&&r>50,a=i?r:50", "(t===`expanded`||n)&&r>200,a=i?r:200"],
  ["c=e.slice(0,50)}else r>50", "c=e.slice(0,200)}else r>200"],
  ["r<=50&&this.threadSummaries.length>0", "r<=200&&this.threadSummaries.length>0"],
  ["function ewn(e,t,n){return te(e)||!t&&e===`local`?50:n?0:500}", "function ewn(e,t,n){return te(e)||!t&&e===`local`?200:n?0:500}"],
];
const MARKER = "/*azrael-recent-chat-filter-v2*/";
const ORIGINAL = "let S=fn(b.data,x,null),C=l||Fe==null,w;";
const PATCHED = "let S=azraelRecentChatTasks(b.data,x),C=l||Fe==null,w;";
// Subscribe to the history menu's existing persisted type and environment atoms.
// Reuse its merge hook so sorting, subagent exclusion and pending rows stay upstream-owned.
const HELPER = "function azraelRecentChatTasks(tasks,conversations){It();let filter=l(Pt)??`recent`,environmentId=l(Ft)??null,{data:environments}=ce(),environment=environments?.find(e=>e.id===environmentId)??null,merged=fn(tasks,conversations,environment);return(0,gn.useMemo)(()=>filter===`local`?merged.filter(e=>e.kind===`local`&&e.conversation!=null):filter===`cloud`?merged.filter(yn):merged,[merged,filter])}";

// Keep query completion separate from the text so typing does not restart the scan.
// Cancellation only detaches this menu; the native store still owns shared refreshes.
const SEARCH_HELPER = `function azraelHistorySearch(query,feed){
 const {loadAll,resolveSearchRows}=feed,active=query.trim().length>0;
 const session=(0,wn.useRef)({active:false});if(session.current.active!==active)session.current={active};const token=session.current;
 const [attempt,retry]=(0,wn.useState)(0),[state,setState]=(0,wn.useState)(null);
 (0,wn.useEffect)(()=>{if(!active)return;let disposed=false;setState({loadAll,attempt,token,status:"loading"});
 Promise.resolve().then(()=>loadAll()).then(rows=>{if(!disposed)setState({loadAll,attempt,token,rows,status:"ready"})},()=>{if(!disposed)setState({loadAll,attempt,token,status:"error"})});
 return()=>{disposed=true}},[active,loadAll,attempt,token]);
 const current=active&&state?.loadAll===loadAll&&state?.attempt===attempt&&state?.token===token;
 return {active,status:current?state.status:"loading",rows:current&&state.rows?resolveSearchRows(state.rows):null,retry:()=>retry(n=>n+1)}
}`;
// The trigger already subscribes to recent history. Share that feed with its
// menu instead of mounting a second native registry/query subscription.
const FEED_REPLACEMENTS = [
  ["function On(e){let t=(0,jn.c)(64)", "function On(e){let t=(0,jn.c)(65)"],
  ["m=l(Nn),{data:h}=z(),g=mt()", "m=l(Nn),azraelHistoryFeed=z(),{data:h}=azraelHistoryFeed,g=mt()"],
  ["t[57]!==s||t[58]!==ue?", "t[57]!==s||t[58]!==ue||t[64]!==azraelHistoryFeed.loadAll?"],
  ["cloudtasksQuery:S,localConversations:ue,onClose:b", "cloudtasksQuery:S,localConversations:ue,historyQuery:azraelHistoryFeed,onClose:b"],
  ["t[58]=ue,t[59]=q):q=t[59]", "t[58]=ue,t[59]=q,t[64]=azraelHistoryFeed.loadAll):q=t[59]"],
];
const QUERY_BEFORE = "function Uva(){let e=(0,Yva.c)(12),t=Vva(),n=Kva(`recent-conversations`,Wva),r;";
const QUERY_AFTER = "function Uva(){let azraelScope=Ou($),{enabledRemoteHostIdSet:azraelHosts}=gGe(),e=(0,Yva.c)(12),t=Vva(),azraelLoadAll=(0,Xva.useCallback)(()=>Promise.all(jva(azraelScope,t).map(manager=>Px(azraelScope,manager.getHostId()).refreshRecentConversations({mode:`azrael-search`,sortKey:R3e(Qg)}))).then(()=>Fva({appServerRegistry:t,enabledRemoteHostIds:azraelHosts,sortKey:Qg})),[azraelScope,t,azraelHosts]),n=Kva(`recent-conversations`,Wva),r;";
// The native memo cache does not include the new callback; attach it outside it.
const QUERY_END = "s=e[11],s}";
const QUERY_END_AFTER = "s=e[11],{...s,loadAll:azraelLoadAll,resolveSearchRows:rows=>rows.flatMap(row=>{let manager=t.getForHostId(row.hostId??Hm),current=manager?.getConversation(row.id);return current&&!manager.isConversationSuppressedAfterArchive(row.id)?[current]:[]})}}";
const MENU_SECTION = "V=(0,Z.jsxs)(B.Section,{className:`vertical-scroll-fade-mask flex max-h-[60vh] flex-col gap-0 overflow-y-auto pb-1`,children:[te,re,ie]})";
const MENU_SECTION_AFTER = "V=(0,Z.jsxs)(B.Section,{className:`vertical-scroll-fade-mask flex max-h-[60vh] flex-col gap-0 overflow-y-auto pb-1`,children:azraelSearch.active&&azraelSearch.status!==`ready`?[azraelSearch.status===`error`?(0,Z.jsx)(Sn,{onRetry:azraelSearch.retry}):(0,Z.jsx)(xn,{})]:[te,re,ie]})";
const REFRESH_START = "async runRecentConversationRefresh(e,t){";
const REFRESH_END = "if(azraelAll)azraelPublish(data,null);\n}";
const refreshHash = body => createHash("sha256").update(body).digest("hex");

function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2 || text.includes(after)) throw new Error("Recent chat pagination/search anchor changed or damaged");
  return text.replace(before, after);
}

function injectProgressiveRefresh(text) {
  const start = REFRESH_START;
  const end = "this.notifyAnyConversationCallbacks({forceAny:d.any,forceMeta:d.meta})}";
  const begin = text.indexOf(start), finish = text.indexOf(end, begin) + end.length;
  if (begin < 0 || finish < end.length || text.indexOf(start, begin + start.length) >= 0) throw new Error("Recent chat refresh owner changed");
  const original = text.slice(begin, finish);
  const prefixEnd = original.indexOf("let n=e!==this.recentConversationSortKey;");
  const publishStart = original.indexOf("this.fetchedRecentConversations=!0;let c=s.data;");
  if (prefixEnd < 0 || publishStart < 0 || !original.includes("limit:Math.min(a,100)")) throw new Error("Recent chat refresh body changed");
  // Reuse the authoritative native hydration, ordering, active/pinned retention and
  // callback batching instead of maintaining a second conversation-state writer.
  const publish = original.slice(publishStart, -1).replace("c=e.slice(0,200)", "c=azraelAll?e:e.slice(0,200)").replace("r<=200&&this.threadSummaries.length>0", "!azraelAll&&r<=200&&this.threadSummaries.length>0");
  const progressive = original.slice(0, prefixEnd) + `
 let n=e!==this.recentConversationSortKey;this.recentConversationSortKey=e;
 let r=this.params.getHistoryLimit?.()??200;if(r===0){this.recentHistorySource="disabled";return}
 const azraelAll=t==="azrael-search";
 let i=azraelAll||(t==="expanded"||n)&&r>200,a=azraelAll?Infinity:i?r:200,o=this.params.host.readThreadListOriginators?.();
 const azraelPublish=(data,nextCursor)=>{let s={data,nextCursor};${publish}};
 let data=[],cursor=null;const cursors=new Set,ids=new Set;
 do{
  const page=await this.listRecentThreads({originators:o,limit:Math.min(50,a-data.length),cursor,background:cursor!=null||i});
  for(const row of page.data){if(!ids.has(row.id)&&data.length<a){ids.add(row.id);data.push(row)}}
  const next=page.nextCursor??null;
  if(!azraelAll){
   // Preserve warm rows until this refresh has its authoritative final page.
   let visible=data;
   if(next!=null&&data.length<a){visible=[...data];for(const id of this.recentConversationIds){const row=this.threadsById.get(id);if(row&&!ids.has(row.id)&&visible.length<a)visible.push(row)}}
   azraelPublish(visible,next);
   await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(next!=null&&cursors.has(next))throw Error("Repeated recent history cursor");
  if(next!=null)cursors.add(next);
  cursor=next;
 }while(cursor!=null&&data.length<a);
 if(azraelAll)azraelPublish(data,null);
}`;
  return text.slice(0, begin) + progressive + text.slice(finish) + `\n/*azrael-recent-refresh-sha256:${refreshHash(progressive)}*/\n`;
}

function injectRecentChatFilter(text, asset) {
  if (asset === DISCOVERY_ASSET) {
    const count = value => text.split(value).length - 1;
    const applied = count(DISCOVERY_MARKER);
    if (applied === 1) {
      const begin = text.indexOf(REFRESH_START), end = text.indexOf(REFRESH_END, begin);
      const hashes = [...text.matchAll(/\/\*azrael-recent-refresh-sha256:([a-f0-9]{64})\*\//g)];
      if (begin < 0 || end < 0 || hashes.length !== 1 || refreshHash(text.slice(begin, end + REFRESH_END.length)) !== hashes[0][1] || [DISCOVERY_REPLACEMENTS[2],DISCOVERY_REPLACEMENTS[6]].some(([before,after])=>count(before)!==0||count(after)!==1)) throw new Error("Recent chat progressive refresh damaged");
      return { text, count: 0 };
    }
    if (applied || DISCOVERY_REPLACEMENTS.some(([before, after]) => count(before) !== 1 || count(after))) throw new Error("Recent chat discovery limit anchor changed or damaged");
    for (const [before, after] of DISCOVERY_REPLACEMENTS) text = text.replace(before, after);
    return { text: injectProgressiveRefresh(text) + `\n${DISCOVERY_MARKER}\n`, count: 1 };
  }
  if (asset === QUERY_ASSET) {
    if (text.includes(QUERY_MARKER)) {
      if (text.split(QUERY_MARKER).length !== 2 || !text.includes(QUERY_AFTER) || !text.includes(QUERY_END_AFTER)) throw new Error("Recent chat search query transform damaged");
      return { text, count: 0 };
    }
    text = replaceOnce(text, QUERY_BEFORE, QUERY_AFTER);
    text = replaceOnce(text, QUERY_END, QUERY_END_AFTER);
    return { text: text + `\n${QUERY_MARKER}\n`, count: 1 };
  }
  if (asset !== ASSET) return { text, count: 0 };
  const count = value => text.split(value).length - 1;
  if (count(MARKER) === 1 && count(PATCHED) === 1 && count(HELPER) === 1 && count(SEARCH_HELPER) === 1 && count(MENU_SECTION_AFTER) === 1 && count(ORIGINAL) === 0 && FEED_REPLACEMENTS.every(([before,after])=>count(before)===0&&count(after)===1)) return { text, count: 0 };
  if (count(MARKER) || count(ORIGINAL) !== 1 || count(PATCHED) || count(HELPER)) throw new Error("Recent chat filter anchor changed or damaged");
  text = replaceOnce(text, ORIGINAL, PATCHED);
  for (const [before,after] of FEED_REPLACEMENTS) text = replaceOnce(text,before,after);
  text = replaceOnce(text, "let T=w,E;t[4]===C", "let [azraelQuery,azraelSetQuery]=(0,wn.useState)(``),azraelSearch=azraelHistorySearch(azraelQuery,e.historyQuery);if(azraelSearch.active&&azraelSearch.status===`ready`)r=azraelSearch.rows;let T=w,E;t[4]===C");
  text = replaceOnce(text, "[k,A]=(0,wn.useState)(``)", "[k,A]=[azraelQuery,azraelSetQuery]");
  // Recompute the section when async search status changes, independently of
  // the compiler's original cache (which only knows the old row dependencies).
  const sectionStart = "let V;t[24]!==B.Section||t[25]!==te||t[26]!==re||t[27]!==ie?(";
  const sectionEnd = ",t[24]=B.Section,t[25]=te,t[26]=re,t[27]=ie,t[28]=V):V=t[28];";
  text = replaceOnce(text, sectionStart + MENU_SECTION + sectionEnd, "let " + MENU_SECTION_AFTER + ";");
  return { text: text + `\n${HELPER}\n${SEARCH_HELPER}\n${MARKER}\n`, count: 1 };
}

module.exports = { ASSET, DISCOVERY_ASSET, QUERY_ASSET, DISCOVERY_MARKER, MARKER, HELPER, SEARCH_HELPER, injectRecentChatFilter };
