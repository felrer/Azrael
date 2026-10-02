"use strict";

const { fileURLToPath } = require("node:url");

const DROP_ASSET = "webview/assets/app-initial-4bd9e54bcd58.js";
const COMPOSER_ASSET = "webview/assets/app-initial-9cbfb5c07b41.js";
const DROP_MARKER = "/*azrael-local-file-drop-v1*/";
const COMPOSER_MARKER = "/*azrael-local-file-reference-v1*/";

const DROP_GATE = "m=e=>n!=null||hve(e)||As(e)";
const DROP_ACTION = "if(o.length===0&&s.length===0&&c.length===0&&hve(e.dataTransfer))";
const COMPOSER_CALL = "dropTargetPortalTarget:je,isDragActive:go,onAttachmentAdded:Le,setIsDragActive:_o,setShowShiftOverlay:yo";

function count(text, needle) { return text.split(needle).length - 1; }

// VS Code's editor and Explorer drags expose these native transfer formats.
// text/uri-list alone is deliberately excluded: links dragged from web pages
// must not become local file references.
const NATIVE_TYPES = ["CodeEditors", "CodeFiles", "ResourceURLs", "application/vnd.code.uri-list"];

function hasLocalFileTransfer(transfer) {
  const types = Array.from(transfer?.types ?? [], type => String(type).toLowerCase());
  return NATIVE_TYPES.some(type => types.includes(type.toLowerCase()));
}

function localFileDescriptors(transfer) {
  if (!hasLocalFileTransfer(transfer)) return [];
  const read = type => {
    try {
      const actual = Array.from(transfer.types ?? []).find(value => String(value).toLowerCase() === type.toLowerCase()) ?? type;
      return transfer.getData(actual) ?? "";
    } catch { return ""; }
  };
  const list = [];
  for (const type of ["CodeFiles", "ResourceURLs"]) {
    try {
      const values = JSON.parse(read(type));
      if (Array.isArray(values)) list.push(...values);
    } catch {}
  }
  list.push(...read("application/vnd.code.uri-list").split(/\r\n|\n|\r/));
  const result = [];
  const seen = new Set();
  for (const value of list) {
    let path = null;
    if (typeof value !== "string") continue;
    if (/^[a-z]:[\\/]/i.test(value)) path = value;
    else if (/^file:\/\//i.test(value)) {
      try {
        const uri = new URL(value);
        if (uri.protocol !== "file:" || (uri.hostname && uri.hostname !== "localhost")) continue;
        path = fileURLToPath(uri);
      } catch { continue; }
    }
    if (path == null || !/^[a-z]:[\\/]/i.test(path)) continue;
    path = path.replaceAll("/", "\\");
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ fsPath: path, path, label: path.slice(path.lastIndexOf("\\") + 1) });
  }
  return result;
}

// The injected browser helper has no Node imports. Keep it aligned with the
// pure parser above through the focused tests.
const BROWSER_HELPER = `${DROP_MARKER}function azraelHasLocalFileTransfer(e){let t=Array.from(e?.types??[],e=>String(e).toLowerCase());return ["codeeditors","codefiles","resourceurls","application/vnd.code.uri-list"].some(e=>t.includes(e))}function azraelLocalFileDescriptors(e){if(!azraelHasLocalFileTransfer(e))return[];let t=n=>{try{let r=Array.from(e.types??[]).find(e=>String(e).toLowerCase()===n.toLowerCase())??n;return e.getData(r)??""}catch{return""}},n=[];for(let e of ["CodeFiles","ResourceURLs"])try{let r=JSON.parse(t(e));Array.isArray(r)&&n.push(...r)}catch{}n.push(...t("application/vnd.code.uri-list").split(/\\r\\n|\\n|\\r/));let r=[],i=new Set;for(let e of n){if(typeof e!=="string")continue;let t=null;if(/^[a-z]:[\\\\/]/i.test(e))t=e;else if(/^file:\\/\\//i.test(e))try{let n=new URL(e);if(n.protocol!=="file:"||n.hostname&&n.hostname!=="localhost")continue;t=decodeURIComponent(n.pathname);/^\\/[a-z]:\\//i.test(t)&&(t=t.slice(1))}catch{continue}if(t==null||!/^[a-z]:[\\\\/]/i.test(t))continue;t=t.replaceAll("/","\\\\");let n=t.toLowerCase();i.has(n)||(i.add(n),r.push({fsPath:t,path:t,label:t.slice(t.lastIndexOf("\\\\")+1)}))}return r}function azraelDropLocalFileReferences(e,t){if(!azraelHasLocalFileTransfer(e))return!1;t?.(azraelLocalFileDescriptors(e));return!0}`;

function injectDropAsset(text) {
  const gated = DROP_GATE + "||azraelHasLocalFileTransfer(e)";
  const dropped = "if(o.length===0&&s.length===0&&c.length===0&&azraelDropLocalFileReferences(e.dataTransfer,__azraelAddFileReferences)){e.preventDefault();return}" + DROP_ACTION;
  if (count(text, DROP_MARKER) === 1 && text.includes(BROWSER_HELPER) && count(text, gated) === 1 && count(text, dropped) === 1) return { text, count: 0 };
  if (count(text, DROP_MARKER)) throw new Error("Invalid local-file drop marker.");
  if (count(text, DROP_GATE) !== 1 || count(text, DROP_ACTION) !== 1) {
    throw new Error("Pinned local-file drop anchors changed.");
  }
  const functionAnchor = "function Obi(e){";
  if (count(text, functionAnchor) !== 1) throw new Error("Pinned composer drop function changed.");
  const result = text.replace(functionAnchor, BROWSER_HELPER + functionAnchor + "const __azraelAddFileReferences=e.addFileReferences;")
    .replace(DROP_GATE, gated)
    .replace(DROP_ACTION, dropped);
  return { text: result, count: 1 };
}

function injectComposerAsset(text) {
  const callback = `addFileReferences:Sp(async e=>{${COMPOSER_MARKER}if(vi!=null)return;if(e.length===0){ye.get(kx).danger("Only saved local files can be attached");return}let t=[],n=!1;for(let r of e)try{let i=await Jm("read-file-metadata",{params:{path:r.fsPath}});i?.isFile===!0?t.push(r):n=!0}catch{n=!0}n&&ye.get(kx).danger("Unable to attach one or more files");if(t.length>0)await Ra.addPickedFiles(t,{imagesOnly:!1,loadImageDataUrls:async e=>{let t=await gda(e);t.some(e=>e==null)&&ye.get(kx).danger("Unable to attach one or more files");return t}})}),`;
  if (count(text, COMPOSER_MARKER) === 1 && count(text, callback + COMPOSER_CALL) === 1) return { text, count: 0 };
  if (count(text, COMPOSER_MARKER)) throw new Error("Invalid local-file composer marker.");
  if (count(text, COMPOSER_CALL) !== 1) throw new Error("Pinned local-file composer anchor changed.");
  return { text: text.replace(COMPOSER_CALL, callback + COMPOSER_CALL), count: 1 };
}

function injectLocalFileDrop(text, relativePath) {
  if (relativePath === DROP_ASSET) return injectDropAsset(text);
  if (relativePath === COMPOSER_ASSET) return injectComposerAsset(text);
  return { text, count: 0 };
}

module.exports = { DROP_ASSET, COMPOSER_ASSET, DROP_MARKER, COMPOSER_MARKER, BROWSER_HELPER,
  hasLocalFileTransfer, localFileDescriptors, injectLocalFileDrop };
