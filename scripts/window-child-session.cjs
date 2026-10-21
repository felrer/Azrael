'use strict';

const path = require('node:path');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { promisify } = require('node:util');
const runFile = promisify(execFile);
const probePath = path.join(__dirname, '..', 'native', 'windows-child-session', 'probe.ps1');

// These are implementation/admission gates, never inferred from interface availability.
const missingAdapters = Object.freeze([
  'trusted_native_helper_not_configured',
]);

async function probeWindowsChildSession(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return { schemaVersion: 1, platform, readOnly: true, supported: false, errors: [] };
  let temporaryDirectory;
  try {
    // Absolute system PowerShell, no shell interpolation, no UAC or configuration changes.
    const windowsRoot = process.env.SystemRoot || 'C:\\Windows';
    const scriptPath = options.probePath || probePath;
    if (!path.isAbsolute(scriptPath)) throw new Error('Trusted absolute prerequisite probe path required');
    const temporaryRoot = options.tempDirectory || path.join(os.homedir(), '.azrael-ex', 'tmp', 'window-child-probe');
    if (!path.isAbsolute(temporaryRoot)) throw new Error('Absolute prerequisite temporary directory required');
    await fs.promises.mkdir(temporaryRoot, { recursive: true });
    temporaryDirectory = await fs.promises.mkdtemp(path.join(temporaryRoot, 'probe-'));
    const result = await runFile(path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true, timeout: 20000, maxBuffer: 128 * 1024, encoding: 'utf8',
        env: { ...process.env, TEMP: temporaryDirectory, TMP: temporaryDirectory } });
    const value = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
    if (value.schemaVersion !== 1 || value.platform !== 'win32' || value.readOnly !== true) throw new Error('Invalid child-session probe response');
    return value;
  } catch (error) {
    return { schemaVersion: 1, platform, readOnly: true, errors: [{ operation: 'nativeProbe', code: error.code || null,
      message: error.message, stderr: String(error.stderr || '').slice(0, 4096) }] };
  } finally {
    if (temporaryDirectory) await fs.promises.rm(temporaryDirectory, { recursive: true }).catch(() => {});
  }
}

function describeChildSession(environment, { enabled = false } = {}) {
  const prerequisites = [];
  const add = (code, detail) => prerequisites.push({ code, detail });
  if (environment?.platform !== 'win32') add('unsupported_platform', 'Windows child sessions require Windows.');
  else {
    if (!environment.parent?.sid || !Number.isInteger(environment.parent.sessionId) || !environment.parent.profile)
      add('parent_identity_unavailable', 'Current SID, profile and Windows session identity are required.');
    if (!environment.childSessions?.enabledQuerySucceeded)
      add('child_enablement_query_failed', environment.childSessions?.enabledError ?? null);
    else if (environment.childSessions.enabled !== true)
      add('child_sessions_not_enabled', 'Machine setup is required; app approval does not authorize enabling it.');
    if (!environment.childSessions?.idQuerySucceeded && environment.childSessions?.idError !== 1168)
      add('child_identity_query_failed', environment.childSessions?.idError ?? null);
    else if (environment.childSessions.childSessionId != null
      && !(environment.childSessions.sessionEnumerationSucceeded === true && environment.childSessions.reportedChildSessionLive === false))
      add('existing_child_not_owned', 'An existing child session cannot be adopted or logged off from this probe.');
    if (environment.service?.status !== 'Running') add('termservice_not_running', environment.service?.status || 'unknown');
    if (environment.activeX?.activated !== true) add('activex_unavailable', environment.activeX?.error || null);
    for (const name of ['extendedSettings', 'inputSink', 'scanCodeInput']) {
      if (environment.activeX?.interfaces?.[name]?.available !== true)
        add('activex_interface_unavailable', { name, hresult: environment.activeX?.interfaces?.[name]?.hresult ?? null });
    }
    for (const error of environment.errors || []) add('probe_error', error);
  }
  return {
    schemaVersion: 1, backend: 'windows-child-session', enabled: enabled === true,
    state: enabled !== true ? 'disabled' : prerequisites.length ? 'prerequisite_required' : 'backend_incomplete',
    available: false, admissionReady: false, parentFallback: false,
    environment, prerequisites, missingAdapters: [...missingAdapters],
    capabilities: { prerequisiteInspection: true, connection: false, sameSidWorker: false,
      appLaunch: false, capture: false, isolatedInput: false, sessionCleanup: false },
    // Same-account files/settings are shared; authentication and concurrent app behavior remain app-specific gates.
    dataModel: 'same_user_existing_profile',
    requiredVerification: ['connection', 'same_sid_and_profile', 'app_launch_identity', 'render_content', 'isolated_input_readback', 'saved_data_compatibility', 'safe_cleanup'],
  };
}

