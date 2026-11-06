"use strict";
// One payload owner for build staging and both installed host entry points.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { requireExecutable } = require("./platform-runtime.cjs");
const names = ["helper.cjs", "find-names-casefold.json", "typescript.js", "TypeScript-LICENSE.txt", "TypeScript-ThirdPartyNoticeText.txt", "Unicode-LICENSE.txt"];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function verify(helper) {
  if (!path.isAbsolute(helper) || path.basename(helper) !== "helper.cjs") throw new Error("Invalid find_names helper path.");
  const root = fs.realpathSync.native(path.dirname(helper));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  if (manifest.schema !== 1 || manifest.typescriptVersion !== "5.9.3" || manifest.unicodeVersion !== "15.1.0" ||
      !manifest.files || Object.keys(manifest.files).sort().join() !== [...names].sort().join()) throw new Error("Invalid find_names payload manifest.");
  for (const name of names) {
    const file = path.join(root, name), physical = fs.realpathSync.native(file);
    if (path.dirname(physical) !== root || !fs.statSync(physical).isFile() || !/^[a-f0-9]{64}$/.test(manifest.files[name]) || sha(physical) !== manifest.files[name]) {
      throw new Error("find_names payload integrity mismatch. Rebuild and redeploy Azrael.");
    }
  }
  const release = path.resolve(root, "../..");
  if (!manifest.node || typeof manifest.node.path !== "string" || !/^[-a-zA-Z0-9_./]+$/.test(manifest.node.path) ||
      manifest.node.path.split("/").some(part => !part || part === "." || part === "..") || !/^[a-f0-9]{64}$/.test(manifest.node.sha256)) throw new Error("Invalid find_names Node receipt.");
  const nodeExecutable = fs.realpathSync.native(path.join(release, manifest.node.path));
  const relative = path.relative(release, nodeExecutable);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.statSync(nodeExecutable).isFile() || sha(nodeExecutable) !== manifest.node.sha256) throw new Error("find_names Node integrity mismatch.");
  requireExecutable(nodeExecutable);
  return { helper: path.join(root, "helper.cjs"), nodeExecutable, manifest };
}
function stage(release, project, typescript, nodeExecutable = process.execPath, nodeRelative = "node/" + path.basename(nodeExecutable)) {
  for (const value of [release, project, typescript, nodeExecutable]) if (!path.isAbsolute(value)) throw new Error("find_names staging requires absolute paths.");
  if (!/^[-a-zA-Z0-9_./]+$/.test(nodeRelative) || nodeRelative.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid find_names Node output path.");
  requireExecutable(nodeExecutable);
  const nodeHash = sha(nodeExecutable), nodeTarget = path.join(release, nodeRelative);
  const packageRoot = path.dirname(path.dirname(typescript));
  if (JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).version !== "5.9.3") throw new Error("find_names requires TypeScript 5.9.3.");
  const sources = [path.join(project, "scripts/find-names-helper.cjs"), path.join(project, "scripts/find-names-casefold.json"), typescript,
    path.join(packageRoot, "LICENSE.txt"), path.join(packageRoot, "ThirdPartyNoticeText.txt"), path.join(project, "scripts/find-names-Unicode-LICENSE.txt")];
  // Capture all bytes before creating output; missing inputs cannot leave a partial payload.
  const bytes = sources.map(file => fs.readFileSync(file));
  if (fs.existsSync(nodeTarget)) {
    if (sha(nodeTarget) !== nodeHash) throw new Error("Selected find_names Node output differs.");
  } else {
    fs.mkdirSync(path.dirname(nodeTarget), { recursive: true });
    fs.copyFileSync(nodeExecutable, nodeTarget, fs.constants.COPYFILE_EXCL);
    if (process.platform !== "win32") fs.chmodSync(nodeTarget, 0o755);
  }
  const root = path.join(release, "tools/find-names");
  fs.mkdirSync(root, { recursive: true });
  for (let i = 0; i < names.length; i++) fs.writeFileSync(path.join(root, names[i]), bytes[i], { flag: "wx" });
  const files = Object.fromEntries(names.map(name => [name, sha(path.join(root, name))]));
  fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({ schema: 1, typescriptVersion: "5.9.3", unicodeVersion: "15.1.0", node: { path: nodeRelative, sha256: nodeHash }, files }) + "\n", { flag: "wx" });
  return verify(path.join(root, "helper.cjs"));
}
function configureEnvironment(env, config) {
  for (const name of Object.keys(env)) if (["AZRAEL_FIND_NAMES_NODE", "AZRAEL_FIND_NAMES_HELPER"].includes(name.toUpperCase())) delete env[name];
  if (!config.findNamesHelper) return;
  for (const name of Object.keys(env)) if (["NODE_OPTIONS", "NODE_PATH"].includes(name.toUpperCase())) delete env[name];
  const { helper, nodeExecutable } = verify(config.findNamesHelper);
  if (!config.nodeExecutable || !path.isAbsolute(config.nodeExecutable)) throw new Error("find_names requires the managed Node executable.");
  requireExecutable(config.nodeExecutable);
  if (fs.realpathSync.native(config.nodeExecutable) !== nodeExecutable) throw new Error("find_names Node does not match the selected runtime.");
  env.AZRAEL_FIND_NAMES_NODE = nodeExecutable;
  env.AZRAEL_FIND_NAMES_HELPER = helper;
}
module.exports = { stage, verify, configureEnvironment };
if (require.main === module) {
  const [action, ...args] = process.argv.slice(2);
  try {
    const result = action === "stage" ? stage(...args) : action === "verify" ? verify(...args) : (() => { throw new Error("Invalid find_names runtime action."); })();
    process.stdout.write(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
