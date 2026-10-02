"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { performance } = require("node:perf_hooks");

// Keep text credential scanning focused on source and configuration assets.
const generatedAssetExtension = /\.(exe|dll|pdb|node|so|dylib|wasm|woff|woff2|ttf|otf|png|jpg|jpeg|gif|svg|webp|avif|ico|mp3|mp4|webm|zip|gz|br)$/i;

function textScanFiles(files) {
  return files.filter(file => file.contents === undefined &&
    !file.localPath.includes("node_modules") &&
    !generatedAssetExtension.test(file.localPath));
}

// The pinned no-dotenv rule rejects the exact basename .env. Check every
// collected entry, including dependencies, trusted assets and rewritten buffers,
// without opening file contents. Accept both archive and platform separators.
function validateEnvPaths(files) {
  for (const file of files) {
    for (const candidate of [file.path, file.localPath, file.originalPath]) {
      if (candidate !== undefined && candidate.split(/[\\/]/).at(-1) === ".env") {
        throw new Error("Host package environment file check failed.");
      }
    }
  }
}

function withinRoot(root, file) {
  const relative = path.relative(root, file);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function untrustedTextFiles(files, cwd, pristineRoot) {
  const textFiles = textScanFiles(files);
  if (!pristineRoot) return textFiles;
  const hostRoot = await fs.promises.realpath(cwd);
  const trustedRoot = await fs.promises.realpath(pristineRoot);
  const selected = [];
  for (const file of textFiles) {
    const local = path.resolve(file.localPath);
    const relative = path.relative(path.resolve(cwd), local);
    // Environment files never inherit pristine trust in the manual scan.
    if (!withinRoot(path.resolve(cwd), local) || /^\.env(?:\.|$)/i.test(path.basename(local))) {
      selected.push(file);
      continue;
    }
    const candidate = path.resolve(trustedRoot, relative);
    let identical = false;
    if (withinRoot(trustedRoot, candidate)) {
      try {
        const [realLocal, realCandidate] = await Promise.all([
          fs.promises.realpath(local), fs.promises.realpath(candidate),
        ]);
        if (withinRoot(hostRoot, realLocal) && withinRoot(trustedRoot, realCandidate)) {
          const [localHash, trustedHash] = await Promise.all([sha256(realLocal), sha256(realCandidate)]);
          identical = localHash === trustedHash;
        }
      } catch (error) {
        // Missing/unreadable reference assets confer no trust; scan the local file.
        if (!error || !["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EISDIR"].includes(error.code)) throw error;
      }
    }
    if (!identical) selected.push(file);
  }
  return selected;
}

// Match the pinned VSCE writer: collected buffers/paths and modes, output replacement,
// and SOURCE_DATE_EPOCH ordering and timestamps. Resolve yazl from that same tool.
async function writeVsix(files, packagePath, yazl) {
  await fs.promises.unlink(packagePath).catch(error => {
    if (error.code !== "ENOENT") throw error;
  });
  await new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const zipOptions = {};
    if (process.env.SOURCE_DATE_EPOCH) {
      zipOptions.mtime = new Date(parseInt(process.env.SOURCE_DATE_EPOCH) * 1000);
      files.sort((a, b) => a.path.localeCompare(b.path));
    }
    zip.once("error", reject);
    files.forEach(file => file.contents !== undefined
      ? zip.addBuffer(typeof file.contents === "string" ? Buffer.from(file.contents, "utf8") : file.contents,
        file.path, { ...zipOptions, mode: file.mode })
      : zip.addFile(file.localPath, file.path, { ...zipOptions, mode: file.mode }));
    zip.end();
    const output = fs.createWriteStream(packagePath);
    zip.outputStream.once("error", reject);
    output.once("error", reject);
    output.once("finish", resolve);
    zip.outputStream.pipe(output);
  });
}

async function packageLocalHost(vsceCliPath, outputVsixPath, pristineRoot) {
  const started = performance.now();
  const metrics = { timingsMs: {}, counts: {}, outputBytes: 0, success: false };
  async function timed(stage, action) {
    const start = performance.now();
    try { return await action(); }
    finally { metrics.timingsMs[stage] = performance.now() - start; }
  }
  const cli = path.resolve(vsceCliPath);
  const toolRoot = path.dirname(cli);
  const { readManifest, collect, printAndValidatePackagedFiles } = require(path.join(toolRoot, "out/package.js"));
  const { lintFiles, lintText } = require(path.join(toolRoot, "out/secretLint.js"));
  const yazl = require(require.resolve("yazl", { paths: [toolRoot] }));
  const cwd = process.cwd();
  const output = path.resolve(outputVsixPath);
  const options = {
    cwd,
    dependencies: false,
    allowMissingRepository: true,
    rewriteRelativeLinks: false,
    packagePath: output,
    allowPackageAllSecrets: true,
  };
  try {
    let manifest;
    const files = await timed("collect", async () => {
      manifest = await readManifest(cwd);
      return collect(manifest, options);
    });
    metrics.counts.collected = files.length;
    await timed("envPathGuard", () => validateEnvPaths(files));
    metrics.counts.envPathChecked = files.length;
    // Disable VSCE's content scan only after our complete filename guard passes.
    options.allowPackageEnvFile = true;
    const textFiles = textScanFiles(files);
    const memoryFiles = files.filter(file => file.contents !== undefined);
    const scanFiles = await timed("trustedComparison", () => untrustedTextFiles(files, cwd, pristineRoot));
    Object.assign(metrics.counts, { textCandidates: textFiles.length,
      trustedText: textFiles.length - scanFiles.length, scannedDisk: scanFiles.length, scannedMemory: memoryFiles.length });
    await timed("scan", async () => {
      const result = await lintFiles(scanFiles.map(file => file.localPath), true, true);
      if (!result.ok) throw new Error("Host package secret check failed.");
      for (const file of memoryFiles) {
        const result = await lintText(typeof file.contents === "string" ? file.contents : file.contents.toString("utf8"), file.path, true, true);
        if (!result.ok) throw new Error("Host package secret check failed.");
      }
    });
    // Reuse this exact set and retain VSCE's manifest and package validation.
    await timed("validationEnvGuard", () => printAndValidatePackagedFiles(files, cwd, manifest, options));
    await timed("archive", () => writeVsix(files, output, yazl));
    metrics.outputBytes = (await fs.promises.stat(output)).size;
    metrics.success = true;
    return 0;
  } finally {
    metrics.timingsMs.total = performance.now() - started;
    await fs.promises.writeFile(`${output}.metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`);
  }
}

module.exports = { packageLocalHost, textScanFiles, untrustedTextFiles, validateEnvPaths, writeVsix };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.length > 3) {
    console.error("Usage: node package-local-host.cjs <vsce-cli-path> <output-vsix-path> [trusted-pristine-ui-root]");
    process.exitCode = 1;
  } else {
    packageLocalHost(...args).then(code => { process.exitCode = code; }, () => {
      // Never print scanner results or errors that could include credential text.
      console.error("Host package preparation or secret check failed.");
      process.exitCode = 1;
    });
  }
}
