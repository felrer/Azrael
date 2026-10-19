// Retained launcher: isolate old/new board fixtures without a second product path.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const project = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const lifecycle = require(join(project, 'scripts/artifact-lifecycle.cjs'));
const stage = process.argv[2];
if (!['unit', 'ui'].includes(stage)) throw Error('Use catalog-verify.mjs unit|ui');
const runId = `${stage}-${Date.now()}-${randomUUID().slice(0,8)}`;
const runRoot = join(project, 'artifacts/tasks/CN-01-catalog-modules/runs', runId);
const evidenceId = `run:CN-01-catalog-modules:${runId}:evidence`, temporaryId = `run:CN-01-catalog-modules:${runId}:temporary`;
for (const record of lifecycle.catalog(project)) for (const member of record.members) {
  if (runRoot === member.path || runRoot.startsWith(member.path + sep) || member.path.startsWith(runRoot + sep)) throw Error('Conflicting artifact ownership');
}
const temporary = { id: temporaryId, kind: 'run', owner: '/root/catalog-verification', version: runId, state: 'pending', membership_complete: false,
  members: [{ path: join(runRoot,'temporary'), role: 'temporary', generated: true, protection_known: true }] };
const evidence = { id: evidenceId, kind: 'run', owner: '/root/catalog-verification', version: runId, state: 'pending', membership_complete: false,
  members: [{ path: join(runRoot,'logs'), role: 'logs', generated: true, protection_known: true }, { path: join(runRoot,'reports'), role: 'reports', generated: true, protection_known: true }] };
lifecycle.recordLifecycle(project, temporary); lifecycle.recordLifecycle(project, evidence);
for (const path of [...temporary.members, ...evidence.members]) await mkdir(path.path, {recursive:true});
const argv = stage === 'unit'
  ? ['--test', ...['catalog.test.mjs','boards.test.mjs','sketch.test.mjs'].map(file=>join(project,'docs/boards/tests',file))]
  : [join(project,'docs/boards/tests/catalog-render.mjs')];
const receipt = { runId, runRoot, evidenceId, temporaryId, stage, argv, startedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch };
await writeFile(join(runRoot,'reports/producer.json'),JSON.stringify(receipt,null,2));
const log = createWriteStream(join(runRoot,'logs/command.log'), {flags:'wx'});
let result;
try {
  const child = spawn(process.execPath,argv,{ cwd: stage==='unit'?join(runRoot,'temporary'):project, env:{...process.env,CATALOG_RUN_ROOT:runRoot}, windowsHide:true, stdio:['ignore','pipe','pipe'] });
  receipt.pid=child.pid; child.stdout.pipe(log,{end:false}); child.stderr.pipe(log,{end:false});
  result=await new Promise((done,reject)=>{ child.once('error',reject);child.once('exit',(exitCode,signal)=>done({exitCode,signal})); });
} catch(error) { result={exitCode:null,error:error.message}; }
await new Promise(done=>log.end(done));
const state = result.exitCode===0?'complete':'failed';
lifecycle.recordLifecycle(project,{...temporary,state,membership_complete:true});
lifecycle.recordLifecycle(project,{...evidence,state,membership_complete:true});
await writeFile(join(runRoot,'reports/result.json'),JSON.stringify({...receipt,...result,endedAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({runRoot,evidenceId,temporaryId,...result}));
if(result.exitCode!==0){ const lines=(await readFile(join(runRoot,'logs/command.log'),'utf8')).split('\n');console.error(lines.slice(-32).join('\n')); }
process.exitCode=result.exitCode??1;
