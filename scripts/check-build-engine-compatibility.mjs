import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { getDirectoryState } from './directory-state.cjs';
import storage from './verification-result-cache.cjs';
import { runCheck } from './check-shared-engine.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHECK_ID = 'engine.shared-engine.build-compatibility';
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = value => createHash('sha256').update(value).digest('hex');
const executeFile = promisify(execFile);
export const COMPATIBILITY_SOURCES = Object.freeze(['scripts/check-build-engine-compatibility.mjs', 'scripts/check-shared-engine.mjs',
  'scripts/shared-engine-host.cjs', 'scripts/lib/azrael-rpc-check.mjs', 'scripts/directory-state.cjs',
  'scripts/verification-result-cache.cjs', 'scripts/verification-reuse-policy.cjs']);
const BINARIES = ['azrael.exe', 'azrael-bridge.exe', 'azrael-code-mode-host.exe', 'azrael-engine-build.json'];

async function state(root, files) {
  const { path: location, ...content } = await getDirectoryState(root, files);
  return content;
}
async function tool(name, env) {
  for (const directory of (env.PATH || env.Path || '').split(path.delimiter)) {
    if (!directory) continue;
    const executable = path.resolve(directory.replace(/^"|"$/g, ''), name);
    try {
      if (!(await fs.stat(executable)).isFile()) continue;
      const real = await fs.realpath(executable);
      const args = name === 'powershell.exe' ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'] : ['--version'];
      const version = name === 'fsutil.exe' ? undefined : (await executeFile(real, args, { env, windowsHide: true, timeout: 10000, maxBuffer: 65536 })).stdout.trim();
      return { executable: real, content: await state(path.dirname(real), [path.basename(real)]), ...(version === undefined ? {} : { version }) };
    } catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) continue; throw error; }
  }
  return { missing: true };
}
export async function identity(engineDirectory, env = process.env) {
  assert.equal(process.platform, 'win32', 'Build engine compatibility currently verifies Windows only');
  const node = await state(path.dirname(process.execPath), [path.basename(process.execPath)]);
  const powershell = await tool('powershell.exe', env);
  assert(!powershell.missing, 'Windows PowerShell identity required');
  const pwsh = await tool('pwsh.exe', env), git = await tool('git.exe', env), fsutil = await tool('fsutil.exe', env);
  assert(!fsutil.missing, 'Windows filesystem query tool identity required');
  const commandProcessor = env.ComSpec || env.COMSPEC || path.join(env.SystemRoot || 'C:/Windows', 'System32/cmd.exe');
  // The cache's reviewed-reuse helper is present only in implementations that use it.
  // Bind its content or explicit absence; never infer old proof for a new recipe.
  const sources = [];
  for (const source of COMPATIBILITY_SOURCES) {
    try { await fs.access(path.join(ROOT, source)); sources.push(source); }
    catch (error) { if (error.code !== 'ENOENT' || !source.endsWith('/verification-reuse-policy.cjs')) throw error; }
  }
  return { schema: 1, options: { extended: true, codeModeChild: true },
    binaries: await state(engineDirectory, BINARIES), engineDirectory: await fs.realpath(engineDirectory),
    sourceFiles: sources, sources: await state(ROOT, sources), node: { executable: process.execPath, version: process.version, content: node },
    tools: { powershell, pwsh, git, fsutil, commandProcessor: await state(path.dirname(commandProcessor), [path.basename(commandProcessor)]) },
    os: { platform: process.platform, arch: process.arch, release: os.release(), version: os.version(), machine: os.machine() },
    environmentSha256: hash(canonical(env)) };
}

