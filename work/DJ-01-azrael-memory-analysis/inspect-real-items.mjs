import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const work = resolve('work/DJ-01-azrael-memory-analysis');
const report = JSON.parse(readFileSync(join(work, 'evidence/real-history-r16/report.json'), 'utf8'));
if (!report.producerStopped || report.status !== 'complete') throw Error('completed stopped probe required');
const db = new DatabaseSync(join(report.home, 'thread_history_1.sqlite'), { readOnly: true });
try {
  const threads = report.snapshot.threads.map(t => ({ id: t.id,
    ...db.prepare('SELECT count(*) AS count,max(length(CAST(item_json AS BLOB))) AS maxItemBytes,sum(CASE WHEN length(CAST(item_json AS BLOB))>1048576 THEN 1 ELSE 0 END) AS over1MiBItems FROM thread_items WHERE thread_id=?').get(t.id),
    types: db.prepare('SELECT item_type AS type,count(*) AS count,max(length(CAST(item_json AS BLOB))) AS maxItemBytes,sum(length(CAST(item_json AS BLOB))) AS bytes FROM thread_items WHERE thread_id=? GROUP BY item_type ORDER BY maxItemBytes DESC').all(t.id) }));
  const mode = report.modes[0];
  const projection = mode.beforeProjection.map((before, i) => ({ id: before.id,
    beforeVersion: before.projection.projection_version, afterVersion: mode.afterProjection[i].projection.projection_version,
    beforeItems: before.itemCount, afterItems: mode.afterProjection[i].itemCount }));
  const result = { threads, projection, pagedReads: mode.pagedReads, fullReads: mode.reads,
    note: 'Aggregate bytes from the stopped isolated projection; no item bodies retained.' };
  writeFileSync(join(work, 'evidence/real-history-r16/item-size-analysis.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ threads: threads.map(t => ({ id: t.id, count: t.count, maxItemMiB: t.maxItemBytes / 1048576,
    over1MiBItems: t.over1MiBItems, largestType: t.types[0].type })), projection,
    paged: mode.pagedReads.map(r => ({ id: r.id, pages: r.pageCount, count: r.itemCount, delta: r.itemDelta })),
    full: mode.reads.map(r => ({ id: r.id, turns: r.turnCount, items: r.itemCount, delta: r.comparison.itemDelta })) }));
} finally { db.close(); }
