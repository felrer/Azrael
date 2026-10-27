"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const lifecycle = require("./artifact-lifecycle.cjs");
const repo = path.resolve(__dirname, "..");
function fixture(t) {
  const parent = process.env.AZRAEL_LIFECYCLE_FIXTURE_ROOT
    ? path.resolve(process.env.AZRAEL_LIFECYCLE_FIXTURE_ROOT) : path.join(repo, "artifacts/verification");
  if (process.env.AZRAEL_LIFECYCLE_FIXTURE_ROOT) assert.ok(parent.startsWith(path.join(repo, "artifacts/tasks") + path.sep));
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "artifact-lifecycle-"));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(parent) + path.sep));
    function removeKnown(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const name = path.join(directory, entry.name);
        if (entry.isDirectory() && !fs.lstatSync(name).isSymbolicLink()) removeKnown(name);
        else fs.unlinkSync(name);
      }
      fs.rmdirSync(directory);
    }
    removeKnown(root);
    assert.equal(fs.existsSync(root), false);
  });
  const at = relative => path.join(root, "artifacts", relative);
  const record = (id, members, extra = {}) => lifecycle.recordLifecycle(root, { id, kind: "version", owner: "fixture-producer", version: "1.0", state: "complete", membership_complete: true, members: members.map(([name, role]) => ({ path: at(name), role })), ...extra });
  return { root, at, record };
}

function custodyFixture(t) {
  const f = fixture(t), { root, at, record } = f;
  const selected = at("logs/old"), remaining = at("logs/remaining"), child = path.join(selected, "nested.log");
  fs.mkdirSync(selected, { recursive: true }); fs.writeFileSync(child, "historical unknown outcome");
  fs.writeFileSync(remaining, "unresolved custody");
  const members = [selected, child, remaining].map(value => ({ path: value, role: "legacy-custody", generated: false, protection_known: false }));
  const source = record("custodian", [], { members, state: "pending", membership_complete: false });
  const proof = at("proof.json"); fs.writeFileSync(proof, JSON.stringify({ outcome: "unknown", exit_code: null }));
  const digest = value => require("node:crypto").createHash("sha256").update(fs.readFileSync(value)).digest("hex");
  const document = { schema: 1, source_id: source.id, source_revision: source.revision, target_id: "adjudicated", user_authorized: true, entries: [{ path: selected, generated: true, protection_known: true, producer_stopped_verified: true, consumers_released: true, generation_basis: "Verified original producer receipt; historical result remains unknown", producer_evidence: [{ path: proof, sha256: digest(proof) }] }] };
  const evidence = at("handoff.json");
  const request = { owner: source.owner, expected_revision: source.revision, target: { id: "adjudicated", kind: "work", owner: "cleanup-adjudicator" }, paths: [selected], reason: "Explicit authorized ownership adjudication", evidence_ref: evidence };
  const seal = () => { fs.writeFileSync(evidence, JSON.stringify(document)); request.evidence_sha256 = digest(evidence); };
  seal();
  return { ...f, source, members, selected, remaining, child, proof, document, request, seal, transfer: () => lifecycle.transferCustody(root, source.id, request) };
}

test("custody subset handoff preserves uncertainty, descendants, receipts and ordinary promotion rejection", t => {
  const f = custodyFixture(t);
  assert.throws(() => f.record("custodian", [], { members: [{ ...f.members[0], generated: true }] }), /Cannot promote/);
  const result = f.transfer();
  assert.equal(result.status, "transferred");
  assert.equal(result.record.state, "complete"); assert.equal(result.record.producer, undefined);
  const source = lifecycle.catalog(f.root).find(item => item.id === "custodian");
  assert.deepEqual(source.members, [f.members[2]]);
  assert.equal(source.custody_handoffs[0].original_members.length, 2);
  assert.equal(source.state, "pending");
  f.record(source.id, [], { members: source.members, state: source.state, membership_complete: false });
  assert.equal(lifecycle.catalog(f.root).find(item => item.id === source.id).custody_handoffs.length, 1);
  assert.equal(f.transfer().record.revision, result.record.revision);
  assert.throws(() => f.record(source.id, [], { members: [f.members[0]] }), /cannot be reclaimed/);
});

test("custody rejects invalid identities, evidence, selected boundaries and consumer claims", async t => {
  const cases = {
    owner: f => { f.request.owner = "wrong"; },
    revision: f => { f.request.expected_revision++; f.document.source_revision++; f.seal(); },
    missingProof: f => { fs.unlinkSync(f.proof); },
    mismatchedProof: f => { fs.writeFileSync(f.proof, "changed"); },
    externalProof: f => { f.document.entries[0].producer_evidence[0].path = path.join(path.dirname(f.root), "outside-proof"); f.seal(); },
    deletedProof: f => { f.document.entries[0].producer_evidence[0].path = f.child; f.seal(); },
    registryProof: f => { f.document.entries[0].producer_evidence[0].path = lifecycle.registryPath(f.root, f.source.id); f.seal(); },
    outsideLogs: f => { f.request.paths = [f.proof]; },
    partialAncestor: f => { f.request.paths = [f.child]; f.document.entries[0].path = f.child; f.seal(); },
    extraEvidence: f => { f.document.entries.push(f.document.entries[0]); f.seal(); },
    missingAuthorization: f => { f.document.user_authorized = false; f.seal(); },
    unconfirmed: f => { f.document.entries[0].producer_stopped_verified = false; f.seal(); },
    duplicateTarget: f => { f.record(f.request.target.id, [["other", "output"]]); },
    overlappingOwner: f => { f.record("other-owner", [], { members: [{ path: f.child, role: "log" }] }); },
    overlappingAncestor: f => { f.record("other-owner", [], { members: [{ path: f.at("logs"), role: "log" }] }); },
    incomingConsumer: f => { f.record("consumer", [["other", "output"]], { references: [{ id: f.source.id, reason: "retained evidence" }] }); },
    outgoingConsumer: f => { f.record(f.source.id, [], { members: f.members, state: "pending", membership_complete: false, references: [{ id: "external", reason: "retained dependency" }] }); }
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, t => {
    const f = custodyFixture(t); change(f);
    const before = fs.readFileSync(lifecycle.registryPath(f.root, f.source.id), "utf8");
    assert.throws(f.transfer);
    assert.equal(fs.readFileSync(lifecycle.registryPath(f.root, f.source.id), "utf8"), before);
  });
});

test("custody staged filesystem failures stay protected and same request resumes", async t => {
  for (const stage of [1, 2, 3]) await t.test(`write ${stage}`, t => {
    const f = custodyFixture(t), original = fs.renameSync; let count = 0;
    fs.renameSync = (...args) => { if (++count === stage) throw new Error("injected custody write interruption"); return original(...args); };
    try { assert.throws(f.transfer, /injected/); } finally { fs.renameSync = original; }
    const pending = lifecycle.catalog(f.root).find(item => item.id === f.request.target.id);
    if (pending) {
      assert.equal(pending.state, "pending"); assert.equal(pending.membership_complete, false);
      const plan = lifecycle.planCleanup(f.root, { paths: [f.selected] });
      assert.ok(plan.groups.find(group => group.id === pending.id).blockers.length);
      assert.throws(() => lifecycle.recordLifecycle(f.root, { ...pending, state: "complete", membership_complete: true }), /Pending custody/);
      assert.throws(() => lifecycle.closeLifecycle(f.root, pending.id, {}), /Pending custody/);
    }
    assert.equal(f.transfer().status, "transferred");
    assert.equal(f.transfer().status, "transferred");
  });
});

test("custody completed retry rejects changed proof and references; absent retired target is never resurrected", t => {
  const f = custodyFixture(t); f.transfer();
  fs.unlinkSync(lifecycle.registryPath(f.root, f.request.target.id));
  assert.throws(f.transfer, /Retired custody target/);
  fs.unlinkSync(f.child); fs.rmdirSync(f.selected);
  assert.equal(f.transfer().status, "already-retired");
  assert.equal(fs.existsSync(lifecycle.registryPath(f.root, f.request.target.id)), false);
  fs.writeFileSync(f.proof, "changed"); assert.throws(f.transfer, /SHA256/);
});

