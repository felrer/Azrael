"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function dependency(name) {
  return require(require.resolve(name, { paths: [path.join(__dirname, "../extensions/azrael-ex"), __dirname] }));
}

function enumerate(root, folder = root) {
  const files = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Instruction source must not contain symlinks.");
    const filename = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "__pycache__", "node_modules"].includes(entry.name)) throw new Error(`Unexpected instruction cache: ${entry.name}`);
      files.push(...enumerate(root, filename));
    } else if (entry.isFile()) {
      const relative = path.relative(root, filename).split(path.sep).join("/");
      if (entry.name === ".env" || entry.name.startsWith(".env.")) throw new Error("Environment files cannot be instruction release assets.");
      const bytes = fs.readFileSync(filename);
      files.push({ path: relative, sha256: sha256(bytes), size: bytes.length });
    } else throw new Error("Unsupported instruction source entry.");
  }
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

async function buildRelease({ source, output, repository = "felrer/Azrael", allowDirty = false, sourceCommit }) {
  source = fs.realpathSync(source);
  output = path.resolve(output);
  const sourceRelative = path.relative(source, output);
  if (!sourceRelative || (!sourceRelative.startsWith(".." + path.sep) && sourceRelative !== ".." && !path.isAbsolute(sourceRelative))) {
    throw new Error("Release output must be outside instruction sources.");
  }
  if (fs.existsSync(output)) throw new Error("Release output already exists. Use a new directory.");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid GitHub repository.");
  const metadata = JSON.parse(fs.readFileSync(path.join(source, "azrael-environment.json"), "utf8"));
  const semver = dependency("semver");
  if (metadata.schemaVersion !== 1 || !semver.valid(metadata.instructionVersion) || !semver.valid(metadata.minimumAppVersion)) {
    throw new Error("Invalid instruction schema/version.");
  }
  const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8" }).trim();
  const sourceDirty = Boolean(git("status", "--porcelain", "--", "."));
  if (sourceDirty && !allowDirty) throw new Error("Instruction source is uncommitted. Commit for publication or use --allow-dirty for a local review artifact.");
  sourceCommit ??= git("rev-parse", "HEAD");
  if (!/^[a-f0-9]{40,64}$/.test(sourceCommit)) throw new Error("Invalid source commit.");
  const files = enumerate(source);
  const paths = new Set(files.map(file => file.path));
  const sourceContentSha256 = sha256(JSON.stringify(files));
  if (!Array.isArray(metadata.components) || !metadata.components.length) throw new Error("Missing instruction components.");
  for (const component of metadata.components) {
    for (const file of component.files ?? []) if (!paths.has(file.source)) throw new Error(`Missing component source: ${file.source}`);
  }
  const documents = files.filter(file => /\.(?:md|toml|json|py|ps1)$/i.test(file.path)).map(file => {
    const component = metadata.components.find(item => item.files?.some(mapping => mapping.source === file.path));
    return { path: file.path, title: file.path, kind: component?.kind ?? "reference" };
  });
  const documentData = Buffer.from(JSON.stringify({ documents: documents.map(document => ({ ...document,
    text: fs.readFileSync(path.join(source, ...document.path.split("/")), "utf8"),
  })) }, null, 2) + "\n");
  fs.mkdirSync(output, { recursive: true });
  const prefix = `azrael-instructions-${metadata.instructionVersion}`;
  const archivePath = path.join(output, `${prefix}.zip`);
  const zip = new (dependency("yazl").ZipFile)();
  const writing = pipeline(zip.outputStream, fs.createWriteStream(archivePath, { flags: "wx" }));
  for (const file of files) zip.addBuffer(fs.readFileSync(path.join(source, ...file.path.split("/"))), file.path,
    { mtime: new Date("2000-01-01T00:00:00Z"), mode: 0o100644 });
  zip.end();
  await writing;
  const after = enumerate(source);
  if (sha256(JSON.stringify(after)) !== sourceContentSha256) throw new Error("Instruction sources changed during packaging. Do not publish this incomplete output.");
  const documentsPath = path.join(output, `${prefix}-documents.json`);
  fs.writeFileSync(documentsPath, documentData, { flag: "wx" });
  const archiveBytes = fs.readFileSync(archivePath);
  const manifest = { ...metadata, repository, sourceCommit, sourceDirty, sourceContentSha256,
    archive: { name: path.basename(archivePath), sha256: sha256(archiveBytes), size: archiveBytes.length },
    documentsAsset: { name: path.basename(documentsPath), sha256: sha256(documentData), size: documentData.length },
    files, documents,
  };
  const manifestPath = path.join(output, `${prefix}-manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return { version: metadata.instructionVersion, sourceCommit, sourceDirty, sourceContentSha256,
    fileCount: files.length, documentCount: documents.length, archive: archivePath, manifest: manifestPath, documents: documentsPath };
}

if (require.main === module) {
  const options = { source: path.join(__dirname, "../instructions"), repository: "felrer/Azrael" };
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (key === "--allow-dirty") options.allowDirty = true;
    else if (["--source", "--output", "--repository", "--source-commit"].includes(key) && process.argv[i + 1]) {
      options[key === "--source-commit" ? "sourceCommit" : key.slice(2)] = process.argv[++i];
    } else throw new Error(`Unknown or missing argument: ${key}`);
  }
  options.output ??= path.join(__dirname, "../artifacts/instructions", `${Date.now()}`);
  buildRelease(options).then(result => process.stdout.write(JSON.stringify(result, null, 2) + "\n"))
    .catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}

module.exports = { buildRelease, enumerate };
