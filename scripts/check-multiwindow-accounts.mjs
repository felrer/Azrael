import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JsonLinePeer,
  captureStderr,
  stopChild,
  waitForExit,
} from './lib/azrael-rpc-check.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const retainedStateRoot = resolve(projectRoot, 'artifacts', 'verification');
const [engineArgument, bridgeArgument, stateArgument, socketDirectoryArgument] = process.argv.slice(2);

if (
  !engineArgument ||
  !bridgeArgument ||
  !stateArgument ||
  !socketDirectoryArgument ||
  !isAbsolute(stateArgument) ||
  !isAbsolute(socketDirectoryArgument)
) {
  throw new Error(
    'Usage: node scripts/check-multiwindow-accounts.mjs <engine> <bridge> <new absolute state directory below artifacts/verification> <new absolute short socket directory>',
  );
}

const enginePath = resolve(engineArgument);
const bridgePath = resolve(bridgeArgument);
const stateDirectory = resolve(stateArgument);
const socketDirectory = resolve(socketDirectoryArgument);
const authPath = join(stateDirectory, 'auth.json');
const fixtureApiKey = 'sk-multiwindow-local-fixture';
const authFixture = `${JSON.stringify({
  OPENAI_API_KEY: fixtureApiKey,
  tokens: null,
  last_refresh: null,
}, null, 2)}\n`;
const stateRelative = relative(retainedStateRoot, stateDirectory);
if (!stateRelative || stateRelative.startsWith('..') || isAbsolute(stateRelative)) {
  throw new Error(`State directory must be a new child of ${retainedStateRoot}`);
}
if (stateDirectory === socketDirectory) {
  throw new Error('The socket directory must be separate from retained fixture state');
}

const instances = [
  {
    name: 'first',
    socketPath: join(socketDirectory, 'one.sock'),
    selectionPath: join(stateDirectory, 'windows', 'one.json'),
  },
  {
    name: 'second',
    socketPath: join(socketDirectory, 'two.sock'),
    selectionPath: join(stateDirectory, 'windows', 'two.json'),
  },
];
for (const instance of instances) {
  if (process.platform === 'win32' && Buffer.byteLength(instance.socketPath, 'utf8') > 100) {
    throw new Error(`Socket path exceeds the Windows AF_UNIX limit: ${instance.socketPath}`);
  }
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

function fixtureEnvironment(overrides = {}) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      /(?:API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|AUTH_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN|CREDENTIALS)$/i.test(key) ||
      ['AWS_PROFILE', 'AWS_WEB_IDENTITY_TOKEN_FILE'].includes(key)
    ) {
      delete environment[key];
    }
  }
  return { ...environment, ...overrides };
}

async function stopNormally(child, description) {
  child.stdin.end();
  const exit = await waitForExit(child, description);
  if (exit.code !== 0) throw new Error(`${description} exited abnormally: ${JSON.stringify(exit)}`);
}

function socketLockPath(socketPath) {
  const extension = extname(socketPath);
  return join(dirname(socketPath), `${basename(socketPath, extension)}.lock`);
}

