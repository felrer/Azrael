'use strict';
// The desktop host implements only capabilities backed by its native adapter.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');

class Disposable {
  constructor(fn = () => {}) { this.fn = fn; }
  dispose() { const fn = this.fn; this.fn = undefined; fn?.(); }
  static from(...items) { return new Disposable(() => items.forEach(item => item?.dispose())); }
}
class EventEmitter {
  constructor() {
    this.listeners = new Set();
    this.event = (listener, thisArg, disposables) => {
      const bound = thisArg ? listener.bind(thisArg) : listener;
      this.listeners.add(bound);
      const subscription = new Disposable(() => this.listeners.delete(bound));
      disposables?.push(subscription);
      return subscription;
    };
  }
  fire(value) { for (const listener of [...this.listeners]) listener(value); }
  dispose() { this.listeners.clear(); }
}
class Uri {
  constructor(scheme, authority = '', pathname = '', query = '', fragment = '') {
    Object.assign(this, { scheme, authority, path: pathname, query, fragment });
  }
  static file(filename) { return Uri.parse(pathToFileURL(path.resolve(filename)).href); }
  static parse(value, strict = false) {
    const match = /^([a-z][a-z0-9+.-]*):/i.exec(value);
    if (!match) { if (strict) throw new Error(`Invalid URI: ${value}`); return new Uri('', '', value); }
    const url = new URL(value);
    return new Uri(url.protocol.slice(0, -1), url.host, decodeURIComponent(url.pathname), url.search.slice(1), url.hash.slice(1));
  }
  static from(parts) { return new Uri(parts.scheme, parts.authority, parts.path, parts.query, parts.fragment); }
  static joinPath(base, ...segments) { return base.with({ path: path.posix.join(base.path, ...segments) }); }
  static isUri(value) { return value instanceof Uri; }
  get fsPath() { return this.scheme === 'file' ? fileURLToPath(this.toString()) : this.path; }
  with(change) { return Uri.from({ ...this, ...change }); }
  toString(skipEncoding = false) {
    const pathname = skipEncoding ? this.path : this.path.split('/').map(encodeURIComponent).join('/').replace(/^\/([A-Za-z])%3A/, '/$1:');
    return `${this.scheme}:${this.authority || this.scheme === 'file' ? `//${this.authority}` : ''}${pathname}${this.query ? `?${this.query}` : ''}${this.fragment ? `#${this.fragment}` : ''}`;
  }
  toJSON() { return { scheme: this.scheme, authority: this.authority, path: this.path, query: this.query, fragment: this.fragment }; }
}
class Position {
  constructor(line, character) { if (line < 0 || character < 0) throw new RangeError('Negative position'); this.line = line; this.character = character; }
  compareTo(other) { return Math.sign(this.line - other.line || this.character - other.character); }
  isBefore(other) { return this.compareTo(other) < 0; }
  isBeforeOrEqual(other) { return this.compareTo(other) <= 0; }
  isAfter(other) { return this.compareTo(other) > 0; }
  isAfterOrEqual(other) { return this.compareTo(other) >= 0; }
  isEqual(other) { return this.compareTo(other) === 0; }
  translate(lineDelta = 0, characterDelta = 0) { if (typeof lineDelta === 'object') return this.translate(lineDelta.lineDelta, lineDelta.characterDelta); return new Position(this.line + lineDelta, this.character + characterDelta); }
  with(line = this.line, character = this.character) { if (typeof line === 'object') return this.with(line.line ?? this.line, line.character ?? this.character); return new Position(line, character); }
}
class Range {
  constructor(a, b, c, d) {
    let start = typeof a === 'number' ? new Position(a, b) : a;
    let end = typeof a === 'number' ? new Position(c, d) : b;
    if (start.isAfter(end)) [start, end] = [end, start];
    Object.assign(this, { start, end });
  }
  get isEmpty() { return this.start.isEqual(this.end); }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(value) { return value instanceof Range ? this.contains(value.start) && this.contains(value.end) : this.start.isBeforeOrEqual(value) && this.end.isAfterOrEqual(value); }
  intersection(other) { const start = this.start.isAfter(other.start) ? this.start : other.start; const end = this.end.isBefore(other.end) ? this.end : other.end; return start.isAfter(end) ? undefined : new Range(start, end); }
  union(other) { return new Range(this.start.isBefore(other.start) ? this.start : other.start, this.end.isAfter(other.end) ? this.end : other.end); }
  with(start = this.start, end = this.end) { return start instanceof Position ? new Range(start, end) : new Range(start.start ?? this.start, start.end ?? this.end); }
}
class Selection extends Range {
  constructor(a, b, c, d) { const anchor = typeof a === 'number' ? new Position(a, b) : a; const active = typeof a === 'number' ? new Position(c, d) : b; super(anchor, active); Object.assign(this, { anchor, active }); }
  get isReversed() { return this.anchor.isAfter(this.active); }
}
class RelativePattern { constructor(base, pattern) { this.baseUri = typeof base === 'string' ? Uri.file(base) : base.uri ?? base; this.base = this.baseUri.fsPath; this.pattern = pattern; } }
class CodeLens { constructor(range, command) { Object.assign(this, { range, command }); } get isResolved() { return !!this.command; } }
class ThemeColor { constructor(id) { this.id = id; } }
class ThemeIcon { constructor(id, color) { Object.assign(this, { id, color }); } }
class TabInputText { constructor(uri) { this.uri = uri; } }
class TabInputCustom { constructor(uri, viewType) { Object.assign(this, { uri, viewType }); } }
class Task { constructor() { throw new Error('VS Code tasks unavailable; use the desktop terminal'); } }
class ShellExecution { constructor() { throw new Error('VS Code shell tasks unavailable; use the desktop terminal'); } }
class CancellationTokenSource {
  constructor() { this.emitter = new EventEmitter(); this.token = { isCancellationRequested: false, onCancellationRequested: this.emitter.event }; }
  cancel() { if (!this.token.isCancellationRequested) { this.token.isCancellationRequested = true; this.emitter.fire(undefined); } }
  dispose(cancel = false) { if (cancel) this.cancel(); this.emitter.dispose(); }
}

