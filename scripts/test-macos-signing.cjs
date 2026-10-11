"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { ensureMacSignatures } = require("./macos-signing.cjs");
const { projectMacSigning } = require("./prepare-platform-host.cjs");
const crypto = require("node:crypto");
const selected = require("./platform-runtime.cjs").resolvePlatform("darwin", "arm64");
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-signatures-"));
  try { fn(root); } finally { fs.rmSync(root, { recursive: true }); }
}
function macho(root, name, magic = 0xfeedfacf) {
  const file = path.join(root, name), bytes = Buffer.alloc(32); bytes.writeUInt32BE(magic);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); return file;
}
function runner(states, calls, failFinal = false) {
  return args => {
    const file = args.at(-1); calls.push(args);
    const state = states.get(file);
    if (args[0] === "--sign") { fs.appendFileSync(file, "signed"); states.set(file, "adhoc"); return { status: 0 }; }
    if (args[0] === "--verify") return { status: state === "invalid" || failFinal ? 1 : 0, stderr: "signature verification" };
    return state ? { status: 0, stderr: state === "identity" ? "Authority=Supplier" : "Signature=adhoc" } : { status: 1, stderr: "code object is not signed at all" };
  };
}
test("Mac boundary signs missing native/fat signatures, preserves valid supplier bytes and records final hashes", () => fixture(root => {
  const unsigned = macho(root, "nested/pty.node"), valid = macho(root, "node", 0xcafebabe);
  fs.writeFileSync(path.join(root, "script.js"), "plain script");
  const states = new Map([[valid, "identity"]]), calls = [];
  const receipt = ensureMacSignatures(root, { platform: "darwin", arch: "arm64", run: runner(states, calls) });
  assert.equal(receipt.policy, "adhoc-without-notarization"); assert.equal(receipt.status, "passed");
  assert.equal(receipt.files.length, 2);
  const changed = receipt.files.find(file => file.path === "nested/pty.node"), preserved = receipt.files.find(file => file.path === "node");
  assert.equal(changed.action, "signed-adhoc"); assert.notEqual(changed.beforeSha256, changed.sha256);
  assert.equal(preserved.action, "preserved"); assert.equal(preserved.beforeSha256, preserved.sha256); assert.equal(preserved.signature, "identity");
  assert.deepEqual(calls.filter(args => args[0] === "--sign"), [["--sign", "-", unsigned]]);
  assert.equal(calls.filter(args => args[0] === "--verify" && args[1] === "--strict").length, 2);
}));
test("invalid existing signatures are rejected without replacing bytes", () => fixture(root => {
  const file = macho(root, "invalid"), original = fs.readFileSync(file), calls = [];
  assert.throws(() => ensureMacSignatures(root, { platform: "darwin", arch: "arm64", run: runner(new Map([[file, "invalid"]]), calls) }), /Invalid Mac signature/);
  assert.deepEqual(fs.readFileSync(file), original); assert.equal(calls.some(args => args[0] === "--sign"), false);
}));
test("failed final verification and unrecognized inspection errors fail closed", () => fixture(root => {
  macho(root, "native");
  assert.throws(() => ensureMacSignatures(root, { platform: "darwin", arch: "arm64", run: runner(new Map(), [], true) }), /Invalid Mac signature/);
  assert.throws(() => ensureMacSignatures(root, { platform: "darwin", arch: "arm64", run: () => ({ status: 1, stderr: "malformed signature" }) }), /Cannot inspect existing/);
}));
test("outside symlinks are rejected before signing any file", () => fixture(root => {
  macho(root, "native"); const outside = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-sign-outside-"));
  try {
    fs.symlinkSync(outside, path.join(root, "outside"), process.platform === "win32" ? "junction" : "dir");
    let calls = 0;
    assert.throws(() => ensureMacSignatures(root, { platform: "darwin", arch: "arm64", run: () => { calls++; return { status: 0 }; } }), /outside symlink/);
    assert.equal(calls, 0);
    fs.unlinkSync(path.join(root, "outside"));
  } finally { fs.rmSync(outside, { recursive: true }); }
}));
test("Windows/Linux never traverse or sign, and Rosetta is refused", () => {
  for (const platform of ["win32", "linux"]) assert.equal(ensureMacSignatures("nonexistent", { platform }), null);
  assert.throws(() => ensureMacSignatures("nonexistent", { platform: "darwin", arch: "x64" }), /native darwin arm64/);
});
function projectionFixture() {
  const bytes=Buffer.alloc(32);bytes.writeUInt32BE(0xfeedfacf);
  const hash=crypto.createHash("sha256").update(bytes).digest("hex");
  const record=path=>({path,beforeSha256:hash,sha256:hash,action:"preserved",signature:"adhoc",verified:true});
  const receipt={schema:1,status:"passed",platform:{os:"darwin",arch:"arm64",target:"aarch64-apple-darwin"},policy:"adhoc-without-notarization",files:[record("native"),record("excluded")]};
  const files=new Map([["extension/native",{data:bytes}],["extension/script.js",{data:Buffer.from("plain script") }],["extension.vsixmanifest",{data:Buffer.from("metadata") }]]);
  return {receipt,files,bytes,record};
}
test("final VSIX signing receipt excludes staging-only native objects and retains original signature evidence", () => {
  const {receipt,files}=projectionFixture();
  const projected=projectMacSigning(receipt,files,selected);
  assert.deepEqual(projected.files,[receipt.files[0]]);
  assert.equal(projected.files[0],receipt.files[0]);
  assert.equal(receipt.files.length,2);
});
test("final VSIX projection rejects unverified additions, changed bytes, duplicate staging records and invalid metadata", () => {
  for(const kind of ["unrecorded","changed","duplicate","invalid"]) {
    const {receipt,files,bytes}=projectionFixture();
    if(kind==="unrecorded") files.set("extension/new-native",{data:bytes});
    if(kind==="changed") files.get("extension/native").data=Buffer.concat([bytes,Buffer.from("tampered")]);
    if(kind==="duplicate") receipt.files.push({...receipt.files[1]});
    if(kind==="invalid") receipt.files[0].verified=false;
    assert.throws(()=>projectMacSigning(receipt,files,selected),/Mac signing receipt/);
  }
});
