"use strict";
const { app, BrowserWindow, WebContentsView, Notification, ipcMain, protocol, net, dialog, shell, clipboard, nativeTheme, safeStorage } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const Module = require("node:module");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { randomUUID } = require("node:crypto");
const { createVscodeHost } = require("./vscode-host.cjs");
const { readTextFile } = require("./file-service.cjs");
const { TerminalService } = require("./terminal-service.cjs");
const { DialogService } = require("./dialog-service.cjs");
const { themeCss, themeAttributes, applyTheme } = require("./theme.cjs");
const { transform: transformImageBridge } = require("./image-bridge.cjs");
const { createQuestionNotifications } = require("./question-notifications.cjs");

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
const extensionRoot = argument("--host") && path.resolve(argument("--host"));
const workspaceRoot = path.resolve(argument("--workspace") || process.cwd());
const verificationRoot = argument("--verification-root") && path.resolve(argument("--verification-root"));
const verificationBackend = verificationRoot && process.env.AZRAEL_DESKTOP_VERIFICATION_BACKEND;
const stateRoot = path.resolve(argument("--state") || verificationRoot && path.join(verificationRoot, "app-state") || path.join(app.getPath("userData"), "azrael-desktop"));
const theme = argument("--theme") || "system";
nativeTheme.themeSource = theme;
app.setPath("userData", stateRoot);
// Source launches have no installer-created AppUserModelID shortcut. Electron
// documents the executable identity for notifications in this development mode.
if (process.platform === "win32") app.setAppUserModelId(app.isPackaged ? "Azrael.Desktop" : process.execPath);
protocol.registerSchemesAsPrivileged([{ scheme: "azrael-app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
let window, host, runtime, terminal, nativeExtension, activePanel, primaryPanel, dialogs, fixtureSetup;
let modalVisible = false;
let detailWidth = 0, quitting = false, uiReady = false, finalExitCode = 0;
const panels = new Map(), providers = new Map(), customEditors = new Map(), serializers = new Map();
const errors = [];
const grantedImages = new Set();
const connectionStops = new Set();
const nativeChildren = new Set();
fs.mkdirSync(path.join(stateRoot, "logs"), { recursive: true });
const logFile = path.join(stateRoot, "logs", "desktop.ndjson");
function log(level, ...values) {
  const cause = values.find(value => value instanceof Error);
  const message = values.map(value => value instanceof Error ? value.message : typeof value === "string" ? value : "[structured event]").join(" ").replace(/(Bearer\s+|(?:token|password|api[_-]?key)[=:]\s*)[^\s,;]+/gi, "$1[redacted]");
  const entry = { timestamp: new Date().toISOString(), level, component: "desktop", event: cause ? "operation-failed" : "host-message", version: "0.1.0", platform: process.platform, message, ...(cause && { error: cause.name, code: cause.code }) };
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 4 * 1024 * 1024) {
      const previous = `${logFile}.1`;
      if (fs.existsSync(previous)) fs.unlinkSync(previous);
      fs.renameSync(logFile, previous);
    }
    fs.appendFileSync(logFile, JSON.stringify(entry) + "\n", { mode: 0o600 });
  } catch (failure) { process.stderr.write(`Desktop log unavailable: ${failure.code || failure.name}\n`); }
}
function sendAction(value) { if (uiReady && !window.isDestroyed()) window.webContents.send("azrael:action", value); }
function notifyError(cause) { errors.push(cause.message); log("error", cause); sendAction({ type: "error", message: cause.message }); }
const questionNotifications = createQuestionNotifications({
  Notification,
  activate(panel, hostId, threadId) {
    if (!window || window.isDestroyed() || panel.view.webContents.isDestroyed() || !panels.has(panel.view.webContents.id)) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
    showPanel(panel);
    panel.webview.postMessage({ type: "navigate-to-route", path: `/${encodeURIComponent(hostId)}/${encodeURIComponent(threadId)}` });
  },
  onError: () => log("warn", "question-notification-unavailable"),
});
function updatePanelTheme(panel, dark) {
  const contents = panel.view.webContents;
  panel.themeUpdate = (panel.themeUpdate || Promise.resolve()).then(async () => {
    if (contents.isDestroyed() || contents.isLoadingMainFrame()) return;
    await contents.executeJavaScript(applyTheme(dark));
  });
  void panel.themeUpdate.catch(notifyError);
}
process.on("unhandledRejection", cause => notifyError(cause instanceof Error ? cause : new Error(String(cause))));
process.on("uncaughtException", notifyError);
const within = (parent, child) => { const relative = path.relative(parent, child); return relative === "" || relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative); };

