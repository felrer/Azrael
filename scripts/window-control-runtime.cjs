'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { checked, walk, relative, hash, WINDOW_GUIDES } = require('./computer-use-runtime.cjs');
const REQUIRED = ['azrael-window-control.exe', 'window-control-mcp.cjs', 'window-control-policy.cjs', 'THIRD_PARTY_NOTICES.md', 'window-task-macros.cjs', 'window-control-occupancy.cjs', 'use-control-settings.cjs', 'window-use-approvals.cjs', 'window-control-errors.cjs'];
const MULTI_POINTER_MODULES = ['multi-pointer-mcp.cjs', 'window-switched-input.cjs'];
const requiredFiles = platform => [platform === 'linux' ? 'azrael-window-control' : REQUIRED[0], ...REQUIRED.slice(1), ...WINDOW_GUIDES];
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function sourceFingerprint(sourceRoot) {
  const files = ['Cargo.lock', 'Cargo.toml', 'THIRD_PARTY_NOTICES.md', ...walk(path.join(sourceRoot, 'src')).filter(rel => !rel.split('/').includes('__pycache__') && !rel.endsWith('.pyc')).map(rel => `src/${rel}`)].sort();
  if (!files.includes('Cargo.toml') || !files.includes('Cargo.lock') || !files.some(rel => rel.startsWith('src/'))) throw new Error('Incomplete Window Control crate source');
  return hash(JSON.stringify(files.map(rel => [rel, hash(fs.readFileSync(checked(sourceRoot, rel)))])));
}
function verifyRuntime(directory) {
  directory = path.resolve(directory);
  const bytes = fs.readFileSync(checked(directory, 'manifest.json'));
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== 1 || manifest.windowUseGuidanceVersion !== 2 || manifest.childSession || manifest.kind !== 'azrael-window-control' || !Array.isArray(manifest.files) ||
      !manifest.source || !path.isAbsolute(manifest.source.directory || '') || !digest(manifest.source.sourceSha256) ||
      !digest(manifest.source.executableSha256) || manifest.source.builder !== (manifest.platform === 'linux' ? 'python3 -m py_compile' : 'cargo --locked --release')) throw new Error('Invalid Window Control manifest provenance');
  const required = requiredFiles(manifest.platform);
  const seen = new Set();
  for (const entry of manifest.files) {
    const rel = relative(entry.path);
    if (seen.has(rel.toLowerCase()) || rel.toLowerCase() === 'manifest.json' || !digest(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error(`Invalid Window Control entry: ${rel}`);
    seen.add(rel.toLowerCase());
    const bytes = fs.readFileSync(checked(directory, rel));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error(`Window Control hash mismatch: ${rel}`);
  }
  for (const rel of required) if (!seen.has(rel.toLowerCase())) throw new Error(`Required Window Control entry missing: ${rel}`);
  for (const rel of walk(directory)) if (rel !== 'manifest.json' && !seen.has(rel.toLowerCase())) throw new Error(`Unrecorded Window Control file: ${rel}`);
  if (manifest.files.find(entry => entry.path === required[0])?.sha256 !== manifest.source.executableSha256) throw new Error('Window Control executable provenance mismatch');
  let virtualInput;
  if (manifest.virtualInput) {
    if (manifest.platform !== 'win32' || manifest.virtualInput.directory !== 'virtual-input' || !digest(manifest.virtualInput.manifestSha256) || !seen.has('window-virtual-input.cjs')) throw new Error('Invalid virtual input runtime declaration');
    const checkedVirtual = require('./window-virtual-input.cjs').verifyVirtualRuntime(path.join(directory,'virtual-input'));
    if (checkedVirtual.manifestSha256 !== manifest.virtualInput.manifestSha256 || manifest.files.find(f=>f.path==='virtual-input/manifest.json')?.sha256 !== checkedVirtual.manifestSha256) throw new Error('Virtual input runtime manifest mismatch');
    virtualInput = {...checkedVirtual,modulePath:path.join(directory,'window-virtual-input.cjs')};
  } else if ([...seen].some(name=>name==='window-virtual-input.cjs' || name.startsWith('virtual-input/'))) throw new Error('Undeclared virtual input runtime');
  let multiPointer;
  if (manifest.multiPointer) {
    if (manifest.platform !== 'win32' || manifest.multiPointer.directory !== 'multi-pointer' || !digest(manifest.multiPointer.manifestSha256) || MULTI_POINTER_MODULES.some(name => !seen.has(name))) throw new Error('Invalid multi-pointer runtime declaration');
    const checkedMultiPointer = require('./multi-pointer-mcp.cjs').verifyRuntime(path.join(directory, 'multi-pointer'));
    if (checkedMultiPointer.manifestSha256 !== manifest.multiPointer.manifestSha256 || manifest.files.find(entry => entry.path === 'multi-pointer/manifest.json')?.sha256 !== checkedMultiPointer.manifestSha256) throw new Error('Multi-pointer runtime manifest mismatch');
    multiPointer = { directory: checkedMultiPointer.directory, manifestSha256: checkedMultiPointer.manifestSha256, modulePath: path.join(directory, 'multi-pointer-mcp.cjs') };
  } else if ([...seen].some(name => MULTI_POINTER_MODULES.includes(name) || name.startsWith('multi-pointer/'))) throw new Error('Undeclared multi-pointer runtime');
  return { directory, executable: path.join(directory, required[0]), mcpScript: path.join(directory, required[1]), manifestSha256: hash(bytes), manifest, ...(virtualInput ? {virtualInput} : {}), ...(multiPointer ? { multiPointer } : {}) };
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
  for (const module of ['window-control-host.cjs', ...(result.virtualInput?['window-virtual-input.cjs']:[]), ...(result.multiPointer ? MULTI_POINTER_MODULES : []), 'window-control-backend.cjs', 'window-control-policy.cjs', 'window-control-errors.cjs', 'window-control-occupancy.cjs', 'window-control-mcp.cjs', 'window-task-macros.cjs', 'window-control-runtime.cjs', 'computer-use-runtime.cjs', 'use-control-settings.cjs', 'window-use-approvals.cjs', 'use-settings-host.cjs']) {
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
  if (config.windowControl?.childSession) throw new Error('Prepared Window Control declares unsupported child-session helper');
  if (expected.virtualInput) {
    for(const key of ['directory','manifestSha256','modulePath']) if(config.windowControl?.virtualInput?.[key] !== expected.virtualInput[key]) throw new Error(`Prepared virtual input configuration mismatch: ${key}`);
  } else if(config.windowControl?.virtualInput) throw new Error('Prepared Window Control declares unsupported virtual input runtime');
  if (expected.multiPointer) {
    for (const key of ['directory', 'manifestSha256', 'modulePath']) if (config.windowControl?.multiPointer?.[key] !== expected.multiPointer[key]) throw new Error(`Prepared multi-pointer configuration mismatch: ${key}`);
  } else if (config.windowControl?.multiPointer) throw new Error('Prepared Window Control declares unsupported multi-pointer runtime');
  if (verifyRuntime(path.join(directory, 'window-control')).manifestSha256 !== expected.manifestSha256) throw new Error('Prepared Window Control manifest mismatch');
  const build = JSON.parse(fs.readFileSync(checked(release, 'build-info.json')));
  for (const module of ['window-control-host.cjs', ...(expected.virtualInput?['window-virtual-input.cjs']:[]), ...(expected.multiPointer ? MULTI_POINTER_MODULES : []), 'window-control-backend.cjs', 'window-control-policy.cjs', 'window-control-errors.cjs', 'window-control-occupancy.cjs', 'window-control-mcp.cjs', 'window-task-macros.cjs', 'window-control-runtime.cjs', 'computer-use-runtime.cjs', 'use-control-settings.cjs', 'window-use-approvals.cjs', 'use-settings-host.cjs']) {
    const wanted = build.sha256?.[`host/${module}`];
    if (!wanted || hash(fs.readFileSync(checked(directory, `out/${module}`))) !== wanted.toLowerCase()) throw new Error(`Prepared Window Control host module mismatch: ${module}`);
  }
  return expected;
}
function stageRuntime({ sourceRoot, executable, provenance, scriptDirectory, guidance, destination, virtualInputDirectory, multiPointerDirectory }) {
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
  const platform = path.basename(executable) === 'linux_backend.py' ? 'linux' : 'win32';
  const inputs = [[requiredFiles(platform)[0], executable], [REQUIRED[1], checked(scriptDirectory, REQUIRED[1])], [REQUIRED[2], checked(scriptDirectory, REQUIRED[2])], [REQUIRED[3], checked(sourceRoot, REQUIRED[3])], [REQUIRED[4], checked(scriptDirectory, REQUIRED[4])], [REQUIRED[5], checked(scriptDirectory, REQUIRED[5])]];
  for (const rel of ['window-control-errors.cjs', 'use-control-settings.cjs', 'window-use-approvals.cjs']) inputs.push([rel, checked(scriptDirectory, rel)]);
  let virtualInput;
  if(virtualInputDirectory) {
    if(platform !== 'win32' || !path.isAbsolute(virtualInputDirectory)) throw new Error('Virtual input requires an absolute Windows runtime directory');
    virtualInput=require('./window-virtual-input.cjs').verifyVirtualRuntime(virtualInputDirectory);
    inputs.push(['window-virtual-input.cjs',checked(scriptDirectory,'window-virtual-input.cjs')]);
    for(const rel of walk(virtualInputDirectory))inputs.push([`virtual-input/${rel}`,checked(virtualInputDirectory,rel)]);
  }
  let multiPointer;
  if (multiPointerDirectory) {
    if (platform !== 'win32' || !path.isAbsolute(multiPointerDirectory)) throw new Error('Multi-pointer requires an absolute Windows runtime directory');
    multiPointer = require('./multi-pointer-mcp.cjs').verifyRuntime(multiPointerDirectory);
    for (const name of MULTI_POINTER_MODULES) inputs.push([name, checked(scriptDirectory, name)]);
    for (const rel of walk(multiPointerDirectory)) inputs.push([`multi-pointer/${rel}`, checked(multiPointerDirectory, rel)]);
  }
  for (const rel of WINDOW_GUIDES) inputs.push([rel, checked(path.dirname(path.resolve(guidance)), path.basename(rel))]);
  const files = inputs.map(([rel, source]) => { const bytes = fs.readFileSync(source); return { path: relative(rel), sha256: hash(bytes), bytes: bytes.length, source: path.resolve(source) }; });
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of files) { const target = path.join(destination, entry.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(entry.source, target); if (entry.path === requiredFiles(platform)[0]) fs.chmodSync(target, 0o755); }
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ schema: 1, kind: 'azrael-window-control', windowUseGuidanceVersion: 2, platform, ...(multiPointer ? { multiPointer: { directory: 'multi-pointer', manifestSha256: multiPointer.manifestSha256 } } : {}), ...(virtualInput ? {virtualInput:{directory:'virtual-input',manifestSha256:virtualInput.manifestSha256}} : {}), source: { directory: path.resolve(sourceRoot), sourceSha256, executableSha256, builder: platform === 'linux' ? 'python3 -m py_compile' : 'cargo --locked --release' }, files }, null, 2) + '\n');
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
    else if (command === 'stage') result = stageRuntime({ sourceRoot: options['--source-root'], executable: options['--executable'], provenance: options['--provenance'], scriptDirectory: options['--script-directory'], guidance: options['--guidance'], destination: options['--destination'], virtualInputDirectory: options['--virtual-input-directory'], multiPointerDirectory: options['--multi-pointer-directory'] });
    else throw new Error('Unknown Window Control runtime command');
    if (result) delete result.manifest;
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
