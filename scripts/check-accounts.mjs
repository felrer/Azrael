import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  access,
  mkdir,
  readFile,
  readdir,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { OpenAiAutoSwitchFixture, runOpenAiAutoSwitch } from './openai-auto-switch-fixture.mjs';
import { runAccountControls } from './account-controls-fixture.mjs';
import { accountFixtureEnvironment } from './account-fixture-environment.mjs';

const WAIT_MS = 30_000;
const arguments_ = process.argv.slice(2);
const autoSwitchOnly = arguments_.includes('--auto-switch-only');
const accountControlsOnly = arguments_.includes('--account-controls-only');
if (autoSwitchOnly && accountControlsOnly) {
  throw new Error('--auto-switch-only and --account-controls-only are mutually exclusive');
}
const pathArguments = arguments_.filter(argument => !['--auto-switch-only', '--account-controls-only'].includes(argument));
const [engineArgument, bridgeArgument, stateArgument, socketArgument] = pathArguments;
if (pathArguments.length !== 4) {
  throw new Error('Expected exactly four paths and optional --auto-switch-only or --account-controls-only');
}
if (
  !engineArgument ||
  !bridgeArgument ||
  !stateArgument ||
  !socketArgument ||
  !isAbsolute(stateArgument) ||
  !isAbsolute(socketArgument)
) {
  throw new Error(
    'Usage: node scripts/check-accounts.mjs <engine> <bridge> <new absolute state directory> <new absolute short socket path> [--auto-switch-only | --account-controls-only]',
  );
}

const enginePath = resolve(engineArgument);
const standaloneAppServer = /^codex-app-server(?:-[a-z0-9-]+)?(?:\.exe)?$/i.test(basename(enginePath));
const bridgePath = resolve(bridgeArgument);
const stateDirectory = resolve(stateArgument);
const socketPath = resolve(socketArgument);
const socketDirectory = dirname(socketPath);
const socketExtension = extname(socketPath);
const socketLockPath = join(socketDirectory, `${basename(socketPath, socketExtension)}.lock`);
const authPath = join(stateDirectory, 'auth.json');
const selectedStatePath = join(stateDirectory, 'azrael', 'account-state.json');
const profileRoot = join(stateDirectory, 'azrael', 'accounts');
const fixtureModel = 'azrael-accounts-fixture';
const probeReasoningEffort = 'high';
const bundledModelsPath = fileURLToPath(
  new URL('../upstream/codex/codex-rs/models-manager/models.json', import.meta.url),
);
const fixtureModelsPath = join(stateDirectory, 'models-fixture.json');

if (socketDirectory === stateDirectory) {
  throw new Error('The socket must use its own new parent directory');
}
if (process.platform === 'win32' && Buffer.byteLength(socketPath, 'utf8') > 100) {
  throw new Error('The socket path is too long for the Windows AF_UNIX check');
}

async function mustNotExist(path, description) {
  try {
    await access(path);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`${description} already exists: ${path}`);
}

function delay(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

function withTimeout(promise, description, milliseconds = WAIT_MS) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`${description} timed out`)), milliseconds);
    promise.then(
      value => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function waitForExit(child, description, milliseconds = WAIT_MS) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return withTimeout(
    new Promise((resolvePromise, reject) => {
      child.once('exit', (code, signal) => resolvePromise({ code, signal }));
      child.once('error', reject);
    }),
    `${description} exit`,
    milliseconds,
  );
}

class RpcError extends Error {
  constructor(method, error) {
    const message = typeof error?.message === 'string' ? `: ${error.message}` : '';
    super(`${method} failed with code ${error?.code}${message}`);
    this.rpc = error;
  }
}