function updateLayout() {
  if (!window || window.isDestroyed()) return;
  const [width, height] = window.getContentSize();
  const panelWidth = Math.min(width, detailWidth);
  for (const panel of panels.values()) {
    const visible = !modalVisible && panel === activePanel && panelWidth < width;
    const changed = panel.visible !== visible;
    panel.visible = visible;
    panel.active = visible;
    panel.view.setVisible(visible);
    panel.view.setBounds({ x: 0, y: 44, width: Math.max(0, width - panelWidth), height: Math.max(0, height - 44) });
    if (changed) panel.changed.fire({ webviewPanel: panel });
  }
}
function showPanel(panel) { activePanel = panel; updateLayout(); panel.view.webContents.focus(); panel.changed.fire({ webviewPanel: panel }); }
function disposePanel(panel) {
  if (!panels.has(panel.view.webContents.id)) return;
  questionNotifications.disposePanel(panel);
  panels.delete(panel.view.webContents.id);
  window.contentView.removeChildView(panel.view);
  panel.view.webContents.close();
  panel.closed.fire();
  if (activePanel === panel) { activePanel = primaryPanel !== panel ? primaryPanel : [...panels.values()][0]; if (activePanel) showPanel(activePanel); }
}

function makePanel(viewType, title, _showOptions, options = {}) {
  const view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#171717" : "#ffffff");
  window.contentView.addChildView(view);
  const receive = new host.vscode.EventEmitter(), changed = new host.vscode.EventEmitter(), closed = new host.vscode.EventEmitter();
  const id = randomUUID();
  const filename = path.join(stateRoot, "views", `${id}.html`);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  let html = "", webviewState;
  const panel = {
    view, viewType, title, viewColumn: 1, active: false, visible: false, changed, closed,
    onDidDispose: closed.event, onDidChangeViewState: changed.event,
    reveal() { showPanel(panel); }, dispose() { disposePanel(panel); },
    webview: {
      options, cspSource: "azrael-app:", onDidReceiveMessage: receive.event,
      asWebviewUri(uri) { return host.vscode.Uri.from({ scheme: "azrael-app", authority: "resource", path: host.vscode.Uri.file(uri.fsPath).path }); },
      postMessage(message) { if (view.webContents.isDestroyed()) return Promise.resolve(false); view.webContents.send("azrael:host-message", message); if (panel === primaryPanel) questionNotifications.observe(panel, message); return Promise.resolve(true); },
      get html() { return html; },
      set html(value) {
        html = value;
        const dark = nativeTheme.shouldUseDarkColors, attributes = themeAttributes(dark);
        let decorated = value;
        for (const [tag, entries] of Object.entries(attributes)) {
          decorated = decorated.replace(new RegExp(`<${tag}\\b([^>]*)>`, "i"), (_, original) => {
            let existing = original;
            const attrs = { ...entries };
            if (attrs.class) {
              const classes = /\bclass=["']([^"']*)["']/i.exec(existing)?.[1]?.split(/\s+/) || [];
              attrs.class = [...classes.filter(name => !/^vscode-(?:dark|light)$/.test(name)), attrs.class].join(" ");
            }
            for (const key of Object.keys(attrs)) existing = existing.replace(new RegExp(`\\s${key}=["'][^"']*["']`, "ig"), "");
            return `<${tag}${Object.entries(attrs).map(([key, content]) => ` ${key}="${content}"`).join("")}${existing}>`;
          });
        }
        decorated = decorated.replace(/(<style\b[^>]*>)/i, (_, opening) => `${opening.replace(/>$/, ' id="azrael-desktop-theme">')}${themeCss(dark)}</style>${opening}`);
        fs.writeFileSync(filename, decorated);
        view.webContents.loadURL(`azrael-app://view/${id}.html`).catch(notifyError);
      },
    },
    receive, getState: () => webviewState, setState: value => { webviewState = value; },
  };
  panels.set(view.webContents.id, panel);
  view.webContents.setWindowOpenHandler(({ url }) => { void openExternal(host.vscode.Uri.parse(url)); return { action: "deny" }; });
  view.webContents.on("will-navigate", (event, url) => { if (!url.startsWith("azrael-app://")) { event.preventDefault(); void openExternal(host.vscode.Uri.parse(url)); } });
  view.webContents.on("did-finish-load", () => {
    updatePanelTheme(panel, nativeTheme.shouldUseDarkColors);
    log("info", "webview-loaded", viewType);
  });
  view.webContents.on("render-process-gone", (_event, detail) => { questionNotifications.disposePanel(panel); notifyError(new Error(`대화 화면 프로세스 종료: ${detail.reason}`)); });
  showPanel(panel);
  return panel;
}
function shellSender(event) { if (event.sender !== window.webContents) throw new Error("Untrusted desktop IPC sender"); }
async function openExternal(uri) {
  const value = uri.toString();
  if (!["https:", "http:", "mailto:"].includes(new URL(value).protocol)) throw new Error("지원하지 않는 외부 링크입니다.");
  await shell.openExternal(value);
  return true;
}
async function openTextFile(value) { sendAction({ type: "file", path: value.path, line: (value.line ?? 0) + 1, column: (value.column ?? 0) + 1 }); }
async function openFile(uri) {
  if (uri.scheme !== "file") return openExternal(uri);
  if (/\.(png|jpe?g|webp|gif|bmp|avif|svg|ico)$/i.test(uri.fsPath)) {
    if (!activePanel) throw new Error("이미지를 표시할 대화가 없습니다.");
    const physical = await fsp.realpath(uri.fsPath);
    grantedImages.add(physical);
    activePanel.view.webContents.send("azrael:image-open", { src: activePanel.webview.asWebviewUri(host.vscode.Uri.file(physical)).toString(), title: path.basename(physical), readOnly: true });
    return;
  }
  return openTextFile({ path: uri.fsPath });
}

