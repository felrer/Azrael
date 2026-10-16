'use strict';
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..'), host = resolve(root, 'extensions/azrael-ex');
for (const [cwd, args] of [
  [host, ['scripts/build-incremental.cjs']],
  [host, ['--test', 'dist/test/chatSession.test.js']],
]) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
