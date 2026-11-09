"use strict";

const HOST_ASSET = "out/extension.js";
const IDENTITY_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const IDENTITY_EVENTS_ASSET = "webview/assets/app-initial-c014f9ee4429.js";
const SERVICE_AUTH_ASSETS = [HOST_ASSET, IDENTITY_ASSET, IDENTITY_EVENTS_ASSET];
const IDENTITY_MARKER = "/*azrael-service-identity-v1*/";
const MARKER = "/*azrael-service-auth-v1*/";
const AUTH_ANCHOR = 'getAuthStatus({refreshToken:e}){let r=(0,q6e.randomUUID)(),n=new Promise((o,i)=>{this.pending.set(r,{resolve:o,reject:i})});return this.mcpConnection.sendRequest(t.providerName,r,"getAuthStatus",{includeToken:!0,refreshToken:e}),n}';
const SERVICE_METHOD = 'async sendServiceRequest(method,e){let r=(0,q6e.randomUUID)(),n=new Promise((resolve,reject)=>this.pending.set(r,{resolve,reject})),leases=this.azraelServicePending??=new Map,ids=leases.get(e.requestId)??new Set;leases.set(e.requestId,ids);ids.add(r);try{this.mcpConnection.sendRequest(t.providerName,r,method,e);return await n}finally{this.pending.delete(r);ids.delete(r);ids.size||leases.delete(e.requestId)}}cancelServiceRequest(requestId){try{this.mcpConnection.sendRequest(t.providerName,(0,q6e.randomUUID)(),"azrael/service/http/cancel",{requestId})}catch{}for(let id of this.azraelServicePending?.get(requestId)??[])this.reject(id,new Error("Service request cancelled"))}endServiceRequest(requestId){try{this.mcpConnection.sendRequest(t.providerName,(0,q6e.randomUUID)(),"azrael/service/request/end",{requestId})}catch{}}async getServiceAuthStatus(e={}){let o=await this.sendServiceRequest("azrael/service/auth",e);if(!o||o.requiresOpenaiAuth!==!0||!Number.isSafeInteger(o.revision)||o.revision<0||!(o.profileId===null||typeof o.profileId==="string")||!(o.authToken===null||typeof o.authToken==="string")||!(o.authMethod===null||o.authMethod==="chatgpt")||o.authToken!==null&&(o.authMethod!=="chatgpt"||!o.profileId))throw Error("Invalid service authentication response");return o}';
const HTTP_METHOD = 'async requestServiceHttp(e){let o=await this.sendServiceRequest("azrael/service/http",e);if(!o||!Number.isInteger(o.status)||o.status<200||o.status>599||!o.headers||typeof o.headers!=="object"||typeof o.bodyBase64!=="string")throw Error("Invalid service HTTP response");return new Response(e.method==="HEAD"||[204,205,304].includes(o.status)?null:Buffer.from(o.bodyBase64,"base64"),{status:o.status,headers:o.headers})}';
const TRANSPORT = 'let g=await fetch(o,{method:r.method,headers:m,body:r.body,signal:n}),y=!g.ok&&h?await w6e(g):null;';
const TRANSPORT_PREFIX = 'let azraelTransport;if(s){try{n.throwIfAborted();let g=await this.authProvider.requestServiceHttp({requestId:azraelRequest,profileId:azraelService.profileId,revision:azraelService.revision,url:o,method:r.method,headers:m,body:r.body??null});n.throwIfAborted();azraelTransport={g,y:!g.ok&&h?await w6e(g):null}}catch{return{type:"fetch-response",responseType:"error",requestId:e,status:n.aborted?499:433,error:n.aborted?"Request cancelled":"Service HTTP request failed or its outcome is unknown"}}}else{';
const TRANSPORT_SUFFIX = 'azraelTransport={g,y}}let{g,y}=azraelTransport;';
const HEADERS_ANCHOR = 'h=Object.keys(m).some(g=>g.toLowerCase()==="authorization");if(r.expectedIdentity!=null)';
const HEADERS_SERVICE = 'h=Object.keys(m).some(g=>g.toLowerCase()==="authorization");for(let key of Object.keys(m))if(["x-azrael-service-profile","x-azrael-service-revision"].includes(key.toLowerCase()))delete m[key];if(r.expectedIdentity!=null)';
const FETCH_BEGIN = 'async fetchHttp(e,r,n){try{';
const FETCH_SERVICE_BEGIN = 'async fetchHttp(e,r,n){let azraelRequest=(0,q6e.randomUUID)(),azraelServiceStarted=!1,azraelCancel=()=>{if(azraelServiceStarted)this.authProvider.cancelServiceRequest(azraelRequest)};n.addEventListener("abort",azraelCancel,{once:!0});try{n.throwIfAborted();';
const FETCH_END = 'errorKind:DH(o)}}}cancel(e,r){';
const FETCH_SERVICE_END = 'errorKind:DH(o)}}finally{n.removeEventListener("abort",azraelCancel);azraelServiceStarted&&this.authProvider.endServiceRequest(azraelRequest)}}cancel(e,r){';
const OUTER_ERROR = 'return ie().error("Error fetching",{safe:{url:r.url,error:o},sensitive:{}}),{type:"fetch-response",responseType:"error",requestId:e,status:433';
const OUTER_SERVICE_ERROR = 'if(n.aborted)return{type:"fetch-response",responseType:"error",requestId:e,status:499,error:"Request cancelled"};' + OUTER_ERROR;
const INITIAL = 'a=s?await this.authProvider.getToken({refreshToken:!1}):null,u=async(l,d)=>';
const INITIAL_SERVICE = 'azraelService=s?await (azraelServiceStarted=!0,this.authProvider.getServiceAuthStatus({requestId:azraelRequest,refreshToken:!1,...(()=>{let h=new Headers(r.headers),profileId=h.get("x-azrael-service-profile"),value=h.get("x-azrael-service-revision");if(profileId===null&&value===null)return{};if(!profileId||value===null||!/^\\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error("Invalid service request binding");return{profileId,revision:Number(value)}})()})):null,a=azraelService?.authToken??null,u=async(l,d)=>';
const REFRESH = 'let w=await this.authProvider.getToken({refreshToken:!0});if(w&&w!==d)';
// A binding failure must leave the retry loop immediately. The surrounding
// transport catch would otherwise retry with the old credential.
const REFRESH_SERVICE = 'let azraelRefreshed;try{azraelRefreshed=await this.authProvider.getServiceAuthStatus({requestId:azraelRequest,refreshToken:!0,profileId:azraelService.profileId,revision:azraelService.revision});if(azraelRefreshed.profileId!==azraelService.profileId||azraelRefreshed.revision!==azraelService.revision)throw Error("Service binding changed")}catch{try{await g.body?.cancel()}catch{}return{type:"fetch-response",responseType:"error",requestId:e,status:499,error:"Service authentication changed or is unavailable"}}let w=azraelRefreshed.authToken;if(w&&w!==d)';
const occurrences = (text, anchor) => text.split(anchor).length - 1;

