"use strict";
// Exercise the actual writer initialization against isolated lifecycle registries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const ts = require('../extensions/azrael-ex/node_modules/typescript');
const lifecycle = require('./artifact-run.cjs');
const names = 'account-overview astra-speed btw capacity-retry compaction-skip context-compaction custom-api deferred-turn design-photos error-presentation file-summary missing-image parent-request-activity provider-context question-withdrawal session-flags submit-only-thread task-work-time team-ui use-settings webview-idle window-approval window-errors window-native-approval work-completion work-segment-folding'.split(' ');
const files = [...names.map(name => `verify-${name}-render.mjs`), ...['scroll-timeline-crash', 'task-work-time', 'webview-idle'].map(name => `verify-${name}-host.cjs`)];
const output = process.argv.find(value => value.startsWith('--output-root='))?.slice(14);
assert.ok(output, 'Supply an explicitly owned --output-root under project artifacts');
const project = path.resolve(__dirname, '..');
const destination = path.resolve(output);
const relative = path.relative(path.join(project, 'artifacts'), destination);
assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
assert.ok(!fs.existsSync(destination), 'Ownership regression requires a fresh destination');
fs.mkdirSync(destination, { recursive: true });

function initialize(file, testRoot, env = {}) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = ast.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]);
  const declaration = name => {
    const value = declarations.find(node => node.name.getText(ast) === name);
    assert.ok(value, `${file}: ${name} declaration`);
    return value.getText(ast);
  };
  assert.ok(!/Remove-Item|\brm\(fixture/.test(source), `${file}: raw fixture retained for review`);
  assert.ok(source.includes('artifactRun.producerStopped=false') || source.includes('artifactRun.producerStopped=summary.browserExit.confirmed'), `${file}: uncertain producers remain protected`);
  assert.ok(source.includes('lifecycleId:artifactRun.lifecycleId') || source.includes('summary.lifecycleId=artifactRun.lifecycleId') || source.includes('result.lifecycleId=artifactRun.lifecycleId'), `${file}: discoverable lifecycle identity`);
  const context = { root: testRoot, process: { env }, resolve: path.resolve, beginArtifactRun: lifecycle.beginArtifactRun, trackArtifactChild: lifecycle.trackArtifactChild, nativeSpawn: spawn };
  return vm.runInNewContext(`const ${declaration('artifactRun')}; const ${declaration('spawn')}; ({run:artifactRun,spawn})`, context);
}

async function main() {
  const cases = [];
  for (const file of files) {
    const testRoot = path.join(destination, file);
    fs.mkdirSync(testRoot);
    const first = initialize(file, testRoot), second = initialize(file, testRoot);
    assert.notEqual(first.run.runRoot, second.run.runRoot, `${file}: repeated invocation uses a new identity`);
    for (const run of [first.run, second.run]) {
      const pending = require('./artifact-lifecycle.cjs').catalog(testRoot).find(record => record.id === run.lifecycleId);
      assert.equal(pending.state, 'pending');
      assert.equal(pending.membership_complete, false);
      lifecycle.finishArtifactRun(run, { exitCode: 0, producerStopped: true });
      assert.equal(run.record.state, 'complete');
    }
    cases.push({ file, repeatedPathsDistinct: true });
  }
  for (const [file, variable, role, suffix] of [
    ['verify-context-compaction-render.mjs', 'AZRAEL_RENDER_EVIDENCE_ROOT', 'outputs', ''],
    ['verify-deferred-turn-render.mjs', 'AZRAEL_DEFERRED_RENDER_LOG_DIR', 'logs', ''],
    ['verify-error-presentation-render.mjs', 'AZRAEL_RENDER_RUN_ROOT', 'temporary', 'temporary/error-render'],
  ]) {
    const testRoot = path.join(destination, variable);
    fs.mkdirSync(testRoot);
    const explicit = path.join(testRoot, 'artifacts/explicit');
    const writer = initialize(file, testRoot, { [variable]: explicit });
    assert.equal(writer.run[role], path.join(explicit, suffix), `${file}: preserve ${variable}`);
    if (variable === 'AZRAEL_RENDER_RUN_ROOT') assert.equal(writer.run.logs, path.join(explicit, 'reports/error-render'));
    lifecycle.finishArtifactRun(writer.run, { exitCode: 0, producerStopped: true });
    cases.push({ file, explicitVariablePreserved: variable });
  }
  const file = 'verify-webview-idle-render.mjs', testRoot = path.join(destination, 'child-and-overrides');
  fs.mkdirSync(testRoot);
  const env = { AZRAEL_RENDER_FIXTURE_ROOT: path.join(testRoot, 'artifacts/explicit/fixture'), AZRAEL_RENDER_LOG_ROOT: path.join(testRoot, 'artifacts/explicit/logs') };
  const writer = initialize(file, testRoot, env);
  fs.writeFileSync(path.join(writer.run.temporary, 'sentinel'), 'preserve');
  assert.throws(() => initialize(file, testRoot, env), /already exists|already claimed/);
  assert.equal(fs.readFileSync(path.join(writer.run.temporary, 'sentinel'), 'utf8'), 'preserve');
  const child = writer.spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(7),100)'], { stdio: 'ignore', windowsHide: true });
  assert.ok(writer.run.children.has(child), 'Actual writer wrapper tracks its spawned child');
  lifecycle.finishArtifactRun(writer.run, { exitCode: 0, producerStopped: true });
  assert.equal(writer.run.record.state, 'pending', 'A live child prevents a successful terminal claim');
  await new Promise(resolve => child.once('close', resolve));
  lifecycle.finishArtifactRun(writer.run, { exitCode: 7, producerStopped: true });
  assert.equal(writer.run.record.state, 'failed');
  const producer = JSON.parse(fs.readFileSync(path.join(writer.run.reports, 'producer.json'), 'utf8'));
  assert.equal(producer.exitCode, 7);
  assert.equal(producer.producerStopped, true);
  assert.equal(producer.membership_complete, true);
  assert.equal(writer.run.record.producer.outcome, 'failure');
  assert.equal(producer.lifecycleId, writer.run.lifecycleId);
  assert.throws(() => initialize(file, testRoot, { AZRAEL_RENDER_FIXTURE_ROOT: path.join(testRoot, 'outside') }), /outside generated output scope/);
  console.log(JSON.stringify({ passed: true, writerCount: files.length, cases, checks: ['unique repeated paths', 'pending before output use', 'explicit path collision preserves evidence', 'actual writer child tracking', 'unclosed child remains pending', 'failed exit remains failed', 'outside override rejected'], outputRoot: destination }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
