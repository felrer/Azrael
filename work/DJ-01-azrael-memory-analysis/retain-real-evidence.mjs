import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import lifecycle from '../../scripts/artifact-lifecycle.cjs';
const root = resolve('.m'), work = resolve('work/DJ-01-azrael-memory-analysis');
const wanted = new Set(['real-snapshot-unit-r12', 'real-snapshot-unit-r13', 'real-snapshot-unit-r14',
  'real-history-r11', 'real-history-r12', 'real-history-r13', 'real-history-r14', 'real-history-r16']);
const records = lifecycle.catalog(root).filter(r => wanted.has(r.id.split(':').at(-1)));
assert.equal(records.length, wanted.size, 'all expected owned runs must be present');
const copied = [], requests = [];
for (const record of records) {
  assert(['complete', 'failed'].includes(record.state), 'only stopped complete/failed runs may proceed');
  assert.equal(record.membership_complete, true);
  assert.equal(record.references.length, 0, 'consumer execution references must be released');
  const name = record.id.split(':').at(-1), reports = join(root, 'artifacts/tasks/DJ-01/runs', name, 'reports');
  const target = join(work, 'evidence', name); mkdirSync(target, { recursive: true });
  for (const file of readdirSync(reports)) {
    if (!/^(report|result|producer|snapshot-manifest)\.json$|^samples\.jsonl$|-(continuous\.jsonl|guard\.json)$/.test(file)) continue;
    const source = join(reports, file), bytes = readFileSync(source);
    // Numeric/identifier-only reports created by the diagnostic drivers.
    if (file.endsWith('.jsonl')) for (const line of bytes.toString('utf8').trim().split(/\r?\n/).filter(Boolean)) JSON.parse(line);
    else JSON.parse(bytes.toString('utf8'));
    copyFileSync(source, join(target, file));
    copied.push({ run: name, file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const { operation, ...request } = lifecycle.registerRequest(root, record.id);
  requests.push({ id: record.id, request });
}
for (const file of ['real-session-memory-probe.mjs', 'real-history-snapshot.mjs']) copyFileSync(join(work, file), join(work, 'evidence/real-history-r16', file));
const target = join(work, 'evidence/real-history-retention.json');
writeFileSync(target, JSON.stringify({ atUtc: new Date().toISOString(), copied, requests }, null, 2));
console.log(JSON.stringify({ groups: requests.map(r => r.id), copiedFiles: copied.length, target }));
