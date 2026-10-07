'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { hash } = require('./computer-use-runtime.cjs');
const { fingerprintNativeSource, stageRuntime, verifyRuntime, verifyRelease, verifyPreparedHost } = require('./window-control-runtime.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'window-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'source'), scriptDirectory = path.join(root, 'scripts'), skillDirectory = path.join(root, 'skill');
  for (const directory of [path.join(sourceRoot, 'src'), scriptDirectory, skillDirectory]) fs.mkdirSync(directory, { recursive: true });
  for (const [rel, content] of [['Cargo.toml', '[package]'], ['Cargo.lock', 'lock'], ['THIRD_PARTY_NOTICES.md', 'Fixture third-party license notices'], ['src/main.rs', 'fn main() {}']]) fs.writeFileSync(path.join(sourceRoot, rel), content);
  for (const name of ['window-control-mcp.cjs', 'window-control-policy.cjs', 'window-control-errors.cjs', 'window-control-occupancy.cjs', 'window-task-macros.cjs', 'use-control-settings.cjs', 'window-use-approvals.cjs', 'computer-use-approvals.cjs']) fs.writeFileSync(path.join(scriptDirectory, name), "'use strict';\n");
  const guidance = path.join(skillDirectory, 'selected-window.md');
  fs.writeFileSync(guidance, 'Selected window instructions');
  const executable = path.join(root, 'helper.exe'), provenance = path.join(root, 'build.json'), release = path.join(root, 'release'), destination = path.join(release, 'window-control');
  fs.writeFileSync(executable, 'fixture owned native binary');
  fs.writeFileSync(provenance, JSON.stringify({ schema: 1, sourceSha256: fingerprintNativeSource(sourceRoot), executableSha256: hash(fs.readFileSync(executable)) }));
  const options = { sourceRoot, scriptDirectory, guidance, executable, provenance, destination };
  return { ...options, release, options };
}
test('stage closure includes required owned files and release binds provenance', t => {
  const f = fixture(t), result = stageRuntime(f.options);
  const sha256 = { 'window-control/manifest.json': result.manifestSha256 };
  fs.mkdirSync(path.join(f.release, 'host'));
  for (const module of ['window-control-host.cjs', 'window-control-backend.cjs', 'window-control-policy.cjs', 'window-control-errors.cjs', 'window-control-occupancy.cjs', 'window-control-mcp.cjs', 'window-task-macros.cjs', 'window-control-runtime.cjs', 'computer-use-runtime.cjs', 'computer-use-branding.cjs', 'use-control-settings.cjs', 'window-use-approvals.cjs', 'computer-use-approvals.cjs', 'use-settings-host.cjs', 'sky-control-policy.mjs', 'sky-controlled-service.mjs', 'inject-sky-control-policy.cjs']) {
    const content = `fixture ${module}`;
    fs.writeFileSync(path.join(f.release, 'host', module), content); sha256[`host/${module}`] = hash(content);
  }
  fs.writeFileSync(path.join(f.release, 'build-info.json'), JSON.stringify({ sha256 }));
  assert.equal(verifyRelease(f.release, f.sourceRoot).executable, path.join(f.destination, 'azrael-window-control.exe'));
  assert.equal(fs.readFileSync(path.join(f.destination, 'THIRD_PARTY_NOTICES.md'), 'utf8'), 'Fixture third-party license notices');
  const dependency = path.join(f.release, 'host/window-control-runtime.cjs'), dependencyBytes = fs.readFileSync(dependency);
  fs.unlinkSync(dependency); assert.throws(() => verifyRelease(f.release), /ENOENT/);
  fs.writeFileSync(dependency, 'tampered'); assert.throws(() => verifyRelease(f.release), /host module mismatch/);
  fs.writeFileSync(dependency, dependencyBytes);
  fs.writeFileSync(path.join(f.sourceRoot, 'src/main.rs'), 'changed source');
  assert.throws(() => verifyRelease(f.release, f.sourceRoot), /source provenance mismatch/);
});
test('native source fingerprint excludes target while observing source content', t => {
  const f = fixture(t), before = fingerprintNativeSource(f.sourceRoot);
  fs.mkdirSync(path.join(f.sourceRoot, 'target'));
  fs.writeFileSync(path.join(f.sourceRoot, 'target/irrelevant'), 'cache');
  assert.equal(fingerprintNativeSource(f.sourceRoot), before);
  fs.writeFileSync(path.join(f.sourceRoot, 'Cargo.lock'), 'new lock');
  assert.notEqual(fingerprintNativeSource(f.sourceRoot), before);
  assert.throws(() => stageRuntime(f.options), /build provenance mismatch/);
});
test('prepared host binds declared release, copied bundle and host modules', t => {
  const f = fixture(t), runtime = stageRuntime(f.options), host = path.join(path.dirname(f.release), 'host');
  const sha256 = { 'window-control/manifest.json': runtime.manifestSha256 };
  fs.mkdirSync(path.join(host, 'out'), { recursive: true });
  fs.mkdirSync(path.join(f.release, 'host'));
  for (const module of ['window-control-host.cjs', 'window-control-backend.cjs', 'window-control-policy.cjs', 'window-control-errors.cjs', 'window-control-occupancy.cjs', 'window-control-mcp.cjs', 'window-task-macros.cjs', 'window-control-runtime.cjs', 'computer-use-runtime.cjs', 'computer-use-branding.cjs', 'use-control-settings.cjs', 'window-use-approvals.cjs', 'computer-use-approvals.cjs', 'use-settings-host.cjs', 'sky-control-policy.mjs', 'sky-controlled-service.mjs', 'inject-sky-control-policy.cjs']) {
    const content = fs.readFileSync(path.join(__dirname, module));
    fs.writeFileSync(path.join(host, 'out', module), content); fs.writeFileSync(path.join(f.release, 'host', module), content); sha256[`host/${module}`] = hash(content);
  }
  fs.writeFileSync(path.join(f.release, 'build-info.json'), JSON.stringify({ sha256 }));
  fs.cpSync(f.destination, path.join(host, 'window-control'), { recursive: true });
  const configFile = path.join(host, 'out/azrael-runtime.json'), { manifest, ...windowControl } = runtime;
  fs.writeFileSync(configFile, JSON.stringify({ windowControl }));
  assert.equal(verifyPreparedHost(host, f.release).manifestSha256, runtime.manifestSha256);
  const loadHost = () => spawnSync(process.execPath, ['-e', 'require(process.argv[1])', path.join(host, 'out/window-control-host.cjs')], { encoding: 'utf8' });
  assert.equal(loadHost().status, 0, 'Copied production host dependency closure must load');
  const branding = path.join(host, 'out/computer-use-branding.cjs'), brandingBytes = fs.readFileSync(branding);
  fs.unlinkSync(branding);
  assert.throws(() => verifyPreparedHost(host, f.release), /ENOENT/);
  const missingBranding = loadHost();
  assert.notEqual(missingBranding.status, 0);
  assert.match(missingBranding.stderr, /Cannot find module '\.\/computer-use-branding\.cjs'/);
  fs.writeFileSync(branding, brandingBytes);
  assert.equal(loadHost().status, 0);
  const dependency = path.join(host, 'out/computer-use-runtime.cjs'), dependencyBytes = fs.readFileSync(dependency);
  fs.unlinkSync(dependency);
  assert.throws(() => verifyPreparedHost(host, f.release), /ENOENT/);
  fs.writeFileSync(dependency, 'tampered verifier');
  assert.throws(() => verifyPreparedHost(host, f.release), /host module mismatch/);
  fs.writeFileSync(dependency, dependencyBytes);
  const runtimeDependency = path.join(host, 'out/window-control-runtime.cjs'), runtimeBytes = fs.readFileSync(runtimeDependency);
  fs.unlinkSync(runtimeDependency);
  assert.throws(() => verifyPreparedHost(host, f.release), /ENOENT/);
  fs.writeFileSync(runtimeDependency, runtimeBytes);
  assert.equal(verifyPreparedHost(host, f.release).manifestSha256, runtime.manifestSha256);
  fs.writeFileSync(configFile, JSON.stringify({ windowControl: { ...windowControl, executable: 'external.exe' } }));
  assert.throws(() => verifyPreparedHost(host, f.release), /configuration mismatch/);
  fs.writeFileSync(configFile, JSON.stringify({ windowControl }));
  fs.writeFileSync(path.join(host, 'out/window-control-host.cjs'), 'tampered module');
  assert.throws(() => verifyPreparedHost(host, f.release), /host module mismatch/);
});
test('tampered, missing and unrecorded files fail closed', t => {
  const f = fixture(t); stageRuntime(f.options);
  const file = path.join(f.destination, 'window-control-mcp.cjs'), original = fs.readFileSync(file);
  fs.writeFileSync(file, 'tampered'); assert.throws(() => verifyRuntime(f.destination), /hash mismatch/);
  fs.unlinkSync(file); assert.throws(() => verifyRuntime(f.destination), /ENOENT/);
  fs.writeFileSync(file, original); fs.writeFileSync(path.join(f.destination, 'unrecorded.cjs'), 'extra');
  assert.throws(() => verifyRuntime(f.destination), /Unrecorded/);
});
test('native license notices bind source provenance and required release payload', t => {
  const f = fixture(t), before = fingerprintNativeSource(f.sourceRoot);
  stageRuntime(f.options);
  const notices = path.join(f.destination, 'THIRD_PARTY_NOTICES.md'), original = fs.readFileSync(notices);
  fs.writeFileSync(notices, 'tampered notices');
  assert.throws(() => verifyRuntime(f.destination), /hash mismatch/);
  fs.unlinkSync(notices); assert.throws(() => verifyRuntime(f.destination), /ENOENT/);
  fs.writeFileSync(notices, original);
  const manifestPath = path.join(f.destination, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.files = manifest.files.filter(entry => entry.path !== 'THIRD_PARTY_NOTICES.md');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => verifyRuntime(f.destination), /Required Window Control entry missing: THIRD_PARTY_NOTICES/);
  fs.writeFileSync(path.join(f.sourceRoot, 'THIRD_PARTY_NOTICES.md'), 'changed native notices');
  assert.notEqual(fingerprintNativeSource(f.sourceRoot), before);
  assert.throws(() => stageRuntime({ ...f.options, destination: path.join(f.release, 'refreshed') }), /build provenance mismatch/);
});
test('task macro code is bound in runtime and host payloads', t => {
  const f = fixture(t); stageRuntime(f.options);
  const file = path.join(f.destination, 'window-task-macros.cjs'), bytes = fs.readFileSync(file);
  fs.writeFileSync(file, 'tampered macros');
  assert.throws(() => verifyRuntime(f.destination), /hash mismatch/);
  fs.writeFileSync(file, bytes);
  const target = path.join(f.destination, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(target));
  manifest.files = manifest.files.filter(entry => entry.path !== 'window-task-macros.cjs');
  fs.writeFileSync(target, JSON.stringify(manifest));
  assert.throws(() => verifyRuntime(f.destination), /Required.*window-task-macros/);
});
test('missing required entry, unsafe paths and forged binary provenance rejected', t => {
  const f = fixture(t); stageRuntime(f.options);
  const target = path.join(f.destination, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(target));
  fs.writeFileSync(target, JSON.stringify({ ...manifest, files: manifest.files.slice(1) }));
  assert.throws(() => verifyRuntime(f.destination), /Required/);
  fs.writeFileSync(target, JSON.stringify({ ...manifest, files: [...manifest.files, { path: '../escape', sha256: 'a'.repeat(64), bytes: 0 }] }));
  assert.throws(() => verifyRuntime(f.destination), /Unsafe runtime path/);
  fs.writeFileSync(target, JSON.stringify({ ...manifest, source: { ...manifest.source, executableSha256: 'a'.repeat(64) } }));
  assert.throws(() => verifyRuntime(f.destination), /executable provenance mismatch/);
});
test('rollback release without feature is allowed; undeclared or mismatched runtime rejected', t => {
  const f = fixture(t); fs.mkdirSync(f.release); fs.writeFileSync(path.join(f.release, 'build-info.json'), '{"sha256":{}}');
  assert.equal(verifyRelease(f.release), null);
  stageRuntime(f.options); assert.throws(() => verifyRelease(f.release), /Undeclared/);
  fs.writeFileSync(path.join(f.release, 'build-info.json'), JSON.stringify({ sha256: { 'window-control/manifest.json': 'a'.repeat(64) } }));
  assert.throws(() => verifyRelease(f.release), /manifest hash mismatch/);
});

test('occupancy dependency is required and its runtime hash is verified',t=>{
 const f=fixture(t);stageRuntime(f.options); const file=path.join(f.destination,'window-control-occupancy.cjs');fs.writeFileSync(file,'tampered');assert.throws(()=>verifyRuntime(f.destination),/hash mismatch/);
 const target=path.join(f.destination,'manifest.json'),manifest=JSON.parse(fs.readFileSync(target));manifest.files=manifest.files.filter(e=>e.path!=='window-control-occupancy.cjs');fs.writeFileSync(target,JSON.stringify(manifest));fs.unlinkSync(file);assert.throws(()=>verifyRuntime(f.destination),/Required.*window-control-occupancy/);
});