async function bootstrap() {
  if (process.platform !== "win32") throw new Error("현재 독립 앱 수용 대상은 Windows x64입니다.");
  if (!extensionRoot || !fs.existsSync(path.join(extensionRoot, "out/azrael-runtime.cjs"))) throw new Error("검증된 Azrael host 경로를 --host로 지정해주세요.");
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"));
  if (manifest.name !== "azrael" || manifest.publisher !== "azrael-ex-local") throw new Error("Azrael 준비본만 사용할 수 있습니다.");
  if (!fs.statSync(workspaceRoot).isDirectory()) throw new Error("작업 폴더를 확인해주세요.");
  const uiRoot = path.join(stateRoot, "renderer");
  fs.mkdirSync(uiRoot, { recursive: true });
  await require("esbuild").build({ entryPoints: [path.join(__dirname, "renderer/shell.mjs")], bundle: true, format: "esm", outfile: path.join(uiRoot, "shell.js"), logLevel: "silent" });
  fs.copyFileSync(path.join(__dirname, "renderer/index.html"), path.join(uiRoot, "index.html"));
  protocol.handle("azrael-app", async request => {
    try {
      const url = new URL(request.url);
      let filename;
      if (url.host === "shell") filename = path.resolve(uiRoot, "." + decodeURIComponent(url.pathname));
      else if (url.host === "view") filename = path.resolve(stateRoot, "views", "." + decodeURIComponent(url.pathname));
      else if (url.host === "resource") filename = fileURLToPath("file://" + url.pathname);
      else return new Response("Not found", { status: 404 });
      const roots = [uiRoot, path.join(stateRoot, "views"), extensionRoot, workspaceRoot];
      const physical = await fsp.realpath(filename);
      if (!roots.some(root => within(root, physical)) && !grantedImages.has(physical)) return new Response("Forbidden", { status: 403 });
      if (path.extname(physical) === ".js" && within(extensionRoot, physical)) {
        return new Response(transformImageBridge(physical, await fsp.readFile(physical, "utf8")), { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
      }
      return net.fetch(pathToFileURL(physical).href);
    } catch (cause) { log("warn", cause); return new Response("Resource unavailable", { status: 404 }); }
  });
  window = new BrowserWindow({ width: 1440, height: 980, minWidth: 640, minHeight: 480, title: verificationRoot ? "Azrael · 검증" : "Azrael", show: true, backgroundColor: nativeTheme.shouldUseDarkColors ? "#171717" : "#fff", webPreferences: { preload: path.join(__dirname, "shell-preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.setMenuBarVisibility(false);
  nativeTheme.on("updated", () => {
    const dark = nativeTheme.shouldUseDarkColors;
    if (window.isDestroyed()) return;
    window.setBackgroundColor(dark ? "#171717" : "#ffffff");
    for (const panel of panels.values()) {
      if (panel.view.webContents.isDestroyed()) continue;
      panel.view.setBackgroundColor(dark ? "#171717" : "#ffffff");
      updatePanelTheme(panel, dark);
    }
    sendAction({ type: "theme", dark });
  });
  window.on("resize", updateLayout);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => { if (!url.startsWith("azrael-app://shell/")) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  if (verificationRoot) window.webContents.session.webRequest.onBeforeRequest((request, callback) => {
    if (request.url.startsWith("http://localhost:8000/")) return callback({ redirectURL: verificationBackend + request.url.slice("http://localhost:8000".length) });
    callback({ cancel: /^(?:https?|wss?):/.test(request.url) && !request.url.startsWith(verificationBackend + "/") });
  });
  ipcMain.on("azrael:state-read", event => { event.returnValue = panels.get(event.sender.id)?.getState(); });
  ipcMain.on("azrael:state-write", (event, value) => { const panel = panels.get(event.sender.id); if (!panel) throw new Error("Untrusted webview state sender"); panel.setState(value); });
  ipcMain.on("azrael:webview-message", (event, value) => { const panel = panels.get(event.sender.id); if (!panel) throw new Error("Untrusted webview sender"); panel.receive.fire(value); });
  ipcMain.on("azrael:layout", (event, value) => { shellSender(event); if (!Number.isFinite(value?.detailWidth) || value.detailWidth < 0) return; detailWidth = value.detailWidth; updateLayout(); });
  ipcMain.on("azrael:show-chat", event => { shellSender(event); if (primaryPanel) showPanel(primaryPanel); });
  const handle = (name, callback) => ipcMain.handle(name, (event, value) => { shellSender(event); return callback(value); });
  dialogs = new DialogService({ send: sendAction, onVisibility: visible => { modalVisible = visible; updateLayout(); } });
  handle("azrael:dialog", value => dialogs.handle(value));
  handle("azrael:copy-text", text => { if (typeof text !== "string") throw new Error("Invalid clipboard text"); clipboard.writeText(text); });
  handle("azrael:read-text", readTextFile);
  handle("azrael:choose-file", async () => (await dialog.showOpenDialog(window, { properties: ["openFile"], title: "텍스트 문서 열기" })).filePaths[0]);
  for (const method of ["create", "write", "resize", "close"]) handle(`azrael:terminal-${method}`, value => { if (!terminal) throw new Error("터미널 엔진에 연결 중입니다."); return terminal[method](value); });
  await window.loadURL(`azrael-app://shell/index.html?workspace=${encodeURIComponent(workspaceRoot)}&theme=${nativeTheme.shouldUseDarkColors ? "dark" : "light"}`);
  uiReady = true;
  const secretFile = path.join(stateRoot, "secrets.json");
  const secretValues = fs.existsSync(secretFile) ? JSON.parse(fs.readFileSync(secretFile, "utf8")) : {};
  const persistSecrets = () => fs.writeFileSync(secretFile, JSON.stringify(secretValues), { mode: 0o600 });
  const adapter = {
    language: app.getLocale().split("-")[0], clipboard,
    registerViewProvider(id, provider) { providers.set(id, provider); return { dispose: () => providers.delete(id) }; },
    createWebviewPanel: makePanel,
    registerCustomEditorProvider(id, provider) { customEditors.set(id, provider); return { dispose: () => customEditors.delete(id) }; },
    registerWebviewPanelSerializer(id, serializer) { serializers.set(id, serializer); return { dispose: () => serializers.delete(id) }; },
    openTextFile, openFile, revealFile: uri => shell.showItemInFolder(uri.fsPath), openExternal,
    closeActivePanel: () => activePanel?.dispose(),
    async focusView(id) { if (primaryPanel) showPanel(primaryPanel); else await resolveView(id); },
    async executeCommand(id, ...args) {
      if (id.endsWith(".focus")) return adapter.focusView(id.slice(0, -6));
      if (id === "workbench.action.closeActiveEditor") return adapter.closeActivePanel();
      if (id === "workbench.action.openSettings" && args[0] === "@ext:azrael-ex-local.azrael") return host.vscode.commands.executeCommand("azrael.openSettingsPanel");
      if (id === "workbench.action.openSettings" && args[0] === "azrael.instructions.repository") {
        const config = host.vscode.workspace.getConfiguration("azrael");
        const value = await dialogs.requestInput({ title: "지침 배포 소스", prompt: "GitHub owner/repository", value: config.get("instructions.repository", "felrer/Azrael") });
        if (value !== undefined) await config.update("instructions.repository", value.trim());
        return;
      }
      if (id === "workbench.action.openSettings") throw new Error(`독립 앱에서 이 호스트 설정의 연결은 아직 준비되지 않았습니다: ${args[0] || ""}`);
      if (id === "vscode.openFolder") throw new Error("작업 폴더는 --workspace 실행 인자로 선택해주세요.");
      throw new Error(`지원하지 않는 호스트 명령: ${id}`);
    },
    async showMessage(kind, message, options, items) {
      log(kind === "error" ? "error" : "info", "host-notification", message);
      if (verificationRoot && !options.modal) return undefined;
      const buttons = items.map(item => typeof item === "string" ? item : item.title);
      const result = await dialog.showMessageBox(window, { type: kind, message, detail: options.detail, buttons: [...buttons, "닫기"], cancelId: buttons.length });
      return items[result.response];
    },
    async showOpenDialog(options = {}) { const result = await dialog.showOpenDialog(window, { title: options.title, defaultPath: options.defaultUri?.fsPath, filters: options.filters && Object.entries(options.filters).map(([name, extensions]) => ({ name, extensions })), properties: [options.canSelectFolders ? "openDirectory" : "openFile", ...(options.canSelectMany ? ["multiSelections"] : [])] }); return result.canceled ? undefined : result.filePaths.map(host.vscode.Uri.file); },
    async showSaveDialog(options = {}) { const result = await dialog.showSaveDialog(window, { title: options.title, defaultPath: options.defaultUri?.fsPath }); return result.canceled ? undefined : host.vscode.Uri.file(result.filePath); },
    showInputBox: (options, token) => dialogs.requestInput(options, token),
    showQuickPick: (items, options, token) => dialogs.requestPick(items, options, token),
    createTerminal() { sendAction({ type: "terminal" }); throw new Error("직접 터미널은 앱 상단의 터미널 버튼을 사용해주세요."); },
    registerUriHandler(handler) { const listener = (_event, url) => handler.handleUri(host.vscode.Uri.parse(url)); app.on("open-url", listener); return { dispose: () => app.off("open-url", listener) }; },
    getTabGroups() { const tabs = [...panels.values()].map(panel => ({ label: panel.title, input: new host.vscode.TabInputCustom(host.vscode.Uri.file(workspaceRoot), panel.viewType), isActive: panel === activePanel, isDirty: false, isPinned: true, isPreview: false })); return [{ isActive: true, viewColumn: 1, tabs, activeTab: tabs.find(tab => tab.isActive) }]; },
    showOutput: name => sendAction({ type: "error", message: `${name}: 진단 로그 ${logFile}` }), hideOutput() {}, clearOutput() { throw new Error("진단 로그는 파일 회전 정책으로 관리됩니다."); },
    setStatusItem(item, visible) { if (visible) log("info", "status", item.text); },
    secrets: {
      async get(key) { if (!secretValues[key]) return undefined; if (!safeStorage.isEncryptionAvailable()) throw new Error("OS 보안 저장소를 사용할 수 없습니다."); return safeStorage.decryptString(Buffer.from(secretValues[key], "base64")); },
      async store(key, value) { if (!safeStorage.isEncryptionAvailable()) throw new Error("OS 보안 저장소를 사용할 수 없습니다."); secretValues[key] = safeStorage.encryptString(value).toString("base64"); persistSecrets(); },
      async delete(key) { delete secretValues[key]; persistSecrets(); },
    },
  };
  host = createVscodeHost({ extensionRoot, workspaceRoot, stateRoot, adapter, log });
  if (verificationRoot) {
    await host.vscode.workspace.getConfiguration("azrael").update("apiEndpoint", "localhost");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, options) => {
      const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (target.origin === "http://localhost:8000") {
        const mapped = verificationBackend + target.pathname + target.search;
        return originalFetch(typeof input === "string" || input instanceof URL ? mapped : new Request(mapped, input), options);
      }
      if (target.origin !== verificationBackend) return Promise.reject(new Error("External HTTP is disabled in the desktop fixture."));
      return originalFetch(input, options);
    };
  }
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "vscode" && parent?.filename && within(extensionRoot, parent.filename)) return host.vscode;
    if (["child_process", "node:child_process"].includes(request) && parent?.filename && within(extensionRoot, parent.filename)) {
      const native = originalLoad.call(this, request, parent, isMain);
      return { ...native, spawn(executable, args, options) {
        const child = native.spawn(executable, args, options);
        if (runtime?.engine && path.resolve(executable).toLowerCase() === path.resolve(runtime.engine).toLowerCase()) {
          nativeChildren.add(child);
          child.once("close", () => nativeChildren.delete(child));
          log("info", "native-engine-spawn", JSON.stringify({ pid: child.pid, windowScoped: !!options?.env?.AZRAEL_EX_WINDOW_CONTEXT, homeScoped: options?.env?.CODEX_HOME === runtime.codexHome }));
          child.once("exit", (code, signal) => log("info", "native-engine-close", JSON.stringify({ pid: child.pid, code, signal })));
        }
        return child;
      } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const runtimeModule = require(path.join(extensionRoot, "out/azrael-runtime.cjs"));
  runtime = await runtimeModule.initialize();
  // A newly launched app owns its window identity. Never inherit its launcher’s
  // account selection or connection scope (including launches from an agent PTY).
  for (const key of Object.keys(runtime.env)) {
    if (["AZRAEL_EX_WINDOW_CONTEXT", "AZRAEL_EX_MANAGEMENT_SOCKET", "AZRAEL_EX_ACCOUNT_STATE_FILE", "AZRAEL_EX_ACCOUNT_DEFAULT_FILE"].includes(key.toUpperCase())) delete runtime.env[key];
  }
  if (verificationRoot) {
    runtime.codexHome = path.join(verificationRoot, "engine-home");
    fs.mkdirSync(runtime.codexHome, { recursive: true });
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(verificationBackend)) throw new Error("A loopback verification backend is required.");
    fs.writeFileSync(path.join(runtime.codexHome, "config.toml"), `sandbox_mode = "danger-full-access"\napproval_policy = "never"\ncli_auth_credentials_store = "file"\nchatgpt_base_url = "${verificationBackend}/backend-api"\nmodel_catalog_json = ${JSON.stringify(path.join(verificationRoot, "models.json"))}\n[features]\napps = false\nplugins = false\nremote_plugin = false\nplugin_sharing = false\n`);
    const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600, email: "fixture@example.invalid", "https://api.openai.com/auth": { chatgpt_plan_type: "plus", chatgpt_user_id: "desktop-fixture", chatgpt_account_id: "desktop-fixture" } })}.c2lnbmF0dXJl`;
    fs.writeFileSync(path.join(runtime.codexHome, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { id_token: token, access_token: token, refresh_token: "desktop-fixture", account_id: "desktop-fixture" }, last_refresh: new Date().toISOString() }));
    runtime.env.CODEX_HOME = runtime.codexHome;
    const { accountFixtureEnvironment } = await import(pathToFileURL(path.resolve(__dirname, "../../scripts/account-fixture-environment.mjs")).href);
    Object.assign(runtime.env, accountFixtureEnvironment(runtime.env, { stateDirectory: runtime.codexHome, socketPath: "", baseUrl: verificationBackend, autoSwitchOnly: true }));
    runtime.localHistory = undefined;
  }
  const source = path.resolve(__dirname, "../../extensions/azrael-ex/src/appServerTransport.ts");
  const transportModule = new Module(source, module); transportModule.filename = source; transportModule.paths = Module._nodeModulePaths(path.dirname(source));
  const transportRequire = transportModule.require.bind(transportModule);
  transportModule.require = request => {
    const dependency = transportRequire(request);
    if (request !== "node:child_process") return dependency;
    return { ...dependency, spawn(...args) {
      const child = dependency.spawn(...args);
      const stopped = new Promise(resolve => child.once("close", resolve));
      connectionStops.add(stopped);
      void stopped.then(() => connectionStops.delete(stopped));
      log("info", "connection-engine-spawn", JSON.stringify({ pid: child.pid, windowScoped: !!args[2]?.env?.AZRAEL_EX_WINDOW_CONTEXT }));
      child.once("exit", (code, signal) => log("info", "connection-engine-close", JSON.stringify({ pid: child.pid, code, signal })));
      if (verificationRoot) {
        let remaining = 4096;
        child.stderr.on("data", chunk => { if (remaining > 0) { const value = chunk.subarray(0, remaining); remaining -= value.length; log("info", "verification-engine-stderr", value.toString()); } });
      }
      return child;
    } };
  };
  transportModule._compile(require("esbuild").transformSync(fs.readFileSync(source, "utf8"), { loader: "ts", format: "cjs", target: "node22" }).code, source);
  const connectionOptions = { executable: runtime.engine, args: ["-c", "features.code_mode_host=true", "app-server", "--analytics-default-enabled"], cwd: workspaceRoot, env: runtime.env, clientInfo: { name: "azrael-desktop-terminal", version: "0.1.0" } };
  if (verificationRoot) {
    const setup = fixtureSetup = new transportModule.exports.AppServerTransport({ ...connectionOptions, requestTimeoutMs: 60000 });
    try {
      await setup.start();
      await setup.request("azrael/account", { action: "captureCurrent", includeDetails: false });
      const account = await setup.request("azrael/account", { action: "list", includeDetails: false });
      if (!account.state?.activeProfileId) throw new Error("The synthetic account profile was not captured.");
    } catch (cause) { setup.dispose(); fixtureSetup = undefined; await Promise.allSettled([...connectionStops]); throw cause; }
  }
  nativeExtension = require(path.join(extensionRoot, manifest.main));
  let activationTimer;
  try {
    const activation = nativeExtension.activate(host.context);
    if (verificationRoot) await Promise.race([activation, new Promise((_, reject) => { activationTimer = setTimeout(() => reject(new Error("기존 채팅 호스트 활성화가 40초 안에 완료되지 않았습니다.")), 40000); })]);
    else await activation;
  } finally { clearTimeout(activationTimer); }
  const transport = new transportModule.exports.AppServerTransport({ ...connectionOptions, requestTimeoutMs: 60000 });
  transport.on("serverRequest", request => transport.respondError(request.id, -32601, "이 터미널 연결은 에이전트 승인 요청을 처리하지 않습니다."));
  await transport.start();
  // Keep the fixture's initial connection until the registered window is ready;
  // otherwise daemon idle shutdown races the native host's cold start.
  fixtureSetup?.dispose();
  fixtureSetup = undefined;
  terminal = new TerminalService(transport, value => window.webContents.send("azrael:terminal-event", value), { shell: "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", ...(verificationRoot && { shellArgs: ["-NoLogo", "-NoProfile"] }) });
  const preferred = [...providers.keys()].find(id => /sidebarView$/i.test(id)) || [...providers.keys()][0];
  if (!preferred && !primaryPanel) throw new Error("기존 채팅 Webview provider가 등록되지 않았습니다.");
  if (!primaryPanel) await resolveView(preferred);
  log("info", "desktop-ready", manifest.version);
  if (verificationRoot) {
    const auth = await transport.request("account/read", { refreshToken: false });
    log("info", "verification-auth-kind", auth?.account?.type || "none");
    await verify();
  }
  async function resolveView(id) {
    const provider = providers.get(id);
    if (!provider) throw new Error(`Webview provider를 찾을 수 없습니다: ${id}`);
    const panel = makePanel(id, "Azrael", {}, {});
    panel.onDidChangeVisibility = panel.changed.event;
    panel.show = () => showPanel(panel);
    primaryPanel = panel;
    await provider.resolveWebviewView(panel, {}, new host.vscode.CancellationTokenSource().token);
  }
}

async function verify() {
  const verifier = require("./verification.cjs").verify;
  const options = { window, primaryPanel, terminal, dialogs, openFile, sendAction, uri: host.vscode.Uri, workspace: workspaceRoot, errors };
  let result;
  if (process.argv.includes("--verify-both-themes")) {
    result = { themes: {}, errors: [] };
    for (const mode of ["dark", "light"]) {
      nativeTheme.themeSource = mode;
      window.setSize(1440, 980);
      const root = path.join(verificationRoot, mode);
      await fsp.mkdir(root, { recursive: true });
      result.themes[mode] = await verifier({ ...options, root, expectedDark: mode === "dark" });
      result.errors.push(...result.themes[mode].errors.map(message => `${mode}: ${message}`));
    }
    await fsp.writeFile(path.join(verificationRoot, "result.json"), JSON.stringify(result, null, 2));
  } else result = await verifier({ ...options, root: verificationRoot, expectedDark: nativeTheme.shouldUseDarkColors });
  finalExitCode = result.errors.length ? 1 : 0;
  app.quit();
}
app.whenReady().then(bootstrap).catch(async cause => {
  if (cause.userNotified && ["AZRAEL_STORAGE_INCOMPATIBLE", "AZRAEL_STORAGE_ADMISSION_UNAVAILABLE"].includes(cause.code)) {
    // The shared host already presented the actionable startup dialog. Closing
    // it stops this app without another generic error or any engine termination.
    log("error", "engine-startup-blocked", cause.code);
    finalExitCode = 1;
    app.quit();
    return;
  }
  notifyError(cause);
  if (verificationRoot) { await fsp.writeFile(path.join(verificationRoot, "failure.json"), JSON.stringify({ message: cause.message, stack: cause.stack }, null, 2)); finalExitCode = 1; app.quit(); }
  else { dialog.showErrorBox("Azrael 실행 실패", `${cause.message}\n\n진단 로그: ${logFile}`); app.quit(); }
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", event => {
  if (quitting) return;
  event.preventDefault(); quitting = true;
  Promise.resolve().then(async () => {
    log("info", "desktop-stopping", "terminal");
    dialogs?.dispose();
    questionNotifications.dispose();
    fixtureSetup?.dispose();
    await terminal?.dispose();
    await Promise.allSettled([...connectionStops]);
    log("info", "desktop-stopping", "native");
    // End owned stdio proxy inputs before deactivation waits for their close.
    for (const child of nativeChildren) if (!child.stdin?.destroyed) child.stdin?.end();
    await nativeExtension?.deactivate?.();
    log("info", "desktop-stopping", "storage");
    await host?.dispose();
    // Window leases are released after this host identity exits. Waiting here
    // for its native proxy would keep that identity alive and prevent shutdown.
    log("info", "desktop-stopped");
  }).catch(cause => { notifyError(cause); finalExitCode = 1; }).finally(() => app.exit(finalExitCode));
});