function verifyNativeHelper(helper) {
  if (!helper || !path.isAbsolute(helper.path) || !/^[a-f0-9]{64}$/i.test(helper.sha256 || '')) throw new Error('Pinned trusted native helper is required');
  const stat = fs.lstatSync(helper.path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Native helper must be a regular executable');
  const actual = crypto.createHash('sha256').update(fs.readFileSync(helper.path)).digest('hex');
  if (actual !== helper.sha256.toLowerCase()) throw new Error('Native helper hash mismatch');
}

async function prepareWindowsChildSession(helper) {
  try {
    verifyNativeHelper(helper);
    const result = await runFile(helper.path, ['--request-machine-setup'], {
      windowsHide: true, timeout: 180000, maxBuffer: 128 * 1024, encoding: 'utf8',
    });
    const value = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
    if (!value || typeof value.ok !== 'boolean') throw new Error('Invalid machine setup response');
    return value;
  } catch (error) {
    if (error.stdout && !error.killed && Number.isInteger(error.code)) {
      try {
        const value = JSON.parse(String(error.stdout).replace(/^\uFEFF/, '').trim());
        if (value?.ok === false && typeof value.code === 'string') return value;
      } catch {}
    }
    return { ok: false, code: error.killed ? 'child_setup_unknown' : 'child_setup_failed', message: error.message,
      cleanupUnconfirmed: error.killed === true };
  }
}

function createNativeTransport(helper, { reconcileBootstrap = false, mode } = {}) {
  verifyNativeHelper(helper);
  if (mode !== undefined && mode !== 'inspectClosure') throw new Error('Unsupported native child transport mode');
  if (mode && reconcileBootstrap) throw new Error('Conflicting native child transport modes');
  const child = spawn(helper.path, mode === 'inspectClosure' ? ['--inspect-closure'] : reconcileBootstrap ? ['--reconcile-bootstrap'] : [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = readline.createInterface({ input: child.stdout });
  let pending, terminal, diagnostic = '';
  let exited = false, resolveExit;
  const exitPromise = new Promise(resolve => { resolveExit = resolve; });
  child.on('close', () => { exited = true; resolveExit(true); });
  child.stderr.on('data', value => { diagnostic = (diagnostic + value).slice(-4096); });
  function fail(error) { terminal = error; if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null; } }
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.stdout.on('error', fail);
  child.on('exit', (code, signal) => fail(new Error(`Native child helper exited (${code ?? signal}): ${diagnostic}`)));
  lines.on('line', line => {
    if (line.length > 16 * 1024 * 1024) return fail(new Error('Native child response exceeded bounded payload'));
    if (!pending) return fail(new Error('Unexpected native child response'));
    const request = pending; pending = null; clearTimeout(request.timer);
    try { request.resolve(JSON.parse(line)); } catch (error) { fail(error); request.reject(error); }
  });
  return {
    request(value, timeoutMs = 15000) {
      if (terminal) return Promise.reject(terminal);
      if (pending) return Promise.reject(new Error('Native child request already running'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.stdin.end(); fail(new Error('Native child response timed out; session cleanup is unconfirmed'));
        }, timeoutMs);
        pending = { resolve, reject, timer };
        child.stdin.write(`${JSON.stringify(value)}\n`, error => { if (error) fail(error); });
      });
    },
    disconnect() { child.stdin.end(); },
    async waitForExit(timeoutMs = 15000) {
      if (exited) return true;
      let timer;
      try { return await Promise.race([exitPromise, new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]); }
      finally { clearTimeout(timer); }
    },
    get healthy() { return !terminal; },
  };
}

