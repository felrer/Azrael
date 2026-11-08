"use strict";
// Retained real-process regression: OS exclusion, crash release, legacy refusal and native CAS.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { acquire } = require("./maintenance-lock-owner.cjs");
const repo = path.resolve(__dirname, "..");
const tasks = path.join(repo, "artifacts/tasks");
const verification = path.join(repo, "artifacts/verification");
const parent = process.env.AZRAEL_LIFECYCLE_FIXTURE_ROOT ? path.resolve(process.env.AZRAEL_LIFECYCLE_FIXTURE_ROOT) : verification;
if (process.env.AZRAEL_LIFECYCLE_FIXTURE_ROOT) assert(parent.startsWith(tasks + path.sep), "managed fixture parent required");
const explicit = process.argv[2];
if (explicit) assert(path.isAbsolute(explicit) && path.resolve(explicit).startsWith(tasks + path.sep), "fresh absolute owned fixture required");
fs.mkdirSync(explicit ? path.dirname(explicit) : parent, { recursive: true });
const fixture = explicit ? path.resolve(explicit) : fs.mkdtempSync(path.join(parent, "maintenance-lock-owner-"));
if (explicit) fs.mkdirSync(fixture);
// Parallel test files must not share this nonblocking native CAS probe domain.
const inheritedStateRoot = process.env.AZRAEL_STATE_ROOT;
const stateRoot = path.join(fixture, "state"); fs.mkdirSync(stateRoot);
process.env.AZRAEL_STATE_ROOT = stateRoot;
const lock = path.join(fixture, "catalog.lock");
const helper = require.resolve("./maintenance-lock-owner.cjs");
const child = code => spawnSync(process.execPath, ["-e", code], { encoding: "utf8", windowsHide: true, timeout: 20000 });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const checks = [];
let completed = false;
try {
  const wire = child("(" + function wirePackets(helper, lock) {
    const assert = require("node:assert/strict"), Module = require("node:module");
    const threads = require("node:worker_threads"), load = Module._load;
    const config = require.resolve(require("node:path").join(require("node:path").dirname(helper), "maintenance-owner-config.cjs"));
    require.cache[config] = { exports: { resolveMaintenanceOwner: () => process.execPath, resolveMaintenanceCommand: () => ({ executable: process.execPath, args: [] }) } };
    let packet, observedWait;
    class FakeWorker {
      constructor(filename, options) {
        observedWait = options.workerData.waitMs; this.port = options.workerData.port; this.port.postMessage(packet);
        this.port.postMessage({ type: "closed", native_close_observed: true,
          native_pid: packet.native_pid ?? null, native_exit_observed: packet.native_exit_observed === true,
          native_exit_code: packet.native_exit_code ?? null, native_signal: packet.native_signal ?? null });
      }
      on() { return this; } unref() {} terminate() { this.port.close(); }
    }
    Module._load = function(id, ...args) { return id === "node:worker_threads" ? { ...threads, Worker: FakeWorker } : load.call(this, id, ...args); };
    const { acquire } = require(helper);
    const busy = { code: "maintenance_busy", retryable: true, lock_path: lock, owner: { operation: "wire-holder" }, error: "OS lock busy: held" };
    for (const errorPacket of [busy, { error: JSON.stringify(busy) }, { ...busy, owner: null }]) {
      packet = { id: 0, ok: false, ...errorPacket };
      assert.throws(() => acquire(lock, { operation: "test.wire" }), error => {
        assert.equal(error.code, "EEXIST"); assert.equal(error.maintenance_code, "maintenance_busy");
        assert.equal(error.retryable, true); assert.equal(error.lock_path, lock);
        assert.deepEqual(error.owner, errorPacket.owner === null ? null : busy.owner);
        assert.equal(error.message, busy.error); return true;
      });
    }
    // Keep the capability/explicit-zero boundary: a future IPC cleanup must
    // neither send a long wait to an old owner nor erase nonblocking requests.
    packet = { id: 0, ok: false, ...busy };
    const command = { executable: process.execPath, args: [] };
    for (const [options, expected] of [
      [{ queue: true, command }, 5000],
      [{ queue: true, command: { ...command, maxLockWaitMs: 600000 } }, 600000],
      [{ queue: true, waitMs: 0, command: { ...command, maxLockWaitMs: 600000 } }, 0],
      [{ queue: true, waitMs: 5000, command: { ...command, maxLockWaitMs: 600000 } }, 5000],
    ]) {
      assert.throws(() => acquire(lock, { operation: "test.queue", ...options }), error => error.code === "EEXIST");
      assert.equal(observedWait, expected);
    }
    for (const errorPacket of [
      { error: "permission denied" },
      { error: "legacy or unknown lock; explicit recovery required" },
      { error: "Native lease exited before response: 1/null; " + JSON.stringify(busy), transport_failure: true },
      { error: "Native lease exited before response: 17/null", transport_failure: true,
        native_pid: 4343, native_exit_observed: true, native_exit_code: 17, native_signal: null }
    ]) {
      packet = { id: 0, ok: false, ...errorPacket };
      assert.throws(() => acquire(lock, { operation: "test.wire-error" }), error => {
        assert.equal(error.code, "ELOCKOWNERSHIP"); assert.equal(error.maintenance_code, undefined);
        assert.equal(error.retryable, undefined);
        assert.equal(error.lease.operation, "test.wire-error");
        assert.equal(error.lease.request_operation, "acquire");
        assert.equal(error.lease.native_pid, errorPacket.native_pid ?? null);
        assert.equal(error.lease.native_exit_observed, errorPacket.native_exit_observed === true);
        assert.equal(error.lease.native_exit_code, errorPacket.native_exit_code ?? null);
        assert.equal(error.lease.native_signal, null);
        assert.equal(error.lease.worker_termination_requested, true);
        return true;
      });
    }
    // A catalog publisher must preserve the explicit drain policy across the
    // wrapper/reentrant boundary and never turn an unknown release into success.
    const fs = require("node:fs"), path = require("node:path"), owner = require(helper);
    const lifecycle = require(path.join(path.dirname(helper), "artifact-lifecycle.cjs"));
    const originalAcquire = owner.acquire, originalMkdir = fs.mkdirSync, captured = [];
    let releaseFailure = null;
    try {
      fs.mkdirSync = () => {}; // No fixture or native producer is needed for option forwarding.
      owner.acquire = (filename, options) => {
        captured.push(options);
        return { release() { if (releaseFailure) throw releaseFailure; return { native_exit_observed: true, native_exit_code: 0, native_close_observed: true }; } };
      };
      const root = path.dirname(lock);
      assert.equal(lifecycle.withCatalogLock(root, () => "default"), "default");
      assert.equal(captured.pop().drainOnly, false);
      assert.equal(lifecycle.withCatalogLock(root, () => lifecycle.withCatalogLock(root, () => "nested"),
        { operation: "test.catalog-drain", drainOnly: true }), "nested");
      assert.equal(captured.length, 1);
      assert.equal(captured.pop().drainOnly, true);
      releaseFailure = Object.assign(Error("catalog release unknown"), { lease: { native_exit_observed: false, native_close_observed: false } });
      assert.throws(() => lifecycle.withCatalogLock(root, () => "must not return", { drainOnly: true }), error => error === releaseFailure);
      const primary = Error("primary catalog refusal");
      assert.throws(() => lifecycle.withCatalogLock(root, () => { throw primary; }, { drainOnly: true }), error => error === primary && error.release_error === releaseFailure);
    } finally { owner.acquire = originalAcquire; fs.mkdirSync = originalMkdir; }
  } + ")(" + JSON.stringify(helper) + "," + JSON.stringify(lock) + ");");
  assert.equal(wire.status, 0, wire.stderr);
  checks.push("top-level and encoded busy metadata survive worker packets; transport, permission and corrupt errors stay distinct");
  // Retain: a future teardown simplification must not reintroduce timeout-kill
  // for explicitly drain-only destructive owners, or turn late replies into success.
  const drain = child("(" + function drainOnlyWire(helper, lock) {
    const assert = require("node:assert/strict"), Module = require("node:module"), threads = require("node:worker_threads");
    const load = Module._load, controls = [], ticks = { now: 0 };
    let delayedClose, emptyReads = 0;
    const originalPerformance = global.performance;
    Object.defineProperty(global, "performance", { configurable: true, value: { now() { ticks.now += 20000; return ticks.now; } } });
    class DrainWorker {
      constructor(filename, options) {
        this.port = options.workerData.port;
        this.port.postMessage({ id: 0, ok: false, error: "first transport failure", transport_failure: true });
        this.port.postMessage({ id: 0, ok: true, result: { pid: 99 } });
        this.port.postMessage({ type: "closed", native_pid: 99, native_exit_observed: true, native_exit_code: 23, native_signal: null, native_close_observed: true });
        // Capture adapter requests synchronously, without requiring this blocked
        // JS thread to dispatch MessagePort callbacks.
        const receive = threads.receiveMessageOnPort;
        this.onTerminate = () => { let packet; while ((packet = receive(this.port))) controls.push(packet.message); };
      }
      on() { return this; } unref() {} terminate() { this.onTerminate(); this.port.close(); }
    }
    Module._load = function(id, ...args) {
      return id === "node:worker_threads" ? { ...threads, Worker: DrainWorker, receiveMessageOnPort(port) {
        if (delayedClose) { if (++emptyReads < 3) return undefined; const value = delayedClose; delayedClose = null; return value; }
        const packet = threads.receiveMessageOnPort(port);
        if (packet?.message.type === "closed") { delayedClose = packet; return undefined; }
        return packet;
      } } : load.call(this, id, ...args);
    };
    const { acquire } = require(helper);
    assert.throws(() => acquire(lock, { operation: "test.drain-only", drainOnly: true, command: { executable: process.execPath, args: [] } }), error => {
      assert.equal(error.message, "first transport failure");
      assert.equal(error.lease.native_kill_requested, false);
      assert.equal(error.lease.native_close_observed, true);
      assert.equal(error.lease.native_exit_code, 23);
      assert.equal(error.lease.late_response.ok, true);
      return true;
    });
    assert(controls.some(packet => packet.control === "shutdown"));
    assert(!controls.some(packet => packet.control === "kill"));
    Object.defineProperty(global, "performance", { configurable: true, value: originalPerformance });
  } + ")(" + [helper, lock].map(value => JSON.stringify(value)).join(",") + ");");
  assert.equal(drain.status, 0, drain.stderr);
  checks.push("opt-in drain-only teardown waits for close without kill and preserves the first failure after late success");
  // Retain this real-process check: simplifying observer teardown can discard
  // a delayed commit or the final release frame before stdout has drained.
  const fakeOwner = path.join(fixture, "transport-owner.cjs"), commits = path.join(fixture, "transport-commits.jsonl");
  fs.writeFileSync(fakeOwner, `"use strict";
const fs=require("node:fs"), readline=require("node:readline");
const mode=process.argv[2], commits=process.argv[3];
const send=value=>process.stdout.write(JSON.stringify(value)+"\\n");
const ready=()=>send({id:0,ok:true,result:{schema:2,pid:process.pid,parent_pid:process.ppid,wait_ms:Number(process.argv[process.argv.indexOf("--wait-ms")+1])}});
if(mode==="startup-delayed")setTimeout(ready,11000);else ready();
readline.createInterface({input:process.stdin}).on("line",line=>{
  const message=JSON.parse(line);
  if(message.operation==="write_record"){
    if(mode==="exit-pending")process.exit(23);
    if(mode==="partial")return process.stdout.write('{"id":'+message.id+',"ok":',()=>process.exit(24));
    return setTimeout(()=>{fs.appendFileSync(commits,JSON.stringify({id:message.id})+"\\n");send({id:message.id,ok:true,result:{sha256:"fake-commit"}});},11000);
  }
  if(message.operation==="release")process.stdout.write(JSON.stringify({id:message.id,ok:true,result:{released:true}})+"\\n",()=>process.exit(0));
});
`);
  const transport = child("(" + function transportLifecycle(helper, lock, fakeOwner, commits) {
    const assert = require("node:assert/strict"), fs = require("node:fs"), { acquire } = require(helper);
    const open = mode => acquire(lock, { operation: "test.transport", command: {
      executable: process.execPath, args: [fakeOwner, mode, commits], maxLockWaitMs: 600000 } });
    const delayed = open("delayed"), at = performance.now();
    assert.equal(delayed.writeRecord({ id: "one" }, null).sha256, "fake-commit");
    assert(performance.now() - at > 10000, "real delayed response must cross the former deadline");
    assert.equal(fs.readFileSync(commits, "utf8").trim().split("\n").length, 1, "a delayed write must not be retransmitted");
    for (const lease of [delayed, open("last-frame")]) {
      const result = lease.release();
      assert.equal(result.released, true); assert.equal(result.native_exit_observed, true);
      assert.equal(result.native_exit_code, 0); assert.equal(result.native_close_observed, true);
    }
    for (const [mode, code] of [["exit-pending", 23], ["partial", 24]]) {
      const lease = open(mode);
      assert.throws(() => lease.writeRecord({ id: "unacknowledged" }, null), error => {
        assert.match(error.message, /before response|incomplete response/);
        assert.equal(error.lease.request_operation, "write_record"); assert.equal(error.lease.request_id, 1);
        assert.equal(error.lease.native_pid, lease.owner.pid); assert.equal(error.lease.native_exit_observed, true);
        assert.equal(error.lease.native_exit_code, code); assert.equal(error.lease.native_close_observed, true);
        assert.equal(error.lease.transport_failure, true); return true;
      });
    }
  } + ")(" + [helper, lock, fakeOwner, commits].map(value => JSON.stringify(value)).join(",") + ");");
  assert.equal(transport.status, 0, transport.stderr);
  assert.match(transport.stderr, /response-delayed/);
  checks.push("delayed writes commit once; release drains the final frame and observes close; pending exit and partial frames retain terminal context");
  const startup = child("(" + function delayedStartup(helper, lock, fakeOwner, commits) {
    const assert = require("node:assert/strict"), { acquire } = require(helper);
    const at = performance.now();
    const lease = acquire(lock, { operation: "test.startup", waitMs: 0, command: {
      executable: process.execPath, args: [fakeOwner, "startup-delayed", commits] } });
    assert(performance.now() - at > 10000, "startup must cross the former response grace");
    assert.equal(lease.owner.wait_ms, 0, "startup grace must not change the native lock wait");
    const result = lease.release();
    assert.equal(result.released, true);
    assert.equal(result.native_exit_code, 0);
    assert.equal(result.native_close_observed, true);
  } + ")(" + [helper, lock, fakeOwner, commits].map(value => JSON.stringify(value)).join(",") + ");");
  assert.equal(startup.status, 0, startup.stderr);
  assert.match(startup.stderr, /"operation":"acquire"/);
  checks.push("delayed initial response preserves explicit nonblocking lock wait and closes the native owner");
  const held = acquire(lock, { operation: "test.acquire" });
  assert.equal(held.owner.schema, 2);
  assert.equal(held.owner.parent_pid, process.pid);
  assert.equal(held.owner.operation, "test.acquire");
  const contender = child('const assert=require("node:assert/strict");const {acquire}=require('+JSON.stringify(helper)+');const at=performance.now();assert.throws(()=>acquire('+JSON.stringify(lock)+',{operation:"test.contender"}),error=>{assert.equal(error.code,"EEXIST");assert.equal(error.maintenance_code,"maintenance_busy");assert.equal(error.retryable,true);assert.equal(error.lock_path,'+JSON.stringify(lock)+');assert(error.owner===null||error.owner.operation==="test.acquire");return true;});assert(performance.now()-at<4000,"default contention must not implicitly wait five seconds");');
  assert.equal(contender.status, 0, contender.stderr);
  held.release();
  assert.equal(fs.existsSync(lock), true, "persistent OS lock inode must survive release");
  const bytes = JSON.parse(fs.readFileSync(lock));
  assert.equal(bytes.schema, 2);
  const second = acquire(lock, { operation: "test.reacquire" }); second.release();
  checks.push("real child contention, persistent metadata, reacquisition");
  for (const waitMs of [-1, 600001, 1.5, NaN]) assert.throws(() => acquire(lock, { operation: "test.invalid-wait", waitMs }), /Lock wait/);
  const busy = acquire(lock, { operation: "test.busy" });
  const timed = child('const assert=require("node:assert/strict"),{acquire}=require('+JSON.stringify(helper)+');const at=performance.now();assert.throws(()=>acquire('+JSON.stringify(lock)+',{operation:"test.timeout",waitMs:80}),error=>error.code==="EEXIST"&&error.maintenance_code==="maintenance_busy"&&error.retryable===true);assert(performance.now()-at>=60);');
  assert.equal(timed.status, 0, timed.stderr); busy.release();
  checks.push("bounded wait expires without taking a held lock");
  const crashed = child('require('+JSON.stringify(helper)+').acquire('+JSON.stringify(lock)+',{operation:"test.crash"});process.exit(7);');
  assert.equal(crashed.status, 7, crashed.stderr);
  const after = acquire(lock, { operation: "test.after-crash", waitMs: 2000 }); after.release();
  checks.push("parent crash closes native stdin and releases OS exclusion");
  const killed = acquire(lock,{operation:"test.native-killed"});
  process.kill(killed.owner.pid,"SIGKILL");
  const stopped = performance.now();
  assert.throws(()=>killed.release(), error => {
    assert.match(error.message, /exited|terminated|unknown|pipe|lease/i);
    assert.equal(error.lease.native_pid, killed.owner.pid);
    assert.equal(error.lease.request_operation, "release");
    assert.equal(error.lease.worker_termination_requested, true);
    if (!error.lease.native_exit_observed) {
      assert.equal(error.lease.native_exit_code, null); assert.equal(error.lease.native_signal, null);
    }
    return true;
  });
  assert(performance.now()-stopped<5000,"idle native death must not wait for request timeout");
  const recovered = acquire(lock,{operation:"test.after-native-kill",waitMs:2000}); recovered.release();
  checks.push("idle native helper death reports terminal state and releases exclusion");
  const lifecycle = require("./artifact-lifecycle.cjs"), failedRoot = path.join(fixture, "failed-catalog");
  fs.mkdirSync(failedRoot);
  let nativePid;
  const lockOwner = require("./maintenance-lock-owner.cjs"), originalAcquire = lockOwner.acquire;
  lockOwner.acquire = (...args) => {
    const lease = originalAcquire(...args);
    nativePid = lease.owner.pid;
    return lease;
  };
  try {
  assert.throws(() => lifecycle.withCatalogLock(failedRoot, () => {
    process.kill(nativePid, "SIGKILL");
    lifecycle.recordLifecycle(failedRoot, { id: "interrupted-write", kind: "run", owner: "lock-regression",
      state: "pending", membership_complete: false,
      members: [{ path: path.join(failedRoot, "artifacts/output"), role: "output", generated: true, protection_known: true }] });
  }), error => {
    assert.doesNotMatch(error.message, /already released/);
    assert(error.lease, error.stack);
    assert.equal(error.lease.native_pid, nativePid);
    assert.equal(error.lease.request_operation, "write_record");
    assert(error.release_error instanceof Error, "secondary teardown failure must remain attached");
    assert.equal(error.release_error.lease.request_operation, "release");
    if (!error.lease.native_exit_observed) {
      assert.equal(error.lease.native_exit_code, null); assert.equal(error.lease.native_signal, null);
    }
    return true;
  });
  } finally { lockOwner.acquire = originalAcquire; }
  const afterFailure = lifecycle.withCatalogLock(failedRoot, () => "fresh lease works");
  assert.equal(afterFailure, "fresh lease works");
  const originalAction = Error("original action failure");
  assert.throws(() => lifecycle.withCatalogLock(failedRoot, () => { throw originalAction; }), error => error === originalAction && error.release_error === undefined);
  checks.push("native write failure preserves its primary operation and secondary release error without inventing terminal observation");
  fs.unlinkSync(lock);
  for (const content of ["", "malformed sensitive text", JSON.stringify({schema:1,pid:123,token:"legacy",operation:"old",acquired_at_ms:1})]) {
    fs.writeFileSync(lock, content);
    assert.throws(() => acquire(lock, {operation:"test.legacy"}), error => !error.message.includes("sensitive") && error.code !== "EEXIST" && error.retryable !== true);
    assert.equal(fs.readFileSync(lock,"utf8"),content); fs.unlinkSync(lock);
  }
  checks.push("existing empty, malformed and schema1 markers require recovery");
  const current = acquire(lock,{operation:"test.replace"});
  let renamed = false;
  try { fs.renameSync(lock,lock+".old"); renamed = true; fs.writeFileSync(lock,JSON.stringify(current.owner)); }
  catch (error) { if (process.platform !== "win32" || !["EPERM","EACCES","EBUSY"].includes(error.code)) throw error; }
  if (renamed) { assert.throws(()=>current.release(),/changed|replaced|identity/); assert(fs.existsSync(lock)); fs.unlinkSync(lock+".old"); }
  else current.release();
  fs.unlinkSync(lock);
  checks.push("replaced lock inode is preserved and release refuses replacement, or OS denies replacement");
  const target=path.join(fixture,"target"),linked=path.join(fixture,"linked");
  fs.mkdirSync(target); fs.symlinkSync(target,linked,process.platform==="win32"?"junction":"dir");
  assert.throws(()=>acquire(path.join(linked,"catalog.lock"),{operation:"test.link"}),/link|reparse/);
  assert.throws(()=>acquire(target,{operation:"test.directory"}));
  checks.push("symlink/reparse ancestors and non-file lock targets refused");
  const catalog=path.join(fixture,"artifacts/maintenance/lifecycles");fs.mkdirSync(catalog,{recursive:true});
  const ledgerLock=path.join(catalog,"catalog.lock");
  const lease=acquire(ledgerLock,{operation:"test.cas"});
  try {
    const record={schema:1,id:"test-ledger",kind:"work",owner:"test",state:"pending",membership_complete:false,members:[{path:path.join(fixture,"artifacts/tasks/member"),role:"artifact",generated:true,protection_known:true}],references:[]};
    // A preserved extension field exercises real UTF-8 framing above the former
    // 1 MiB cap through native CAS reads, reservation output and terminal finish.
    record.annotation="\uAC00".repeat(400000);
    assert(Buffer.byteLength(JSON.stringify(record))>1024*1024);
    const created=lease.writeRecord(record,null);
    const filename=path.join(catalog,hash(record.id)+".json");
    assert.equal(created.sha256,hash(fs.readFileSync(filename)));
    assert(fs.statSync(filename).size>1024*1024);
    assert.equal(JSON.parse(fs.readFileSync(filename,"utf8")).annotation,record.annotation);
    assert.throws(()=>lease.writeRecord(record,null),/CAS/);
    record.state="complete";record.membership_complete=true;record.revision=1;
    const updated=lease.writeRecord(record,created.sha256);assert.notEqual(updated.sha256,created.sha256);
    assert.throws(()=>lease.removeRecord(record.id,created.sha256),/CAS/);
    const unsafe={...record,id:"unsafe",members:[{path:path.join(fixture,"source.rs"),role:"artifact"}]};
    assert.throws(()=>lease.writeRecord(unsafe,null),/source|control|member/);
    fs.mkdirSync(record.members[0].path,{recursive:true});
    const reserved=lease.reserveProducers([{id:record.id,revision:1}]);
    assert.deepEqual(reserved.reserved,[record.id]);assert.equal(reserved.observed[0].id,record.id);assert.equal(reserved.observed[0].fence.source_owner.id,record.id);
    assert.equal(reserved.observed[0].fence.source_owner.annotation,record.annotation);
    lease.releaseCatalog();
    const unrelated=acquire(ledgerLock,{operation:"test.during-reservation"});
    try { assert.throws(()=>unrelated.writeRecord(record,updated.sha256),/reserv/); } finally { unrelated.release(); }
    fs.rmdirSync(record.members[0].path);
    const outcomes=[{id:record.id,status:"deleted",members:[{path:record.members[0].path,status:"deleted",remaining:false}]}];
    const evidence=path.join(fixture,"artifacts/maintenance/evidence/terminal.json");fs.mkdirSync(path.dirname(evidence),{recursive:true});
    fs.writeFileSync(evidence,JSON.stringify({outcomes}));
    assert.throws(()=>lease.finishProducers(outcomes,evidence,"0".repeat(64)),/SHA/);
    assert.deepEqual(lease.finishProducers(outcomes,evidence,hash(fs.readFileSync(evidence))),{finished:true,reservations_retained:[]});
    assert.deepEqual(lease.removeRecord(record.id,updated.sha256),{removed:true});assert.equal(fs.existsSync(filename),false);
  } finally {lease.release();}
  const envelopeLease=acquire(ledgerLock,{operation:"test.response-preflight"});
  try {
    // One modest persisted record would duplicate its owner into 65 projected
    // members, exceeding the response envelope without allocating that response.
    const oversized={schema:1,id:"test-response-preflight",kind:"work",owner:"p".repeat(1024*1024),state:"complete",membership_complete:true,revision:1,
      members:Array.from({length:65},(_,index)=>({path:path.join(fixture,"artifacts/tasks/preflight/member-"+index),role:"artifact",generated:true,protection_known:true})),references:[]};
    const oversizedWrite=envelopeLease.writeRecord(oversized,null);
    const reservationDirectory=path.join(catalog,"reservations");
    const activeReservations=()=>fs.readdirSync(reservationDirectory).filter(name=>name.endsWith(".json")).sort();
    const beforePreflight=activeReservations();
    assert.throws(()=>envelopeLease.reserveProducers([{id:oversized.id,revision:1}]),/conservative 64 MiB response envelope/);
    assert.deepEqual(activeReservations(),beforePreflight,"oversized response must be rejected before any active fence is created");
    assert.deepEqual(envelopeLease.removeRecord(oversized.id,oversizedWrite.sha256),{removed:true});
  } finally {envelopeLease.release();}
  checks.push("native >1 MiB UTF-8 record CAS/reserve/finish and oversized response preflight without durable fence creation");
  const ordinary=acquire(lock,{operation:"test.no-catalog-write"});
  try { assert.throws(()=>ordinary.removeRecord("x",null),/exact lifecycle catalog/); } finally { ordinary.release(); }
  checks.push("native hashed-ID CAS, producer reservation/catalog handoff/pinned finish, unsafe member and wrong lock rejection");
  const command=require("./maintenance-owner-config.cjs").resolveMaintenanceCommand(),binary=command.executable;
  const resolverRoot=path.join(fixture,"installation-resolver");
  const resolverScripts=path.join(resolverRoot,"scripts"),payload=path.join(resolverRoot,"payload");
  fs.mkdirSync(resolverScripts,{recursive:true});fs.mkdirSync(payload);
  const resolverModule=path.join(resolverScripts,"maintenance-owner-config.cjs");
  fs.copyFileSync(require.resolve("./maintenance-owner-config.cjs"),resolverModule);
  const installedBinary=path.join(payload,path.basename(binary));fs.copyFileSync(binary,installedBinary);
  const receiptPath=path.join(resolverRoot,"artifacts/maintenance/owner-installation.json");
  fs.mkdirSync(path.dirname(receiptPath),{recursive:true});
  const receipt={schema:1,protocol:"maintenance-owner-lease-v1",executable:path.relative(resolverRoot,installedBinary),sha256:hash(fs.readFileSync(installedBinary))};
  const saveReceipt=value=>fs.writeFileSync(receiptPath,JSON.stringify(value));
  const override=process.env.AZRAEL_MAINTENANCE_OWNER;
  const previousMode=process.env.AZRAEL_MAINTENANCE_OWNER_MODE;
  const previousState=process.env.AZRAEL_STATE_ROOT;
  const previousInstallation=process.env.AZRAEL_MAINTENANCE_INSTALLATION;
  const childProcess=require("node:child_process"),launchMethods=["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork"];
  const originalLaunchers=new Map(launchMethods.map(name=>[name,childProcess[name]]));
  let executionAttempts=0;
  try {
    delete process.env.AZRAEL_MAINTENANCE_OWNER;
    delete process.env.AZRAEL_MAINTENANCE_OWNER_MODE;
    process.env.AZRAEL_STATE_ROOT=path.join(resolverRoot,"isolated-state");
    delete process.env.AZRAEL_MAINTENANCE_INSTALLATION;
    for(const name of launchMethods) childProcess[name]=()=>{executionAttempts++;throw Error("Resolver must never execute the owner");};
    const {resolveMaintenanceOwner}=require(resolverModule);
    saveReceipt(receipt);assert.equal(resolveMaintenanceOwner(),installedBinary);
    const sourceResolver=require("./maintenance-owner-config.cjs").resolveMaintenanceOwner;
    assert.equal(sourceResolver(resolverRoot),installedBinary,"frozen verifier resolves the explicit artifact owner project");
    for(const root of ["relative",path.join(resolverRoot,"child")+path.sep+"..",null]) assert.throws(()=>sourceResolver(root),/Absolute maintenance owner project root/);
    saveReceipt({...receipt,sha256:"0".repeat(64)});assert.throws(()=>resolveMaintenanceOwner(),/identity changed/);
    assert.throws(()=>sourceResolver(resolverRoot),/identity changed/);
    saveReceipt({...receipt,protocol:"maintenance-owner-lease-unknown"});assert.throws(()=>resolveMaintenanceOwner(),/installation receipt/);
    saveReceipt({...receipt,executable:"../payload/owner"});assert.throws(()=>resolveMaintenanceOwner(),/contained/);
    saveReceipt(receipt);fs.appendFileSync(installedBinary,"tampered");assert.throws(()=>resolveMaintenanceOwner(),/identity changed/);
    fs.copyFileSync(binary,installedBinary);
    const linkedPayload=path.join(resolverRoot,"linked-payload");fs.symlinkSync(payload,linkedPayload,process.platform==="win32"?"junction":"dir");
    saveReceipt({...receipt,executable:path.join("linked-payload",path.basename(installedBinary))});assert.throws(()=>resolveMaintenanceOwner(),/plain file and directory ancestors/);
    assert.equal(executionAttempts,0,"receipt resolution must not execute any process");
  } finally {
    for(const [name,original] of originalLaunchers) childProcess[name]=original;
    if(override===undefined) delete process.env.AZRAEL_MAINTENANCE_OWNER; else process.env.AZRAEL_MAINTENANCE_OWNER=override;
    if(previousMode===undefined) delete process.env.AZRAEL_MAINTENANCE_OWNER_MODE; else process.env.AZRAEL_MAINTENANCE_OWNER_MODE=previousMode;
    if(previousState===undefined) delete process.env.AZRAEL_STATE_ROOT; else process.env.AZRAEL_STATE_ROOT=previousState;
    if(previousInstallation===undefined) delete process.env.AZRAEL_MAINTENANCE_INSTALLATION; else process.env.AZRAEL_MAINTENANCE_INSTALLATION=previousInstallation;
    delete require.cache[resolverModule];
  }
  checks.push("default installation receipt resolves pinned owner; SHA/protocol/traversal/linked ancestors refuse without execution");
  for(const input of ['{bad json}\n',JSON.stringify({id:1,operation:"arbitrary-command"})+"\n"]) {
    const result=spawnSync(binary,[...command.args,"--lease",lock,"--operation","test.protocol","--wait-ms","0","--parent-pid",String(process.pid)],{input,encoding:"utf8",windowsHide:true,timeout:10000});
    assert.equal(result.error,undefined);
    const lines=result.stdout.trim().split("\n").map(line=>JSON.parse(line));assert.equal(lines[0].id,0);assert.equal(lines[0].ok,true);
    assert(result.status!==0 || lines.some(line=>line.id===1&&line.ok===false));
  }
  checks.push("malformed protocol fails closed; unknown command refused");
  completed = true;
  console.log(JSON.stringify({status:"passed",platform:process.platform,arch:process.arch,checks}));
} finally {
  if (inheritedStateRoot === undefined) delete process.env.AZRAEL_STATE_ROOT;
  else process.env.AZRAEL_STATE_ROOT = inheritedStateRoot;
  assert(fixture.startsWith(tasks+path.sep)||(!explicit&&parent===verification&&fixture.startsWith(verification+path.sep)));
  // A failed transport test may leave an unobserved native process or late commit.
  if (completed) { fs.rmSync(fixture,{recursive:true}); assert.equal(fs.existsSync(fixture),false); }
}
