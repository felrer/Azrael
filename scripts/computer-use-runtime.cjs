'use strict';
// Generic Node REPL runtime owner. The historical release-directory name is retained.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const WINDOW_GUIDES = ['docs/window-use/common.md'];
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

function verifyRuntime(directory) {
 directory = path.resolve(directory);
 const bytes = fs.readFileSync(checked(directory, 'manifest.json')), manifest = JSON.parse(bytes);
 if (manifest.schema !== 2 || manifest.kind !== 'azrael-node-repl' || !Array.isArray(manifest.files) || !Array.isArray(manifest.packages)) throw new Error('Invalid Node REPL runtime manifest');
 const seen = new Set();
 for (const entry of manifest.files) {
  const rel = relative(entry.path);
  if (seen.has(rel.toLowerCase()) || !/^[a-f0-9]{64}$/.test(entry.sha256) || rel.startsWith('skills/') || rel.startsWith('node_modules/@oai/sky/')) throw new Error('Invalid Node REPL entry: '+rel);
  seen.add(rel.toLowerCase()); const data = fs.readFileSync(checked(directory, rel));
  if (data.length !== entry.bytes || hash(data) !== entry.sha256) throw new Error('Node REPL runtime hash mismatch: '+rel);
 }
 for (const name of ['node_repl.exe', 'node.exe']) if (!seen.has(name)) throw new Error('Missing Node REPL executable: '+name);
 for (const rel of walk(directory)) if (rel !== 'manifest.json' && !seen.has(rel.toLowerCase())) throw new Error('Unrecorded Node REPL file: '+rel);
 for (const pkg of manifest.packages) {
  const rel=relative(pkg.path), actual=JSON.parse(fs.readFileSync(checked(directory,rel+'/package.json')));
  if (actual.name !== pkg.name || actual.version !== pkg.version || actual.name === '@oai/sky') throw new Error('Runtime package identity mismatch: '+rel);
  for (const name of Object.keys(actual.dependencies || {})) resolvePackage(directory,rel,name);
 }
 return {directory,manifestSha256:hash(bytes),manifest};
}
function stageRuntime({runtimeDirectory,destination}) {
 runtimeDirectory=path.resolve(runtimeDirectory); destination=path.resolve(destination); checked(runtimeDirectory);
 const bin=fs.existsSync(path.join(runtimeDirectory,'node_repl.exe'))?runtimeDirectory:checked(runtimeDirectory,'bin');
 if(fs.existsSync(destination))throw new Error('Runtime destination must be new');
 if(destination===runtimeDirectory || destination.startsWith(runtimeDirectory+path.sep))throw new Error('Runtime destination overlaps source');
 let parent=path.dirname(destination);while(!fs.existsSync(parent))parent=path.dirname(parent);checked(parent);
 // Keep the installed runtime dependency tree except the retired Sky package. Dependency
 // verification below rejects any retained package still depending on the removed package.
 const inputs=['node_repl.exe','node.exe',...(fs.existsSync(path.join(bin,'node_modules'))?walk(bin,'node_modules').filter(rel=>!rel.startsWith('node_modules/@oai/sky/')):[])];
 const packages=inputs.filter(rel=>rel.endsWith('/package.json')).flatMap(rel=>{const pkg=JSON.parse(fs.readFileSync(checked(bin,rel)));return typeof pkg.name==='string'&&typeof pkg.version==='string'?[{name:pkg.name,version:pkg.version,path:path.posix.dirname(rel)}]:[];});
 for(const pkg of packages)for(const name of Object.keys(JSON.parse(fs.readFileSync(checked(bin,pkg.path+'/package.json'))).dependencies||{})){const resolved=resolvePackage(bin,pkg.path,name);if(resolved==='node_modules/@oai/sky')throw new Error('Retained package requires retired Sky runtime: '+pkg.name);}
 const entries=inputs.map(rel=>{const data=fs.readFileSync(checked(bin,rel));return {path:relative(rel),sha256:hash(data),bytes:data.length,source:checked(bin,rel)};});
 fs.mkdirSync(path.join(destination,'node_modules'),{recursive:true});for(const entry of entries){const target=path.join(destination,entry.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(entry.source,target);}
 fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify({schema:2,kind:'azrael-node-repl',source:{runtimeDirectory},packages,files:entries},null,2)+'\n');return verifyRuntime(destination);
}
module.exports={stageRuntime,verifyRuntime,checked,walk,relative,hash,WINDOW_GUIDES};
if(require.main===module){try{const [command,...args]=process.argv.slice(2),options={};if(args.length%2)throw new Error('Expected option/value pairs');for(let i=0;i<args.length;i+=2)options[args[i]]=args[i+1];let result;if(command==='verify')result=verifyRuntime(options['--directory']);else if(command==='stage')result=stageRuntime({runtimeDirectory:options['--runtime-directory'],destination:options['--destination']});else throw new Error('Unknown Node REPL runtime command');console.log(JSON.stringify({directory:result.directory,manifestSha256:result.manifestSha256}));}catch(error){console.error(error.message);process.exitCode=1;}}
