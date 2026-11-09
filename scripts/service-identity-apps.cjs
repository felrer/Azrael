"use strict";

const PREFIX = "webview/assets/";
const APPS_ASSETS = ["app-connect-queries-2fba6cccfec5.js", "app-connect-modal-content-42dde2182e39.js", "account-linking-bf5758ae4d86.js", "installation-state-3f399b7d9716.js", "app-initial-7a199c66e670.js"].map(name => PREFIX + name);
const MARKER = "/*azrael-service-apps-v1*/";

// Serialized into the owning chunks. Each hook captures the same immutable
// render binding; its callbacks cannot publish after that service revision ends.
function appsQuery(native, binding, options) {
  const store = globalThis.__azraelServiceIdentityV1;
  const query = options.queryFn;
  return native({ ...options, queryKey: store.key(binding, options.queryKey), enabled: binding.ready && options.enabled !== false,
    queryFn: async (...args) => { store.assert(binding); const result = await query(...args); store.assert(binding); return result; } });
}
function appsMutation(native, binding, options) {
  const store = globalThis.__azraelServiceIdentityV1, next = { ...options, retry: false };
  for (const name of ["mutationFn", "onMutate", "onSuccess", "onError", "onSettled"]) {
    if (!options[name]) continue;
    next[name] = async (...args) => {
      try { store.assert(binding); } catch (error) { if (["onError", "onSettled"].includes(name)) return; throw error; }
      const result = await options[name](...args);
      store.assert(binding);
      return result;
    };
  }
  return native(next);
}
function appsRequest(client, binding) {
  return new Proxy(client, { get(target, name) {
    const method = target[name];
    if (typeof method !== "function") return method;
    if (!/^safe(Get|Post|Patch|Put|Delete)$/.test(name)) return method.bind(target);
    return async (path, options) => {
      const result = await method.call(target, path, globalThis.__azraelServiceIdentityV1.options(binding, options));
      globalThis.__azraelServiceIdentityV1.assert(binding);
      return result;
    };
  } });
}
async function appsConnect(original, options, binding) {
  const store = globalThis.__azraelServiceIdentityV1;
  store.assert(binding);
  const next = { ...options, scope: globalThis.__azraelServiceMainFacade.scope(options.scope, binding),
    expectedIdentity: { accountId: binding.accountId, userId: binding.userId } };
  for (const name of ["openInBrowser", "onOAuthStarted", "startOAuth"]) {
    if (!options[name]) continue;
    next[name] = (...args) => { store.assert(binding); return options[name](...args); };
  }
  const result = await original(next, binding);
  store.assert(binding);
  return result;
}

