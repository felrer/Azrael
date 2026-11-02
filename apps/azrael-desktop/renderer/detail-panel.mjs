import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

let nextPanelId = 0;

/** Read-only local files and a single host-owned interactive terminal. */
export function createDetailPanel({ container, bridge, getWorkingDirectory, onClose }) {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const prefix = `azrael-detail-${++nextPanelId}`;
  let disposed = false;
  let visible = !container.hidden;
  let activeTab = 'file';
  let readVersion = 0;
  let currentFile = null;
  let terminal = null;
  let fitAddon = null;
  let terminalId = null;
  let creating = null;
  let terminalVersion = 0;
  let pendingEvents = [];
  let pendingBytes = 0;
  let writeQueue = Promise.resolve();
  let frame = null;
  let previousFocus = null;

  const element = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, action) => {
    const node = element('button', 'azrael-detail-panel__button', label);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const root = element('section', 'azrael-detail-panel');
  root.setAttribute('aria-label', '상세 패널');
  root.hidden = !visible;
  const header = element('header', 'azrael-detail-panel__header');
  const tabs = element('div', 'azrael-detail-panel__tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '상세 보기');
  const fileTab = button('파일', () => selectTab('file', true));
  const terminalTab = button('터미널', () => { void openTerminal(); });
  const close = button('닫기', () => {
    setVisible(false);
    onClose?.();
  });
  close.setAttribute('aria-label', '상세 패널 닫기');
  header.append(tabs, close);
  tabs.append(fileTab, terminalTab);
  const filePanel = element('div', 'azrael-detail-panel__page');
  const terminalPanel = element('div', 'azrael-detail-panel__page');
  for (const [name, tab, page] of [['file', fileTab, filePanel], ['terminal', terminalTab, terminalPanel]]) {
    tab.id = `${prefix}-${name}-tab`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `${prefix}-${name}-page`);
    page.id = `${prefix}-${name}-page`;
    page.setAttribute('role', 'tabpanel');
    page.setAttribute('aria-labelledby', tab.id);
  }
  const fileToolbar = element('div', 'azrael-detail-panel__toolbar');
  const filePath = element('span', 'azrael-detail-panel__path', '파일을 선택하세요');
  const copyPath = button('경로 복사', async () => {
    try {
      await bridge.copyText(currentFile.path);
      if (!disposed) setFileStatus('경로를 복사했습니다.');
    } catch (error) { if (!disposed) setFileStatus(`경로 복사 실패: ${message(error)}`, true); }
  });
  const reload = button('새로고침', () => { if (currentFile) void openTextFile(currentFile); });
  copyPath.disabled = reload.disabled = true;
  fileToolbar.append(filePath, copyPath, reload);
  const fileStatus = element('div', 'azrael-detail-panel__status', '파일을 열면 여기에 내용이 표시됩니다.');
  fileStatus.setAttribute('role', 'status');
  const textView = element('pre', 'azrael-detail-panel__text');
  textView.tabIndex = 0;
  textView.setAttribute('aria-label', '읽기 전용 파일 내용');
  filePanel.append(fileToolbar, fileStatus, textView);
  const terminalToolbar = element('div', 'azrael-detail-panel__toolbar');
  const terminalPath = element('span', 'azrael-detail-panel__path', '터미널');
  const endTerminal = button('종료', () => { void stopTerminal(); });
  endTerminal.disabled = true;
  terminalToolbar.append(terminalPath, endTerminal);
  const terminalStatus = element('div', 'azrael-detail-panel__status');
  terminalStatus.setAttribute('role', 'status');
  const terminalMount = element('div', 'azrael-detail-panel__terminal');
  terminalPanel.append(terminalToolbar, terminalStatus, terminalMount);
  root.append(header, filePanel, terminalPanel);
  container.append(root);

  function message(error) { return error?.message || String(error); }
  function setFileStatus(text, error = false) {
    fileStatus.textContent = text;
    fileStatus.dataset.error = String(error);
  }
  function setTerminalStatus(text, error = false) {
    terminalStatus.textContent = text;
    terminalStatus.dataset.error = String(error);
  }
  function selectTab(name, focus = false) {
    activeTab = name;
    for (const [key, tab, page] of [['file', fileTab, filePanel], ['terminal', terminalTab, terminalPanel]]) {
      tab.setAttribute('aria-selected', String(name === key));
      tab.tabIndex = name === key ? 0 : -1;
      page.hidden = name !== key;
    }
    if (focus) (name === 'file' ? fileTab : terminalTab).focus();
    scheduleFit();
  }
  tabs.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const name = event.key === 'Home' ? 'file' : event.key === 'End' ? 'terminal' : activeTab === 'file' ? 'terminal' : 'file';
    selectTab(name, true);
    if (name === 'terminal') void openTerminal(false);
  });

  async function openTextFile({ path, line, column } = {}) {
    if (disposed) return;
    const version = ++readVersion;
    setVisible(true);
    selectTab('file');
    currentFile = { path, line, column };
    filePath.textContent = typeof path === 'string' ? path : '파일';
    filePath.title = typeof path === 'string' ? path : '';
    copyPath.disabled = typeof path !== 'string' || !path;
    reload.disabled = true;
    textView.replaceChildren();
    setFileStatus('파일을 읽는 중…');
    try {
      if (typeof path !== 'string' || !path) throw new Error('파일 경로가 없습니다.');
      const result = await bridge.readTextFile({ path });
      if (disposed || version !== readVersion) return;
      if (!result || typeof result.text !== 'string' || typeof result.path !== 'string') {
        throw new Error('파일 내용을 읽을 수 없습니다.');
      }
      if (result.text.includes('\0')) throw new Error('바이너리 파일은 텍스트로 표시할 수 없습니다.');
      currentFile = { path: result.path, line, column };
      filePath.textContent = result.path;
      filePath.title = result.path;
      const lines = result.text.split(/\r\n|\n|\r/);
      const targetLine = Number.isInteger(line) && line > 0 ? Math.min(line, lines.length) : null;
      const fragment = doc.createDocumentFragment();
      let target = null;
      lines.forEach((text, index) => {
        const row = element('span', 'azrael-detail-panel__line');
        const number = element('span', 'azrael-detail-panel__line-number', String(index + 1));
        number.setAttribute('aria-hidden', 'true');
        const content = element('span', 'azrael-detail-panel__line-content', text || '\u200b');
        row.append(number, content);
        if (index + 1 === targetLine) { row.dataset.selected = 'true'; target = row; }
        fragment.append(row);
      });
      textView.append(fragment);
      setFileStatus(result.text.length === 0 ? '빈 파일 · 읽기 전용' : `${lines.length}줄 · 읽기 전용${targetLine ? ` · ${targetLine}행${Number.isInteger(column) && column > 0 ? ` ${column}열` : ''}` : ''}`);
      if (visible && activeTab === 'file') textView.focus({ preventScroll: true });
      if (target) {
        textView.scrollTop = target.offsetTop - textView.offsetTop - textView.clientHeight / 2;
        if (Number.isInteger(column) && column > 0) {
          const content = target.lastElementChild;
          const range = doc.createRange();
          const offset = Math.min(column - 1, content.firstChild.length);
          range.setStart(content.firstChild, offset);
          range.collapse(true);
          const caret = range.getBoundingClientRect();
          const viewport = textView.getBoundingClientRect();
          if (caret.right > viewport.right || caret.left < viewport.left) textView.scrollLeft += caret.left - viewport.left - 60;
        }
      }
    } catch (error) {
      if (disposed || version !== readVersion) return;
      textView.replaceChildren();
      setFileStatus(`파일을 열 수 없습니다: ${message(error)}`, true);
    } finally {
      if (!disposed && version === readVersion) reload.disabled = !currentFile?.path;
    }
  }

  function terminalTheme() {
    const style = win.getComputedStyle(root);
    const token = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    const dark = style.colorScheme === 'dark' || (style.colorScheme !== 'light' && win.matchMedia?.('(prefers-color-scheme: dark)').matches);
    return {
      background: token('--vscode-terminal-background', token('--vscode-editor-background', dark ? '#171717' : '#ffffff')),
      foreground: token('--vscode-terminal-foreground', token('--vscode-foreground', dark ? '#ececec' : '#242424')),
      cursor: token('--vscode-terminalCursor-foreground', token('--vscode-foreground', dark ? '#ececec' : '#242424')),
      selectionBackground: token('--vscode-terminal-selectionBackground', dark ? '#505050' : '#d9d9d9'),
    };
  }
  function scheduleFit() {
    if (disposed || !terminal || !visible || activeTab !== 'terminal' || frame !== null) return;
    frame = win.requestAnimationFrame(() => {
      frame = null;
      if (disposed || !terminal || !visible || activeTab !== 'terminal' || !terminalMount.clientWidth || !terminalMount.clientHeight) return;
      try {
        terminal.options.theme = terminalTheme();
        fitAddon.fit();
      } catch (error) { setTerminalStatus(`터미널 크기 조정 실패: ${message(error)}`, true); }
    });
  }
  function handleTerminalEvent(event) {
    if (disposed || !event) return;
    if (terminalId === null && creating) {
      if (pendingBytes < 1024 * 1024) {
        pendingEvents.push(event);
        pendingBytes += typeof event.data === 'string' ? event.data.length : 128;
      }
      return;
    }
    if (terminalId === null || event.id !== terminalId) return;
    if (event.type === 'data' && typeof event.data === 'string') terminal.write(event.data);
    else if (event.type === 'exit') {
      terminalId = null;
      terminal.options.disableStdin = true;
      endTerminal.disabled = true;
      setTerminalStatus(`터미널이 종료되었습니다${event.exitCode == null ? '' : ` (코드 ${event.exitCode})`}.`);
    } else if (event.type === 'error') setTerminalStatus(`터미널 오류: ${event.message}`, true);
  }
  const unsubscribe = bridge.onTerminalEvent(handleTerminalEvent);
  const resizeObserver = new win.ResizeObserver(scheduleFit);
  resizeObserver.observe(terminalMount);
  const themeObserver = new win.MutationObserver(scheduleFit);
  themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  if (doc.body) themeObserver.observe(doc.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  const colorScheme = win.matchMedia?.('(prefers-color-scheme: dark)');
  colorScheme?.addEventListener('change', scheduleFit);

  async function openTerminal(focus = true) {
    if (disposed) return;
    setVisible(true);
    selectTab('terminal');
    if (terminalId !== null || creating) {
      if (focus) terminal?.focus();
      return creating;
    }
    terminal?.dispose();
    terminalMount.replaceChildren();
    const version = ++terminalVersion;
    pendingEvents = [];
    pendingBytes = 0;
    setTerminalStatus('터미널을 시작하는 중…');
    try {
      terminal = new Terminal({ cursorBlink: true, screenReaderMode: true, theme: terminalTheme(), fontFamily: win.getComputedStyle(root).getPropertyValue('--vscode-editor-font-family').trim() || 'Consolas, "Cascadia Mono", monospace' });
      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalMount);
    } catch (error) {
      terminal?.dispose();
      terminal = null;
      setTerminalStatus(`터미널 표시 실패: ${message(error)}`, true);
      return;
    }
    terminal.onData((data) => {
      const id = terminalId;
      if (id === null || disposed) return;
      writeQueue = writeQueue.then(() => {
        if (!disposed && terminalId === id) return bridge.terminalWrite({ id, data });
      }).catch((error) => { if (!disposed && terminalId === id) setTerminalStatus(`터미널 입력 실패: ${message(error)}`, true); });
    });
    terminal.onResize(({ cols, rows }) => {
      const id = terminalId;
      if (id !== null) Promise.resolve().then(() => bridge.terminalResize({ id, cols, rows })).catch((error) => {
        if (!disposed && terminalId === id) setTerminalStatus(`터미널 크기 조정 실패: ${message(error)}`, true);
      });
    });
    creating = Promise.resolve().then(async () => {
      try {
        const cwd = await getWorkingDirectory();
        if (disposed || version !== terminalVersion) return;
        terminalPath.textContent = cwd || '터미널';
        terminalPath.title = cwd || '';
        if (visible && activeTab === 'terminal' && terminalMount.clientWidth && terminalMount.clientHeight) fitAddon.fit();
        const result = await bridge.terminalCreate({ cwd, cols: terminal.cols, rows: terminal.rows });
        if (!result || typeof result.id !== 'string' || !result.id) throw new Error('터미널 세션을 만들 수 없습니다.');
        if (disposed || version !== terminalVersion) { await bridge.terminalClose({ id: result.id }); return; }
        terminalId = result.id;
        endTerminal.disabled = false;
        setTerminalStatus('');
        const events = pendingEvents;
        pendingEvents = [];
        pendingBytes = 0;
        events.forEach(handleTerminalEvent);
        scheduleFit();
        if (focus && visible && activeTab === 'terminal') terminal.focus();
      } catch (error) {
        if (!disposed && version === terminalVersion) {
          terminal.options.disableStdin = true;
          setTerminalStatus(`터미널 시작 실패: ${message(error)}`, true);
        }
      } finally {
        if (version === terminalVersion) { creating = null; pendingEvents = []; pendingBytes = 0; }
      }
    });
    return creating;
  }
  async function stopTerminal() {
    const id = terminalId;
    if (id === null || disposed) return;
    endTerminal.disabled = true;
    try {
      await bridge.terminalClose({ id });
      if (disposed || terminalId !== id) return;
      terminalId = null;
      terminal.options.disableStdin = true;
      setTerminalStatus('터미널을 종료했습니다.');
    } catch (error) {
      if (!disposed && terminalId === id) {
        endTerminal.disabled = false;
        setTerminalStatus(`터미널 종료 실패: ${message(error)}`, true);
      }
    }
  }
  function setVisible(value) {
    if (disposed) return;
    const next = Boolean(value);
    if (next && !visible) previousFocus = doc.activeElement;
    const restoreFocus = !next && root.contains(doc.activeElement);
    visible = next;
    root.hidden = !visible;
    container.hidden = !visible;
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
    scheduleFit();
  }
  async function dispose() {
    if (disposed) return;
    disposed = true;
    ++readVersion;
    ++terminalVersion;
    if (frame !== null) win.cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    themeObserver.disconnect();
    colorScheme?.removeEventListener('change', scheduleFit);
    unsubscribe?.();
    const id = terminalId;
    terminalId = null;
    terminal?.dispose();
    root.remove();
    if (id !== null) await bridge.terminalClose({ id });
    await creating;
  }
  selectTab('file');
  return { openTextFile, openTerminal, setVisible, dispose };
}
