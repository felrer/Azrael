"use strict";

const fs = require("node:fs");
const path = require("node:path");

function cleanBuild() {
  const projectRoot = path.resolve(__dirname, "..");
  const target = path.resolve(projectRoot, "dist");
  if (path.dirname(target) !== projectRoot || path.basename(target) !== "dist") {
    throw new Error("Build cleanup requires the project's own dist directory.");
  }
  for (let cursor = projectRoot; ; cursor = path.dirname(cursor)) {
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error("Build cleanup cannot traverse linked directories.");
    if (path.dirname(cursor) === cursor) break;
  }
  let targetStat;
  try { targetStat = fs.lstatSync(target); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
    throw new Error("Build cleanup requires an unlinked dist directory.");
  }
  const assertUnlinked = (entry) => {
    const stat = fs.lstatSync(entry);
    if (stat.isSymbolicLink()) throw new Error("Build cleanup cannot remove linked outputs.");
    if (stat.isDirectory()) for (const name of fs.readdirSync(entry)) assertUnlinked(path.join(entry, name));
  };
  assertUnlinked(target);
  fs.rmSync(target, { recursive: true });
  if (fs.existsSync(target)) throw new Error("Build cleanup did not remove dist.");
}

module.exports = { cleanBuild };
if (require.main === module) cleanBuild();
