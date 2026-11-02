#!/usr/bin/env node
'use strict';

// Development workflow metadata; this tool never applies upstream code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, execFile } = require('node:child_process');
const { parseArgs, promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_LEDGER = 'scripts/codex-upstream-review.json';
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const DECISIONS = ['unreviewed', 'selected', 'equivalent', 'excluded', 'deferred'];
const SCOPES = ['source', 'native', 'package', 'installed'];
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
function need(condition, message) { if (!condition) throw new Error(message); }
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function timestamp(value) { return text(value) && Number.isFinite(Date.parse(value)); }
function refs(values) {
  return Array.isArray(values) && values.every((r) => r && text(r.path) && HASH.test(r.sha256) &&
    (r.gitCommit === undefined || SHA.test(r.gitCommit)));
}
function strings(values) { return Array.isArray(values) && values.every(text) && new Set(values).size === values.length; }

function createLedger() {
  return { schema: 1, repository: 'openai/codex', branch: 'main',
    baseline: { baseTag: 'rust-v0.162.0', priorCoverage: 'unknown' }, entries: {}, ranges: [] };
}
function newEntry(id, metadata) {
  return { id, ...metadata,
    decision: { status: 'unreviewed', reason: '', evidence: [], dependsOn: [], retryWhen: null },
    implementation: { status: 'none', localCommits: [], featureIds: [], evidence: [], verification: null } };
}
function dependenciesReady(ledger, entry, seen = new Set()) {
  if (seen.has(entry.id)) return false;
  const chain = new Set([...seen, entry.id]);
  return entry.decision.dependsOn.every((id) => {
    const dep = ledger.entries[id];
    return dep && (dep.decision.status === 'equivalent' ||
      (dep.decision.status === 'selected' && dep.implementation.status === 'verified')) && dependenciesReady(ledger, dep, chain);
  });
}
function validateLedger(ledger) {
  need(ledger?.schema === 1 && ledger.repository === 'openai/codex' && text(ledger.branch), 'Unsupported ledger repository/schema/branch');
  need(ledger.baseline?.priorCoverage === 'unknown' && text(ledger.baseline.baseTag), 'Historical coverage must remain explicitly unknown');
  need(ledger.entries && typeof ledger.entries === 'object' && !Array.isArray(ledger.entries) && Array.isArray(ledger.ranges), 'Malformed ledger collections');
  for (const [id, entry] of Object.entries(ledger.entries)) {
    need(entry?.id === id && ['pr', 'commit'].includes(entry.kind), `Malformed entry ${id}`);
    need(entry.kind === 'pr' ? Number.isSafeInteger(entry.number) && entry.number > 0 && id === `pr:${entry.number}` && SHA.test(entry.mergeCommit)
      : id === `commit:${entry.commits?.[0]}` && entry.commits?.length === 1, `Malformed identity ${id}`);
    need(text(entry.title) && text(entry.url) && strings(entry.commits) && entry.commits.length > 0 && entry.commits.every((s) => SHA.test(s)), `Malformed commit metadata ${id}`);
    const d = entry.decision;
    need(d && DECISIONS.includes(d.status) && strings(d.dependsOn) && refs(d.evidence), `Malformed decision ${id}`);
    need(d.dependsOn.every((dep) => dep !== id && Object.hasOwn(ledger.entries, dep)), `Unknown/self dependency ${id}`);
    if (d.status !== 'unreviewed') need(text(d.reason) && d.evidence.length > 0, `Decision needs reason and evidence: ${id}`);
    if (d.status === 'deferred') need(text(d.retryWhen), `Deferred decision needs retryWhen: ${id}`);
    const imp = entry.implementation;
    need(imp && ['none', 'applied', 'verified'].includes(imp.status) && strings(imp.localCommits) &&
      imp.localCommits.every((s) => SHA.test(s)) && strings(imp.featureIds) && refs(imp.evidence), `Malformed implementation ${id}`);
    if (imp.status !== 'none') need(d.status === 'selected' && imp.localCommits.length > 0 && imp.featureIds.length > 0 && imp.evidence.length > 0, `Applied entry needs selected decision, commits, features and evidence: ${id}`);
    if (imp.status === 'verified') {
      const v = imp.verification;
      need(v && v.exitCode === 0 && text(v.platform) && SCOPES.includes(v.scope) && text(v.sourceIdentity) &&
        text(v.summary) && refs([v.evidence]), `Verified entry needs passing scoped verification: ${id}`);
      need(dependenciesReady(ledger, entry), `Unverified dependency for ${id}`);
    } else need(imp.verification === null, `Unverified entry cannot carry passing verification: ${id}`);
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    need(!visiting.has(id), `Dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    ledger.entries[id].decision.dependsOn.forEach(visit);
    visiting.delete(id); visited.add(id);
  }
  Object.keys(ledger.entries).forEach(visit);
  const rangeIds = new Set();
  const seenCommits = new Set();
  ledger.ranges.forEach((range, index) => {
    need(range && SHA.test(range.base) && SHA.test(range.head) && range.id === range.head && range.base !== range.head && !rangeIds.has(range.id), 'Malformed/duplicate range identity');
    rangeIds.add(range.id);
    need(index === 0 || range.base === ledger.ranges[index - 1].head, 'Range chain has a gap or reordered history');
    need(timestamp(range.collectedAt) && strings(range.commits) && range.commits.length > 0 && range.commits.every((s) => SHA.test(s)) &&
      range.commitCount === range.commits.length && range.commits.includes(range.head) && !range.commits.includes(range.base), 'Incomplete range commit inventory');
    for (const sha of range.commits) { need(!seenCommits.has(sha), 'Commit occurs in multiple ranges'); seenCommits.add(sha); }
    need(strings(range.items) && range.items.length > 0 && range.items.every((id) => Object.hasOwn(ledger.entries, id)), 'Range has missing/duplicate items');
    for (const sha of range.commits) need(range.items.some((id) => ledger.entries[id].commits.includes(sha)), `Unclassified commit ${sha}`);
    for (const id of range.items) need(ledger.entries[id].commits.some((sha) => range.commits.includes(sha)), `Unrelated range item ${id}`);
    need(range.reviewedAt === null || timestamp(range.reviewedAt), 'Malformed review completion time');
    need(range.acceptedAt === null || timestamp(range.acceptedAt), 'Malformed acceptance time');
    if (range.reviewedAt !== null) {
      need(index === 0 || ledger.ranges[index - 1].reviewedAt !== null, 'Review checkpoint skips an unfinished range');
      need(range.items.every((id) => ledger.entries[id].decision.status !== 'unreviewed'), 'Review checkpoint covers unreviewed items');
    }
    if (range.acceptedAt !== null) {
      need(range.reviewedAt !== null && (index === 0 || ledger.ranges[index - 1].acceptedAt !== null), 'Acceptance skips an unfinished range');
      need(range.items.every((id) => ledger.entries[id].decision.status !== 'selected' || ledger.entries[id].implementation.status === 'verified'), 'Selected changes have not passed verification');
      need(range.items.every((id) => !['selected', 'equivalent'].includes(ledger.entries[id].decision.status) ||
        dependenciesReady(ledger, ledger.entries[id])), 'Included change has unresolved dependencies');
    }
  });
  return ledger;
}

function addRange(ledger, collection) {
  validateLedger(ledger);
  const next = clone(ledger);
  need(collection.range.base !== collection.range.head, 'No new commits in range');
  need(!next.ranges.some((r) => r.id === collection.range.id), 'Range already collected');
  for (const [id, entry] of Object.entries(collection.entries)) {
    if (Object.hasOwn(next.entries, id)) {
      const old = next.entries[id];
      need(old.kind === entry.kind && old.mergeCommit === entry.mergeCommit, `Upstream identity changed: ${id}`);
      old.commits = [...new Set([...old.commits, ...entry.commits])];
    } else next.entries[id] = clone(entry);
  }
  next.ranges.push(clone(collection.range));
  return validateLedger(next);
}
function invalidateCheckpoints(ledger, id) {
  const first = ledger.ranges.findIndex((range) => range.items.includes(id));
  if (first >= 0) ledger.ranges.slice(first).forEach((r) => { r.reviewedAt = null; r.acceptedAt = null; });
}
function setDecision(ledger, id, decision) {
  validateLedger(ledger);
  need(Object.hasOwn(ledger.entries, id), `Unknown entry ${id}`);
  need(decision.status !== 'unreviewed', 'Use initial unreviewed state only during collection');
  const next = clone(ledger);
  next.entries[id].decision = clone(decision);
  // A new review must explicitly reconfirm any prior application evidence.
  next.entries[id].implementation = newEntry(id, {}).implementation;
  invalidateCheckpoints(next, id);
  return validateLedger(next);
}
function setImplementation(ledger, id, implementation) {
  validateLedger(ledger);
  need(Object.hasOwn(ledger.entries, id), `Unknown entry ${id}`);
  const next = clone(ledger);
  need(next.entries[id].decision.status === 'selected', 'Only selected changes can be applied');
  need(['applied', 'verified'].includes(implementation.status), 'Implementation must be applied or verified');
  next.entries[id].implementation = clone(implementation);
  const first = next.ranges.findIndex((r) => r.items.includes(id));
  if (first >= 0) next.ranges.slice(first).forEach((r) => { r.acceptedAt = null; });
  return validateLedger(next);
}
function finishRange(ledger, id, stage) {
  validateLedger(ledger);
  need(['reviewed', 'accepted'].includes(stage), 'Stage must be reviewed or accepted');
  const next = clone(ledger);
  const range = next.ranges.find((r) => r.id === id);
  need(range, `Unknown range ${id}`);
  range[stage === 'reviewed' ? 'reviewedAt' : 'acceptedAt'] = new Date().toISOString();
  return validateLedger(next);
}
function summarize(ledger) {
  validateLedger(ledger);
  const entries = Object.values(ledger.entries);
  const end = (field) => ledger.ranges.filter((r) => r[field] !== null).at(-1)?.head ?? null;
  return { repository: ledger.repository, branch: ledger.branch, priorCoverage: ledger.baseline.priorCoverage,
    rangeStart: ledger.ranges[0]?.base ?? null, collectedThrough: ledger.ranges.at(-1)?.head ?? null,
    reviewedThrough: end('reviewedAt'), acceptedThrough: end('acceptedAt'),
    unreviewed: entries.filter((e) => e.decision.status === 'unreviewed').map((e) => e.id),
    backlog: entries.filter((e) => e.decision.status === 'deferred').map((e) => e.id),
    selectedPending: entries.filter((e) => e.decision.status === 'selected' && e.implementation.status !== 'verified').map((e) => e.id),
    entries: entries.length, ranges: ledger.ranges.length };
}

async function ghApi(endpoint, paginate = false) {
  const args = ['api', '--hostname', 'github.com', '-H', 'Accept: application/vnd.github+json'];
  if (paginate) args.push('--paginate', '--slurp');
  args.push(endpoint);
  const result = await execFileAsync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    timeout: 180000, windowsHide: true });
  return JSON.parse(result.stdout);
}
async function collectRange({ repository, branch, base, head }, api = ghApi) {
  need(repository === 'openai/codex' && text(branch) && text(base) && text(head), 'Repository, branch, base and head are required');
  const prefix = `repos/${repository}`;
  const [baseInfo, headInfo] = await Promise.all([
    api(`${prefix}/commits/${encodeURIComponent(base)}`), api(`${prefix}/commits/${encodeURIComponent(head)}`),
  ]);
  const baseSha = baseInfo.sha, headSha = headInfo.sha;
  need(SHA.test(baseSha) && SHA.test(headSha), 'Could not pin commit identities');
  const pages = await api(`${prefix}/compare/${baseSha}...${headSha}?per_page=100`, true);
  need(Array.isArray(pages) && pages.length > 0, 'Missing comparison pages');
  const total = pages[0].total_commits;
  need(Number.isSafeInteger(total) && total >= 0, 'Missing comparison total');
  const commits = [];
  for (const page of pages) {
    need(['ahead', 'identical'].includes(page.status) && page.behind_by === 0 && page.base_commit?.sha === baseSha &&
      page.merge_base_commit?.sha === baseSha && page.total_commits === total && Array.isArray(page.commits),
    'Diverged, behind, inconsistent or incomplete upstream comparison');
    commits.push(...page.commits);
  }
  const shas = commits.map((c) => c.sha);
  need(shas.every((s) => SHA.test(s)) && new Set(shas).size === total && shas.length === total &&
    !shas.includes(baseSha) && (total === 0 ? baseSha === headSha : shas.includes(headSha)), 'Truncated or duplicate comparison commit inventory');
  const entries = {};
  // All API calls complete before the caller can publish any ledger change.
  let cursor = 0;
  async function associate() { while (cursor < commits.length) {
    const commit = commits[cursor++];
    const associations = await api(`${prefix}/commits/${commit.sha}/pulls?per_page=100`, true);
    need(Array.isArray(associations) && associations.length > 0 && associations.every(Array.isArray), 'Incomplete commit/PR association pages');
    const prs = associations.flat().filter((pr) => pr.merged_at && pr.base?.ref === branch &&
      pr.base?.repo?.full_name?.toLowerCase() === repository && shas.includes(pr.merge_commit_sha));
    if (!prs.length) {
      const id = `commit:${commit.sha}`;
      entries[id] = newEntry(id, { kind: 'commit', title: commit.commit?.message?.split('\n')[0] || commit.sha,
        url: `https://github.com/${repository}/commit/${commit.sha}`, commits: [commit.sha] });
    }
    for (const pr of prs) {
      const id = `pr:${pr.number}`;
      if (Object.hasOwn(entries, id)) entries[id].commits.push(commit.sha);
      else entries[id] = newEntry(id, { kind: 'pr', number: pr.number, mergeCommit: pr.merge_commit_sha,
        title: pr.title, url: pr.html_url, commits: [commit.sha] });
    }
  } }
  await Promise.all(Array.from({ length: Math.min(4, commits.length) }, associate));
  for (const entry of Object.values(entries)) entry.commits.sort((a, b) => shas.indexOf(a) - shas.indexOf(b));
  // API response timing must not affect stored item ordering.
  const orderedEntries = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b, 'en')));
  return { range: { id: headSha, base: baseSha, head: headSha, collectedAt: new Date().toISOString(),
    commitCount: total, commits: shas, items: Object.keys(orderedEntries), reviewedAt: null, acceptedAt: null }, entries: orderedEntries };
}

