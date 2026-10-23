// Task-only snapshot. Source databases are opened read-only; message payloads
// remain in the registered temporary profile, never in this module's output.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, open, stat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve, relative, isAbsolute, dirname, basename } from 'node:path';

const quote = value => '"' + value.replaceAll('"', '""') + '"';
const plainPath = value => value.startsWith('\\\\?\\') ? value.slice(4) : value;
const inside = (root, path) => { const r = relative(root, path); return r !== '..' && !r.startsWith('..\\') && !r.startsWith('../') && !isAbsolute(r); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function firstRecord(path) {
  const fd = await open(path, 'r');
  try {
    const chunks = []; let offset = 0;
    while (offset < 16 * 1024 ** 2) {
      const b = Buffer.alloc(64 * 1024), { bytesRead } = await fd.read(b, 0, b.length, offset);
      assert(bytesRead > 0, 'session metadata newline required');
      const end = b.subarray(0, bytesRead).indexOf(10);
      chunks.push(b.subarray(0, end >= 0 ? end : bytesRead));
      if (end >= 0) return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      offset += bytesRead;
    }
    throw Error('session metadata exceeds bounded read');
  } finally { await fd.close(); }
}

function cloneSubset(source, destination, selectedIds, tableKeys) {
  const db = new DatabaseSync(destination);
  try {
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=OFF; BEGIN');
    const objects = source.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END").all();
    for (const entry of objects.filter(x => x.type === 'table')) db.exec(entry.sql);
    const counts = {};
    for (const entry of objects.filter(x => x.type === 'table')) {
      const name = entry.name;
      if (name !== '_sqlx_migrations' && !Object.hasOwn(tableKeys, name)) continue;
      const columns = source.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c => c.name);
      const insert = db.prepare(`INSERT INTO ${quote(name)} (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
      const where = name === '_sqlx_migrations' ? '' : ` WHERE ${quote(tableKeys[name])} IN (${selectedIds.map(() => '?').join(',')})`;
      const rows = source.prepare(`SELECT * FROM ${quote(name)}${where}`);
      let count = 0;
      for (const row of rows.iterate(...(where ? selectedIds : []))) { insert.run(...columns.map(c => row[c])); count++; }
      counts[name] = count;
    }
    for (const entry of objects.filter(x => ['index', 'trigger', 'view'].includes(x.type))) db.exec(entry.sql);
    const userVersion = source.prepare('PRAGMA user_version').get().user_version;
    db.exec(`PRAGMA user_version=${Number(userVersion)}; COMMIT`);
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    return counts;
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  finally { db.close(); }
}

async function completeRolloutBytes(sourcePath) {
  const fd = await open(sourcePath, 'r');
  try {
    let end = (await fd.stat()).size;
    const block = Buffer.alloc(65536);
    while (end > 0) {
      const start = Math.max(0, end - block.length);
      const { bytesRead } = await fd.read(block, 0, end - start, start);
      const last = block.subarray(0, bytesRead).lastIndexOf(10);
      if (last >= 0) return start + last + 1;
      end = start;
    }
    throw new Error('source rollout has no complete record');
  } finally { await fd.close(); }
}

async function copyProjectedPrefix(sourcePath, target, bytes) {
  assert(bytes > 0 && Number.isSafeInteger(bytes));
  const fd = await open(sourcePath, 'r');
  try {
    const s = await fd.stat(); assert(s.size >= bytes, 'projection offset exceeds source rollout');
    const tail = Buffer.alloc(1); await fd.read(tail, 0, 1, bytes - 1);
    assert.equal(tail[0], 10, 'projection offset must end at a complete JSONL record');
  await mkdir(dirname(target), { recursive: true });
  const h = createHash('sha256'); let copied = 0;
  const tap = new Transform({ transform(chunk, _encoding, done) { h.update(chunk); copied += chunk.length; done(null, chunk); } });
  await pipeline(fd.createReadStream({ start: 0, end: bytes - 1, autoClose: false }), tap, fs.createWriteStream(target, { flags: 'wx' }));
  const after = await fd.stat(), current = await stat(sourcePath);
  assert(after.size >= bytes && current.ino === after.ino && current.dev === after.dev,
    'source rollout identity must remain stable during copy');
  assert.equal(copied, bytes);
  const sourcePrefixSha256 = h.digest('hex');
  const verify = createHash('sha256'); for await (const chunk of fs.createReadStream(target)) verify.update(chunk);
  assert.equal(verify.digest('hex'), sourcePrefixSha256);
  return { copiedBytes: bytes, sha256: sourcePrefixSha256 };
  } finally { await fd.close(); }
}

async function classifyRollout(path) {
  const counts = {}, bytesByType = {}; let lines = 0, maxLineBytes = 0, compactedRecords = 0, classifiedBytes = 0;
  let latestUsableCompaction = null;
  const input = fs.createReadStream(path);
  const reader = createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line) continue;
    const length = Buffer.byteLength(line) + 1, record = JSON.parse(line);
    const type = String(record.type);
    const nestedType = record.payload?.type;
    const key = nestedType ? `${type}/${nestedType}` : type;
    counts[key] = (counts[key] ?? 0) + 1; bytesByType[key] = (bytesByType[key] ?? 0) + length;
    lines++; maxLineBytes = Math.max(maxLineBytes, length);
    if (type === 'compacted') compactedRecords++;
    if (type === 'compacted' && Array.isArray(record.payload?.replacement_history) && record.payload.window_number != null) {
      latestUsableCompaction = { recordOrdinal: lines - 1, classifiedByteOffset: classifiedBytes,
        replacementItems: record.payload.replacement_history.length,
        replacementJsonBytes: Buffer.byteLength(JSON.stringify(record.payload.replacement_history)) };
    }
    classifiedBytes += length;
  }
  return { records: lines, maxLineBytes, compactedRecords, counts, bytesByType, classifiedBytes,
    latestUsableCompaction, rawBytesFromLatestUsableCompaction: classifiedBytes - (latestUsableCompaction?.classifiedByteOffset ?? 0),
    note: 'Raw JSONL/type byte counts and compaction suffix are descriptors, not decoded heap sizes; CRLF can add unclassified carriage returns' };
}

export async function createRealHistorySnapshot({ sourceHome, home, cwd, recommendedId, maxThreads = 6 }) {
  assert(uuid.test(recommendedId)); assert(maxThreads >= 1 && maxThreads <= 10);
  sourceHome = await realpath(sourceHome); home = await realpath(home);
  assert(!inside(sourceHome, home) && !inside(home, sourceHome), 'source and fixture must be independent');
  const sessions = await realpath(join(sourceHome, 'sessions'));
  const metadataDb = new DatabaseSync(join(sourceHome, 'state_5.sqlite'), { readOnly: true });
  const historyDb = new DatabaseSync(join(sourceHome, 'thread_history_1.sqlite'), { readOnly: true });
  const began = new Date().toISOString(); let selected;
  try {
    // Each database has its own consistent read transaction. There is no claim
    // of a cross-database atomic snapshot; the history checkpoint owns log prefix.
    metadataDb.exec('BEGIN'); historyDb.exec('BEGIN');
    const candidates = [];
    for (const row of metadataDb.prepare("SELECT id,rollout_path,history_mode,model_provider FROM threads WHERE history_mode='paginated' AND model_provider='openai'").iterate()) {
      if (!uuid.test(row.id)) continue;
      const path = plainPath(row.rollout_path);
      if (!inside(sessions, resolve(path)) || !basename(path).endsWith(`-${row.id}.jsonl`)) continue;
      try { const size = (await stat(path)).size; candidates.push({ ...row, sourcePath: path, size }); } catch { /* missing state rows are not copied */ }
    }
    candidates.sort((a, b) => Number(b.id === recommendedId) - Number(a.id === recommendedId) || b.size - a.size);
    selected = [];
    for (const row of candidates) {
      const path = await realpath(row.sourcePath); assert(inside(sessions, path), 'source rollout escaped session root');
      const meta = await firstRecord(path), data = meta.payload;
      if (meta.type !== 'session_meta' || data?.id !== row.id || data.history_mode !== 'paginated') continue;
      if (data.history_base || data.forked_from_id || data.parent_thread_id || typeof data.source !== 'string' || data.source !== 'vscode') continue;
      if (data.agent_path && data.agent_path !== '/root') continue;
      const projection = historyDb.prepare('SELECT * FROM thread_history_projection_state WHERE thread_id=?').get(row.id);
      if (!projection?.next_rollout_byte_offset) continue;
      assert(Number.isInteger(projection.projection_version) && projection.projection_version >= 1 && projection.projection_version <= 5,
        'captured projection version must not be newer than installed version5');
      const turnCount = historyDb.prepare('SELECT count(*) AS n FROM thread_turns WHERE thread_id=?').get(row.id).n;
      const item = historyDb.prepare('SELECT count(*) AS n, coalesce(sum(length(CAST(item_json AS BLOB))),0) AS bytes, max(length(CAST(item_json AS BLOB))) AS maxBytes FROM thread_items WHERE thread_id=?').get(row.id);
      const byItemType = historyDb.prepare('SELECT item_type AS type,count(*) AS count,sum(length(CAST(item_json AS BLOB))) AS bytes FROM thread_items WHERE thread_id=? GROUP BY item_type').all(row.id);
      const realtimeCount = historyDb.prepare('SELECT count(*) AS n FROM thread_realtime_items WHERE thread_id=?').get(row.id).n;
      const rolloutBytes = projection.projection_version < 5 ? await completeRolloutBytes(path) : projection.next_rollout_byte_offset;
      assert(rolloutBytes >= projection.next_rollout_byte_offset, 'complete rollout must contain captured checkpoint');
      selected.push({ id: row.id, label: row.id === recommendedId ? 'recommended' : `long-${selected.length}`, sourcePath: path,
        rolloutPath: join(home, 'sessions', relative(sessions, path)), rolloutBytes,
        sourceBytesAtSelection: row.size, projection, turnCount, itemCount: item.n, itemBytes: item.bytes, maxItemBytes: item.maxBytes, byItemType, realtimeCount });
      if (selected.length === maxThreads) break;
    }
    assert.equal(selected[0]?.id, recommendedId, 'recommended independent paginated session required');
    assert(selected.length >= Math.min(4, maxThreads), 'at least four independent histories required');
    const ids = selected.map(s => s.id);
    const stateCounts = cloneSubset(metadataDb, join(home, 'state_5.sqlite'), ids, { threads: 'id', thread_dynamic_tools: 'thread_id' });
    const historyCounts = cloneSubset(historyDb, join(home, 'thread_history_1.sqlite'), ids, {
      thread_turns: 'thread_id', thread_items: 'thread_id', thread_history_projection_state: 'thread_id', thread_realtime_items: 'thread_id' });
    assert.equal(stateCounts.threads, selected.length);
    assert.equal(historyCounts.thread_turns, selected.reduce((n, s) => n + s.turnCount, 0));
    assert.equal(historyCounts.thread_items, selected.reduce((n, s) => n + s.itemCount, 0));
    const copyDb = new DatabaseSync(join(home, 'state_5.sqlite'));
    try {
      const update = copyDb.prepare('UPDATE threads SET rollout_path=?,cwd=?,sandbox_policy=?,approval_mode=?,project_id=NULL,thread_section_id=NULL WHERE id=?');
      for (const item of selected) update.run(item.rolloutPath, cwd, JSON.stringify({ type: 'read-only' }), 'never', item.id);
      const rows = copyDb.prepare('SELECT id,rollout_path FROM threads').all();
      assert.equal(rows.length, selected.length); for (const row of rows) assert(inside(home, resolve(row.rollout_path)));
    } finally { copyDb.close(); }
    const verifyDb = new DatabaseSync(join(home, 'thread_history_1.sqlite'), { readOnly: true });
    try {
      for (const item of selected) {
        assert.deepEqual(verifyDb.prepare('SELECT * FROM thread_history_projection_state WHERE thread_id=?').get(item.id), item.projection);
        assert.equal(verifyDb.prepare('SELECT count(*) AS n FROM thread_realtime_items WHERE thread_id=?').get(item.id).n, item.realtimeCount);
        assert.deepEqual(verifyDb.prepare('SELECT item_type AS type,count(*) AS count,sum(length(CAST(item_json AS BLOB))) AS bytes FROM thread_items WHERE thread_id=? GROUP BY item_type').all(item.id), item.byItemType);
      }
    } finally { verifyDb.close(); }
    for (const item of selected) item.copy = await copyProjectedPrefix(item.sourcePath, item.rolloutPath, item.rolloutBytes);
    metadataDb.exec('COMMIT'); historyDb.exec('COMMIT');
    // Large message data is no longer held under source database transactions.
    for (const item of selected) item.rollout = await classifyRollout(item.rolloutPath);
    return { schema: 1, sourceHome, home, snapshotBeganUtc: began, snapshotEndedUtc: new Date().toISOString(),
      stateCounts, historyCounts, threads: selected,
      sourcePolicy: 'Read-only SQLite connections; separate per-database read transactions; v5 exact checkpoint prefix, older versions complete captured JSONL EOF for lazy rebuild; no auth/config/reservations copied',
      alterations: ['Snapshot state rollout_path and cwd point to isolated profile/workspace', 'Snapshot state sandbox read-only and approval never; payload/history mode unchanged', 'Snapshot project/section foreign keys cleared; no source project or live scheduling state copied'],
      aggregate: { threads: selected.length, rolloutBytes: selected.reduce((n, s) => n + s.rolloutBytes, 0),
        turns: selected.reduce((n, s) => n + s.turnCount, 0), items: selected.reduce((n, s) => n + s.itemCount, 0), itemBytes: selected.reduce((n, s) => n + s.itemBytes, 0) } };
  } catch (error) {
    if (error?.name === 'AssertionError') {
      // All assertion messages in this helper are fixed source-code text.
      // Preserve the causal check without exposing history payloads.
      error.snapshotAssertion = error.message;
    }
    throw error;
  } finally { metadataDb.close(); historyDb.close(); }
}