class JsonLinePeer {
  constructor(child, name) {
    this.child = child;
    this.name = name;
    this.nextId = 0;
    this.pending = new Map();
    this.notifications = [];
    this.waiters = [];
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', line => this.#receive(line));
    child.once('error', error => this.#fail(error));
    child.once('exit', (code, signal) => {
      this.#fail(new Error(`${name} exited (code ${code}, signal ${signal})`));
    });
  }

  #receive(line) {
    try {
      const message = JSON.parse(line);
      if (Object.hasOwn(message, 'id')) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new RpcError(pending.method, message.error));
        else pending.resolve(message.result);
        return;
      }
      if (typeof message.method !== 'string') return;
      const index = this.waiters.findIndex(
        waiter => waiter.method === message.method && waiter.predicate(message.params),
      );
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message.params);
      } else {
        this.notifications.push(message);
      }
    } catch (error) {
      this.#fail(new Error(`${this.name} emitted invalid JSON: ${error.message}`));
    }
  }

  #fail(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.length = 0;
  }

  request(method, params) {
    return new Promise((resolvePromise, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name} ${method} timed out`));
      }, WAIT_MS);
      this.pending.set(id, { method, resolve: resolvePromise, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  notification(method, predicate = () => true) {
    const index = this.notifications.findIndex(
      item => item.method === method && predicate(item.params),
    );
    if (index >= 0) return Promise.resolve(this.notifications.splice(index, 1)[0].params);
    return new Promise((resolvePromise, reject) => {
      const waiter = { method, predicate, resolve: resolvePromise, reject };
      waiter.timer = setTimeout(() => {
        const waiterIndex = this.waiters.indexOf(waiter);
        if (waiterIndex >= 0) this.waiters.splice(waiterIndex, 1);
        reject(new Error(`${this.name} ${method} notification timed out`));
      }, WAIT_MS);
      this.waiters.push(waiter);
    });
  }

  discardNotifications(...methods) {
    const discarded = new Set(methods);
    this.notifications = this.notifications.filter(item => !discarded.has(item.method));
  }

  close() {
    this.lines.close();
  }
}

function stderrCapture(child, label, collection) {
  let value = '';
  child.stderr.on('data', chunk => {
    value = (value + chunk).slice(-32_000);
  });
  collection.push(() => `\n--- ${label} stderr ---\n${value}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.end();
  try {
    await waitForExit(child, 'cleanup process', 3_000);
  } catch {
    child.kill();
    try {
      await waitForExit(child, 'killed cleanup process', 3_000);
    } catch {
      // Preserve the first failure after a bounded final cleanup attempt.
    }
  }
}

async function unlinkIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function removeSocketFixture() {
  await unlinkIfPresent(socketPath);
  await unlinkIfPresent(socketLockPath);
  try {
    await rmdir(socketDirectory);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
  }
}

async function waitUntilMissing(path, description) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    await delay(50);
  }
  throw new Error(`${description} remained after engine exit`);
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

