'use strict';
// Native-component acceptance only. Installed VS Code profile/host acceptance belongs to root.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { verifyRelease, verifyRuntime } = require('./window-control-runtime.cjs');

const project = path.resolve(__dirname, '..');
const defaultReceipt = path.join(project, 'artifacts/logs/cua-window-candidate/final-candidate-receipt.json');
const identityKeys = ['hwnd', 'pid', 'processCreated', 'executable'];
const normalized = value => String(value).toLowerCase();
const sameIdentity = (a, b) => identityKeys.every(k => normalized(a[k]) === normalized(b[k]));
function protectedCodeWindow(window) {
  if (window.visible === false) return false;
  const overlayFlags = 0x08000000 | 0x8 | 0x20;
  const exactOverlay = window.visible === true && window.className === 'Chrome_WidgetWin_1' &&
    window.popup === true && window.ownerHwnd === '0x0' && Number.isInteger(window.extendedStyle) &&
    (window.extendedStyle & overlayFlags) === overlayFlags;
  return !exactOverlay;
}
function protectedCodeIdentities(baseline) {
  const windows = baseline.codeWindows.filter(protectedCodeWindow);
  const ownerPids = new Set(windows.map(window => window.pid));
  return { windows, processes: baseline.codeProcesses.filter(process => ownerPids.has(process.pid)) };
}
function argumentsOf(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--go') result.go = true;
    else if (['--receipt', '--baseline', '--artifacts', '--runtime-directory'].includes(argv[i])) {
      if (!argv[i + 1]) throw new Error('Missing option value'); result[argv[i].slice(2)] = path.resolve(argv[++i]);
    } else throw new Error('Unknown harness option: ' + argv[i]);
  }
  return result;
}
class FixtureChannel {
  constructor(executable, token) {
    this.token = token; this.sequence = 0; this.pending = new Map(); this.buffer = ''; this.exited = false;
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.child = spawn(executable, ['--token', token], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', data => {
      this.buffer += data;
      if (this.buffer.length > 1024 * 1024) { this.rejectAll(new Error('Fixture output limit exceeded')); return; }
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        let reply; try { reply = JSON.parse(line); } catch { this.rejectAll(new Error('Invalid fixture JSON')); continue; }
        if (reply.ready) { this.identity = reply.identity; this.readyResolve(reply.identity); continue; }
        const waiter = this.pending.get(reply.id); if (!waiter) continue;
        clearTimeout(waiter.timer); this.pending.delete(reply.id);
        if (reply.error) waiter.reject(new Error(reply.error)); else waiter.resolve(reply.result);
      }
    });
    this.child.stderr.on('data', () => {});
    this.child.on('error', error => this.rejectAll(error));
    this.child.on('exit', code => { this.exited = true; this.exitCode = code; this.rejectAll(new Error('Fixture exited')); });
  }
  rejectAll(error) { this.readyReject(error); for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear(); }
  command(command, fields = {}) {
    if (this.exited) return Promise.reject(new Error('Fixture is not running'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Fixture cooperative command timeout')); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ token: this.token, id, command, ...fields }) + '\n');
    });
  }
  async shutdown() {
    if (this.exited) return;
    await this.command('shutdown');
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    if (!this.exited) throw new Error('Fixture did not exit cooperatively; left running without forced termination');
  }
  leaveRunning() {
    // Do not keep the harness alive solely because an unresponsive owned fixture remains open.
    this.child.unref();
    for (const stream of this.child.stdio) if (stream && typeof stream.unref === 'function') stream.unref();
    this.child.stdin.end();
  }
}
async function main() {
  const options = argumentsOf(process.argv.slice(2));
  if (!options.go) throw new Error('Root GO required: no GUI/native desktop operation starts without --go.');
  if (!options.baseline || !options.artifacts) throw new Error('Root baseline and unique artifacts directory required.');
  if (fs.existsSync(options.artifacts)) throw new Error('Artifacts directory must be new; existing evidence will not be overwritten.');
  const candidate = JSON.parse(fs.readFileSync(options.receipt || defaultReceipt, 'utf8'));
  const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.match(candidate.hostVsixSha256 || '', /^[a-f0-9]{64}$/i, 'Receipt VSIX hash missing');
  assert.equal(sha256(candidate.hostVsix), candidate.hostVsixSha256.toLowerCase(), 'Receipt VSIX hash mismatch');
  const verified = options['runtime-directory'] ? verifyRuntime(options['runtime-directory']) : verifyRelease(candidate.release);
  if (!verified) throw new Error('Candidate receipt has no verified native runtime.');
  assert.equal(verified.manifestSha256, String(candidate.pairedHashes?.['window-control/manifest.json']).toLowerCase(), 'Receipt native manifest mismatch');
  const hostModuleHashes = {};
  for (const module of ['window-control-backend.cjs', 'window-control-policy.cjs']) {
    const actual = sha256(path.join(__dirname, module));
    assert.equal(actual, String(candidate.pairedHashes?.['host/' + module]).toLowerCase(), 'Receipt host module mismatch: ' + module);
    hostModuleHashes[module] = actual;
  }
  const { createBackend } = require('./window-control-backend.cjs');
  const { createWindowOwner } = require('./window-control-policy.cjs');
  const fixtureExe = path.join(project, 'artifacts/build/selected-window-native/SelectedWindowFixture.exe');
  if (!fs.existsSync(fixtureExe)) throw new Error('Compile fixture with test-selected-window-native.ps1 -CompileOnly first.');
  const baseline = JSON.parse(fs.readFileSync(options.baseline, 'utf8'));
  assert.equal(baseline.schema, 1); assert.equal(baseline.inputDesktop, 'Default');
  const protectedBaseline = protectedCodeIdentities(baseline);
  fs.mkdirSync(options.artifacts, { recursive: true });
  const report = { kind: 'native-component-acceptance', installedHostEndToEnd: false, candidateReceipt: options.receipt || defaultReceipt,
    nativeExecutable: verified.executable, nativeManifestSha256: verified.manifestSha256,
    runtimeVerification: options['runtime-directory'] ? 'installed-runtime-directory' : 'release', hostVsixSha256: candidate.hostVsixSha256, hostModuleHashes, fixtureExe,
    fixtureSha256: crypto.createHash('sha256').update(fs.readFileSync(fixtureExe)).digest('hex'), baseline: options.baseline,
    startedAt: new Date().toISOString(), checks: [], capabilities: {}, nativeCalls: [], screenshots: [], status: 'running' };
  let fixture, owner, native, selected, targetId, snapshotSequence = 0, restoreCount = 0, resizeCount = 0, cancelNextResize = false;
  const thread = 'native-fixture-' + crypto.randomUUID();
  const record = (name, details = {}) => report.checks.push({ name, outcome: 'passed', ...details });
  function stableCode(before, after, keys) {
    for (const old of before) assert(after.some(item => keys.every(key => normalized(item[key]) === normalized(old[key]))), 'Existing Code identity/window changed');
  }
  async function desktop(phase) {
    const destination = path.join(options.artifacts, 'desktop-' + String(++snapshotSequence).padStart(3, '0') + '.json');
    const read = spawnSync('pwsh.exe', ['-NoProfile', '-File', path.join(__dirname, 'window-test-desktop-state.ps1'), '-OutputPath', destination], { windowsHide: true, encoding: 'utf8', timeout: 20000 });
    if (read.status !== 0) throw new Error('Read-only desktop baseline helper failed at ' + phase + ': ' + (read.stderr || read.error?.message || read.status));
    const current = JSON.parse(fs.readFileSync(destination, 'utf8'));
    assert.equal(current.inputDesktop, 'Default', 'Unexpected input desktop');
    assert.equal(normalized(current.foregroundHwnd), normalized(baseline.foregroundHwnd), 'Unexpected foreground change at ' + phase);
    assert.deepEqual(current.cursor, baseline.cursor, 'Unexpected cursor visibility/position change at ' + phase);
    assert.equal(current.lastInputTick, baseline.lastInputTick, 'User input detected at ' + phase);
    stableCode(protectedBaseline.processes, current.codeProcesses, ['pid', 'processCreated', 'executable']);
    stableCode(protectedBaseline.windows, current.codeWindows, ['hwnd', 'pid', 'processCreated', 'executable', 'visible', 'minimized']);
    return current;
  }
  async function fixtureCommand(command, fields = {}) {
    await desktop('fixture ' + command + ' before');
    try { return await fixture.command(command, fields); }
    finally { await desktop('fixture ' + command + ' after'); }
  }
  async function shutdownFixture() {
    await desktop('fixture shutdown before');
    try { await fixture.shutdown(); }
    finally { await desktop('fixture shutdown after'); }
  }
  const backend = { async request(method, params) {
    await desktop('native ' + method + ' before');
    if (method !== 'listWindows') {
      if (!selected || !sameIdentity(params.window, selected) || !sameIdentity(params.window, fixture.identity)) throw new Error('Native request escaped exact owned fixture identity');
      assert(!baseline.codeProcesses.some(p => p.pid === params.window.pid), 'Fixture PID overlaps baseline Code process');
    }
    report.nativeCalls.push({ method, window: params.window ? Object.fromEntries(identityKeys.map(k => [k, params.window[k]])) : undefined });
    let result, failure;
    try { result = await native.request(method, params); } catch (error) { failure = error; }
    await desktop('native ' + method + ' after');
    if (failure) throw failure;
    if (method === 'restore') restoreCount++;
    if (method === 'resize') { resizeCount++; if (cancelNextResize) { cancelNextResize = false; owner.stop(thread); } }
    return result;
  } };
  async function capture(label) {
    const image = await owner.call(thread, 'capture', { targetId });
    const destination = path.join(options.artifacts, label + '.png');
    fs.writeFileSync(destination, Buffer.from(image.image.data, 'base64'));
    report.screenshots.push(destination);
    const inspection = await fixtureCommand('verifyImage', { path: destination });
    assert.equal(inspection.widthPx, image.widthPx); assert.equal(inspection.heightPx, image.heightPx);
    assert(inspection.canvasPixels > 5000, 'Selected fixture canvas missing from captured PNG');
    assert.equal(inspection.coverPixels, 0, 'Occluder pixels leaked into selected-window capture');
    assert(inspection.tickFromImage >= 0, 'Captured fixture tick counter could not be decoded');
    return { ...image, inspection };
  }
  async function capability(tool, name, pattern, value, effect) {
    const image = await capture('capability-' + tool);
    const element = image.elements.find(e => e.name === name && e.patterns.includes(pattern));
    if (!element) { report.capabilities[tool] = { outcome: 'unsupported', reason: 'Exact fixture element/pattern not exposed by native UIA' }; return; }
    const before = await fixtureCommand('state');
    await owner.call(thread, tool, { targetId, observationId: image.observationId, elementId: element.id, ...(value !== undefined ? { value } : {}) });
    const after = await fixtureCommand('state'); effect(before, after);
    report.capabilities[tool] = { outcome: 'passed', elementId: element.id };
    await assert.rejects(owner.call(thread, tool, { targetId, observationId: image.observationId, elementId: element.id, ...(value !== undefined ? { value } : {}) }), /Fresh/);
    record('stale observation rejected after ' + tool);
  }
  try {
    await desktop('pre-launch');
    fixture = new FixtureChannel(fixtureExe, crypto.randomUUID());
    const readyTimer = setTimeout(() => fixture.readyReject(new Error('Fixture startup timed out; no forced termination')), 10000);
    try { await fixture.ready; } finally { clearTimeout(readyTimer); }
    report.fixtureIdentity = fixture.identity;
    assert.equal(fixture.identity.pid, fixture.child.pid);
    assert.equal(normalized(fixture.identity.executable), normalized(fixtureExe));
    assert.equal(fixture.identity.minimized, true);
    await desktop('fixture started minimized');
    native = createBackend({ windowControl: verified }, { timeoutMs: 15000 });
    owner = createWindowOwner({ backend, authorize: async identity => sameIdentity(identity, fixture.identity), codexHome: path.join(options.artifacts, 'isolated-owner-home') });
    const windows = await owner.listWindows();
    selected = windows.find(w => sameIdentity(w, fixture.identity));
    assert(selected, 'Exact fixture HWND/PID/creation/executable was not enumerated');
    const binding = await owner.bind(thread, selected); targetId = binding.targetId;
    const first = await capture('initial-restored');
    assert.equal(restoreCount, 1); assert.equal(first.window.minimized, false);
    record('initial minimized selection restored once');
    await fixtureCommand('cover');
    const covered1 = await capture('covered-first');
    const covered2 = await capture('covered-second');
    assert(BigInt(covered2.frameTimestamp) > BigInt(covered1.frameTimestamp));
    assert(covered2.inspection.tickFromImage !== covered1.inspection.tickFromImage);
    record('fresh HWND-only capture behind own nonactivating occluder', { firstTick: covered1.inspection.tickFromImage, secondTick: covered2.inspection.tickFromImage });
    await capability('invoke', 'Fixture Invoke', 'invoke', undefined, (a,b) => assert.equal(b.invokes, a.invokes + 1));
    await capability('set_value', 'Fixture Value', 'setValue', 'native-fixture-value', (a,b) => { assert.equal(b.value, 'native-fixture-value'); assert(b.valueChanges > a.valueChanges); });
    await capability('toggle', 'Fixture Toggle', 'toggle', undefined, (a,b) => { assert.equal(b.toggled, !a.toggled); assert(b.toggles > a.toggles); });
    await capability('select', 'Fixture Item 2', 'select', undefined, (a,b) => { assert.equal(b.selectedIndex, 2); assert(b.selections > a.selections); });
    await capability('expand', 'Fixture Branch', 'expand', undefined, (a,b) => { assert.equal(b.treeExpanded, true); assert(b.expansions > a.expansions); });
    await capability('collapse', 'Fixture Branch', 'collapse', undefined, (a,b) => assert.equal(b.treeExpanded, false));
    await capability('scroll', 'Fixture Scroll List', 'scroll', { horizontal: 0, vertical: 2 }, (a,b) => assert(b.scrollTop > a.scrollTop));
    await assert.rejects(owner.call(thread, 'capture', { targetId: 'forged-target' }), /forged/);
    await assert.rejects(backend.request('act', { window: selected, observationId: 'stale-observation', elementId: 'stale-element', action: 'invoke' }), /Observation|observation/);
    record('forged policy target and stale native IDs rejected');
    await fixtureCommand('minimize');
    await assert.rejects(owner.call(thread, 'capture', { targetId }), /user resume/);
    assert.equal(restoreCount, 1);
    await assert.rejects(owner.call(thread, 'capture', { targetId }), /paused/);
    await owner.resume(thread); assert.equal(restoreCount, 2);
    record('later minimize pauses until explicit resume');
    await owner.saveMacro({ id: 'native-sizes', name: 'Owned native sizes', steps: [{ widthDip: 600, heightDip: 600 }, { widthDip: 660, heightDip: 640 }] });
    const macro = await owner.call(thread, 'run_size_macro', { targetId, macroId: 'native-sizes' });
    assert.equal(macro.window.widthPx, Math.round(660 * macro.dpi / 96));
    assert.equal(macro.window.heightPx, Math.round(640 * macro.dpi / 96));
    await assert.rejects(owner.call(thread, 'resize', { targetId, widthDip: 99, heightDip: 500 }), /Size/);
    record('bounded real resize macro and invalid size rejection');
    const beforeCancellation = resizeCount; cancelNextResize = true;
    await assert.rejects(owner.call(thread, 'run_size_macro', { targetId, macroId: 'native-sizes' }), /cancelled/);
    assert.equal(resizeCount, beforeCancellation + 1);
    assert.equal(owner.peek(thread).state, 'paused');
    record('Stop cancels remaining macro steps after one real native resize');
    await shutdownFixture();
    await assert.rejects(backend.request('status', { window: selected }), /identity|exists|match|destroyed|unavailable/i);
    record('cooperatively closed exact target becomes stale');
    await desktop('final');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = { message: error.message, stack: error.stack };
    throw error;
  } finally {
    if (owner) owner.dispose();
    if (fixture && !fixture.exited) {
      try { await shutdownFixture(); report.cleanup = 'cooperative fixture shutdown'; }
      catch (error) { report.cleanup = error.message; report.fixtureLeftRunning = { pid: fixture.child.pid, identity: fixture.identity }; fixture.leaveRunning(); }
    } else if (fixture) report.cleanup = 'fixture exited cooperatively';
    if (native) await native.dispose();
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(options.artifacts, 'native-component-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, component: report.kind, checks: report.checks.length, capabilities: report.capabilities, results: path.join(options.artifacts, 'native-component-results.json') }));
  }
}
module.exports = { protectedCodeWindow, protectedCodeIdentities };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