test("custody CLI reads the pinned request file; new references prevent retry", t => {
  const f = custodyFixture(t), requestFile = f.at("request.json");
  fs.writeFileSync(requestFile, JSON.stringify(f.request));
  assert.equal(lifecycle.main(["transfer-custody", "--project-root", f.root, "--id", f.source.id, "--request-file", requestFile]).status, "transferred");
  f.record("new-reader", [["reader", "output"]], { references: [{ id: f.request.target.id, reason: "new evidence consumer" }] });
  assert.throws(f.transfer, /consumer/);
});

test("custody rejects linked log roots", t => {
  const f = custodyFixture(t), link = f.at("logs/link");
  fs.symlinkSync(f.selected, link, process.platform === "win32" ? "junction" : "dir");
  f.request.paths = [link];
  assert.throws(f.transfer, /Linked/);
});

test("custody rejects nested links before either registry changes", t => {
  const f = custodyFixture(t), outside = f.at("link-destination");
  fs.mkdirSync(outside);
  const nested = path.join(f.selected, "nested-directory"); fs.mkdirSync(nested);
  try { fs.symlinkSync(outside, path.join(nested, "junction"), process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) { t.skip(`Links unavailable: ${error.code}`); return; } throw error; }
  const before = fs.readFileSync(lifecycle.registryPath(f.root, f.source.id), "utf8");
  assert.throws(f.transfer, /Linked custody descendant/);
  assert.equal(fs.readFileSync(lifecycle.registryPath(f.root, f.source.id), "utf8"), before);
  assert.equal(fs.existsSync(lifecycle.registryPath(f.root, f.request.target.id)), false);
});

test("custody rejects proof inside unselected source custody", t => {
  const f = custodyFixture(t);
  f.document.entries[0].producer_evidence[0] = { path: f.remaining, sha256: require("node:crypto").createHash("sha256").update(fs.readFileSync(f.remaining)).digest("hex") };
  f.seal();
  const before = fs.readFileSync(lifecycle.registryPath(f.root, f.source.id), "utf8");
  assert.throws(f.transfer, /outside custody members/);
  assert.equal(fs.readFileSync(lifecycle.registryPath(f.root, f.source.id), "utf8"), before);
  assert.equal(fs.existsSync(lifecycle.registryPath(f.root, f.request.target.id)), false);
});

function refinementFixture(t) {
  const f = fixture(t), parent = f.at("legacy-logs"), selected = path.join(parent, "generated"), remaining = path.join(parent, "unknown");
  fs.mkdirSync(selected, { recursive: true }); fs.mkdirSync(remaining);
  fs.writeFileSync(path.join(selected, "output.log"), "verified historical generated output");
  fs.writeFileSync(path.join(remaining, "user.txt"), "unclassified content");
  const sources = ["legacy-custody", "legacy-input"].map((role, index) => f.record(`ancestor-${index}`, [], {
    state: "retained", membership_complete: false,
    members: [{ path: parent, role, generated: false, protection_known: false }, { path: f.at(`other-${index}`), role: "input", generated: false, protection_known: false }]
  }));
  const proof = f.at("producer-proof.json"); fs.writeFileSync(proof, JSON.stringify({ outcome: "failure", exit_code: 1 }));
  const digest = file => require("node:crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const request = { sources: sources.map(({ id, owner, revision }) => ({ id, owner, expected_revision: revision })), parent, paths: [selected],
    target: { id: "refined-generated", kind: "work", owner: "authorized-cleanup" }, reason: "Authorized exact historical child refinement", evidence_ref: f.at("refinement-proof.json") };
  const document = { schema: 1, action: "refine-custody", sources: request.sources, parent, target_id: request.target.id, user_authorized: true,
    entries: [{ path: selected, generated: true, protection_known: true, consumers_released: true, producer_stopped_verified: true,
      generation_basis: "Pinned external historical producer receipt", producer_evidence: [{ path: proof, sha256: digest(proof) }] }] };
  const seal = () => { fs.writeFileSync(request.evidence_ref, JSON.stringify(document)); request.evidence_sha256 = digest(request.evidence_ref); };
  seal();
  return { ...f, parent, selected, remaining, sources, proof, digest, request, document, seal, refine: () => lifecycle.refineCustody(f.root, request) };
}

test("custody ancestor refinement preserves both historical owners and unselected uncertainty through CLI", t => {
  const f = refinementFixture(t), requestFile = f.at("refinement-request.json");
  fs.writeFileSync(requestFile, JSON.stringify(f.request));
  const result = lifecycle.main(["refine-custody", "--project-root", f.root, "--request-file", requestFile]);
  assert.equal(result.status, "refined");
  assert.equal(result.record.state, "complete"); assert.equal(result.record.membership_complete, true);
  assert.equal(result.record.producer, undefined);
  assert.deepEqual(result.record.members.map(member => member.path), [f.selected]);
  assert.ok(result.record.members.every(member => member.generated === true && member.protection_known === true));
  for (const original of f.sources) {
    const source = lifecycle.catalog(f.root).find(item => item.id === original.id);
    assert.equal(source.state, original.state); assert.equal(source.membership_complete, false); assert.equal(source.producer, undefined);
    assert.deepEqual(source.members.find(member => member.path === original.members[1].path), original.members[1]);
    const remainder = source.members.find(member => member.path === f.remaining);
    assert.equal(remainder.role, original.members[0].role); assert.equal(remainder.generated, false); assert.equal(remainder.protection_known, false);
    assert.equal(source.members.some(member => member.path === f.parent || member.path === f.selected), false);
    assert.throws(() => f.record(source.id, [], { ...source, members: [{ ...remainder, generated: true }] }), /Cannot promote/);
    assert.throws(() => f.record(source.id, [], { ...source, members: [original.members[0]] }), /cannot be reclaimed/);
  }
  assert.equal(fs.readFileSync(path.join(f.remaining, "user.txt"), "utf8"), "unclassified content");
  assert.equal(fs.readFileSync(path.join(f.selected, "output.log"), "utf8"), "verified historical generated output");
  assert.equal(f.refine().record.revision, result.record.revision);
});

