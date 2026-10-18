"use strict";
const { installCommandDragBlock, wrapCommandDragBlock, COMMAND_DRAG_CSS } = require("./command-drag-policy.cjs");
const CSS_ASSET = "webview/assets/app-initial-aad627bd9dff.css";
const JS_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const ACTIVITY_ASSET = "webview/assets/sites-end-resource-90d3046b3014.js";
const SHELL_ASSET = "webview/assets/user-message-attachments-f6a72702c1d3.js";
const MARKER = "/*azrael-command-drag-v1*/";
const RUNTIME = `${MARKER}\n${installCommandDragBlock.toString()}\nif(globalThis.document)installCommandDragBlock(globalThis.window);\n`;
const WRAPPER = `${MARKER}\n${wrapCommandDragBlock.toString()}\n`;
const ACTIVITY_EDITS = [
  ["className:`relative overflow-clip`,disclosure:H", "className:`relative overflow-clip azrael-command-execution`,disclosure:H"],
  ["e=(0,$.jsx)(_S,{agentActivityIcon:tt,conversationId:f,enableTimelineTargets:Me,item:n})", "e=wrapCommandDragBlock(n,(0,$.jsx)(_S,{agentActivityIcon:tt,conversationId:f,enableTimelineTargets:Me,item:n}),$.jsx)"],
];
const SHELL_EDITS = [["De=d(`flex flex-col overflow-clip`,Ee)", "De=d(`flex flex-col overflow-clip azrael-command-execution`,Ee)"]];
const ASSETS = [CSS_ASSET, JS_ASSET, ACTIVITY_ASSET, SHELL_ASSET];

function injectCommandDragBlock(text, relativePath) {
  if (!ASSETS.includes(relativePath)) return { text, count: 0 };
  const prefix = relativePath === CSS_ASSET ? COMMAND_DRAG_CSS : relativePath === JS_ASSET ? RUNTIME : relativePath === ACTIVITY_ASSET ? WRAPPER : MARKER;
  const marker = relativePath === CSS_ASSET ? "/*azrael-command-drag-css-v1*/" : MARKER;
  const edits = relativePath === ACTIVITY_ASSET ? ACTIVITY_EDITS : relativePath === SHELL_ASSET ? SHELL_EDITS : [];
  if (text.includes(marker)) {
    if (text.split(marker).length !== 2 || !text.includes(prefix) || edits.some(([before, after]) => text.includes(before) || text.split(after).length !== 2)) throw Error("Damaged command drag policy: " + relativePath);
    return { text, count: 0 };
  }
  for (const [before, after] of edits) {
    if (text.split(before).length !== 2 || text.includes(after)) throw Error("Pinned command drag anchor changed: " + relativePath);
    text = text.replace(before, after);
  }
  return { text: prefix + text, count: 1 };
}
module.exports = { ASSETS, CSS_ASSET, JS_ASSET, ACTIVITY_ASSET, SHELL_ASSET, RUNTIME, injectCommandDragBlock };