export function validateReport(report, kind) {
  assert.equal(report.status, 'passed'); assert.equal(report.fixtureRemoved, true, 'Probe fixture/process cleanup must finish');
  assert.equal(report.scope, kind === 'full' ? 'native shared-engine prerequisite acceptance' : 'code-mode IPC acceptance only');
  const checks = new Set(report.checks.map(check => check.name));
  assert(checks.has('actual_code_mode_completed_text_and_native_delegate_response_decoded'));
  if (kind === 'full') {
    for (const name of ['actual_code_mode_exec_spawns_nonce_owned_bounded_child_and_matching_daemon_owned_host',
      'last_close_interrupt_restart_and_attach_do_not_infer_explicit_user_turn_clears_manual_marker']) assert(checks.has(name), `Full check missing: ${name}`);
  }
}

export async function runCompatibility({ engineDirectory, outputDirectory, cacheProjectRoot = ROOT, forceFull = false },
  { inspect = identity, probe = runCheck } = {}) {
  for (const directory of [engineDirectory, outputDirectory, cacheProjectRoot]) assert(path.isAbsolute(directory), 'Absolute compatibility paths required');
  assert.equal(typeof forceFull, 'boolean');
  const inside = path.relative(path.join(ROOT, 'artifacts'), outputDirectory);
  assert(inside && !inside.startsWith('..') && !path.isAbsolute(inside), 'Owned results under project artifacts required');
  await fs.mkdir(outputDirectory); // New run evidence only; never replace old results.
  const started = performance.now();
  const before = await inspect(engineDirectory), key = hash(canonical(before));
  const cacheRoot = path.join(cacheProjectRoot, 'artifacts/cache/verification-results/native');
  const handle = await storage.begin({ projectRoot: cacheProjectRoot, cacheRoot, checkId: CHECK_ID, key,
    runDirectory: outputDirectory, logName: 'full-evidence', exactOnly: true, force: forceFull });
  try {
    assert(handle.lease && !handle.blockingLease, `Compatibility evidence unavailable: ${handle.reason}`);
    let full, result, mode;
    if (handle.hit) {
      const evidence = JSON.parse(handle.hit.stdout);
      assert.equal(evidence.schema, 1); assert.equal(evidence.key, key); validateReport(evidence.report, 'full');
      full = { executionStatus: 'reused', key, logPath: handle.hit.logPath, logSha256: handle.hit.logSha256 };
      mode = 'ipc';
    } else mode = 'full';
    result = await probe(path.join(engineDirectory, 'azrael.exe'), path.join(outputDirectory, mode), {
      fixtureRoot: path.join(ROOT, 'artifacts', `bc-${randomBytes(4).toString('hex')}`),
      extended: true, codeModeChild: true, codeModeCompatibilityOnly: mode === 'ipc' });
    validateReport(result, mode);
    assert.equal(canonical(before), canonical(await inspect(engineDirectory)), 'Compatibility inputs or environment changed while checking');
    if (mode === 'full') {
      const logPath = path.join(outputDirectory, 'full-evidence.log'), errorPath = path.join(outputDirectory, 'full-evidence.stderr.log');
      await fs.writeFile(logPath, JSON.stringify({ schema: 1, key, report: result }), { flag: 'wx' });
      await fs.writeFile(errorPath, '', { flag: 'wx' });
      const publication = await handle.publish({ exitCode: 0, signal: null, logPath, errorPath });
      full = { executionStatus: 'executed', key, logPath, publication };
    }
    const report = { schema: 1, status: 'passed', mode, full, fresh: { scope: result.scope, checks: result.checks.map(check => check.name), fixtureRemoved: result.fixtureRemoved },
      durationMs: performance.now() - started, cacheReason: handle.reason, deferred: handle.deferred };
    await fs.writeFile(path.join(outputDirectory, 'result.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    return report;
  } finally { await handle.close(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [engineDirectory, outputDirectory, option, cacheProjectRoot, ...flags] = process.argv.slice(2);
  assert(option === '--cache-project-root' && flags.every(flag => flag === '--full') && flags.length <= 1, 'Usage: check-build-engine-compatibility.mjs <engine directory> <new output directory> --cache-project-root <project root> [--full]');
  console.log(JSON.stringify(await runCompatibility({ engineDirectory, outputDirectory, cacheProjectRoot, forceFull: flags.includes('--full') })));
}