let jwtGeneration = 0;
const initialAccessTokens = new Map();
const refreshedAccessTokens = new Map();
function jwt(account) {
  const now = Math.floor(Date.now() / 1000);
  return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
    email: account.email,
    exp: now + 86_400,
    iat: now,
    jti: `synthetic-generation-${++jwtGeneration}`,
    'https://api.openai.com/auth': {
      chatgpt_account_id: account.accountId,
      chatgpt_user_id: account.userId,
      user_id: account.userId,
      chatgpt_plan_type: 'team',
    },
  })}.fixture`;
}

function authFixture(account) {
  const token = jwt(account);
  initialAccessTokens.set(account.accountId, token);
  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: token,
      access_token: token,
      refresh_token: account.refreshToken,
      account_id: account.accountId,
    },
    last_refresh: new Date().toISOString(),
  };
}

const accounts = [
  {
    email: 'fixture-a@example.invalid',
    accountId: 'workspace-fixture-a',
    userId: 'user-fixture-a',
    refreshToken: 'refresh-fixture-a',
  },
  {
    email: 'fixture-b@example.invalid',
    accountId: 'workspace-fixture-b',
    userId: 'user-fixture-b',
    refreshToken: 'refresh-fixture-b',
  },
];

const backendRequests = [];
const autoSwitchFixture = autoSwitchOnly ? new OpenAiAutoSwitchFixture(accounts) : null;
const accountControlsChecks = [];
let consumeRequests = 0;
let modelRequests = 0;
const refreshCounts = new Map();
const usageCounts = new Map();
const original401Counts = new Map();
const freshSuccessCounts = new Map();
let rejectNextUsageWith429;
function startMockBackend() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const accountId = request.headers['chatgpt-account-id'] ?? null;
    backendRequests.push({ method: request.method, path: url.pathname, accountId });
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.method === 'POST' && url.pathname === '/oauth/token') {
      let body = '';
      for await (const chunk of request) body += chunk;
      let refreshToken;
      try {
        refreshToken = JSON.parse(body).refresh_token;
      } catch {
        send(400, { error: 'invalid_request' });
        return;
      }
      const account = accounts.find(item => item.refreshToken === refreshToken);
      if (!account) {
        send(400, { error: 'invalid_grant' });
        return;
      }
      refreshCounts.set(account.accountId, (refreshCounts.get(account.accountId) ?? 0) + 1);
      const token = jwt(account);
      refreshedAccessTokens.set(account.accountId, token);
      send(200, { id_token: token, access_token: token, refresh_token: account.refreshToken });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/oauth/revoke') {
      request.resume();
      send(200, {});
      return;
    }
    if (request.method === 'GET' && url.pathname.endsWith('/wham/accounts/check')) {
      send(200, { accounts: accounts.map(account => ({ id: account.accountId,
        plan_type: 'team', workspace_backend_origin: 'https://account-fixture.invalid',
        account_routing_override: 'NO_CONSTRAINT' })),
        account_ordering: accounts.map(account => account.accountId), default_account_id: accountId });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/backend-api/wham/usage') {
      const account = accounts.find(item => item.accountId === accountId);
      if (!account) {
        send(401, { error: 'unknown synthetic account' });
        return;
      }
      const usageCount = (usageCounts.get(account.accountId) ?? 0) + 1;
      usageCounts.set(account.accountId, usageCount);
      const bearerToken = request.headers.authorization?.startsWith('Bearer ')
        ? request.headers.authorization.slice('Bearer '.length)
        : null;
      if (
        account === accounts[0] &&
        bearerToken === initialAccessTokens.get(account.accountId)
      ) {
        original401Counts.set(
          account.accountId,
          (original401Counts.get(account.accountId) ?? 0) + 1,
        );
        send(401, { error: { message: 'synthetic access token requires refresh' } });
        return;
      }
      if (rejectNextUsageWith429 === account.accountId) {
        rejectNextUsageWith429 = undefined;
        send(429, { error: { message: 'synthetic rate limit' } });
        return;
      }
      if (
        account === accounts[0] &&
        bearerToken === refreshedAccessTokens.get(account.accountId)
      ) {
        freshSuccessCounts.set(
          account.accountId,
          (freshSuccessCounts.get(account.accountId) ?? 0) + 1,
        );
      }
      send(200, {
        plan_type: 'team',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: account === accounts[0] ? 11 : 22,
            limit_window_seconds: 300,
            reset_after_seconds: 60,
            reset_at: 2_000_000_000,
          },
        },
        rate_limit_reset_credits: { available_count: 0 },
        account_id: account.accountId,
        user_id: account.userId,
      });
      return;
    }
    if (url.pathname.endsWith('/rate-limit-reset-credits/consume')) {
      consumeRequests += 1;
      send(500, { error: 'consume forbidden in verification' });
      return;
    }
    if (url.pathname.includes('/responses')) {
      modelRequests += 1;
      if (autoSwitchFixture && request.method === 'POST' && ['/v1/responses', '/backend-api/responses', '/backend-api/codex/responses'].includes(url.pathname)) {
        try {
          await autoSwitchFixture.respond(request, response);
        } catch (error) {
          autoSwitchFixture.error = error;
          send(500, { error: 'Local automatic recovery fixture rejected inference' });
        }
        return;
      }
      send(500, { error: 'model requests forbidden in account fixture' });
      return;
    }
    if (request.method === 'GET' && url.pathname.endsWith('/config/bundle')) {
      send(404, {});
      return;
    }
    if (request.method === 'GET' && url.pathname.endsWith('/settings/user')) {
      send(200, {});
      return;
    }
    send(404, {});
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolvePromise({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

let backend;
let currentPair;
let stateOwned = false;
let socketOwned = false;
const stderrSections = [];
const capturedProfileIds = new Set();
let pairNumber = 0;

async function startPair(label) {
  pairNumber += 1;
  let engine;
  let bridge;
  let stdio;
  let management;
  try {
    const fixtureEnvironment = accountFixtureEnvironment(process.env, {
      stateDirectory, socketPath, baseUrl: backend.baseUrl, autoSwitchOnly,
    });
    engine = spawn(
      enginePath,
      [
        '-c',
        `chatgpt_base_url="${backend.baseUrl}/backend-api"`,
        '-c',
        'cli_auth_credentials_store="file"',
        '-c',
        'features.apps=false',
        '-c',
        'features.plugins=false',
        '-c',
        'features.remote_plugin=false',
        '-c',
        'features.plugin_sharing=false',
        '-c',
        `model="${fixtureModel}"`,
        '-c',
        (accountControlsOnly || (!autoSwitchOnly && standaloneAppServer)) ? 'model_provider="openai"' : 'model_provider="azrael_mock"',
        // Host checks exercise the real bridge without inference; host mode
        // intentionally rejects custom model-provider transport overrides.
        ...((accountControlsOnly || (!autoSwitchOnly && standaloneAppServer)) ? [] : [
          '-c',
          `model_providers.azrael_mock={name="Azrael mock",base_url="${backend.baseUrl}/v1",wire_api="responses",requires_openai_auth=true,supports_websockets=false,request_max_retries=0,stream_max_retries=0}`,
        ]),
        '-c',
        `model_catalog_json="${fixtureModelsPath.replaceAll('\\', '/')}"`,
        ...(standaloneAppServer ? [] : ['app-server', '--analytics-default-enabled']),
      ],
      {
        cwd: stateDirectory,
        env: fixtureEnvironment,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    stderrCapture(engine, `${label} engine`, stderrSections);
    stdio = new JsonLinePeer(engine, `${label} engine`);
    await stdio.request('initialize', {
      clientInfo: { name: 'azrael-ex-accounts-check', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    stdio.notify('initialized');

    if (autoSwitchOnly) {
      return { label, engine, stdio, management: stdio, instanceOrdinal: pairNumber };
    }

    bridge = spawn(bridgePath, [socketPath], {
      cwd: stateDirectory,
      env: process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    stderrCapture(bridge, `${label} bridge`, stderrSections);
    management = new JsonLinePeer(bridge, `${label} bridge`);
    const ready = await management.notification('azrael/connected');
    if (
      !ready ||
      resolve(ready.codexHome) !== stateDirectory ||
      typeof ready.serverVersion !== 'string' ||
      ready.serverVersion.length === 0
    ) {
      throw new Error(`${label} bridge returned invalid ready metadata`);
    }
    return { label, engine, stdio, bridge, management, instanceOrdinal: pairNumber };
  } catch (error) {
    await stopChild(bridge);
    await stopChild(engine);
    management?.close();
    stdio?.close();
    throw error;
  }
}

async function stopPair(pair) {
  if (!pair) return;
  if (pair.bridge) {
  pair.bridge.stdin.end();
  const bridgeExit = await waitForExit(pair.bridge, `${pair.label} bridge`);
  if (bridgeExit.code !== 0) throw new Error(`${pair.label} bridge exited abnormally`);
  }
  pair.engine.stdin.end();
  const engineExit = await waitForExit(pair.engine, `${pair.label} engine`);
  if (engineExit.code !== 0) throw new Error(`${pair.label} engine exited abnormally`);
  await waitUntilMissing(socketPath, `${pair.label} socket`);
  pair.management.close();
  pair.stdio.close();
  if (currentPair === pair) currentPair = undefined;
}

async function azrael(peer, action, profileId, includeDetails = false) {
  const params = { action, includeDetails };
  if (profileId !== undefined) params.profileId = profileId;
  return peer.request('azrael/account', params);
}

async function waitForState(peer, predicate, description) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const response = await azrael(peer, 'list');
    if (predicate(response.state)) return response.state;
    await delay(50);
  }
  throw new Error(`${description} timed out`);
}

function assertIdentityAccount(response, expected) {
  if (
    response?.account?.type !== 'chatgpt' ||
    response.account.email !== expected.email ||
    response.account.planType !== 'team'
  ) {
    throw new Error('Account identity did not match the active synthetic fixture');
  }
}

async function assertAuthStatus(peer) {
  const status = await peer.request('getAuthStatus', {
    includeToken: false,
    refreshToken: false,
  });
  if (status.authMethod !== 'chatgpt' || status.authToken !== null) {
    throw new Error('getAuthStatus did not return token-free ChatGPT status');
  }
}

async function expectRpcError(promise, description, code) {
  let caught;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof RpcError) || (code !== undefined && caught.rpc?.code !== code)) {
    throw new Error(`${description} did not return the expected RPC error`);
  }
}

async function stageAccount(account, label) {
  await writeFile(authPath, JSON.stringify(authFixture(account), null, 2));
  currentPair = await startPair(label);
  await assertAuthStatus(currentPair.stdio);
  assertIdentityAccount(
    await currentPair.management.request('account/read', { refreshToken: false }),
    account,
  );
  currentPair.stdio.discardNotifications('azrael/account/updated', 'account/updated');
  currentPair.management.discardNotifications('azrael/account/updated', 'account/updated');
  const nativeAzraelEvent = currentPair.stdio.notification('azrael/account/updated');
  const nativeAccountEvent = currentPair.stdio.notification('account/updated');
  const bridgeAzraelEvent = autoSwitchOnly ? Promise.resolve() : currentPair.management.notification('azrael/account/updated');
  const bridgeAccountEvent = autoSwitchOnly ? Promise.resolve() : currentPair.management.notification('account/updated');
  await azrael(currentPair.stdio, 'captureCurrent');
  const state = await waitForState(
    currentPair.stdio,
    value =>
      !value.isSwitching &&
      value.activeProfileId &&
      value.profiles.some(profile => profile.workspaceAccountId === account.accountId),
    `${label} capture`,
  );
  await Promise.all([nativeAzraelEvent, nativeAccountEvent, bridgeAzraelEvent, bridgeAccountEvent]);
  const profile = state.profiles.find(item => item.workspaceAccountId === account.accountId);
  capturedProfileIds.add(profile.id);
  await waitUntilMissing(authPath, `${label} root auth`);
  await stopPair(currentPair);
  return { profileId: profile.id, instanceId: state.instanceId };
}

async function discoverProfileIds() {
  try {
    for (const entry of await readdir(profileRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const metadata = JSON.parse(await readFile(join(profileRoot, entry.name, 'profile.json')));
        if (typeof metadata.id === 'string') capturedProfileIds.add(metadata.id);
      } catch {
        // Pending or already removed profiles have no metadata to clean.
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function cleanProfiles() {
  await stopChild(currentPair?.bridge);
  await stopChild(currentPair?.engine);
  currentPair?.management.close();
  currentPair?.stdio.close();
  currentPair = undefined;
  await unlinkIfPresent(authPath);
  await discoverProfileIds();
  if (capturedProfileIds.size === 0) return;
  await mkdir(dirname(selectedStatePath), { recursive: true });
  await writeFile(selectedStatePath, JSON.stringify({ selectedProfileId: null }));
  const cleanupPair = await startPair('credential cleanup');
  try {
    await waitForState(cleanupPair.stdio, state => state.activeProfileId === null, 'cleanup logout');
    for (const profileId of capturedProfileIds) {
      await azrael(cleanupPair.stdio, 'remove', profileId);
    }
    const state = await azrael(cleanupPair.stdio, 'list');
    if (state.state.profiles.length !== 0) throw new Error('Synthetic profiles remain after cleanup');
  } finally {
    await stopPair(cleanupPair);
  }
  capturedProfileIds.clear();
}

let primaryError;
try {
  await mustNotExist(stateDirectory, 'State directory');
  await mustNotExist(socketDirectory, 'Socket parent directory');
  await mustNotExist(socketPath, 'Socket path');
  await mkdir(stateDirectory);
  stateOwned = true;
  socketOwned = true;
  const bundledModels = JSON.parse(await readFile(bundledModelsPath, 'utf8'));
  const fixtureModelInfo = structuredClone(
    bundledModels.models?.find(model => model.tool_mode === null),
  );
  if (!fixtureModelInfo || typeof fixtureModelInfo !== 'object') {
    throw new Error('Bundled model catalog did not contain a fixture model');
  }
  fixtureModelInfo.slug = fixtureModel;
  fixtureModelInfo.display_name = 'Azrael Accounts Fixture';
  fixtureModelInfo.prefer_websockets = false;
  fixtureModelInfo.use_responses_lite = false;
  await writeFile(fixtureModelsPath, JSON.stringify({ models: [fixtureModelInfo] }, null, 2));
  backend = await startMockBackend();

  const first = await stageAccount(accounts[0], 'capture A');
  await mkdir(dirname(selectedStatePath), { recursive: true });
  await writeFile(selectedStatePath, JSON.stringify({ selectedProfileId: null }));
  const second = await stageAccount(accounts[1], 'capture B');

  if (accountControlsOnly) {
    await runAccountControls({ first, second, accounts, startPair, stopPair, azrael,
      waitForState, expectRpcError, stateDirectory, checks: accountControlsChecks,
      setCurrentPair: pair => { currentPair = pair; } });
    if (modelRequests !== 0) throw new Error('Account controls unexpectedly made a model request');
    if (consumeRequests !== 0) throw new Error('Account controls unexpectedly consumed a usage credit');
    await cleanProfiles();
    await removeSocketFixture();
    if (modelRequests !== 0 || consumeRequests !== 0) throw new Error('Account controls cleanup made a forbidden request');
    accountControlsChecks.push('synthetic credential cleanup with zero model and usage credit consumption requests');
    const result = { status: 'passed', route: 'account-controls', engine: enginePath,
      bridge: bridgePath, stateRoot: stateDirectory, profilesTested: 2,
      realLogin: false, liveModelRequest: false, userCredentialRead: false,
      modelRequests, usageCreditConsumeRequests: consumeRequests, checks: accountControlsChecks };
    await writeFile(join(stateDirectory, 'verification.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } else if (autoSwitchOnly) {
    await runOpenAiAutoSwitch({ fixture: autoSwitchFixture, first, second, accounts,
      startPair, stopPair, azrael, waitForState, stateDirectory, selectedStatePath,
      fixtureModel, setCurrentPair: pair => { currentPair = pair; } });
    if (consumeRequests !== 0) throw new Error('Automatic recovery consumed a usage credit');
    await cleanProfiles();
    await removeSocketFixture();
    const result = { status: 'passed', route: 'openai-auto-switch', executionMode: 'disposable ordinary app-server', hostBoundaryVerified: false, engine: enginePath,
      bridge: bridgePath, stateRoot: stateDirectory, realLogin: false, liveModelRequest: false,
      modelRequests, usageCreditConsumeRequests: consumeRequests, checks: autoSwitchFixture.checks,
      requests: autoSwitchFixture.requests };
    await writeFile(join(stateDirectory, 'verification.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } else {
  currentPair = await startPair('account operations');
  const restoredB = await waitForState(
    currentPair.stdio,
    state => !state.isSwitching && state.activeProfileId === second.profileId,
    'restore B',
  );
  if (restoredB.profiles.length !== 2 || restoredB.instanceId === second.instanceId) {
    throw new Error('Reconnect did not restore both profiles into a new server instance');
  }
  const configBefore = await currentPair.stdio.request('config/read', { includeLayers: true });
  if (configBefore.config.model_reasoning_effort === probeReasoningEffort) {
    throw new Error('Fresh account fixture unexpectedly contained the probe reasoning effort');
  }
  const emptyThreads = await currentPair.stdio.request('thread/list', { limit: 10 });
  if (emptyThreads.data.length !== 0) {
    throw new Error('Fresh account fixture unexpectedly had threads');
  }
  const startedThread = await currentPair.stdio.request('thread/start', {
    cwd: stateDirectory,
    ephemeral: false,
    model: fixtureModel,
  });
  const threadId = startedThread.thread?.id;
  if (typeof threadId !== 'string' || threadId.length === 0) {
    throw new Error('Native thread/start did not return a persisted thread id');
  }
  await currentPair.stdio.request('thread/name/set', {
    threadId,
    name: 'Azrael account fixture',
  });
  const startedThreadRead = await currentPair.stdio.request('thread/read', {
    threadId,
    includeTurns: false,
  });
  if (startedThreadRead.thread?.id !== threadId) {
    throw new Error('Native thread/read did not return the newly persisted thread');
  }
  await currentPair.stdio.request('config/value/write', {
    keyPath: 'model_reasoning_effort',
    value: probeReasoningEffort,
    mergeStrategy: 'replace',
  });

  const inactiveUsage = await azrael(currentPair.management, 'usage', first.profileId);
  const activeUsage = await azrael(currentPair.stdio, 'usage', second.profileId);
  // Native admission visibility belongs to the current account/user identity;
  // inactive profile usage retains attribution but reports admission as unknown.
  if (
    inactiveUsage.usageProfileId !== first.profileId ||
    inactiveUsage.usage?.accountId !== accounts[0].accountId ||
    activeUsage.usageProfileId !== second.profileId ||
    activeUsage.usage?.accountId !== accounts[1].accountId ||
    inactiveUsage.usage?.ordinaryUsageAllowed !== null ||
    activeUsage.usage?.ordinaryUsageAllowed !== true
  ) {
    throw new Error(`Per-profile usage was not attributed to the requested synthetic identity: ${JSON.stringify({ inactiveProfileId: inactiveUsage.usageProfileId, inactiveAccountId: inactiveUsage.usage?.accountId, inactiveAllowed: inactiveUsage.usage?.ordinaryUsageAllowed, activeProfileId: activeUsage.usageProfileId, activeAccountId: activeUsage.usage?.accountId, activeAllowed: activeUsage.usage?.ordinaryUsageAllowed })}`);
  }
  if (
    (usageCounts.get(accounts[0].accountId) ?? 0) < 2 ||
    (usageCounts.get(accounts[0].accountId) ?? 0) > 3 ||
    refreshCounts.get(accounts[0].accountId) !== 1 ||
    (original401Counts.get(accounts[0].accountId) ?? 0) < 1 ||
    freshSuccessCounts.get(accounts[0].accountId) !== 1
  ) {
    throw new Error('Inactive usage did not replace the rejected token within the bounded recovery');
  }
  const usageHeaders = backendRequests
    .filter(item => item.method === 'GET' && item.path === '/backend-api/wham/usage')
    .map(item => item.accountId);
  if (
    !usageHeaders.includes(accounts[0].accountId) ||
    !usageHeaders.includes(accounts[1].accountId)
  ) {
    throw new Error('Mock backend did not receive both profile-specific account headers');
  }

  const before429Usage = usageCounts.get(accounts[1].accountId) ?? 0;
  const before429Refresh = refreshCounts.get(accounts[1].accountId) ?? 0;
  rejectNextUsageWith429 = accounts[1].accountId;
  await expectRpcError(
    azrael(currentPair.management, 'usage', second.profileId),
    '429 profile usage',
  );
  if (
    usageCounts.get(accounts[1].accountId) !== before429Usage + 1 ||
    (refreshCounts.get(accounts[1].accountId) ?? 0) !== before429Refresh
  ) {
    throw new Error('429 profile usage was refreshed or retried');
  }

  await expectRpcError(
    azrael(currentPair.stdio, 'switch', '00000000000000000000000000000000'),
    'Wrong profile switch',
  );
  await expectRpcError(
    currentPair.management.request('account/login/start', { type: 'chatgpt' }),
    'Bridge direct authentication',
    -32601,
  );

  currentPair.stdio.discardNotifications('azrael/account/updated', 'account/updated');
  currentPair.management.discardNotifications('azrael/account/updated', 'account/updated');
  const nativeSwitchEvent = currentPair.stdio.notification(
    'azrael/account/updated',
    state => state.activeProfileId === first.profileId,
  );
  const bridgeSwitchEvent = currentPair.management.notification(
    'azrael/account/updated',
    state => state.activeProfileId === first.profileId,
  );
  const nativeAccountEvent = currentPair.stdio.notification('account/updated');
  const bridgeAccountEvent = currentPair.management.notification('account/updated');
  await azrael(currentPair.management, 'switch', first.profileId);
  await waitForState(
    currentPair.management,
    state => !state.isSwitching && state.activeProfileId === first.profileId,
    'switch to A',
  );
  await Promise.all([nativeSwitchEvent, bridgeSwitchEvent, nativeAccountEvent, bridgeAccountEvent]);
  const switchedThread = await currentPair.stdio.request('thread/read', {
    threadId,
    includeTurns: false,
  });
  if (switchedThread.thread?.id !== threadId) {
    throw new Error('Persisted thread changed during the manual account switch');
  }
  await assertAuthStatus(currentPair.stdio);
  assertIdentityAccount(
    await currentPair.management.request('account/read', { refreshToken: false }),
    accounts[0],
  );
  const operationsInstanceId = (await azrael(currentPair.stdio, 'list')).state.instanceId;
  await stopPair(currentPair);

  currentPair = await startPair('reconnect restore');
  const restoredA = await waitForState(
    currentPair.management,
    state => !state.isSwitching && state.activeProfileId === first.profileId,
    'reconnect restore A',
  );
  if (restoredA.instanceId === operationsInstanceId || restoredA.codexHome !== stateDirectory) {
    throw new Error('Reconnect restore did not use a new server generation at the fixed home');
  }
  const restoredConfig = await currentPair.management.request('config/read', {
    includeLayers: true,
  });
  const restoredThreads = await currentPair.stdio.request('thread/list', { limit: 10 });
  const restoredThread = await currentPair.stdio.request('thread/read', {
    threadId,
    includeTurns: false,
  });
  if (
    restoredConfig.config.model_reasoning_effort !== probeReasoningEffort ||
    !Array.isArray(restoredThreads.data) ||
    restoredThread.thread?.id !== threadId
  ) {
    throw new Error(
      `Reconnect did not preserve fixed-home state (reasoning=${restoredConfig.config.model_reasoning_effort}, threadList=${Array.isArray(restoredThreads.data)}, readable=${restoredThread.thread?.id === threadId})`,
    );
  }
  assertIdentityAccount(
    await currentPair.management.request('account/read', { refreshToken: false }),
    accounts[0],
  );
  await stopPair(currentPair);

  currentPair = await startPair('active retirement');
  await azrael(currentPair.stdio, 'remove', first.profileId);
  capturedProfileIds.delete(first.profileId);
  const afterRemoval = await waitForState(
    currentPair.management,
    state => !state.isSwitching && state.activeProfileId === second.profileId &&
      !state.profiles.some(profile => profile.id === first.profileId),
    'active account removal and replacement',
  );
  if (afterRemoval.profiles.length !== 1) throw new Error('Active removal changed unrelated profiles');
  assertIdentityAccount(
    await currentPair.management.request('account/read', { refreshToken: false }),
    accounts[1],
  );
  await stopPair(currentPair);
  currentPair = await startPair('retirement restore');
  await waitForState(
    currentPair.management,
    state => !state.isSwitching && state.activeProfileId === second.profileId &&
      !state.profiles.some(profile => profile.id === first.profileId),
    'replacement persists after restart',
  );
  await stopPair(currentPair);

  if (consumeRequests !== 0) throw new Error('Account usage unexpectedly consumed a credit');
  if (modelRequests !== 0) throw new Error('Account verification unexpectedly made a model request');
  if (/\b(?:https|wss):\/\//i.test(stderrSections.join('\n'))) {
    throw new Error('Account verification attempted an external network endpoint');
  }
  await cleanProfiles();
  await removeSocketFixture();
  const result = {
    status: 'passed',
    engine: enginePath,
    bridge: bridgePath,
    stateRoot: stateDirectory,
    socket: socketPath,
    profilesTested: 2,
    checks: [
      'synthetic managed ChatGPT capture without user credentials',
      'native and bridge account notifications',
      'inactive and active profile usage identity headers',
      'inactive profile bounded 401 recovery with refreshed identity',
      '429 usage refusal without refresh or retry',
      'wrong profile switch rejection',
      'active profile removal, validated replacement and restart persistence',
      'bridge direct authentication rejection',
      'switch and server reconnect restore of fixed-home config and empty persisted thread',
      'persisted native thread survives account switch and server restart',
      'config persistence at fixed home',
      'synthetic secure profile credential cleanup',
      'no automatic usage credit consumption',
    ],
    realLogin: false,
    modelRequest: false,
    userCredentialRead: false,
    usageCreditConsumeRequests: consumeRequests,
    modelRequests,
  };
  await writeFile(join(stateDirectory, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  }
} catch (error) {
  primaryError = error;
  if (stateOwned && backend) {
    try {
      await cleanProfiles();
    } catch (cleanupError) {
      primaryError = new AggregateError(
        [primaryError, cleanupError],
        'Account check and synthetic credential cleanup failed',
      );
    }
  } else {
    await stopChild(currentPair?.bridge);
    await stopChild(currentPair?.engine);
  }
  if (socketOwned) {
    try {
      await removeSocketFixture();
    } catch (cleanupError) {
      primaryError = new AggregateError(
        [primaryError, cleanupError],
        'Account check and socket cleanup failed',
      );
    }
  }
  if (stateOwned) {
    if (accountControlsOnly) {
      await writeFile(join(stateDirectory, 'verification.json'), JSON.stringify({
        status: 'failed', route: 'account-controls', engine: enginePath, bridge: bridgePath,
        stateRoot: stateDirectory, realLogin: false, liveModelRequest: false, userCredentialRead: false,
        modelRequests, usageCreditConsumeRequests: consumeRequests, checks: accountControlsChecks,
      }, null, 2));
    }
    if (autoSwitchFixture) {
      await writeFile(join(stateDirectory, 'auto-switch-requests.json'), JSON.stringify({
        checks: autoSwitchFixture.checks, requests: autoSwitchFixture.requests,
      }, null, 2));
    }
    const failure = [primaryError.stack ?? String(primaryError), ...stderrSections.map(get => get())]
      .join('')
      .replaceAll(/Bearer\s+[^\s]+/gi, 'Bearer <redacted>');
    await writeFile(join(stateDirectory, 'failure.log'), failure);
  }
  console.error(primaryError.stack ?? String(primaryError));
  process.exitCode = 1;
} finally {
  if (backend) {
    await withTimeout(
      new Promise(resolvePromise => backend.server.close(resolvePromise)),
      'mock backend close',
      3_000,
    ).catch(() => {});
  }
}
