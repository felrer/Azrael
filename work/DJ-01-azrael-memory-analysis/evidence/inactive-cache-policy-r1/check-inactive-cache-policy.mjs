import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import artifacts from '../../scripts/artifact-run.cjs';

const asset = join(process.env.USERPROFILE, '.vscode/extensions/azrael-ex-local.azrael-2026.0.11/webview/assets/app-initial-97d3534ad35f.js');
const source = readFileSync(asset, 'utf8');
const anchor = 'getInactiveOwnerConversationIdsToUnsubscribe(e){';
const endAnchor = 'shouldKeepConversationLoaded(e){';
const start = source.indexOf(anchor), end = source.indexOf(endAnchor, start);
assert(start >= 0 && end > start && source.indexOf(anchor, start + 1) === -1);
assert(source.includes('H$=108e5,cwn=15e3,lwn=10,uwn=class{'));
const method = source.slice(start, end);
assert(method.length < 2000);
const run = artifacts.beginArtifactRun(resolve('.m'), { workId: 'DJ-01', runId: 'inactive-cache-policy-r1', owner: 'inactive-cache-policy-analysis' });
let success = false;
try {
  const parsed = vm.runInNewContext(`({${method}})`, { H$: 108e5, lwn: 10, V$: c => c.ephemeral === true && c.sideConversation === true }, { timeout: 100 });
  const now = 20 * 60 * 60 * 1000;
  const cases = [];
  function check(name, count, ageMs, flags, expected) {
    const conversations = Array.from({ length: count }, (_, i) => ({ id: `fixture-${i}`, resumeState: 'resumed', ...flags }));
    const context = {
      inactiveOwnerConversationSinceById: new Map(conversations.map((c, i) => [c.id, now - ageMs + i])),
      inactiveOwnerConversationRetryAtById: new Map(), unsubscribingConversationIds: new Set(),
      params: { threadStore: { getConversation: id => conversations.find(c => c.id === id) }, streamState: { ownsConversationHistoryStream: () => true }, logger: { debug() {} } },
      hasActiveConversationView: () => flags.activeView === true,
      hasOwnedStreamFollowers: () => flags.followers === true,
      shouldKeepConversationLoaded: () => flags.protectedWork === true,
    };
    const actual = parsed.getInactiveOwnerConversationIdsToUnsubscribe.call(context, now);
    assert.equal(actual.length, expected, name);
    if (expected === 1) assert.equal(actual[0], 'fixture-0');
    cases.push({ name, count, ageMs, expected, actual: actual.length });
  }
  check('ten idle owner conversations after one hour', 10, 3600000, {}, 0);
  check('eleven idle owner conversations retire oldest', 11, 3600000, {}, 1);
  check('ten idle owner conversations expire after three hours', 10, 10800000 + 100, {}, 10);
  check('active views remain excluded after TTL', 11, 10800000 + 100, { activeView: true }, 0);
  check('work protection remains excluded after TTL', 11, 10800000 + 100, { protectedWork: true }, 0);
  check('stream followers remain excluded after TTL', 11, 10800000 + 100, { followers: true }, 0);
  check('ephemeral side conversations excluded from ordinary count cap', 11, 3600000, { ephemeral: true, sideConversation: true }, 0);
  const report = { scope: 'Extracted installed UI candidate-selection method only; synthetic states. No UI, profile, RPC or inference execution.', asset, assetSha256: createHash('sha256').update(source).digest('hex'), startCharacterOffset: start, endCharacterOffset: end, ttlMs: 108e5, maxInactiveOrdinaryOwners: 10, cases, limitations: ['Eligibility and protection helpers are controlled fixture inputs, not full UI integration', 'No RAM saving is measured', 'No real conversation body or profile is read'] };
  writeFileSync(join(run.reports, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ cases: cases.length, passed: true, reports: run.reports }));
  success = true;
} finally {
  artifacts.finishArtifactRun(run, { exitCode: success ? 0 : 1, producerStopped: true });
}
