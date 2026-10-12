// Isolated Chrome/CDP setup follows the project's existing render verifiers.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';

export async function openBrowser(profile, executable = process.env.BOARD_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe') {
  await mkdir(profile, { recursive: true });
  const child = spawn(executable, ['--headless=new', '--disable-background-mode', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((done, reject) => {
    let output = ''; const timer = setTimeout(() => reject(Error('Chrome startup timeout')), 20000);
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-10000); const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); done(match[1]); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error('Chrome exited before debugger startup: ' + code)); });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map(), errors = [], dialogs = [], listeners = new Set(); let sequence = 0, session, dialogDecision = true;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    for (const listener of listeners) listener(message);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args);
    if (message.method === 'Page.javascriptDialogOpening') { dialogs.push(message.params); void send('Page.handleJavaScriptDialog', { accept: dialogDecision }, message.sessionId).catch(error => errors.push(String(error))); }
    if (message.id && pending.has(message.id)) { const request = pending.get(message.id); pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(Error(JSON.stringify(message.error))) : request.done(message.result); }
  });
  const send = (method, params = {}, sessionId = session) => new Promise((done, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 20000);
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const target = await send('Target.createTarget', { url: 'about:blank' }, null);
  session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await send('Page.enable'); await send('Runtime.enable');
  const evaluate = async expression => { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails)); return response.result.value; };
  const wait = async expression => {
    for (let n = 0; n < 150; n++) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise(done => setTimeout(done, 40)); }
    throw Error('Browser wait failed: ' + expression + '\n' + (await evaluate('document.body.innerText')).slice(0,1800));
  };
  return { child, profile, send, evaluate, wait, errors, dialogs, onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); }, setDialogDecision(value) { dialogDecision = value; },
    async screenshot(path) { const capture = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path, Buffer.from(capture.data, 'base64')); },
    async close() {
      if (child.exitCode === null) await send('Browser.close', {}, null).catch(() => {});
      if (child.exitCode === null && child.signalCode === null) await new Promise(done => { const timer = setTimeout(done, 10000); child.once('exit', () => { clearTimeout(timer); done(); }); });
      assert.ok(child.exitCode !== null || child.signalCode !== null, 'Owned Chrome exited before fixture cleanup');
      socket.close(); for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error('Browser closed')); } pending.clear();
      return { pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode };
    }
  };
}
