"use strict";
// Feature-preservation entry point. Preparation/builds are separate checks.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const lifecycle = require("./artifact-lifecycle.cjs");
function commands(stage, platform = process.platform, artifactRoot, runRoot) {
  if (stage === "pipeline") {
    if (!runRoot) throw new Error("Pipeline checks require a registered run root");
    return [[process.execPath, ["scripts/test-pipeline-state.cjs", path.join(runRoot, "temporary/pipeline")]]];
  }
  if (stage === "writers") {
    if (!runRoot) throw new Error("Writer checks require a registered run root");
    return [
      [process.execPath, ["scripts/test-artifact-run.cjs", path.join(runRoot, "temporary/helper")]],
      [process.execPath, ["scripts/test-deployment-workspace.cjs", path.join(runRoot, "temporary/workspace")]],
      [process.execPath, ["scripts/test-committed-project-inputs.cjs", path.join(runRoot, "temporary/committed-project")]],
      [process.execPath, ["scripts/test-packaging-workspace.cjs", path.join(runRoot, "temporary/package-inputs")]],
      [process.execPath, ["scripts/test-artifact-check-ownership.cjs", path.join(runRoot, "temporary/checks")]],
      [process.execPath, ["scripts/test-artifact-render-ownership.cjs", "--output-root=" + path.join(runRoot, "temporary/renderers")]],
      [process.execPath, ["--test", "--test-name-pattern=instruction release ownership", "scripts/tests/instruction-package.test.cjs"]],
    ];
  }
  if (stage === "source") {
    const policy = require('./lifecycle-test-policy.cjs').planLifecycleTests();
    return [[process.execPath, ['--test', ...(policy.skipPattern ? [`--test-skip-pattern=${policy.skipPattern}`] : []), 'scripts/test-artifact-lifecycle.cjs']]];
  }
  if (stage === "packaging") return [
    [process.execPath, ["--test", "scripts/test-build-platform.cjs", "scripts/test-committed-build-context.cjs"]],
    [process.execPath, ["scripts/test-platform-packaging.cjs"]],
  ];
  if (stage !== "windows" || platform !== "win32") throw new Error("Windows cleanup checks require --stage windows on Windows");
  return [
    ["pwsh", ["-NoLogo", "-NoProfile", "-File", "scripts/test-build-module-cache.ps1", "-RegistryOnly",
      ...(runRoot ? ["-FixtureRoot", path.join(runRoot, "temporary/module-registry")] : [])]],
    ["pwsh", ["-NoLogo", "-NoProfile", "-File", "scripts/test-build-module-cache.ps1", "-LegacyRegistryOnly",
      ...(runRoot ? ["-FixtureRoot", path.join(runRoot, "temporary/module-legacy-registry")] : [])]],
    ...["legacy-releases", "verification-artifacts"].map(name =>
      ["pwsh", ["-NoLogo", "-NoProfile", "-File", `scripts/test-clean-${name}.ps1`]]),
    ["pwsh", ["-NoLogo", "-NoProfile", "-File", "scripts/test-clean-engine-caches.ps1",
      ...(runRoot ? ["-FixtureRoot", path.join(runRoot, "temporary/engine-cache-cleanup")] : [])]],
    ...(runRoot ? [[process.execPath, ["scripts/test-deployment-control-retirement.cjs", path.join(runRoot, "temporary/control-retirement"), "happy"]]] : []),
  ];
}
function main(argv) {
  if (argv.length < 2 || argv[0] !== "--stage" || (argv.length - 2) % 2) throw new Error("Usage: check-artifact-lifecycle.cjs --stage source|packaging|writers|windows|pipeline [--test-file file] [--changed-path path]");
  const root = path.resolve(__dirname, ".."), id = crypto.randomUUID();
  // Keep Git's initial config path below Windows' pre-config path limit.
  // The full UUID still identifies the run; removing separators is lossless.
  const run = path.join(root, "artifacts/tasks/lc/runs", id.replaceAll("-", ""));
  const selected = selectCommands(argv, process.platform, root, run);
  const record = {id:`run:lifecycle-check:${id}`,kind:"run",owner:"artifact-lifecycle-checks",members:[{path:run,role:"run",generated:true,protection_known:true}]};
  lifecycle.recordLifecycle(root,{...record,state:"pending",membership_complete:false});
  fs.mkdirSync(path.join(run,"logs"),{recursive:true});
  fs.mkdirSync(path.join(run,"temporary"),{recursive:true});
  const env = {...process.env};
  env.AZRAEL_LIFECYCLE_FIXTURE_ROOT = path.join(run, "temporary/lifecycle");
  env.AZRAEL_PACKAGING_TEST_ROOT = path.join(run, "temporary/packaging");
  env.AZRAEL_INSTRUCTION_PACKAGING_TEST_ROOT = path.join(run, "temporary/instruction-packaging");
  if (process.platform === "win32") {
    const count = Number(env.GIT_CONFIG_COUNT || 0);
    env.GIT_CONFIG_COUNT = String(count + 1);
    env[`GIT_CONFIG_KEY_${count}`] = "core.longpaths";
    env[`GIT_CONFIG_VALUE_${count}`] = "true";
  }
  const receipts=[];
  for (const [index,[command,args]] of selected.entries()) {
    const log=path.join(run,"logs",`${index}.log`), out=fs.openSync(log,"wx");
    const result = spawnSync(command, args, { cwd:root,env,stdio:["ignore",out,out],windowsHide:true });
    fs.closeSync(out);
    receipts.push({command,args,exit_code:result.status,signal:result.signal,error:result.error?.message,log});
    fs.writeFileSync(path.join(run,"results.json"),JSON.stringify(receipts,null,2));
    if (result.status !== 0) {
      lifecycle.recordLifecycle(root,{...record,state:"failed",membership_complete:false});
      console.error(JSON.stringify({status:"failed",lifecycle_id:record.id,results:receipts}));
      return result.status ?? 1;
    }
  }
  lifecycle.recordLifecycle(root,{...record,state:"complete",membership_complete:true});
  console.log(JSON.stringify({status:"passed",lifecycle_id:record.id,results:receipts}));
  return 0;
}
function selectCommands(argv, platform, root, run) {
  let all = commands(argv[1], platform, root, run);
  if (argv.length === 2) return all;
  if (!["source", "packaging", "writers"].includes(argv[1])) throw Error("Test-file selection requires source, packaging or writers stage");
  const requested = [];
  const changed = []; let pattern;
  for (let index = 2; index < argv.length; index += 2) {
    if (argv[index] === '--changed-path' && argv[1] === 'source') { changed.push(argv[index + 1]); continue; }
    if (argv[index] === '--test-skip-pattern' && argv[1] === 'source' && pattern === undefined) { pattern = argv[index + 1]; continue; }
    if (argv[index] !== "--test-file" || requested.includes(argv[index + 1])) throw Error("Invalid or duplicate test-file selection");
    requested.push(argv[index + 1]);
  }
  if (changed.length && pattern !== undefined) throw Error('Conflicting lifecycle case selection');
  if (changed.length) pattern = require('./lifecycle-test-policy.cjs').planLifecycleTests({ changedPaths: changed }).skipPattern;
  if (pattern !== undefined) all = all.map(([command, args]) => [command, [args[0],
    ...(pattern ? [`--test-skip-pattern=${pattern}`] : []), ...args.slice(1).filter(arg => !arg.startsWith('--test-skip-pattern='))]]);
  const files = all.flatMap(([, args]) => args.filter(arg => /^scripts\/.*\.cjs$/.test(arg)));
  if (requested.some(file => !files.includes(file))) throw Error("Unknown test-file selection");
  if (!requested.length) return all;
  return all.flatMap(([command, args]) => {
    const own = args.filter(arg => files.includes(arg));
    if (!own.some(file => requested.includes(file))) return [];
    return [[command, args.filter(arg => !own.includes(arg) || requested.includes(arg))]];
  });
}
module.exports = { commands, selectCommands, main };
if (require.main === module) { try { process.exitCode = main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
