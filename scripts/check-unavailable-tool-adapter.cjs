'use strict';
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const root = resolve(__dirname, '..');
const pinned = join(root, 'artifacts/tools/bun-1.4.2/package/bin/bun.exe');
const bun = process.env.AZRAEL_BUN || (process.platform === 'win32' ? pinned : 'bun');
if (process.platform === 'win32' && !process.env.AZRAEL_BUN && !existsSync(pinned)) throw Error('Pinned Bun is required for unavailable-tool checks');
const result = spawnSync(bun, ['test', '--no-install', '--timeout', '30000',
  './providers/opencodex/tests/tool-diagnostics-inference.test.ts',
  './providers/opencodex/tests/tool-name-replay.test.ts',
  './providers/opencodex/tests/harness-projection.test.ts'], {
  cwd: root, windowsHide: true, stdio: 'inherit', timeout: 180000,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
