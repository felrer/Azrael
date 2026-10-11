"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const MAGIC = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]);
function sha(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function ensureMacSignatures(root, options = {}) {
  const os = options.platform || process.platform, arch = options.arch || process.arch;
  if (os !== "darwin") return null;
  if (arch !== "arm64") throw new Error("Mac signing requires native darwin arm64.");
  root = path.resolve(root);
  if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root) !== root) throw new Error("Signing root must not traverse a symlink.");
  const run = options.run || ((args) => spawnSync("/usr/bin/codesign", args, { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }));
  const files = [];
  function inside(file) { const relative = path.relative(root, file); return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative)); }
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        if (!inside(fs.realpathSync(file))) throw new Error("Signing tree contains an outside symlink: " + file);
        continue; // Contained targets are visited at their regular paths exactly once.
      }
      if (stat.isDirectory()) { walk(file); continue; }
      if (!stat.isFile()) throw new Error("Signing tree contains a nonregular object: " + file);
      const header = Buffer.alloc(4), fd = fs.openSync(file, "r");
      let length; try { length = fs.readSync(fd, header, 0, 4, 0); } finally { fs.closeSync(fd); }
      if (length === 4 && MAGIC.has(header.readUInt32BE())) files.push(file);
    }
  }
  walk(root); // Validate the entire boundary before mutating any code object.
  const receipt = { schema: 1, status: "passed", platform: { os, arch, target: "aarch64-apple-darwin" }, policy: "adhoc-without-notarization", files: [] };
  function invoke(args) {
    const result = run(args);
    if (result.error) throw result.error;
    return { status: result.status, output: (result.stdout || "") + (result.stderr || "") };
  }
  for (const file of files) {
    const beforeSha256 = sha(file), existing = invoke(["--display", "--verbose=4", file]);
    let action = "preserved";
    if (existing.status !== 0) {
      if (!/code object is not signed at all/.test(existing.output)) throw new Error("Cannot inspect existing Mac signature: " + file + "\n" + existing.output);
      const signed = invoke(["--sign", "-", file]);
      if (signed.status !== 0) throw new Error("Ad-hoc signing failed: " + file + "\n" + signed.output);
      action = "signed-adhoc";
    }
    const verified = invoke(["--verify", "--strict", file]);
    if (verified.status !== 0) throw new Error("Invalid Mac signature: " + file + "\n" + verified.output);
    const detail = action === "preserved" ? existing : invoke(["--display", "--verbose=4", file]);
    if (detail.status !== 0) throw new Error("Cannot inspect final Mac signature: " + file);
    receipt.files.push({ path: path.relative(root, file).split(path.sep).join("/"), beforeSha256, sha256: sha(file), action, signature: /Signature=adhoc|flags=.*\badhoc\b/.test(detail.output) ? "adhoc" : "identity", verified: true });
  }
  receipt.files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  return receipt;
}
module.exports = { ensureMacSignatures };
