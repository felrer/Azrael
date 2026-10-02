"use strict";

const MARKER = "/*azrael-image-file-open-v2*/";
const ANCHOR = 'if(s)return await lo.commands.executeCommand("revealFileInOS",y),!0;let v=await lo.workspace.openTextDocument(y)';
const IMAGE_EXTENSIONS = "jpg|jpe|jpeg|png|bmp|gif|ico|webp|avif|svg";
const REPLACEMENT = `if(s)return await lo.commands.executeCommand("revealFileInOS",y),!0;${MARKER}if(process.platform==="win32"&&/\\.pdf$/i.test(y.fsPath)){await require("./pdf-file-open.cjs").openPdfInChrome(y.fsPath);return!0}if(/\\.(?:${IMAGE_EXTENSIONS})$/i.test(y.fsPath)){await lo.commands.executeCommand("vscode.openWith",y,"imagePreview.previewEditor",{preview:!1});return!0}let v=await lo.workspace.openTextDocument(y)`;

function injectImageFileOpen(text) {
  const count = (needle) => text.split(needle).length - 1;
  if (count(MARKER) === 1 && count(REPLACEMENT) === 1) return { text, count: 0 };
  if (count(MARKER)) throw new Error("Invalid image file-open marker.");
  if (count(ANCHOR) !== 1) throw new Error(`Pinned file-open anchor must occur exactly once: found ${count(ANCHOR)}.`);
  return { text: text.replace(ANCHOR, REPLACEMENT), count: 1 };
}

module.exports = { ANCHOR, MARKER, REPLACEMENT, injectImageFileOpen };
