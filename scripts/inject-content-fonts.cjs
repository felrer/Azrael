"use strict";

const { CONTENT_FONT_CSS } = require("./content-fonts.cjs");
const CONTENT_FONT_CSS_ASSET = "webview/assets/app-initial-67e3b9f0ad44.css";
const USER_CONTENT_ASSET = "webview/assets/collapsible-user-message-content-615648a2a09a.js";
const COMPOSER_ASSET = "webview/assets/app-initial-9cbfb5c07b41.js";
const PROFILE_ASSET = "webview/assets/profile-dropdown-items-12755417f9b8.js";
const HEADER_ASSET = "webview/assets/header-5e09211ec02d.js";
const CONTENT_FONT_ASSETS = [CONTENT_FONT_CSS_ASSET, USER_CONTENT_ASSET, COMPOSER_ASSET, PROFILE_ASSET, HEADER_ASSET];
const MARKER = "/*azrael-dynamic-text-v1*/";

const LEAF_PATCHES = new Map([
  [USER_CONTENT_ASSET, [["(0,C.jsx)(`div`,{ref:z,className:H,style:U,children:W})","(0,C.jsx)(`div`,{ref:z,className:H,style:U,\"data-azrael-dynamic-text\":true,children:W})"]]],
  [COMPOSER_ASSET, [["(0,tYi.jsx)(`span`,{className:f,children:u})","(0,tYi.jsx)(`span`,{className:f,\"data-azrael-dynamic-text\":r!=null?true:void 0,children:u})"]]],
  [PROFILE_ASSET, [["children:r}),C]","children:r}),(0,Y.jsx)(`span`,{\"data-azrael-dynamic-text\":typeof C===`string`?true:void 0,children:C})]"],["className:`block`,children:S","className:`block`,\"data-azrael-dynamic-text\":typeof S===`string`?true:void 0,children:S"],["onSelect:r,children:y},`email`)","onSelect:r,children:(0,Q.jsx)(`span`,{\"data-azrael-dynamic-text\":true,children:y})},`email`)"],[":D?.name??(0,Q.jsx)(s,{id:`codex.profileDropdown.defaultAccountTitle`",":D?.name!=null?(0,Q.jsx)(`span`,{\"data-azrael-dynamic-text\":true,children:D.name}):(0,Q.jsx)(s,{id:`codex.profileDropdown.defaultAccountTitle`"]]],
  [HEADER_ASSET, [["className:`truncate`,children:s","className:`truncate`,\"data-azrael-dynamic-text\":true,children:s"],["className:`min-w-0 flex-1 text-base text-default`,children:h.task.title","className:`min-w-0 flex-1 text-base text-default`,\"data-azrael-dynamic-text\":true,children:h.task.title"],["n=_||(0,$.jsx)(c,{id:`codex.taskRow.title`","n=_?(0,$.jsx)(`span`,{\"data-azrael-dynamic-text\":true,children:_}):(0,$.jsx)(c,{id:`codex.taskRow.title`"]]]
]);

function injectContentFonts(text, relativePath, ts) {
  if (!CONTENT_FONT_ASSETS.includes(relativePath)) return { text, count: 0 };
  if (relativePath === CONTENT_FONT_CSS_ASSET) {
    if (text.includes("/*azrael-content-fonts-v1*/")) {
      if (!text.endsWith(CONTENT_FONT_CSS) || text.split("/*azrael-content-fonts-v1*/").length !== 2) {
        throw new Error("Invalid content typography stylesheet.");
      }
      return { text, count: 0 };
    }
    for (const anchor of ["--font-content:var(--codex-content-font-family,var(--font-sans))", ".font-content{font-family:var(--font-content)}"]) {
      if (text.split(anchor).length !== 2) throw new Error("Pinned content font CSS changed: " + anchor);
    }
    return { text: text + CONTENT_FONT_CSS, count: 1 };
  }
  const source = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (source.parseDiagnostics.length) throw new Error("Invalid content typography JavaScript.");
  const patches = LEAF_PATCHES.get(relativePath);
  if (text.includes(MARKER)) {
    if (text.split(MARKER).length !== 2 || patches.some(([before, after]) => text.includes(before) || text.split(after).length !== 2)) {
      throw new Error("Invalid dynamic content marker: " + relativePath);
    }
    return { text, count: 0 };
  }
  for (const [before, after] of patches) {
    if (text.split(before).length !== 2) throw new Error("Pinned dynamic text leaf changed: " + relativePath + " " + before);
    text = text.replace(before, after);
  }
  text = MARKER + text;
  const patched = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (patched.parseDiagnostics.length) throw new Error("Invalid patched content typography JavaScript: " + relativePath);
  return { text, count: 1 };
}

module.exports = { CONTENT_FONT_CSS_ASSET, CONTENT_FONT_ASSETS, MARKER, injectContentFonts };
