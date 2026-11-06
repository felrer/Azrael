import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runCompatibility, validateReport, COMPATIBILITY_SOURCES } from './check-build-engine-compatibility.mjs';
import { scriptOwners } from './test-project.cjs';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const parent = process.env.AZRAEL_COMPATIBILITY_TEST_ROOT || path.resolve(import.meta.dirname, '../artifacts/verification');
const smoke = 'actual_code_mode_completed_text_and_native_delegate_response_decoded';
const fullOnly = ['actual_code_mode_exec_spawns_nonce_owned_bounded_child_and_matching_daemon_owned_host',
  'last_close_interrupt_restart_and_attach_do_not_infer_explicit_user_turn_clears_manual_marker'];
function report(full) { return { status: 'passed', fixtureRemoved: true, scope: full ? 'native shared-engine prerequisite acceptance' : 'code-mode IPC acceptance only',
  checks: [smoke, ...(full ? fullOnly : [])].map(name => ({ name })) }; }
async function fixture(t) {
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'compatibility-'));
  t.after(() => fs.rm(root, { recursive: true }));
  let revision = 1, sequence = 0;
  const calls = [];
  const dependencies = { inspect: async () => ({ revision }), probe: async (_engine, _output, options) => {
    assert.equal(path.dirname(options.fixtureRoot), path.resolve(import.meta.dirname, '../artifacts'));
    assert.match(path.basename(options.fixtureRoot), /^bc-[a-f0-9]{8}$/);
    assert(Buffer.byteLength(path.join(options.fixtureRoot, 'h', 'ipc', `${'x'.repeat(20)}.sock`)) < 108);
    calls.push(options.codeModeCompatibilityOnly ? 'ipc' : 'full'); return report(!options.codeModeCompatibilityOnly);
  } };
  const config = { engineDirectory: path.join(root, 'engine'), cacheProjectRoot: root };
  return { root, calls, dependencies, change: () => revision++, run: extra => runCompatibility({ ...config,
    outputDirectory: path.join(root, `run-${++sequence}`), ...extra }, dependencies) };
}

test('exact full proof permits only fresh IPC; changed inputs and explicit force retain full checks', async t => {
  const f = await fixture(t);
  const first = await f.run(); assert.equal(first.mode, 'full'); assert.equal(first.full.publication.published, true);
  const warm = await f.run(); assert.equal(warm.mode, 'ipc'); assert.equal(warm.full.executionStatus, 'reused');
  assert.deepEqual(warm.fresh.checks, [smoke]);
  f.change(); assert.equal((await f.run()).mode, 'full');
  assert.equal((await f.run({ forceFull: true })).mode, 'full');
  assert.deepEqual(f.calls, ['full', 'ipc', 'full', 'full']);
});

test('failure, incomplete cleanup and input drift cannot publish full success', async t => {
  const f = await fixture(t);
  const good = f.dependencies.probe;
  f.dependencies.probe = async () => { throw Error('actual probe failed'); };
  await assert.rejects(f.run(), /actual probe failed/);
  f.dependencies.probe = async () => ({ ...report(true), fixtureRemoved: false });
  await assert.rejects(f.run(), /cleanup/);
  f.dependencies.probe = async (...args) => { f.change(); return good(...args); };
  await assert.rejects(f.run(), /changed while checking/);
  f.dependencies.probe = good;
  assert.equal((await f.run()).mode, 'full');
});

test('IPC results cannot masquerade as the full regression', () => {
  validateReport(report(false), 'ipc');
  assert.throws(() => validateReport(report(false), 'full'));
  assert.throws(() => validateReport({ ...report(true), checks: [{ name: smoke }] }, 'full'), /Full check missing/);
});

test('every local probe and evidence helper dependency remains bound in the identity', () => {
  const owners = new Map();
  scriptOwners(COMPATIBILITY_SOURCES, path.resolve(import.meta.dirname, '..'), owners);
  assert.deepEqual([...owners.keys()].filter(file => !COMPATIBILITY_SOURCES.includes(file)), []);
});

test('actual build and deploy recipes forward full checks for rebuilt bundles and explicit full verification', { skip: process.platform !== 'win32' }, async t => {
  const build = path.resolve(import.meta.dirname, 'build-azrael.ps1').replaceAll("'", "''");
  const deploy = path.resolve(import.meta.dirname, 'deploy-azrael.ps1').replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile('${build}',[ref]$tokens,[ref]$errors);if($errors){throw $errors}
  $call=$ast.Find({param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Invoke-BuildCommand' -and $n.Extent.Text -like "*'code-mode-host-compatibility.log'"},$true)
  if(-not $call){throw 'Compatibility recipe missing'}
  function Invoke-BuildCommand($Executable,$CommandArguments,$LogName){ [pscustomobject]@{arguments=@($CommandArguments)} }
  $PSScriptRoot='selected-scripts';$EngineDirectory='selected-engine';$logDirectory='selected-logs';$moduleCache=@{Owner='selected-cache'}
  foreach($case in @(@($true,$false),@($true,$true),@($false,$false))){$SkipEngineBuild=$case[0];$ForceEngineCompatibility=$case[1];$argsActual=(Invoke-Expression ($call.Extent.Text.Replace('$PSScriptRoot', "'selected-scripts'"))).arguments;$expectedFull=$ForceEngineCompatibility -or -not $SkipEngineBuild;if(($argsActual -contains '--full') -ne $expectedFull){throw 'Full request lost'};if($argsActual[1] -ne $EngineDirectory -or $argsActual[-1 - [int]$expectedFull] -ne $moduleCache.Owner){throw 'Selected engine or cache owner lost'}}
  $ast=[Management.Automation.Language.Parser]::ParseFile('${deploy}',[ref]$tokens,[ref]$errors);if($errors){throw $errors}
  $forward=$ast.Find({param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Extent.Text -like "*buildArgs += '-ForceEngineCompatibility'*"},$true)
  if(-not $forward){throw 'Deployment forwarding missing'}
  foreach($case in @(@($false,$false),@($true,$false),@($false,$true))){$FullRegression=$case[0];$ForceNativeVerification=$case[1];$buildArgs=@();Invoke-Expression $forward.Extent.Text;if(($buildArgs -contains '-ForceEngineCompatibility') -ne ($FullRegression -or $ForceNativeVerification)){throw 'Deployment full request lost'}}`;
  const f = await fixture(t), filename = path.join(f.root, 'recipes.ps1');
  await fs.writeFile(filename, script);
  const result = await promisify(execFile)('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', filename], { windowsHide: true });
  assert.equal(result.stderr, '');
});