async function cleanSocketFixture() {
  for (const instance of instances) {
    for (const path of [instance.socketPath, socketLockPath(instance.socketPath)]) {
      try {
        await unlink(path);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  try {
    await rmdir(socketDirectory);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
  }
}

function assertFixtureIdentity(account, description) {
  if (account?.account?.type !== 'apiKey') {
    throw new Error(`${description} did not load the synthetic API-key account: ${JSON.stringify(account)}`);
  }
}

function assertFixtureAccountList(response, description) {
  if (
    !response?.state ||
    resolve(response.state.codexHome) !== stateDirectory ||
    !Array.isArray(response.state.profiles) ||
    response.state.profiles.length !== 0 ||
    response.state.currentAccount?.type !== 'apiKey' ||
    typeof response.state.instanceId !== 'string' ||
    response.state.instanceId.length === 0
  ) {
    throw new Error(`${description} returned invalid synthetic account state: ${JSON.stringify(response)}`);
  }
}

async function startInstance(instance) {
  instance.engine = spawn(
    enginePath,
    [
      '-c',
      'features.code_mode_host=true',
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
      'app-server',
      '--analytics-default-enabled',
    ],
    {
      cwd: stateDirectory,
      env: fixtureEnvironment({
        CODEX_HOME: stateDirectory,
        AZRAEL_EX_MANAGEMENT_SOCKET: instance.socketPath,
        AZRAEL_EX_ACCOUNT_STATE_FILE: instance.selectionPath,
      }),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  instance.engineStderr = captureStderr(instance.engine, 256_000);
  instance.enginePeer = new JsonLinePeer(instance.engine, `${instance.name} engine`);
  await instance.enginePeer.request('initialize', {
    clientInfo: { name: 'azrael-ex-multiwindow-check', version: '0.1.0' },
    capabilities: { experimentalApi: true },
  });
  instance.enginePeer.notify('initialized');

  instance.bridge = spawn(bridgePath, [instance.socketPath], {
    cwd: stateDirectory,
    env: fixtureEnvironment(),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  instance.bridgeStderr = captureStderr(instance.bridge, 256_000);
  instance.bridgePeer = new JsonLinePeer(instance.bridge, `${instance.name} bridge`);
  const connected = await instance.bridgePeer.notification('azrael/connected');
  if (
    !connected ||
    resolve(connected.codexHome) !== stateDirectory ||
    typeof connected.serverVersion !== 'string' ||
    connected.serverVersion.length === 0
  ) {
    throw new Error(`${instance.name} bridge returned invalid connection state: ${JSON.stringify(connected)}`);
  }
}

async function writeLogs(status, error) {
  for (const instance of instances) {
    await writeFile(
      join(stateDirectory, `${instance.name}-engine.stderr.log`),
      instance.engineStderr?.() ?? '',
    );
    await writeFile(
      join(stateDirectory, `${instance.name}-bridge.stderr.log`),
      instance.bridgeStderr?.() ?? '',
    );
  }
  if (error) await writeFile(join(stateDirectory, 'failure.log'), error.stack ?? String(error));
  const result = {
    status,
    engine: enginePath,
    bridge: bridgePath,
    stateRoot: stateDirectory,
    sockets: instances.map(instance => instance.socketPath),
    selectionFiles: instances.map(instance => instance.selectionPath),
    startupOrder: 'first engine initialized before second engine started while first remained live',
    checks: status === 'passed' ? [
      'second engine initialized against the same synthetic-auth CODEX_HOME while the first engine remained live',
      'both stdio channels returned the synthetic API-key account/read state',
      'both management bridges returned synthetic-root azrael/account list state',
      'engine instance identities were distinct',
      'first engine and bridge remained available after the second pair stopped',
      'synthetic auth.json remained unchanged',
    ] : [],
    fixtureCredentials: 'synthetic API key in explicit file store',
    realLogin: false,
    modelRequest: false,
    limitations: [
      'Fresh-root database bootstrap was serialized; simultaneous empty-store bootstrap is outside this account-concurrency check.',
    ],
  };
  await writeFile(join(stateDirectory, 'verification.json'), JSON.stringify(result, null, 2));
  return result;
}

let stateCreated = false;
let socketFixtureOwned = false;
let failure;

try {
  await mustNotExist(stateDirectory, 'State directory');
  await mustNotExist(socketDirectory, 'Socket directory');
  await mkdir(stateDirectory, { recursive: true });
  stateCreated = true;
  await writeFile(authPath, authFixture);
  socketFixtureOwned = true;

  await startInstance(instances[0]);
  await startInstance(instances[1]);

  const [firstAccount, secondAccount, firstList, secondList] = await Promise.all([
    instances[0].enginePeer.request('account/read', { refreshToken: false }),
    instances[1].enginePeer.request('account/read', { refreshToken: false }),
    instances[0].bridgePeer.request('azrael/account', { action: 'list' }),
    instances[1].bridgePeer.request('azrael/account', { action: 'list' }),
  ]);
  assertFixtureIdentity(firstAccount, 'first engine');
  assertFixtureIdentity(secondAccount, 'second engine');
  assertFixtureAccountList(firstList, 'first bridge');
  assertFixtureAccountList(secondList, 'second bridge');
  if (firstList.state.instanceId === secondList.state.instanceId) {
    throw new Error('The two engines reported the same instance identity');
  }

  await stopNormally(instances[1].bridge, 'second bridge');
  await stopNormally(instances[1].engine, 'second engine');
  if (instances[0].engine.exitCode !== null || instances[0].engine.signalCode !== null) {
    throw new Error('First engine exited when the second engine stopped');
  }
  const [survivingAccount, survivingList] = await Promise.all([
    instances[0].enginePeer.request('account/read', { refreshToken: false }),
    instances[0].bridgePeer.request('azrael/account', { action: 'list' }),
  ]);
  assertFixtureIdentity(survivingAccount, 'surviving first engine');
  assertFixtureAccountList(survivingList, 'surviving first bridge');
  if (await readFile(authPath, 'utf8') !== authFixture) {
    throw new Error('Synthetic auth.json changed during the read-only multi-window check');
  }

  await stopNormally(instances[0].bridge, 'first bridge');
  await stopNormally(instances[0].engine, 'first engine');
  await cleanSocketFixture();
  socketFixtureOwned = false;

  const result = await writeLogs('passed');
  console.log(JSON.stringify(result));
} catch (error) {
  failure = error;
  for (const instance of [...instances].reverse()) {
    await stopChild(instance.bridge, `${instance.name} bridge cleanup`, 5_000);
    await stopChild(instance.engine, `${instance.name} engine cleanup`, 5_000);
  }
  if (socketFixtureOwned) {
    try {
      await cleanSocketFixture();
    } catch (cleanupError) {
      failure = new AggregateError([failure, cleanupError], 'Check and socket cleanup failed');
    }
  }
  if (stateCreated) await writeLogs('failed', failure);
  console.error(failure.stack ?? String(failure));
  process.exitCode = 1;
} finally {
  for (const instance of instances) {
    instance.bridgePeer?.close();
    instance.enginePeer?.close();
  }
}