test("custody ancestor refinement rejects invalid proof, claims and boundaries without registry writes", async t => {
  const cases = {
    stale: f => { f.request.sources[0].expected_revision++; f.seal(); },
    wrongOwner: f => { f.request.sources[0].owner = "not-owner"; f.seal(); },
    missingAuthorization: f => { f.document.user_authorized = false; f.seal(); },
    unknownGeneration: f => { f.document.entries[0].generated = false; f.seal(); },
    changedProof: f => { fs.writeFileSync(f.proof, "changed"); },
    evidenceDigest: f => { f.request.evidence_sha256 = "0".repeat(64); },
    proofInsideSelected: f => { const file = path.join(f.selected, "output.log"); f.document.entries[0].producer_evidence = [{ path: file, sha256: f.digest(file) }]; f.seal(); },
    nestedSelection: f => { f.request.paths = [path.join(f.selected, "output.log")]; f.document.entries[0].path = f.request.paths[0]; f.seal(); },
    missingChild: f => { f.request.paths = [path.join(f.parent, "missing")]; f.document.entries[0].path = f.request.paths[0]; f.seal(); },
    thirdOwner: f => { f.record("third-owner", [], { members: [{ path: f.selected, role: "output" }] }); },
    incomingReference: f => { f.record("reader", [["reader", "output"]], { references: [{ id: f.sources[0].id, reason: "still reads" }] }); },
    outgoingReference: f => { f.record(f.sources[0].id, [], { ...f.sources[0], references: [{ id: "dependency", reason: "unreleased" }] }); },
    linkedDescendant: f => { fs.symlinkSync(f.remaining, path.join(f.selected, "linked"), process.platform === "win32" ? "junction" : "dir"); }
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, t => {
    const f = refinementFixture(t);
    try { change(f); } catch (error) { if (name === "linkedDescendant" && ["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) { t.skip(`Links unavailable: ${error.code}`); return; } throw error; }
    const before = lifecycle.catalog(f.root).map(record => [record.id, fs.readFileSync(lifecycle.registryPath(f.root, record.id), "utf8")]);
    assert.throws(f.refine);
    assert.equal(fs.existsSync(lifecycle.registryPath(f.root, f.request.target.id)), false);
    for (const [id, contents] of before) assert.equal(fs.readFileSync(lifecycle.registryPath(f.root, id), "utf8"), contents);
  });
});

test("custody refinement permits only pinned consumer exclusions and preserves every dependency", async t => {
  const changes = {
    exact: () => {},
    staleRevision: (f, consumer) => { f.record(consumer.id, [], { ...consumer }); },
    wrongOwner: f => { f.request.consumer_exclusions[0].owner = "wrong-owner"; f.seal(); },
    wrongReference: f => { f.request.consumer_exclusions[0].reference_ids = ["unmatched-reference"]; f.seal(); },
    wrongPaths: f => { f.request.consumer_exclusions[0].paths = [f.remaining]; f.seal(); },
    changedProof: f => { fs.writeFileSync(f.request.consumer_exclusions[0].evidence_ref, "changed exclusion evidence"); },
    unacknowledgedReader: f => { f.record("new-source-reader", [["new-reader", "output"]], { references: [{ id: f.sources[0].id, reason: "new consumer" }] }); },
    targetReader: f => { f.record("target-reader", [["target-reader", "output"]], { references: [{ id: f.request.target.id, reason: "target consumer must always block" }] }); }
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, t => {
    const f = refinementFixture(t), consumer = f.record("historical-reader", [["historical-reader", "output"]], {
      references: [{ id: f.sources[0].id, reason: "historical input dependency", kind: "dependency" }, { id: "unrelated-input", reason: "independent dependency", kind: "dependency" }]
    });
    const evidence = f.at("consumer-exclusion.json"); fs.writeFileSync(evidence, JSON.stringify({ selected_children_are_not_historical_inputs: true }));
    f.request.consumer_exclusions = [{ id: consumer.id, owner: consumer.owner, expected_revision: consumer.revision,
      reference_ids: consumer.references.filter(reference => reference.id === f.sources[0].id).map(reference => reference.reference_id),
      paths: [f.selected], reason: "Pinned historical input evidence excludes these exact newly generated children", evidence_ref: evidence, evidence_sha256: f.digest(evidence) }];
    f.document.consumer_exclusions = f.request.consumer_exclusions; f.seal(); change(f, consumer);
    const before = lifecycle.catalog(f.root).map(record => [record.id, fs.readFileSync(lifecycle.registryPath(f.root, record.id), "utf8")]);
    if (name !== "exact") {
      assert.throws(f.refine);
      assert.equal(fs.existsSync(lifecycle.registryPath(f.root, f.request.target.id)), false);
      for (const [id, contents] of before) assert.equal(fs.readFileSync(lifecycle.registryPath(f.root, id), "utf8"), contents);
      return;
    }
    assert.equal(f.refine().status, "refined");
    assert.equal(fs.readFileSync(lifecycle.registryPath(f.root, consumer.id), "utf8"), before.find(([id]) => id === consumer.id)[1]);
    assert.deepEqual(lifecycle.catalog(f.root).find(record => record.id === consumer.id).references, consumer.references);
    assert.ok(lifecycle.registerRequest(f.root, f.sources[0].id).group.members.every(member => member.references.length > 0));
    assert.equal(f.refine().status, "refined");
  });
});

test("custody ancestor refinement interruptions remain protected, resume exactly and never resurrect retired payload", async t => {
  for (const stage of [1, 2, 3, 4]) await t.test(`publication ${stage}`, t => {
    const f = refinementFixture(t), original = fs.renameSync; let count = 0;
    fs.renameSync = (...args) => { if (++count === stage) throw new Error("injected refinement publication interruption"); return original(...args); };
    try { assert.throws(f.refine, /injected/); } finally { fs.renameSync = original; }
    const pending = lifecycle.catalog(f.root).find(item => item.id === f.request.target.id);
    if (pending) {
      assert.equal(pending.state, "pending"); assert.equal(pending.membership_complete, false);
      assert.ok(lifecycle.planCleanup(f.root, { paths: [f.selected] }).groups.find(group => group.id === pending.id).blockers.length);
      assert.throws(() => lifecycle.recordLifecycle(f.root, { ...pending, state: "complete", membership_complete: true }), /Pending custody/);
      assert.throws(() => lifecycle.closeLifecycle(f.root, pending.id, {}), /Pending custody/);
      for (const source of lifecycle.catalog(f.root).filter(item => f.sources.some(original => original.id === item.id))) {
        if (!source.members.some(member => member.path === f.parent)) assert.throws(() => f.record(source.id, [], { ...source, members: [f.sources.find(original => original.id === source.id).members[0]] }), /cannot be reclaimed/);
      }
    }
    const result = f.refine(); assert.equal(result.record.state, "complete");
    assert.equal(f.refine().record.revision, result.record.revision);
    fs.unlinkSync(path.join(f.selected, "output.log")); fs.rmdirSync(f.selected);
    assert.equal(lifecycle.finalize(f.root, result.record.id).status, "finalized");
    assert.equal(f.refine().status, "already-retired");
    assert.equal(fs.existsSync(lifecycle.registryPath(f.root, result.record.id)), false);
    assert.equal(fs.existsSync(f.selected), false);
  });
  const retryChanges = {
    newChild: f => { fs.mkdirSync(path.join(f.parent, "arrived-after-claim")); },
    changedProof: f => { fs.writeFileSync(f.proof, "new producer evidence"); },
    newReader: f => { f.record("new-reader", [["reader", "output"]], { references: [{ id: f.request.target.id, reason: "new active consumer" }] }); },
    replacedChild: f => { fs.renameSync(f.selected, f.at("saved-child")); fs.mkdirSync(f.selected); fs.writeFileSync(path.join(f.selected, "output.log"), "replacement"); },
    replacedParent: f => { fs.renameSync(f.parent, f.at("saved-parent")); fs.mkdirSync(f.parent); fs.mkdirSync(f.selected); fs.mkdirSync(f.remaining); },
    newOverlap: f => { f.record("late-owner", [], { members: [{ path: path.join(f.selected, "output.log"), role: "output" }] }); }
  };
  for (const [name, change] of Object.entries(retryChanges)) await t.test(`pending retry rejects ${name}`, t => {
    const f = refinementFixture(t), original = fs.renameSync; let count = 0;
    fs.renameSync = (...args) => { if (++count === 2) throw new Error("injected refinement source interruption"); return original(...args); };
    try { assert.throws(f.refine, /injected/); } finally { fs.renameSync = original; }
    change(f);
    const before = lifecycle.catalog(f.root).map(record => [record.id, fs.readFileSync(lifecycle.registryPath(f.root, record.id), "utf8")]);
    assert.throws(f.refine);
    assert.equal(lifecycle.catalog(f.root).find(item => item.id === f.request.target.id).state, "pending");
    for (const [id, contents] of before) assert.equal(fs.readFileSync(lifecycle.registryPath(f.root, id), "utf8"), contents);
  });
});

function relocationFixture(t) {
  const f = custodyFixture(t), second = f.at("logs/second"), destination = f.at("logs/migrated-batch");
  fs.mkdirSync(second); fs.writeFileSync(path.join(second, "result.log"), "historical failed output");
  f.members.push({ path: second, role: "legacy-custody", generated: false, protection_known: false });
  const source = f.record(f.source.id, [], { members: f.members, state: "pending", membership_complete: false });
  f.request.expected_revision = source.revision; f.document.source_revision = source.revision;
  f.request.paths.push(second); f.request.destination_root = destination;
  f.document.entries.push({ ...f.document.entries[0], path: second }); f.seal();
  const identity = filename => { const s = fs.lstatSync(filename, { bigint: true }); return [s.dev.toString(), s.ino.toString()]; };
  return { ...f, second, destination, identity, relocate: () => lifecycle.relocateCustody(f.root, f.source.id, f.request) };
}

test("physical custody migration preserves content and root identities with one native ownership root", t => {
  const f = relocationFixture(t), identities = f.request.paths.map(f.identity), requestFile = f.at("relocate-request.json");
  fs.writeFileSync(requestFile, JSON.stringify(f.request));
  const result = lifecycle.main(["relocate-custody", "--project-root", f.root, "--id", f.source.id, "--request-file", requestFile]);
  assert.equal(result.status, "relocated"); assert.equal(result.record.producer, undefined);
  for (const [index, original] of f.request.paths.entries()) {
    assert.equal(fs.existsSync(original), false);
    assert.deepEqual(f.identity(path.join(f.destination, path.basename(original))), identities[index]);
  }
  assert.equal(fs.readFileSync(path.join(f.destination, "old/nested.log"), "utf8"), "historical unknown outcome");
  assert.equal(fs.readFileSync(path.join(f.destination, "second/result.log"), "utf8"), "historical failed output");
  assert.deepEqual(lifecycle.registerRequest(f.root, f.request.target.id).group.members.map(item => item.path), [f.destination]);
  const source = lifecycle.catalog(f.root).find(item => item.id === f.source.id);
  assert.deepEqual(source.members, [f.members[2]]); assert.equal(source.state, "pending");
  assert.equal(source.custody_handoffs[0].original_members.length, 3);
  assert.equal(f.relocate().status, "relocated");
});

test("physical custody migration preserves original claims after rename interruption and resumes", t => {
  const f = relocationFixture(t), rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (from === f.second) throw new Error("injected second-root rename failure"); return rename(from, to); };
  try { assert.throws(f.relocate, /second-root rename failure/); } finally { fs.renameSync = rename; }
  const source = lifecycle.catalog(f.root).find(item => item.id === f.source.id), target = lifecycle.catalog(f.root).find(item => item.id === f.request.target.id);
  assert.deepEqual(source.members, f.members); assert.equal(target.state, "pending"); assert.equal(target.membership_complete, false);
  assert.equal(fs.existsSync(f.selected), false); assert.equal(fs.existsSync(f.second), true);
  assert.ok(lifecycle.planCleanup(f.root, { paths: [f.destination] }).groups.find(item => item.id === target.id).blockers.length);
  assert.equal(f.relocate().status, "relocated");
});

test("physical custody migration resumes source/final target write interruptions", async t => {
  for (const stage of ["source", "target"]) await t.test(stage, t => {
    const f = relocationFixture(t), rename = fs.renameSync; let targetWrites = 0;
    fs.renameSync = (from, to) => {
      if ((stage === "source" && to === lifecycle.registryPath(f.root, f.source.id)) || (to === lifecycle.registryPath(f.root, f.request.target.id) && ++targetWrites === 3 && stage === "target")) throw new Error("injected migration receipt interruption");
      return rename(from, to);
    };
    try { assert.throws(f.relocate, /receipt interruption/); } finally { fs.renameSync = rename; }
    const source = lifecycle.catalog(f.root).find(item => item.id === f.source.id), target = lifecycle.catalog(f.root).find(item => item.id === f.request.target.id);
    assert.equal(target.state, "pending");
    assert.equal(source.members.length, stage === "source" ? f.members.length : 1);
    assert.equal(f.relocate().status, "relocated");
  });
});

test("physical custody mkdir receipt gap fails closed without adopting existing destination", t => {
  const f = relocationFixture(t), rename = fs.renameSync; let writes = 0;
  fs.renameSync = (from, to) => { if (to === lifecycle.registryPath(f.root, f.request.target.id) && ++writes === 2) throw new Error("injected destination receipt interruption"); return rename(from, to); };
  try { assert.throws(f.relocate, /destination receipt interruption/); } finally { fs.renameSync = rename; }
  assert.equal(fs.existsSync(f.destination), true);
  assert.throws(f.relocate, /without saved identity/);
  assert.deepEqual(lifecycle.catalog(f.root).find(item => item.id === f.source.id).members, f.members);
  assert.equal(lifecycle.catalog(f.root).find(item => item.id === f.request.target.id).state, "pending");
  assert.equal(fs.existsSync(f.selected), true); assert.equal(fs.existsSync(f.second), true);
});

test("physical custody rejects unsafe paths and identities before ownership writes", async t => {
  const cases = {
    stale: f => { f.request.expected_revision++; f.document.source_revision++; f.seal(); },
    owner: f => { f.request.owner = "wrong"; },
    outgoing: f => { f.record(f.source.id, [], { members: f.members, state: "pending", membership_complete: false, references: [{ id: "external", reason: "consumer" }] }); },
    incoming: f => { f.record("consumer", [["other", "output"]], { references: [{ id: f.source.id, reason: "consumer" }] }); },
    otherOriginal: f => { f.record("other-owner", [], { members: [{ path: f.selected, role: "log" }] }); },
    otherDestination: f => { f.record("other-owner", [], { members: [{ path: path.join(f.destination, "child"), role: "log" }] }); },
    sourceDestination: f => { f.record(f.source.id, [], { members: [...f.members, { path: f.destination, role: "legacy-custody", generated: false, protection_known: false }], state: "pending", membership_complete: false }); },
    outside: f => { f.request.destination_root = f.at("outputs/new"); },
    overlapping: f => { f.request.destination_root = path.join(f.selected, "child"); },
    destinationExists: f => { fs.mkdirSync(f.destination); },
    duplicateTarget: f => { f.record(f.request.target.id, [["other", "output"]]); },
    proofInDestination: f => { fs.mkdirSync(f.destination); const proof = path.join(f.destination, "proof"); fs.copyFileSync(f.proof, proof); f.document.entries[0].producer_evidence[0].path = proof; f.seal(); },
    duplicateBasename: f => { const selected = f.at("logs/other-parent/old"); fs.mkdirSync(selected, { recursive: true }); const member = { path: selected, role: "legacy-custody", generated: false, protection_known: false }; const source = f.record(f.source.id, [], { members: [member], state: "pending", membership_complete: false }); f.request.paths.push(selected); f.document.entries.push({ ...f.document.entries[0], path: selected }); f.request.expected_revision = source.revision; f.document.source_revision = source.revision; f.seal(); },
    nestedLink: f => { fs.symlinkSync(f.second, path.join(f.selected, "link"), process.platform === "win32" ? "junction" : "dir"); }
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, t => {
    const f = relocationFixture(t); change(f);
    const before = fs.readFileSync(lifecycle.registryPath(f.root, f.source.id), "utf8");
    assert.throws(f.relocate);
    assert.equal(fs.readFileSync(lifecycle.registryPath(f.root, f.source.id), "utf8"), before);
    assert.equal(fs.existsSync(f.selected), true); assert.equal(fs.existsSync(f.second), true);
    if (name !== "duplicateTarget") assert.equal(fs.existsSync(lifecycle.registryPath(f.root, f.request.target.id)), false);
  });
});

test("physical custody rejects a different filesystem volume before creating target", t => {
  const f = relocationFixture(t), lstat = fs.lstatSync;
  fs.lstatSync = (filename, options) => {
    const result = lstat(filename, options);
    return filename === f.selected && options?.bigint ? new Proxy(result, { get: (stat, key) => key === "dev" ? stat.dev + 1n : stat[key] }) : result;
  };
  try { assert.throws(f.relocate, /same volume/); } finally { fs.lstatSync = lstat; }
  assert.equal(fs.existsSync(lifecycle.registryPath(f.root, f.request.target.id)), false);
  assert.equal(fs.existsSync(f.destination), false);
});

test("physical custody retries reject replacement identity, both-present and both-absent roots", async t => {
  for (const state of ["replacement", "both-present", "both-absent"]) await t.test(state, t => {
    const f = relocationFixture(t), rename = fs.renameSync;
    fs.renameSync = (from, to) => { if (from === f.second) throw new Error("stop before second rename"); return rename(from, to); };
    try { assert.throws(f.relocate, /stop before/); } finally { fs.renameSync = rename; }
    if (state !== "both-present") { fs.renameSync(f.second, f.at("logs/retained-replaced")); if (state === "replacement") fs.mkdirSync(f.second); }
    else fs.mkdirSync(path.join(f.destination, "second"));
    assert.throws(f.relocate, state === "replacement" ? /identity changed/ : /exactly one/);
    assert.equal(lifecycle.catalog(f.root).find(item => item.id === f.source.id).members.length, f.members.length);
    assert.equal(lifecycle.catalog(f.root).find(item => item.id === f.request.target.id).state, "pending");
  });
});

test("physical custody retired retries never recreate the destination", t => {
  const f = relocationFixture(t); f.relocate();
  fs.unlinkSync(lifecycle.registryPath(f.root, f.request.target.id));
  assert.throws(f.relocate, /Retired custody migration/);
  // Fixture-only ordinary removal models the separately owned native deletion.
  fs.unlinkSync(path.join(f.destination, "old/nested.log")); fs.rmdirSync(path.join(f.destination, "old"));
  fs.unlinkSync(path.join(f.destination, "second/result.log")); fs.rmdirSync(path.join(f.destination, "second")); fs.rmdirSync(f.destination);
  assert.equal(f.relocate().status, "already-retired");
  assert.equal(fs.existsSync(f.destination), false);
  assert.equal(fs.existsSync(lifecycle.registryPath(f.root, f.request.target.id)), false);
});

test("physical custody retry rejects new consumers and changed destination identity", async t => {
  for (const change of ["consumer", "source-revision", "destination-identity", "request-owner"]) await t.test(change, t => {
    const f = relocationFixture(t), rename = fs.renameSync;
    fs.renameSync = (from, to) => { if (from === f.second) throw new Error("stop migration"); return rename(from, to); };
    try { assert.throws(f.relocate, /stop migration/); } finally { fs.renameSync = rename; }
    if (change === "consumer") f.record("new-consumer", [["consumer", "output"]], { references: [{ id: f.request.target.id, reason: "new consumer" }] });
    if (change === "source-revision") f.record(f.source.id, [], { members: f.members, state: "pending", membership_complete: false });
    if (change === "destination-identity") { fs.renameSync(f.destination, f.at("logs/retained-destination")); fs.mkdirSync(f.destination); }
    if (change === "request-owner") f.request.target.owner = "changed-adjudicator";
    assert.throws(f.relocate, /consumer|Stale|identity changed|Conflicting/);
    assert.equal(fs.existsSync(f.second), true);
    assert.equal(lifecycle.catalog(f.root).find(item => item.id === f.request.target.id).state, "pending");
  });
});

test("completed physical custody retry verifies destination and every moved root before returning", async t => {
  for (const state of ["destination-replaced", "child-replaced", "destination-missing", "unexpected-child", "nested-link"]) await t.test(state, t => {
    const f = relocationFixture(t); f.relocate();
    const sourceBefore = fs.readFileSync(lifecycle.registryPath(f.root, f.source.id), "utf8");
    const targetBefore = fs.readFileSync(lifecycle.registryPath(f.root, f.request.target.id), "utf8");
    if (["destination-replaced", "destination-missing"].includes(state)) {
      fs.renameSync(f.destination, f.at("logs/retained-completed-destination"));
      if (state === "destination-replaced") fs.mkdirSync(f.destination);
    }
    if (state === "child-replaced") {
      fs.renameSync(path.join(f.destination, "old"), f.at("logs/retained-completed-child"));
      fs.mkdirSync(path.join(f.destination, "old"));
    }
    if (state === "unexpected-child") fs.writeFileSync(path.join(f.destination, "foreign.log"), "unowned");
    if (state === "nested-link") {
      const outside = f.at("logs/link-destination"); fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(f.destination, "old/link"), process.platform === "win32" ? "junction" : "dir");
    }
    assert.throws(f.relocate, /identity changed|ENOENT|Unexpected content|Linked custody descendant/);
    assert.equal(fs.readFileSync(lifecycle.registryPath(f.root, f.source.id), "utf8"), sourceBefore);
    assert.equal(fs.readFileSync(lifecycle.registryPath(f.root, f.request.target.id), "utf8"), targetBefore);
    if (state === "destination-missing") assert.equal(fs.existsSync(f.destination), false);
  });
});

test("legacy custody preserves uncertainty through parent projection and later producer updates", t => {
  const { root, at, record } = fixture(t);
  record("custody", [["legacy", "legacy-custody"]], { state: "retained", membership_complete: false,
    members: [{ path: at("legacy"), role: "legacy-custody", generated: false, protection_known: false }] });
  record("custody", [["legacy", "legacy-custody"]], { state: "complete" });
  assert.equal(lifecycle.catalog(root)[0].members[0].generated, false);
  assert.ok(lifecycle.planCleanup(root, { paths: [at("legacy")] }).groups[0].blockers.includes("unconfirmed-generated-ownership"));
  assert.equal(lifecycle.registerRequest(root, "custody").group.members[0].generated, false);
  assert.throws(() => record("custody", [], { members: [{ path: at("legacy"), role: "legacy-custody", generated: true }] }), /Cannot promote/);
  const projection = lifecycle.projectMembers([{ path: at("mixed"), role: "run", generated: true, protection_known: true },
    { path: at("mixed/source"), role: "unknown", generated: false, protection_known: false }]);
  assert.equal(projection.length, 1);
  assert.equal(projection[0].generated, false);
  assert.equal(projection[0].protection_known, false);
  assert.throws(() => record("bad", [], { members: [{ path: at("bad"), role: "unknown", generated: "yes" }] }), /Invalid lifecycle member/);
});

test("failed producer retains its whole pending identity and append-only membership", t => {
  const { root, at, record } = fixture(t);
  const before = record("release-one", [["releases/one", "release"], ["releases/one.inputs", "inputs"], ["logs/one", "logs"]], { state: "pending", membership_complete: false });
  fs.mkdirSync(at("releases/one.inputs"), { recursive: true });
  const failed = record("release-one", [["releases/one.work", "work"]], { state: "failed", membership_complete: false, expected_revision: before.revision });
  assert.equal(failed.members.length, 4);
  const plan = lifecycle.planCleanup(root, { paths: [at("releases/one.inputs/partial")] });
  assert.equal(plan.groups.length, 1); assert.equal(plan.groups[0].members.length, 4);
  assert.ok(plan.groups[0].blockers.includes("lifecycle-state:failed"));
  assert.ok(plan.groups[0].blockers.includes("incomplete-membership"));
  assert.throws(() => record("release-one", [["logs/old", "logs"]], { expected_revision: before.revision }), /Stale/);
  assert.throws(() => record("release-one", [["logs/other", "logs"]], { owner: "other-producer" }), /Conflicting/);
  assert.throws(() => record("release-one", [["logs/other", "logs"]], { version: "2.0" }), /Conflicting/);
});

test("build producer records all planned members before first output creation fails", async t => {
  const { root, at } = fixture(t);
  fs.mkdirSync(at("logs/multi-platform"), { recursive: true });
  fs.writeFileSync(at("logs/multi-platform/build"), "directory collision prevents any process execution");
  fs.mkdirSync(at("cache/cargo"), { recursive: true });
  const output = at("releases/failed-start");
  await assert.rejects(require("./build-platform.cjs").build({ "project-root": root, output,
    "ui-root": at("ui"), bun: at("bun"), "target-directory": at("cache/cargo"), "code-mode-host": at("host") }), /EEXIST|ENOTDIR/);
  const [record] = lifecycle.catalog(root);
  assert.equal(record.id, "version:failed-start"); assert.equal(record.owner, "azrael-release");
  assert.equal(record.state, "failed"); assert.equal(record.membership_complete, false);
  assert.deepEqual(record.members.map(member => member.role), ["release", "inputs", "work", "logs"]);
  assert.equal(fs.existsSync(output), false);
});

test("selection expands all sibling outputs and native projection keeps disjoint roots", t => {
  const { root, at, record } = fixture(t);
  record("release-two", [["releases/two", "release"], ["releases/two/prepared-host", "prepared"], ["releases/two.inputs", "inputs"], ["logs/two", "logs"]]);
  const plan = lifecycle.planCleanup(root, { paths: [at("releases/two/prepared-host/template.vsix")] });
  assert.equal(plan.groups.length, 1); assert.equal(plan.groups[0].members.length, 3);
  assert.deepEqual(plan.groups[0].blockers, []);
  assert.equal(lifecycle.catalog(root)[0].members.length, 4);
  const request = lifecycle.registerRequest(root, "release-two");
  assert.equal(request.operation, "register"); assert.equal(request.group.members.length, 3);
  assert.ok(request.group.members.every(member => member.generated && !member.protection_known && member.provenance_ref === request.group.provenance_ref));
  assert.deepEqual(request.group.members.map(member => member.id), lifecycle.registerRequest(root, "release-two").group.members.map(member => member.id));
});

test("shared member protection, report destinations and active consumers protect whole groups", t => {
  const { root, at, record } = fixture(t);
  record("a", [["releases/a", "release"], ["shared/key", "cache"]]);
  record("b", [["releases/b", "release"], ["shared/key", "cache"]]);
  let plan = lifecycle.planCleanup(root, { paths: [at("releases/a")], protectedPaths: [at("releases/b/current")] });
  assert.deepEqual(plan.groups.map(group => group.id).sort(), ["a", "b"]);
  assert.ok(plan.groups.every(group => group.blockers.length));
  plan = lifecycle.planCleanup(root, { paths: [at("shared/key")], reportPath: at("releases/a/cleanup.json") });
  assert.ok(plan.groups.find(group => group.id === "a").blockers.includes("report-inside-member"));
  fs.mkdirSync(at("releases/a"), { recursive: true });
  record("consumer", [["verification/consumer", "run"]], { kind: "run", state: "pending", references: [{ id: "a", reason: "active cache consumer" }] });
  plan = lifecycle.planCleanup(root, { paths: [at("releases/a")] });
  assert.ok(plan.groups.find(group => group.id === "a").blockers.includes("active-reference:consumer"));
});

test("native projection protects dependencies from inbound consumers without protecting consumers from outbound dependencies", t => {
  const { root, at, record } = fixture(t);
  record("release", [["releases/main", "release"]]);
  fs.mkdirSync(at("releases/main"), { recursive: true });
  record("package", [["packages/main", "package"]], { kind: "run", references: [{ id: "release", reason: "packaging-input" }] });
  const packagePlan = lifecycle.planCleanup(root, { paths: [at("packages/main")] });
  assert.deepEqual(packagePlan.groups[0].blockers, []);
  const packageRequest = lifecycle.registerRequest(root, "package");
  assert.ok(packageRequest.group.members.every(member => member.references.length === 0));
  assert.equal(packageRequest.group.membership_source, path.join(root, "artifacts/maintenance/lifecycles"));
  const releaseRequest = lifecycle.registerRequest(root, "release");
  assert.ok(releaseRequest.group.members.every(member => member.references.includes("package:packaging-input")));
  assert.ok(lifecycle.planCleanup(root, { paths: [at("releases/main")] }).groups[0].blockers.includes("active-reference:package"));
  record("pending", [["outputs/pending", "output"]], { kind: "run", state: "pending", membership_complete: true });
  assert.equal(lifecycle.registerRequest(root, "pending").group.membership_complete, false);
});

test("native projection marks logs and reports for evidence-last deletion ordering", t => {
  const { root, record } = fixture(t);
  record("ordered", [["releases/ordered", "release"], ["snapshots/ordered", "inputs"], ["logs/ordered", "logs"], ["reports/ordered", "reports"], ["verification/ordered", "evidence"]]);
  const members = lifecycle.registerRequest(root, "ordered").group.members;
  assert.deepEqual(Object.fromEntries(members.map(member => [member.role, member.lifecycle_role])), {
    release: "artifact", inputs: "snapshot", logs: "log", reports: "evidence", evidence: "evidence",
  });
});

test("native projection declares producer registry semantics without changing its source directory", t => {
  const { root, record } = fixture(t);
  record("semantic-source", [["releases/semantic-source", "release"]]);
  const { group } = lifecycle.registerRequest(root, "semantic-source");
  assert.equal(group.membership_source_format, "producer_registry_v1");
  assert.equal(group.membership_source, path.join(root, "artifacts/maintenance/lifecycles"));
  assert.equal(group.provenance_ref, lifecycle.registryPath(root, "semantic-source"));
  assert.ok(group.members.every(member => member.references.length === 0));
});

test("legacy candidates retain their own cleaner boundary and report conflicts are explicit", t => {
  const { root, at } = fixture(t);
  const plan = lifecycle.planCleanup(root, { paths: [at("releases/old-backup")], reportPath: at("releases/old-backup/report.json") });
  assert.deepEqual(plan.groups, []);
  assert.deepEqual(plan.standalone, [{ path: at("releases/old-backup"), registered: false }]);
  assert.equal(plan.blockers.length, 1);
});

test("source, management, traversal and linked paths cannot become lifecycle ownership", t => {
  const { root, at, record } = fixture(t);
  for (const member of [path.join(root, "engine/codex-rs/core"), at("maintenance"), at("maintenance/lifecycles/x"), path.join(root, ".git"), at("releases/.azrael-ex")]) {
    assert.throws(() => record("unsafe", [], { members: [{ path: member, role: "release" }] }), /Source or management|outside/);
  }
  assert.throws(() => record("unsafe", [], { members: [{ path: at("releases") + path.sep + ".." + path.sep + "maintenance", role: "release" }] }), /traversal/);
  fs.mkdirSync(at("verification"), { recursive: true });
  const link = at("verification/link");
  fs.symlinkSync(path.join(repo, "scripts"), link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => record("linked", [["verification/link/file", "inputs"]]), /Linked/);
});

test("finalization removes only own registry after every recorded member is actually absent", t => {
  const { root, at, record } = fixture(t);
  record("finished", [["outputs/finished", "output"]]);
  fs.mkdirSync(at("outputs"), { recursive: true }); fs.writeFileSync(at("outputs/finished"), "retained");
  const registry = lifecycle.registryPath(root, "finished");
  assert.equal(lifecycle.finalize(root, "finished").status, "retained");
  assert.ok(fs.existsSync(registry));
  fs.unlinkSync(at("outputs/finished"));
  assert.equal(lifecycle.finalize(root, "finished").status, "finalized");
  assert.equal(fs.existsSync(registry), false);
  record("pending", [["outputs/not-created-yet", "output"]], { state: "pending", membership_complete: false });
  const pending = lifecycle.finalize(root, "pending");
  assert.equal(pending.status, "retained"); assert.ok(pending.blockers.includes("lifecycle-state:pending"));
  record("shared", [["shared/item", "cache"]]);
  fs.mkdirSync(at("shared/item"), { recursive: true });
  record("referrer", [["outputs/referrer", "output"]], { references: [{ id: "shared", reason: "still in use" }] });
  assert.equal(lifecycle.finalize(root, "shared").status, "retained");
  assert.equal(lifecycle.main(["catalog", "--project-root", root, "--limit", "1"]).groups.length, 1);
});

test("CLI cache consumers protect the last shared key until payload and logs are both gone", t => {
  const { root, at, record } = fixture(t);
  record("module-key", [["cache/modules/companion/key", "cache-entry"]], { kind: "run" });
  fs.mkdirSync(at("cache/modules/companion/key"), { recursive: true });
  for (const id of ["version-one", "version-two"]) {
    lifecycle.main(["record", "--project-root", root, "--id", id, "--kind", "version",
      "--owner", "fixture-producer", "--state", "complete", "--membership-complete", "true",
      "--member", `release=${at(`releases/${id}`)}`, "--member", `build-logs=${at(`logs/${id}`)}`,
      "--reference", "module-key=companion-tool"]);
    fs.mkdirSync(at(`releases/${id}`), { recursive: true });
    fs.mkdirSync(at(`logs/${id}`), { recursive: true });
  }
  const groups = lifecycle.main(["catalog", "--project-root", root, "--limit", "200"]).groups;
  assert.equal(groups.find(group => group.id === "version-one").references[0].id, "module-key");
  assert.ok(groups.find(group => group.id === "version-one").references[0].reference_id);
  assert.equal(lifecycle.registerRequest(root, "module-key").group.members[0].references.length, 2);
  fs.rmdirSync(at("releases/version-one"));
  assert.equal(lifecycle.finalize(root, "version-one").status, "retained");
  fs.rmdirSync(at("logs/version-one"));
  assert.equal(lifecycle.finalize(root, "version-one").status, "finalized");
  let blockers = lifecycle.planCleanup(root, { paths: [at("cache/modules/companion/key")] }).groups[0].blockers;
  assert.deepEqual(blockers, ["active-reference:version-two"]);
  fs.rmdirSync(at("releases/version-two")); fs.rmdirSync(at("logs/version-two"));
  assert.equal(lifecycle.finalize(root, "version-two").status, "finalized");
  blockers = lifecycle.planCleanup(root, { paths: [at("cache/modules/companion/key")] }).groups[0].blockers;
  assert.deepEqual(blockers, []);
  for (const invalid of ["module-key", "=reason", "module-key="]) {
    assert.throws(() => lifecycle.main(["record", "--project-root", root, "--reference", invalid]), /Expected lifecycle-id=reason/);
  }
});

test("explicit retirement compacts absent failed or unknown records without inventing a passing exit", t => {
  const { root, at, record } = fixture(t);
  const evidence = path.join(root, 'retirement.json');
  fs.writeFileSync(evidence, JSON.stringify({ original_exit: 7, stopped_tree_verified: true }));
  const retirement = { producer_stopped_verified: true, reason: 'Owned producer tree stopped; diagnosis preserved', evidence_ref: evidence };
  record('failed-retirement', [['outputs/failed-retirement', 'output']], { state: 'failed', membership_complete: false });
  fs.mkdirSync(at('outputs'), { recursive: true });fs.writeFileSync(at('outputs/failed-retirement'), 'partial');
  assert.equal(lifecycle.finalize(root, 'failed-retirement', retirement).status, 'retained');
  fs.unlinkSync(at('outputs/failed-retirement'));
  assert.equal(lifecycle.finalize(root, 'failed-retirement').status, 'retained');
  assert.throws(() => lifecycle.finalize(root, 'failed-retirement', { ...retirement, producer_stopped_verified: false }), /Verified producer/);
  assert.throws(() => lifecycle.finalize(root, 'failed-retirement', { ...retirement, evidence_ref: at('outputs/failed-retirement/evidence') }), /must survive/);
  assert.throws(() => lifecycle.finalize(root, 'failed-retirement', { ...retirement, evidence_ref: path.join(root, 'missing') }), /ENOENT/);
  const result = lifecycle.finalize(root, 'failed-retirement', retirement);
  assert.equal(result.status, 'finalized'); assert.equal(result.retirement.original_state, 'failed');
  assert.equal(JSON.parse(fs.readFileSync(evidence)).original_exit, 7);
  record('unknown-retirement', [['outputs/never-created', 'output']], { state: 'pending', membership_complete: false });
  record('consumer', [['outputs/consumer', 'output']], { references: [{ id: 'unknown-retirement', reason: 'needed' }] });
  assert.equal(lifecycle.finalize(root, 'unknown-retirement', retirement).status, 'retained');
});

test("CLI retirement pins surviving evidence and retains live members and consumers", t => {
  const { root, at, record } = fixture(t);
  const evidence = path.join(root, 'retirement.json');
  fs.writeFileSync(evidence, JSON.stringify({ producerTreeStopped: true, exitCode: null }));
  const digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(evidence)).digest('hex');
  const args = ['finalize', '--project-root', root, '--id', 'stopped', '--producer-stopped-verified', 'true',
    '--evidence-ref', evidence, '--evidence-sha256', digest, '--reason', 'Verified exact producer closure'];
  record('stopped', [['outputs/partial', 'output']], { state: 'pending', membership_complete: false });
  for (const key of ['--producer-stopped-verified', '--evidence-ref', '--evidence-sha256', '--reason']) {
    const incomplete = [...args], index = incomplete.indexOf(key); incomplete.splice(index, 2);
    assert.throws(() => lifecycle.main(incomplete), /Explicit verified retirement/);
  }
  fs.writeFileSync(evidence, 'changed');
  assert.throws(() => lifecycle.main([...args]), /SHA256 changed/);
  fs.writeFileSync(evidence, JSON.stringify({ producerTreeStopped: true, exitCode: null }));
  fs.mkdirSync(path.dirname(at('outputs/partial')), { recursive: true });
  fs.writeFileSync(at('outputs/partial'), 'retained evidence');
  assert.equal(lifecycle.main([...args]).status, 'retained');
  fs.unlinkSync(at('outputs/partial'));
  record('consumer', [['outputs/consumer', 'output']], { references: [{ id: 'stopped', reason: 'needed' }] });
  assert.equal(lifecycle.main([...args]).status, 'retained');
  assert.equal(lifecycle.finalize(root, 'consumer').status, 'finalized');
  const result = lifecycle.main([...args]);
  assert.equal(result.status, 'finalized');
  assert.equal(result.retirement.sha256, digest);
  assert.equal(result.retirement.original_state, 'pending');
  assert.equal(JSON.parse(fs.readFileSync(evidence)).exitCode, null);
});