// Serialized into the Webview. Management metadata is the only identity source;
// this store never requests or retains authentication tokens.
function createServiceIdentity() {
  let client = null, generation = 0, pending = null;
  let state = Object.freeze({ key: "unavailable", ready: false });
  const listeners = new Set();
  function publish(next) { if (next.key === state.key && next.ready === state.ready) return; state = Object.freeze(next); for (const listener of listeners) listener(); }
  function unavailable() { publish({ key: `unavailable:${generation}`, ready: false }); }
  function read() { return state; }
  function assert(binding) {
    if (!binding?.ready || !state.ready || state.key !== binding.key) throw new DOMException("Service account changed or is unavailable", "AbortError");
  }
  async function refresh() {
    generation++;
    if (!client) return;
    const revision = generation;
    let request;
    try {
      request = client.sendRequest("azrael/account", { action: "list" });
      pending = request;
      const data = await request;
      if (revision !== generation) return;
      const selection = data?.serviceAccount;
      const profile = data?.profiles?.find(profile => profile.id === selection?.profileId);
      if (selection?.state !== "ready" || !Number.isSafeInteger(selection.revision) || selection.revision < 0 ||
          !profile || typeof profile.workspaceAccountId !== "string" || !profile.workspaceAccountId ||
          typeof profile.userId !== "string" || !profile.userId || typeof data.instanceId !== "string") { unavailable(); return; }
      publish({ ready: true, profileId: profile.id, revision: selection.revision, accountId: profile.workspaceAccountId,
        userId: profile.userId, key: JSON.stringify([data.instanceId, profile.id, selection.revision, profile.workspaceAccountId, profile.userId]) });
    } catch { if (revision === generation) unavailable(); }
    finally { if (pending === request) pending = null; }
  }
  return {
    read, assert,
    capture() { const binding = read(); assert(binding); return binding; },
    attach(candidate) { if (candidate?.hostId !== "local" || client === candidate) return; client = candidate; return refresh(); },
    notification(event) { if (event?.hostId === "local" && ["account/updated", "azrael/account/updated"].includes(event.method)) void refresh(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh,
    key(binding, family) { return ["azrael-openai-service", binding.key, ...family]; },
    accountUserQuery(client, binding) {
      return { queryKey: ["azrael-openai-service", binding.key, "account-membership"], enabled: binding.ready, retry: false, staleTime: 60000,
        queryFn: async () => {
          assert(binding);
          const data = await client.safeGet("/accounts/check/{version}", this.options(binding, {
            parameters: { path: { version: "v4-2023-04-27" } }
          }));
          assert(binding);
          const account = data?.accounts?.[binding.accountId]?.account;
          if (account?.account_id !== binding.accountId || typeof account.account_user_id !== "string" || !account.account_user_id.trim()) {
            throw Error("Service account membership identity is unavailable");
          }
          return { accountUserId: account.account_user_id, bindingKey: binding.key };
        } };
    },
    options(binding, options = {}) {
      assert(binding);
      const additionalHeaders = { ...options.additionalHeaders };
      for (const key of Object.keys(additionalHeaders)) if (["chatgpt-account-id", "x-azrael-service-profile", "x-azrael-service-revision"].includes(key.toLowerCase())) delete additionalHeaders[key];
      Object.assign(additionalHeaders, { "ChatGPT-Account-ID": binding.accountId, "x-azrael-service-profile": binding.profileId,
        "x-azrael-service-revision": String(binding.revision) });
      const previous = options.assertRequestCurrent;
      return { ...options, expectedIdentity: { accountId: binding.accountId, userId: binding.userId }, additionalHeaders,
        assertRequestCurrent: (...args) => { assert(binding); return previous?.(...args); } };
    }
  };
}

const IDENTITY_HELPERS = `
var __azraelServiceIdentity=globalThis.__azraelServiceIdentityV1??=((${createServiceIdentity.toString()})());
var __azraelServiceAtomValue;
function __azraelServiceAtom(){return __azraelServiceAtomValue??=(na($,()=>__azraelServiceIdentity.read(),({set:e})=>{e(__azraelServiceIdentity.read());return __azraelServiceIdentity.subscribe(()=>e(__azraelServiceIdentity.read()))}))}
var __azraelServiceScopes=new WeakMap;
function __azraelServiceScope(scope,captured){if(__azraelServiceScopes.has(scope))return scope;let binding=captured??scope.get(__azraelServiceAtom()),mapped=atom=>atom===JC||atom===KS||atom===qC?binding.accountId??null:atom===qS||atom===JS?binding.userId??null:void 0;let proxy=new Proxy(scope,{get(target,name){if(name==="get")return(atom,...args)=>{if([JC,KS,qC,qS,JS].includes(atom)){if(binding.ready)__azraelServiceIdentity.assert(binding);return mapped(atom)}if(atom===$C)return{accountId:binding.accountId??null,userId:binding.userId??null};if(atom===YUt)args=[JSON.stringify([binding.key,...args])];return target.get(atom,...args)};if(name==="watch")return callback=>target.watch(({get,...rest})=>{let current=get(__azraelServiceAtom());return callback({...rest,get:(atom,...args)=>atom===JC||atom===KS||atom===qC?current.accountId??null:atom===qS||atom===JS?current.userId??null:get(atom,...args)})});let value=target[name];return typeof value==="function"?value.bind(target):value}});__azraelServiceScopes.set(proxy,binding);return proxy}
function __azraelServiceRequest(client,scope){let binding=__azraelServiceScopes.get(scope)??scope.get(__azraelServiceAtom());return new Proxy(client,{get(target,name){let value=target[name];if(typeof value!=="function")return value;if(!/^safe(Get|Post|Patch|Put|Delete)$/.test(name))return value.bind(target);return(path,options)=>value.call(target,path,__azraelServiceIdentity.options(binding,options))}})}
globalThis.__azraelServiceMainFacade={atom:__azraelServiceAtom,scope:__azraelServiceScope,request:__azraelServiceRequest,accountUserQuery:(client,binding)=>__azraelServiceIdentity.accountUserQuery(client,binding)};
export{__azraelServiceAtom as __azraelGetServiceIdentityAtom};
`;

function injectServiceIdentity(text, asset) {
  if (![IDENTITY_ASSET, IDENTITY_EVENTS_ASSET].includes(asset)) return { text, count: 0 };
  if (occurrences(text, IDENTITY_MARKER) === 1 && text.includes("var __azraelServiceIdentity=")) return { text, count: 0 };
  if (text.includes(IDENTITY_MARKER)) throw Error("Damaged service identity transform");
  const once = (before, after) => {
    if (occurrences(text, before) !== 1) throw Error(`Pinned service identity anchor must occur once: ${before.slice(0, 90)}`);
    text = text.replace(before, after);
  };
  if (asset === IDENTITY_EVENTS_ASSET) {
    once('vm=_m.getInstance(),', 'vm=_m.getInstance(),vm.subscribe("mcp-notification",event=>__azraelServiceIdentity.notification(event)),');
    once('async function apr(e){return(await Fg.safePost(`/ecosystem/url_safe`,{requestBody:{resolved_pineapple_uri:null,url:e}})).safe===!0}',
      'async function apr(e){let binding=__azraelServiceIdentity.capture(),result=await Fg.safePost(`/ecosystem/url_safe`,__azraelServiceIdentity.options(binding,{requestBody:{resolved_pineapple_uri:null,url:e}}));__azraelServiceIdentity.assert(binding);return result.safe===!0}');
    text += `\nvar __azraelServiceIdentity=globalThis.__azraelServiceIdentityV1??=((${createServiceIdentity.toString()})());\n`;
  } else {
    // These functions own account settings and their optimistic state. Chat and
    // native coordination continue to read the original atoms outside this scope.
    for (const name of ["EUt", "DUt", "OUt", "ZC", "kUt", "AUt", "jUt", "MUt", "NUt", "PUt", "FUt"]) {
      const expression = new RegExp(`((?:async )?function ${name}\\(.*?\\)\\{)`);
      const matches = [...text.matchAll(new RegExp(expression.source, "g"))];
      if (matches.length !== 1) throw Error(`Pinned service settings function changed: ${name}`);
      text = text.replace(expression, "$1e=__azraelServiceScope(e);");
    }
    // Each settings helper imports Request under its own local alias.
    const start = text.indexOf("async function EUt("), end = text.indexOf("function tw(){", start);
    if (start < 0 || end < start) throw Error("Pinned service settings owner changed");
    let section = text.slice(start, end);
    section = section.replace(/(\{Request:([a-z])\}=await rv\([\s\S]*?import\(`\.\/chatgpt-request-157deb3458d3\.js`\)[\s\S]*?import\.meta\.url)\)/g,
      "$1),__azraelUnused=($2=__azraelServiceRequest($2,e))");
    // Request bindings are let destructurings, so alias replacement preserves
    // the existing import and all settings-specific response processing.
    text = text.slice(0, start) + section + text.slice(end);
    once('return n.latestFailedEdit=null,t===`chatgpt`&&(n.accountFollowingRevision=r),{accountId:', 'return n.latestFailedEdit=null,t===`chatgpt`&&(n.accountFollowingRevision=r),{serviceKey:__azraelServiceScopes.get(e).key,accountId:');
    once('function NUt(e,t){e=__azraelServiceScope(e);return ', 'function NUt(e,t){e=__azraelServiceScope(e);return __azraelServiceScopes.get(e).key===t.serviceKey&&');
    once('ew=Pl($,({scope:e})=>{', 'ew=Pl($,({get:__azraelGet,scope:e})=>{');
    once('let t=[`chatgpt-user-settings`],{retry:n=', 'let service=__azraelGet(__azraelServiceAtom()),t=__azraelServiceIdentity.key(service,[`chatgpt-user-settings`]),{retry:n=');
    once('queryFn:({signal:t})=>EUt(e,{signal:t}),queryKey:t,refetchOnWindowFocus:', 'queryFn:()=>EUt(__azraelServiceScope(e,service),{}),queryKey:t,enabled:service.ready,refetchOnWindowFocus:');
    const quickStart = text.indexOf('qUt=md($,'), quickEnd = text.indexOf(',JUt=ou(', quickStart);
    if (quickStart < 0 || quickEnd < quickStart) throw Error("Pinned service quick-send settings mutation changed");
    let quick = text.slice(quickStart, quickEnd);
    quick = quick.replace('({scope:e})=>(', '({get:__azraelGet,scope:e})=>{let service=__azraelGet(__azraelServiceAtom());return(')
      .replace('mutationFn:async t=>{', 'mutationFn:async t=>{e=__azraelServiceScope(e,service);')
      .replace('import.meta.url);if(e.get(JC)', 'import.meta.url);a=__azraelServiceRequest(a,e);if(e.get(JC)')
      .replace('mutationKey:[`set-work-quick-send-by-default`]', 'mutationKey:__azraelServiceIdentity.key(service,[`set-work-quick-send-by-default`])')
      .replace('scope:{id:`work-quick-send-by-default`}', 'scope:{id:`work-quick-send-by-default:${service.key}`}');
    quick = quick.slice(0, -1) + "})";
    text = text.slice(0, quickStart) + quick + text.slice(quickEnd);
    once('XUt=md($,({scope:e})=>({mutationFn:({value:t,edit:n})=>jUt(e,t,n),mutationKey:[`set-chatgpt-chat-theme`]}))', 'XUt=md($,({get:__azraelGet,scope:e})=>{let service=__azraelGet(__azraelServiceAtom());return{mutationFn:({value:t,edit:n})=>jUt(__azraelServiceScope(e,service),t,n),mutationKey:__azraelServiceIdentity.key(service,[`set-chatgpt-chat-theme`])}})');
    once('md($,({get:e,scope:t})=>{let n=e(JC),r=e(qS),i=t.query.snapshot(ew);return{mutationKey:[`work-network-access`,n,r],scope:{id:`work-network-access:${n}:${r}`}',
      'md($,({get:e,scope:t})=>{let service=e(__azraelServiceAtom());t=__azraelServiceScope(t);let n=service.accountId??null,r=service.userId??null,i=t.query.snapshot(ew);return{mutationKey:__azraelServiceIdentity.key(service,[`work-network-access`,n,r]),scope:{id:`work-network-access:${service.key}` }');
    once('import.meta.url);if(n==null||r==null||t.get(JC)!==n||t.get(qS)!==r)', 'import.meta.url);a=__azraelServiceRequest(a,t);if(n==null||r==null||t.get(JC)!==n||t.get(qS)!==r)');
    once('emitRequestLifecycleEvent(e){', 'emitRequestLifecycleEvent(e){__azraelServiceIdentity.attach(this);');
    text += IDENTITY_HELPERS;
  }
  return { text: text + "\n" + IDENTITY_MARKER, count: 1 };
}

function injectServiceAuth(text, asset = HOST_ASSET) {
  if (asset !== HOST_ASSET) return injectServiceIdentity(text, asset);
  if (asset !== HOST_ASSET) return { text, count: 0 };
  const markers = occurrences(text, MARKER);
  if (markers === 1 && occurrences(text, AUTH_ANCHOR + SERVICE_METHOD + HTTP_METHOD + MARKER) === 1 &&
      occurrences(text, INITIAL_SERVICE) === 1 && occurrences(text, REFRESH_SERVICE) === 1 &&
      occurrences(text, TRANSPORT_PREFIX) === 1 && occurrences(text, TRANSPORT_SUFFIX) === 1 && occurrences(text, HEADERS_SERVICE) === 1 && occurrences(text, FETCH_SERVICE_BEGIN) === 1 && occurrences(text, FETCH_SERVICE_END) === 1 && occurrences(text, OUTER_SERVICE_ERROR) === 1 &&
      !text.includes(INITIAL) && !text.includes(REFRESH)) return { text, count: 0 };
  if (markers || text.includes('"azrael/service/auth"')) throw Error("Damaged service authentication transform");
  for (const anchor of ['fQ=class t{', 'sF=class{', AUTH_ANCHOR, INITIAL, REFRESH, TRANSPORT, HEADERS_ANCHOR, FETCH_BEGIN, FETCH_END, OUTER_ERROR]) {
    if (occurrences(text, anchor) !== 1) throw Error(`Pinned service authentication anchor must occur once: ${anchor.slice(0, 80)}`);
  }
  return { text: text.replace(AUTH_ANCHOR, AUTH_ANCHOR + SERVICE_METHOD + HTTP_METHOD + MARKER)
    .replace(INITIAL, INITIAL_SERVICE).replace(REFRESH, REFRESH_SERVICE)
    .replace(TRANSPORT, TRANSPORT_PREFIX + TRANSPORT + TRANSPORT_SUFFIX).replace(HEADERS_ANCHOR, HEADERS_SERVICE)
    .replace(FETCH_BEGIN, FETCH_SERVICE_BEGIN).replace(FETCH_END, FETCH_SERVICE_END).replace(OUTER_ERROR, OUTER_SERVICE_ERROR), count: 1 };
}

function serviceIdentityBootstrap() {
  return `var __azraelServiceIdentity=globalThis.__azraelServiceIdentityV1??=((${createServiceIdentity.toString()})());`;
}

module.exports = { HOST_ASSET, MARKER, SERVICE_AUTH_ASSETS, IDENTITY_ASSET, IDENTITY_EVENTS_ASSET, injectServiceAuth, createServiceIdentity, serviceIdentityBootstrap };
