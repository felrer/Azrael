"use strict";

const ts = require("../extensions/azrael-ex/node_modules/typescript");
const CREDENTIALS_ASSET = "webview/assets/settings-96926d8fe611.js";
const CLOUD_SETTINGS_ASSET = "webview/assets/settings-7f69c294c924.js";
const HANDOFF_ASSET = "webview/assets/cloud-browser-local-live-view-e6775ed61d71.js";
const SECURITY_CLIENT_ASSET = "webview/assets/client-1235d7b6d41e.js";
const SECURITY_RECOMMENDATIONS_ASSET = "webview/assets/recommendation-status-82134c159593.js";
const SECURITY_SETTINGS_ASSET = "webview/assets/security-settings-6a4ad7285c17.js";
const AEON_MAIN_ASSET = "webview/assets/app-initial-c014f9ee4429.js";
const AEON_ONBOARDING_ASSET = "webview/assets/cloud-aeon-onboarding-54f7e9931125.js";
const HOSTED_THREAD_ASSET = "webview/assets/hosted-thread-launch-6d82d40a7021.js";
const SERVICE_ACCOUNTS_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const SERVICE_CLOUD_ASSETS = [CREDENTIALS_ASSET, CLOUD_SETTINGS_ASSET, HANDOFF_ASSET, SECURITY_CLIENT_ASSET, SECURITY_RECOMMENDATIONS_ASSET, SECURITY_SETTINGS_ASSET, AEON_MAIN_ASSET, AEON_ONBOARDING_ASSET, HOSTED_THREAD_ASSET, SERVICE_ACCOUNTS_ASSET];
const MARKER = "/*azrael-service-cloud-v1*/";

// Every request and completion retains its caller's snapshot. Returning a late
// result would allow the upstream query/mutation observer to publish old data.
function serviceRequest(binding, client) {
  const store = globalThis.__azraelServiceIdentityV1;
  return new Proxy(client, { get(target, name) {
    const value = target[name];
    if (typeof value !== "function") return value;
    if (!/^safe(Get|Post|Put|Patch|Delete)$/.test(name)) return value.bind(target);
    return async (path, options) => {
      const result = await value.call(target, path, store.options(binding, options));
      store.assert(binding);
      return result;
    };
  } });
}

