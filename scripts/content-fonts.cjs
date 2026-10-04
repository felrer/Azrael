"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const FONT_SOURCE = path.resolve(__dirname, "../extensions/azrael-ex/media/fonts");
const FONT_FILES = ["gyeonggi-batang-regular.woff", "gyeonggi-batang-bold.woff", "NOTICE.md", "provenance.json"];
const FONT_FAMILY = 'Consolas, "Azrael Gyeonggi Batang", "Malgun Gothic", "Segoe UI Emoji", monospace';
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
@font-face{font-family:"Azrael Gyeonggi Batang";src:url("./azrael-fonts/gyeonggi-batang-regular.woff") format("woff");font-style:normal;font-weight:400;font-display:swap}
@font-face{font-family:"Azrael Gyeonggi Batang";src:url("./azrael-fonts/gyeonggi-batang-bold.woff") format("woff");font-style:normal;font-weight:700;font-display:swap}
:root{--codex-content-font-family:${FONT_FAMILY}!important}
[data-composer-body] .ProseMirror,[data-thread-title],[data-azrael-dynamic-text]{font-family:${FONT_FAMILY}!important}
.font-content code,.font-content pre,[data-azrael-dynamic-text] code,[data-azrael-dynamic-text] pre,[data-composer-body] .ProseMirror code{font-family:${FONT_FAMILY}!important}
:is(.font-content,[data-azrael-dynamic-text]) :is(button,select){font-family:var(--font-ui-family,var(--font-sans))!important}
`;

module.exports = { FONT_FAMILY, FONT_FILES, CONTENT_FONT_CSS, getContentFontRules, copyContentFontAssets };
