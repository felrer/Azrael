'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const copy = value => JSON.parse(JSON.stringify(value));
function equal(a, b) { const ordered = v => v && typeof v === 'object' ? Object.keys(v).sort().map(k => [k, ordered(v[k])]) : v; return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b)); }
function text(value, label) { if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new Error(`Invalid ${label}`); return value; }
function fields(value, allowed) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unsupported isolation request fields'); }
function success(result, operation) { if (!result || result.ok !== true) throw Object.assign(new Error(result?.message || result?.code || `Child ${operation} failed`), { code: result?.code || 'child_operation_failed' }); return result; }
function geometry(result, identity) {
  if (result.sessionId !== identity.childSessionId || !Number.isSafeInteger(result.width) || !Number.isSafeInteger(result.height) || result.width < 1 || result.height < 1 || result.width > 8192 || result.height > 8192 || result.width * result.height > 16777216) throw new Error('Unverified child capture geometry');
  return { width: result.width, height: result.height };
}
function checkedInput(input, bounds) {
  fields(input, ['kind', 'text', 'scanCode', 'action', 'extended', 'x', 'y', 'button', 'delta']);
  if (input.kind === 'text') {
    fields(input, ['kind', 'text']);
    if (typeof input.text !== 'string' || !input.text.length || input.text.length > 4096 || input.text.includes('\0')) throw new Error('Text requires 1..4096 UTF-16 units without NUL');
    return { kind: 'text', text: input.text };
  }
  if (input.kind === 'key') {
    fields(input, ['kind', 'scanCode', 'action', 'extended']);
    if (!Number.isSafeInteger(input.scanCode) || input.scanCode < 1 || input.scanCode > 127 || !['down', 'up'].includes(input.action) || (input.extended !== undefined && typeof input.extended !== 'boolean')) throw new Error('Invalid bounded key input');
    return { kind: 'key', scanCode: input.scanCode, action: input.action, extended: input.extended === true };
  }
  if (input.kind === 'mouse') {
    fields(input, ['kind', 'x', 'y', 'action', 'button', 'delta']);
    if (![input.x, input.y].every(Number.isSafeInteger) || input.x < 0 || input.y < 0 || input.x >= bounds.width || input.y >= bounds.height || !['move', 'down', 'up', 'wheel'].includes(input.action) || (input.button !== undefined && !['left', 'right', 'middle'].includes(input.button))) throw new Error('Invalid mouse input or capture bounds');
    if (input.action === 'wheel' ? !Number.isSafeInteger(input.delta) || Math.abs(input.delta) > 1200 : input.delta !== undefined) throw new Error('Invalid wheel delta');
    return { kind: 'mouse', x: input.x, y: input.y, action: input.action, button: input.button || 'left', ...(input.action === 'wheel' ? { delta: input.delta } : {}) };
  }
  throw new Error('Unsupported isolated input kind');
}
function admitted(result, identity) {
  const proof = result?.admission;
  return result?.ok === true && result.admissionReady === true && result.available === true && proof?.scope === 'child_platform_fixture'
    && /^[a-f0-9]{64}$/i.test(proof.helperSha256 || '')
    && ['sid', 'profile', 'parentSessionId', 'childSessionId', 'workerPid', 'workerCreated'].every(name => identity[name] !== undefined && proof.identity?.[name] === identity[name])
    && ['connection', 'render', 'keyboard', 'mouse', 'parentIdentity', 'dataProfile'].every(name => proof.gates?.[name]?.passed === true)
    && proof.fixtureClosed?.passed === true;
}

