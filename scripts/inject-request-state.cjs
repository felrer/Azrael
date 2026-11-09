"use strict";

const { AUTH_SHELL_MARKER, SEND_REQUEST_ADMISSION_PREFIX } = require("./inject-auth-shell.cjs");

const HOST_ASSET = "out/extension.js";
const FRONTEND_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const MARKER = "/*azrael-request-state-v1*/";
const ASSETS = [HOST_ASSET, FRONTEND_ASSET];

// Only pending reads are shared. A detached map may finish after invalidation;
// its finalizer cannot erase the new generation's pending read.
function helper(prefix) {
  return `const ${prefix}Pending=new WeakMap;function ${prefix}Read(owner,key,read){if(owner==null||(typeof owner!=="object"&&typeof owner!=="function"))return read();let entries=${prefix}Pending.get(owner);if(entries==null)${prefix}Pending.set(owner,entries=new Map);if(entries.has(key))return entries.get(key);let pending=Promise.resolve(read()).finally(()=>{if(entries.get(key)===pending)entries.delete(key)});return entries.set(key,pending),pending}function ${prefix}Invalidate(owner){${prefix}Pending.delete(owner)}`;
}

const HOST_PREFIX = "__azraelHostRequestState";
const UI_PREFIX = "__azraelUiRequestState";
const SAVED_ORIGINAL = 'async getUserSavedConfiguration(){let{config:e}=await this.sendInternalAppServerRequest("config/read",{includeLayers:!1});return e}';
const SAVED_PATCHED = `async getUserSavedConfiguration(){let{config:e}=await ${HOST_PREFIX}Read(this.codexMcpConnection,"saved-config",()=>this.sendInternalAppServerRequest("config/read",{includeLayers:!1}));return e}`;
const UI_ORIGINAL = 'async sendRequest(e,t,n){if(this.dispatchMessage==null)throw Error(`AppServerRequestClient is missing a message dispatcher`);return e===`config/read`?this.sendConfigReadRequest(t,n):this.enqueueRequest(e,t,e===`plugin/list`&&n?.timeoutMs==null?{...n,timeoutMs:ntn}:n)}';
const mutation = (method, params) => `(["config/value/write","config/batchWrite","config/mcpServer/reload","account/login/start","account/login/cancel","account/logout","account/gatewayOAuth/login","account/gatewayOAuth/cancel","account/bedrock/setup"].includes(${method})||${method}==="azrael/account"&&${params}?.action!=="list")`;
const UI_PATCHED = `async sendRequest(e,t,n){if(this.dispatchMessage==null)throw Error(\`AppServerRequestClient is missing a message dispatcher\`);if(${mutation("e", "t")})${UI_PREFIX}Invalidate(this);if(e===\`azrael/account\`&&t?.action===\`list\`&&Object.keys(t).length===1&&Object.prototype.hasOwnProperty.call(t,"action")&&n==null)return ${UI_PREFIX}Read(this,"account-list",()=>this.enqueueRequest(e,t,n));return e===\`config/read\`?this.sendConfigReadRequest(t,n):this.enqueueRequest(e,t,e===\`plugin/list\`&&n?.timeoutMs==null?{...n,timeoutMs:ntn}:n)}`;
const UI_COMPOSED = UI_PATCHED.replace("async sendRequest(e,t,n){if(this.dispatchMessage", SEND_REQUEST_ADMISSION_PREFIX);
const PROVIDER_ORIGINAL = "sendProviderRequest(e,r,n,o,i,s){";
const PROVIDER_PATCHED = `${PROVIDER_ORIGINAL}if(${mutation("n", "o")})${HOST_PREFIX}Invalidate(this);`;
const ROUTE_ORIGINAL = "routeIncomingMessage(e,r=e){";
const ROUTE_PATCHED = `${ROUTE_ORIGINAL}if(["account/updated","account/login/completed","account/gatewayOAuth/changed","azrael/account/updated"].includes(e?.method))${HOST_PREFIX}Invalidate(this);`;
const VERSION_ORIGINAL = "setAppServerVersion(e){this.appServerVersion=e}";
const VERSION_PATCHED = `setAppServerVersion(e){${UI_PREFIX}Invalidate(this);this.appServerVersion=e}`;
const count = (text, anchor) => text.split(anchor).length - 1;

function injectRequestState(text, asset, ts) {
  if (!ASSETS.includes(asset)) return { text, count: 0 };
  const host = asset === HOST_ASSET;
  const directive = host ? '"use strict";' : "";
  const prefix = host ? HOST_PREFIX : UI_PREFIX;
  const prelude = `${MARKER}${helper(prefix)}\n`;
  let pairs = host
    ? [[SAVED_ORIGINAL, SAVED_PATCHED], [PROVIDER_ORIGINAL, PROVIDER_PATCHED], [ROUTE_ORIGINAL, ROUTE_PATCHED]]
    : [[UI_ORIGINAL, UI_PATCHED], [VERSION_ORIGINAL, VERSION_PATCHED]];
  // Prefix hooks contain their original anchor. Check the remainder after
  // removing the complete patched forms, rather than counting that substring.
  if (count(text, MARKER)) {
    // Auth-shell admission is inserted after request state in the namespace
    // pipeline. Accept only that complete, unchanged composition on reentry.
    if (!host) {
      const authMarkers = count(text, AUTH_SHELL_MARKER);
      if (authMarkers > 1 || count(text, SEND_REQUEST_ADMISSION_PREFIX) !== authMarkers) {
        throw new Error("Damaged request state transformation");
      }
      if (authMarkers === 1) pairs = [[UI_ORIGINAL, UI_COMPOSED], [VERSION_ORIGINAL, VERSION_PATCHED]];
    }
    let remainder = text;
    if (count(text, prelude) !== 1 || count(text, MARKER) !== 1 || pairs.some(([, patched]) => count(text, patched) !== 1)) {
      throw new Error("Damaged request state transformation");
    }
    for (const [, patched] of pairs) remainder = remainder.replace(patched, "");
    if (pairs.some(([original]) => count(remainder, original))) throw new Error("Damaged request state transformation");
    return { text, count: 0 };
  }
  let directiveOffset = 0;
  if (host && !text.startsWith(directive)) {
    if (!ts) throw new Error("Pinned request state anchors must occur exactly once");
    const file = ts.createSourceFile(asset, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (file.parseDiagnostics.length) throw new Error("Invalid ordinary host process wrapper.");
    const statements = require('./inject-pets-cleanup.cjs').hostStatements(file, ts);
    const first = statements[0];
    if (statements === file.statements || !first || !ts.isExpressionStatement(first) ||
        !ts.isStringLiteral(first.expression) || first.expression.text !== 'use strict') {
      throw new Error("Invalid ordinary host process wrapper.");
    }
    directiveOffset = first.getStart(file);
  }
  if (!text.startsWith(directive, directiveOffset) || count(text, `${prefix}Pending`) || pairs.some(([original, patched]) => count(text, original) !== 1 || count(text, patched))) {
    throw new Error("Pinned request state anchors must occur exactly once");
  }
  for (const [original, patched] of pairs) text = text.replace(original, patched);
  const insertAt = directiveOffset + directive.length;
  return { text: text.slice(0, insertAt) + prelude + text.slice(insertAt), count: 1 };
}

module.exports = { ASSETS, HOST_ASSET, FRONTEND_ASSET, MARKER, injectRequestState };
