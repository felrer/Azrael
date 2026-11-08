"use strict";

const path = require("node:path");
const { isProductInput, maintenanceRegressionChecks } = require('./source-test-policy.cjs');
const normalize = value => value.replace(/\\/g, "/").replace(/^\.\//, "");
const within = (file, owner) => file === owner || file.startsWith(owner.replace(/\/$/, "") + "/");
const sources = check => check.args.filter(arg => /\.(?:cjs|mjs|js|py)$/.test(arg) && !arg.includes("{"));

function validate(check, reference) {
  if (!Object.hasOwn(check, "sourceSelection")) return;
  const value = check.sourceSelection;
  if (check.level !== "source" || check.executable !== "node" || !value ||
      Object.keys(value).join() !== "files" || !Array.isArray(value.files) || !value.files.length ||
      new Set(value.files).size !== value.files.length) throw Error(`Invalid source selection: ${check.id}`);
  value.files.forEach(file => { if (typeof file !== "string") throw Error(`Invalid source selection: ${check.id}`); reference(file); });
  const direct = check.args.includes("--test");
  const lifecycle = check.args.length === 3 && check.args[0] === "scripts/check-artifact-lifecycle.cjs" &&
    check.args[1] === "--stage" && ["source", "writers"].includes(check.args[2]);
  if ((!direct && !lifecycle) || (direct && JSON.stringify(sources(check)) !== JSON.stringify(value.files))) {
    throw Error(`Unsupported source selection command: ${check.id}`);
  }
  if (lifecycle) {
    const commands = require('./check-artifact-lifecycle.cjs').commands(check.args[2], process.platform, '.', '.');
    const files = commands.flatMap(([, args]) => args.filter(arg => /^scripts\/.*\.cjs$/.test(arg)));
    if (JSON.stringify(files) !== JSON.stringify(value.files)) throw Error(`Incomplete source selection files: ${check.id}`);
  }
}

// Reuse the source runner's syntax parser; never load test modules to discover imports.
function select(features, config) {
  const deferred = [];
  if (config.productBuild === true) features = features.map(feature => ({ ...feature,
    checks: feature.checks.filter(check => {
      if (!maintenanceRegressionChecks.has(check.id)) return true;
      deferred.push({ checkId: check.id, reason: 'Module-only regression' });
      return false;
    }) }));
  if (config.sourceCheckPaths === undefined || config.fullRegression === true) return { features };
  if (!Array.isArray(config.sourceCheckPaths) || config.sourceCheckPaths.some(file =>
    typeof file !== "string" || !file || file.includes("\0") || path.isAbsolute(file) ||
    /^[A-Za-z]:[\\/]/.test(file) || normalize(file).split("/").includes(".."))) throw Error("Invalid sourceCheckPaths");
  const changedPaths = [...new Set(config.sourceCheckPaths.map(normalize).filter(isProductInput))].sort();
  const selection = { changedPaths, checks: [], ...(deferred.length ? { deferred } : {}) };
  const scoped = features.filter(feature => feature.checks.some(check => check.sourceSelection));
  if (!scoped.length) return { features, selection };
  const roots = [...new Set(scoped.flatMap(feature => feature.checks.filter(check => check.level === "source")
    .flatMap(check => check.sourceSelection?.files ?? sources(check))))];
  const owners = new Map();
  const dynamic = require("./test-project.cjs").scriptOwners(roots, config.projectRoot, owners);
  const globalInputs = new Set(["scripts/azrael-feature-contracts.json", "scripts/source-check-selection.cjs",
    "scripts/test-project.cjs", "scripts/feature-preservation.cjs", "package.json", "package-lock.json",
    "extensions/azrael-ex/package.json", "extensions/azrael-ex/package-lock.json"]);
  const affected = new Set();
  const unresolved = new Map();
  for (const file of changedPaths) {
    const direct = roots.includes(file);
    if (direct) affected.add(file);
    else for (const test of owners.get(file) ?? []) affected.add(test);
    const matched = direct || (owners.get(file)?.size ?? 0) > 0;
    for (const item of dynamic) if (file.startsWith(item.prefix)) {
      if (item.bounded || !matched || affected.has(item.test)) affected.add(item.test);
      else unresolved.set(`${file}\0${item.source}`, { path: file, source: item.source });
    }
  }
  if (unresolved.size) selection.unresolved = [...unresolved.values()];
  const output = features.map(feature => {
    if (!feature.checks.some(check => check.sourceSelection)) return feature;
    const featureRoots = new Set(feature.checks.filter(check => check.level === "source")
      .flatMap(check => check.sourceSelection?.files ?? sources(check)));
    const unmapped = changedPaths.filter(file => feature.owners.some(owner => within(file, owner)) &&
      !featureRoots.has(file) && ![...(owners.get(file) ?? [])].some(test => featureRoots.has(test)) &&
      !dynamic.some(item => featureRoots.has(item.test) && file.startsWith(item.prefix)));
    const fallback = !config.sourceCheckPaths.length || changedPaths.some(file => globalInputs.has(file)) || unmapped.length > 0;
    return { ...feature, checks: feature.checks.flatMap(check => {
      if (!check.sourceSelection) return [check];
      const files = check.sourceSelection.files.filter(file => fallback || affected.has(file));
      selection.checks.push({ checkId: check.id, files, ...(fallback ? { fallback: unmapped.length ? unmapped : ["full selection input"] } : {}) });
      if (!files.length) return [];
      const args = check.args.includes("--test") ? check.args.filter(arg =>
        !check.sourceSelection.files.includes(arg) || files.includes(arg)) :
        [...check.args, ...files.flatMap(file => ["--test-file", file])];
      return [{ ...check, args }];
    }) };
  });
  return { features: output, selection };
}

module.exports = { validate, select };
