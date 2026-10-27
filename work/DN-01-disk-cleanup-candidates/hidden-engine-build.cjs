'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'artifacts/verification/dn01-hidden-native-input/engine');
const target = path.join(root, 'engine/codex-rs/target');
const host = path.join(root, 'artifacts/build/b13/artifacts/releases/w11aa/engine/azrael-code-mode-host.exe');
const python = 'C:/Users/felre/AppData/Local/Programs/Python/Python312/python.exe';
const expected = '637c0d57a76c6416324ae1683dc39abaccf79365a868527130fc3dc1bc1e9f24';
const { beginArtifactRun, finishArtifactRun } = require(path.join(root, 'scripts/artifact-run.cjs'));
const run = beginArtifactRun(root, { workId: 'DN-01-hidden-engine-build', owner: 'DN-01-hidden-maintenance', references: [
  { id: 'run:dn01-hidden-native-freeze:20261024T141232548Z-21e28fd4-cd72-4c34-9e92-d0f09243b129', reason: 'Build consumes verified immutable engine inputs' },
  { id: 'run:DN-01-hidden-native:20261024T142046814Z-e62f13cf-5b0f-4593-a90f-f7e0cf171d6f', reason: 'Retain passing 90 library and 1 detached console checks' },
  { id: 'handoff:DN-01-hidden-engine-bundle', reason: 'Retain exact rebuilt bundle for product packaging and acceptance' },
] });
const env = { ...process.env };
const key = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'Path';
env[key] = ['C:/Users/felre/.cargo/bin', path.dirname(python), env[key] || ''].join(path.delimiter);
env.CARGO_TARGET_DIR = target;
env.INSTA_PENDING_DIR = path.join(run.temporary, 'cargo-pending');
const phases = [], digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let code = 1;
function execute(name, command, args, cwd = root) {
  const out = fs.openSync(path.join(run.logs, name + '.stdout.log'), 'wx');
  const err = fs.openSync(path.join(run.logs, name + '.stderr.log'), 'wx');
  const startedUtc = new Date().toISOString(); let result;
  try { result = spawnSync(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', out, err] }); }
  finally { fs.closeSync(out); fs.closeSync(err); }
  phases.push({ name, command, args, cwd, startedUtc, endedUtc: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message });
  fs.writeFileSync(path.join(run.reports, 'phases.json'), JSON.stringify(phases, null, 2));
  if (result.error || result.status !== 0) throw Error(`${name} failed; see ${run.logs}`);
}
const provenance = (name, args) => execute(name, python, ['-X', 'utf8', '-B', path.join(__dirname, 'hidden-native-prep.py'), 'script', path.join(root, 'scripts/engine-provenance.py'), ...args]);
try {
  const before = path.join(run.reports, 'source-before.json');
  provenance('source-before', ['snapshot', '--root', source, '--file', before]);
  if (JSON.parse(fs.readFileSync(before)).sourceSha256 !== expected) throw Error('Selected source differs');
  const hostBefore = digest(host);
  // Exact maintained build-azrael.ps1 engine recipe, through its Cargo lease owner.
  execute('engine-build', process.execPath, [path.join(root, 'scripts/cargo-target-owner.cjs'), 'build', '--locked', '--no-default-features', '--target', 'x86_64-pc-windows-msvc', '-p', 'codex-app-server', '--bin', 'azrael', '-p', 'codex-app-server-client', '--bin', 'azrael-bridge'], path.join(source, 'codex-rs'));
  if (digest(host) !== hostBefore) throw Error('Selected compatible host changed during compilation');
  const bundle = path.join(run.outputs, 'engine'); fs.mkdirSync(bundle);
  for (const name of ['azrael.exe', 'azrael-bridge.exe']) {
    const from = path.join(target, 'x86_64-pc-windows-msvc/debug', name), to = path.join(bundle, name);
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    if (digest(from) !== digest(to)) throw Error('Bundle copy mismatch: ' + name);
  }
  fs.copyFileSync(host, path.join(bundle, 'azrael-code-mode-host.exe'), fs.constants.COPYFILE_EXCL);
  provenance('record-bundle', ['record', '--root', source, '--file', before, '--engine-dir', bundle, '--code-mode-host-source', host]);
  provenance('verify-bundle', ['verify', '--root', source, '--engine-dir', bundle]);
  fs.writeFileSync(path.join(run.reports, 'result.json'), JSON.stringify({ source, expected, target, bundle, host, hostSha256: hostBefore, phases, binaries: Object.fromEntries(fs.readdirSync(bundle).map(name => [name, digest(path.join(bundle, name))])) }, null, 2));
  code = 0; console.log(JSON.stringify({ bundle, result: path.join(run.reports, 'result.json') }));
} finally { finishArtifactRun(run, { exitCode: code, producerStopped: true }); }
process.exitCode = code;
