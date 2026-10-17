"use strict";
const { installScrollFadeFallback } = require("./scroll-fade.cjs");
const CSS_ASSET = "webview/assets/app-initial-aad627bd9dff.css";
const JS_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const MARKER = "/*azrael-scroll-fade-v1*/";
const RUNTIME = `${MARKER}\n${installScrollFadeFallback.toString()}\nif(globalThis.document)installScrollFadeFallback(globalThis.window);\n`;
const replacements = [
  ["edge-fade-horizontal", "x"], ["edge-fade", "y"], ["edge-fade-top", "y"], ["edge-fade-bottom", "y"],
].map(([name, axis]) => [
  `animation-name:${name};animation-timing-function:linear;animation-fill-mode:both;animation-timeline:scroll(self ${axis})`,
  `animation-name:none/*azrael-fade:${name}*/;animation-timing-function:linear;animation-fill-mode:both;animation-timeline:auto`,
]);

function injectScrollFade(text, relativePath) {
  if (relativePath === JS_ASSET) {
    if (text.includes(MARKER)) {
      if (!text.includes(RUNTIME) || text.split(MARKER).length !== 2) throw Error("Damaged scroll fade runtime");
      return { text, count: 0 };
    }
    return { text: RUNTIME + text, count: 1 };
  }
  if (relativePath !== CSS_ASSET) return { text, count: 0 };
  if (text.includes(MARKER)) {
    if (!text.startsWith(MARKER) || text.split(MARKER).length !== 2 || replacements.some(([anchor, replacement]) => text.includes(anchor) || text.split(replacement).length !== 2)) throw Error("Damaged scroll fade stylesheet");
    return { text, count: 0 };
  }
  for (const [anchor, replacement] of replacements) {
    if (text.split(anchor).length !== 2) throw Error("Pinned scroll fade animation changed: " + anchor);
    text = text.replace(anchor, replacement);
  }
  return { text: MARKER + text, count: replacements.length };
}
module.exports = { CSS_ASSET, JS_ASSET, MARKER, RUNTIME, injectScrollFade };
