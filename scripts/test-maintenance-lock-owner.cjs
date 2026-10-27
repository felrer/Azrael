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
const lock = path.join(fixture, "catalog.lock");
const helper = require.resolve("./maintenance-lock-owner.cjs");
const child = code => spawnSync(process.execPath, ["-e", code], { encoding: "utf8", windowsHide: true, timeout: 20000 });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const checks = [];
try {
  const held = acquire(lock, { operation: "test.acquire" });
  assert.equal(held.owner.schema, 2);
  assert.equal(held.owner.parent_pid, process.pid);
  assert.equal(held.owner.operation, "test.acquire");
  const contender = child('const assert=require("node:assert/strict");const {acquire}=require('+JSON.stringify(helper)+');assert.throws(()=>acquire('+JSON.stringify(lock)+',{operation:"test.contender"}));');
  assert.equal(contender.status, 0, contender.stderr);
  held.release();
  assert.equal(fs.existsSync(lock), true, "persistent OS lock inode must survive release");
  const bytes = JSON.parse(fs.readFileSync(lock));
  assert.equal(bytes.schema, 2);
  const second = acquire(lock, { operation: "test.reacquire" }); second.release();
  checks.push("real child contention, persistent metadata, reacquisition");
  for (const waitMs of [-1, 5001, 1.5, NaN]) assert.throws(() => acquire(lock, { operation: "test.invalid-wait", waitMs }), /Lock wait/);
  const busy = acquire(lock, { operation: "test.busy" });
  const timed = child('const assert=require("node:assert/strict"),{acquire}=require('+JSON.stringify(helper)+');const at=performance.now();assert.throws(()=>acquire('+JSON.stringify(lock)+',{operation:"test.timeout",waitMs:80}));assert(performance.now()-at>=60);');
  assert.equal(timed.status, 0, timed.stderr); busy.release();
  checks.push("bounded wait expires without taking a held lock");
  const crashed = child('require('+JSON.stringify(helper)+').acquire('+JSON.stringify(lock)+',{operation:"test.crash"});process.exit(7);');
  assert.equal(crashed.status, 7, crashed.stderr);
  const after = acquire(lock, { operation: "test.after-crash", waitMs: 2000 }); after.release();
  checks.push("parent crash closes native stdin and releases OS exclusion");
  const killed = acquire(lock,{operation:"test.native-killed"});
  process.kill(killed.owner.pid,"SIGKILL");
  const stopped = performance.now();
  assert.throws(()=>killed.release(),/exited|terminated|unknown|pipe|lease/i);
  assert(performance.now()-stopped<5000,"idle native death must not wait for request timeout");
  const recovered = acquire(lock,{operation:"test.after-native-kill",waitMs:2000}); recovered.release();
  checks.push("idle native helper death reports terminal state and releases exclusion");
  fs.unlinkSync(lock);
  for (const content of ["", "malformed sensitive text", JSON.stringify({schema:1,pid:123,token:"legacy",operation:"old",acquired_at_ms:1})]) {
    fs.writeFileSync(lock, content);
    assert.throws(() => acquire(lock, {operation:"test.legacy"}), error => !error.message.includes("sensitive"));
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
  const binary=process.env.AZRAEL_MAINTENANCE_OWNER || require("./maintenance-owner-config.cjs").resolveMaintenanceOwner();
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
  const childProcess=require("node:child_process"),launchMethods=["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork"];
  const originalLaunchers=new Map(launchMethods.map(name=>[name,childProcess[name]]));
  let executionAttempts=0;
  try {
    delete process.env.AZRAEL_MAINTENANCE_OWNER;
    for(const name of launchMethods) childProcess[name]=()=>{executionAttempts++;throw Error("Resolver must never execute the owner");};
    const {resolveMaintenanceOwner}=require(resolverModule);
    saveReceipt(receipt);assert.equal(resolveMaintenanceOwner(),installedBinary);
    saveReceipt({...receipt,sha256:"0".repeat(64)});assert.throws(()=>resolveMaintenanceOwner(),/identity changed/);
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
    delete require.cache[resolverModule];
  }
  checks.push("default installation receipt resolves pinned owner; SHA/protocol/traversal/linked ancestors refuse without execution");
  for(const input of ['{bad json}\n',JSON.stringify({id:1,operation:"arbitrary-command"})+"\n"]) {
    const result=spawnSync(binary,["--lease",lock,"--operation","test.protocol","--wait-ms","0","--parent-pid",String(process.pid)],{input,encoding:"utf8",windowsHide:true,timeout:10000});
    assert.equal(result.error,undefined);
    const lines=result.stdout.trim().split("\n").map(line=>JSON.parse(line));assert.equal(lines[0].id,0);assert.equal(lines[0].ok,true);
    assert(result.status!==0 || lines.some(line=>line.id===1&&line.ok===false));
  }
  checks.push("malformed protocol fails closed; unknown command refused");
  console.log(JSON.stringify({status:"passed",platform:process.platform,arch:process.arch,checks}));
} finally {
  assert(fixture.startsWith(tasks+path.sep)||(!explicit&&parent===verification&&fixture.startsWith(verification+path.sep)));
  fs.rmSync(fixture,{recursive:true}); assert.equal(fs.existsSync(fixture),false);
}
