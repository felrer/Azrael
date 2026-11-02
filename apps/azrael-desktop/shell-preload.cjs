"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("azraelDesktop", Object.freeze({
  respondDialog: request => ipcRenderer.invoke("azrael:dialog", request),
  copyText: text => ipcRenderer.invoke("azrael:copy-text", text),
  readTextFile: request => ipcRenderer.invoke("azrael:read-text", request),
  chooseTextFile: () => ipcRenderer.invoke("azrael:choose-file"),
  terminalCreate: request => ipcRenderer.invoke("azrael:terminal-create", request),
  terminalWrite: request => ipcRenderer.invoke("azrael:terminal-write", request),
  terminalResize: request => ipcRenderer.invoke("azrael:terminal-resize", request),
  terminalClose: request => ipcRenderer.invoke("azrael:terminal-close", request),
  layout: request => ipcRenderer.send("azrael:layout", request),
  showChat: () => ipcRenderer.send("azrael:show-chat"),
  onTerminalEvent: listener => { const handler = (_event, value) => listener(value); ipcRenderer.on("azrael:terminal-event", handler); return () => ipcRenderer.removeListener("azrael:terminal-event", handler); },
  onAction: listener => { const handler = (_event, value) => listener(value); ipcRenderer.on("azrael:action", handler); return () => ipcRenderer.removeListener("azrael:action", handler); },
}));
