"use strict";

const FILE_OPEN_MENU_ASSET = "webview/assets/app-initial-9f3b5ee5b1d6.js";
const MARKER = "/*azrael-file-open-menu-v2*/";
const ANCHOR = 'v.push({id:`workspace-file-copy-path`,message:dE.copyPath';
const REPLACEMENT = `${MARKER}Gc(h)||v.push({id:\`workspace-file-open-vscode\`,message:{id:\`azrael.workspaceFile.openInVSCode\`,defaultMessage:\`VS Code에서 열기\`},onSelect:()=>{x(\`vscode\`)}}),${ANCHOR}`;

function injectFileOpenMenu(text, relativePath) {
  if (relativePath !== FILE_OPEN_MENU_ASSET) return { text, count: 0 };
  const count = needle => text.split(needle).length - 1;
  if (count(MARKER) === 1 && count(REPLACEMENT) === 1) return { text, count: 0 };
  if (count(MARKER)) throw new Error("Invalid file-open menu marker.");
  if (count(ANCHOR) !== 1) throw new Error(`Pinned file-open menu anchor must occur exactly once: found ${count(ANCHOR)}.`);
  return { text: text.replace(ANCHOR, REPLACEMENT), count: 1 };
}

module.exports = { FILE_OPEN_MENU_ASSET, ANCHOR, MARKER, REPLACEMENT, injectFileOpenMenu };