const admissionIdentityKeys = ['sid', 'profile', 'parentSessionId', 'childSessionId', 'workerPid', 'workerCreated'];
const closureIdentityKeys = [...admissionIdentityKeys, 'sessionAnchorPid', 'sessionAnchorCreated'];
const closureUnsafeFlags = ['pendingWork', 'directUser', 'unsavedWork', 'unknownState', 'unrelatedApps', 'pendingUserDecision', 'heldInput'];
function completeClosureIdentity(value) {
  return value && Object.keys(value).length === closureIdentityKeys.length && closureIdentityKeys.every(key => Object.hasOwn(value, key))
    && typeof value.sid === 'string' && value.sid.length > 0 && typeof value.profile === 'string' && value.profile.length > 0
    && Number.isInteger(value.parentSessionId) && value.parentSessionId >= 0 && Number.isInteger(value.childSessionId) && value.childSessionId > 0 && value.childSessionId !== value.parentSessionId
    && Number.isInteger(value.workerPid) && value.workerPid > 0 && Number.isInteger(value.sessionAnchorPid) && value.sessionAnchorPid > 0 && value.sessionAnchorPid !== value.workerPid
    && typeof value.workerCreated === 'string' && /^[1-9][0-9]{0,18}$/.test(value.workerCreated)
    && typeof value.sessionAnchorCreated === 'string' && /^[1-9][0-9]{0,18}$/.test(value.sessionAnchorCreated);
}
const admissionGateNames = ['connection', 'render', 'keyboard', 'mouse', 'parentIdentity', 'dataProfile'];
function readManualRecoveryRequest(file, environment) {
  if (!file) return null;
  if (!path.isAbsolute(file)) throw new Error('Absolute manual recovery request path required');
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 8192) throw new Error('Invalid manual recovery request file');
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    const info = fs.lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Manual recovery request ancestry changed');
    if (path.dirname(directory) === directory) break;
  }
  const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const keys = ['schemaVersion', 'requestId', 'sid', 'profile', 'parentSessionId', 'childSessionId', 'createdUtc', 'expiresUtc'];
  const parent = environment?.parent, child = environment?.childSessions;
  const created = Date.parse(value.createdUtc), expires = Date.parse(value.expiresUtc), now = Date.now();
  if (Object.keys(value).some(key => !keys.includes(key)) || value.schemaVersion !== 1
    || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.requestId || '')
    || !Number.isInteger(value.childSessionId) || value.childSessionId <= 0 || value.childSessionId === parent?.sessionId
    || value.sid !== parent?.sid || value.parentSessionId !== parent?.sessionId
    || typeof value.profile !== 'string' || typeof parent?.profile !== 'string'
    || path.win32.resolve(value.profile).toLowerCase() !== path.win32.resolve(parent.profile).toLowerCase()
    || !Number.isFinite(created) || !Number.isFinite(expires) || created > now + 5000 || expires <= now
    || expires <= created || expires - created > 600000 || now - created > 600000
    || child?.idQuerySucceeded !== true || child.sessionEnumerationSucceeded !== true
    || child.reportedChildSessionLive !== true || child.childSessionId !== value.childSessionId)
    throw new Error('Manual recovery request is expired or does not identify the current same-user child');
  return { value, identity: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}` };
}
function consumeManualRecoveryRequest(file, observed, environment) {
  const current = readManualRecoveryRequest(file, environment);
  if (!current || current.identity !== observed.identity || JSON.stringify(current.value) !== JSON.stringify(observed.value))
    throw new Error('Manual recovery request changed before consumption');
  const consumed = path.join(path.dirname(file), `consumed-${observed.value.requestId}.json`);
  if (fs.existsSync(consumed)) throw new Error('Manual recovery request was already consumed');
  fs.renameSync(file, consumed);
  const renamed = fs.lstatSync(consumed);
  if (`${renamed.dev}:${renamed.ino}:${renamed.size}:${renamed.mtimeMs}` !== observed.identity)
    throw new Error('Manual recovery request identity changed');
  return { value: observed.value, file: consumed, identity: observed.identity };
}
function cleanupConsumedRecoveryRequest(consumed) {
  try {
    for (let parent = path.dirname(consumed.file); ; parent = path.dirname(parent)) {
      const info = fs.lstatSync(parent);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Recovery request ancestry changed');
      if (path.dirname(parent) === parent) break;
    }
    const info = fs.lstatSync(consumed.file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1
      || `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}` !== consumed.identity
      || JSON.stringify(JSON.parse(fs.readFileSync(consumed.file, 'utf8'))) !== JSON.stringify(consumed.value)) throw new Error('Consumed request identity changed');
    fs.unlinkSync(consumed.file);
    return { state: fs.existsSync(consumed.file) ? 'deferred' : 'complete', remainingPaths: fs.existsSync(consumed.file) ? [consumed.file] : [] };
  } catch { return { state: 'deferred', remainingPaths: [consumed.file] }; }
}
function passedChildAdmission(proof, identity, helper) {
  return Boolean(proof && identity && helper && proof.scope === 'child_platform_fixture'
    && typeof helper.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(helper.sha256)
    && typeof proof.helperSha256 === 'string' && proof.helperSha256.toLowerCase() === helper.sha256.toLowerCase()
    && admissionIdentityKeys.every(key => proof.identity?.[key] === identity[key])
    && admissionGateNames.every(key => proof.gates?.[key]?.passed === true) && proof.fixtureClosed?.passed === true);
}

function createWindowsChildSessionManager({ enabled = false, probe = probeWindowsChildSession,
  nativeHelper, bootstrapJournalPath, manualRecoveryRequestPath, authorize = async () => false, transportFactory = createNativeTransport,
  prepareMachine = prepareWindowsChildSession } = {}) {
  let transport, identity, inputOwner, inFlight = false, uncertain = false, inputNeedsRelease = false, lastClosure, lastReconciliation, admission, admissionAccepted = false;
  const isEnabled = () => typeof enabled === 'function' ? enabled() === true : enabled === true;
  const admitted = () => admissionAccepted && isEnabled() && !uncertain && transport?.healthy !== false && passedChildAdmission(admission, identity, nativeHelper);
  async function describe() {
    const value = describeChildSession(await probe(), { enabled: isEnabled() });
    value.nativeHelperConfigured = Boolean(nativeHelper);
    value.identity = identity || null; value.inputOwner = inputOwner || null; value.cleanupUnconfirmed = uncertain;
    value.lastClosed = lastClosure || null;
    value.bootstrapReconciliation = lastReconciliation || null;
    value.bootstrapJournalConfigured = Boolean(bootstrapJournalPath && path.isAbsolute(bootstrapJournalPath));
    if (nativeHelper) {
      value.missingAdapters = [];
      value.requiredVerification = ['connection', 'same_sid_and_profile', 'app_launch_identity', 'render_content', 'isolated_input_readback', 'saved_data_compatibility', 'safe_cleanup'];
      if (value.state === 'backend_incomplete') value.state = 'unverified';
    }
    if (transport?.healthy === false) uncertain = true;
    let liveIdentity = false;
    if (identity) {
      const observed = value.environment;
      value.prerequisites = value.prerequisites.filter(item => item.code !== 'existing_child_not_owned'
        || observed.childSessions?.childSessionId !== identity.childSessionId);
      const sameParent = observed.parent?.sessionId === identity.parentSessionId && observed.parent?.sid === identity.sid && observed.parent?.profile === identity.profile;
      liveIdentity = sameParent && observed.childSessions?.idQuerySucceeded === true && observed.childSessions.childSessionId === identity.childSessionId;
      value.state = admitted() && liveIdentity && !value.prerequisites.length ? 'admitted' : 'connected_unverified';
      value.available = value.admissionReady = value.state === 'admitted';
      value.capabilities = { ...value.capabilities, connection: !uncertain && liveIdentity, sameSidWorker: !uncertain && liveIdentity, appLaunch: value.available,
        capture: value.available, isolatedInput: value.available && !inputNeedsRelease, sessionCleanup: !uncertain && liveIdentity };
    }
    value.admission = admission || null;
    value.cleanupUnconfirmed = uncertain;
    value.ownershipVerified = Boolean(identity && !uncertain && liveIdentity);
    value.inputRevalidationRequired = inputNeedsRelease;
    value.applicationCompatibility = 'unverified';
    return value;
  }
  function owner(request) {
    if (!request || typeof request.ownerId !== 'string' || !request.ownerId.trim()) throw new Error('Trusted task owner identity is required');
    if (inputOwner && request.ownerId !== inputOwner) throw new Error('Child session input is occupied by another task');
  }
  async function exclusive(action) {
    if (inFlight) return { ok: false, code: 'child_session_occupied' };
    inFlight = true;
    try { return await action(); } finally { inFlight = false; }
  }
  async function retireTransport() {
    if (!transport) return true;
    transport.disconnect();
    // A broken pipe is not proof that its producer has stopped. Never spawn a
    // second helper until this exact transport reports terminal process closure.
    if (typeof transport.waitForExit !== 'function' || await transport.waitForExit() !== true) return false;
    transport = null;
    return true;
  }
  async function recoverConnection(request, status) {
    owner(request);
    if (!isEnabled()) return { ok: false, code: 'stage3_disabled' };
    const previousIdentity = identity && { ...identity };
    if (previousIdentity && !completeClosureIdentity(previousIdentity)) return { ok: false, code: 'child_session_identity_mismatch' };
    if (await authorize(previousIdentity ? 'acquire' : 'start', request, previousIdentity) !== true) return { ok: false, code: 'child_session_authority_required' };
    status ||= await describe();
    const env = status.environment, child = env?.childSessions;
    if (!nativeHelper || status.prerequisites.some(item => item.code !== 'existing_child_not_owned')
      || child?.idQuerySucceeded !== true || child.sessionEnumerationSucceeded !== true || child.reportedChildSessionLive !== true
      || (previousIdentity && (child.childSessionId !== previousIdentity.childSessionId || env.parent?.sid !== previousIdentity.sid
        || env.parent?.profile !== previousIdentity.profile || env.parent?.sessionId !== previousIdentity.parentSessionId)))
      return { ok: false, code: 'child_session_identity_mismatch', actionExecuted: false };
    if (!await retireTransport()) return { ok: false, code: 'child_transport_termination_unconfirmed', cleanupUnconfirmed: true };
    if (await authorize(previousIdentity ? 'acquire' : 'start', request, previousIdentity) !== true || !isEnabled()) return { ok: false, code: 'child_session_authority_required' };
    try {
      admissionAccepted = false;
      transport = transportFactory(nativeHelper);
      const result = await transport.request({ operation: 'recover', automaticRecovery: true, recoveryRequestId: crypto.randomUUID(),
        childSessionId: child.childSessionId, ownerId: request.ownerId, helperSha256: nativeHelper.sha256.toLowerCase(), bootstrapJournalPath,
        ...(previousIdentity ? { expectedIdentity: previousIdentity } : {}) }, 240000);
      if (result.ok !== true) {
        uncertain = result.cleanupUnconfirmed === true;
        await retireTransport();
        return { ...result, available: false, admissionReady: false };
      }
      const peer = result.identity;
      const anchorKeys = ['sid', 'profile', 'parentSessionId', 'childSessionId', 'sessionAnchorPid', 'sessionAnchorCreated'];
      if (result.ownershipVerified !== true || result.inputReleased !== true || !completeClosureIdentity(peer)
        || peer.sid !== env.parent.sid || peer.profile !== env.parent.profile || peer.parentSessionId !== env.parent.sessionId
        || peer.childSessionId !== child.childSessionId || (previousIdentity && !anchorKeys.every(key => peer[key] === previousIdentity[key]))
        || !passedChildAdmission(result.admission, peer, nativeHelper)
        || !closureIdentityKeys.every(key => result.admission.identity?.[key] === peer[key])) {
        uncertain = true;
        return { ok: false, code: 'child_session_identity_mismatch', available: false, admissionReady: false, cleanupUnconfirmed: true };
      }
      identity = { ...peer }; admission = JSON.parse(JSON.stringify(result.admission)); uncertain = false; inputNeedsRelease = false;
      inputOwner = request.ownerId;
      if (await authorize(previousIdentity ? 'acquire' : 'start', request, identity) !== true || !isEnabled()) {
        const released = await transport.request({ operation: 'releaseLease' });
        if (released?.ok === true && released.inputReleased === true) inputOwner = null;
        else inputNeedsRelease = true;
        return { ok: false, code: 'child_session_authority_required', identity, previousIdentity, available: false, admissionReady: false };
      }
      admissionAccepted = true;
      return { ...result, identity: { ...identity }, previousIdentity, connectionRecovered: true, inputReleased: true,
        admission, available: true, admissionReady: true, inputOwner };
    } catch (error) { uncertain = true; return { ok: false, code: 'child_transport_failed', message: error.message, cleanupUnconfirmed: true }; }
  }
  async function ensureConnected(request) {
    owner(request);
    if (!isEnabled()) return { ok: false, code: 'stage3_disabled' };
    if (!identity) return recoverConnection(request);
    if (await authorize('acquire', request, identity) !== true) return { ok: false, code: 'child_session_authority_required' };
    if (uncertain || !transport || transport.healthy === false || !admissionAccepted) return recoverConnection(request);
    try {
      const current = await describe();
      if (!current.available) return { ok: false, code: 'child_session_live_validation_required' };
      const observed = await transport.request({ operation: 'status' });
      if (observed?.ok !== true || observed.ownershipVerified !== true || observed.sessionId !== identity.childSessionId || observed.state !== 'running'
        || (observed.identity && !closureIdentityKeys.every(key => observed.identity[key] === identity[key]))) {
        admissionAccepted = false;
        return { ok: false, code: observed?.code || 'child_session_identity_mismatch' };
      }
      if (!inputOwner) {
        const acquired = await transport.request({ operation: 'acquireLease', ownerId: request.ownerId });
        if (acquired?.ok !== true) return acquired;
        if (acquired.inputReleased !== true || !(acquired.sessionId === identity.childSessionId
          || (acquired.ownershipVerified === true && closureIdentityKeys.every(key => acquired.identity?.[key] === identity[key]))))
          return { ok: false, code: 'child_session_identity_mismatch' };
        inputOwner = request.ownerId;
      }
      if (await authorize('acquire', request, identity) !== true || !isEnabled()) {
        admissionAccepted = false;
        const released = await transport.request({ operation: 'releaseLease' });
        if (released?.ok === true) inputOwner = null;
        return { ok: false, code: 'child_session_authority_required' };
      }
      return { ok: true, ownershipVerified: true, identity: { ...identity }, admission, available: admitted(), admissionReady: admitted(), inputOwner };
    } catch { uncertain = true; return recoverConnection(request); }
  }
  async function revalidateInput(request) {
    owner(request);
    if (!identity || uncertain || transport?.healthy === false) return { ok: false, code: 'child_session_not_connected' };
    if (!isEnabled()) return { ok: false, code: 'stage3_disabled' };
    if (await authorize('acquire', request, identity) !== true) return { ok: false, code: 'child_session_authority_required' };
    const current = await describe();
    if (current.available !== true) return { ok: false, code: 'child_session_live_validation_required' };
    try {
      const observed = await transport.request({ operation: 'status' });
      if (observed?.ok !== true || observed.sessionId !== identity.childSessionId || observed.ownershipVerified !== true || observed.state !== 'running') return { ok: false, code: 'child_session_identity_mismatch' };
      // Release only: never replay the uncertain action or reconnect/create a session.
      inputNeedsRelease = true;
      const released = await transport.request({ operation: 'releaseInput' });
      if (released?.ok !== true || released.inputReleased !== true || released.sessionId !== identity.childSessionId) return { ok: false, code: 'child_input_release_unconfirmed', inputReleaseConfirmed: false };
      inputNeedsRelease = false;
      if (!isEnabled() || await authorize('acquire', request, identity) !== true) return { ok: false, code: 'child_session_authority_required' };
      return { ok: true, ownershipVerified: true, identity: { ...identity }, inputReleased: true, admissionReady: admitted(), available: admitted(), admission };
    } catch (error) { uncertain = true; return { ok: false, code: 'child_transport_failed', message: error.message, cleanupUnconfirmed: true }; }
  }
  async function reconcileBootstrap() {
    if (!nativeHelper) return lastReconciliation = { ok: false, code: 'child_session_backend_incomplete' };
    if (!bootstrapJournalPath || !path.isAbsolute(bootstrapJournalPath)) return lastReconciliation = { ok: false, code: 'child_bootstrap_journal_required' };
    let channel;
    try {
      channel = transportFactory(nativeHelper, { reconcileBootstrap: true });
      lastReconciliation = await channel.request({ helperSha256: nativeHelper.sha256.toLowerCase(), bootstrapJournalPath });
      return lastReconciliation;
    } catch (error) {
      lastReconciliation = { ok: false, state: 'bootstrap_reconciliation_deferred', reason: error.message };
      return lastReconciliation;
    } finally { if (channel) channel.disconnect(); }
  }
  return {
    describe,
    status: describe,
    async reconcileBootstrap() { return exclusive(reconcileBootstrap); },
    async inspectClosure(original) {
      const deferred = () => ({ ok: false, state: 'unknown', ownershipVerified: false, unknownState: true,
        code: 'child_closure_unconfirmed', logoffConfirmed: false, processesStopped: false });
      if (!nativeHelper || !completeClosureIdentity(original)) return deferred();
      const expected = { ...original };
      let channel;
      try {
        channel = transportFactory(nativeHelper, { mode: 'inspectClosure' });
        const result = await channel.request({ helperSha256: nativeHelper.sha256.toLowerCase(), identity: expected });
        if (result.ok !== true || result.state !== 'closed' || result.ownershipVerified !== true
          || result.logoffConfirmed !== true || result.processesStopped !== true || !completeClosureIdentity(result.identity)
          || !closureIdentityKeys.every(key => result.identity[key] === expected[key])
          || !closureUnsafeFlags.every(key => result[key] === false)) return deferred();
        return { ok: true, state: 'closed', identity: expected, ownershipVerified: true, logoffConfirmed: true,
          processesStopped: true, ...Object.fromEntries(closureUnsafeFlags.map(key => [key, false])) };
      } catch { return deferred(); }
      finally { if (channel) channel.disconnect(); }
    },
    async retireClosed(original) { return exclusive(async () => {
      if (!identity || !completeClosureIdentity(original) || !closureIdentityKeys.every(key => identity[key] === original[key]))
        return { ok: false, code: 'child_session_identity_mismatch', ownershipVerified: false, state: 'unknown' };
      const closure = await this.inspectClosure(original);
      if (closure.ok !== true) return closure;
      if (transport) transport.disconnect();
      lastClosure = closure; identity = null; admission = null; admissionAccepted = false; inputOwner = null; transport = null; uncertain = false;
      return closure;
    }); },
    async start(request = {}) { return exclusive(async () => {
      let status = await describe();
      if (identity) return ensureConnected(request);
      let recovery;
      try { recovery = status.state === 'disabled' ? null : readManualRecoveryRequest(manualRecoveryRequestPath, status.environment); }
      catch (error) { return { ok: false, code: 'manual_recovery_request_invalid', message: error.message, available: false, admissionReady: false }; }
      if (!recovery && status.environment?.childSessions?.reportedChildSessionLive === true
        && status.environment.childSessions.sessionEnumerationSucceeded === true) return recoverConnection(request, status);
      const blockers = status.prerequisites.filter(item => !(item.code === 'child_identity_query_failed' && item.detail === 1168));
      const setupCodes = new Set(['child_sessions_not_enabled', 'termservice_not_running']);
      const unsafeBlockers = blockers.filter(item => !setupCodes.has(item.code) && !(recovery && item.code === 'existing_child_not_owned'));
      if (status.state === 'disabled' || unsafeBlockers.length || !nativeHelper || uncertain) return {
        ok: false, code: status.state === 'disabled' ? 'stage3_disabled' : uncertain ? 'child_cleanup_unconfirmed'
          : blockers.length ? 'child_session_prerequisites' : 'child_session_backend_incomplete',
        message: 'No child session was created. See prerequisite and verification gates.', ...status,
      };
      owner(request);
      if (identity) return { ok: false, code: 'child_session_already_owned', identity };
      if (await authorize('start', request) !== true) return { ok: false, code: 'child_session_authority_required' };
      if (recovery && blockers.some(item => item.code !== 'existing_child_not_owned')) return { ...status, ok: false, code: 'child_session_prerequisites' };
      if (!recovery && blockers.length) {
        const setup = await prepareMachine(nativeHelper);
        if (setup.cleanupUnconfirmed === true || setup.code === 'child_setup_unknown') uncertain = true;
        if (setup.ok !== true) return { ...setup, ok: false, available: false, admissionReady: false };
        status = await describe();
        if (status.prerequisites.length) return { ...status, ok: false, code: 'child_session_prerequisites' };
      }
      if (!isEnabled() || await authorize('start', request) !== true) return { ok: false, code: 'child_session_authority_required' };
      if (!recovery) {
        const reconciliation = await reconcileBootstrap();
        if (!reconciliation.ok) return { ok: false, code: reconciliation.code || 'child_bootstrap_reconciliation_required', reconciliation };
      }
      if (!isEnabled() || await authorize('start', request) !== true) return { ok: false, code: 'child_session_authority_required' };
      try {
        if (recovery) {
          status = await describe();
          recovery = consumeManualRecoveryRequest(manualRecoveryRequestPath, recovery, status.environment);
          if (!isEnabled() || await authorize('start', request) !== true) return { ok: false, code: 'child_session_authority_required', recoveryRequestCleanup: cleanupConsumedRecoveryRequest(recovery) };
        }
        transport = transportFactory(nativeHelper);
        const result = await transport.request({ operation: recovery ? 'recover' : 'start', helperSha256: nativeHelper.sha256.toLowerCase(), bootstrapJournalPath, ownerId: request.ownerId,
          ...(recovery ? { childSessionId: recovery.value.childSessionId, recoveryRequestId: recovery.value.requestId } : {}) }, recovery ? 240000 : 55000);
        // The request bytes have been consumed; a terminal native reply no longer uses this file.
        if (recovery) result.recoveryRequestCleanup = cleanupConsumedRecoveryRequest(recovery);
        const peer = result.identity, parent = status.environment.parent;
        if (!peer && result.ok !== true) { uncertain = result.cleanupUnconfirmed === true; return { ...result, admissionReady: false, available: false }; }
        if (result.ownershipVerified !== true || !peer || peer.parentSessionId !== parent.sessionId || peer.childSessionId === parent.sessionId
          || !Number.isInteger(peer.childSessionId) || (recovery && peer.childSessionId !== recovery.value.childSessionId) || peer.sid !== parent.sid || peer.profile !== parent.profile
          || !Number.isInteger(peer.workerPid) || peer.workerPid <= 0 || typeof peer.workerCreated !== 'string' || !peer.workerCreated) {
          uncertain = true; return { ok: false, code: 'child_session_identity_mismatch', ...(result.recoveryRequestCleanup ? { recoveryRequestCleanup: result.recoveryRequestCleanup } : {}) };
        }
        identity = { ...peer }; inputOwner = request.ownerId; uncertain = result.cleanupUnconfirmed === true;
        admission = result.admission ? JSON.parse(JSON.stringify(result.admission)) : null;
        admissionAccepted = result.ok === true && passedChildAdmission(admission, identity, nativeHelper);
        if (recovery && (!isEnabled() || await authorize('start', request, identity) !== true)) {
          admissionAccepted = false;
          try { await transport.request({ operation: 'releaseInput' }); } catch { uncertain = true; }
          return { ...result, ok: false, code: 'child_session_authority_required', admissionReady: false, available: false, cleanupUnconfirmed: uncertain };
        }
        const ready = result.ok === true && admitted();
        return { ...result, ok: ready, code: ready ? undefined : 'child_session_admission_failed',
          ownershipVerified: true, admissionReady: ready, available: ready, admission,
          applicationCompatibility: 'unverified', requiredVerification: status.requiredVerification };
      } catch (error) { uncertain = true; return { ok: false, code: 'child_transport_failed', message: error.message, cleanupUnconfirmed: true,
        ...(recovery?.file ? { recoveryRequestCleanup: { state: 'deferred', remainingPaths: [recovery.file] } } : {}) }; }
    }); },
    async request(request = {}) { return exclusive(async () => {
      owner(request);
      if (!identity) return { ok: false, code: 'child_session_not_connected' };
      if (!['launch', 'capture', 'input', 'releaseInput'].includes(request.operation)) return { ok: false, code: 'child_operation_unsupported' };
      if (uncertain || transport?.healthy === false) {
        const recovery = await recoverConnection(request);
        return { ...recovery, ok: false, code: recovery.ok ? 'child_connection_recovered_observation_required' : recovery.code,
          actionExecuted: false, executionState: 'not_executed', mutationOutcome: 'not_executed', observationRequired: true,
          ...(recovery.ok ? { connectionVerification: recovery } : {}) };
      }
      if (request.ownerId !== inputOwner) return { ok: false, code: 'child_input_lease_required' };
      if (!isEnabled() && request.operation !== 'releaseInput') return { ok: false, code: 'stage3_disabled' };
      if (!['launch', 'capture', 'input', 'releaseInput'].includes(request.operation)) return { ok: false, code: 'child_operation_unsupported' };
      if (request.operation !== 'releaseInput' && !admitted()) return { ok: false, code: 'child_session_admission_required' };
      if (await authorize(request.operation, request, identity) !== true) return { ok: false, code: 'child_session_authority_required' };
      if (request.operation === 'input' && inputNeedsRelease) return { ok: false, code: 'child_input_revalidation_required', actionExecuted: false };
      try {
        const result = await transport.request(request);
        if (result?.cleanupUnconfirmed === true || transport.healthy === false) {
          uncertain = true;
          const recovery = await recoverConnection(request);
          const outcome = result?.mutationOutcome || (result?.actionExecuted === false ? 'not_executed' : 'unknown');
          return { ...result, ok: false, mutationOutcome: outcome, executionState: outcome, observationRequired: true,
            cleanupUnconfirmed: uncertain, connectionRecovered: recovery.connectionRecovered === true, recovery,
            ...(recovery.connectionRecovered ? { connectionVerification: recovery, identity: recovery.identity,
              previousIdentity: recovery.previousIdentity, inputReleased: true, admission: recovery.admission } : {}) };
        }
        if (request.operation === 'input' && result?.ok !== true) inputNeedsRelease = result?.inputReleaseConfirmed !== true;
        if (request.operation === 'releaseInput') {
          inputNeedsRelease = result?.ok !== true || result.inputReleased !== true || result.sessionId !== identity.childSessionId;
          if (inputNeedsRelease) return { ok: false, code: 'child_input_release_unconfirmed', inputReleaseConfirmed: false };
        }
        return result;
      }
      catch (error) {
        uncertain = true;
        const recovery = await recoverConnection(request);
        return { ok: false, code: 'child_transport_failed', message: error.message, executionState: 'unknown', mutationOutcome: 'unknown', observationRequired: true,
          cleanupUnconfirmed: uncertain, connectionRecovered: recovery.connectionRecovered === true, recovery,
          ...(recovery.connectionRecovered ? { connectionVerification: recovery, identity: recovery.identity, previousIdentity: recovery.previousIdentity, inputReleased: true, admission: recovery.admission } : {}) };
      }
    }); },
    async stop(request = {}) { return exclusive(async () => {
      owner(request);
      if (!identity || uncertain) return { ok: false, code: uncertain ? 'child_cleanup_unconfirmed' : 'child_session_not_owned' };
      if (await authorize('stop', request, identity) !== true) return { ok: false, code: 'child_session_authority_required' };
      try {
        const result = await transport.request({ operation: 'stop' }, 30000);
        if (result.ok && ['stopped', 'closed'].includes(result.state)) { lastClosure = { ...result, identity }; identity = null; admission = null; inputOwner = null; transport.disconnect(); transport = null; }
        return result;
      } catch (error) { uncertain = true; return { ok: false, code: 'child_cleanup_unconfirmed', message: error.message }; }
    }); },
    async observe() {
      if (inFlight) return { ownershipVerified: false, pendingWork: true, state: identity ? 'running' : 'unknown', identity: identity || null };
      if (!identity) return lastClosure || { ownershipVerified: false, state: 'absent', pendingWork: false, bootstrapReconciliation: lastReconciliation || null };
      return exclusive(async () => {
        if (uncertain) return { ownershipVerified: false, state: 'unknown', unknownState: true, identity };
        try { const result = await transport.request({ operation: 'status' }); return { ...result, pendingWork: Boolean(inputOwner) || result.pendingWork === true, identity }; }
        catch (error) { uncertain = true; return { ownershipVerified: false, state: 'unknown', unknownState: true, identity, error: error.message }; }
      });
    },
    async release(request = {}) { return exclusive(async () => {
      owner(request);
      if (!identity || uncertain) return { ok: false, code: 'child_session_not_connected' };
      try {
        const result = await transport.request({ operation: 'releaseLease' });
        if (result.ok !== true || result.inputReleased !== true || !(result.sessionId === identity.childSessionId
          || (result.ownershipVerified === true && closureIdentityKeys.every(key => result.identity?.[key] === identity[key])))) { inputNeedsRelease = true; return { ok: false, code: 'child_input_release_unconfirmed', inputReleaseConfirmed: false }; }
        inputNeedsRelease = false; inputOwner = null;
        return result;
      } catch (error) { uncertain = true; return { ok: false, code: 'child_transport_failed', message: error.message, cleanupUnconfirmed: true }; }
    }); },
    revalidateInput: (request = {}) => exclusive(() => revalidateInput(request)),
    ensureConnected: (request = {}) => exclusive(() => ensureConnected(request)),
    async acquire(request = {}) { return exclusive(async () => {
      const verified = await ensureConnected(request);
      if (verified.ok !== true) return verified;
      inputOwner = request.ownerId;
      return { ...verified, inputOwner };
    }); },
  };
}

module.exports = { probeWindowsChildSession, describeChildSession, createWindowsChildSessionManager, createNativeTransport };

function installedApplicationError(code) {
  return Object.assign(new Error(code), { code });
}

// Fixed current-user registration query. Model-provided values travel only through stdin.
const installedApplicationQuery = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$packages = @(Get-AppxPackage -Name $request.packageName | Where-Object { $_.Name -ceq $request.packageName })
if ($packages.Count -ne 1) { throw 'installed_application_registration_missing_or_ambiguous' }
$package = $packages[0]
$manifest = Get-AppxPackageManifest -Package $package.PackageFullName
$applications = @($manifest.Package.Applications.Application | ForEach-Object {
  @{ id = [string]$_.Id; executable = [string]$_.Executable; entryPoint = [string]$_.EntryPoint }
})
if ($applications.Count -gt 128) { throw 'installed_application_registration_invalid' }
@{ name = [string]$package.Name; fullName = [string]$package.PackageFullName; installLocation = [string]$package.InstallLocation; applications = $applications } | ConvertTo-Json -Depth 5 -Compress
`;

