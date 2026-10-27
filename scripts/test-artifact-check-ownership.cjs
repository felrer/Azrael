"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtureParent = process.argv[2];
if (!fixtureParent || !path.isAbsolute(fixtureParent)) throw Error('An absolute, pre-owned temporary fixture directory is required');
const fixture = path.join(fixtureParent, `check-ownership-${require('node:crypto').randomUUID()}`);
fs.mkdirSync(fixture, { recursive: true });
const passed = [];
// Reuse the existing mock transport while running the actual changed CLI in a
// contained fake project. The mock confirms close on both success and failure.
const scriptRoot = path.join(fixture, 'scripts');
fs.mkdirSync(path.join(scriptRoot, 'lib'), {recursive:true});
for(const source of ['check-management.mjs','artifact-run.cjs','artifact-lifecycle.cjs','maintenance-lock-owner.cjs','maintenance-lock-worker.cjs','maintenance-owner-config.cjs','lib/azrael-rpc-check.mjs']) {
  fs.copyFileSync(path.join(__dirname,source),path.join(scriptRoot,source));
}
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
for(const scenario of ['empty','nonempty']) {
  const directory = path.join(fixture,scenario);
  fs.mkdirSync(directory);
  const state = path.join(directory,'state');
  const execution = spawnSync(process.execPath,['--import',pathToFileURL(path.join(__dirname,'test-check-management.mjs')).href,path.join(scriptRoot,'check-management.mjs'),path.join(directory,'fake-engine'),path.join(directory,'fake-bridge'),state,path.join(require('node:os').tmpdir(),`azm-${require('node:crypto').randomUUID().slice(0,8)}`,'m.sock')], {
    encoding:'utf8',windowsHide:true,timeout:15000,
    env:{...process.env,AZRAEL_MANAGEMENT_SMOKE_FIXTURE:scenario,AZRAEL_MANAGEMENT_SMOKE_TRACE:path.join(directory,'transport.jsonl')},
  });
  fs.writeFileSync(path.join(directory,'stdout.log'),execution.stdout??'');
  fs.writeFileSync(path.join(directory,'stderr.log'),execution.stderr??'');
  assert.ifError(execution.error);
  assert.equal(execution.status,scenario==='empty'?0:1,execution.stderr);
  if(scenario==='empty') {
    const result=JSON.parse(execution.stdout.trim());
    assert.equal(result.status,'passed');
    assert.equal(fs.existsSync(path.join(state,'verification.json')),false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(result.runRoot,'reports/verification.json'))).status,'passed');
    assert.equal(JSON.parse(fs.readFileSync(path.join(result.runRoot,'reports/producer.json'))).state,'complete');
  } else assert.match(execution.stderr,/Fresh state unexpectedly contains threads/);
}
passed.push('actual-management-success-failure-with-confirmed-close');
const independent = fs.readFileSync(path.join(__dirname,'check-independent-vscode.ps1'),'utf8');
const independentGuard = independent.match(/& node -e '([^']+)'/)[1];
const collaboration = fs.readFileSync(path.join(__dirname,'check-collaboration-contract.ps1'),'utf8');
const collaborationGuard = collaboration.match(/& node -e '([^']+)'/)[1];
new Function(independentGuard);
new Function(collaborationGuard);
const lifecycle = require('./artifact-lifecycle.cjs');
const parentFixture = path.join(fixture,'artifacts/parent-fixture');
const parent = lifecycle.recordLifecycle(fixture,{id:'run:parent',kind:'run',owner:'parent-test',state:'pending',membership_complete:false,members:[{role:'fixture',path:parentFixture}]});
const guard = (code,args) => spawnSync(process.execPath,['-e',code,path.join(__dirname,'artifact-lifecycle.cjs'),fixture,...args],{encoding:'utf8',windowsHide:true});
const parentGuard = guard(independentGuard,[parentFixture,parent.id,path.join(fixture,'artifacts/new-independent-run')]);
assert.equal(parentGuard.status,0,parentGuard.stderr);
assert.equal(JSON.parse(parentGuard.stdout).id,parent.id);
assert.equal(lifecycle.catalog(fixture).find(record=>record.id===parent.id).revision,parent.revision);
assert.notEqual(guard(independentGuard,[path.join(fixture,'artifacts/unowned-fixture'),parent.id,path.join(fixture,'artifacts/new-independent-run')]).status,0);
assert.notEqual(guard(collaborationGuard,[path.join(fixture,'artifacts/new-collaboration-run'),parentFixture,path.join(fixture,'artifacts/new-logs')]).status,0);
passed.push('powershell-embedded-parent-and-collision-guards');
console.log(JSON.stringify({passed,fixture,retained:'parent review after integration'}));