function containedFile(root, relative) {
  need(text(relative) && !path.isAbsolute(relative), 'Evidence/ledger path must be project-relative');
  const absolute = path.resolve(root, relative);
  const rel = path.relative(fs.realpathSync(root), fs.realpathSync(absolute));
  need(rel && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel) &&
    !rel.split(path.sep).includes('.git') && !fs.lstatSync(absolute).isSymbolicLink() && fs.statSync(absolute).isFile(), 'Path must be a contained regular project file');
  return absolute;
}
function evidenceBytes(root, ref) {
  if (ref.gitCommit !== undefined) {
    need(SHA.test(ref.gitCommit) && text(ref.path) && !path.isAbsolute(ref.path) && !ref.path.includes('\\') &&
      !ref.path.split('/').some((part) => part === '..' || part === '.' || part === '.git' || part === ''), 'Invalid Git evidence path/commit');
    return execFileSync('git', ['-C', root, 'show', `${ref.gitCommit}:${ref.path}`], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  }
  return fs.readFileSync(containedFile(root, ref.path));
}
function fileRef(root, relative, gitCommit) {
  need(text(relative), 'Evidence path is required');
  const ref = { path: relative.replaceAll('\\', '/'), ...(gitCommit ? { gitCommit } : {}) };
  return { ...ref, sha256: digest(evidenceBytes(root, ref)) };
}
function verifyEvidence(ledger, root) {
  const features = JSON.parse(fs.readFileSync(path.join(root, 'scripts/azrael-feature-contracts.json'), 'utf8'));
  const featureIds = new Set(features.features.map((f) => f.id));
  for (const entry of Object.values(ledger.entries)) {
    const evidence = [...entry.decision.evidence, ...entry.implementation.evidence];
    if (entry.implementation.verification) evidence.push(entry.implementation.verification.evidence);
    for (const ref of evidence) need(digest(evidenceBytes(root, ref)) === ref.sha256, `Evidence changed: ${ref.path}`);
    for (const id of entry.implementation.featureIds) need(featureIds.has(id), `Unknown preservation feature ${id}`);
    for (const commit of entry.implementation.localCommits) {
      execFileSync('git', ['-C', root, 'cat-file', '-e', `${commit}^{commit}`], { windowsHide: true, stdio: 'pipe' });
    }
  }
}
function readLedger(root, ledgerPath) {
  const absolute = containedFile(root, ledgerPath);
  const bytes = fs.readFileSync(absolute);
  return { ledger: validateLedger(JSON.parse(bytes)), revision: digest(bytes), absolute };
}
function writeLedger(root, ledgerPath, expected, next) {
  need(HASH.test(expected), 'Mutation requires --expect <revision from status>');
  validateLedger(next); verifyEvidence(next, root);
  const current = readLedger(root, ledgerPath);
  need(current.revision === expected, 'Ledger revision changed; read status and retry');
  const lockPath = `${current.absolute}.lock`;
  const lock = fs.openSync(lockPath, 'wx'); // No retry, stale-lock stealing or foreign cleanup.
  let temporary;
  try {
    need(readLedger(root, ledgerPath).revision === expected, 'Ledger changed while acquiring lock');
    temporary = `${current.absolute}.${crypto.randomUUID()}.tmp`;
    const output = `${JSON.stringify(next, null, 2)}\n`;
    fs.writeFileSync(temporary, output, { flag: 'wx' });
    need(readLedger(root, ledgerPath).revision === expected, 'Ledger changed before publication');
    fs.renameSync(temporary, current.absolute);
    temporary = undefined;
    return digest(output);
  } finally {
    // These exact protocol files belong to this live invocation only.
    try { if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
  }
}
const HELP = `Codex upstream review (no code application)
  node scripts/codex-upstream-review.cjs <command> [options]
Commands:
  status                         Show checkpoints, backlog and revision
  show --id ID                   Show stored PR/commit, decision and implementation
  check [--complete]             Validate identities/evidence; complete also rejects pending work
  collect [--base REF] [--head REF] [--preview]
                                 Pin and collect commits/PRs; base defaults to last collected head
  add --pr NUMBER                Add an older/out-of-range PR for review
  review --id ID --decision STATUS --reason TEXT --evidence PATH
         [--depends-on ID,ID] [--retry-when TEXT]
  record --id ID --state applied|verified --commits SHA,SHA --features ID,ID
         --evidence PATH [--platform NAME --scope source|native|package|installed
         --source IDENTITY --summary TEXT --exit-code 0]
  close --range SHA --stage reviewed|accepted
All writes require --expect REVISION. Paths are project-relative.
Options: --ledger PATH (default ${DEFAULT_LEDGER}), --help
Evidence can use --evidence-commit SHA to bind a committed file instead of live bytes.
First collection requires an explicit --base; prior coverage remains unknown.
Collection only discovers changes. Decisions, code changes and verification require review.`;
async function main(argv = process.argv.slice(2), root = ROOT) {
  const { values: v, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    help: { type: 'boolean' }, preview: { type: 'boolean' }, complete: { type: 'boolean' },
    ...Object.fromEntries(['ledger', 'expect', 'base', 'head', 'pr', 'id', 'decision', 'reason', 'evidence', 'depends-on', 'retry-when',
      'state', 'commits', 'features', 'platform', 'scope', 'source', 'summary', 'range', 'stage', 'exit-code', 'evidence-commit'].map((name) => [name, { type: 'string' }])),
  } });
  if (v.help || positionals.length === 0) { console.log(HELP); return; }
  need(positionals.length === 1, 'Exactly one command is required');
  const command = positionals[0], ledgerPath = v.ledger || DEFAULT_LEDGER;
  const original = readLedger(root, ledgerPath), ledger = original.ledger;
  let next;
  const csv = (value) => value ? value.split(',').map((s) => s.trim()) : [];
  if (command === 'status') { console.log(JSON.stringify({ revision: original.revision, ...summarize(ledger) }, null, 2)); return; }
  if (command === 'show') {
    need(Object.hasOwn(ledger.entries, v.id), `Unknown entry ${v.id}`);
    console.log(JSON.stringify(ledger.entries[v.id], null, 2)); return;
  }
  if (command === 'check') {
    verifyEvidence(ledger, root);
    const status = summarize(ledger);
    if (v.complete) need(status.unreviewed.length === 0 && status.selectedPending.length === 0 &&
      ledger.ranges.every((r) => r.acceptedAt !== null), 'Review or selected implementation is incomplete');
    console.log(JSON.stringify({ valid: true, revision: original.revision, ...status }, null, 2)); return;
  }
  need(v.preview && command === 'collect' || v.expect === original.revision, 'Writes require current --expect revision from status');
  if (command === 'collect') {
    const collection = await collectRange({ repository: ledger.repository, branch: ledger.branch,
      base: v.base || ledger.ranges.at(-1)?.head, head: v.head || ledger.branch });
    if (v.preview) { console.log(JSON.stringify(collection, null, 2)); return; }
    next = addRange(ledger, collection);
  } else if (command === 'add') {
    need(/^[1-9][0-9]*$/.test(v.pr || ''), '--pr must be a positive integer');
    const pr = await ghApi(`repos/${ledger.repository}/pulls/${v.pr}`);
    need(pr.merged_at && pr.base?.ref === ledger.branch && pr.base?.repo?.full_name?.toLowerCase() === ledger.repository && SHA.test(pr.merge_commit_sha), 'PR is not merged into the selected repository/branch');
    const id = `pr:${pr.number}`;
    need(!Object.hasOwn(ledger.entries, id), 'PR already recorded');
    next = clone(ledger);
    next.entries[id] = newEntry(id, { kind: 'pr', number: pr.number, mergeCommit: pr.merge_commit_sha,
      title: pr.title, url: pr.html_url, commits: [pr.merge_commit_sha] });
  } else if (command === 'review') {
    next = setDecision(ledger, v.id, { status: v.decision, reason: v.reason,
      evidence: [fileRef(root, v.evidence, v['evidence-commit'])], dependsOn: csv(v['depends-on']), retryWhen: v['retry-when'] || null });
  } else if (command === 'record') {
    const evidence = fileRef(root, v.evidence, v['evidence-commit']);
    if (v.state === 'verified') need(v['exit-code'] === '0', 'Verified recording requires explicit --exit-code 0 from actual execution');
    next = setImplementation(ledger, v.id, { status: v.state, localCommits: csv(v.commits), featureIds: csv(v.features), evidence: [evidence],
      verification: v.state === 'verified' ? { evidence, platform: v.platform, scope: v.scope,
        exitCode: 0, sourceIdentity: v.source, summary: v.summary } : null });
  } else if (command === 'close') next = finishRange(ledger, v.range, v.stage);
  else throw new Error(`Unknown command ${command}`);
  const revision = writeLedger(root, ledgerPath, v.expect, next);
  console.log(JSON.stringify({ revision, ...summarize(next) }, null, 2));
}
module.exports = { createLedger, newEntry, validateLedger, addRange, setDecision, setImplementation, finishRange,
  summarize, collectRange, ghApi, fileRef, verifyEvidence, readLedger, writeLedger, main };
if (require.main === module) main().catch((error) => { console.error(`Codex upstream review failed: ${error.message}`); process.exitCode = 1; });
