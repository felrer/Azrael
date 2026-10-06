'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { checked, walk, relative, hash } = require('./computer-use-runtime.cjs');
const REQUIRED = ['azrael-window-control.exe', 'window-control-mcp.cjs', 'window-control-policy.cjs', 'docs/selected-window.md', 'THIRD_PARTY_NOTICES.md', 'window-task-macros.cjs', 'window-control-occupancy.cjs'];
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function sourceFingerprint(sourceRoot) {
  const files = ['Cargo.lock', 'Cargo.toml', 'THIRD_PARTY_NOTICES.md', ...walk(path.join(sourceRoot, 'src')).map(rel => `src/${rel}`)].sort();
  if (!files.includes('Cargo.toml') || !files.includes('Cargo.lock') || !files.some(rel => rel.startsWith('src/'))) throw new Error('Incomplete Window Control crate source');
  return hash(JSON.stringify(files.map(rel => [rel, hash(fs.readFileSync(checked(sourceRoot, rel)))])));
}
function verifyRuntime(directory) {
  directory = path.resolve(directory);
  const bytes = fs.readFileSync(checked(directory, 'manifest.json'));
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== 1 || manifest.kind !== 'azrael-window-control' || !Array.isArray(manifest.files) ||
      !manifest.source || !path.isAbsolute(manifest.source.directory || '') || !digest(manifest.source.sourceSha256) ||
      !digest(manifest.source.executableSha256) || manifest.source.builder !== 'cargo --locked --release') throw new Error('Invalid Window Control manifest provenance');
  const seen = new Set();
  for (const entry of manifest.files) {
    const rel = relative(entry.path);
    if (seen.has(rel.toLowerCase()) || rel.toLowerCase() === 'manifest.json' || !digest(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error(`Invalid Window Control entry: ${rel}`);
    seen.add(rel.toLowerCase());
    const bytes = fs.readFileSync(checked(directory, rel));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error(`Window Control hash mismatch: ${rel}`);
  }
  for (const rel of REQUIRED) if (!seen.has(rel.toLowerCase())) throw new Error(`Required Window Control entry missing: ${rel}`);
  for (const rel of walk(directory)) if (rel !== 'manifest.json' && !seen.has(rel.toLowerCase())) throw new Error(`Unrecorded Window Control file: ${rel}`);
  if (manifest.files.find(entry => entry.path === REQUIRED[0])?.sha256 !== manifest.source.executableSha256) throw new Error('Window Control executable provenance mismatch');
  return { directory, executable: path.join(directory, REQUIRED[0]), mcpScript: path.join(directory, REQUIRED[1]), manifestSha256: hash(bytes), manifest };
}
function verifyRelease(release, sourceRoot) {
  const build = JSON.parse(fs.readFileSync(checked(release, 'build-info.json')));
  const expected = build.sha256?.['window-control/manifest.json'];
  if (!expected) {
    if (fs.existsSync(path.join(release, 'window-control'))) throw new Error('Undeclared Window Control runtime');
    return null;
  }
  const result = verifyRuntime(path.join(release, 'window-control'));
  if (result.manifestSha256 !== expected.toLowerCase()) throw new Error('Release Window Control manifest hash mismatch');
  if (sourceRoot && sourceFingerprint(sourceRoot) !== result.manifest.source.sourceSha256) throw new Error('Window Control source provenance mismatch');
  for (const module of ['window-control-host.cjs', 'window-control-backend.cjs', 'window-control-policy.cjs', 'window-control-occupancy.cjs', 'window-control-mcp.cjs', 'window-task-macros.cjs', 'window-control-runtime.cjs', 'computer-use-runtime.cjs', 'computer-use-branding.cjs']) {
    const wanted = build.sha256?.[`host/${module}`];
    if (!wanted || hash(fs.readFileSync(checked(release, `host/${module}`))) !== wanted.toLowerCase()) throw new Error(`Release Window Control host module mismatch: ${module}`);
  }
  return result;
}
function verifyPreparedHost(directory, release) {
  const expected = verifyRelease(release);
  const config = JSON.parse(fs.readFileSync(checked(directory, 'out/azrael-runtime.json')));
  if (!expected) {
    if (config.windowControl || fs.existsSync(path.join(directory, 'window-control'))) throw new Error('Prepared host declares unsupported Window Control runtime');
    return null;
  }
  for (const key of ['directory', 'executable', 'mcpScript', 'manifestSha256']) {
    if (config.windowControl?.[key] !== expected[key]) throw new Error(`Prepared Window Control configuration mismatch: ${key}`);
  }
  if (verifyRuntime(path.join(directory, 'window-control')).manifestSha256 !== expected.manifestSha256) throw new Error('Prepared Window Control manifest mismatch');
  const build = JSON.parse(fs.readFileSync(checked(release, 'build-info.json')));
  for (const module of ['window-control-host.cjs', 'window-control-backend.cjs', 'window-control-policy.cjs', 'window-control-occupancy.cjs', 'window-control-mcp.cjs', 'window-task-macros.cjs', 'window-control-runtime.cjs', 'computer-use-runtime.cjs', 'computer-use-branding.cjs']) {
    const wanted = build.sha256?.[`host/${module}`];
    if (!wanted || hash(fs.readFileSync(checked(directory, `out/${module}`))) !== wanted.toLowerCase()) throw new Error(`Prepared Window Control host module mismatch: ${module}`);
  }
  return expected;
}
function stageRuntime({ sourceRoot, executable, provenance, scriptDirectory, guidance, destination }) {
  for (const directory of [sourceRoot, scriptDirectory]) checked(directory);
  for (const file of [executable, provenance, guidance]) checked(path.dirname(path.resolve(file)), path.basename(file));
  destination = path.resolve(destination);
  if (fs.existsSync(destination)) throw new Error('Window Control destination must be new');
  let parent = path.dirname(destination);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  checked(parent);
  for (const source of [sourceRoot, scriptDirectory]) {
    const root = path.resolve(source);
    if (destination === root || destination.startsWith(root + path.sep)) throw new Error('Window Control destination overlaps source');
  }
  const evidence = JSON.parse(fs.readFileSync(provenance));
  const sourceSha256 = sourceFingerprint(sourceRoot), executableSha256 = hash(fs.readFileSync(executable));
  if (evidence.schema !== 1 || evidence.sourceSha256 !== sourceSha256 || evidence.executableSha256 !== executableSha256) throw new Error('Window Control build provenance mismatch');
  const inputs = [[REQUIRED[0], executable], [REQUIRED[1], checked(scriptDirectory, REQUIRED[1])], [REQUIRED[2], checked(scriptDirectory, REQUIRED[2])], [REQUIRED[3], guidance], [REQUIRED[4], checked(sourceRoot, REQUIRED[4])], [REQUIRED[5], checked(scriptDirectory, REQUIRED[5])], [REQUIRED[6], checked(scriptDirectory, REQUIRED[6])]];
  const files = inputs.map(([rel, source]) => { const bytes = fs.readFileSync(source); return { path: relative(rel), sha256: hash(bytes), bytes: bytes.length, source: path.resolve(source) }; });
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of files) { const target = path.join(destination, entry.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(entry.source, target); }
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ schema: 1, kind: 'azrael-window-control', source: { directory: path.resolve(sourceRoot), sourceSha256, executableSha256, builder: 'cargo --locked --release' }, files }, null, 2) + '\n');
  return verifyRuntime(destination);
}
module.exports = { sourceFingerprint, fingerprintNativeSource: sourceFingerprint, stageRuntime, verifyRuntime, verifyRelease, verifyPreparedHost };
if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2), options = {};
    if (args.length % 2) throw new Error('Expected option/value pairs');
    for (let i = 0; i < args.length; i += 2) options[args[i]] = args[i + 1];
    let result;
    if (command === 'verify') result = verifyRuntime(options['--directory']);
    else if (command === 'verify-release') result = verifyRelease(options['--release'], options['--source-root']);
    else if (command === 'verify-host') result = verifyPreparedHost(options['--directory'], options['--release']);
    else if (command === 'fingerprint') result = { sourceSha256: sourceFingerprint(options['--source'] || options['--source-root']) };
    else if (command === 'stage') result = stageRuntime({ sourceRoot: options['--source-root'], executable: options['--executable'], provenance: options['--provenance'], scriptDirectory: options['--script-directory'], guidance: options['--guidance'], destination: options['--destination'] });
    else throw new Error('Unknown Window Control runtime command');
    if (result) delete result.manifest;
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
