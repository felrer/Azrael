import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import lifecycle from '../../scripts/artifact-lifecycle.cjs';
const retained = JSON.parse(readFileSync(resolve('work/DJ-01-azrael-memory-analysis/evidence/real-history-retention.json'), 'utf8'));
const [command, id] = process.argv.slice(2);
if (command === 'requests') console.log(JSON.stringify(retained.requests));
else if (command === 'finalize') {
  assert(retained.requests.some(r => r.id === id));
  console.log(JSON.stringify(lifecycle.finalize(resolve('.m'), id)));
} else throw Error('explicit cleanup helper operation required');
