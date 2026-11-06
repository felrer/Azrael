'use strict';
// Stage-2 authority and fresh observations belong to the host. Construction sends no input.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const native = require('./multi-pointer-mcp.cjs');
const { windowError, switchedMetadata } = require('./window-control-errors.cjs');
const ACTIONS = new Set(['status', 'collaboration', 'move', 'click', 'drag', 'scroll', 'press', 'text']);
const ACTUATION = new Set(['click', 'drag', 'scroll', 'press', 'text']);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => a.pid === b.pid && ['hwnd', 'processCreated', 'executable'].every(k => a[k].toLowerCase() === b[k].toLowerCase());
function identity(window) {
  const out = Object.fromEntries(['hwnd', 'pid', 'processCreated', 'executable'].map(k => [k, window?.[k]]));
  if (!/^[a-f0-9]{1,16}$/i.test(out.hwnd || '') || !/^[a-f0-9]{1,16}$/i.test(out.processCreated || '') ||
      BigInt('0x' + out.hwnd) === 0n || BigInt('0x' + out.processCreated) === 0n ||
      !Number.isSafeInteger(out.pid) || out.pid < 1 || out.pid > 0xffffffff || typeof out.executable !== 'string' ||
      !path.win32.isAbsolute(out.executable) || out.executable.includes('\0')) throw windowError('invalid_request', 'Invalid switched input target identity');
  return out;
}
function definitions() {
  return native.toolDefinitions().filter(d => ACTIONS.has(d.name)).map(d => {
    const properties = { ...d.inputSchema.properties }; delete properties.pointerId;
    const required = d.inputSchema.required.filter(k => k !== 'pointerId');
    // Other pointer actions may supply a screen point to initialize/reposition the cursor.
    if (d.inputSchema.properties.pointerId && !properties.x) {
      const move = native.toolDefinitions().find(t => t.name === 'move').inputSchema.properties;
      properties.x = move.x; properties.y = move.y;
    }
    return { ...d, inputSchema: { ...d.inputSchema, properties, required } };
  });
}
function switchedInputSchema() {
  return { oneOf: definitions().map(d => ({ ...d.inputSchema,
    properties: { action: { type: 'string', enum: [d.name] }, ...d.inputSchema.properties },
    required: ['action', ...d.inputSchema.required] })) };
}
function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw windowError('invalid_request', 'Expected switched input');
  const { action, ...args } = input, def = definitions().find(d => d.name === action);
  try {
    if (!def) throw Error('Unsupported switched input action');
    native.validateArguments(def, args);
    if (Object.hasOwn(args, 'x') !== Object.hasOwn(args, 'y')) throw Error('Supply both screen coordinates');
  } catch (error) { throw windowError('invalid_request', error.message); }
  return { action, ...args };
}
function desktopInputSchema() {
  const coordinates = native.toolDefinitions().find(def => def.name === 'move').inputSchema.properties;
  return { oneOf: switchedInputSchema().oneOf.map(def => {
    const drag = def.properties.action.enum[0] === 'drag';
    return { ...def, properties: { ...def.properties, x: coordinates.x, y: coordinates.y,
      ...(drag ? { fromX: coordinates.x, fromY: coordinates.y } : {}) },
      required: [...new Set([...def.required, 'x', 'y', ...(drag ? ['fromX', 'fromY'] : [])])] };
  }) };
}
function validateDesktopInput(input) {
  if (input?.action !== 'drag') {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return validateInput(input);
    const { x, y, ...args } = input;
    validateInput({ action: 'move', x, y });
    const packet = validateInput(['status', 'collaboration'].includes(input.action) ? args : input);
    return { ...packet, x, y };
  }
  const { fromX, fromY, ...args } = input;
  const packet = validateInput(args);
  validateInput({ action: 'move', x: fromX, y: fromY });
  return { ...packet, fromX, fromY };
}
function validatePresentation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(k => !['x', 'y', 'phase', 'click'].includes(k)) ||
      !['active', 'idle'].includes(input.phase) ||
      (Object.hasOwn(input, 'click') && typeof input.click !== 'boolean')) throw windowError('invalid_request', 'Invalid pointer presentation');
  validateInput({ action: 'move', x: input.x, y: input.y });
  return { ...input };
}
function plainPath(file, directory) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) throw Error('Absolute plain path required');
  const resolved = path.resolve(file);
  for (let p = resolved; ; p = path.dirname(p)) {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || (p === resolved && !directory ? !st.isFile() : !st.isDirectory())) throw Error('Linked or non-plain switched input path');
    if (path.dirname(p) === p) break;
  }
  return resolved;
}
function prepareStateDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')) throw Error('Absolute switched input state directory required');
  const resolved = path.resolve(directory); let cursor = path.parse(resolved).root;
  plainPath(cursor, true);
  for (const part of resolved.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { fs.mkdirSync(cursor, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    plainPath(cursor, true);
  }
  return resolved;
}
const fileIdentity = file => { const s = fs.lstatSync(file); return { dev: s.dev, ino: s.ino }; };
function unchanged(file, expected, directory) {
  plainPath(file, directory);
  const now = fileIdentity(file);
  if (now.dev !== expected.dev || now.ino !== expected.ino) throw Error('Switched input session path identity changed');
}
function createSwitchedInputProvider(declaration, { stateDirectory, createNativeBroker = native.createBroker, platform = process.platform, arch = process.arch } = {}) {
  // One bounded counter record per thread, never a replayable history of input packets.
  const sessions = new Map(), pending = new Set(), operations = new Map(); let disposed = false;
  function admitOperation(thread, packet) {
    if (!ACTUATION.has(packet.action)) return;
    let state = operations.get(thread);
    if (!state) {
      if (operations.size >= 4096) throw windowError('state_changed', 'Switched input operation identity capacity reached');
      state = { high: 0, retired: 0 }; operations.set(thread, state);
    }
    const id = packet.operationId ?? state.high + 1;
    if (!Number.isSafeInteger(id) || id < 1) throw windowError('state_changed', 'Switched input operation identity exhausted');
    if (id <= state.retired) throw windowError('state_changed', 'Switched input operation belongs to a retired session; observe before a new operation', {
      actionExecuted: false, observationRequired: true, recovery: 'observe_again' });
    packet.operationId = id; state.high = Math.max(state.high, id);
  }
  function verify() {
    if (platform !== 'win32' || arch !== 'x64') throw windowError('unsupported_action', 'Switched input requires local Windows x64');
    if (!declaration || !/^[a-f0-9]{64}$/.test(declaration.manifestSha256 || '') ||
        typeof declaration.modulePath !== 'string' || path.resolve(declaration.modulePath) !== path.join(__dirname, 'multi-pointer-mcp.cjs')) throw windowError('unsupported_action', 'Switched input runtime is not prepared');
    plainPath(declaration.modulePath, false);
    const directory = plainPath(declaration.directory, true);
    const manifest = plainPath(path.join(directory, 'manifest.json'), false);
    if (sha(fs.readFileSync(manifest)) !== declaration.manifestSha256) throw windowError('connection_error', 'Switched input runtime declaration changed');
    native.verifyRuntime(directory);
    // Bind the exact supplied manifest, including after the member verification.
    if (sha(fs.readFileSync(manifest)) !== declaration.manifestSha256) throw windowError('connection_error', 'Switched input manifest changed during verification');
    return directory;
  }
  async function release(thread) {
    const s = sessions.get(thread); if (!s) return { detached: true };
    if (s.releasing) return s.releasing;
    s.retired = true;
    const operationState = operations.get(thread);
    if (operationState) operationState.retired = operationState.high;
    s.releasing = (async () => {
      const stopped = s.broker ? await s.broker.close() : { started: false };
      if (stopped?.started !== false && (stopped?.terminationVerified !== true || stopped.exitCode !== 0 || stopped.signal)) throw windowError('connection_error', 'Switched input stop/exit is unverified; session retained: ' + s.directory, { mutationOutcome: 'unknown' });
      unchanged(s.directory, s.directoryIdentity, true);
      if (!s.targetsDeleted && s.targetsIdentity) {
        unchanged(s.targetsFile, s.targetsIdentity, false);
        if (sha(fs.readFileSync(s.targetsFile)) !== s.targetsSha256) throw Error('Switched input target allowlist changed; cleanup blocked');
        fs.unlinkSync(s.targetsFile);
        s.targetsDeleted = true;
      }
      fs.rmdirSync(s.directory);
      if (fs.existsSync(s.directory)) throw Error('Switched input session cleanup is unverified');
      if (sessions.get(thread) === s) sessions.delete(thread);
      return { detached: true };
    })();
    try { return await s.releasing; } finally { s.releasing = null; }
  }
  async function launch(thread, window, desktop = false, initialPoint) {
    const runtimeDirectory = verify(), root = prepareStateDirectory(stateDirectory);
    const directory = fs.mkdtempSync(path.join(root, 'switched-input-'));
    const s = { directory, directoryIdentity: fileIdentity(directory), window, desktop, initialPoint, broker: null, retired: false, pointer: false, busy: false };
    sessions.set(thread, s);
    s.targetsFile = path.join(directory, 'targets.json');
    const bytes = JSON.stringify({ schema: 1, ...(desktop ? { desktop: true } : {}), targets: [{ id: 'selected', pid: window.pid,
      hwnd: '0x' + window.hwnd, createdFileTime: '0x' + window.processCreated, executable: window.executable }] });
    fs.writeFileSync(s.targetsFile, bytes, { flag: 'wx', mode: 0o600 });
    s.targetsIdentity = fileIdentity(s.targetsFile); s.targetsSha256 = sha(bytes);
    // createBroker is lazy; only call() starts the native process.
    s.broker = createNativeBroker({ runtimeDirectory, targetsFile: s.targetsFile });
    return s;
  }
  async function execute(thread, window, input, guard = async () => {}, desktop = false, cosmetic = false) {
    if (disposed) throw windowError('cancelled', 'Switched input provider disposed');
    if (typeof thread !== 'string' || thread.length < 1 || thread.length > 1024 || thread.includes('\0')) throw windowError('invalid_request', 'Invalid switched input thread identity');
    const target = identity(window), packet = cosmetic ? validatePresentation(input) : desktop ? validateDesktopInput(input) : validateInput(input);
    const point = packet.action === 'drag' && desktop ? { x: packet.fromX, y: packet.fromY } : { x: packet.x, y: packet.y };
    let s = sessions.get(thread);
    if (pending.has(thread)) throw windowError('state_changed', 'Switched input operation already pending');
    pending.add(thread);
    try {
      await guard();
      if (disposed) throw windowError('cancelled', 'Switched input provider disposed');
      // Cosmetic rendering may reuse existing desktop authority, but cannot grant it.
      if (cosmetic && s?.desktop) desktop = true;
      if (s && (s.desktop !== desktop || (!desktop && !same(s.window, target)))) { await release(thread); s = undefined; }
      if (s?.retired) throw windowError('cancelled', 'Switched input session requires verified cleanup');
      const needsPointer = cosmetic || !['status', 'collaboration'].includes(packet.action);
      if (needsPointer && !s?.pointer && packet.x === undefined) throw windowError('invalid_request', 'First pointer action requires an explicit physical screen x/y inside the selected main client');
      if (!cosmetic) admitOperation(thread, packet);
      if (!s) s = await launch(thread, target, desktop, point);
      s.busy = true;
      const live = () => { if (disposed || s.retired) throw windowError('cancelled', 'Switched input session is retiring'); };
      const call = async (method, args) => {
        await guard(); live();
        try {
          try { return await s.broker.call(method, args); }
          catch (error) {
            const details = error?.details, partial = switchedMetadata(details?.partial);
            const uncertain = details?.actionExecuted !== false || partial.recovery?.uncertainDelivery === true;
            throw windowError('state_changed', 'Switched input requires a fresh observation before another operation', {
              nativeCode: typeof details?.code === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(details.code) ? details.code : 'broker_error',
              ...(typeof details?.actionExecuted === 'boolean' ? { actionExecuted: details.actionExecuted } : {}),
              observationRequired: true, recovery: 'observe_again', ...(uncertain ? { mutationOutcome: 'unknown' } : {}),
              switchedInputDetails: partial,
            });
          }
        } finally { await guard(); live(); }
      };
      const creating = needsPointer && !s.pointer;
      if (creating) {
        await call('create_pointer', { pointerId: 'model', targetId: 'selected', ...(desktop ? s.initialPoint : point),
          ...(cosmetic ? { presentationOnly: true } : {}) }); s.pointer = true;
      }
      if (cosmetic) return await call('present_pointer', { pointerId: 'model', ...packet });
      if (desktop && needsPointer) {
        await call('desktop_target', { pointerId: 'model', target, ...point });
      } else if (needsPointer && !creating && packet.x !== undefined && !['move', 'drag'].includes(packet.action)) {
        await call('move', { pointerId: 'model', x: packet.x, y: packet.y });
      }
      const { action, ...args } = packet;
      delete args.fromX; delete args.fromY;
      if (needsPointer) args.pointerId = 'model';
      if (!['move', 'drag'].includes(action)) { delete args.x; delete args.y; }
      const result = await call(action, args);
      return { ...switchedMetadata(result), ...(typeof result?.delivered === 'boolean' ? { delivered: result.delivered } : {}),
        delivery: 'switchedInput', verified: false, applicationEffectVerified: false };
    } catch (error) {
      if (s || sessions.has(thread)) {
        try { await release(thread); } catch (cleanupError) {
          const combined = windowError(error.code || 'connection_error', error.message + '; switched input cleanup is unverified', { ...error, mutationOutcome: 'unknown' });
          combined.cause = error; combined.cleanupError = cleanupError; throw combined;
        }
      }
      throw error;
    } finally { pending.delete(thread); if (s) s.busy = false; }
  }
  return { input: (thread, window, packet, guard) => execute(thread, window, packet, guard),
    desktopInput: (thread, window, packet, guard) => execute(thread, window, packet, guard, true),
    visualize: (thread, window, packet, guard) => execute(thread, window, packet, guard, false, true),
    release, async dispose() {
    disposed = true;
    const results = await Promise.allSettled([...sessions.keys()].map(release));
    const failed = results.find(r => r.status === 'rejected'); if (failed) throw failed.reason;
  } };
}
module.exports = { createSwitchedInputProvider, switchedInputSchema, desktopInputSchema, validateInput, validateDesktopInput };
