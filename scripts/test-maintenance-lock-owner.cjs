"use strict";
// Retained regression coverage for shared sentinel ownership, contention and crash safety.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { acquire } = require("./maintenance-lock-owner.cjs");
const repo = path.resolve(__dirname, "..");
const tasks = path.join(repo, "artifacts/tasks");
const verification = path.join(repo, "artifacts/verification");
const parent = process.env.AZRAEL_LIFECYCLE_FIXTURE_ROOT
  ? path.resolve(process.env.AZRAEL_LIFECYCLE_FIXTURE_ROOT) : verification;
if (process.env.AZRAEL_LIFECYCLE_FIXTURE_ROOT) assert(parent.startsWith(tasks + path.sep), "managed fixture parent required");
const explicit = process.argv[2];
if (explicit) assert(path.isAbsolute(explicit) && path.resolve(explicit).startsWith(tasks + path.sep), "fresh absolute owned fixture required");
fs.mkdirSync(explicit ? path.dirname(explicit) : parent, { recursive: true });
const fixture = explicit ? path.resolve(explicit) : fs.mkdtempSync(path.join(parent, "maintenance-lock-owner-"));
if (explicit) fs.mkdirSync(fixture);
const lock = path.join(fixture, "catalog.lock");
const helper = require.resolve("./maintenance-lock-owner.cjs");
const child = code => spawnSync(process.execPath, ["-e", code], { encoding: "utf8", windowsHide: true });
const checks = [];
try {
  const held = acquire(lock, { operation: "test.acquire" });
  const owner = JSON.parse(fs.readFileSync(lock));
  assert.equal(owner.schema, 1);
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.parent_pid, process.ppid);
  assert.equal(owner.token, held.owner.token);
  assert(Number.isFinite(Date.parse(owner.process_started_at)));
  const contender = child(`const assert=require('node:assert/strict');const {acquire}=require(${JSON.stringify(helper)});assert.throws(()=>acquire(${JSON.stringify(lock)},{operation:'test.contender'}),e=>e.code==='EEXIST'&&e.owner.pid===${process.pid}&&e.recovery_required);`);
  assert.equal(contender.status, 0, contender.stderr);
  held.release();
  assert.equal(fs.existsSync(lock), false);
  checks.push("metadata, real child contention and release");

  const waitDriver = `
    const fs=require('node:fs'),assert=require('node:assert/strict');
    const {spawn}=require('node:child_process');
    const {acquire}=require(${JSON.stringify(helper)});
    const lock=${JSON.stringify(lock)},ready=lock+'.ready';
    const code='const fs=require(\"node:fs\"),{acquire}=require('+${JSON.stringify(JSON.stringify(helper))}+');const lease=acquire('+JSON.stringify(lock)+',{operation:\"test.wait-owner\"});fs.writeFileSync('+JSON.stringify(ready)+',\"ready\");setTimeout(()=>lease.release(),500);';
    const producer=spawn(process.execPath,['-e',code],{stdio:'inherit',windowsHide:true});
    const deadline=performance.now()+5000;
    while(!fs.existsSync(ready)){assert(performance.now()<deadline,'child readiness timed out');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}
    const started=performance.now();
    const lease=acquire(lock,{operation:'test.wait-consumer',waitMs:2000});
    assert(performance.now()-started>=100,'consumer did not wait for owner release');
    lease.release();fs.unlinkSync(ready);
    producer.on('exit',code=>{assert.equal(code,0);});
  `;
  const waited = child(waitDriver);
  assert.equal(waited.status, 0, waited.stderr);
  assert.equal(fs.existsSync(lock), false);
  for (const waitMs of [-1, 5001, 1.5, NaN]) {
    assert.throws(() => acquire(lock, { operation: "test.invalid-wait", waitMs }), /Lock wait/);
    assert.equal(fs.existsSync(lock), false);
  }
  fs.writeFileSync(lock, "unknown owner");
  const waitedBytes = fs.readFileSync(lock);
  assert.throws(() => acquire(lock, { operation: "test.wait-timeout", waitMs: 50 }), error => error.code === "EEXIST" && error.recovery_required);
  assert.deepEqual(fs.readFileSync(lock), waitedBytes);
  fs.unlinkSync(lock);
  checks.push("bounded contention waits for owned release; timeout never removes unknown markers");

  const crashed = child(`require(${JSON.stringify(helper)}).acquire(${JSON.stringify(lock)},{operation:'test.crash'});process.exit(7);`);
  assert.equal(crashed.status, 7, crashed.stderr);
  assert.throws(() => acquire(lock, { operation: "test.after-crash" }), e => e.code === "EEXIST" && e.owner.operation === "test.crash");
  fs.unlinkSync(lock); // Explicit fixture owner removes this known stopped child's marker.
  checks.push("crash retains marker and requires explicit recovery");

  for (const replace of [false, true]) {
    const current = acquire(lock, { operation: "test.replace" });
    if (replace) fs.renameSync(lock, lock + ".old");
    fs.writeFileSync(lock, replace ? JSON.stringify(current.owner) + "\n" : "changed");
    assert.throws(() => current.release(), /owner changed/);
    assert.equal(fs.existsSync(lock), true);
    fs.unlinkSync(lock);
    if (replace) fs.unlinkSync(lock + ".old");
  }
  checks.push("changed bytes and replaced inode refuse release, including identical bytes");

  for (const content of ["", "malformed sensitive text", JSON.stringify({ schema: 1, operation: "secret\ncontent", pid: 123, arbitrary: "sensitive" })]) {
    fs.writeFileSync(lock, content);
    assert.throws(() => acquire(lock, { operation: "test.malformed" }), error => {
      assert.equal(error.code, "EEXIST");
      assert.equal(error.recovery_required, true);
      assert(!error.message.includes("sensitive"));
      assert(!JSON.stringify(error.owner).includes("secret"));
      return true;
    });
    assert.equal(fs.readFileSync(lock, "utf8"), content);
    fs.unlinkSync(lock);
  }
  checks.push("empty/malformed markers stay busy and diagnostics expose only safe fields");

  const sync = fs.fsyncSync;
  try {
    fs.fsyncSync = () => { throw Error("injected sync failure"); };
    assert.throws(() => acquire(lock, { operation: "test.init" }), /injected sync failure/);
    assert.equal(fs.existsSync(lock), false);
  } finally { fs.fsyncSync = sync; }
  checks.push("failed initialization cleans only owned marker");
  try {
    fs.fsyncSync = descriptor => {
      sync(descriptor);
      fs.renameSync(lock, lock + ".old");
      fs.copyFileSync(lock + ".old", lock);
    };
    assert.throws(() => acquire(lock, { operation: "test.init-replace" }), /owner changed/);
    assert.equal(fs.existsSync(lock), true);
  } finally { fs.fsyncSync = sync; }
  fs.unlinkSync(lock);
  fs.unlinkSync(lock + ".old");
  checks.push("initialization refuses to clean replaced marker with identical bytes");

  const unlink = fs.unlinkSync;
  const pending = acquire(lock, { operation: "test.unlink-failure" });
  try {
    fs.unlinkSync = () => { throw Error("injected unlink failure"); };
    assert.throws(() => pending.release(), /injected unlink failure/);
    assert.equal(fs.existsSync(lock), true);
  } finally { fs.unlinkSync = unlink; }
  fs.unlinkSync(lock);
  const close = fs.closeSync;
  const closePending = acquire(lock, { operation: "test.close-failure" });
  try {
    fs.closeSync = descriptor => { close(descriptor); throw Error("injected close failure"); };
    assert.throws(() => closePending.release(), error =>
      /injected close failure/.test(error.message) || error.errors?.some(cause => /injected close failure/.test(cause.message)));
    assert.equal(fs.existsSync(lock), true);
  } finally { fs.closeSync = close; }
  fs.unlinkSync(lock);
  checks.push("close and unlink failures remain visible and retain marker");

  const target = path.join(fixture, "target"), linked = path.join(fixture, "linked");
  fs.mkdirSync(target);
  fs.symlinkSync(target, linked, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => acquire(path.join(linked, "catalog.lock"), { operation: "test.link" }), /plain file/);
  assert.equal(fs.existsSync(path.join(target, "catalog.lock")), false);
  assert.throws(() => acquire(target, { operation: "test.directory" }), /plain file/);
  checks.push("linked ancestors and non-file targets rejected");
  console.log(JSON.stringify({ status: "passed", platform: process.platform, arch: process.arch, checks }));
} finally {
  assert(fixture.startsWith(tasks + path.sep) || (!explicit && parent === verification && fixture.startsWith(verification + path.sep)));
  fs.rmSync(fixture, { recursive: true });
  assert.equal(fs.existsSync(fixture), false);
}
