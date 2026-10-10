"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");

function assertWithin(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Build output escapes its owned directory: ${target}`);
  }
}

// Cleanup never traverses symlinks, including an output directory symlink.
function assertNoSymlinks(root, target) {
  assertWithin(root, target);
  let current = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Build output contains a symlink: ${current}`);
    }
  }
}

function readProject(projectRoot) {
  const root = path.resolve(projectRoot);
  const configPath = path.join(root, "tsconfig.incremental.json");
  const diagnostics = [];
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic => diagnostics.push(diagnostic),
  });
  diagnostics.push(...(parsed?.errors ?? []));
  if (!parsed || diagnostics.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: name => name,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }));
  }
  const outDir = path.join(root, "dist");
  const buildInfoPath = path.join(outDir, ".incremental.tsbuildinfo");
  if (path.resolve(parsed.options.outDir) !== outDir ||
      path.resolve(parsed.options.tsBuildInfoFile) !== buildInfoPath ||
      path.resolve(parsed.options.rootDir) !== root || !parsed.options.incremental) {
    throw new Error("Incremental build requires rootDir '.', outDir 'dist', and its owned build-info file.");
  }
  assertNoSymlinks(root, outDir);
  const expectedOutputs = new Set();
  for (const source of parsed.fileNames) {
    if (/\.d\.[cm]?ts$/i.test(source)) continue;
    const relativeSource = path.relative(root, source);
    if (!/^(src|test)[\\/]/.test(relativeSource)) {
      throw new Error(`Source is outside src/test: ${source}`);
    }
    for (const output of ts.getOutputFileNames(parsed, source, !ts.sys.useCaseSensitiveFileNames)) {
      const target = path.resolve(output);
      assertWithin(outDir, target);
      assertNoSymlinks(root, target);
      expectedOutputs.add(target);
    }
  }
  assertNoSymlinks(root, buildInfoPath);
  return { root, configPath, outDir, buildInfoPath, expectedOutputs };
}

function reconcileOutputs(project) {
  if (project.outDir !== path.join(project.root, "dist") ||
      project.buildInfoPath !== path.join(project.outDir, ".incremental.tsbuildinfo")) {
    throw new Error("Output reconciliation requires the project's owned dist directory and build-info file.");
  }
  assertNoSymlinks(project.root, project.buildInfoPath);
  for (const output of project.expectedOutputs) {
    assertWithin(project.outDir, output);
    assertNoSymlinks(project.root, output);
  }
  const stale = [];
  function visit(directory) {
    assertNoSymlinks(project.root, directory);
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      assertWithin(project.outDir, target);
      assertNoSymlinks(project.root, target);
      if (entry.isDirectory()) visit(target);
      else if (/\.(?:js|js\.map)$/.test(entry.name) && !project.expectedOutputs.has(target)) stale.push(target);
    }
  }
  // Only compiler-owned source/test outputs are reconciled. Other dist assets are retained.
  visit(path.join(project.outDir, "src"));
  visit(path.join(project.outDir, "test"));
  const missing = [...project.expectedOutputs].filter(output => !fs.existsSync(output));
  for (const target of stale) fs.unlinkSync(target);
  if (stale.length || missing.length) {
    // TypeScript otherwise trusts its cache even when emitted files disappeared.
    if (fs.existsSync(project.buildInfoPath)) fs.unlinkSync(project.buildInfoPath);
  }
  return { removed: stale, missing, invalidated: stale.length > 0 || missing.length > 0 };
}

function runBuild(projectRoot = path.join(__dirname, "..")) {
  const project = readProject(projectRoot);
  reconcileOutputs(project);
  const result = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", project.configPath], {
    cwd: project.root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`TypeScript terminated by ${result.signal}`);
  if (result.status === 0) require("./stage-platform-runtime.cjs").stagePlatformRuntime(project.root);
  return result.status ?? 1;
}

module.exports = { assertWithin, readProject, reconcileOutputs, runBuild };

if (require.main === module) {
  try {
    process.exitCode = runBuild();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
