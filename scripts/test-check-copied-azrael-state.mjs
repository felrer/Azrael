import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const fixture = mkdtempSync(join(tmpdir(), 'az01-copied-state-'));
const logDir = resolve('artifacts/logs/az01-release');
const logFile = join(logDir, 'copied-state-mock.json');
const checker = resolve('scripts/check-copied-azrael-state.mjs');
const mock = `
const readline = require('node:readline');
readline.createInterface({input: process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  if (!message.id) return;
  const id = message.id;
  let result;
  switch (message.method) {
    case 'initialize': result = {}; break;
    case 'thread/list': result = message.params.cursor
      ? {data:[{id:'child',parentThreadId:'root',modelProvider:'openai'}],nextCursor:null}
      : {data:[{id:'root',parentThreadId:null,modelProvider:'openai'}],nextCursor:'next'}; break;
    case 'thread/read': case 'thread/resume': result = {thread:{id:message.params.threadId}}; break;
    case 'thread/queue/list': result = {data:[{id:'private-queued-input'}],nextCursor:null}; break;
    case 'thread/items/list': result = {data:[{item:{type:'contextCompaction',id:'private-item'}}],nextCursor:null}; break;
    default: process.stdout.write(JSON.stringify({id,error:{message:'unexpected method'}})+'\\n'); return;
  }
  process.stdout.write(JSON.stringify({id,result})+'\\n');
});
`;
try {
  // Node treats the first argument, "app-server", as this mock script in cwd.
  writeFileSync(join(fixture, 'app-server'), mock);
  writeFileSync(join(fixture, 'config.toml'), 'model = "synthetic"\n');
  writeFileSync(join(fixture, 'copy-state-localized.json'), '{"schema":1,"externalPaths":0}\n');
  const direct = spawnSync(process.execPath, ['app-server'], { cwd: fixture, input: '', encoding: 'utf8', timeout: 3000 });
  if (direct.status !== 0) throw new Error('mock process launch failed');
  const run = spawnSync(process.execPath, [checker, process.execPath, fixture], { encoding: 'utf8', timeout: 30000 });
  let result;
  try { result = JSON.parse(run.stdout.trim()); } catch { throw new Error('checker did not emit JSON'); }
  const expected = { pages: 2, threads: 2, sampled: 2, metadataRead: 2, resumed: 1, childReadOnly: 1, subagents: 1, queueItems: 1, compactions: 1 };
  if (run.status !== 0 || result.status !== 'passed' || Object.entries(expected).some(([key, value]) => result.counts[key] !== value)) {
    throw new Error(`mock acceptance mismatch: exit=${run.status}, status=${result.status}, counts=${JSON.stringify(result.counts)}, failures=${JSON.stringify(result.failures)}`);
  }
  if (run.stdout.includes('private-') || run.stderr.includes('private-')) throw new Error('mock private data leaked');
  mkdirSync(logDir, { recursive: true });
  writeFileSync(logFile, JSON.stringify({ check: 'synthetic copied state', exitCode: run.status, result }, null, 2) + '\n');
  process.stdout.write(`PASS ${logFile}\n`);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