function createVscodeHost({ extensionRoot, workspaceRoot, stateRoot, adapter = {}, log = console }) {
  for (const [name, value] of Object.entries({ extensionRoot, workspaceRoot, stateRoot })) if (!path.isAbsolute(value)) throw new Error(`${name} must be absolute`);
  const unsupported = name => { throw new Error(`Azrael desktop does not support ${name}`); };
  const invoke = (name, ...args) => typeof adapter[name] === 'function' ? adapter[name](...args) : unsupported(name);
  const writeLog = (level, ...args) => typeof log === 'function' ? log(level, ...args) : (log[level] ?? log.log)?.call(log, ...args);
  const owned = [];
  const event = () => { const emitter = new EventEmitter(); owned.push(emitter); return emitter; };
  const configurationChanges = event(), openDocuments = event(), closeDocuments = event(), activeEditors = event(), selectionChanges = event(), visibleEditors = event(), windowChanges = event(), terminalOpened = event(), terminalClosed = event(), shellIntegrationChanges = event(), tabsChanged = event(), tabGroupsChanged = event();
  const workspaceId = createHash('sha256').update(path.resolve(workspaceRoot)).digest('hex');
  const storage = path.join(stateRoot, 'workspaces', workspaceId);
  for (const dir of [stateRoot, storage, path.join(stateRoot, 'global-storage'), path.join(stateRoot, 'logs')]) fs.mkdirSync(dir, { recursive: true });
  function memento(filename) {
    let values = {};
    try { values = JSON.parse(fs.readFileSync(filename, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let pending = Promise.resolve();
    return {
      get(key, fallback) { return Object.hasOwn(values, key) ? values[key] : fallback; },
      keys() { return Object.keys(values); },
      update(key, value) {
        const next = { ...values }; if (value === undefined) delete next[key]; else next[key] = value;
        // Serialize calls before publishing the new state; each rename is atomic.
        values = next;
        const serialized = JSON.stringify(next, null, 2);
        const task = pending.then(async () => {
          const temporary = `${filename}.${randomUUID()}.tmp`;
          try { await fsp.writeFile(temporary, serialized, { flag: 'wx' }); await fsp.rename(temporary, filename); }
          catch (error) { try { await fsp.unlink(temporary); } catch (cleanup) { if (cleanup.code !== 'ENOENT') writeLog('error', cleanup); } throw error; }
        });
        pending = task.catch(() => {}); return task;
      },
      setKeysForSync() { unsupported('settings sync'); },
      flush() { return pending; },
    };
  }
  const globalState = memento(path.join(stateRoot, 'global-state.json'));
  const workspaceState = memento(path.join(storage, 'workspace-state.json'));
  const configurationState = memento(path.join(stateRoot, 'configuration.json'));
  const packageJSON = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
  const defaults = {};
  for (const contribution of [].concat(packageJSON.contributes?.configuration ?? [])) for (const [key, spec] of Object.entries(contribution.properties ?? {})) if ('default' in spec) defaults[key] = spec.default;
  const envMutators = new Map();
  const environmentVariableCollection = {
    persistent: true, description: undefined,
    replace(variable, value, options) { envMutators.set(variable, { variable, value, type: 1, options }); },
    append(variable, value, options) { envMutators.set(variable, { variable, value, type: 2, options }); },
    prepend(variable, value, options) { envMutators.set(variable, { variable, value, type: 3, options }); },
    get(variable) { return envMutators.get(variable); }, delete(variable) { envMutators.delete(variable); }, clear() { envMutators.clear(); },
    forEach(callback, thisArg) { envMutators.forEach((value, key) => callback.call(thisArg, key, value, environmentVariableCollection)); },
    [Symbol.iterator]() { return envMutators[Symbol.iterator](); },
    getScoped(scope) { if (scope?.workspaceFolder && scope.workspaceFolder.uri.fsPath !== workspaceRoot) unsupported('environment scope outside selected workspace'); return environmentVariableCollection; },
    applyTo(environment) { const result = { ...environment }; for (const [key, item] of envMutators) result[key] = item.type === 1 ? item.value : item.type === 2 ? (result[key] ?? '') + item.value : item.value + (result[key] ?? ''); return result; },
  };
  const secretsChanged = event();
  const context = {
    subscriptions: [], extensionPath: extensionRoot, extensionUri: Uri.file(extensionRoot), extensionMode: 1, packageJSON,
    globalState, workspaceState, environmentVariableCollection,
    globalStorageUri: Uri.file(path.join(stateRoot, 'global-storage')), storageUri: Uri.file(storage), logUri: Uri.file(path.join(stateRoot, 'logs')),
    globalStoragePath: path.join(stateRoot, 'global-storage'), storagePath: storage, logPath: path.join(stateRoot, 'logs'),
    asAbsolutePath: relative => path.resolve(extensionRoot, relative),
    secrets: { get: key => invokeSecret('get', key), store: async (key, value) => { await invokeSecret('store', key, value); secretsChanged.fire({ key }); }, delete: async key => { await invokeSecret('delete', key); secretsChanged.fire({ key }); }, onDidChange: secretsChanged.event },
    extension: { id: `${packageJSON.publisher}.${packageJSON.name}`, packageJSON, extensionPath: extensionRoot, extensionUri: Uri.file(extensionRoot), isActive: true },
  };
  function invokeSecret(name, ...args) { if (!adapter.secrets?.[name]) return Promise.reject(new Error(`Secret storage ${name} unavailable`)); return Promise.resolve(adapter.secrets[name](...args)); }
  const commandMap = new Map(), contexts = new Map(), providers = new Map(), lensProviders = new Set(), documents = new Map(), terminals = [];
  const commands = {
    registerCommand(id, callback, thisArg) { if (commandMap.has(id)) throw new Error(`Command already registered: ${id}`); commandMap.set(id, (...args) => callback.apply(thisArg, args)); return new Disposable(() => commandMap.delete(id)); },
    registerTextEditorCommand() { unsupported('mutating text editor commands'); },
    async getCommands() { return [...commandMap.keys()]; },
    async executeCommand(id, ...args) {
      if (commandMap.has(id)) return commandMap.get(id)(...args);
      if (id === 'setContext') { contexts.set(args[0], args[1]); return; }
      if (id === 'getContext') return contexts.get(args[0]);
      if (id === 'vscode.open' || id === 'vscode.openWith') return invoke('openFile', args[0], ...args.slice(1));
      if (id === 'revealFileInOS') return invoke('revealFile', args[0]);
      if (id === 'workbench.action.closeActiveEditor') return invoke('closeActivePanel');
      if (id === 'workbench.view.extension.azraelViewContainer' || id === 'workbench.view.extension.codex') return invoke('focusView', 'chatgpt.sidebar');
      if (id.endsWith('.focus') && providers.has(id.slice(0, -6))) return invoke('focusView', id.slice(0, -6));
      return invoke('executeCommand', id, ...args);
    },
  };
  function localPath(uri) { const value = typeof uri === 'string' ? Uri.file(uri) : uri; if (value.scheme !== 'file') unsupported(`filesystem scheme ${value.scheme}`); return value.fsPath; }
  const fileType = stat => stat.isSymbolicLink() ? 64 : stat.isDirectory() ? 2 : stat.isFile() ? 1 : 0;
  const workspaceFs = {
    async stat(uri) { const info = await fsp.lstat(localPath(uri)); return { type: fileType(info), ctime: info.birthtimeMs, mtime: info.mtimeMs, size: info.size }; },
    async readFile(uri) { return new Uint8Array(await fsp.readFile(localPath(uri))); },
    async readDirectory(uri) { return (await fsp.readdir(localPath(uri), { withFileTypes: true })).map(entry => [entry.name, fileType(entry)]); },
    async createDirectory(uri) { await fsp.mkdir(localPath(uri), { recursive: true }); },
    async writeFile(uri, content) { await fsp.writeFile(localPath(uri), content); },
    async delete(uri, options = {}) { if (options.useTrash) return invoke('trashFile', uri); const filename = localPath(uri); const info = await fsp.lstat(filename); if (info.isDirectory()) await fsp.rm(filename, { recursive: !!options.recursive }); else await fsp.unlink(filename); },
    async rename(source, target, options = {}) { if (!options.overwrite && fs.existsSync(localPath(target))) throw new Error('Target already exists'); await fsp.rename(localPath(source), localPath(target)); },
    async copy(source, target, options = {}) { await fsp.cp(localPath(source), localPath(target), { recursive: true, force: !!options.overwrite, errorOnExist: !options.overwrite }); },
  };
  const languageIds = { '.md': 'markdown', '.markdown': 'markdown', '.js': 'javascript', '.cjs': 'javascript', '.mjs': 'javascript', '.ts': 'typescript', '.tsx': 'typescriptreact', '.jsx': 'javascriptreact', '.json': 'json', '.py': 'python', '.rs': 'rust', '.html': 'html', '.css': 'css', '.yaml': 'yaml', '.yml': 'yaml', '.ps1': 'powershell', '.sh': 'shellscript' };
  async function openTextDocument(input) {
    if (!input || (typeof input === 'object' && !input.scheme)) unsupported('untitled or editable text documents');
    const uri = typeof input === 'string' ? Uri.file(input) : input;
    const text = await fsp.readFile(localPath(uri), 'utf8');
    const lines = text.split(/\r\n|\n|\r/), offsets = [0];
    for (const match of text.matchAll(/\r\n|\n|\r/g)) offsets.push(match.index + match[0].length);
    const doc = {
      uri, fileName: uri.fsPath, isUntitled: false, isDirty: false, isClosed: false, version: 1,
      languageId: languageIds[path.extname(uri.fsPath).toLowerCase()] ?? 'plaintext', lineCount: lines.length, eol: text.includes('\r\n') ? 2 : 1,
      getText(range) { return range ? text.slice(doc.offsetAt(range.start), doc.offsetAt(range.end)) : text; },
      offsetAt(position) { const p = doc.validatePosition(position); return offsets[p.line] + p.character; },
      positionAt(offset) { offset = Math.max(0, Math.min(text.length, offset)); let line = 0; while (line + 1 < offsets.length && offsets[line + 1] <= offset) line++; return new Position(line, Math.min(offset - offsets[line], lines[line].length)); },
      validatePosition(position) { const line = Math.max(0, Math.min(lines.length - 1, position.line)); return new Position(line, Math.max(0, Math.min(lines[line].length, position.character))); },
      validateRange(range) { return new Range(doc.validatePosition(range.start), doc.validatePosition(range.end)); },
      lineAt(inputLine) { const line = typeof inputLine === 'number' ? inputLine : inputLine.line; if (line < 0 || line >= lines.length) throw new RangeError('Line outside document'); const value = lines[line]; return { lineNumber: line, text: value, range: new Range(line, 0, line, value.length), rangeIncludingLineBreak: line + 1 < lines.length ? new Range(line, 0, line + 1, 0) : new Range(line, 0, line, value.length), firstNonWhitespaceCharacterIndex: value.search(/\S/) < 0 ? value.length : value.search(/\S/), isEmptyOrWhitespace: !value.trim() }; },
      save: () => Promise.reject(new Error('Desktop text viewer is read-only')),
    };
    documents.set(uri.toString(), doc); openDocuments.fire(doc); return doc;
  }
  const workspaceFolder = { uri: Uri.file(workspaceRoot), name: path.basename(workspaceRoot), index: 0 };
  const workspace = {
    fs: workspaceFs, workspaceFolders: [workspaceFolder], name: workspaceFolder.name, rootPath: workspaceRoot, isTrusted: true,
    get textDocuments() { return [...documents.values()]; },
    onDidOpenTextDocument: openDocuments.event, onDidCloseTextDocument: closeDocuments.event, onDidChangeConfiguration: configurationChanges.event,
    onDidChangeTextDocument: event().event, onDidChangeWorkspaceFolders: event().event, onDidGrantWorkspaceTrust: event().event,
    openTextDocument,
    getWorkspaceFolder(uri) { const relative = path.relative(workspaceRoot, uri.fsPath); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? workspaceFolder : undefined; },
    asRelativePath(value, includeWorkspaceFolder = false) { const filename = typeof value === 'string' ? value : value.fsPath; const folder = workspace.getWorkspaceFolder(Uri.file(filename)); return folder ? (includeWorkspaceFolder ? folder.name + '/' : '') + path.relative(workspaceRoot, filename).split(path.sep).join('/') : filename; },
    getConfiguration(section = '') {
      const full = key => section && key ? `${section}.${key}` : section || key;
      const get = (key, fallback) => configurationState.get(full(key), Object.hasOwn(defaults, full(key)) ? defaults[full(key)] : fallback);
      return { get, has: key => get(key) !== undefined,
        inspect: key => ({ key: full(key), defaultValue: defaults[full(key)], globalValue: configurationState.get(full(key)) }),
        async update(key, value) { const changed = full(key); await configurationState.update(changed, value); configurationChanges.fire({ affectsConfiguration: candidate => changed === candidate || changed.startsWith(candidate + '.') || candidate.startsWith(changed + '.') }); },
      };
    },
    async findFiles(include, exclude, maxResults, token) {
      if (token?.isCancellationRequested) return [];
      const glob = require('fast-glob');
      const cwd = typeof include === 'string' ? workspaceRoot : include.baseUri.fsPath;
      const pattern = typeof include === 'string' ? include : include.pattern;
      const ignore = exclude === null ? [] : [typeof exclude === 'string' ? exclude : exclude?.pattern].filter(Boolean);
      const files = await glob(pattern, { cwd, absolute: true, onlyFiles: true, dot: true, unique: true, followSymbolicLinks: false, ignore });
      return token?.isCancellationRequested ? [] : files.slice(0, maxResults ?? files.length).map(Uri.file);
    },
    createFileSystemWatcher(pattern, ignoreCreateEvents = false, ignoreChangeEvents = false, ignoreDeleteEvents = false) {
      const created = event(), changed = event(), deleted = event();
      const picomatch = require('picomatch');
      const base = typeof pattern === 'string' ? workspaceRoot : pattern.baseUri.fsPath;
      const match = picomatch(typeof pattern === 'string' ? pattern : pattern.pattern, { dot: true });
      const watcher = fs.watch(base, { recursive: true }, (kind, filename) => {
        if (!filename || !match(filename.toString().replaceAll('\\', '/'))) return;
        const full = path.join(base, filename.toString()), exists = fs.existsSync(full), uri = Uri.file(full);
        if (!exists) { if (!ignoreDeleteEvents) deleted.fire(uri); }
        else if (kind === 'rename') { if (!ignoreCreateEvents) created.fire(uri); }
        else if (kind === 'change' && !ignoreChangeEvents) changed.fire(uri);
      });
      watcher.on('error', error => writeLog('error', 'File watcher', error));
      const result = { ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents, onDidCreate: created.event, onDidChange: changed.event, onDidDelete: deleted.event, dispose() { watcher.close(); created.dispose(); changed.dispose(); deleted.dispose(); } }; owned.push(result); return result;
    },
    applyEdit: () => Promise.reject(new Error('Desktop text viewer is read-only')),
    registerTextDocumentContentProvider() { unsupported('virtual text documents'); },
  };
  function showMessage(kind, message, ...rest) { const options = typeof rest[0] === 'object' && rest[0] !== null && !('title' in rest[0]) ? rest.shift() : {}; return Promise.resolve(invoke('showMessage', kind, message, options, rest)); }
  const window = {
    activeTextEditor: undefined, visibleTextEditors: [], state: { focused: true, active: true },
    get terminals() { return [...terminals]; }, activeTerminal: undefined,
    onDidChangeActiveTextEditor: activeEditors.event, onDidChangeTextEditorSelection: selectionChanges.event, onDidChangeVisibleTextEditors: visibleEditors.event,
    onDidChangeWindowState: windowChanges.event, onDidOpenTerminal: terminalOpened.event, onDidCloseTerminal: terminalClosed.event,
    onDidChangeActiveTerminal: event().event,
    onDidChangeTerminalShellIntegration: shellIntegrationChanges.event,
    tabGroups: { get all() { return adapter.getTabGroups?.() ?? []; }, get activeTabGroup() { return this.all.find(group => group.isActive); }, onDidChangeTabs: tabsChanged.event, onDidChangeTabGroups: tabGroupsChanged.event, close: (tabs, preserveFocus) => invoke('closeTabs', tabs, preserveFocus) },
    registerWebviewViewProvider(id, provider, options) { providers.set(id, provider); const registration = invoke('registerViewProvider', id, provider, options); return new Disposable(() => { registration?.dispose(); providers.delete(id); }); },
    createWebviewPanel: (...args) => invoke('createWebviewPanel', ...args),
    registerCustomEditorProvider: (...args) => invoke('registerCustomEditorProvider', ...args),
    registerWebviewPanelSerializer: (...args) => invoke('registerWebviewPanelSerializer', ...args),
    async showTextDocument(input, options = {}) {
      const document = input?.getText ? input : await openTextDocument(input);
      const selection = options.selection ?? new Selection(0, 0, 0, 0);
      await invoke('openTextFile', { path: document.uri.fsPath, line: selection.start.line, column: selection.start.character });
      const editor = { document, selection, selections: [selection], visibleRanges: [new Range(0, 0, document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length)], viewColumn: 1, options: { readOnly: true },
        edit: () => Promise.reject(new Error('Desktop text viewer is read-only')), insertSnippet: () => Promise.reject(new Error('Desktop text viewer is read-only')),
        revealRange: range => invoke('openTextFile', { path: document.uri.fsPath, line: range.start.line, column: range.start.character }),
        setDecorations: () => unsupported('text editor decorations'),
      };
      window.activeTextEditor = editor; window.visibleTextEditors = [editor]; activeEditors.fire(editor); visibleEditors.fire([editor]); selectionChanges.fire({ textEditor: editor, selections: editor.selections, kind: 3 }); return editor;
    },
    createTextEditorDecorationType: () => unsupported('text editor decorations'),
    showOpenDialog: options => Promise.resolve(invoke('showOpenDialog', options)), showSaveDialog: options => Promise.resolve(invoke('showSaveDialog', options)),
    showInformationMessage: (message, ...rest) => showMessage('info', message, ...rest), showWarningMessage: (message, ...rest) => showMessage('warning', message, ...rest), showErrorMessage: (message, ...rest) => showMessage('error', message, ...rest),
    showInputBox: (options, token) => Promise.resolve(invoke('showInputBox', options, token)),
    showQuickPick: async (items, options, token) => invoke('showQuickPick', await items, options, token),
    async withProgress(options, task) { const source = new CancellationTokenSource(); const progress = typeof adapter.startProgress === 'function' ? adapter.startProgress(options, () => source.cancel()) : undefined; try { return await task({ report: value => progress?.report?.(value) }, source.token); } finally { progress?.dispose?.(); source.dispose(); } },
    createTerminal(...args) { const terminal = invoke('createTerminal', ...args); terminals.push(terminal); window.activeTerminal = terminal; terminalOpened.fire(terminal); return terminal; },
    createOutputChannel(name) { const channel = { name, append: text => writeLog('info', `[${name}]`, text), appendLine: text => writeLog('info', `[${name}]`, text), replace: text => writeLog('info', `[${name}]`, text), trace: (...args) => writeLog('debug', `[${name}]`, ...args), debug: (...args) => writeLog('debug', `[${name}]`, ...args), info: (...args) => writeLog('info', `[${name}]`, ...args), warn: (...args) => writeLog('warn', `[${name}]`, ...args), error: (...args) => writeLog('error', `[${name}]`, ...args), show: () => invoke('showOutput', name), hide: () => invoke('hideOutput', name), clear: () => invoke('clearOutput', name), dispose() {} }; return channel; },
    createStatusBarItem(alignment, priority) { const item = { alignment, priority, text: '', tooltip: undefined, command: undefined, name: undefined, show() { invoke('setStatusItem', item, true); }, hide() { invoke('setStatusItem', item, false); }, dispose() { if (adapter.setStatusItem) adapter.setStatusItem(item, false); } }; return item; },
    registerUriHandler: handler => invoke('registerUriHandler', handler),
  };
  const diagnosticsChanged = event();
  const vscode = {
    Uri, Position, Range, Selection, RelativePattern, Disposable, EventEmitter, CodeLens, ThemeColor, ThemeIcon, CancellationTokenSource, TabInputText, TabInputCustom, Task, ShellExecution,
    window, workspace, commands,
    env: { appName: 'Azrael', appHost: 'desktop', appRoot: extensionRoot, language: adapter.language ?? 'ko', uriScheme: 'azrael-desktop', remoteName: undefined, uiKind: 1, machineId: createHash('sha256').update(stateRoot).digest('hex'), sessionId: randomUUID(), isTelemetryEnabled: false,
      clipboard: { readText: () => Promise.resolve(adapter.clipboard?.readText ? adapter.clipboard.readText() : invoke('readClipboard')), writeText: text => Promise.resolve(adapter.clipboard?.writeText ? adapter.clipboard.writeText(text) : invoke('writeClipboard', text)) },
      openExternal: uri => Promise.resolve(invoke('openExternal', uri)), asExternalUri: async uri => uri,
      onDidChangeTelemetryEnabled: event().event,
    },
    extensions: { getExtension: id => id === context.extension.id ? context.extension : undefined, all: [context.extension], onDidChange: event().event },
    languages: { getDiagnostics: uri => [], onDidChangeDiagnostics: diagnosticsChanged.event, registerCodeLensProvider(selector, provider) { const registration = { selector, provider }; lensProviders.add(registration); return new Disposable(() => lensProviders.delete(registration)); }, getLanguages: async () => [...new Set(Object.values(languageIds)), 'plaintext'] },
    authentication: { getSession: (...args) => adapter.getAuthenticationSession ? adapter.getAuthenticationSession(...args) : args[2]?.silent ? Promise.resolve(undefined) : Promise.reject(new Error('Desktop host authentication provider unavailable')), onDidChangeSessions: event().event },
    lm: { isModelProxyAvailable: false, onDidChangeModelProxyAvailability: event().event, getModelProxy: () => Promise.reject(new Error('Model proxy unavailable')) },
    tasks: { executeTask: () => Promise.reject(new Error('VS Code task execution unavailable; use the desktop terminal')), fetchTasks: () => Promise.reject(new Error('VS Code tasks unavailable')), onDidEndTaskProcess: event().event },
    l10n: { t: (message, ...args) => (typeof message === 'string' ? message : message.message).replace(/\{(\d+)\}/g, (_, index) => String(args[index] ?? `{${index}}`)) },
    version: '1.96.0',
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 }, StatusBarAlignment: { Left: 1, Right: 2 }, ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 }, ExtensionMode: { Production: 1, Development: 2, Test: 3 }, UIKind: { Desktop: 1, Web: 2 },
    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 }, EndOfLine: { LF: 1, CRLF: 2 }, TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2, Command: 3 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 }, ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 }, LogLevel: { Off: 0, Trace: 1, Debug: 2, Info: 3, Warning: 4, Error: 5 },
    EnvironmentVariableMutatorType: { Replace: 1, Append: 2, Prepend: 3 },
    TaskScope: { Global: 1, Workspace: 2 },
    SymbolKind: { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6, Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13, String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21, Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 },
  };
  // Optional adapter events keep host observations tied to actual panel/terminal state.
  if (adapter.onDidCloseTextFile) owned.push(adapter.onDidCloseTextFile(filename => { const key = Uri.file(filename).toString(); const doc = documents.get(key); if (doc) { doc.isClosed = true; documents.delete(key); closeDocuments.fire(doc); } if (window.activeTextEditor?.document.uri.toString() === key) { window.activeTextEditor = undefined; window.visibleTextEditors = []; activeEditors.fire(undefined); visibleEditors.fire([]); } }));
  if (adapter.onDidChangeWindowState) owned.push(adapter.onDidChangeWindowState(state => { window.state = state; windowChanges.fire(state); }));
  if (adapter.onDidChangeTerminalShellIntegration) owned.push(adapter.onDidChangeTerminalShellIntegration(value => shellIntegrationChanges.fire(value)));
  if (adapter.onDidChangeTabs) owned.push(adapter.onDidChangeTabs(value => tabsChanged.fire(value)));
  if (adapter.onDidChangeTabGroups) owned.push(adapter.onDidChangeTabGroups(value => tabGroupsChanged.fire(value)));
  if (adapter.onDidCloseTerminal) owned.push(adapter.onDidCloseTerminal(terminal => { const index = terminals.indexOf(terminal); if (index >= 0) terminals.splice(index, 1); if (window.activeTerminal === terminal) window.activeTerminal = terminals.at(-1); terminalClosed.fire(terminal); }));
  return { vscode, context, async dispose() { for (const item of [...context.subscriptions, ...owned].reverse()) { try { item?.dispose(); } catch (error) { writeLog('error', error); } } await Promise.all([globalState.flush(), workspaceState.flush(), configurationState.flush()]); } };
}
module.exports = { createVscodeHost };
