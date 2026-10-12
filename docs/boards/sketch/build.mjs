import { readFile, writeFile, mkdir, cp, access, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

const source = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(source, '../../..');
const inputs = ['app.jsx','sketch.css','index.html','package.json','package-lock.json','build.mjs'];
const selected = await Promise.all(inputs.map(async name => ({ name, bytes: await readFile(path.join(source,name)) })));
selected.push({ name: 'board.css', bytes: await readFile(path.join(source,'../shared/board.css')) });
for (const name of ['model.mjs','sketch-model.mjs']) selected.push({name,bytes:await readFile(path.join(source,'../shared',name))});
for (const name of (await readdir(path.join(source,'licenses'))).sort()) selected.push({name:`licenses/${name}`,bytes:await readFile(path.join(source,'licenses',name))});
const inputSha256 = createHash('sha256').update(Buffer.concat(selected.map(({name,bytes}) => Buffer.concat([Buffer.from(`${name}\0${bytes.length}\0`),bytes])))).digest('hex');
const identity = `sketch-${inputSha256}`;
const snapshot = path.join(project,'artifacts/build',identity);
const output = path.join(project,'artifacts/boards/sketch',inputSha256);
const publicRoot = path.join(output,'public');
const logs = path.join(project,'artifacts/logs',identity);
await mkdir(logs,{recursive:true});
try { await access(path.join(output,'build-info.json')); }
catch {
  await mkdir(snapshot,{recursive:false});
  for (const {name,bytes} of selected) { await mkdir(path.dirname(path.join(snapshot,name)),{recursive:true}); await writeFile(path.join(snapshot,name),bytes); }
  const installLog = path.join(logs,'npm-ci.log');
  const chunks=[];
  const exitCode = await new Promise((resolve,reject) => {
    const proc=spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm',['ci','--no-audit','--no-fund'],{cwd:snapshot,shell:process.platform === 'win32'});
    proc.stdout.on('data',data=>chunks.push(data)); proc.stderr.on('data',data=>chunks.push(data)); proc.on('error',reject); proc.on('exit',resolve);
  });
  await writeFile(installLog,Buffer.concat(chunks));
  if (exitCode !== 0) throw new Error(`npm ci failed (${exitCode}); ${installLog}`);
  const { build } = await import(pathToFileURL(path.join(snapshot,'node_modules/esbuild/lib/main.js')).href);
  await mkdir(publicRoot,{recursive:true});
  await build({absWorkingDir:snapshot,entryPoints:['app.jsx'],outdir:publicRoot,entryNames:'app',chunkNames:'chunk-[hash]',assetNames:'[name]-[hash]',bundle:true,splitting:true,format:'esm',platform:'browser',minify:true,define:{'process.env.NODE_ENV':'"production"'},conditions:['production'],external:['/shared/sketch-model.mjs'],loader:{'.woff2':'file','.woff':'file','.ttf':'file'},metafile:true}).then(result=>writeFile(path.join(logs,'esbuild-metafile.json'),JSON.stringify(result.metafile,null,2)));
  await cp(path.join(snapshot,'node_modules/@excalidraw/excalidraw/dist/prod/fonts'),path.join(publicRoot,'fonts'),{recursive:true});
  const licenseRoot = path.join(publicRoot,'licenses');
  await mkdir(licenseRoot,{recursive:true});
  await cp(path.join(snapshot,'licenses'),path.join(licenseRoot,'excalidraw'),{recursive:true});
  const notices=[];
  const installed=await readdir(path.join(snapshot,'node_modules'),{withFileTypes:true});
  const packageRoots=[];
  for (const entry of installed) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      for (const scoped of await readdir(path.join(snapshot,'node_modules',entry.name),{withFileTypes:true})) if (scoped.isDirectory()) packageRoots.push(path.join(snapshot,'node_modules',entry.name,scoped.name));
    } else packageRoots.push(path.join(snapshot,'node_modules',entry.name));
  }
  for (const packageRoot of packageRoots) {
    let metadata; try { metadata=JSON.parse(await readFile(path.join(packageRoot,'package.json'),'utf8')); } catch { continue; }
    const destination=path.join(licenseRoot,metadata.name.replaceAll('/','__'));
    const licenseFiles=(await readdir(packageRoot)).filter(name=>/^(licen[cs]e|notice|copying|copyright)(\.|$)/i.test(name));
    if (licenseFiles.length) {
      await mkdir(destination,{recursive:true});
      for (const name of licenseFiles) await cp(path.join(packageRoot,name),path.join(destination,name),{recursive:true});
    }
    notices.push({name:metadata.name,version:metadata.version,license:metadata.license || metadata.licenses || null,files:licenseFiles});
  }
  await writeFile(path.join(licenseRoot,'third-party-notices.json'),JSON.stringify(notices,null,2));
  await cp(path.join(snapshot,'node_modules/@excalidraw/excalidraw/README.md'),path.join(licenseRoot,'excalidraw-package-README.md'));
  await cp(path.join(snapshot,'board.css'),path.join(publicRoot,'board.css'));
  for (const name of ['model.mjs','sketch-model.mjs']) await cp(path.join(snapshot,name),path.join(publicRoot,name));
  const html = (await readFile(path.join(snapshot,'index.html'),'utf8')).replace('/shared/board.css','/sketch/assets/board.css');
  await writeFile(path.join(publicRoot,'index.html'),html);
  const info={inputSha256,publicRoot,snapshot,createdAt:new Date().toISOString(),nodeVersion:process.version,sourceInputs:selected.map(({name,bytes})=>({name,sha256:createHash('sha256').update(bytes).digest('hex')})),install:{command:'npm ci --no-audit --no-fund',exitCode,logPath:installLog}};
  await writeFile(path.join(output,'build-info.json'),JSON.stringify(info,null,2));
}
const info=JSON.parse(await readFile(path.join(output,'build-info.json'),'utf8'));
await writeFile(path.join(project,'artifacts/boards/sketch/current.json'),JSON.stringify(info,null,2));
console.log(JSON.stringify(info,null,2));
