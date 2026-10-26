"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { buildRelease } = require("./build-instruction-release.cjs");

// The caller owns parent and the returned directory's entire lifecycle.
async function createCurrentInstructionRelease({ projectRoot, parent }) {
  assert(path.isAbsolute(projectRoot), "Instruction project root must be absolute");
  assert(path.isAbsolute(parent), "Instruction fixture parent must be explicitly absolute");
  projectRoot = await fs.realpath(projectRoot);
  const parentStat = await fs.lstat(parent);
  assert(parentStat.isDirectory() && !parentStat.isSymbolicLink(), "Instruction fixture parent must be an owned directory");
  parent = await fs.realpath(parent);
  const artifacts = await fs.realpath(path.join(projectRoot, "artifacts"));
  const relativeParent = path.relative(artifacts, parent);
  assert(relativeParent && relativeParent !== ".." && !relativeParent.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeParent), "Instruction fixture parent must be an owned child of project artifacts");
  const parentRepository = execFileSync("git", ["-C", parent, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  assert.equal(await fs.realpath(parentRepository), projectRoot, "Instruction fixture parent must belong to the current project checkout");
  const git = (...args) => execFileSync("git", ["-C", projectRoot, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const sourceCommit = git("rev-parse", "HEAD").trim();
  const inputs = [...new Set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "instructions").split("\0").filter(Boolean))];
  const appVersion = JSON.parse(await fs.readFile(path.join(projectRoot, "extensions/azrael-ex/package.json"), "utf8")).version;
  const directory = await fs.mkdtemp(path.join(parent, "current-instruction-release-"));
  try {
    // buildRelease can inspect Git status through the owning checkout. Its
    // content hash describes the copied inputs; sourceCommit is current HEAD.
    const source = path.join(directory, "instructions");
    await fs.mkdir(source);
    for (const input of inputs) {
      const parts = input.split("/");
      assert(parts[0] === "instructions" && parts.length > 1 && !input.includes("\\") && !parts.some(part => !part || part === "." || part === ".."), `Unsafe instruction input: ${input}`);
      if (parts[1].toLowerCase() === ".private" || parts.includes("__pycache__")) continue;
      // Inspect every ancestor too: a regular file reached through a linked
      // directory must never escape the public instruction source boundary.
      let original = projectRoot;
      for (let index = 0; index < parts.length; index++) {
        original = path.join(original, parts[index]);
        const stat = await fs.lstat(original);
        assert(!stat.isSymbolicLink() && (index === parts.length - 1 ? stat.isFile() : stat.isDirectory()), `Instruction input must be a regular file under ordinary directories: ${input}`);
      }
      const destination = path.join(directory, ...parts);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const bytes = await fs.readFile(original);
      await fs.writeFile(destination, bytes, { flag: "wx" });
      assert.deepEqual(await fs.readFile(destination), bytes, `Instruction copy integrity failed: ${input}`);
      assert.deepEqual(await fs.readFile(original), bytes, `Instruction source changed during copy: ${input}`);
    }
    const result = await buildRelease({ source, output: path.join(directory, "release"), sourceCommit, allowDirty: true });
    const manifest = JSON.parse(await fs.readFile(result.manifest, "utf8"));
    const assets = new Map();
    for (const filename of [result.manifest, result.archive, result.documents]) assets.set(path.basename(filename), await fs.readFile(filename));
    return { directory, assets, manifest, version: result.version, appVersion };
  } catch (error) {
    await fs.rm(directory, { recursive: true });
    await assert.rejects(fs.access(directory), { code: "ENOENT" });
    throw error;
  }
}

module.exports = { createCurrentInstructionRelease };
