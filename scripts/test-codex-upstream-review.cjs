"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  createLedger, collectRange, addRange, setDecision, setImplementation,
  finishRange, validateLedger, summarize,
} = require("./codex-upstream-review.cjs");

// Retain these boundary checks against later workflow simplifications that drop
// collection coverage, old backlog, evidence, or separate review/acceptance gates.
const sha = value => value.toString(16).padStart(40, "0");
const evidence = [{ path: "docs/architecture/upstream-preservation.md", sha256: "a".repeat(64) }];
const decision = (status, extra = {}) => ({
  status, reason: "Compared the upstream change with the local owner.",
  evidence, dependsOn: [], retryWhen: null, ...extra,
});
const implementation = (status, extra = {}) => ({
  status, localCommits: [sha(900)], featureIds: ["engine.selected-upstream"], evidence,
  verification: status === "verified" ? {
    evidence: evidence[0], platform: "windows-x64", scope: "native", exitCode: 0,
    sourceIdentity: "selected source revision", summary: "Selected behavior check passed.",
  } : null,
  ...extra,
});

function collection(base, head, commitShas = [head]) {
  const entries = Object.fromEntries(commitShas.map(commit => [`commit:${commit}`, {
    id: `commit:${commit}`, kind: "commit", title: `Direct commit ${commit}`,
    url: `https://github.com/openai/codex/commit/${commit}`, commits: [commit],
    decision: { status: "unreviewed", reason: "", evidence: [], dependsOn: [], retryWhen: null },
    implementation: {
      status: "none", localCommits: [], featureIds: [], evidence: [], verification: null,
    },
  }]));
  return { range: {
    id: head, base, head, collectedAt: "2026-11-02T00:00:00.000Z",
    commitCount: commitShas.length, commits: commitShas, items: Object.keys(entries),
    reviewedAt: null, acceptedAt: null,
  }, entries };
}

function ledgerWith(...commits) {
  return addRange(createLedger(), collection(sha(0), commits.at(-1), commits));
}

function pr(number, mergeCommit, extra = {}) {
  return {
    number, title: `Upstream PR ${number}`, html_url: `https://github.com/openai/codex/pull/${number}`,
    merged_at: "2026-11-01T00:00:00Z", merge_commit_sha: mergeCommit,
    base: { ref: "main", repo: { full_name: "openai/codex" } }, ...extra,
  };
}

function apiFixture({ pages, pulls = {}, fail = null }) {
  return async (endpoint, paginate = false) => {
    if (fail && endpoint.includes(fail)) throw new Error("GitHub fixture unavailable");
    if (endpoint === "repos/openai/codex/commits/base") return { sha: sha(0) };
    if (endpoint === "repos/openai/codex/commits/head") return { sha: sha(3) };
    if (endpoint === `repos/openai/codex/compare/${sha(0)}...${sha(3)}?per_page=100`) {
      assert.equal(paginate, true, "complete comparison must request pagination");
      return pages;
    }
    const associated = endpoint.match(/^repos\/openai\/codex\/commits\/([a-f0-9]{40})\/pulls\?per_page=100$/);
    assert.ok(associated, `Unexpected API endpoint: ${endpoint}`);
    assert.equal(paginate, true, "associated PRs must request pagination");
    return pulls[associated[1]] || [[]];
  };
}

const comparePage = (commits, extra = {}) => ({
  status: "ahead", behind_by: 0, total_commits: 3,
  base_commit: { sha: sha(0) }, merge_base_commit: { sha: sha(0) },
  commits: commits.map(commit => ({ sha: commit, commit: { message: `Change ${commit}` } })),
  ...extra,
});
const rangeRequest = { repository: "openai/codex", branch: "main", base: "base", head: "head" };