async function queryInstalledApplication(packageName) {
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(installedApplicationQuery, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false, bytes = 0;
    const output = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => { child.kill(); finish(installedApplicationError('installed_application_query_timeout')); }, 20000);
    child.on('error', () => finish(installedApplicationError('installed_application_query_failed')));
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 65536) { child.kill(); finish(installedApplicationError('installed_application_query_oversize')); return; }
      output.push(chunk);
    });
    // Drain stderr without returning platform diagnostics or unbounded registration data.
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) { child.kill(); finish(installedApplicationError('installed_application_query_oversize')); } });
    child.on('close', code => {
      if (code !== 0) return finish(installedApplicationError('installed_application_query_failed'));
      try { finish(null, JSON.parse(Buffer.concat(output).toString('utf8').replace(/^\uFEFF/, '').trim())); }
      catch { finish(installedApplicationError('installed_application_registration_invalid')); }
    });
    child.stdin.end(JSON.stringify({ packageName }));
  });
}

async function inspectInstalledExecutable(root, executable) {
  // Inspect every ancestor as well as the final file. Junctions and symbolic links
  // cannot redirect a registered package path outside its inspected installation.
  let current = executable;
  for (;;) {
    const info = await fs.promises.lstat(current);
    if (info.isSymbolicLink() || (current === executable ? !info.isFile() : !info.isDirectory())) throw installedApplicationError('installed_application_path_invalid');
    // Node's asynchronous native Windows realpath opens each ancestor and is
    // denied on WindowsApps itself. The standard synchronous walker resolves
    // links using the inspected entries without requiring directory-open rights.
    const resolved = fs.realpathSync(current);
    if (path.normalize(resolved).toLowerCase() !== path.normalize(current).toLowerCase()) throw installedApplicationError('installed_application_path_invalid');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!path.relative(root, executable) || path.relative(root, executable).startsWith('..' + path.sep)) throw installedApplicationError('installed_application_path_invalid');
}

