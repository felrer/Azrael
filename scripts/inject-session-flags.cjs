"use strict";

const ASSET = "webview/assets/header-57b689833777.js";
const MARKER = "/*azrael-session-flags-v3*/";
// Use the native persisted preference atom, scoped by host and conversation.
// A title suffix occupies the trailing title slot immediately before native metadata/actions.
const HELPER = `var azraelSessionFlagsAtom,azraelSessionFlagOnlyAtom;
function azraelInitSessionFlags(){It();azraelSessionFlagsAtom??=Ce("azrael-session-flags",{});azraelSessionFlagOnlyAtom??=Ce("azrael-session-flag-only",false)}
function azraelSessionIsFlagged(flags,conversation){return conversation!=null&&flags[JSON.stringify([conversation.hostId??"local",conversation.id])]===true}
function azraelSessionMatchesFlagFilter(flags,conversation,currentId){return azraelSessionIsFlagged(flags,conversation)||(currentId!=null&&conversation?.id===currentId)}
function azraelSessionFlagFilter(props){
  azraelInitSessionFlags();const enabled=l(azraelSessionFlagOnlyAtom)===true,store=f(Re),intl=i();
  const label=intl.formatMessage({id:"azrael.sessionFlag.only",defaultMessage:intl.locale?.startsWith("ko")?"플래그만 보기":"Flagged only"});
  return(0,X.jsxs)(ee,{color:"ghostActive",size:"medium",className:u(Gt,enabled&&"font-medium"),"data-azrael-session-flag-filter":true,role:"menuitemcheckbox","aria-checked":enabled,onClick:()=>{store.set(azraelSessionFlagOnlyAtom,!enabled);props.onSelect()},children:[(0,X.jsx)("span",{className:"min-w-0 flex-1 truncate",children:label}),enabled?(0,X.jsx)(xe,{className:"icon-2xs shrink-0 opacity-75"}):null]});
}
function azraelFlaggedSessionRow(props){
  azraelInitSessionFlags();
  const flags=l(azraelSessionFlagsAtom)??{},store=f(Re),intl=i();
  const key=JSON.stringify([props.hostId??"local",props.conversationId]);
  const flagged=flags[key]===true;
  const label=intl.formatMessage({id:flagged?"azrael.sessionFlag.remove":"azrael.sessionFlag.set",defaultMessage:flagged?"Remove flag":"Set flag"});
  const button=(0,Z.jsx)("button",{type:"button","data-azrael-session-flag":key,"aria-label":label,"aria-pressed":flagged,title:label,
    className:"flex size-7 shrink-0 cursor-interaction items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 "+(flagged?"text-danger":"text-tertiary opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"),
    style:{marginInlineEnd:12,background:"transparent",boxShadow:"none"},
    onPointerDown:event=>event.stopPropagation(),onDoubleClick:event=>event.stopPropagation(),
    onClick:event=>{event.preventDefault();event.stopPropagation();store.set(azraelSessionFlagsAtom,current=>{const next={...current};if(next[key]===true)delete next[key];else next[key]=true;return next})},
    children:(0,Z.jsx)("svg",{width:18,height:18,viewBox:"0 0 24 24",fill:"none","aria-hidden":true,children:[(0,Z.jsx)("path",{d:"M5 21V4",stroke:"currentColor",strokeWidth:1.8,strokeLinecap:"round"},"pole"),(0,Z.jsx)("path",{d:"M5 4C9 1.5 13 6.5 19 3.5V14C13 17 9 12 5 14.5Z",fill:flagged?"currentColor":"none",stroke:"currentColor",strokeWidth:1.8,strokeLinejoin:"round"},"cloth")]})});
  return(0,Z.jsx)(qe,{...props,titleSuffix:button});
}`;

function injectSessionFlags(text, asset) {
  if (asset !== ASSET) return { text, count: 0 };
  const original = "(0,Z.jsx)(qe,{", patched = "(0,Z.jsx)(azraelFlaggedSessionRow,{";
  const preview = "(0,J.jsx)(qe,{", patchedPreview = "(0,J.jsx)(azraelFlaggedSessionRow,{";
  const filter = "children:[m,v,S]", patchedFilter = "children:[m,v,S,(0,X.jsx)(azraelSessionFlagFilter,{onSelect:()=>s(!1)})]";
  const feed = "let D=r.filter(E),O=fn(n.data,r,T),";
  const filteredFeed = "azraelInitSessionFlags();let azraelFlags=l(azraelSessionFlagsAtom)??{},azraelFlagPreference=l(azraelSessionFlagOnlyAtom),azraelFlagOnly=d&&azraelFlagPreference===true;let D=r.filter(E).filter(e=>!azraelFlagOnly||azraelSessionMatchesFlagFilter(azraelFlags,e,x)),O=fn(n.data,r,T).filter(e=>!azraelFlagOnly||e.kind===`local`&&azraelSessionMatchesFlagFilter(azraelFlags,e.conversation??(e.pendingThreadStart?{id:e.pendingThreadStart.clientThreadId}:null),x)),";
  const occurrences = value => text.split(value).length - 1;
  if (occurrences(MARKER)) {
    if (occurrences(MARKER) !== 1 || occurrences(HELPER) !== 1 || occurrences(patched) !== 2 || occurrences(original) !== 1 || occurrences(patchedPreview) !== 1 || occurrences(preview) || occurrences(patchedFilter) !== 1 || occurrences(filteredFeed) !== 1)
      throw new Error("Session flag transform is damaged");
    return { text, count: 0 };
  }
  if (occurrences(original) !== 2 || occurrences(preview) !== 1 || occurrences(filter) !== 1 || occurrences(feed) !== 1 || occurrences(patched) || text.includes("function azraelFlaggedSessionRow"))
    throw new Error("Pinned session row anchors changed");
  return { text: text.split(original).join(patched).replace(preview,patchedPreview).replace(filter,patchedFilter).replace(feed,filteredFeed) + "\n" + HELPER + "\n" + MARKER + "\n", count: 1 };
}
module.exports = { ASSET, MARKER, HELPER, injectSessionFlags };
