"use strict";

const fs = require("node:fs");
const path = require("node:path");

function stagePlatformRuntime(projectRoot = path.resolve(__dirname, ".."), sourceDirectory = path.resolve(__dirname, "../../..", "scripts")) {
  const sourceRoot = path.resolve(sourceDirectory);
  const destination = path.join(projectRoot, "dist");
  if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) {
    throw new Error("Platform staging requires the project's own dist directory.");
  }
  fs.mkdirSync(destination, { recursive: true });
  for (const filename of ["platform-runtime.cjs", "azrael-platforms.json"]) {
    const target = path.join(destination, filename);
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
      throw new Error("Platform staging cannot replace a linked output.");
    }
    fs.copyFileSync(path.join(sourceRoot, filename), target);
  }
}

module.exports = { stagePlatformRuntime };
if (require.main === module) stagePlatformRuntime(undefined, process.env.AZRAEL_PLATFORM_RUNTIME_SOURCE || undefined);
