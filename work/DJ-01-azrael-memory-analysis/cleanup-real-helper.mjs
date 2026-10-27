import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import lifecycle from '../../scripts/artifact-lifecycle.cjs';
const retained = JSON.parse(readFileSync(resolve('work/DJ-01-azrael-memory-analysis/evidence/real-history-retention.json'), 'utf8'));
const [command, id] = process.argv.slice(2);
const allowed = retained.requests.some(r => r.id === id) || ['run:DJ-01:multi-window-observe-r1', 'run:DJ-01:multi-window-observe-r2', 'run:DJ-01:inactive-cache-policy-r1'].includes(id);
if (command === 'requests') console.log(JSON.stringify(retained.requests));
else if (command === 'request') { assert(allowed); console.log(JSON.stringify(lifecycle.registerRequest(resolve('.m'), id))); }
else if (command === 'finalize') {
  assert(allowed);
  console.log(JSON.stringify(lifecycle.finalize(resolve('.m'), id)));
} else throw Error('explicit cleanup helper operation required');