function createIsolationController({ childSession, resources, authorize = async () => false, approveApp = async () => false, resolveExecutable } = {}) {
  if (!childSession || !resources) throw new Error('Child session and resource managers are required');
  let current, owner, generation = 0, queue = Promise.resolve();
  const targets = new Map(), pendingStarts = new Map();
  function serial(action) { const result = queue.then(action); queue = result.catch(() => {}); return result; }
  async function authorized(ownerId, operation, version, parentIdentity) {
    text(ownerId, 'ownerId');
    if (await authorize(ownerId, operation, parentIdentity === undefined ? undefined : copy(parentIdentity)) !== true) throw new Error('Isolation authority required');
    if (generation !== version) throw new Error('Isolation operation stopped');
  }
  function readiness() { return { admissionReady: current?.admitted === true, available: current?.admitted === true, admissionScope: 'child_platform_fixture', applicationCompatibility: 'unverified' }; }
  function owned(ownerId) { if (!current || current.closed || owner !== ownerId) throw new Error('Isolated input lease required'); if (current.uncertain) throw new Error('Isolated mutation outcome is unknown'); if (!current.admitted) throw new Error('Child platform admission is incomplete'); }
  function target(ownerId, targetId) { owned(ownerId); const result = targets.get(targetId); if (!result || result.ownerId !== ownerId) throw new Error('Unknown isolated target'); return result; }
  function invalidate() { for (const value of targets.values()) value.observation = null; }
  function scopedKeys(value, input) {
    const held = new Set(value.heldKeys);
    if (input.kind !== 'key') return held;
    if ([0x5b, 0x5c].includes(input.scanCode)) throw new Error('Windows keys escape the owned application');
    const token = `${input.extended ? 'E0:' : ''}${input.scanCode}`;
    if (input.action === 'up') { held.delete(token); return held; }
    held.add(token);
    const scans = new Set([...held].map(key => Number(key.split(':').at(-1))));
    const alt = scans.has(56), ctrl = scans.has(29);
    if ((alt && (scans.has(15) || scans.has(1))) || (ctrl && scans.has(1)) || (ctrl && alt && scans.has(83))) throw new Error('Key combination escapes the owned application');
    return held;
  }
  function resourceIdentity(resource) { return resource?.identity || resource; }
  async function observeSession(resource) {
    const identity = resourceIdentity(resource);
    if (!current || !equal(identity, current.identity)) return { identity, ownershipVerified: false, state: 'unknown', unknownState: true, pendingWork: true };
    const result = await childSession.observe();
    if (!equal(result?.identity, current.identity)) return { identity: current.identity, ownershipVerified: false, state: 'unknown', unknownState: true, pendingWork: true };
    return { ...result, pendingWork: Boolean(owner) || result.pendingWork !== false };
  }
  async function safeRelease(ownerId) {
    if (!current || owner !== ownerId) return { ok: true, released: false };
    invalidate();
    const released = success(await childSession.release({ ownerId }), 'release');
    for (const target of targets.values()) target.heldKeys.clear();
    // Persisted resource lease remains protected if input release is unconfirmed.
    await resources.releaseLease(current.resourceId, current.lease, { state: current.uncertain ? 'unknown' : 'ready' });
    current.lease = null; owner = null;
    return { ...released, released: true, warm: true, loggedOff: false };
  }
  async function closeSession(resource) {
    if (!current || !equal(resourceIdentity(resource), current.identity)) throw new Error('Unknown isolated session identity');
    if (owner || current.lease) throw new Error('Isolated session remains leased');
    const observed = await observeSession(resource);
    for (const flag of ['pendingWork', 'directUser', 'unsavedWork', 'unknownState', 'unrelatedApps', 'pendingUserDecision', 'heldInput']) if (observed[flag] !== false) throw new Error(`Unsafe isolated close: ${flag}`);
    if (observed.ownershipVerified !== true || !['running', 'closed'].includes(observed.state)) throw new Error('Isolated ownership is unverified');
    if (observed.state !== 'closed') success(await childSession.stop({ ownerId: current.lastOwner }), 'normal close');
    const closed = await observeSession(resource);
    if (closed.state !== 'closed' || closed.ownershipVerified !== true || closed.processesStopped !== true || closed.logoffConfirmed !== true) throw new Error('Isolated normal closure is unconfirmed');
    current.closed = true; targets.clear(); return closed;
  }
  return {
    start(request) {
      fields(request, ['ownerId']); const { ownerId } = request, version = generation;
      text(ownerId, 'ownerId'); pendingStarts.set(ownerId, (pendingStarts.get(ownerId) || 0) + 1);
      return serial(async () => {
        await authorized(ownerId, 'start', version);
        if (owner && owner !== ownerId) throw new Error('Isolated session is occupied');
        if (owner === ownerId) return { ok: true, resourceId: current.resourceId, ...readiness(), reused: true };
        if (current?.closed) { current = null; targets.clear(); }
        if (current) {
          let lease;
          if (current.resourceId) lease = await resources.acquireLease(current.resourceId, ownerId);
          else {
            const registered = await resources.registerSession({ id: `child-${crypto.randomUUID()}`, workId: ownerId, runId: `isolation-${crypto.randomUUID()}`, identity: current.identity, ownershipVerified: true });
            current.resourceId = registered.id; lease = registered.lease;
          }
          let acquired;
          try { acquired = success(await childSession.acquire({ ownerId }), 'acquire'); if (acquired.ownershipVerified !== true || !equal(acquired.identity, current.identity)) throw new Error('Warm child identity is unverified'); }
          catch (error) { await resources.releaseLease(current.resourceId, lease, { state: 'unknown' }); throw error; }
          current.admitted = admitted(acquired, current.identity); current.admission = acquired.admission || null;
          current.lease = lease; current.lastOwner = ownerId; owner = ownerId;
        } else {
          const description = await childSession.describe();
          const started = await childSession.start({ ownerId });
          if (!started?.identity) success(started, 'start');
          const identity = started.identity, parent = description.environment?.parent;
          if (started.ownershipVerified !== true || !identity || !parent || identity.sid !== parent.sid || identity.profile !== parent.profile || identity.parentSessionId !== parent.sessionId || !Number.isInteger(identity.childSessionId) || identity.childSessionId === parent.sessionId) {
            await childSession.release({ ownerId }); throw new Error('Same-SID existing-profile child proof is unavailable');
          }
          current = { identity: copy(identity), lastOwner: ownerId, closed: false, admitted: admitted(started, identity), admission: started.admission || null }; owner = ownerId;
          try {
            const registered = await resources.registerSession({ id: `child-${crypto.randomUUID()}`, workId: ownerId, runId: `isolation-${crypto.randomUUID()}`, identity, ownershipVerified: true });
            current.resourceId = registered.id; current.lease = registered.lease;
          } catch (error) { await childSession.release({ ownerId }); owner = null; error.cleanupUnconfirmed = true; throw error; }
        }
        if (version !== generation) { await safeRelease(ownerId); throw new Error('Isolation operation stopped'); }
        if (!current.admitted) { await safeRelease(ownerId); return { ok: false, code: 'child_admission_incomplete', resourceId: current.resourceId, ...readiness(), admission: current.admission }; }
        return { ok: true, resourceId: current.resourceId, ...readiness(), admission: current.admission, dataModel: 'same_user_existing_profile' };
      }).finally(() => { const pending = pendingStarts.get(ownerId) - 1; if (pending) pendingStarts.set(ownerId, pending); else pendingStarts.delete(ownerId); });
    },
    launch(request) {
      fields(request, ['ownerId', 'parentIdentity']); const version = generation, parentIdentity = request.parentIdentity ? copy(request.parentIdentity) : null;
      return serial(async () => {
        const { ownerId } = request; await authorized(ownerId, 'launch', version); owned(ownerId);
        if ([...targets.values()].some(target => target.heldKeys.size)) throw new Error('Release held keys before launching another isolated application');
        if (!parentIdentity || await approveApp(ownerId, parentIdentity) !== true) throw new Error('Existing application approval required');
        if (typeof resolveExecutable !== 'function') throw new Error('Trusted executable resolver is unavailable');
        const executable = await resolveExecutable(parentIdentity);
        if (!executable || !path.isAbsolute(executable.executable || '') || !/^[a-f0-9]{64}$/i.test(executable.sha256 || '')) throw new Error('Pinned existing executable required');
        await authorized(ownerId, 'launch', version);
        invalidate();
        const result = success(await childSession.request({ ownerId, operation: 'launch', executable: executable.executable, sha256: executable.sha256.toLowerCase() }), 'launch');
        if (result.sessionId !== current.identity.childSessionId || !Number.isInteger(result.pid) || result.pid <= 0 || typeof result.created !== 'string' || !result.created || typeof result.hwnd !== 'string' || !/^[1-9][0-9]*$/.test(result.hwnd) || result.executable !== executable.executable) throw new Error('Native launched identity is unverified');
        const targetId = crypto.randomUUID();
        targets.set(targetId, { ownerId, parentIdentity: copy(parentIdentity), native: { pid: result.pid, created: result.created, hwnd: result.hwnd }, observation: null, heldKeys: new Set() });
        return { ok: true, targetId, ...readiness() };
      });
    },
    capture(request) {
      fields(request, ['ownerId', 'targetId']); const version = generation;
      return serial(async () => {
        const value = target(request.ownerId, request.targetId);
        await authorized(request.ownerId, 'capture', version, value.parentIdentity);
        invalidate();
        const result = success(await childSession.request({ ownerId: request.ownerId, operation: 'capture', ...value.native }), 'capture');
        const bounds = geometry(result, current.identity);
        if (typeof result.png !== 'string' || !result.png.length || result.png.length > 12 * 1024 * 1024) throw new Error('Bounded child capture is unavailable');
        if (generation !== version) throw new Error('Isolation operation stopped');
        const observationId = crypto.randomUUID(); value.observation = { id: observationId, ...bounds };
        return { ok: true, targetId: request.targetId, observationId, geometry: bounds, png: result.png, contentVerified: result.contentVerified === true, ...readiness() };
      });
    },
    input(request) {
      fields(request, ['ownerId', 'targetId', 'observationId', 'input']); const version = generation;
      return serial(async () => {
        const value = target(request.ownerId, request.targetId);
        await authorized(request.ownerId, 'input', version, value.parentIdentity);
        const observed = value.observation;
        if (!observed || observed.id !== request.observationId) throw new Error('Stale isolated observation');
        const input = checkedInput(request.input, observed);
        for (const other of targets.values()) if (other !== value && other.heldKeys.size) throw new Error('Release held keys before changing isolated application');
        const nextHeld = scopedKeys(value, input); invalidate();
        const fresh = success(await childSession.request({ ownerId: request.ownerId, operation: 'capture', ...value.native }), 'geometry check');
        const bounds = geometry(fresh, current.identity);
        if (bounds.width !== observed.width || bounds.height !== observed.height) throw new Error('Stale isolated capture bounds');
        await authorized(request.ownerId, 'input', version, value.parentIdentity);
        try {
          const result = success(await childSession.request({ ownerId: request.ownerId, operation: 'input', ...value.native, ...input }), 'input');
          if (result.sessionId !== current.identity.childSessionId || result.delivered !== true) throw new Error('Child input delivery or identity is unconfirmed; outcome unknown');
          value.heldKeys = nextHeld;
          return { ok: true, targetId: request.targetId, delivered: result.delivered === true, readbackVerified: result.readbackVerified === true, observationInvalidated: true, ...readiness() };
        } catch (error) { current.uncertain = true; error.mutationOutcome = 'unknown'; throw error; }
      });
    },
    release(ownerId) { text(ownerId, 'ownerId'); if (owner === ownerId || pendingStarts.has(ownerId)) { generation++; invalidate(); } return serial(() => safeRelease(ownerId)); },
    observeSession, closeSession,
  };
}
module.exports = { createIsolationController };