test("collection covers every page, deduplicates PRs, and preserves unmatched direct commits", async () => {
  const matched = pr(7, sha(2));
  const result = await collectRange(rangeRequest, apiFixture({
    pages: [comparePage([sha(1)]), comparePage([sha(2), sha(3)])],
    pulls: {
      [sha(1)]: [[pr(8, sha(1), { merged_at: null })], [matched]],
      [sha(2)]: [[matched]],
      [sha(3)]: [[
        pr(9, sha(3), { base: { ref: "other", repo: { full_name: "openai/codex" } } }),
        pr(10, sha(3), { base: { ref: "main", repo: { full_name: "other/codex" } } }),
        pr(11, sha(99)),
      ]],
    },
  }));
  assert.deepEqual(result.range.commits, [sha(1), sha(2), sha(3)]);
  assert.equal(result.range.commitCount, 3);
  assert.equal(result.range.base, sha(0));
  assert.equal(result.range.head, sha(3));
  assert.deepEqual(Object.keys(result.entries).sort(), [`commit:${sha(3)}`, "pr:7"].sort());
  assert.deepEqual(result.entries["pr:7"].commits, [sha(1), sha(2)]);
  assert.equal(result.entries[`commit:${sha(3)}`].decision.status, "unreviewed");
});

test("incomplete, diverged, and failed API collections cannot become coverage", async () => {
  await assert.rejects(collectRange(rangeRequest, apiFixture({ pages: [comparePage([sha(1)])] })));
  await assert.rejects(collectRange(rangeRequest, apiFixture({
    pages: [comparePage([sha(1), sha(2), sha(3)], {
      status: "diverged", behind_by: 1, merge_base_commit: { sha: sha(99) },
    })],
  })));
  await assert.rejects(collectRange(rangeRequest, apiFixture({ pages: [], fail: "/commits/head" })), /unavailable/);
  await assert.rejects(collectRange(rangeRequest, apiFixture({
    pages: [comparePage([sha(1), sha(2), sha(3)])], fail: `/${sha(2)}/pulls`,
  })), /unavailable/);
});

test("new contiguous collection preserves older deferred backlog and rejects duplicate or gapped ranges", () => {
  const id = `commit:${sha(1)}`;
  let ledger = setDecision(ledgerWith(sha(1)), id, decision("deferred", { retryWhen: "Required API lands locally" }));
  ledger = finishRange(ledger, sha(1), "reviewed");
  const prior = structuredClone(ledger.entries[id]);
  const next = collection(sha(1), sha(2));
  next.entries[id] = collection(sha(0), sha(1)).entries[id];
  ledger = addRange(ledger, next);
  assert.deepEqual(ledger.entries[id], prior);
  const summary = summarize(ledger);
  assert.ok(summary.backlog.includes(id));
  assert.equal(summary.reviewedThrough, sha(1));
  assert.equal(summary.collectedThrough, sha(2));
  assert.throws(() => addRange(ledger, next));
  assert.throws(() => addRange(ledger, collection(sha(99), sha(3))));
});

test("review checkpoints cannot skip an unreviewed item or an earlier unreviewed range", () => {
  let ledger = ledgerWith(sha(1));
  assert.throws(() => finishRange(ledger, sha(1), "reviewed"));
  ledger = addRange(ledger, collection(sha(1), sha(2)));
  ledger = setDecision(ledger, `commit:${sha(2)}`, decision("excluded"));
  assert.throws(() => finishRange(ledger, sha(2), "reviewed"));
  ledger = setDecision(ledger, `commit:${sha(1)}`, decision("equivalent"));
  ledger = finishRange(ledger, sha(1), "reviewed");
  ledger = finishRange(ledger, sha(2), "reviewed");
  assert.equal(summarize(ledger).reviewedThrough, sha(2));
});

test("reviewed selection remains pending until passing verification and acceptance", () => {
  const id = `commit:${sha(1)}`;
  let ledger = setDecision(ledgerWith(sha(1)), id, decision("selected"));
  assert.throws(() => finishRange(ledger, sha(1), "accepted"));
  ledger = finishRange(ledger, sha(1), "reviewed");
  assert.equal(ledger.ranges[0].acceptedAt, null);
  assert.ok(summarize(ledger).selectedPending.includes(id));
  ledger = setImplementation(ledger, id, implementation("applied"));
  assert.throws(() => finishRange(ledger, sha(1), "accepted"));
  assert.throws(() => setImplementation(ledger, id, implementation("verified", { verification: null })));
  const failed = implementation("verified");
  failed.verification.exitCode = 1;
  assert.throws(() => setImplementation(ledger, id, failed));
  ledger = setImplementation(ledger, id, implementation("verified"));
  ledger = finishRange(ledger, sha(1), "accepted");
  assert.ok(ledger.ranges[0].acceptedAt);
  assert.ok(!summarize(ledger).selectedPending.includes(id));
});

