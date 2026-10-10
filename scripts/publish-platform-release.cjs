"use strict";
// Existing-release publication only. No release/tag creation or asset replacement.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
const PLATFORM = Object.freeze({ os: "linux", arch: "x64", target: "x86_64-unknown-linux-gnu", libc: "glibc" });
const REQUIRED_CHECK_SCOPES = Object.freeze(["input-stability", "package-integrity", "relocation-install", "native-engine-provider", "installed-host", "rendered-ui"]);
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function identity(value) { return value && Object.entries(PLATFORM).every(([key, expected]) => value[key] === expected); }
function assetNames(version) {
  const prefix = `Azrael-${version}-linux-x64`;
  return [`${prefix}.tar.gz`, `${prefix}.manifest.json`, `${prefix}.SHA256SUMS.txt`, `${prefix}.INSTALL.md`];
}
function validateLocal(options) {
  assert(/^\d+\.\d+\.\d+$/.test(options.version), "Invalid version.");
  assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo), "Invalid repository.");
  const directory = path.resolve(options.assetDirectory), names = assetNames(options.version);
  assert(same(fs.readdirSync(directory).sort(), [...names].sort()), "Asset directory must contain exactly the four publication assets.");
  const assets = names.map(name => {
    const file = path.join(directory, name), stat = fs.lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink(), `Asset must be a regular file: ${name}`);
    return { name, size: stat.size, sha256: sha(fs.readFileSync(file)) };
  });
  const verification = JSON.parse(fs.readFileSync(options.verification, "utf8"));
  assert(verification.schema === 1 && verification.kind === "platform-release-verification" && verification.status === "passed", "Verification must be a passed schema 1 platform-release-verification.");
  assert(verification.version === options.version && identity(verification.platform), "Verification version/platform mismatch.");
  assert(/^[0-9a-f]{40}$/.test(verification.sourceCommit) && /^[0-9a-f]{64}$/.test(verification.inputSha256) && /^[0-9a-f]{64}$/.test(verification.hostTemplateSha256), "Verification source/input/host identity is invalid.");
  assert(Array.isArray(verification.checks) && REQUIRED_CHECK_SCOPES.every(scope => verification.checks.some(check => check.scope === scope && check.status === "passed" && check.exitCode === 0)), "Verification is missing required passed checks.");
  assert(verification.checks.every(check => check.status === "passed" && check.exitCode === 0), "Verification contains a failed check.");
  assert(Array.isArray(verification.assets) && verification.assets.length === assets.length && assets.every(asset => verification.assets.filter(item => item.name === asset.name && item.size === asset.size && item.sha256 === asset.sha256).length === 1), "Verification asset hashes/sizes mismatch.");
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, names[1]), "utf8"));
  assert(manifest.schema === 2 && manifest.version === options.version && identity(manifest.platform), "Manifest schema/version/platform mismatch.");
  assert(manifest.provenance?.hostTemplateSha256 === verification.hostTemplateSha256, "Manifest host template identity mismatch.");
  for (const key of ["inputSha256", "sourceCommit"]) if (manifest.provenance?.[key] !== undefined) assert(manifest.provenance[key] === verification[key], `Manifest ${key} mismatch.`);
  assert(Array.isArray(manifest.files) && manifest.files.some(file => file.path === "host-template.vsix" && file.sha256 === verification.hostTemplateSha256), "Manifest host inventory mismatch.");
  const lines = fs.readFileSync(path.join(directory, names[2]), "utf8").trim().split(/\r?\n/);
  const expected = assets.filter(asset => asset.name !== names[2]);
  assert(lines.length === expected.length && expected.every(asset => lines.filter(line => line === `${asset.sha256}  ${asset.name}` || line === `${asset.sha256} *${asset.name}`).length === 1), "Checksum file must identify archive, manifest and INSTALL exactly.");
  return { directory, assets, verification, manifestSha256: assets[1].sha256 };
}
function ghTransport(repo, executable = "gh") {
  const api = endpoint => JSON.parse(execFileSync(executable, ["api", endpoint], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
  return {
    repository: () => api(`repos/${repo}`),
    release: tag => api(`repos/${repo}/releases/tags/${tag}`),
    latest: () => api(`repos/${repo}/releases/latest`),
    tag: tag => api(`repos/${repo}/git/ref/tags/${tag}`),
    assets: id => JSON.parse(execFileSync(executable, ["api", `repos/${repo}/releases/${id}/assets`, "--paginate", "--slurp"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })).flat(),
    hashAsset: asset => new Promise((resolve, reject) => {
      const child = spawn(executable, ["api", `repos/${repo}/releases/assets/${asset.id}`, "-H", "Accept: application/octet-stream"], { shell: false });
      const hash = crypto.createHash("sha256"); let size = 0, stderr = "";
      child.stdout.on("data", bytes => { size += bytes.length; hash.update(bytes); });
      child.stderr.on("data", bytes => { if (stderr.length < 8192) stderr += bytes.toString(); });
      child.on("error", reject); child.on("close", code => code === 0 ? resolve({ sha256: hash.digest("hex"), size }) : reject(new Error(`Asset download failed (${code}): ${stderr}`)));
    }),
    upload: (tag, file) => execFileSync(executable, ["release", "upload", tag, file, "--repo", repo], { encoding: "utf8", maxBuffer: 1024 * 1024 }),
  };
}
function metadata(asset) { return { id: asset.id, name: asset.name, size: asset.size, digest: asset.digest ?? null }; }
function releaseState(release) {
  return Object.fromEntries(["id", "tag_name", "name", "body", "draft", "prerelease", "target_commitish", "published_at", "html_url"].map(key => [key, release[key] ?? null]));
}
async function proveAsset(transport, asset) {
  if (/^sha256:[0-9a-f]{64}$/.test(asset.digest || "")) return { sha256: asset.digest.slice(7), size: asset.size };
  const proof = await transport.hashAsset(asset);
  assert(proof.size === asset.size, `Remote downloaded size mismatch: ${asset.name}`);
  return proof;
}
async function snapshot(transport, tag) {
  const release = await transport.release(tag), latest = await transport.latest(), ref = await transport.tag(tag);
  const assets = [];
  for (const asset of await transport.assets(release.id)) assets.push({ ...metadata(asset), ...(await proveAsset(transport, asset)) });
  return { release: releaseState(release), latest: releaseState(latest), tag: ref, assets };
}
function unchanged(before, after, newNames) {
  assert(same(before.release, after.release) && same(before.latest, after.latest) && same(before.tag, after.tag), "Remote release notes/tag/latest/identity changed.");
  for (const asset of before.assets) assert(same(asset, after.assets.find(item => item.id === asset.id)), `Pre-existing remote asset changed: ${asset.name}`);
  assert(after.assets.every(asset => before.assets.some(old => old.id === asset.id) || newNames.includes(asset.name)), "Unexpected remote asset appeared during publication.");
}
async function publish(options, injectedTransport) {
  assert(options.receipt && !fs.existsSync(options.receipt), "Receipt path must be new.");
  const receipt = { schema: 1, kind: "platform-release-publication", status: "failed", repository: options.repo, version: options.version, platform: PLATFORM, publisherSha256: sha(fs.readFileSync(__filename)), uploaded: [] };
  let transport, before;
  try {
    const local = validateLocal(options), tag = `azrael-v${options.version}`;
    Object.assign(receipt, { tag, assets: local.assets, manifestSha256: local.manifestSha256, hostTemplateSha256: local.verification.hostTemplateSha256, sourceCommit: local.verification.sourceCommit, inputSha256: local.verification.inputSha256, verificationSha256: sha(fs.readFileSync(options.verification)) });
    transport = injectedTransport || ghTransport(options.repo, options.gh);
    const repository = await transport.repository();
    assert(repository.full_name?.toLowerCase() === options.repo.toLowerCase() && repository.private === false && repository.visibility === "public" && repository.permissions?.push === true, "Repository must be existing public destination with write access.");
    receipt.visibility = repository.visibility;
    before = await snapshot(transport, tag); receipt.before = before;
    assert(before.release.tag_name === tag && before.release.draft === false && before.release.prerelease === false, "Expected existing published stable release is required.");
    for (const asset of local.assets) assert(!before.assets.some(remote => remote.name === asset.name), `Existing asset collision: ${asset.name}`);
    const recheckLocal = () => {
      assert(sha(fs.readFileSync(options.verification)) === receipt.verificationSha256, "Verification receipt changed during publication.");
      assert(same(local.assets, validateLocal(options).assets), "Local asset inputs changed during publication.");
    };
    if (options.publish) {
      for (const asset of local.assets) {
        recheckLocal();
        await transport.upload(tag, path.join(local.directory, asset.name));
        receipt.uploaded.push(asset.name);
      }
    }
    receipt.after = await snapshot(transport, tag);
    unchanged(before, receipt.after, options.publish ? local.assets.map(asset => asset.name) : []);
    if (options.publish) for (const asset of local.assets) {
      const remote = receipt.after.assets.filter(item => item.name === asset.name);
      assert(remote.length === 1 && remote[0].sha256 === asset.sha256 && remote[0].size === asset.size, `Uploaded asset verification failed: ${asset.name}`);
    }
    recheckLocal();
    receipt.status = options.publish ? "published" : "preflight-passed";
  } catch (error) {
    receipt.error = error.message;
    if (transport && before) try { receipt.after = await snapshot(transport, receipt.tag); unchanged(before, receipt.after, (receipt.assets || []).map(asset => asset.name)); } catch (inspectionError) { receipt.remoteInspectionError = inspectionError.message; }
  }
  fs.mkdirSync(path.dirname(path.resolve(options.receipt)), { recursive: true });
  fs.writeFileSync(options.receipt, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  if (receipt.status === "failed") { const error = new Error(receipt.error); error.receipt = receipt; throw error; }
  return receipt;
}
function args(argv) {
  const options = {}, names = { "--version": "version", "--repo": "repo", "--verification": "verification", "--asset-directory": "assetDirectory", "--receipt": "receipt", "--gh": "gh" };
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === "--publish") { assert(!options.publish, "Duplicate --publish."); options.publish = true; }
    else { assert(names[key] && argv[index + 1] && !argv[index + 1].startsWith("--") && options[names[key]] === undefined, `Invalid argument: ${key}`); options[names[key]] = argv[++index]; }
  }
  for (const key of ["version", "repo", "verification", "assetDirectory", "receipt"]) assert(options[key], `Missing ${key}.`);
  return options;
}
module.exports = { PLATFORM, REQUIRED_CHECK_SCOPES, assetNames, validateLocal, publish, args, ghTransport };
if (require.main === module) publish(args(process.argv.slice(2))).then(receipt => console.log(JSON.stringify({ status: receipt.status, repository: receipt.repository, tag: receipt.tag, assets: receipt.assets.map(asset => asset.name) }))).catch(error => { console.error(error.message); process.exitCode = 1; });
