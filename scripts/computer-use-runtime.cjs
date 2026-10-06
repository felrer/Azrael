'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SKY_EXECUTABLE, brandComputerUse } = require('./computer-use-branding.cjs');
const { TRANSPORT, TRANSPORT_POLICY_MODULES, transformTransport, generateSettingsModule } = require('./inject-sky-control-policy.cjs');
const POLICY_MODULES = ['sky-controlled-service.mjs', 'sky-control-policy.mjs', 'use-control-settings.cjs'];
const REQUIRED = ['node_repl.exe', 'node.exe', 'node_modules/@oai/sky/package.json', 'node_modules/@oai/sky/bin/windows/codex-computer-use.exe', 'skills/computer-use/SKILL.md', 'docs/guidance.md', 'docs/api.md', 'docs/confirmations.md', TRANSPORT, ...POLICY_MODULES, 'use-control-settings.mjs', ...TRANSPORT_POLICY_MODULES];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function relative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.startsWith('/') || value.split('/').some(x => !x || x === '.' || x === '..')) throw new Error(`Unsafe runtime path: ${value}`);
  return value;
}
function checked(root, rel = '') {
  let current = path.resolve(root);
  for (let ancestor = current; ; ancestor = path.dirname(ancestor)) {
    if (fs.lstatSync(ancestor).isSymbolicLink()) throw new Error(`Runtime symlink forbidden: ${ancestor}`);
    if (path.dirname(ancestor) === ancestor) break;
  }
  for (const part of [current, ...rel.split('/').filter(Boolean)]) {
    current = part === path.resolve(root) ? part : path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Runtime symlink forbidden: ${current}`);
  }
  return current;
}
function walk(root, rel = '') {
  const target = checked(root, rel);
  const stat = fs.lstatSync(target);
  if (stat.isFile()) return [rel];
  if (!stat.isDirectory()) throw new Error(`Unsupported runtime file: ${target}`);
  return fs.readdirSync(target).sort().flatMap(name => walk(root, rel ? `${rel}/${name}` : name));
}
function verifyRuntime(directory) {
  directory = path.resolve(directory);
  const manifestBytes = fs.readFileSync(checked(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schema !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.packages)) throw new Error('Invalid Computer Use manifest');
  const seen = new Set();
  for (const entry of manifest.files) {
    const rel = relative(entry.path);
    if (seen.has(rel.toLowerCase()) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Invalid runtime entry: ${rel}`);
    seen.add(rel.toLowerCase());
    const file = checked(directory, rel);
    if (!fs.lstatSync(file).isFile()) throw new Error(`Runtime file missing: ${rel}`);
    const bytes = fs.readFileSync(file);
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error(`Runtime hash mismatch: ${rel}`);
  }
  for (const rel of REQUIRED) if (!seen.has(rel.toLowerCase())) throw new Error(`Required runtime entry missing: ${rel}`);
  for (const rel of walk(directory)) if (rel !== 'manifest.json' && !seen.has(rel.toLowerCase())) throw new Error(`Unrecorded runtime file: ${rel}`);
  for (const pkg of manifest.packages) {
    const pkgRel = relative(pkg.path);
    const actual = JSON.parse(fs.readFileSync(checked(directory, `${pkgRel}/package.json`)));
    if (actual.name !== pkg.name || actual.version !== pkg.version) throw new Error(`Runtime package identity mismatch: ${pkgRel}`);
    for (const name of Object.keys(actual.dependencies || {})) resolvePackage(directory, pkgRel, name);
  }
  const skyPackage = JSON.parse(fs.readFileSync(checked(directory, 'node_modules/@oai/sky/package.json')));
  const transportEntry = manifest.files.find(entry => entry.path === TRANSPORT);
  const transformed = transformTransport(fs.readFileSync(checked(directory, TRANSPORT)), skyPackage.version);
  if (JSON.stringify(transportEntry.transform) !== JSON.stringify(transformed.transform) || transportEntry.sourceSha256 !== transformed.transform.sourceSha256 || transportEntry.sha256 !== transformed.transform.outputSha256) throw new Error('Sky policy transform provenance mismatch');
  const settingsModule = generateSettingsModule(fs.readFileSync(checked(directory, 'use-control-settings.cjs')));
  for (const rel of ['use-control-settings.mjs', ...TRANSPORT_POLICY_MODULES.filter(rel => rel.endsWith('/use-control-settings.mjs'))]) {
    const entry = manifest.files.find(entry => entry.path === rel);
    if (!fs.readFileSync(checked(directory, rel)).equals(settingsModule.content) || JSON.stringify(entry.transform) !== JSON.stringify(settingsModule.transform) || entry.sourceSha256 !== settingsModule.transform.sourceSha256) throw new Error('Settings owner ESM provenance mismatch');
  }
  return { directory, manifestSha256: hash(manifestBytes), manifest };
}
function packageName(name) {
  if (!/^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(name) || name === '.' || name === '..') throw new Error(`Invalid dependency name: ${name}`);
}
function resolvePackage(root, from, name) {
  packageName(name);
  let base = from;
  while (true) {
    const rel = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (fs.existsSync(path.join(root, rel, 'package.json'))) { checked(root, `${rel}/package.json`); return rel; }
    if (!base) break;
    base = path.posix.dirname(base);
    if (base === '.') base = '';
  }
  throw new Error(`Missing runtime dependency: ${name} (from ${from})`);
}
function stageRuntime({ runtimeDirectory, pluginDirectory, destination, selectedWindowGuide }) {
  runtimeDirectory = path.resolve(runtimeDirectory);
  pluginDirectory = path.resolve(pluginDirectory);
  destination = path.resolve(destination);
  checked(runtimeDirectory); checked(pluginDirectory);
  const bin = fs.existsSync(path.join(runtimeDirectory, 'node_repl.exe')) ? runtimeDirectory : checked(runtimeDirectory, 'bin');
  if (fs.existsSync(destination)) throw new Error(`Runtime destination must be new: ${destination}`);
  let existingParent = path.dirname(destination);
  while (!fs.existsSync(existingParent)) existingParent = path.dirname(existingParent);
  checked(existingParent);
  for (const source of [runtimeDirectory, pluginDirectory]) if (destination === source || destination.startsWith(source + path.sep)) throw new Error('Runtime destination overlaps source');
  const files = new Map(), packages = [], pending = ['node_modules/@oai/sky'], visited = new Set();
  function add(sourceRoot, sourceRel, targetRel) {
    relative(targetRel);
    const source = checked(sourceRoot, sourceRel);
    const bytes = fs.readFileSync(source);
    files.set(targetRel, { path: targetRel, source, sha256: hash(bytes), bytes: bytes.length });
  }
  for (const name of ['node_repl.exe', 'node.exe']) add(bin, name, name);
  while (pending.length) {
    const rel = pending.shift();
    if (visited.has(rel)) continue;
    visited.add(rel);
    const pkg = JSON.parse(fs.readFileSync(checked(bin, `${rel}/package.json`)));
    if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') throw new Error(`Package identity missing: ${rel}`);
    packages.push({ name: pkg.name, version: pkg.version, path: rel, source: checked(bin, rel) });
    for (const file of walk(bin, rel)) add(bin, file, file);
    for (const name of Object.keys(pkg.dependencies || {}).sort()) pending.push(resolvePackage(bin, rel, name));
  }
  for (const rel of POLICY_MODULES) add(__dirname, rel, rel);
  for (const rel of TRANSPORT_POLICY_MODULES.filter(rel => rel.endsWith('/sky-control-policy.mjs'))) add(__dirname, path.posix.basename(rel), rel);
  const settingsModule = generateSettingsModule(fs.readFileSync(files.get('use-control-settings.cjs').source));
  for (const rel of ['use-control-settings.mjs', ...TRANSPORT_POLICY_MODULES.filter(rel => rel.endsWith('/use-control-settings.mjs'))]) {
    add(__dirname, 'use-control-settings.cjs', rel);
    Object.assign(files.get(rel), { content: settingsModule.content, transform: settingsModule.transform, sourceSha256: settingsModule.transform.sourceSha256, sourceBytes: files.get(rel).bytes, sha256: hash(settingsModule.content), bytes: settingsModule.content.length });
  }
  const transport = files.get(TRANSPORT);
  if (!transport) throw new Error('Missing Sky policy transport');
  const transformed = transformTransport(fs.readFileSync(transport.source), packages.find(pkg => pkg.name === '@oai/sky').version);
  transport.content = transformed.content; transport.transform = transformed.transform;
  transport.sourceSha256 = transformed.transform.sourceSha256; transport.sourceBytes = transport.bytes;
  transport.sha256 = hash(transport.content); transport.bytes = transport.content.length;
  const sky = files.get(SKY_EXECUTABLE);
  const branded = brandComputerUse(fs.readFileSync(sky.source));
  sky.content = branded.content; sky.transform = branded.transform;
  sky.sourceSha256 = sky.sha256; sky.sourceBytes = sky.bytes;
  sky.sha256 = hash(sky.content); sky.bytes = sky.content.length;
  for (const rel of REQUIRED.filter(x => x.startsWith('skills/') || x.startsWith('docs/'))) add(pluginDirectory, rel, rel);
  if (selectedWindowGuide) {
    const guideRoot = path.dirname(path.resolve(selectedWindowGuide));
    add(guideRoot, path.basename(selectedWindowGuide), 'docs/selected-window.md');
    const skill = files.get('skills/computer-use/SKILL.md');
    const original = fs.readFileSync(skill.source, 'utf8');
    const routing = '\n## Window Use routing\n\nFor control of one window while the user continues using their mouse and keyboard, use the separate window-use skill and azrael_window tools. Computer Use follows the foreground Sky instructions below. Dedicated selectedWindow conversations retain their native tool ceiling.\n\n';
    // Retain plugin front matter so skill discovery metadata remains valid.
    const frontMatter = original.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
    const offset = frontMatter ? frontMatter[0].length : 0;
    skill.content = Buffer.from(original.slice(0, offset) + routing + original.slice(offset));
    skill.sha256 = hash(skill.content); skill.bytes = skill.content.length;
    const windowInstructions = Buffer.from('---\nname: window-use\ndescription: Discover, select and control a Windows window through Window Use while the user works in other apps. Use for window capture and structured task macros with azrael_window tools.\n---\n\n' + fs.readFileSync(selectedWindowGuide, 'utf8'));
    files.set('skills/window-use/SKILL.md', { path: 'skills/window-use/SKILL.md', source: path.resolve(selectedWindowGuide), sha256: hash(windowInstructions), bytes: windowInstructions.length, content: windowInstructions });
  }
  for (const rel of walk(pluginDirectory).filter(x => /(^|\/)(plugin\.json|LICENSE(?:\.[^/]*)?|NOTICE(?:\.[^/]*)?)$/i.test(x))) add(pluginDirectory, rel, rel);
  const manifest = { schema: 1, scope: 'local installation', source: { runtimeDirectory, runtimeVersion: path.basename(runtimeDirectory === bin ? path.dirname(bin) : runtimeDirectory), pluginDirectory, pluginVersion: path.basename(pluginDirectory) }, packages, files: [...files.values()].map(({content, ...entry}) => entry).sort((a,b) => a.path.localeCompare(b.path)) };
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of manifest.files) {
    const target = path.join(destination, entry.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const content = files.get(entry.path).content;
    if (content) fs.writeFileSync(target, content);
    else fs.copyFileSync(entry.source, target);
  }
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return verifyRuntime(destination);
}
module.exports = { stageRuntime, verifyRuntime, checked, walk, relative, hash };
if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2), options = {};
    if (args.length % 2) throw new Error('Expected option/value pairs');
    for (let i = 0; i < args.length; i += 2) options[args[i]] = args[i + 1];
    let result;
    if (command === 'verify' && options['--directory']) result = verifyRuntime(options['--directory']);
    else if (command === 'stage' && options['--runtime-directory'] && options['--plugin-directory'] && options['--destination']) result = stageRuntime({ runtimeDirectory: options['--runtime-directory'], pluginDirectory: options['--plugin-directory'], destination: options['--destination'], selectedWindowGuide: options['--selected-window-guide'] });
    else throw new Error('Usage: stage --runtime-directory DIR --plugin-directory DIR --destination DIR | verify --directory DIR');
    console.log(JSON.stringify({ directory: result.directory, manifestSha256: result.manifestSha256 }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
