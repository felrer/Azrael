"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const FONT_SOURCE = path.resolve(__dirname, "../extensions/azrael-ex/media/fonts");
const FONT_FILES = ["gyeonggi-title-light.woff", "gyeonggi-batang-regular.woff", "gyeonggi-batang-bold.woff", "NOTICE.md", "provenance.json"];
const FONT_FAMILY = 'Consolas, "Azrael Gyeonggi Title", "Malgun Gothic", "Segoe UI Emoji", monospace';
const sha = data => crypto.createHash("sha256").update(data).digest("hex");

function verifiedFontFiles() {
  const manifest = JSON.parse(fs.readFileSync(path.join(FONT_SOURCE, "provenance.json"), "utf8"));
  return FONT_FILES.map(name => {
    const data = fs.readFileSync(path.join(FONT_SOURCE, name));
    const hash = sha(data);
    if (name.endsWith(".woff")) {
      const pinned = manifest.assets.find(asset => asset.file === name);
      if (!pinned || hash !== pinned.sha256 || data.length !== pinned.bytes || data.toString("ascii", 0, 4) !== "wOFF") {
        throw new Error(`Content font does not match official provenance: ${name}`);
      }
    }
    return { name, data, sha256: hash };
  });
}

function getContentFontRules() {
  return Object.fromEntries(verifiedFontFiles().map(file => [`content-font-resource:${file.name}`, file.sha256]));
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
@font-face{font-family:"Azrael Gyeonggi Title";src:url("./azrael-fonts/gyeonggi-title-light.woff") format("woff");font-style:normal;font-weight:400;font-display:swap}
@layer base{
:root{--codex-content-font-family:${FONT_FAMILY}!important;font-synthesis-weight:none}
:root[data-azrael-chat-font="openai"]{--codex-content-font-family:var(--font-sans)!important}
/* Consolas has a 1ch space advance; subtract half without changing character spacing. */
:root:not([data-azrael-chat-font="openai"]) :is(.font-content,[data-composer-body] .ProseMirror,[data-azrael-chat-text]),[data-thread-title],[data-azrael-dynamic-text]:not([data-azrael-chat-text]){font-family:${FONT_FAMILY}!important;font-weight:400!important;font-synthesis-weight:none;word-spacing:-0.5ch!important}
/* The message Markdown renderer sets content fonts without a .font-content wrapper. */
:root:not([data-azrael-chat-font="openai"]) :is(._MarkdownRoot_63g8m_2,._Paragraph_63g8m_2,._Heading_63g8m_2,._ListItem_63g8m_2,._Table_63g8m_2){word-spacing:-0.5ch!important}
:root[data-azrael-chat-font="openai"] :is(.font-content,[data-composer-body] .ProseMirror,[data-azrael-chat-text],._MarkdownRoot_63g8m_2){font-synthesis-weight:auto}
._MarkdownRoot_63g8m_2 :is(code,pre){word-spacing:normal!important}
._MarkdownRoot_63g8m_2 :is(button,select){word-spacing:normal!important}
:root:not([data-azrael-chat-font="openai"]) :is(.font-content,[data-composer-body] .ProseMirror,[data-azrael-chat-text]) :is(code,pre),[data-azrael-dynamic-text]:not([data-azrael-chat-text]) :is(code,pre){font-family:${FONT_FAMILY}!important;font-synthesis-weight:none;word-spacing:normal!important}
:root:not([data-azrael-chat-font="openai"]) :is(.font-content,[data-composer-body] .ProseMirror,[data-azrael-chat-text]) :is(button,select),[data-azrael-dynamic-text]:not([data-azrael-chat-text]) :is(button,select){font-family:var(--font-ui-family,var(--font-sans))!important;word-spacing:normal!important}
}
`;

module.exports = { FONT_FAMILY, FONT_FILES, CONTENT_FONT_CSS, getContentFontRules, copyContentFontAssets };
