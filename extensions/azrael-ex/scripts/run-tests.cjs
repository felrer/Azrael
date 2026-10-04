"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Retained standalone host coverage. New test files belong to current by default.
const STANDALONE_FILES = Object.freeze([
  "appServerTransport.test.js",
  "chatSession.test.js",
  "hostRuntime.test.js",
  "standaloneChatActivation.test.js",
  "standaloneHostContract.test.js",
]);

function selectTestFiles(mode, discoveredFiles) {
  if (!["current", "standalone", "all"].includes(mode)) {
    throw new Error(`Unknown test scope: ${mode}`);
  }
  const files = [...discoveredFiles].filter(file => file.endsWith(".test.js")).sort();
  const retained = new Set(STANDALONE_FILES);
  for (const filename of retained) {
    if (!files.some(file => path.basename(file) === filename)) {
      throw new Error(`Missing retained standalone test: ${filename}; run build:incremental first.`);
    }
  }
  const selected = files.filter(file => mode === "all" ||
    (retained.has(path.basename(file)) === (mode === "standalone")));
  if (selected.length === 0) throw new Error(`No compiled tests found for scope: ${mode}`);
  return selected;
}

function runTests(args = process.argv.slice(2)) {
  const [mode = "current", ...options] = args;
  if (options.length > 1 || (options.length === 1 && options[0] !== "--serial")) {
    throw new Error("Usage: node scripts/run-tests.cjs [current|standalone|all] [--serial]");
  }
  const testDirectory = path.resolve(__dirname, "../dist/test");
  const discovered = fs.readdirSync(testDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".test.js"))
    .map(entry => path.join(testDirectory, entry.name));
  const selected = selectTestFiles(mode, discovered);
  console.log(`Test scope: ${mode}; files: ${selected.length}; concurrency: ${options.length ? 1 : 4}`);
  const result = spawnSync(process.execPath, [
    "--test", `--test-concurrency=${options.length ? 1 : 4}`, ...selected,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Test runner terminated by ${result.signal}`);
  return result.status ?? 1;
}

module.exports = { STANDALONE_FILES, selectTestFiles, runTests };

if (require.main === module) {
  try {
    process.exitCode = runTests();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