test("Windows lifecycle acceptance includes module management and keeps metric fixtures in the registered run", () => {
  const { commands } = require("./check-artifact-lifecycle.cjs");
  const run = path.join(repo, "artifacts/tasks/lifecycle-checks/runs/command-fixture");
  const selected = commands("windows", "win32", repo, run);
  const metrics = selected.find(([, args]) => args.includes("scripts/test-build-metrics.ps1"));
  assert.ok(metrics);
  assert.equal(metrics[1][metrics[1].indexOf("-OutputDirectory") + 1], path.join(run, "temporary/metrics"));
  assert.ok(selected.some(([, args]) => args.includes("scripts/test-build-module-cache.ps1")));
  for (const [flag, fixture] of [["-RegistryOnly", "module-registry"], ["-LegacyRegistryOnly", "module-legacy-registry"]]) {
    const entry = selected.find(([, args]) => args.includes("scripts/test-build-module-cache.ps1") && args.includes(flag));
    assert.ok(entry, `${flag} must be part of Windows acceptance`);
    assert.equal(entry[1][entry[1].indexOf("-FixtureRoot") + 1], path.join(run, "temporary", fixture));
  }
});

function stopEvidence(root, record, extra = {}) {
  const evidence = path.join(root, "terminal.json");
  fs.writeFileSync(evidence, "owned producer and process tree stopped; exit 7");
  return { owner: record.owner, expected_revision: record.revision, producer_stopped_verified: true,
    outcome: "failure", exit_code: 7, reason: "Verified owned terminal result", evidence_ref: evidence,
    evidence_sha256: require("node:crypto").createHash("sha256").update(fs.readFileSync(evidence)).digest("hex"), ...extra };
}
test("known failure releases execution references while persistent and untyped references require explicit release", t => {
  const { root, at, record } = fixture(t);
  record("target", [["shared/target", "cache"]]); fs.mkdirSync(at("shared/target"), { recursive: true });
  const before = record("consumer", [["outputs/consumer", "output"]], { state: "pending", membership_complete: false,
    references: [{ id: "target", reason: "active", kind: "execution", reference_id: "active" },
      { id: "target", reason: "installed", kind: "installation", reference_id: "installed" },
      { id: "target", reason: "legacy", reference_id: "legacy" }] });
  const request = stopEvidence(root, before);
  const closed = lifecycle.closeLifecycle(root, "consumer", request);
  assert.equal(closed.state, "failed"); assert.equal(closed.membership_complete, true);
  assert.equal(closed.producer.exit_code, 7);
  assert.deepEqual(closed.references.map(ref => ref.reference_id), ["installed", "legacy"]);
  assert.deepEqual(lifecycle.planCleanup(root, { paths: [at("outputs/consumer")] }).groups[0].blockers, []);
  assert.equal(lifecycle.closeLifecycle(root, "consumer", request).revision, closed.revision);
  assert.throws(() => lifecycle.closeLifecycle(root, "consumer", { ...request, owner: "other" }), /owner/);
  assert.throws(() => lifecycle.closeLifecycle(root, "consumer", { ...request, expected_revision: closed.revision, reason: "different retry" }), /Conflicting/);
  const release = { owner: closed.owner, expected_revision: closed.revision, reason: "Installation and legacy consumers independently retired",
    evidence_ref: request.evidence_ref, evidence_sha256: request.evidence_sha256, reference_ids: ["installed", "legacy"] };
  const released = lifecycle.releaseReferences(root, "consumer", release);
  assert.deepEqual(released.references, []);
  assert.equal(lifecycle.releaseReferences(root, "consumer", release).revision, released.revision);
  assert.deepEqual(lifecycle.planCleanup(root, { paths: [at("shared/target")] }).groups[0].blockers, []);
  assert.throws(() => lifecycle.releaseReferences(root, "consumer", { ...release, reference_ids: ["active"] }), /Stale/);
  fs.writeFileSync(request.evidence_ref, "changed evidence");
  assert.throws(() => lifecycle.closeLifecycle(root, "consumer", request), /SHA256/);
});
test("unknown terminal outcome remains protected; closure cannot promote legacy ownership flags", t => {
  const { root, at, record } = fixture(t);
  const before = record("unknown", [["outputs/unknown", "output"]], { state: "pending", membership_complete: false });
  const request = stopEvidence(root, before, { outcome: "unknown", exit_code: null });
  const closed = lifecycle.closeLifecycle(root, "unknown", request);
  assert.equal(closed.state, "pending"); assert.equal(closed.membership_complete, false);
  assert.ok(lifecycle.planCleanup(root, { paths: [at("outputs/unknown")] }).groups[0].blockers.includes("incomplete-membership"));
  const legacy = record("legacy-close", [], { state: "pending", membership_complete: false,
    members: [{ path: at("outputs/legacy"), role: "output", generated: false, protection_known: false }] });
  const stopped = lifecycle.closeLifecycle(root, legacy.id, stopEvidence(root, legacy));
  assert.equal(stopped.members[0].generated, false); assert.equal(stopped.members[0].protection_known, false);
  assert.ok(lifecycle.planCleanup(root, { paths: [at("outputs/legacy")] }).groups[0].blockers.includes("unconfirmed-generated-ownership"));
});
test("closure and release reject stale revisions, unverifiable stops and invalid evidence before mutation", t => {
  const { root, record } = fixture(t);
  const before = record("stale", [["outputs/stale", "output"]], { state: "pending", membership_complete: false });
  const request = stopEvidence(root, before);
  for (const invalid of [{ expected_revision: 0 }, { producer_stopped_verified: false }, { reason: " " },
    { evidence_ref: path.join(root, "missing") }, { evidence_ref: path.dirname(root) }, { evidence_sha256: "0".repeat(64) }]) {
    assert.throws(() => lifecycle.closeLifecycle(root, before.id, { ...request, ...invalid }));
    assert.equal(lifecycle.catalog(root)[0].revision, before.revision);
  }
  const requestFile = path.join(root, "close-request.json"); fs.writeFileSync(requestFile, JSON.stringify(request));
  assert.equal(lifecycle.main(["close", "--project-root", root, "--id", before.id, "--request-file", requestFile]).state, "failed");
  assert.throws(() => lifecycle.main(["close", "--project-root", root, "--id", before.id, "--request-file", "relative.json"]), /absolute/);
});
test("catalog lock serializes mutations, and reference registration preserves external and planned targets", t => {
  const { root, at, record } = fixture(t);
  const before = record("locked", [["outputs/locked", "output"]], { state: "pending", membership_complete: false });
  const request = stopEvidence(root, before);
  lifecycle.withCatalogLock(root, () => {
    assert.throws(() => record("other", [["outputs/other", "output"]]), /EEXIST/);
    assert.throws(() => lifecycle.closeLifecycle(root, before.id, request), /EEXIST/);
    assert.throws(() => lifecycle.releaseReferences(root, before.id, request), /EEXIST/);
    assert.throws(() => lifecycle.finalize(root, before.id), /EEXIST/);
  });
  record("planned", [["outputs/planned", "output"]], { state: "pending", membership_complete: false });
  const external = record("external", [["outputs/external", "output"]], { references: [{ id: "another-project:key", reason: "external cache" }, { id: "planned", reason: "future output" }] });
  assert.equal(external.references.length, 2);
  record("absent", [["outputs/absent", "output"]]);
  assert.throws(() => record("dangling", [["outputs/dangling", "output"]], { references: [{ id: "absent", reason: "already removed" }] }), /no extant/);
  fs.mkdirSync(at("outputs/absent"), { recursive: true });
  record("live", [["outputs/live", "output"]], { references: [{ id: "absent", reason: "still present" }] });
});
test("shared producer generation reopens only known stopped identity and invalidates old retry receipts", t => {
  const { root, record } = fixture(t);
  const before = record("generation", [["outputs/generation", "output"]], { state: "pending", membership_complete: false, generation: "one" });
  const request = stopEvidence(root, before);
  const closed = lifecycle.closeLifecycle(root, before.id, request);
  assert.throws(() => record(before.id, [["outputs/generation", "output"]], { state: "pending", membership_complete: false }), /Closed/);
  const reopened = record(before.id, [["outputs/generation", "output"]], { state: "pending", membership_complete: false, generation: "two", expected_revision: closed.revision });
  assert.equal(reopened.producer, undefined); assert.equal(reopened.close_receipt, undefined);
  assert.throws(() => lifecycle.closeLifecycle(root, before.id, request), /Stale/);
  assert.throws(() => record(before.id, [["outputs/generation", "output"]], { state: "pending", membership_complete: false, generation: "three", expected_revision: reopened.revision }), /known stopped/);
});

