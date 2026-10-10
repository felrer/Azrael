"use strict";

const { CONTENT_FONT_CSS } = require("./content-fonts.cjs");
const CONTENT_FONT_CSS_ASSET = "webview/assets/app-initial-aad627bd9dff.css";
const USER_CONTENT_ASSET = "webview/assets/collapsible-user-message-content-a1900554ceb1.js";
const COMPOSER_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const PROFILE_ASSET = "webview/assets/profile-dropdown-items-93d2a2e5b8d6.js";
const HEADER_ASSET = "webview/assets/header-57b689833777.js";
const CONTENT_FONT_ASSETS = [CONTENT_FONT_CSS_ASSET, USER_CONTENT_ASSET, COMPOSER_ASSET, PROFILE_ASSET, HEADER_ASSET];
const MARKER = "/*azrael-dynamic-text-v1*/";

const LEAF_PATCHES = new Map([
  [USER_CONTENT_ASSET, [["(0,C.jsx)(`div`,{ref:z,className:H,style:U,children:W})", "(0,C.jsx)(`div`,{ref:z,className:H,style:U,\"data-azrael-dynamic-text\":true,\"data-azrael-chat-text\":true,children:W})"]]],
  [COMPOSER_ASSET, [["(0,Voa.jsx)(`span`,{className:f,children:u})","(0,Voa.jsx)(`span`,{className:f,\"data-azrael-dynamic-text\":r!=null?true:void 0,children:u})"]]],
  [PROFILE_ASSET, [["children:n}),S]","children:n}),(0,Q.jsx)(`span`,{\"data-azrael-dynamic-text\":typeof S===`string`?true:void 0,children:S})]"],["className:`block`,children:x", "className:`block`,\"data-azrael-dynamic-text\":typeof x===`string`?true:void 0,children:x"],["onSelect:r,children:h},`email`)","onSelect:r,children:(0,$.jsx)(`span`,{\"data-azrael-dynamic-text\":true,children:h})},`email`)"],[":E?.name??(0,$.jsx)(o,{id:`codex.profileDropdown.defaultAccountTitle`",":E?.name!=null?(0,$.jsx)(`span`,{\"data-azrael-dynamic-text\":true,children:E.name}):(0,$.jsx)(o,{id:`codex.profileDropdown.defaultAccountTitle`"]]],
  [HEADER_ASSET, [["className:`truncate`,children:o","className:`truncate`,\"data-azrael-dynamic-text\":true,children:o"],["className:`min-w-0 flex-1 text-base text-default`,children:f.task.title","className:`min-w-0 flex-1 text-base text-default`,\"data-azrael-dynamic-text\":true,children:f.task.title"],["n=g||(0,$.jsx)(o,{id:`codex.taskRow.title`","n=g?(0,$.jsx)(`span`,{\"data-azrael-dynamic-text\":true,children:g}):(0,$.jsx)(o,{id:`codex.taskRow.title`"]]]
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
    const proseAnchor = "._Paragraph_63g8m_2,._Heading_63g8m_2,._ListItem_63g8m_2,._Table_63g8m_2{font-family:var(--font-content)}";
    if (text.split(proseAnchor).length !== 2) throw new Error("Pinned chat prose typography changed.");
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