function injectServiceIdentityApps(text, asset) {
  if (!APPS_ASSETS.includes(asset)) return { text, count: 0 };
  if (text.includes(MARKER)) {
    if (text.split(MARKER).length !== 2 || !text.includes("__azAppsStore")) throw Error("Damaged Apps service identity transform");
    return { text, count: 0 };
  }
  function once(before, after) {
    if (text.split(before).length !== 2) throw Error(`Pinned Apps identity anchor changed: ${before.slice(0, 100)}`);
    text = text.replace(before, after);
  }
  if (asset === APPS_ASSETS[0]) {
    once('function d(e,t){return{queryKey:[`mcp-settings`,`app-connect`,`tos`,e,t]', 'function d(e,t){let binding=__azAppsStore.read();return{enabled:binding.ready,queryKey:__azAppsStore.key(binding,[`mcp-settings`,`app-connect`,`tos`,e,t])');
    once('function f(e,t,n){return{queryKey:[`app-connect-mfa-requirement`,t,n,e],enabled:t!=null&&n!=null', 'function f(e,t,n){let binding=__azAppsStore.read();t=binding.accountId;n=binding.userId;return{queryKey:__azAppsStore.key(binding,[`app-connect-mfa-requirement`,t,n,e]),enabled:binding.ready');
    once('c.safeGet(`/aip/connectors/{connector_id}/tos`,{', 'c.safeGet(`/aip/connectors/{connector_id}/tos`,__azAppsStore.options(binding,{');
    once('signal:n})}}', 'signal:n})).then(result=>{__azAppsStore.assert(binding);return result})}}');
    once('c.safeGet(`/aip/connectors/{connector_id}/mfa_requirement`,{', 'c.safeGet(`/aip/connectors/{connector_id}/mfa_requirement`,__azAppsStore.options(binding,{');
    once('signal:r})).requirement', 'signal:r})).then(result=>{__azAppsStore.assert(binding);return result})).requirement');
  } else if (asset === APPS_ASSETS[1]) {
    once('I=p(Rt),Bt=ce(P),Vt=l(vt),Ht=l(ft),Ut=l(Oe),Gt=l(Te)', 'I0=p(Rt),__azBinding=l(globalThis.__azraelServiceMainFacade.atom()),I=globalThis.__azraelServiceMainFacade.scope(I0,__azBinding),Bt=ce(P),Vt=__azBinding.accountId??null,Ht=__azBinding.accountId??null,Ut=__azBinding.userId??null,Gt=__azBinding.userId??null');
    const start = text.indexOf('function Q(e){'), end = text.indexOf('function bi(e)', start);
    if (start < 0 || end < 0) throw Error("Pinned Apps modal owner changed");
    let part = text.slice(start, end);
    part = part.replace(/\ba\(\{/g, '__azAppsMutation(a,__azBinding,{');
    part = part.replace(/\bn\(\{(?=\.\.\.(?:ar|fr|Ur|Gr|Qr)|queryKey:)/g, '__azAppsQuery(n,__azBinding,{');
    part = part.replace('n(wt({', '__azAppsQuery(n,__azBinding,wt({');
    // Request aliases are private to this modal. Their safe methods receive the
    // captured render binding even when an external OAuth callback resolves late.
    part = part.replace(/\b(Dt|\$t)\.safe(Get|Post)\(/g, 'globalThis.__azraelServiceMainFacade.request($1,I).safe$2(');
    part = part.replace('expectedIdentity:S??(Gt!=null&&Jt!=null?{accountId:Jt,userId:Gt}:void 0)', 'expectedIdentity:__azBinding.ready?{accountId:__azBinding.accountId,userId:__azBinding.userId}:void 0');
    part = part.replace('fi=async(e,t)=>{', 'fi=async(e,t)=>{__azAppsStore.assert(__azBinding);')
      .replace('At&&kt&&I.get(rt).success(', '__azAppsStore.assert(__azBinding);At&&kt&&I.get(rt).success(');
    text = text.slice(0, start) + part + text.slice(end);
    text += `\nvar __azAppsQuery=${appsQuery.toString()};var __azAppsMutation=${appsMutation.toString()};`;
  } else if (asset === APPS_ASSETS[2]) {
    // Finance navigation and native conversation identity stay in their owner.
    // This connector lookup alone is an OpenAI service operation.
    once('let S=async e=>{let{links:n}=await A.safePost(', 'let __azBinding,S=async e=>{let{links:n}=await A.safePost(');
    once('try{if(!await S(n)||n.aborted', 'try{__azBinding=__azAppsStore.capture();if(!await S(n)||n.aborted');
    once('A.safePost(`/aip/connectors/links/list_accessible`,{', 'A.safePost(`/aip/connectors/links/list_accessible`,__azAppsStore.options(__azBinding,{');
    once('signal:AbortSignal.any([f.signal,e])});return n.some', 'signal:AbortSignal.any([f.signal,e])}));__azAppsStore.assert(__azBinding);return n.some');
    once('e.id===d))', 'e.id===__azBinding.userId))');
  } else if (asset === APPS_ASSETS[3]) {
    once('async function F(e,{accountId:t,hostId:n,pluginId:r}){', 'async function F(e,{accountId:t,hostId:n,pluginId:r},binding=__azAppsStore.capture()){e=globalThis.__azraelServiceMainFacade.scope(e,binding);t=binding.accountId;');
    once('shouldUseNewAppLifecycle:e.get(j,`403472035`)})]),s=a.find', 'shouldUseNewAppLifecycle:e.get(j,`403472035`)})]);__azAppsStore.assert(binding);let s=a.find');
    once('let u=await F(e,t).catch(()=>!1);', 'let u=await F(e,t,binding).catch(()=>!1);');
    once('async function z(e,t){let n=()=>', 'async function z(e,t){if(!A(t.hostId))return;let binding=__azAppsStore.capture(),n=()=>__azAppsStore.read().key===binding.key&&__azAppsStore.read().ready&&');
    once('L=r(E,(e,{get:t})=>{if(e==null)return;let{accountId:n,hostId:r}=e;if(t(f)!==n||t(c)!==n||!A(r))return;', 'L=r(E,(e,{get:t})=>{let binding=t(globalThis.__azraelServiceMainFacade.atom());if(e==null||!binding.ready)return;let{hostId:r}=e,n=binding.accountId;if(!A(r))return;');
    once('let r=`${t.accountId}:${t.userId}:${t.notificationId}`', 'let r=`${binding.key}:${t.accountId}:${t.userId}:${t.notificationId}`');
    once('JSON.stringify([t.accountId,t.userId,i,t.pluginId])', 'JSON.stringify([binding.key,t.accountId,t.userId,i,t.pluginId])');
    once('c=(t=!1)=>{let n=', 'c=(t=!1)=>{__azAppsStore.assert(binding);let n=');
    once('await v.safePost(`/messaging/plugin-suggestions/{reference}/continue`,{', 'await v.safePost(`/messaging/plugin-suggestions/{reference}/continue`,__azAppsStore.options(binding,{');
    once('expectedErrorStatuses:[400,403,404,424,502]}),!n()', 'expectedErrorStatuses:[400,403,404,424,502]})),!n()');
    once('catch{B(e,t,s()?`connected`:`notification_failed`)', 'catch{if(!n())return;B(e,t,s()?`connected`:`notification_failed`)');
  } else {
    const edit = (name, update) => {
      const expression = new RegExp(`(?:async )?function ${name}\\(`, "g"), matches = [...text.matchAll(expression)];
      if (matches.length !== 1) throw Error(`Pinned Apps main owner changed: ${name}`);
      const start = matches[0].index, tail = text.slice(start + matches[0][0].length);
      const next = tail.search(/(?:async )?function [\w$]+\(/);
      if (next < 0) throw Error(`Pinned Apps main owner boundary changed: ${name}`);
      const end = start + matches[0][0].length + next;
      text = text.slice(0, start) + update(text.slice(start, end)) + text.slice(end);
    };
    const configs = {
      w_n: ['function w_n(e,{includeActions:t=!1,productSku:n}={}){', 'function __azAppsOriginal_w_n(e,{includeActions:t=!1,productSku:n}={},binding){'],
      Mkn: ['function Mkn({accountId:e,productSku:t,userId:n,linkRefreshStrategy:r=`BLOCKING`}){', 'function __azAppsOriginal_Mkn({accountId:e,productSku:t,userId:n,linkRefreshStrategy:r=`BLOCKING`},binding){'],
      B2r: ['function B2r({accountId:e,userId:t,productSku:n,appIds:r,enabled:i}){', 'function __azAppsOriginal_B2r({accountId:e,userId:t,productSku:n,appIds:r,enabled:i},binding){'],
      V2r: ['function V2r({accountId:e,userId:t,productSku:n,connectorIds:r}){', 'function __azAppsOriginal_V2r({accountId:e,userId:t,productSku:n,connectorIds:r},binding){']
    };
    for (const [name, [before, after]] of Object.entries(configs)) edit(name, part => {
      if (!part.startsWith(before)) throw Error(`Pinned Apps main signature changed: ${name}`);
      return part.replace(before, after).replace(/\b(D_|AD)\.safe(Get|Post)\(/g, '__azAppsRequest($1,binding).safe$2(')
        .replace('Mkn({accountId:e,userId:t,productSku:n})', 'Mkn({accountId:e,userId:t,productSku:n},binding)')
        .replace('V2r({accountId:e,userId:t,productSku:n,connectorIds:s})', 'V2r({accountId:e,userId:t,productSku:n,connectorIds:s},binding)');
    });
    for (const name of ["O_n", "k_n"]) edit(name, part => {
      part = part.replace(`async function ${name}(`, `async function __azAppsOriginal_${name}(`);
      const body = part.indexOf('}){');
      if (body < 0) throw Error(`Pinned Apps main connect signature changed: ${name}`);
      part = part.slice(0, body) + '},binding){' + part.slice(body + 3);
      part = part.replace(/\bD_\.safe(Get|Post)\(/g, '__azAppsRequest(D_,binding).safe$1(')
        .replace(/catch\(([eti])\)\{/g, 'catch($1){__azAppsStore.assert(binding);')
        .replace('w_n(i.id,{productSku:x?.productSku})', 'w_n(i.id,{productSku:x?.productSku},binding)')
        .replace('queryClient:d});let m=', 'queryClient:d},binding);let m=')
        .replace('await Kgn({', 'await __azAppsRequest(D_,binding).safePost(`/aip/connectors/service_accounts/links/api_key`,{surface:`connector_setup`,retry:`never`,');
      return part;
    });
    edit("xj", part => part.replace('function xj(e,t=!1,n){', 'function xj(e,t=!1,n,binding=__azAppsStore.read()){')
      .replace('return[...dAn,e,`hosted`,n??``,Lf()]', 'return __azAppsStore.key(binding,[...dAn,e,`hosted`,binding.accountId??``,Lf()])'));
    edit("Fkn", part => part.replace('function Fkn(e,t,n=!1,r){', 'function Fkn(e,t,n=!1,r,binding=__azAppsStore.read()){if(_j(t))e=globalThis.__azraelServiceMainFacade.scope(e,binding);')
      .replace('a=e.get(qC)??void 0', 'a=_j(t)?binding.accountId:e.get(qC)??void 0')
      .replace('queryKey:xj(t,n,o)', 'queryKey:xj(t,n,o,binding)')
      .replace('enabled:t!==`durable`||!!o', 'enabled:_j(t)?binding.ready:t!==`durable`||!!o')
      .replace('Xkn({scope:e,accountId:o,queryClient:r})', 'Xkn({scope:e,accountId:o,queryClient:r},binding)'));
    edit("Lkn", part => part.replace('shouldUseNewAppLifecycle:i}){', 'shouldUseNewAppLifecycle:i},binding=__azAppsStore.read()){if(_j(n)){__azAppsStore.assert(binding);e=globalThis.__azraelServiceMainFacade.scope(e,binding);t=binding.accountId;}')
      .replace('forceRefresh:!0})', 'forceRefresh:!0},binding)')
      .replace('r.setQueryData(xj(n,i,s),c)', '(_j(n)&&__azAppsStore.assert(binding),r.setQueryData(xj(n,i,s,binding),c))'));
    edit("Xkn", part => part.replace('forceRefresh:r=!1}){let i=e.get(US);if(i.accountLoading||t==null||i.accountId!==t)throw Error(`Apps require the active ChatGPT account`);', 'forceRefresh:r=!1},binding=__azAppsStore.capture()){__azAppsStore.assert(binding);e=globalThis.__azraelServiceMainFacade.scope(e,binding);t=binding.accountId;')
      .replace('Mkn({accountId:t,userId:e.get(qS)})', 'Mkn({accountId:t,userId:binding.userId},binding)')
      .replace('ykn({accountId:t,appIds:c,enabled:!0})', 'ykn({accountId:t,appIds:c,enabled:!0,serviceBinding:binding})')
      .replace('return nAn(', '__azAppsStore.assert(binding);return nAn('));
    edit("Rkn", part => part.replace('function Rkn(e){let t=', 'function Rkn(e){let binding=X(__azraelServiceMainFacade.atom()),t=')
      .replace('let _=g,v=h?c.accountId??void 0:void 0', 'let _=_j(s)?binding.ready:g,v=_j(s)?binding.accountId:h?c.accountId??void 0:void 0')
      .replace('let S=I(x)', 'let S=I(_j(s)?{...Fkn(o,s,m,v,binding),enabled:b&&binding.ready,staleTime:Jp.FIVE_MINUTES}:x)')
      .replace('let E=vt(T)', 'let E=vt(_j(s)?{retry:!1,onMutate:()=>p.cancelQueries({queryKey:xj(s,m,v,binding)}),mutationFn:()=>Lkn({scope:o,accountId:v,hostId:s,queryClient:p,shouldUseNewAppLifecycle:m},binding)}:T)'));
    edit("Wkn", part => part.replace('function Wkn(e,t){let n=', 'function Wkn(e,t){let binding=X(__azraelServiceMainFacade.atom()),n=')
      .replace('I(s)', 'I({...s,...w_n(r,{includeActions:!0},binding),enabled:a&&binding.ready,select:o})'));
    edit("Kkn", part => part.replace('function Kkn(e){', 'function __azAppsOriginal_Kkn(e,binding){')
      .replace('D_.safeGet(', '__azAppsRequest(D_,binding).safeGet('));
    edit("bkn", part => part.replace('function bkn(', 'function __azAppsOriginal_bkn(')
      .replace('productHeaders:o=jAe(i)}){', 'productHeaders:o=jAe(i)},binding){')
      .replace('productHeaders:o,includeTools:r}', 'productHeaders:o,includeTools:r,serviceBinding:binding}'));
    edit("Tkn", part => part.replace('productHeaders:n,includeTools:r}', 'productHeaders:n,includeTools:r,serviceBinding:binding}')
      .replace('AD.safePost(', '__azAppsRequest(AD,binding).safePost('));
    // Persist only token-free metadata alongside the existing OAuth state. The
    // callback uses this exact lease, rather than capturing whichever main is
    // selected when the browser eventually returns.
    edit("ztr", part => part.replace('y={oauthFlowCorrelationId:c,', 'y={azraelServiceBinding:__azAppsStore.capture(),oauthFlowCorrelationId:c,'));
    edit("qtr", part => part.replace('g=h.length===0?null:s(h),', 'g=h.length===0?null:s(h),binding=g?.azraelServiceBinding,')
      .replace('S=()=>{let e=', 'S=()=>{if(!binding?.ready||!__azAppsStore.read().ready||__azAppsStore.read().key!==binding.key)return!0;let e=')
      .replace(/\bD_\.safe(Get|Post)\(/g, '__azAppsRequest(D_,binding).safe$1(')
      .replace('Mkn({accountId:t.accountId,productSku:_?.productSku,userId:t.userId})', 'Mkn({accountId:t.accountId,productSku:_?.productSku,userId:t.userId},binding)')
      .replace('let t=Kkn(e);', 'let t=Kkn(e,binding);')
      .replace('catch(e){let t=e,i=t instanceof Error?JWe(t):null', 'catch(e){__azAppsStore.assert(binding);let t=e,i=t instanceof Error?JWe(t):null')
      .replace('r.setQueryData([`apps`,`link`,e.link.connector_id],e.link)', '(__azAppsStore.assert(binding),r.setQueryData(__azAppsStore.key(binding,[`apps`,`link`,e.link.connector_id]),e.link))')
      .replace('queryKey:[`apps`,`link`,e.link.connector_id]', 'queryKey:__azAppsStore.key(binding,[`apps`,`link`,e.link.connector_id])')
      .replace('queryKey:[`apps`,`link`,e]', 'queryKey:__azAppsStore.key(binding,[`apps`,`link`,e])')
      .replace('queryKey:xj(v,m,g?.accountId)', 'queryKey:xj(v,m,g?.accountId,binding)')
      .replace('shouldUseNewAppLifecycle:m})).catch', 'shouldUseNewAppLifecycle:m},binding)).catch')
      .replace('let i=r.getQueryData(n);', '__azAppsStore.assert(binding);let i=r.getQueryData(n);'));
    text += `\nvar __azAppsQuery=${appsQuery.toString()},__azAppsRequest=${appsRequest.toString()},__azAppsConnect=${appsConnect.toString()};
function w_n(id,options,binding=__azAppsStore.read()){return __azAppsQuery(value=>value,binding,__azAppsOriginal_w_n(id,options,binding))}
function Mkn(options,binding=__azAppsStore.read()){return __azAppsQuery(value=>value,binding,__azAppsOriginal_Mkn({...options,accountId:binding.accountId,userId:binding.userId},binding))}
function B2r(options,binding=__azAppsStore.read()){return __azAppsQuery(value=>value,binding,__azAppsOriginal_B2r({...options,accountId:binding.accountId,userId:binding.userId},binding))}
function V2r(options,binding=__azAppsStore.read()){return __azAppsQuery(value=>value,binding,__azAppsOriginal_V2r({...options,accountId:binding.accountId,userId:binding.userId},binding))}
function Kkn(id,binding=__azAppsStore.read()){return __azAppsQuery(value=>value,binding,__azAppsOriginal_Kkn(id,binding))}
function bkn(options,binding=options.serviceBinding??__azAppsStore.read()){return __azAppsQuery(value=>value,binding,__azAppsOriginal_bkn({...options,accountId:binding.accountId},binding))}
async function O_n(options,binding=__azAppsStore.capture()){return __azAppsConnect(__azAppsOriginal_O_n,options,binding)}
async function k_n(options,binding=__azAppsStore.capture()){return __azAppsConnect(__azAppsOriginal_k_n,options,binding)}
`;
  }
  return { text: text + '\nvar __azAppsStore=globalThis.__azraelServiceIdentityV1;\n' + MARKER, count: 1 };
}

module.exports = { APPS_ASSETS, MARKER, injectServiceIdentityApps };
