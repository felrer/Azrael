"use strict";

const normalize = value => value.replace(/\\/g, "/").replace(/^\.\//, "");
const POLICY = "scripts/source-test-policy.cjs";
const sharedInputs = /^(?:scripts\/(?:.*cache[^/]*\.cjs|directory-state\.cjs|capture-project-inputs\.cjs|deployment-input-snapshot\.cjs|ordered-asset-reader\.cjs|azrael-feature-contracts\.json|ui-test-transform-fixture\.cjs|namespace-azrael-host\.cjs|namespace-cache-owner\.cjs|inject-[^/]+\.cjs|content-fonts\.cjs|provider-context-labels\.cjs)|artifacts\/upstream-ui\/.*|extensions\/azrael-ex\/(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|node_modules\/typescript\/.*)|scripts\/(?:prepare-|freeze-|build-|package-)[^/]+|.*(?:ui-pin|upstream-ui|source-ui)[^/]*\.(?:json|cjs|ps1))$/;
const preservationInputs = /^scripts\/(?:feature-preservation|verification-result-cache|native-verification-cache|directory-state|capture-project-inputs)\.cjs$/;
const runnerInputs = /^(?:scripts\/(?:test-project(?:-selection|-fail-fast|-maintenance)?\.cjs|azrael-feature-contracts\.json)|(?:extensions\/azrael-ex\/)?(?:package(?:-lock)?\.json|tsconfig[^/]*\.json)|extensions\/azrael-ex\/scripts\/run-tests\.cjs)$/;
const candidates = [
  { file: "scripts/test-asset-transform-cache.cjs", test: "all pinned injector target fixtures: uncached/cold/warm byte and metadata equality; related edits miss", related: sharedInputs, reason: "Full pinned transform/cache matrix runs for owner changes or --exhaustive" },
  { file: "scripts/test-feature-preservation-cache.cjs", test: "schema2 exact success reuses proof while project, source UI and unknown aggregate inputs miss", related: file => sharedInputs.test(file) || preservationInputs.test(file), reason: "Aggregate preservation cache matrix runs for owner changes or --exhaustive" },
  { file: "scripts/test-session-links.cjs", test: "guarded pinned 26.928.31416 outgoing links, parsing, allowlists and preservation", related: file => sharedInputs.test(file) || /^scripts\/(?:session-links\.cjs|open-azrael-session-link\.ps1|integrated-azrael-entry\.cjs)$/.test(file), reason: "Legacy pinned link compatibility runs for migration/transform/pin changes or --exhaustive" },
  { file: "scripts/test-namespace-source.cjs", test: "pinned display branding preserves backend HTTP header names and accepted app brand", related: sharedInputs, reason: "Pinned branding exact counts run for namespace/transform/pin changes or --exhaustive" },
  { file: "scripts/test-project-selection.cjs", related: runnerInputs, reason: "Runner selection regression runs for runner/config/manifest changes or --exhaustive" },
];
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function planSourceTests({ files, changedPaths = [], exhaustive = false }) {
  const changed = new Set(changedPaths.map(normalize));
  const selected = [...files];
  const omitted = [];
  if (!exhaustive && !changed.has(POLICY)) {
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

module.exports = { planSourceTests };
