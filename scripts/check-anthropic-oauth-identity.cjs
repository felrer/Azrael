'use strict';
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { existsSync, mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const root = resolve(__dirname, '..');
const pinned = join(root, 'artifacts/tools/bun-1.4.2/package/bin/bun.exe');
const bun = process.env.AZRAEL_BUN || (process.platform === 'win32' ? pinned : 'bun');
if (process.platform === 'win32' && !process.env.AZRAEL_BUN && !existsSync(pinned)) throw Error('Pinned Bun is required for Anthropic OAuth identity checks');
const artifacts = require('./artifact-run.cjs');
const run = artifacts.beginArtifactRun(root, { workId: 'provider-profile-scope', runId: `oauth-${randomUUID().replaceAll('-', '')}`, owner: 'scripts/check-anthropic-oauth-identity.cjs' });
const home = join(run.temporary, 'home');
mkdirSync(home, { recursive: true });
const result = spawnSync(bun, ['test', '--no-install', '--timeout', '30000',
  './providers/opencodex/tests/inference.test.ts',
  './providers/opencodex/tests/images.test.ts',
  './providers/opencodex/tests/harness-projection.test.ts',
  './providers/opencodex/tests/profile-account-scope.test.ts'], {
  cwd: root, windowsHide: true, stdio: 'inherit', timeout: 180000,
  env: { ...process.env, CODEX_HOME: home, OPENCODEX_HOME: join(home, 'azrael/providers/opencodex'), TEMP: run.temporary, TMP: run.temporary, TMPDIR: run.temporary },
});
artifacts.finishArtifactRun(run, { exitCode: result.status, producerStopped: !result.error && Number.isInteger(result.status),
  reason: 'Provider identity and captured account scope test runner returned' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
