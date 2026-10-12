'use strict';
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

const project = resolve(__dirname, '..');
const pinned = join(project, 'artifacts/tools/bun-1.4.2/package/bin/bun.exe');
const bun = process.env.AZRAEL_BUN || (process.platform === 'win32' ? pinned : 'bun');
if (process.platform === 'win32' && !process.env.AZRAEL_BUN && !existsSync(pinned)) {
  throw new Error('Pinned Bun is required for provider request budget checks');
}
for (const [executable, args, cwd] of [
  [process.execPath, ['--test', 'providers/devin/tests/context-budget.test.mjs', 'providers/devin/tests/progress.test.mjs'], project],
  [bun, ['test', '--no-install', '--timeout', '60000', 'tests/context-budget.test.ts'], join(project, 'providers/opencodex')],
]) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 180000 });
  if (result.error || result.status !== 0) {
    process.stderr.write((result.stderr || result.stdout || result.error?.message || 'No test output').slice(-6000));
    process.exit(result.status || 1);
  }
}
console.log('Provider input budget: final wire, inference-free estimate, usage correlation and safe progress checks passed.');