test("decisions require rationale, evidence and explicit deferred retry conditions", () => {
  const id = `commit:${sha(1)}`;
  const ledger = ledgerWith(sha(1));
  for (const invalid of [
    decision("selected", { reason: "" }), decision("selected", { evidence: [] }),
    decision("deferred"), decision("unreviewed"),
  ]) assert.throws(() => setDecision(ledger, id, invalid));
  assert.throws(() => setImplementation(ledger, id, implementation("applied")));
});

test("dependencies must exist, remain acyclic, and be verified or equivalent before verification", () => {
  const [first, second] = [sha(1), sha(2)].map(commit => `commit:${commit}`);
  let ledger = ledgerWith(sha(1), sha(2));
  assert.throws(() => setDecision(ledger, first, decision("selected", { dependsOn: ["pr:999"] })));
  ledger = setDecision(ledger, first, decision("selected", { dependsOn: [second] }));
  assert.throws(() => setDecision(ledger, second, decision("selected", { dependsOn: [first] })));
  assert.throws(() => setImplementation(ledger, first, implementation("verified")));
  ledger = setDecision(ledger, second, decision("equivalent"));
  ledger = setImplementation(ledger, first, implementation("verified"));
  assert.equal(ledger.entries[first].implementation.status, "verified");

  let equivalent = setDecision(ledgerWith(sha(1), sha(2)), first,
    decision("equivalent", { dependsOn: [second] }));
  equivalent = setDecision(equivalent, second,
    decision("deferred", { retryWhen: "Required API lands locally" }));
  equivalent = finishRange(equivalent, sha(2), "reviewed");
  assert.ok(equivalent.ranges[0].reviewedAt);
  assert.throws(() => finishRange(equivalent, sha(2), "accepted"));
});

test("ledger validation rejects tampered coverage, counts and persisted dependency cycles", () => {
  const ledger = ledgerWith(sha(1), sha(2));
  assert.deepEqual(validateLedger(ledger), ledger);
  const badCount = structuredClone(ledger);
  badCount.ranges[0].commitCount += 1;
  assert.throws(() => validateLedger(badCount));
  const missing = structuredClone(ledger);
  delete missing.entries[`commit:${sha(1)}`];
  assert.throws(() => validateLedger(missing));
  const cyclic = structuredClone(ledger);
  cyclic.entries[`commit:${sha(1)}`].decision = decision("selected", { dependsOn: [`commit:${sha(2)}`] });
  cyclic.entries[`commit:${sha(2)}`].decision = decision("selected", { dependsOn: [`commit:${sha(1)}`] });
  assert.throws(() => validateLedger(cyclic));
});

test("public state transitions return independent ledgers without mutating their input", () => {
  const initial = createLedger();
  assert.deepEqual(initial.baseline, { baseTag: "rust-v0.162.0", priorCoverage: "unknown" });
  assert.equal(initial.repository, "openai/codex");
  assert.equal(initial.branch, "main");
  let ledger = initial;
  const id = `commit:${sha(1)}`;
  const transitions = [
    current => addRange(current, collection(sha(0), sha(1))),
    current => setDecision(current, id, decision("selected")),
    current => setImplementation(current, id, implementation("verified")),
    current => finishRange(current, sha(1), "reviewed"),
    current => finishRange(current, sha(1), "accepted"),
  ];
  for (const transition of transitions) {
    const before = structuredClone(ledger);
    const next = transition(ledger);
    assert.notEqual(next, ledger);
    assert.deepEqual(ledger, before);
    ledger = next;
  }
});
