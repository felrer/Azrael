"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const FONT_SOURCE = path.resolve(__dirname, "../extensions/azrael-ex/media/fonts");
const FONT_FILES = ["gyeonggi-title-light.woff", "gyeonggi-batang-regular.woff", "gyeonggi-batang-bold.woff", "cascadia-mono.woff2", "cascadia-mono-italic.woff2", "CASCADIA-LICENSE.txt", "cascadia-provenance.json", "NOTICE.md", "provenance.json"];
const policyPath = path.resolve(FONT_SOURCE, "../content-font-policy.cjs");
const { FONT_FAMILY, NORMAL_FONT_FAMILY, DEFAULT_NORMAL_FONT_FAMILY, SPACE_FONT_FACE, FONT_PLATFORM_SCRIPT, FONT_PLATFORM_CSS } = require(policyPath);
const sha = data => crypto.createHash("sha256").update(data).digest("hex");

function verifiedFontFiles() {
  const manifest = JSON.parse(fs.readFileSync(path.join(FONT_SOURCE, "provenance.json"), "utf8"));
  const cascadia = JSON.parse(fs.readFileSync(path.join(FONT_SOURCE, "cascadia-provenance.json"), "utf8"));
  return FONT_FILES.map(name => {
    const data = fs.readFileSync(path.join(FONT_SOURCE, name));
    const hash = sha(data);
    if (name === cascadia.license.file && (hash !== cascadia.license.sha256 || data.length !== cascadia.license.bytes)) {
      throw new Error(`Content font license does not match official provenance: ${name}`);
    }
    if (/\.woff2?$/.test(name)) {
      const pinned = [...manifest.assets, ...cascadia.assets].find(asset => asset.file === name);
      if (!pinned || hash !== pinned.sha256 || data.length !== pinned.bytes || data.toString("ascii", 0, 4) !== (name.endsWith(".woff2") ? "wOF2" : "wOFF")) {
        throw new Error(`Content font does not match official provenance: ${name}`);
      }
    }
    return { name, data, sha256: hash };
  });
}

function getContentFontRules() {
  return { ...Object.fromEntries(verifiedFontFiles().map(file => [`content-font-resource:${file.name}`, file.sha256])), "content-font-policy": sha(fs.readFileSync(policyPath)) };
}

function copyContentFontAssets(extensionRoot) {
  const destination = path.join(extensionRoot, "webview", "assets", "azrael-fonts");
  fs.mkdirSync(destination, { recursive: true });
  return verifiedFontFiles().map(file => {
    fs.writeFileSync(path.join(destination, file.name), file.data);
    return { path: `webview/assets/azrael-fonts/${file.name}`, sha256: file.sha256 };
  });
}

const CONTENT_FONT_CSS = `
/*azrael-content-fonts-v1*/
${SPACE_FONT_FACE}
${FONT_PLATFORM_CSS}
@font-face{font-family:"Azrael Cascadia Mono";src:url("./azrael-fonts/cascadia-mono.woff2") format("woff2");font-style:normal;font-weight:200 700;font-display:swap}
@font-face{font-family:"Azrael Cascadia Mono";src:url("./azrael-fonts/cascadia-mono-italic.woff2") format("woff2");font-style:italic;font-weight:200 700;font-display:swap}
@font-face{font-family:"Azrael Gyeonggi Title";src:url("./azrael-fonts/gyeonggi-title-light.woff") format("woff");font-style:normal;font-weight:400;font-display:swap}
@layer base{
:root{--codex-content-font-family:var(--azrael-content-font-family)!important;font-synthesis-weight:none}
:root[data-azrael-chat-font="openai"]{--codex-content-font-family:var(--font-sans)!important}
/* Only an available Consolas space is reduced; fallback faces retain their own advances. */
:root:not([data-azrael-chat-font="openai"]) :is(.font-content,[data-composer-body] .ProseMirror,[data-azrael-chat-text]),[data-thread-title],[data-azrael-dynamic-text]:not([data-azrael-chat-text]){font-family:var(--azrael-content-font-family)!important;font-weight:400!important;font-synthesis-weight:none;word-spacing:normal!important}
/* The message Markdown renderer sets content fonts without a .font-content wrapper. */
:root:not([data-azrael-chat-font="openai"]) :is(._MarkdownRoot_63g8m_2,._Paragraph_63g8m_2,._Heading_63g8m_2,._ListItem_63g8m_2,._Table_63g8m_2){word-spacing:normal!important}
:root[data-azrael-chat-font="openai"] :is(.font-content,[data-composer-body] .ProseMirror,[data-azrael-chat-text],._MarkdownRoot_63g8m_2){font-synthesis-weight:auto}
:root:not([data-azrael-chat-font="openai"]) ._MarkdownRoot_63g8m_2 :is(code,pre){font-family:var(--azrael-normal-content-font-family)!important;font-synthesis-weight:none;word-spacing:normal!important}
._MarkdownRoot_63g8m_2 :is(button,select){font-family:var(--font-ui-family,var(--font-sans))!important;word-spacing:normal!important}
:root:not([data-azrael-chat-font="openai"]) :is(.font-content,[data-composer-body] .ProseMirror,[data-azrael-chat-text]) :is(code,pre),[data-azrael-dynamic-text]:not([data-azrael-chat-text]) :is(code,pre){font-family:var(--azrael-normal-content-font-family)!important;font-synthesis-weight:none;word-spacing:normal!important}
:root:not([data-azrael-chat-font="openai"]) :is(.font-content,[data-composer-body] .ProseMirror,[data-azrael-chat-text]) :is(button,select),[data-azrael-dynamic-text]:not([data-azrael-chat-text]) :is(button,select){font-family:var(--font-ui-family,var(--font-sans))!important;word-spacing:normal!important}
}
`;

module.exports = { FONT_FAMILY, NORMAL_FONT_FAMILY, DEFAULT_NORMAL_FONT_FAMILY, SPACE_FONT_FACE, FONT_PLATFORM_SCRIPT, FONT_FILES, CONTENT_FONT_CSS, getContentFontRules, copyContentFontAssets };
