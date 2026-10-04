'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hash } = require('./computer-use-runtime.cjs');
const { fingerprintNativeSource, stageRuntime, verifyRuntime, verifyRelease, verifyPreparedHost } = require('./window-control-runtime.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'window-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'source'), scriptDirectory = path.join(root, 'scripts'), skillDirectory = path.join(root, 'skill');
  for (const directory of [path.join(sourceRoot, 'src'), scriptDirectory, skillDirectory]) fs.mkdirSync(directory, { recursive: true });
  for (const [rel, content] of [['Cargo.toml', '[package]'], ['Cargo.lock', 'lock'], ['src/main.rs', 'fn main() {}']]) fs.writeFileSync(path.join(sourceRoot, rel), content);
  for (const name of ['window-control-mcp.cjs', 'window-control-policy.cjs']) fs.writeFileSync(path.join(scriptDirectory, name), "'use strict';\n");
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
  fs.writeFileSync(path.join(f.release, 'build-info.json'), JSON.stringify({ sha256: { 'window-control/manifest.json': result.manifestSha256 } }));
  assert.equal(verifyRelease(f.release, f.sourceRoot).executable, path.join(f.destination, 'azrael-window-control.exe'));
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
  for (const module of ['window-control-host.cjs', 'window-control-backend.cjs', 'window-control-policy.cjs', 'window-control-mcp.cjs', 'window-control-runtime.cjs', 'computer-use-runtime.cjs']) {
    const content = `fixture ${module}`;
    fs.writeFileSync(path.join(host, 'out', module), content); sha256[`host/${module}`] = hash(content);
  }
  fs.writeFileSync(path.join(f.release, 'build-info.json'), JSON.stringify({ sha256 }));
  fs.cpSync(f.destination, path.join(host, 'window-control'), { recursive: true });
  const configFile = path.join(host, 'out/azrael-runtime.json'), { manifest, ...windowControl } = runtime;
  fs.writeFileSync(configFile, JSON.stringify({ windowControl }));
  assert.equal(verifyPreparedHost(host, f.release).manifestSha256, runtime.manifestSha256);
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