test("PowerShell deletion holds the shared catalog lock through physical removal", { skip: process.platform !== "win32" }, t => {
  const { root, at, record } = fixture(t);
  const member = at("outputs/ps-lock"); fs.mkdirSync(path.dirname(member), { recursive: true }); fs.writeFileSync(member, "owned fixture");
  record("ps-lock", [["outputs/ps-lock", "output"]]);
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const probe = "const l=require(" + JSON.stringify(require.resolve("./artifact-lifecycle.cjs")) + ");try{l.recordLifecycle(" + JSON.stringify(root) + ",{id:'new-consumer',kind:'run',owner:'fixture',state:'pending',membership_complete:false,members:[{path:" + JSON.stringify(at("outputs/new-consumer")) + ",role:'output'}],references:[{id:'ps-lock',reason:'race'}]});process.exitCode=9}catch(e){if(e.code!=='EEXIST')throw e;process.stdout.write('catalog-locked')}";
  const script = "$ErrorActionPreference='Stop'; . " + quote(path.join(__dirname, "artifact-lifecycle.ps1")) + "; $result=Invoke-ArtifactLifecycleCleanup -ProjectRoot " + quote(root) + " -CandidatePath " + quote(member) + " -Apply $true -CheckMember { param($member) } -RemoveMember { param($member); $probe=& " + quote(process.execPath) + " -e " + quote(probe) + "; if ($LASTEXITCODE -ne 0 -or $probe -ne 'catalog-locked') { throw 'catalog lock was not held' }; Remove-Item -LiteralPath $member -ErrorAction Stop }; if ($result.status -ne 'deleted') { throw ($result | ConvertTo-Json -Depth 10 -Compress) }; Write-Output 'ps-lock-passed'";
  const executable = "pwsh";
  const child = require("node:child_process").spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH || "") },
  });
  assert.equal(child.status, 0, child.error?.message || child.stderr || child.stdout);
  assert.match(child.stdout, /ps-lock-passed/); assert.equal(fs.existsSync(member), false);
});
