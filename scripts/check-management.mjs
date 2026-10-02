import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import {
  JsonLinePeer,
  RpcError,
  captureStderr,
  stopChild,
  waitForExit,
} from './lib/azrael-rpc-check.mjs';
const [engineArgument, bridgeArgument, stateArgument, socketArgument] = process.argv.slice(2);
if (
  !engineArgument ||
  !bridgeArgument ||
  !stateArgument ||
  !socketArgument ||
  !isAbsolute(stateArgument) ||
  !isAbsolute(socketArgument)
) {
  throw new Error(
    'Usage: node scripts/check-management.mjs <engine> <bridge> <new absolute state directory> <new absolute short socket path>',
  );
}

const enginePath = resolve(engineArgument);
const bridgePath = resolve(bridgeArgument);
const stateDirectory = resolve(stateArgument);
const socketPath = resolve(socketArgument);
const socketDirectory = dirname(socketPath);
const socketExtension = extname(socketPath);
const socketLockPath = join(
  socketDirectory,
  `${basename(socketPath, socketExtension)}.lock`,
);

if (socketDirectory === stateDirectory) {
  throw new Error('The socket must use its own new parent directory');
}
if (process.platform === 'win32' && Buffer.byteLength(socketPath, 'utf8') > 100) {
  throw new Error('The socket path is too long for the Windows AF_UNIX check (maximum 100 UTF-8 bytes)');
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

async function removeSocketFixture() {
  for (const path of [socketPath, socketLockPath]) {
    try {
      await unlink(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
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
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  throw new Error(`${description} remained after the engine exited: ${path}`);
}

let engineChild;
let bridgeChild;
let enginePeer;
let bridgePeer;
let engineStderr = () => '';
let bridgeStderr = () => '';
let stateCreated = false;
let socketFixtureOwned = false;

try {
  await mustNotExist(stateDirectory, 'State directory');
  await mustNotExist(socketDirectory, 'Socket parent directory');
  await mustNotExist(socketPath, 'Socket path');
  await mkdir(stateDirectory);
  stateCreated = true;
  socketFixtureOwned = true;

  engineChild = spawn(
    enginePath,
    ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled'],
    {
      cwd: stateDirectory,
      env: {
        ...process.env,
        CODEX_HOME: stateDirectory,
        AZRAEL_EX_MANAGEMENT_SOCKET: socketPath,
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  engineStderr = captureStderr(engineChild);
  enginePeer = new JsonLinePeer(engineChild, 'engine');

  await enginePeer.request('initialize', {
    clientInfo: { name: 'azrael-ex-management-check', version: '0.1.0' },
    capabilities: { experimentalApi: true },
  });
  enginePeer.notify('initialized');

  bridgeChild = spawn(bridgePath, [socketPath], {
    cwd: stateDirectory,
    env: process.env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  bridgeStderr = captureStderr(bridgeChild);
  bridgePeer = new JsonLinePeer(bridgeChild, 'bridge');
  const ready = await bridgePeer.notification('azrael/connected');
  if (
    !ready ||
    resolve(ready.codexHome) !== stateDirectory ||
    typeof ready.serverVersion !== 'string' ||
    ready.serverVersion.length === 0
  ) {
    throw new Error(`Invalid azrael/connected notification: ${JSON.stringify(ready)}`);
  }

  const [stdioAccount, bridgeAccount] = await Promise.all([
    enginePeer.request('account/read', { refreshToken: false }),
    bridgePeer.request('account/read', { refreshToken: false }),
  ]);
  if (stdioAccount.account !== null || bridgeAccount.account !== null) {
    throw new Error('Fresh state unexpectedly contains an account');
  }

  await enginePeer.request('config/value/write', {
    keyPath: 'model',
    value: 'azrael-management-probe',
    mergeStrategy: 'replace',
  });
  const bridgeConfig = await bridgePeer.request('config/read', { includeLayers: true });
  if (bridgeConfig.config?.model !== 'azrael-management-probe') {
    throw new Error('Bridge did not observe the config value written over stdio');
  }
  const diskConfig = await readFile(join(stateDirectory, 'config.toml'), 'utf8');
  if (!diskConfig.includes('azrael-management-probe')) {
    throw new Error('Native config write did not use the dedicated state directory');
  }

  let deniedError;
  try {
    await bridgePeer.request('account/logout', {});
  } catch (error) {
    deniedError = error;
  }
  if (!(deniedError instanceof RpcError) || deniedError.rpc?.code !== -32601) {
    throw new Error(`Bridge account/logout was not denied with -32601: ${deniedError}`);
  }

  bridgeChild.stdin.end();
  const bridgeExit = await waitForExit(bridgeChild, 'bridge');
  if (bridgeExit.code !== 0) {
    throw new Error(`Bridge exited abnormally: ${JSON.stringify(bridgeExit)}`);
  }
  const survivingAccount = await enginePeer.request('account/read', { refreshToken: false });
  if (survivingAccount.account !== null) {
    throw new Error('Stdio identity changed after closing the bridge');
  }

  engineChild.stdin.end();
  const engineExit = await waitForExit(engineChild, 'engine');
  if (engineExit.code !== 0) {
    throw new Error(`Engine exited abnormally: ${JSON.stringify(engineExit)}`);
  }
  await waitUntilMissing(socketPath, 'Management socket');
  await removeSocketFixture();

  const result = {
    status: 'passed',
    engine: enginePath,
    bridge: bridgePath,
    stateRoot: stateDirectory,
    socket: socketPath,
    checks: [
      'stdio initialize and bridge ready notification',
      'concurrent logged-out identity over stdio and bridge',
      'native config write observed through bridge',
      'bridge account/logout denied with -32601',
      'bridge close preserves stdio',
      'stdio close terminates engine and socket',
    ],
    realLogin: false,
    modelRequest: false,
  };
  await writeFile(join(stateDirectory, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await stopChild(bridgeChild);
  await stopChild(engineChild);
  if (socketFixtureOwned) {
    try {
      await removeSocketFixture();
    } catch (cleanupError) {
      error = new AggregateError([error, cleanupError], 'Check and socket cleanup failed');
    }
  }
  if (stateCreated) {
    const failure = [
      error.stack ?? String(error),
      '\n--- engine stderr ---\n',
      engineStderr(),
      '\n--- bridge stderr ---\n',
      bridgeStderr(),
    ].join('');
    await writeFile(join(stateDirectory, 'failure.log'), failure);
  }
  console.error(error.stack ?? String(error));
  process.exitCode = 1;
} finally {
  bridgePeer?.close();
  enginePeer?.close();
}