function serviceCacheScope(scope, binding) {
  const store = globalThis.__azraelServiceIdentityV1;
  const query = new Proxy(scope.query, { get(target, name) {
    const value = target[name];
    if (typeof value !== "function") return value;
    return (...args) => { store.assert(binding); return value.apply(target, args); };
  } });
  return new Proxy(scope, { get(target, name) {
    if (name === "query") return query;
    const value = target[name];
    if (name === "set") return (...args) => { store.assert(binding); return value.apply(target, args); };
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

function injectServiceCloud(text, asset) {
  if (!SERVICE_CLOUD_ASSETS.includes(asset)) return { text, count: 0 };
  if (text.includes(MARKER)) {
    if (text.split(MARKER).length !== 2 || !text.includes("function __azraelCloudRequest(")) throw Error("Damaged service cloud transform");
    return { text, count: 0 };
  }
  const once = (source, before, after) => {
    if (source.split(before).length !== 2) throw Error(`Pinned service cloud anchor changed: ${before.slice(0, 100)}`);
    return source.replace(before, after);
  };
  const edit = (name, transform) => {
    const parsed = ts.createSourceFile(asset, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const matches = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (matches.length !== 1) throw Error(`Pinned service cloud function changed: ${name}`);
    const node = matches[0], start = node.getStart(parsed), end = node.end;
    text = text.slice(0, start) + transform(text.slice(start, end)) + text.slice(end);
  };
  const assignment = (name, transform) => {
    const parsed = ts.createSourceFile(asset, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), matches = [];
    const visit = node => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left) && node.left.text === name) matches.push(node);
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    if (matches.length !== 1) throw Error(`Pinned service cloud assignment changed: ${name}`);
    const node = matches[0], start = node.getStart(parsed), end = node.end;
    text = text.slice(0, start) + transform(text.slice(start, end)) + text.slice(end);
  };
  const wrap = (name, hook, runtime) => edit(name, source => {
    source = once(source, `function ${name}(`, `function ${name}Service(`);
    let props = "e";
    if (source.startsWith(`function ${name}Service()`)) {
      source = once(source, `function ${name}Service()`, `function ${name}Service(__azraelProps)`);
      props = "__azraelProps";
    }
    const brace = source.indexOf("{");
    source = source.slice(0, brace + 1) + `let __azraelBinding=${props}.__azraelServiceBinding,__azraelStore=globalThis.__azraelServiceIdentityV1;` + source.slice(brace + 1);
    return `function ${name}(props){let binding=${hook}(__azraelServiceIdentityAtom);return ${runtime}.jsx(${name}Service,{...props,__azraelServiceBinding:binding},binding.key)}${source}`;
  });
  const request = (source, alias) => {
    return source.replace(new RegExp(`\\b${alias}\\.safe`, "g"), `__azraelCloudRequest(__azraelBinding,${alias}).safe`);
  };
  const guard = source => source.replace(/\b([a-zA-Z]+)\.setQueryData\(/g, "(__azraelStore.assert(__azraelBinding),$1).setQueryData(");

  if (asset === SERVICE_ACCOUNTS_ASSET) {
    // Reuse the pinned account membership decoder; chat hW/BQ and its native
    // access-input subscription remain unchanged for ordinary project callers.
    const parsed = ts.createSourceFile(asset, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (!parsed.statements.some(node => ts.isFunctionDeclaration(node) && node.name?.text === "MRt")) throw Error("Pinned service account decoder changed");
    text += `\nfunction __azraelServiceAccountsQuery(client,binding){let store=globalThis.__azraelServiceIdentityV1;return{enabled:binding.ready,queryKey:store.key(binding,["security-account-membership"]),retry:false,staleTime:60000,queryFn:async()=>{let data=await client.safeGet("/accounts/check/{version}",store.options(binding,{parameters:{path:{version:"v4-2023-04-27"}}}));store.assert(binding);return MRt(data,binding.accountId)}}}export{__azraelServiceAccountsQuery};\n`;
  } else if (asset === AEON_ONBOARDING_ASSET) {
    edit("J", source => {
      source = once(source, "J(e,n,i,a,s){", "J(e,n,i,a,s,__azraelBinding=globalThis.__azraelServiceIdentityV1.capture()){let __azraelStore=globalThis.__azraelServiceIdentityV1;");
      source = once(source, "e.get(l)!==i||e.get(r)!==a", "__azraelStore.read().key!==__azraelBinding.key");
      return request(source, "m");
    });
    edit("X", source => {
      source = once(source, "retryPendingDeletion:a=!1}){", "retryPendingDeletion:a=!1}){let __azraelBinding=globalThis.__azraelServiceIdentityV1.capture(),__azraelStore=globalThis.__azraelServiceIdentityV1;");
      source = once(source, "u=e.get(l),d=e.get(r)", "u=__azraelBinding.accountId,d=__azraelBinding.userId");
      source = once(source, "await J(e,v,u,d,T)", "await J(e,v,u,d,T,__azraelBinding)");
      source = source.replace(/e\.get\(l\)!==u\|\|e\.get\(r\)!==d/g, "__azraelStore.read().key!==__azraelBinding.key")
        .replace(/\[`primary-aeon`,u,d\]/g, "__azraelStore.key(__azraelBinding,[`primary-aeon`,u,d])");
      // A's native pending-thread bookkeeping is retained, while its late
      // remote completion cannot invalidate or seed B's service query cache.
      source = source.replace(/e\.query\.snapshot\(S\)\.invalidate\(\)/g, "(__azraelStore.read().key===__azraelBinding.key&&e.query.snapshot(S).invalidate())")
        .replace(/E\?\.invalidate\(\)/g, "(__azraelStore.read().key===__azraelBinding.key&&E?.invalidate())");
      return request(source, "m");
    });
  } else if (asset === HOSTED_THREAD_ASSET) {
    edit("J", source => {
      source = once(source, "isThreadAccessRevoked:l}){", "isThreadAccessRevoked:l,serviceBinding:__azraelBinding}){");
      // Thread access, connector target identity and native project scopes stay
      // owned by the original h() check. Only the OpenAI HTTP call is service.
      source = once(source, "body:JSON.stringify({jsonrpc:", "...globalThis.__azraelServiceIdentityV1.options(__azraelBinding),body:JSON.stringify({jsonrpc:");
      source = once(source, '"ChatGPT-Account-ID":t.accountId,Accept:', '"ChatGPT-Account-ID":__azraelBinding.accountId,"x-azrael-service-profile":__azraelBinding.profileId,"x-azrael-service-revision":String(__azraelBinding.revision),Accept:');
      source = once(source, "assertRequestCurrent:h,expectedIdentity:{accountId:t.accountId,userId:s}", "assertRequestCurrent:()=>{h();globalThis.__azraelServiceIdentityV1.assert(__azraelBinding)},expectedIdentity:{accountId:__azraelBinding.accountId,userId:__azraelBinding.userId}");
      return once(source, "});h(),a.throwIfAborted();", "});globalThis.__azraelServiceIdentityV1.assert(__azraelBinding);h(),a.throwIfAborted();");
    });
    edit("Q", source => {
      source = once(source, "i,a,o,s,c,l,u){", "i,a,o,s,c,l,u){let __azraelBinding=globalThis.__azraelServiceIdentityV1.capture();");
      return once(source, "isThreadAccessRevoked:o}),T=!1", "isThreadAccessRevoked:o,serviceBinding:__azraelBinding}),T=!1");
    });
  } else if (asset === AEON_MAIN_ASSET) {
    for (const name of ["uT", "pT", "cx"]) assignment(name, source => {
      source = once(source, "({get:e,scope:t})=>{let n=e(ef),r=e(dl)", "({get:e,scope:t})=>{let __azraelBinding=e(__azraelGetServiceIdentityAtom()),__azraelStore=globalThis.__azraelServiceIdentityV1;t=__azraelCloudCacheScope(t,__azraelBinding);let n=__azraelBinding.accountId??null,r=__azraelBinding.userId??null");
      source = source.replace(/queryKey:\[`(cloud-aeon-profiles|cloud-aeon-sidebar-threads|primary-aeon)`([^\]]*)\]/g, "queryKey:__azraelStore.key(__azraelBinding,[`$1`$2])")
        .replace(/t\.get\(ef\)!==n\|\|t\.get\(dl\)!==r/g, "__azraelStore.read().key!==__azraelBinding.key")
        .replace(/t\.get\(ef\)===n&&t\.get\(dl\)===r/g, "__azraelStore.read().key===__azraelBinding.key");
      if (name === "uT") {
        source = once(source, ",signal:e})", "})");
        source = request(source, "Wp");
      } else if (name === "pT") {
        source = once(source, "initialData:o?.attachments", "initialData:o?.serviceKey===__azraelBinding.key?o.attachments:void 0");
        source = once(source, "a=sl,o=e(Hb)", "a=sl,o=__azraelCloudCatalog(__azraelBinding,e(Hb))");
        source = once(source, "u=t.get(Hb)", "u=__azraelCloudCatalog(__azraelBinding,t.get(Hb))");
        source = once(source, "let e=t.get(Hb)", "let e=__azraelCloudCatalog(__azraelBinding,t.get(Hb))");
        source = once(source, "AbortSignal.any([e,AbortSignal.timeout(6e4)])", "AbortSignal.timeout(6e4)");
        source = once(source, "await jlt(f)", "await jlt(f,__azraelBinding)");
        source = once(source, "t.set(Vb,{accountId:n", "t.set(Vb,{serviceKey:__azraelBinding.key,accountId:n");
      } else {
        source = once(source, "initialData:a?.accountId===n", "initialData:a?.serviceKey===__azraelBinding.key&&a?.accountId===n");
        source = once(source, "await Flt(n,e)", "await Flt(n,void 0,__azraelBinding)");
        source = once(source, "{accountId:n,userId:r,response:i}", "{serviceKey:__azraelBinding.key,accountId:n,userId:r,response:i}");
      }
      return source.replace("enabled:i,", "enabled:__azraelBinding.ready&&i,")
        .replace("enabled:i&&", "enabled:__azraelBinding.ready&&i&&").replace("enabled:e(aut)", "enabled:__azraelBinding.ready&&e(kg,_f)");
    });
    assignment("wx", source => {
      source = once(source, "(e,{get:t,scope:n})=>{let r=t(ef),i=t(dl)", "(e,{get:t,scope:n})=>{let __azraelBinding=t(__azraelGetServiceIdentityAtom()),__azraelStore=globalThis.__azraelServiceIdentityV1;n=__azraelCloudCacheScope(n,__azraelBinding);let r=__azraelBinding.accountId??null,i=__azraelBinding.userId??null");
      source = once(source, "queryKey:[`cloud-aeon-by-thread`,r,i,e]", "queryKey:__azraelStore.key(__azraelBinding,[`cloud-aeon-by-thread`,r,i,e])");
      source = once(source, "initialData:o,", "initialData:void 0,");
      source = once(source, "await Gb(e,t,r)", "await Gb(e,void 0,r,__azraelBinding)");
      return source.replace(/n\.get\(ef\)===r&&n\.get\(dl\)===i/g, "__azraelStore.read().key===__azraelBinding.key");
    });
    for (const [name, args] of [["jlt", "e"], ["Flt", "e,t"], ["Gb", "e,t,n"], ["Nlt", "e,t,n"]]) edit(name, source => {
      source = once(source, `${name}(${args}){`, `${name}(${args},__azraelBinding=globalThis.__azraelServiceIdentityV1.capture()){`);
      if (name === "jlt") source = once(source, "Nlt(t.id,e,!0)", "Nlt(t.id,e,!0,__azraelBinding)");
      return request(source, "Wp");
    });
  } else if (asset === CLOUD_SETTINGS_ASSET) {
    for (const [name, runtime] of [["Ye", "Y"], ["st", "X"], ["bt", "Q"], ["Et", "$"], ["Dt", "$"]]) wrap(name, "d", runtime);
    for (const name of ["YeService", "stService", "btService", "EtService", "DtService"]) edit(name, source => {
      source = source.replace(/d\(W\)/g, "(__azraelBinding.ready?__azraelBinding.key:null)")
        .replace(/d\(se\)/g, "(__azraelBinding.accountId??null)").replace(/d\(P\)/g, "(__azraelBinding.userId??null)")
        .replace(/\[`(chatgpt-cloud-browser-(?:cookies|passkeys|config)|orbit-cloud-browser-cookies)`([^\]]*)\]/g,
          "__azraelStore.key(__azraelBinding,[`$1`$2])")
        .replace(/\bat\(i,([ou]),([cf])\)/g, "at(i,$1,$2,__azraelBinding)");
      source = source.replace("if(i.get(se)!==o||i.get(P)!==c)", "if(!__azraelBinding.ready||__azraelStore.read().key!==__azraelBinding.key)");
      source = source.replace("queryFn:Ze", "queryFn:()=>Ze(__azraelBinding)")
        .replace("queryFn:St", "queryFn:()=>St(__azraelBinding)").replace("queryFn:kt", "queryFn:()=>kt(__azraelBinding)")
        .replace("mutationFn:Xe", "mutationFn:e=>Xe(e,__azraelBinding)")
        .replace("mutationFn:xt", "mutationFn:e=>xt(e,__azraelBinding)").replace("mutationFn:Ot", "mutationFn:e=>Ot(e,__azraelBinding)");
      return guard(source).includes("G.safe") ? request(guard(source), "G") : guard(source);
    });
    for (const name of ["Xe", "xt", "Ot"]) edit(name, source => {
      source = once(source, `${name}(e){`, `${name}(e,__azraelBinding=globalThis.__azraelServiceIdentityV1.capture()){`);
      return request(source, "G");
    });
    for (const name of ["Ze", "St", "kt"]) edit(name, source => request(once(source, `${name}(){`, `${name}(__azraelBinding=globalThis.__azraelServiceIdentityV1.capture()){`), "G"));
    edit("at", source => {
      source = once(source, "at(e,t,n){", "at(e,t,n,__azraelBinding=globalThis.__azraelServiceIdentityV1.read()){let __azraelStore=globalThis.__azraelServiceIdentityV1;t=__azraelBinding.accountId??null;n=__azraelBinding.userId??null;");
      source = once(source, "if(e.get(se)!==t||e.get(P)!==n)", "if(!__azraelBinding.ready||__azraelStore.read().key!==__azraelBinding.key)");
      source = once(source, "queryKey:[`orbit-cloud-browser-cookies`,t,n]", "queryKey:__azraelStore.key(__azraelBinding,[`orbit-cloud-browser-cookies`,t,n])");
      // Query-observer retirement on a main switch is not user cancellation.
      source = once(source, "signal:e,retry:!1", "retry:!1");
      return request(source, "G");
    });
  } else if (asset === CREDENTIALS_ASSET) {
    wrap("Ie", "_", "Z"); wrap("Ye", "_", "$");
    edit("IeService", source => {
      source = once(source, "t=_(ce),r=_(se),i=_(z)", "t=__azraelBinding.accountId??null,{data:__azraelMembership}=n(globalThis.__azraelServiceMainFacade.accountUserQuery(he,__azraelBinding)),r=__azraelMembership?.bindingKey===__azraelBinding.key?__azraelMembership.accountUserId:null,i=__azraelBinding.userId??null");
      source = once(source, "h=[`password-manager-connection`,i,t]", "h=__azraelStore.key(__azraelBinding,[`password-manager-connection`,i,t])");
      source = once(source, "Le(t,r,i,e)", "Le(t,r,i,e,__azraelBinding)");
      source = once(source, "signal:n})", "})");
      return request(source, "he");
    });
    // The saved-credential settings subtree is keyed by the entire service
    // revision so compiler memoization cannot retain an old operation closure.
    edit("YeService", source => {
      source = once(source, "n=_(F),r=ue()", "n=__azraelBinding.accountId??null,r={isLoading:!__azraelBinding.ready,userId:__azraelBinding.userId??null}");
      return once(source, "Xe,{accountId:n,userId:r.userId}", "Xe,{__azraelServiceBinding:__azraelBinding,accountId:n,userId:r.userId}");
    });
    edit("Xe", source => {
      source = once(source, "function Xe(e){", "function Xe(e){let __azraelBinding=e.__azraelServiceBinding;");
      return source.replace("Ge(n,r)", "Ge(n,r,__azraelBinding)").replace("Ke(n,r,e)", "Ke(n,r,e,__azraelBinding)");
    });
    edit("Ge", source => {
      source = once(source, "Ge(e,t){", "Ge(e,t,__azraelBinding=globalThis.__azraelServiceIdentityV1.read()){let __azraelStore=globalThis.__azraelServiceIdentityV1;e=__azraelBinding.accountId??null;t=__azraelBinding.userId??null;");
      source = once(source, "queryKey:[`saved-credentials`,t,e]", "enabled:__azraelBinding.ready,queryKey:__azraelStore.key(__azraelBinding,[`saved-credentials`,t,e])");
      source = once(source, "retry:!1,signal:r", "retry:!1");
      return request(source, "he");
    });
    for (const name of ["Ke", "Le"]) edit(name, source => {
      source = once(source, `${name}(e,t,n${name === "Le" ? ",r" : ""}){`, `${name}(e,t,n${name === "Le" ? ",r" : ""},__azraelBinding=globalThis.__azraelServiceIdentityV1.capture()){`);
      return request(source, "he");
    });
  } else if (asset === SECURITY_SETTINGS_ASSET) {
    wrap("lo", "v", "$");
    edit("loService", source => once(once(source, "t=v(me)", "t=__azraelBinding.ready?__azraelBinding.accountId:null"), "uo,{accountId:t}", "uo,{__azraelServiceBinding:__azraelBinding,accountId:t}"));
    // These are the pinned settings request/cache owners. Authentication
    // protocol helpers remain separate from native/project coordination.
    for (const name of ["Cr", "Fr", "Ir", "$r", "ei", "ti", "si", "li", "ui", "mi", "Hi", "Ji", "sa", "ja", "Ba", "Ha", "Ya", "uo"]) edit(name, source => {
      source = once(source, `function ${name}(e){`, `function ${name}(e){let __azraelBinding=e.__azraelServiceBinding??globalThis.__azraelServiceIdentityV1.read(),__azraelStore=globalThis.__azraelServiceIdentityV1;`);
      source = source.replace(/(\.jsx\((?:Cr|Fr|Ir|\$r|ei|ti|si|li|ui|mi|Hi|Ji|sa|ja|Ba|Ha|Ya|uo),\{)/g, "$1__azraelServiceBinding:__azraelBinding,");
      if (name === "Ir") source = once(source, "let i=r.watch(e=>{let r=e.get(Kr);(r?.accountId!==n.accountId||r.userId!==n.userId)&&t.abort()})", "let i=()=>{}");
      source = source.replace(/\bht\(\)/g, "({userId:__azraelBinding.userId??null,isLoading:!__azraelBinding.ready})")
        .replace(/\bH\(\)/g, "__azraelCloudUseQuery(__azraelServiceAccountsQuery(jt,__azraelBinding))")
        .replace(/\[`chatgpt-security`([^\]]*)\]/g, "__azraelStore.key(__azraelBinding,[`chatgpt-security`$1])")
        .replace(/\b([a-z])\.get\(Kr\)/g, "({accountId:__azraelBinding.accountId,userId:__azraelBinding.userId})")
        .replace("mutationFn:ro", "mutationFn:e=>ro(e,__azraelBinding)");
      if (name === "Fr") source = once(source, "r=v(Kr)", "r=__azraelBinding.ready?{accountId:__azraelBinding.accountId,userId:__azraelBinding.userId}:null");
      // Main-change retirement must leave already-dispatched native leases
      // alive. Explicit user cancellation retains the original controllers.
      source = source.replace(/([ud])\.current\?\.abort\(\)/g, "(__azraelStore.read().key===__azraelBinding.key&&$1.current?.abort())");
      if (name === "Cr") {
        source = once(source, "return H.current===e.identity&&se.current===e.generation", "return __azraelStore.read().key===__azraelBinding.key&&H.current===e.identity&&se.current===e.generation");
        source = once(source, "signal:t})", "})");
      }
      if (name === "Ir") source = once(source, "x=()=>{let e=", "x=()=>{if(__azraelStore.read().key!==__azraelBinding.key)return!1;let e=");
      if (name === "Ir") source = once(source, "let s=()=>{i&&", "let s=()=>{if(__azraelStore.read().key!==__azraelBinding.key)return;i&&");
      if (name === "Ya") {
        source = once(source, "let e={accountId:r,authSnapshot:gt()}", "let e={accountId:r,serviceKey:__azraelBinding.key}");
        source = once(source, "se=(e,t)=>{t===`all`&&e!=null&&Ja(e)&&(bt(),g(`/auth/logout`,{replace:!0,state:`complete-browser-logout`}),At(_))}", "se=(e,t)=>{if(t===`all`&&e?.serviceKey===__azraelBinding.key&&e.accountId===__azraelBinding.accountId)return __azraelStore.refresh()}");
      }
      // Observer cancellation belongs to retired queries, not native user
      // cancellation. Mutations' explicit AbortControllers stay connected.
      if (["ui", "Ji"].includes(name)) source = source.replace(/,signal:[tn](?=[,}])/g, "");
      for (const alias of ["jt", "yn", "ln"]) source = request(source, alias);
      source = source.replace(/([a-z])\.setData\(/g, "(__azraelStore.assert(__azraelBinding),$1).setData(");
      return guard(source);
    });
    edit("Mr", source => {
      source = once(source, "Mr(e){", "Mr(e){let __azraelBinding=globalThis.__azraelServiceIdentityV1.read(),__azraelStore=globalThis.__azraelServiceIdentityV1;");
      return once(source, "mutationKey:[`chatgpt-security-mode`,e]", "mutationKey:__azraelStore.key(__azraelBinding,[`chatgpt-security-mode`,e])");
    });
    edit("ro", source => request(once(source, "ro(e){", "ro(e,__azraelBinding=globalThis.__azraelServiceIdentityV1.capture()){if(e.accountId!==__azraelBinding.accountId||e.userId!==__azraelBinding.userId)throw new DOMException('Service identity changed','AbortError');"), "jt"));
  } else if (asset === SECURITY_CLIENT_ASSET) {
    edit("s", source => {
      source = once(source, "sessionReviewUserId:n}={}){", "sessionReviewUserId:n}={},__azraelBinding=globalThis.__azraelServiceIdentityV1.read()){let __azraelStore=globalThis.__azraelServiceIdentityV1;e=__azraelBinding.accountId??null;n=__azraelBinding.userId??null;");
      source = source.replace(/queryKey:\[`chatgpt-security`,e,(`[^`]+`)(,\{includeTrustedDevices:t\})?\]/g,
        "enabled:__azraelBinding.ready,queryKey:__azraelStore.key(__azraelBinding,[`chatgpt-security`,e,$1$2])");
      source = source.replace(/,signal:[er](?=[,}])/g, "");
      return request(source, "c");
    });
  } else if (asset === SECURITY_RECOMMENDATIONS_ASSET) {
    edit("p", source => {
      source = once(source, "p(e,t){", "p(e,t,__azraelBinding=globalThis.__azraelServiceIdentityV1.read()){let __azraelStore=globalThis.__azraelServiceIdentityV1;e=__azraelBinding.accountId??null;t=__azraelBinding.userId??null;");
      source = once(source, "queryKey:[`chatgpt-security`,e,`recommendations`,t]", "enabled:__azraelBinding.ready,queryKey:__azraelStore.key(__azraelBinding,[`chatgpt-security`,e,`recommendations`,t])");
      source = once(source, "signal:n,retry:!1", "retry:!1");
      return request(source, "s");
    });
  } else {
    wrap("D", "s", "N");
    edit("DService", source => {
      source = once(source, "f=s(y),p=s(h)", "f=__azraelBinding.accountId??null,p=__azraelBinding.userId??null");
      source = once(source, "JSON.stringify([d,f,p])", "JSON.stringify([__azraelBinding.key,d,f,p])");
      return once(source, "identity:g,isControlActivated", "identity:g,serviceBinding:__azraelBinding,isControlActivated");
    });
    edit("O", source => {
      source = once(source, "identity:o,isControlActivated", "identity:o,serviceBinding:__azraelBinding,isControlActivated");
      // This component receives the snapshot rather than reading the current
      // store: even a queued handoff retains the original operation identity.
      source = once(source, "h=[`cloud-browser-local-handoff`,r,o.accountId,o.userId,d]", "h=globalThis.__azraelServiceIdentityV1.key(__azraelBinding,[`cloud-browser-local-handoff`,r,o.accountId,o.userId,d])");
      source = once(source, "v={queryKey:h,queryFn:g", "v={enabled:__azraelBinding.ready,queryKey:h,queryFn:g");
      source = once(source, "AbortSignal.any([t,AbortSignal.timeout(2e4)])", "AbortSignal.timeout(2e4)");
      // In O the destructured binding is declared after the function opens.
      return source.replace("n=await x.safeGet(", "n=await __azraelCloudRequest(__azraelBinding,x).safeGet(");
    });
  }
  text = text.replace(/\b([dsv_])\(__azraelServiceIdentityAtom\)/g, "$1(__azraelGetServiceIdentityAtom())");
  if (asset !== SERVICE_ACCOUNTS_ASSET) text += `\nimport{__azraelGetServiceIdentityAtom${asset === SECURITY_SETTINGS_ASSET ? ",__azraelServiceAccountsQuery" : ""}}from"./app-initial-7a199c66e670.js";\n`;
  if (asset === SECURITY_SETTINGS_ASSET) text += `\nimport{$st as __azraelCloudUseQuery}from"./app-initial-97d3534ad35f.js";\n`;
  text += `\n${MARKER}\nvar __azraelCloudRequest=(${serviceRequest.toString()});\n`;
  if (asset === AEON_MAIN_ASSET) text += `\nvar __azraelCloudCacheScope=(${serviceCacheScope.toString()});\nfunction __azraelCloudCatalog(binding,catalog){return catalog?.serviceKey===binding.key?catalog:null}\n`;
  // The marker deliberately has a function anchor for idempotence validation.
  text = text.replace("var __azraelCloudRequest=(function serviceRequest", "var __azraelCloudRequest=(function __azraelCloudRequest");
  return { text, count: 1 };
}

module.exports = { SERVICE_CLOUD_ASSETS, CREDENTIALS_ASSET, CLOUD_SETTINGS_ASSET, HANDOFF_ASSET, SECURITY_CLIENT_ASSET, SECURITY_RECOMMENDATIONS_ASSET, SECURITY_SETTINGS_ASSET, AEON_MAIN_ASSET, AEON_ONBOARDING_ASSET, HOSTED_THREAD_ASSET, SERVICE_ACCOUNTS_ASSET, MARKER, injectServiceCloud };
