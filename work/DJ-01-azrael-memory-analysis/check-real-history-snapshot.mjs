import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import artifacts from '../../scripts/artifact-run.cjs';
import { createRealHistorySnapshot } from './real-history-snapshot.mjs';

const control = resolve('.m');
const runId = process.argv[2] ?? 'real-snapshot-unit-r11';
assert(/^real-snapshot-unit-r[0-9]+$/.test(runId));
const run = artifacts.beginArtifactRun(control, { workId: 'DJ-01', runId, owner: 'real-history-snapshot-check' });
let ok = false;
try {
  const sourceHome = join(run.temporary, 'source'), home = join(run.temporary, 'copy'), cwd = join(run.temporary, 'workspace');
  for (const path of [sourceHome, home, cwd, join(sourceHome, 'sessions')]) await mkdir(path, { recursive: true });
  const state = new DatabaseSync(join(sourceHome, 'state_5.sqlite'));
  const history = new DatabaseSync(join(sourceHome, 'thread_history_1.sqlite'));
  state.exec('CREATE TABLE _sqlx_migrations(version INTEGER PRIMARY KEY, checksum BLOB); CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT,history_mode TEXT,model_provider TEXT,cwd TEXT,sandbox_policy TEXT,approval_mode TEXT,project_id TEXT,thread_section_id TEXT); CREATE TABLE thread_dynamic_tools(thread_id TEXT,name TEXT)');
  history.exec('CREATE TABLE _sqlx_migrations(version INTEGER PRIMARY KEY, checksum BLOB); CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT); CREATE TABLE thread_items(thread_id TEXT,item_type TEXT,item_json TEXT); CREATE TABLE thread_realtime_items(thread_id TEXT,item_id TEXT); CREATE TABLE thread_history_projection_state(thread_id TEXT PRIMARY KEY,next_rollout_byte_offset INTEGER,next_rollout_ordinal INTEGER,projection_version INTEGER)');
  state.prepare('INSERT INTO _sqlx_migrations VALUES(1,?)').run(Buffer.from([1, 2, 3]));
  history.prepare('INSERT INTO _sqlx_migrations VALUES(1,?)').run(Buffer.from([4, 5, 6]));
  const ids = [];
  for (let i = 1; i <= 4; i++) {
    const id = `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`; ids.push(id);
    const path = join(sourceHome, 'sessions', `rollout-2026-10-23T01-00-0${i}-${id}.jsonl`);
    const data = JSON.stringify({ type: 'session_meta', payload: { id, history_mode: 'paginated', source: 'vscode', agent_path: '/root' } }) + '\n';
    await writeFile(path, data + (i > 1 ? JSON.stringify({ type: 'event_msg', payload: { type: 'fixtureTail' } }) + '\n' : ''));
    state.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?)').run(id, path, 'paginated', 'openai', cwd, '{}', 'never', 'old-project', 'old-section');
    history.prepare('INSERT INTO thread_turns VALUES(?,?)').run(id, 'turn1');
    history.prepare('INSERT INTO thread_items VALUES(?,?,?)').run(id, 'userMessage', JSON.stringify({ type: 'userMessage', content: 'fixture' }));
    history.prepare('INSERT INTO thread_history_projection_state VALUES(?,?,?,?)').run(id, Buffer.byteLength(data), 1, i === 1 ? 5 : 3);
  }
  state.close(); history.close();
  const manifest = await createRealHistorySnapshot({ sourceHome, home, cwd, recommendedId: ids[0], maxThreads: 4 });
  assert.equal(manifest.threads.length, 4); assert.equal(manifest.aggregate.items, 4); assert.equal(manifest.aggregate.turns, 4);
  assert(manifest.threads.every(t => t.rollout.records === (t.projection.projection_version === 5 ? 1 : 2) && t.rollout.rawBytesFromLatestUsableCompaction === t.rolloutBytes));
  assert.equal(manifest.threads.filter(t => t.projection.projection_version === 3 && t.rolloutBytes > t.projection.next_rollout_byte_offset).length, 3);
  const copy = new DatabaseSync(join(home, 'state_5.sqlite'), { readOnly: true });
  assert(copy.prepare('SELECT * FROM threads').all().every(row => row.project_id === null && row.thread_section_id === null && row.rollout_path.startsWith(home)));
  copy.close();
  await writeFile(join(run.reports, 'result.json'), JSON.stringify({ status: 'passed', checks: ['read-only source', 'schema/checksum BLOB cloning', 'exact checkpoint/prefix', 'four selected IDs/counts/types', 'fixture-only paths', 'project/section isolation'], sourceHome, home }, null, 2));
  ok = true;
} finally { artifacts.finishArtifactRun(run, { exitCode: ok ? 0 : 1, producerStopped: true }); }