async function resolveInstalledApplication(request, options = {}) {
  if ((options.platform || process.platform) !== 'win32') throw installedApplicationError('installed_application_platform_unsupported');
  const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
  if (!request || typeof request !== 'object' || Array.isArray(request) || !identifier(request.packageName)
    || (request.applicationId !== undefined && !identifier(request.applicationId))
    || Object.keys(request).some(key => !['packageName', 'applicationId'].includes(key))) throw installedApplicationError('installed_application_request_invalid');
  const registration = await (options.queryPackage || queryInstalledApplication)(request.packageName);
  if (!registration || typeof registration !== 'object' || registration.name !== request.packageName
    || typeof registration.fullName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(registration.fullName)
    || !registration.fullName.startsWith(request.packageName + '_')
    || typeof registration.installLocation !== 'string' || registration.installLocation.length > 2048
    || !path.isAbsolute(registration.installLocation) || !Array.isArray(registration.applications) || registration.applications.length > 128) throw installedApplicationError('installed_application_registration_invalid');
  const root = path.normalize(registration.installLocation);
  if (root.startsWith('\\\\') || root.includes('\0') || registration.installLocation.split(/[\\/]/).includes('..')) throw installedApplicationError('installed_application_path_invalid');
  const candidates = registration.applications.filter(app => app && app.entryPoint === 'Windows.FullTrustApplication'
    && (request.applicationId === undefined || app.id === request.applicationId));
  if (candidates.length !== 1) throw installedApplicationError(candidates.length ? 'installed_application_ambiguous' : 'installed_application_not_found');
  const application = candidates[0], relative = application.executable;
  if (!identifier(application.id) || typeof relative !== 'string' || relative.length > 1024
    || !/^[A-Za-z0-9_ .\\/-]+\.exe$/i.test(relative) || path.isAbsolute(relative)
    || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' '))) throw installedApplicationError('installed_application_path_invalid');
  const executable = path.resolve(root, relative);
  if (!executable.toLowerCase().startsWith(root.toLowerCase().replace(/[\\/]$/, '') + path.sep)) throw installedApplicationError('installed_application_path_invalid');
  try { await inspectInstalledExecutable(root, executable); }
  catch (error) { if (error.code?.startsWith('installed_application_')) throw error; throw installedApplicationError('installed_application_path_unavailable'); }
  return { source: 'installed-package', packageName: registration.name, packageFullName: registration.fullName,
    applicationId: application.id, executable, title: registration.name };
}

module.exports.resolveInstalledApplication = resolveInstalledApplication;
if (require.main === module) {
  createWindowsChildSessionManager({ enabled: process.argv.includes('--enabled') }).describe()
    .then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`))
    .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
