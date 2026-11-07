"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { selectCommittedProject, materializeCommittedProject } = require("./committed-project-inputs.cjs");
const fixture = process.argv[2];
assert(fixture && path.isAbsolute(fixture), "Fresh absolute owned fixture required");
function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function repository(root) {
  fs.mkdirSync(root);
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Committed Inputs Fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
}
function commit(root, message) { git(root, "add", "--all"); git(root, "commit", "--quiet", "-m", message); return git(root, "rev-parse", "HEAD"); }
async function main() {
  fs.mkdirSync(fixture);
  const root = path.join(fixture, "source"); repository(root);
  fs.writeFileSync(path.join(root, "input.txt"), "committed\n");
  fs.writeFileSync(path.join(root, "deleted.txt"), "restore committed deletion\n");
  fs.writeFileSync(path.join(root, ".gitattributes"), "input.txt export-ignore\n*.txt export-subst\n");
  const first = commit(root, "baseline");
  fs.writeFileSync(path.join(root, "input.txt"), "staged\n"); git(root, "add", "input.txt");
  fs.appendFileSync(path.join(root, "input.txt"), "dirty\n");
  fs.unlinkSync(path.join(root, "deleted.txt"));
  fs.writeFileSync(path.join(root, "untracked.txt"), "excluded\n");
  const selected = selectCommittedProject(root);
  assert.equal(selected.commit, first);
  assert(Object.isFrozen(selected.inventory[0].entries[0]));
  const later = commit(root, "later checkout"); assert.notEqual(later, first);
  const destination = path.join(fixture, "frozen");
  const receipt = await materializeCommittedProject(selected, destination);
  assert.equal(receipt.sourceCommit, first);
  assert.equal(fs.readFileSync(path.join(destination, "input.txt"), "utf8"), "committed\n");
  assert.equal(fs.readFileSync(path.join(destination, "deleted.txt"), "utf8"), "restore committed deletion\n");
  assert(!fs.existsSync(path.join(destination, "untracked.txt")));
  const retry = await materializeCommittedProject(selectCommittedProject(root, first), path.join(fixture, "retry"));
  assert.equal(retry.sha256, receipt.sha256);
  assert.throws(() => selectCommittedProject(root, "HEAD"), /Full sourceCommit/);
  assert.throws(() => selectCommittedProject(root, "0".repeat(first.length)), /Git command failed/);
  const nested = path.join(root, "vendor"); repository(nested);
  fs.writeFileSync(path.join(nested, "nested.txt"), "recorded gitlink\n");
  const recorded = commit(nested, "nested baseline");
  git(root, "add", "vendor"); git(root, "commit", "--quiet", "-m", "record gitlink");
  fs.writeFileSync(path.join(nested, "nested.txt"), "new nested HEAD\n"); commit(nested, "nested advance");
  const gitlinks = selectCommittedProject(root);
  assert.equal(gitlinks.inventory[1].commit, recorded);
  const linked = path.join(fixture, "gitlinks"); await materializeCommittedProject(gitlinks, linked);
  assert.equal(fs.readFileSync(path.join(linked, "vendor/nested.txt"), "utf8"), "recorded gitlink\n");
  const linkSource = path.join(fixture, "link-source"); repository(linkSource);
  fs.writeFileSync(path.join(linkSource, "COPYING"), "license text\n");
  fs.writeFileSync(path.join(linkSource, "LICENSE"), "COPYING");
  git(linkSource, "add", ".");
  git(linkSource, "update-index", "--cacheinfo", `120000,${git(linkSource, "hash-object", "LICENSE")},LICENSE`);
  git(linkSource, "commit", "--quiet", "-m", "committed link");
  const linkOutput = path.join(fixture, "link-output");
  await materializeCommittedProject(selectCommittedProject(linkSource), linkOutput);
  if (process.platform === "win32") {
    assert.equal(fs.lstatSync(path.join(linkOutput, "LICENSE")).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(linkOutput, "LICENSE"), "utf8"), "COPYING");
  } else assert.equal(fs.readlinkSync(path.join(linkOutput, "LICENSE")), "COPYING");
  git(root, "update-index", "--cacheinfo", `160000,${"0".repeat(first.length - 1)}1,vendor`);
  git(root, "commit", "--quiet", "-m", "missing gitlink commit");
  assert.throws(() => selectCommittedProject(root), /Git command failed|unavailable/);
  git(root, "reset", "--mixed", gitlinks.commit);
  fs.mkdirSync(path.join(root, "artifacts")); fs.writeFileSync(path.join(root, "artifacts/generated.txt"), "must fail\n"); commit(root, "generated input");
  assert.throws(() => selectCommittedProject(root), /generated committed source/);
  console.log(JSON.stringify({ status: "passed", fixture, sourceCommit: first, checks: ["dirty/staged/deleted/untracked exclusion", "later HEAD excluded", "explicit selected commit retry", "raw objects ignore archive attributes", "recorded gitlink and missing commit", "committed generated paths rejected"] }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
