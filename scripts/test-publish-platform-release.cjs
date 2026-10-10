"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const publisher = require("./publish-platform-release.cjs");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-publisher-"));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const directory = path.join(root, "assets"); fs.mkdirSync(directory);
  const version = "2026.0.1", names = publisher.assetNames(version), hostHash = "b".repeat(64);
  const manifest = { schema: 2, version, platform: publisher.PLATFORM, provenance: { hostTemplateSha256: hostHash }, files: [{ path: "host-template.vsix", sha256: hostHash }] };
  fs.writeFileSync(path.join(directory, names[0]), "immutable archive fixture");
  fs.writeFileSync(path.join(directory, names[1]), JSON.stringify(manifest));
  fs.writeFileSync(path.join(directory, names[3]), "Install into a new directory.");
  function inventory() { return names.map(name => { const bytes = fs.readFileSync(path.join(directory, name)); return { name, size: bytes.length, sha256: hash(bytes) }; }); }
  function checksums() { fs.writeFileSync(path.join(directory, names[2]), [names[0], names[1], names[3]].map(name => `${hash(fs.readFileSync(path.join(directory, name)))}  ${name}`).join("\n") + "\n"); }
  checksums();
  const verification = { schema: 1, kind: "platform-release-verification", status: "passed", version, platform: publisher.PLATFORM, sourceCommit: "a".repeat(40), inputSha256: "c".repeat(64), hostTemplateSha256: hostHash, assets: inventory(), checks: publisher.REQUIRED_CHECK_SCOPES.map(scope => ({ scope, status: "passed", exitCode: 0 })) };
  const options = { version, repo: "felrer/Azrael", assetDirectory: directory, verification: path.join(root, "verification.json"), receipt: path.join(root, "receipt.json") };
  const save = () => fs.writeFileSync(options.verification, JSON.stringify(verification)); save();
  return { options, verification, save, manifest, names, directory, checksums, inventory };
}
function remote(f) {
  const state = { release: { id: 405470431, tag_name: "azrael-v2026.0.1", name: "Azrael 2026.0.1", body: "Existing Windows notes", draft: false, prerelease: false, target_commitish: "master" }, latest: { id: 999, tag_name: "azrael-v2026.0.4" }, ref: { object: { sha: "d".repeat(40), type: "commit" } }, assets: [{ id: 1, name: "Windows.zip", size: 7, digest: null }], bytes: new Map([[1, Buffer.from("windows")]]), uploads: 0, downloads: 0, repository: { full_name: "felrer/Azrael", private: false, visibility: "public", permissions: { push: true } } };
  const clone = value => JSON.parse(JSON.stringify(value));
  const transport = {
    repository: async () => clone(state.repository), release: async () => clone(state.release), latest: async () => clone(state.latest), tag: async () => clone(state.ref), assets: async () => clone(state.assets),
    hashAsset: async asset => { state.downloads++; const bytes = state.bytes.get(asset.id); return { size: bytes.length, sha256: hash(bytes) }; },
    upload: async (tag, file) => {
      state.uploads++; if (state.failAt === state.uploads) throw new Error("mock upload failure");
      const bytes = fs.readFileSync(file), id = state.assets.length + 1;
      state.bytes.set(id, bytes); state.assets.push({ id, name: path.basename(file), size: bytes.length, digest: state.noDigest ? null : `sha256:${hash(bytes)}` });
      if (state.afterUpload) state.afterUpload();
    },
  };
  return { state, transport };
}
test("preflight proves original asset hash without modifying release or latest", async t => {
  const f = fixture(t), r = remote(f); const result = await publisher.publish(f.options, r.transport);
  assert.equal(result.status, "preflight-passed"); assert.equal(r.state.uploads, 0); assert.equal(r.state.downloads, 2); assert.equal(result.latest, undefined);
  assert.equal(result.before.latest.tag_name, "azrael-v2026.0.4"); assert.equal(result.manifestSha256, f.verification.assets[1].sha256);
});
test("publishes exactly four unique assets and proves upload bytes, preserving Windows and latest", async t => {
  const f = fixture(t), r = remote(f); r.state.noDigest = true;
  const result = await publisher.publish({ ...f.options, publish: true }, r.transport);
  assert.equal(result.status, "published"); assert.equal(r.state.uploads, 4); assert.equal(r.state.assets.length, 5); assert.deepEqual(result.before.release, result.after.release); assert.deepEqual(result.before.latest, result.after.latest); assert.deepEqual(result.before.assets[0], result.after.assets[0]);
});
for (const [name, mutate, message] of [
  ["missing required check", f => f.verification.checks.pop(), /required passed checks/],
  ["nonzero exit code", f => f.verification.checks[0].exitCode = 1, /required passed checks/],
  ["failed extra check", f => f.verification.checks.push({ scope: "other", status: "failed", exitCode: 1 }), /failed check/],
  ["bad source hash", f => f.verification.sourceCommit = "bad", /identity is invalid/],
  ["bad input hash", f => f.verification.inputSha256 = "bad", /identity is invalid/],
  ["version mismatch", f => f.verification.version = "2026.0.4", /version\/platform mismatch/],
  ["target mismatch", f => f.verification.platform = { ...publisher.PLATFORM, target: "other" }, /version\/platform mismatch/],
  ["asset hash mismatch", f => f.verification.assets[0].sha256 = "0".repeat(64), /asset hashes\/sizes mismatch/],
  ["duplicate asset proof", f => f.verification.assets[3] = f.verification.assets[0], /asset hashes\/sizes mismatch/],
]) test(`rejects ${name} before remote access`, async t => {
  const f = fixture(t); mutate(f); f.save(); let accesses = 0;
  await assert.rejects(publisher.publish(f.options, { repository: () => { accesses++; } }), message); assert.equal(accesses, 0); assert.equal(JSON.parse(fs.readFileSync(f.options.receipt)).status, "failed");
});
for (const [name, mutate, message] of [
  ["manifest schema", f => f.manifest.schema = 1, /Manifest schema/],
  ["manifest target", f => f.manifest.platform = { ...publisher.PLATFORM, libc: "musl" }, /Manifest schema/],
  ["manifest host hash", f => f.manifest.provenance.hostTemplateSha256 = "0".repeat(64), /host template identity/],
  ["manifest input hash", f => f.manifest.provenance.inputSha256 = "0".repeat(64), /inputSha256 mismatch/],
]) test(`rejects ${name} with otherwise valid asset proof`, t => {
  const f = fixture(t); mutate(f); fs.writeFileSync(path.join(f.directory, f.names[1]), JSON.stringify(f.manifest)); f.checksums(); f.verification.assets = f.inventory(); f.save();
  assert.throws(() => publisher.validateLocal(f.options), message);
});
test("rejects checksum content even when its verification hash matches", t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.directory, f.names[2]), "bad checksum\n"); f.verification.assets = f.inventory(); f.save(); assert.throws(() => publisher.validateLocal(f.options), /Checksum file/);
});
for (const mode of ["private", "no-write", "draft", "prerelease", "wrong-tag", "collision"]) test(`rejects remote ${mode} without upload`, async t => {
  const f = fixture(t), r = remote(f);
  if (mode === "private") r.state.repository.private = true;
  if (mode === "no-write") r.state.repository.permissions.push = false;
  if (mode === "draft" || mode === "prerelease") r.state.release[mode] = true;
  if (mode === "wrong-tag") r.state.release.tag_name = "azrael-v2026.0.4";
  if (mode === "collision") r.state.assets[0].name = f.names[0];
  await assert.rejects(publisher.publish({ ...f.options, publish: true }, r.transport)); assert.equal(r.state.uploads, 0);
});
test("partial upload remains intact and failure receipt records remote state", async t => {
  const f = fixture(t), r = remote(f); r.state.failAt = 3;
  await assert.rejects(publisher.publish({ ...f.options, publish: true }, r.transport), /mock upload failure/);
  const receipt = JSON.parse(fs.readFileSync(f.options.receipt)); assert.equal(receipt.uploaded.length, 2); assert.equal(receipt.after.assets.length, 3); assert.equal(r.state.assets.length, 3); assert.equal(receipt.remoteInspectionError, undefined);
});
for (const mutation of ["notes", "latest", "tag", "windows", "new-digest", "local", "verification"]) test(`detects concurrent ${mutation} mutation`, async t => {
  const f = fixture(t), r = remote(f);
  r.state.afterUpload = () => {
    if (mutation === "notes") r.state.release.body = "changed";
    if (mutation === "latest") r.state.latest.id = 111;
    if (mutation === "tag") r.state.ref.object.sha = "e".repeat(40);
    if (mutation === "windows") r.state.bytes.set(1, Buffer.from("changed"));
    if (mutation === "new-digest") r.state.assets.at(-1).digest = `sha256:${"0".repeat(64)}`;
    if (mutation === "local") fs.appendFileSync(path.join(f.directory, f.names[0]), "changed");
    if (mutation === "verification") { f.verification.sourceCommit = "f".repeat(40); f.save(); }
  };
  await assert.rejects(publisher.publish({ ...f.options, publish: true }, r.transport)); const receipt = JSON.parse(fs.readFileSync(f.options.receipt)); assert.equal(receipt.status, "failed"); assert.ok(receipt.after);
});
test("CLI requires explicit publish flag and rejects unknown/duplicate flags", () => {
  const argv = ["--version", "2026.0.1", "--repo", "felrer/Azrael", "--verification", "v", "--asset-directory", "a", "--receipt", "r"];
  assert.equal(publisher.args(argv).publish, undefined); assert.equal(publisher.args([...argv, "--publish"]).publish, true); assert.throws(() => publisher.args([...argv, "--clobber"])); assert.throws(() => publisher.args([...argv, "--publish", "--publish"]));
});
