"use strict";
// Retain the smallest real acceptance: boundary/whitelist refusal before owner
// publication, then actual metadata custody, deletion, CAS and child closure.
// Partial/unknown recovery is protected in product code; fault fixtures are not
// admitted here because they lack a completed formal replan cleanup contract.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
// Keep these boundaries when simplifying recovery: unknown/partial refusal and
// legacy aggregate false must survive changes to the child-only stop contract.
function recoveryPure({ emit = true } = {}) {
  const { validateRequest, successfulRelease, EMPTY_SHA256 } = require("./lifecycle-empty-publication-recovery.cjs");
  const { validateBlockedPlanStop } = require("./deployment-control-retirement.cjs");
  const sha = value => createHash("sha256").update(value).digest("hex");
  const root = path.resolve("pure-recovery-project"), outputDirectory = path.join(root, "artifacts/tasks/pure/reports");
  const entry = id => ({ path: path.join(root, "artifacts/maintenance/lifecycles", sha(id) + ".pending"),
    identity: { dev: "1", ino: id === "old-a" ? "2" : "3", mode: "33206", nlink: "1", size: "0" }, sha256: EMPTY_SHA256 });
  const request = { schema: 1, operation: "lifecycle-empty-publication-recovery", platform: "win32", arch: "x64",
    artifactProjectRoot: root, projectIdentity: { dev: "1", ino: "1", mode: "16822" }, outputDirectory,
    original_writer: "unknown", reason: "Explicit exact two-file abort", runLifecycleId: "run:pure", owner: "pure", caller_revision: 1,
    entries: [entry("old-a"), entry("old-b")] };
  const names = [];
  const pass = (name, action) => { action(); names.push(name); };
  pass("exact identity-pinned request", () => assert.equal(validateRequest(request), request));
  for (const [name, change] of [
    ["one-file scope", value => value.entries.pop()],
    ["duplicate file", value => value.entries[1] = value.entries[0]],
    ["nonempty content", value => value.entries[0].identity.size = "1"],
    ["nonempty hash", value => value.entries[0].sha256 = "0".repeat(64)],
    ["unknown identity", value => delete value.entries[0].identity.ino],
    ["multiple hardlinks", value => value.entries[0].identity.nlink = "2"],
    ["canonical target", value => value.entries[0].path = value.entries[0].path.replace(".pending", ".json")],
    ["outside catalog", value => value.entries[0].path = path.join(root, "outside", path.basename(value.entries[0].path))],
    ["invented producer stop", value => value.producer_stopped_verified = true],
    ["invented writer", value => value.original_writer = "stopped"],
    ["unbounded caller revision", value => value.caller_revision = Number.MAX_SAFE_INTEGER + 1]
  ]) pass("reject " + name, () => { const value = structuredClone(request); change(value); assert.throws(() => validateRequest(value)); });
  const inside = (a, b) => { const relative = path.relative(a, b); return relative === "" || relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative); };
  const guard = require("./deployment-control-retirement-native.cjs").createNativeGuard({ sha, overlaps: (a, b) => inside(a, b) || inside(b, a) });
  pass("disjoint catalog", () => guard.validatePublicationCatalog(root, request.entries, [{ id: "other", members: [{ path: outputDirectory }] }]));
  pass("reject digest owner association", () => assert.throws(() => guard.validatePublicationAssociations(request.entries, [{ id: "old-a" }]), /association/));
  pass("reject member ownership", () => assert.throws(() => guard.validatePublicationCatalog(root, request.entries, [{ id: "other", members: [{ path: request.entries[0].path }] }]), /ownership/));
  pass("reject canonical reference", () => assert.throws(() => guard.validatePublicationCatalog(root, request.entries, [{ id: "other", provenance_ref: request.entries[0].path.replace(".pending", ".json") }]), /ownership/));
  const release = { released: true, native_exit_observed: true, native_exit_code: 0, native_signal: null, native_close_observed: true, reservations_retained: [] };
  pass("release requires actual close", () => { assert(successfulRelease(release)); assert(!successfulRelease({ ...release, native_close_observed: false })); assert(!successfulRelease({ ...release, native_exit_code: null })); });
  const query = { exit_observed: true, exit_code: 0, signal: null, close_observed: true, stdout_drained: true, stderr_drained: true, error: null, overflow: false };
  const attribute = { pid: 13, status: 0, signal: null, process_returned: true, stdout_drained: true, stderr_drained: true };
  const plan = { operation: "deployment-control-retirement", record: { id: "work:exact", revision: 1, owner: "pure", generation: "generation" },
    files: { plan: "plan", journal: "journal" }, nativeSnapshot: { queries: [query] }, preparationAttributeChecks: [attribute] };
  const intent = { schema: 1, operation: plan.operation, phase: "applying", worker_pid: 11, planPath: "plan", planSha256: sha("plan") };
  const result = { schema: 1, operation: plan.operation, id: plan.record.id, worker_pid: 11, planPath: "plan", planSha256: sha("plan"), status: "blocked",
    removed: [], errors: [{ message: "Pending lifecycle publication requires existing explicit recovery" }], nativeOwner: null, nativeRelease: null,
    reservationObservation: null, reservationFinalization: null, finalization: null, maintenanceOwner: { pid: 12, parent_pid: 11 }, maintenanceRelease: release, nativeSnapshot: { queries: [query] } };
  const original = { schema: 1, producer_stopped_verified: false, process_tree_stopped_verified: false,
    supervisor: { pid: 10, exit: { code: 1, signal: null }, error: null, close_observed: true, stdout_drained: true, stderr_drained: true },
    worker: { controllerPid: 10, targets: [{ prepared: { planPath: "plan", planSha256: sha("plan") },
      applied: { success: false, worker: { pid: 11, exit_observed: true, exit_code: 1, signal: null, close_observed: true }, result } }] } };
  const stopFor = original => {
    const applied = original.worker.targets[0].applied;
    return { schema: 1, operation: "blocked-control-reprepare-child-stop", scope: "original-attempt-child-only", outerCallerRemainsActive: true,
      originalAggregate: { producer_stopped_verified: false, process_tree_stopped_verified: false },
      sourceReview: { scope: "original-attempt-child-only", unobservedExecutionPaths: false, preparationCatalogReturnGuarantee: true }, record: plan.record,
      preparationCatalog: { evidenceType: "source-enforced-synchronous-return", native_pid: null, exit_event: null, close_event: null,
        prepare_return_observed: true, planPath: applied.result.planPath, planSha256: applied.result.planSha256 },
      children: { supervisor: original.supervisor, applyWorker: applied.worker, queries: [...plan.nativeSnapshot.queries, ...applied.result.nativeSnapshot.queries],
        attributeHelpers: [...plan.preparationAttributeChecks, ...(applied.result.windowsAttributeChecks || [])],
        maintenance: { owner: applied.result.maintenanceOwner, release: applied.result.maintenanceRelease } } };
  };
  const events = [{ phase: "planned", files: plan.files }, { phase: "terminal", status: "blocked", maintenanceRelease: release, nativeRelease: null }];
  pass("confirmed child-only physical-zero failure", () => assert(validateBlockedPlanStop(plan, stopFor(original), result, intent, events, original)));
  for (const [name, change] of [
    ["unknown result", (s, r) => r.status = "unknown"],
    ["partial result", (s, r) => r.status = "partial"],
    ["physical removal", (s, r) => r.removed.push("removed")],
    ["reservation began", (s, r) => r.reservationObservation = []],
    ["catalog custody began", (s, r) => r.nativeOwner = { pid: 12 }],
    ["worker not closed", s => s.worker.targets[0].applied.worker.close_observed = false],
    ["supervisor not drained", s => s.supervisor.stdout_drained = false],
    ["different failure", (s, r) => r.errors[0].message = "unrelated"],
    ["unfinished native query", (s, r) => r.nativeSnapshot.queries[0].close_observed = false]
  ]) pass("reject " + name, () => {
    const s = structuredClone(original), r = s.worker.targets[0].applied.result;
    change(s, r); assert.throws(() => validateBlockedPlanStop(plan, stopFor(s), r, intent, events, s));
  });
  pass("reject physical journal intent", () => assert.throws(() => validateBlockedPlanStop(plan, stopFor(original), result, intent, [events[0], { phase: "unlink-intent" }, events[1]], original)));
  pass("reject whole-outer stop promotion", () => { const s = stopFor(original); s.producer_stopped_verified = true; assert.throws(() => validateBlockedPlanStop(plan, s, result, intent, events, original)); });
  pass("reject inactive outer claim", () => { const s = stopFor(original); s.outerCallerRemainsActive = false; assert.throws(() => validateBlockedPlanStop(plan, s, result, intent, events, original)); });
  pass("reject fabricated preparation PID", () => { const s = stopFor(original); s.preparationCatalog.native_pid = 14; assert.throws(() => validateBlockedPlanStop(plan, s, result, intent, events, original)); });
  pass("reject missing synchronous-return proof", () => { const s = stopFor(original); s.sourceReview.preparationCatalogReturnGuarantee = false; assert.throws(() => validateBlockedPlanStop(plan, s, result, intent, events, original)); });
  pass("reject undrained attribute helper", () => { const p = structuredClone(plan); p.preparationAttributeChecks[0].stdout_drained = false; const s = stopFor(original); s.children.attributeHelpers = p.preparationAttributeChecks; assert.throws(() => validateBlockedPlanStop(p, s, result, intent, events, original)); });
  const same = (a, b, message) => assert.deepEqual(a, b, message);
  const checked = (base, filename) => { assert(inside(base, filename) && path.isAbsolute(filename)); return filename; };
  const scopedGuard = require("./deployment-control-retirement-native.cjs").createNativeGuard({ sha, checked, same,
    overlaps: (a, b) => inside(a, b) || inside(b, a) });
  const catalog = path.join(root, "artifacts/maintenance/lifecycles"), foreignId = "run:foreign-disjoint", foreignPath = path.join(root, "artifacts/foreign/payload");
  const foreign = { schema: 1, status: "active", id: foreignId, token: "foreign-token-1", manifest_revision: 1,
    lease_owner: { schema: 2, pid: 123, token: "lease-token", operation: "group_reservation", acquired_at_ms: 1 },
    group_scope: { id: foreignId, owner: "foreign", kind: "run", members: ["foreign-member"], membership_source: catalog, membership_source_identity: sha("source") },
    members: [{ id: "foreign-member", owner: "foreign", path: foreignPath, lifecycle_group_id: foreignId, references: [], provenance: null }],
    source: catalog, source_fence: sha("source"), source_owner: { schema: 1, id: foreignId, owner: "foreign", kind: "run", state: "complete", revision: 1,
      members: [{ path: foreignPath, role: "artifact", generated: true, protection_known: true }], references: [] } };
  const scope = { paths: [...request.entries.flatMap(entry => [entry.path, entry.path.slice(0, -8) + ".json"]), outputDirectory], ids: [request.runLifecycleId],
    pendingStems: request.entries.map(entry => path.basename(entry.path, ".pending")) };
  const record = value => ({ name: sha(JSON.stringify(value.id)) + ".json", value });
  const originalRaw = JSON.stringify(foreign);
  pass("scoped same-catalog disjoint reservation retains raw active bytes", () => {
    scopedGuard.validateReservations(root, [record(foreign)], [], scope); assert.equal(JSON.stringify(foreign), originalRaw);
  });
  pass("exact logical scope admits disjoint prefix id and descriptive mention", () => {
    const value = structuredClone(foreign), id = request.runLifecycleId + ":unrelated";
    value.id = id; value.group_scope.id = id; value.source_owner.id = id; value.members[0].lifecycle_group_id = id;
    value.source_owner.references.push({ id: "other", reason: "Unrelated description mentioning " + request.runLifecycleId });
    scopedGuard.validateReservations(root, [record(value)], [], scope);
  });
  pass("unspecified scope retains strict foreign refusal", () => assert.throws(() => scopedGuard.validateReservations(root, [record(foreign)]), /Foreign/));
  pass("scoped disjoint registration binding", () => {
    const value = structuredClone(foreign); value.purpose = "registration";
    value.group_scope.membership_source_identity = null;
    delete value.members[0].lifecycle_group_id;
    value.registration_sources = [{ source: value.source, source_fence: value.source_fence, source_owner: structuredClone(value.source_owner) }];
    scopedGuard.validateReservations(root, [record(value)], [], scope);
  });
  pass("native producer member optional references remain absent", () => {
    const value = structuredClone(foreign); delete value.members[0].references;
    scopedGuard.validateReservations(root, [record(value)], [], scope);
    assert(!Object.hasOwn(value.members[0], "references"));
  });
  const actual49PacketRaw = "{\n  \"observed\": [\n    {\n      \"fence\": {\n        \"group_scope\": {\n          \"id\": \"run:scoped-reservation-tiny-r5:foreign\",\n          \"kind\": \"run\",\n          \"members\": [\n            \"run:scoped-reservation-tiny-r5:foreign:producer:0\"\n          ],\n          \"membership_source\": \"C:\\\\Users\\\\felre\\\\Desktop\\\\pi-harness-init\\\\artifacts\\\\tasks\\\\fw03v\\\\runs\\\\native-613162bb\\\\temporary\\\\root-commit-control\\\\isolated-unit\\\\empty-publication-candidate\\\\acceptance\\\\tiny-r5-01-project\\\\artifacts/maintenance/lifecycles\",\n          \"membership_source_identity\": \"37bad0d9c51d160eda22d5344a67c2b00c7104d56608fa8968f164d1b8d947eb\",\n          \"owner\": \"scoped-foreign-fixture\",\n          \"version\": \"r5-tiny\"\n        },\n        \"id\": \"run:scoped-reservation-tiny-r5:foreign\",\n        \"lease_owner\": {\n          \"acquired_at_ms\": 1793938688742,\n          \"operation\": \"group_reservation\",\n          \"pid\": 46560,\n          \"schema\": 2,\n          \"token\": \"46560-1793938688742-23ac0a71845d4804\"\n        },\n        \"manifest_revision\": 0,\n        \"members\": [\n          {\n            \"generated\": true,\n            \"id\": \"run:scoped-reservation-tiny-r5:foreign:producer:0\",\n            \"lifecycle_group_id\": \"run:scoped-reservation-tiny-r5:foreign\",\n            \"owner\": \"scoped-foreign-fixture\",\n            \"path\": \"C:\\\\Users\\\\felre\\\\Desktop\\\\pi-harness-init\\\\artifacts\\\\tasks\\\\fw03v\\\\runs\\\\native-613162bb\\\\temporary\\\\root-commit-control\\\\isolated-unit\\\\empty-publication-candidate\\\\acceptance\\\\tiny-r5-01-project\\\\artifacts\\\\tasks\\\\foreign\\\\payload.txt\",\n            \"protection_known\": true,\n            \"role\": \"artifact\"\n          }\n        ],\n        \"schema\": 1,\n        \"source\": \"C:\\\\Users\\\\felre\\\\Desktop\\\\pi-harness-init\\\\artifacts\\\\tasks\\\\fw03v\\\\runs\\\\native-613162bb\\\\temporary\\\\root-commit-control\\\\isolated-unit\\\\empty-publication-candidate\\\\acceptance\\\\tiny-r5-01-project\\\\artifacts/maintenance/lifecycles\",\n        \"source_fence\": \"37bad0d9c51d160eda22d5344a67c2b00c7104d56608fa8968f164d1b8d947eb\",\n        \"source_owner\": {\n          \"created_at\": \"2026-11-06T04:18:07.426Z\",\n          \"id\": \"run:scoped-reservation-tiny-r5:foreign\",\n          \"kind\": \"run\",\n          \"members\": [\n            {\n              \"generated\": true,\n              \"path\": \"C:\\\\Users\\\\felre\\\\Desktop\\\\pi-harness-init\\\\artifacts\\\\tasks\\\\fw03v\\\\runs\\\\native-613162bb\\\\temporary\\\\root-commit-control\\\\isolated-unit\\\\empty-publication-candidate\\\\acceptance\\\\tiny-r5-01-project\\\\artifacts\\\\tasks\\\\foreign\\\\payload.txt\",\n              \"protection_known\": true,\n              \"role\": \"artifact\"\n            }\n          ],\n          \"membership_complete\": true,\n          \"owner\": \"scoped-foreign-fixture\",\n          \"references\": [],\n          \"revision\": 1,\n          \"schema\": 1,\n          \"state\": \"complete\",\n          \"updated_at\": \"2026-11-06T04:18:07.426Z\",\n          \"version\": \"r5-tiny\"\n        },\n        \"status\": \"active\",\n        \"token\": \"46560-1793938688742-23ac0a71845d4804\"\n      },\n      \"id\": \"run:scoped-reservation-tiny-r5:foreign\"\n    }\n  ],\n  \"reserved\": [\n    \"run:scoped-reservation-tiny-r5:foreign\"\n  ]\n}\n";
  pass("exact actual49 mixed-separator native packet is disjoint and unchanged", () => {
    const actual = JSON.parse(actual49PacketRaw), fence = actual.observed[0].fence;
    const actualRoot = path.dirname(path.dirname(path.dirname(fence.source.replaceAll("/", path.sep))));
    const actualScope = { paths: [path.join(actualRoot, "artifacts/workspace"), path.join(actualRoot, "artifacts/tasks/tiny/runs/scoped-controller/reports")],
      ids: ["run:scoped-reservation-tiny-r5:controller", "workspace:scoped-tiny-original-finalized"], pendingStems: [] };
    scopedGuard.validateReservations(actualRoot, [record(fence)], [], actualScope);
    assert.equal(JSON.stringify(actual), JSON.stringify(JSON.parse(actual49PacketRaw)));
  });
  pass("registration mixed-separator source bindings remain disjoint", () => {
    const value = structuredClone(foreign), mixed = catalog.replaceAll(path.sep, "/");
    value.source = mixed; value.group_scope.membership_source = mixed; value.purpose = "registration";
    value.registration_sources = [{ source: mixed, source_fence: value.source_fence, source_owner: structuredClone(value.source_owner) }];
    scopedGuard.validateReservations(root, [record(value)], [], scope);
  });
  for (const [name, source] of [
    ["parent", path.dirname(catalog)], ["sibling", catalog + "-other"], ["relative", "artifacts/maintenance/lifecycles"],
    ["dot", catalog + path.sep + "."], ["dotdot", catalog + path.sep + ".." + path.sep + "lifecycles"],
    ["different case", catalog.replace("lifecycles", "LIFECYCLES")]
  ]) pass("namespace representation refusal: " + name, () => {
    for (const position of ["top", "group", "registration"]) {
      const value = structuredClone(foreign);
      if (position === "top") value.source = source;
      if (position === "group") value.group_scope.membership_source = source;
      if (position === "registration") { value.purpose = "registration"; value.registration_sources = [{ source, source_fence: value.source_fence, source_owner: structuredClone(value.source_owner) }]; }
      assert.throws(() => scopedGuard.validateReservations(root, [record(value)], [], scope));
    }
  });
  function recoveredForeign() {
    const value = structuredClone(foreign), owner = value.source_owner;
    owner.state = "pending"; owner.revision = 3; owner.generation = "synthetic-generation"; owner.membership_complete = true;
    owner.producer = { status: "stopped", outcome: "unknown", exit_code: null, reason: "Stored metadata only" };
    owner.cleanup_recovery = { schema: 1, id: owner.id, kind: owner.kind, owner: owner.owner, version: owner.version ?? null, generation: owner.generation,
      source_revision: 2, original_state: owner.state, original_producer: structuredClone(owner.producer), original_membership_complete: false,
      members: structuredClone(owner.members), evidence_ref: path.join(root, "artifacts/foreign-evidence.json"), evidence_sha256: sha("unread external proof"),
      reason: "Existing recovery metadata classified without trusting stop flags", producer_stopped_verified: true, membership_complete_verified: true,
      verified_at: "2026-11-06T00:00:00.000Z" };
    owner.recover_receipt = { reason: "Recorded metadata", evidence_ref: owner.cleanup_recovery.evidence_ref,
      evidence_sha256: owner.cleanup_recovery.evidence_sha256, request_sha256: sha("recovery request") };
    return value;
  }
  pass("disjoint cleanup recovery and generation classified without following proof", () => {
    const value = recoveredForeign(), bytes = JSON.stringify(value);
    scopedGuard.validateReservations(root, [record(value)], [], scope); assert.equal(JSON.stringify(value), bytes);
    const nullable = structuredClone(value); nullable.source_owner.generation = null; nullable.source_owner.cleanup_recovery.generation = null;
    scopedGuard.validateReservations(root, [record(nullable)], [], scope);
  });
  for (const [name, change] of [
    ["recovery evidence path", v => v.source_owner.cleanup_recovery.evidence_ref = outputDirectory],
    ["recover receipt evidence path", v => v.source_owner.recover_receipt.evidence_ref = request.entries[0].path],
    ["recovery related member", v => { v.source_owner.members[0].path = request.entries[0].path; v.source_owner.cleanup_recovery.members[0].path = request.entries[0].path; }],
    ["recovery nested exact id", v => { v.source_owner.producer.reason = request.runLifecycleId; v.source_owner.cleanup_recovery.original_producer.reason = request.runLifecycleId; }],
    ["recovery owner id mismatch", v => v.source_owner.cleanup_recovery.id = "other-id"],
    ["recovery owner kind mismatch", v => v.source_owner.cleanup_recovery.kind = "work"],
    ["recovery generation mismatch", v => v.source_owner.cleanup_recovery.generation = "other-generation"],
    ["recovery original producer mismatch", v => v.source_owner.cleanup_recovery.original_producer.exit_code = 0],
    ["recovery member mismatch", v => v.source_owner.cleanup_recovery.members[0].path = foreignPath + ".changed"],
    ["recovery malformed hash", v => v.source_owner.cleanup_recovery.evidence_sha256 = "bad"],
    ["recovery malformed revision", v => v.source_owner.cleanup_recovery.source_revision = 0],
    ["recovery malformed boolean", v => v.source_owner.cleanup_recovery.original_membership_complete = "false"],
    ["recovery unknown object", v => v.source_owner.cleanup_recovery.ignore = {}],
    ["recover receipt unknown object", v => v.source_owner.recover_receipt.ignore = {}]
  ]) pass("recovery scope refusal: " + name, () => { const value = recoveredForeign(); change(value); assert.throws(() => scopedGuard.validateReservations(root, [record(value)], [], scope)); });
  for (const [name, change] of [
    ["logical id reference", value => value.source_owner.references.push({ id: request.runLifecycleId })],
    ["raw-id pending digest", value => value.source_owner.references.push({ id: "old-a" })],
    ["serde-id digest", value => value.source_owner.references.push({ id: sha(JSON.stringify(request.runLifecycleId)) })],
    ["member path", value => value.members[0].path = request.entries[0].path],
    ["canonical provenance", value => value.members[0].provenance_ref = request.entries[0].path.slice(0, -8) + ".json"],
    ["source-owner payload", value => value.source_owner.members[0].path = request.entries[0].path],
    ["source-owner reference path", value => value.source_owner.references.push({ id: "other", member_paths: [outputDirectory] })],
    ["reports evidence path", value => value.source_owner.producer = { evidence_ref: path.join(outputDirectory, "evidence.json") }],
    ["absolute provenance string", value => value.members[0].provenance = outputDirectory],
    ["foreign namespace", value => value.source = path.join(root, "other-catalog")],
    ["foreign binding owner", value => value.source_owner.id = "other-id"],
    ["malformed fence", value => value.source_fence = "bad"],
    ["unknown purpose", value => value.purpose = "ignored"],
    ["unknown top field", value => value.ignore = true],
    ["unknown source-owner field", value => value.source_owner.ignore = true],
    ["missing member owner", value => delete value.members[0].owner],
    ["wrong member lifecycle group", value => value.members[0].lifecycle_group_id = "other"],
    ["nonarray member references", value => value.members[0].references = {}],
    ["relative member path", value => value.members[0].path = "relative"],
    ["non-active status", value => value.status = "terminal"],
    ["malformed schema", value => value.schema = 2],
    ["registration unknown binding", value => { value.purpose = "registration"; value.registration_sources = [{ source: value.source, source_fence: value.source_fence, source_owner: value.source_owner, ignore: true }]; }],
    ["registration mismatched binding", value => { value.purpose = "registration"; value.registration_sources = [{ source: value.source, source_fence: value.source_fence, source_owner: { ...value.source_owner, id: "other-id" } }]; }]
  ]) pass("scoped refusal: " + name, () => { const value = structuredClone(foreign); change(value); assert.throws(() => scopedGuard.validateReservations(root, [record(value)], [], scope)); });
  pass("owned observer exact fence and missing observer protection", () => {
    const observer = { id: foreign.id, fence: structuredClone(foreign) };
    scopedGuard.validateReservations(root, [record(foreign)], [observer], scope);
    observer.fence.token = "changed";
    assert.throws(() => scopedGuard.validateReservations(root, [record(foreign)], [observer], scope), /Owned reservation/);
    assert.throws(() => scopedGuard.validateReservations(root, [], [observer], scope), /disappeared/);
  });
  pass("noncanonical filename refusal", () => assert.throws(() => scopedGuard.validateReservations(root, [{ name: "other.json", value: foreign }], [], scope), /identity\/path/));
  // Exercise the production bounded two-pass observation without files, native
  // calls or a fixture: only node:fs is replaced inside an isolated module VM.
  function observedReservations(change = null) {
    const vm = require("node:vm"), bytes = Buffer.from(originalRaw), altered = Buffer.from(originalRaw.replace("foreign-token-1", "foreign-token-2"));
    let opens = 0, listings = 0, fileIdentities = 0, closed = 0;
    const handles = new Map(), filename = record(foreign).name, second = "f".repeat(64) + ".json";
    const fakeFs = {
      readdirSync: () => { listings++; return change === "aggregate" ? [filename, second] : change === "membership" && listings >= 3 ? [filename, "new.lock"] : [filename]; },
      openSync: () => { const fd = ++opens; handles.set(fd, { bytes: change === "bytes" && opens > 1 ? altered : bytes, offset: 0 }); return fd; },
      readSync: (fd, buffer, offset, length) => { const handle = handles.get(fd), count = Math.min(length, handle.bytes.length - handle.offset); handle.bytes.copy(buffer, offset, handle.offset, handle.offset + count); handle.offset += count; return count; },
      closeSync: fd => { handles.delete(fd); closed++; }
    };
    const context = { module: { exports: {} }, Buffer, process, structuredClone,
      require: name => name === "node:fs" ? fakeFs : name === "./maintenance-owner-config.cjs" ? {} : require(name) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "deployment-control-retirement-native.cjs"), "utf8"), context);
    const observed = context.module.exports.createNativeGuard({ sha, checked, same: (a, b, message) => assert.equal(JSON.stringify(a), JSON.stringify(b), message),
      absent: () => false, overlaps: (a, b) => inside(a, b) || inside(b, a), identity: (file, kind) => kind === "directory" ? { dev: "1", ino: "1", mode: "16822" } :
        { dev: "1", ino: change === "identity" && ++fileIdentities > 2 ? "3" : "2", mode: "33206", nlink: "1", size: change === "aggregate" && path.basename(file) === second ? String(64 * 1024 * 1024) : String(bytes.length) } });
    try { observed.reservationRecords(root, [], scope); } finally {
      assert.equal(handles.size, 0); assert.equal(closed, opens);
      if (change === "aggregate") assert.equal(opens, 1, "Over-limit second file must not be opened or allocated");
    }
  }
  pass("bounded repeated reservation observation accepts unchanged bytes", () => observedReservations());
  for (const change of ["bytes", "identity", "membership"]) pass("bounded observation rejects changed " + change, () => assert.throws(() => observedReservations(change)));
  pass("aggregate observation rejects before allocating or opening over-limit file", () => assert.throws(() => observedReservations("aggregate"), /Aggregate reservation bytes/));
  // Retain this boundary against reintroducing occurrence-count limits while
  // simplifying the metadata walker. Keep the retained test independent of
  // task-owned historical records, which are retired after verification.
  const bi = { id: "synthetic-catalog-record", members: Array.from({ length: 12463 }, (_, i) => ({
    path: path.join(root, "generated", "unrelated", String(i % 4683))
  })) };
  const biBefore = JSON.stringify(bi);
  const historicalGuard = require("./deployment-control-retirement-native.cjs").createNativeGuard({ sha,
    checked: (base, filename) => filename, identity: () => ({ mode: "33206" }),
    overlaps: (a, b) => inside(a, b) || inside(b, a) });
  pass("12463 repeated path occurrences remain disjoint without mutation", () => {
    assert.equal(bi.members.length, 12463);
    historicalGuard.validatePublicationCatalog(root, request.entries, [bi]);
    assert.equal(JSON.stringify(bi), biBefore);
  });
  pass("late path after 10000 occurrences remains protected", () => {
    const copy = structuredClone(bi); copy.late = { path: request.entries[0].path };
    assert.throws(() => historicalGuard.validatePublicationCatalog(root, request.entries, [copy]), /ownership/);
  });
  pass("late logical id after 10000 occurrences remains protected", () => {
    const copy = structuredClone(bi); copy.late = { id: "old-a" };
    assert.throws(() => historicalGuard.validatePublicationCatalog(root, request.entries, [copy]), /association/);
  });
  const inspectProvenance = provenance => guard.validateInventoryClaims(root, outputDirectory,
    [{ id: "other", path: path.join(root, "other"), references: [], provenance }], []);
  pass("streaming provenance depth bound rejects", () => {
    let nested = null; for (let i = 0; i < 34; i++) nested = [nested];
    assert.throws(() => inspectProvenance(nested), /Unbounded native provenance/);
  });
  pass("streaming provenance node bound rejects", () => {
    assert.throws(() => inspectProvenance(new Array(2000000).fill(null)), /Unbounded native provenance/);
  });
  const ownershipGroupId = "run:synthetic-registry-source", ownershipMemberId = "synthetic-member";
  const ownership = {
    group: { id: ownershipGroupId, owner: "synthetic-owner", membership_complete: true,
      members: [ownershipMemberId], membership_source: path.join(root, "artifacts/maintenance/lifecycles"),
      membership_source_format: "producer_registry_v1", membership_source_identity: "a".repeat(64),
      provenance_ref: path.join(root, "artifacts/maintenance/lifecycles", sha(ownershipGroupId) + ".json") },
    item: { id: ownershipMemberId, owner: "synthetic-owner", lifecycle_group_id: ownershipGroupId,
      path: path.join(root, "generated", "unrelated-owner"), references: [] },
    decision: { id: ownershipMemberId, lifecycle_group_id: ownershipGroupId,
      decision_id: "synthetic-decision", decision: "delete", status: "pending", remaining: null }
  };
  const actualRoot = path.resolve(ownership.group.membership_source, "../../..");
  const actualTarget = path.join(ownership.group.membership_source, sha("old-a") + ".pending");
  const decisionCheck = (group, item = ownership.item, target = actualTarget) => guard.validateDecisionScope(actualRoot, target, [ownership.decision], [item], [group]);
  const claimsCheck = (group, target = actualTarget) => guard.validateInventoryClaims(actualRoot, target, [ownership.item], [group]);
  pass("pending decision registry namespace is disjoint without changing its record", () => {
    const before = JSON.stringify(ownership); assert.equal(decisionCheck(ownership.group).length, 1); claimsCheck(ownership.group); assert.equal(JSON.stringify(ownership), before);
  });
  for (const [name, change] of [
    ["source format", g => g.membership_source_format = "unknown"],
    ["nonboolean membership", g => g.membership_complete = null],
    ["source identity", g => g.membership_source_identity = "invalid"],
    ["blank owner", g => g.owner = " "],
    ["reference", g => g.references = [{ path: actualTarget }]]
  ]) pass("registry decision scope refusal: " + name, () => {
    const g = structuredClone(ownership.group); change(g); assert.throws(() => decisionCheck(g));
    if (name !== "reference") assert.throws(() => claimsCheck(g));
  });
  pass("registry decision related member remains protected", () => assert.throws(() => decisionCheck(ownership.group, { ...ownership.item, path: actualTarget })));
  pass("registry decision related provenance remains protected", () => assert.throws(() => decisionCheck({ ...ownership.group, provenance_ref: actualTarget })));
  for (const suffix of [".json", ".pending"]) pass("registry derived publication protects " + suffix, () => {
    const target = path.join(ownership.group.membership_source, sha(ownership.group.id) + suffix);
    assert.throws(() => decisionCheck(ownership.group, ownership.item, target)); assert.throws(() => claimsCheck(ownership.group, target));
  });
  pass("other registry namespace retains generic disjoint path classification", () => {
    const g = { ...ownership.group, membership_source: ownership.group.membership_source + "-other" };
    assert.equal(decisionCheck(g).length, 1); claimsCheck(g);
    const target = path.join(g.membership_source, "other.pending");
    assert.throws(() => decisionCheck(g, ownership.item, target)); assert.throws(() => claimsCheck(g, target));
  });
  pass("array registry identity cannot acquire namespace classification", () => {
    const g = { ...ownership.group, membership_source_identity: [ownership.group.membership_source_identity] };
    assert.throws(() => decisionCheck(g)); assert.throws(() => claimsCheck(g));
  });
  const incomplete = { ...ownership.group, membership_complete: false };
  pass("typed incomplete registry namespace is disjoint and raw unchanged", () => {
    const before = JSON.stringify(incomplete); claimsCheck(incomplete); assert.equal(JSON.stringify(incomplete), before);
  });
  pass("pending decision still requires complete group membership", () => assert.throws(() => decisionCheck(incomplete), /Incomplete/));
  for (const suffix of [".json", ".pending"]) pass("incomplete registry derived publication protects " + suffix, () => {
    assert.throws(() => claimsCheck(incomplete, path.join(incomplete.membership_source, sha(incomplete.id) + suffix)));
  });
  pass("incomplete registry provenance reference remains protected", () => {
    assert.throws(() => claimsCheck({ ...incomplete, provenance_ref: actualTarget }));
  });
  if (emit) console.log(JSON.stringify({ status: "passed", selectedScope: "recovery-pure", checks: names, actualNativeCalls: 0, fixtureCreated: false }));
}
if (process.argv[2] === "--recovery-pure") { recoveryPure(); return; }
const lifecycle = require("./artifact-lifecycle.cjs");
const { beginArtifactRun } = require("./artifact-run.cjs");
const { prepareDeploymentControlRetirement: prepare, applyDeploymentControlRetirement: apply } = require("./deployment-workspace.cjs");
const hash = value => createHash("sha256").update(value).digest("hex");
const fixture = process.argv[2], selectedScope = process.argv[3] || "happy";
assert.equal(process.platform, "win32", "Windows acceptance fixture required");
assert(fixture && path.isAbsolute(fixture), "Fresh absolute caller-owned fixture required");
assert.equal(selectedScope, "happy", "Only the cleanup-complete happy acceptance scope is admitted");
// Later inventory refactors must retain unrelated historical pending decisions
// while preserving target/group/provenance protection and unresolved bindings.
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative === "" || relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative); };
const { validateDecisionScope } = require("./deployment-control-retirement-native.cjs").createNativeGuard({ sha: hash, overlaps: (a, b) => inside(a, b) || inside(b, a) });
const decisionRoot = path.join(fixture, "decision-boundary"), decisionTarget = path.join(decisionRoot, "artifacts/target");
const pending = { id: "item", decision_id: "decision", status: "pending", lifecycle_group_id: "group" };
const ordinary = { id: "item", path: path.join(decisionRoot, "artifacts/unrelated"), lifecycle_group_id: "group", references: [] };
const decisionGroup = { id: "group", membership_complete: true, members: ["item"] };
assert.equal(validateDecisionScope(decisionRoot, decisionTarget, [pending], [ordinary], [decisionGroup]).length, 1);
assert.throws(() => validateDecisionScope(decisionRoot, decisionTarget, [{ ...pending, id: "missing" }], [ordinary], [decisionGroup]), /binding/);
assert.throws(() => validateDecisionScope(decisionRoot, decisionTarget, [pending], [{ ...ordinary, provenance: { source_path: decisionTarget } }], [decisionGroup]), /protects retirement scope/);
assert.throws(() => validateDecisionScope(decisionRoot, decisionTarget, [pending], [ordinary, { id: "other", path: decisionTarget, lifecycle_group_id: "group" }], [{ ...decisionGroup, members: ["item", "other"] }]), /protects retirement scope/);
const happyWorker = process.argv[4] === "--happy-worker";
async function exercise() {
  fs.mkdirSync(fixture);
  const root = path.join(fixture, "normal"); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "project-maintenance.json"), JSON.stringify({ schema_version: 1, project_id: "deployment-control-retirement-fixture", managed_roots: ["artifacts/tasks"], protected_paths: [], bundles: [] }));
  const run = beginArtifactRun(root, { owner: "control-retirement-test", workId: "test", runId: "controller", requireStopEvidence: true });
  process.removeListener("exit", run.onExit); // The supervisor closes from the actual child exit.
  const workingRoot = path.join(root, "artifacts", "workspace");
  const structuralDirectories = [workingRoot, path.join(workingRoot, "control"), path.join(workingRoot, "empty"), path.join(workingRoot, "empty", "child")];
  for (const directory of structuralDirectories) fs.mkdirSync(directory);
  const text = `gitdir: ${path.join(workingRoot, "control", "git").replaceAll("\\", "/")}\n`;
  const gitfile = { path: path.join(workingRoot, ".git"), text, sha256: hash(text), gitdir: path.join(workingRoot, "control", "git") };
  fs.writeFileSync(gitfile.path, text);
  const original = { workingLifecycleId: "workspace:original-finalized", owner: "original-owner", generation: null };
  const evidence_ref = path.join(run.reports, "attestation.json");
  fs.writeFileSync(evidence_ref, JSON.stringify({ schema: 1, action: "deployment-control-retirement-attestation", original, workingRoot, gitfile, structuralDirectories,
    producer_stopped_verified: true, references_zero: true, payload_finalized: true, reason: "Fresh fixture represents finalized generated payload; it restores no historical production receipt" }));
  const options = { artifactProjectRoot: root, workingRoot, original, gitfile, structuralDirectories,
    outputDirectory: run.reports, owner: run.owner, runLifecycleId: run.lifecycleId, evidence_ref, evidence_sha256: hash(fs.readFileSync(evidence_ref)) };
  const originalCatalog = lifecycle.catalog(root);
  for (const changes of [
    { owner: "wrong-owner" }, { original: { ...original, owner: "wrong-original-owner" } }, { original: { ...original, generation: "wrong-generation" } },
    { workingRoot: path.join(root, "artifacts") }, { outputDirectory: workingRoot },
    { gitfile: { ...gitfile, path: path.join(workingRoot, "control") } }, { gitfile: { ...gitfile, gitdir: path.join(root, "elsewhere") } },
    { structuralDirectories: structuralDirectories.filter(directory => directory !== workingRoot) }
  ]) {
    await assert.rejects(() => prepare({ ...options, ...changes }));
    assert.deepEqual(lifecycle.catalog(root), originalCatalog, "Rejected selection must not publish or alter an owner");
    assert.equal(fs.readFileSync(gitfile.path, "utf8"), text);
  }
  assert.throws(() => lifecycle.withCatalogLock(root, () => lifecycle.recordLifecycle(root, { id: "generic-git", kind: "work", owner: "test", state: "complete", membership_complete: true,
    members: [{ path: gitfile.path, role: "artifact", generated: true, protection_known: true }] }), { operation: "test.control-generic-refusal", drainOnly: true }), error => {
      assert.match(error.message, /Source or management/);
      assert.equal(error.release_error, undefined, "Generic refusal must also observe its native lease release/exit/close");
      return true;
    });
  assert.deepEqual(lifecycle.catalog(root), originalCatalog, "Generic .git protection must not publish an owner");
  const plan = await prepare(options);
  const prepared = JSON.parse(fs.readFileSync(plan.planPath, "utf8"));
  assert.equal(plan.record.revision, 1);
  assert.equal(plan.record.version, plan.record.generation);
  assert.throws(() => apply({ planPath: plan.planPath, planSha256: "0".repeat(64) }), /SHA256/);
  assert(!fs.existsSync(plan.files.intent), "Bad plan hash must not start an apply attempt");
  const good = await apply(plan);
  assert.equal(good.success, true, JSON.stringify(good));
  assert.equal(good.worker.exit_observed, true); assert.equal(good.worker.exit_code, 0); assert.equal(good.worker.signal, null); assert.equal(good.worker.close_observed, true);
  for (const release of [good.result.nativeRelease, good.result.maintenanceRelease]) {
    assert.equal(release.native_exit_observed, true); assert.equal(release.native_exit_code, 0); assert.equal(release.native_close_observed, true); assert.equal(release.native_signal, null);
  }
  assert(good.result.windowsAttributeChecks.every(check => check.status === 0 && check.signal === null && check.stdout_drained && check.stderr_drained));
  assert(good.result.nativeSnapshot.queries.every(query => query.exit_observed && query.exit_code === 0 && query.signal === null && query.close_observed && query.stdout_drained && query.stderr_drained));
  assert(prepared.preparationAttributeChecks.every(check => check.status === 0 && check.signal === null && check.stdout_drained && check.stderr_drained));
  assert(prepared.nativeSnapshot.queries.every(query => query.exit_observed && query.exit_code === 0 && query.signal === null && query.close_observed && query.stdout_drained && query.stderr_drained));
  assert.equal(good.result.finalization.status, "finalized");
  assert(!fs.existsSync(workingRoot));
  assert(!lifecycle.catalog(root).some(record => record.id === plan.record.id));
  console.log(JSON.stringify({ status: "passed", selectedScope, fixture, root, caller: lifecycle.catalog(root).find(record => record.id === run.lifecycleId), good,
    preparation: { windowsAttributeChecks: prepared.preparationAttributeChecks, nativeQueries: prepared.nativeSnapshot.queries },
    checks: ["invalid selections and generic gitfile membership reject before publication", "bad plan SHA rejects before intent", "real native metadata/dual custody and exact control retirement", "actual worker/query/attribute/dual-native exits and closes; retirement record finalized"] }));
}
async function supervise() {
  recoveryPure({ emit: false });
  assert(!fs.existsSync(fixture), "Fresh happy fixture required");
  const observed = await new Promise(resolve => {
    const child = spawn(process.execPath, [__filename, fixture, "happy", "--happy-worker"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    let stdout = "", stderr = "", exit = null, error = null;
    child.stdout.on("data", value => { stdout += value; }); child.stderr.on("data", value => { stderr += value; });
    child.on("error", value => { error = value.message; }); child.on("exit", (code, signal) => { exit = { code, signal }; });
    child.on("close", () => resolve({ pid: child.pid, stdout, stderr, exit, close_observed: true, error }));
  });
  assert.equal(observed.error, null, JSON.stringify(observed)); assert.equal(observed.exit?.code, 0, JSON.stringify(observed)); assert.equal(observed.exit.signal, null);
  const result = JSON.parse(observed.stdout); assert.equal(result.status, "passed");
  const proof = path.join(result.root, "artifacts/tasks/test/runs/controller/reports", "happy-supervisor-stop.json");
  fs.writeFileSync(proof, JSON.stringify({ schema: 1, producer_stopped_verified: true, process_tree_stopped_verified: true,
    worker: { pid: observed.pid, exit_code: observed.exit.code, signal: observed.exit.signal, close_observed: true }, apply: result.good.worker,
    catalogNative: result.good.result.nativeRelease, maintenanceNative: result.good.result.maintenanceRelease,
    preparation: result.preparation, windowsAttributeChecks: result.good.result.windowsAttributeChecks, nativeQueries: result.good.result.nativeSnapshot.queries }), { flag: "wx" });
  const caller = result.caller;
  const closed = lifecycle.withCatalogLock(result.root, () => lifecycle.closeLifecycle(result.root, caller.id, { owner: caller.owner, expected_revision: caller.revision,
    producer_stopped_verified: true, outcome: "success", exit_code: observed.exit.code,
    reason: "Actual fixture producer exited; all recorded apply/query/attribute/native children drained and closed", evidence_ref: proof, evidence_sha256: hash(fs.readFileSync(proof)) }),
    { operation: "test.control-caller-close", drainOnly: true });
  assert.equal(closed.producer.outcome, "success"); assert.equal(closed.references.length, 0);
  assert(!fs.existsSync(path.join(result.root, "artifacts/workspace")));
  console.log(JSON.stringify({ status: "passed", selectedScope: "happy", fixture, checks: result.checks,
    caller_closed: { id: closed.id, revision: closed.revision, producer: closed.producer }, proof, fixture_cleanup_ready: true,
    cleanup: "Supervising outer fixture owner must now remove this exact generated fixture; no gitfile/container, active child or reservation remains" }));
}
(happyWorker ? exercise() : supervise()).catch(error => { console.error(error.stack); process.exitCode = 1; });
