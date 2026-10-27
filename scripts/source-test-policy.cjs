"use strict";

const normalize = value => value.replace(/\\/g, "/").replace(/^\.\//, "");
const POLICY = "scripts/source-test-policy.cjs";
const sharedInputs = /^(?:scripts\/(?:.*cache[^/]*\.cjs|directory-state\.cjs|capture-project-inputs\.cjs|deployment-input-snapshot\.cjs|ordered-asset-reader\.cjs|azrael-feature-contracts\.json|ui-test-transform-fixture\.cjs|namespace-azrael-host\.cjs|namespace-cache-owner\.cjs|inject-[^/]+\.cjs|content-fonts\.cjs|provider-context-labels\.cjs)|artifacts\/upstream-ui\/.*|extensions\/azrael-ex\/(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|node_modules\/typescript\/.*)|scripts\/(?:prepare-|freeze-|build-|package-)[^/]+|.*(?:ui-pin|upstream-ui|source-ui)[^/]*\.(?:json|cjs|ps1))$/;
const preservationInputs = /^scripts\/(?:feature-preservation|verification-result-cache|native-verification-cache|directory-state|capture-project-inputs)\.cjs$/;
const runnerInputs = /^(?:scripts\/(?:test-project(?:-selection|-fail-fast|-maintenance)?\.cjs|azrael-feature-contracts\.json)|(?:extensions\/azrael-ex\/)?(?:package(?:-lock)?\.json|tsconfig[^/]*\.json)|extensions\/azrael-ex\/scripts\/run-tests\.cjs)$/;
const candidates = [
  { file: "scripts/test-feature-preservation-cache.cjs", test: "schema2 exact success reuses proof while project, source UI and unknown aggregate inputs miss", related: file => sharedInputs.test(file) || preservationInputs.test(file), reason: "Aggregate preservation cache matrix runs for owner changes or --exhaustive" },
  { file: "scripts/test-session-links.cjs", test: "guarded pinned 26.928.31416 outgoing links, parsing, allowlists and preservation", related: file => sharedInputs.test(file) || /^scripts\/(?:session-links\.cjs|open-azrael-session-link\.ps1|integrated-azrael-entry\.cjs)$/.test(file), reason: "Legacy pinned link compatibility runs for migration/transform/pin changes or --exhaustive" },
  { file: "scripts/test-project-selection.cjs", related: runnerInputs, reason: "Runner selection regression runs for runner/config/manifest changes or --exhaustive" },
];
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MATRIX_FILE = "scripts/test-asset-transform-cache.cjs";
const PINNED_UI_ROOT = "artifacts/upstream-ui/26.1007.21434";
const matrixTestName = asset => `pinned transform/cache fixture: ${asset}`;

// Reuse the product's closed path gates. Missing gates never narrow coverage.
// Lazy loading avoids loading injector owners for selections without this matrix.
function pinnedAssetMatrix() {
  const { ASSET_RULE_PATHS } = require("./namespace-azrael-host.cjs");
  const paths = new Set(["out/extension.js", "webview/assets/ko-KR-ebd6264cb102.js",
    ...Object.values(ASSET_RULE_PATHS).flat()]);
  const rulePaths = {};
  for (const [rule, targets] of Object.entries(ASSET_RULE_PATHS)) {
    if (!/^inject-[^/]+\.cjs$/.test(rule)) continue;
    const exported = Object.entries(require(`./${rule}`)).filter(([name]) => !name.startsWith("LEGACY_"))
      .flatMap(([, value]) => Array.isArray(value) ? value : [value])
      .filter(value => typeof value === "string" && /^webview\/assets\/[^\n]+\.(?:js|css)$/.test(value));
    for (const asset of exported) paths.add(asset);
    // Exported fixtures also guard against incomplete product cache path declarations.
    if (exported.every(asset => targets.includes(asset))) rulePaths[rule] = targets;
  }
  return { assets: [...paths].sort(), rulePaths };
}

function omittedMatrixCases(changed) {
  const { assets, rulePaths } = pinnedAssetMatrix();
  const affected = new Set();
  for (const file of changed) {
    if (/^(?:docs|work)\//.test(file) || /^(?:README|AGENTS)\.md$/.test(file)) continue;
    if (file.startsWith(`${PINNED_UI_ROOT}/`)) {
      const asset = file.slice(PINNED_UI_ROOT.length + 1);
      if (!assets.includes(asset)) return [];
      affected.add(asset);
      continue;
    }
    const rule = file.startsWith("scripts/") ? file.slice("scripts/".length) : null;
    const targets = rule && /^inject-[^/]+\.cjs$/.test(rule) && rulePaths[rule];
    if (!Array.isArray(targets) || !targets.length || targets.some(asset => !assets.includes(asset))) return [];
    for (const asset of targets) affected.add(asset);
  }
  return assets.filter(asset => !affected.has(asset)).map(asset => ({ file: MATRIX_FILE,
    test: matrixTestName(asset), reason: affected.size
      ? "Pinned fixture is outside the changed injectors' closed targets and known pinned asset paths"
      : "Pinned transform/cache matrix is unrelated to documentation-only changes" }));
}

function planSourceTests({ files, changedPaths = [], exhaustive = false }) {
  const changed = new Set(changedPaths.map(normalize));
  const selected = [...files];
  const omitted = [];
  if (!exhaustive && !changed.has(POLICY)) {
    if (selected.includes(MATRIX_FILE) && !changed.has(MATRIX_FILE)) omitted.push(...omittedMatrixCases(changed));
    for (const candidate of candidates) {
      if (!selected.includes(candidate.file) || changed.has(candidate.file)) continue;
      const related = typeof candidate.related === "function" ? candidate.related : file => candidate.related.test(file);
      if ([...changed].some(related)) continue;
      const { file, test, reason } = candidate;
      omitted.push({ file, ...(test ? { test } : {}), reason });
      if (!test) selected.splice(selected.indexOf(file), 1);
    }
  }
  const names = omitted.filter(item => item.test).map(item => escape(item.test));
  return { files: selected, skipPattern: names.length ? `^(?:${names.join("|")})$` : "", omitted };
}

module.exports = { planSourceTests, pinnedAssetMatrix, matrixTestName, PINNED_UI_ROOT };
