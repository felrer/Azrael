"use strict";
const { contextBridge, ipcRenderer } = require("electron");
let state = ipcRenderer.sendSync("azrael:state-read");
let acquired = false;
contextBridge.exposeInMainWorld("acquireVsCodeApi", () => {
  if (acquired) throw new Error("VS Code API has already been acquired.");
  acquired = true;
  return Object.freeze({
    postMessage: message => ipcRenderer.send("azrael:webview-message", message),
    getState: () => state,
    setState: value => { state = value; ipcRenderer.send("azrael:state-write", value); return value; },
  });
});
ipcRenderer.on("azrael:host-message", (_event, message) => window.postMessage(message, "*"));
ipcRenderer.on("azrael:image-open", (_event, image) => window.postMessage({ type: "azrael-desktop-image-open", image }, "*"));
