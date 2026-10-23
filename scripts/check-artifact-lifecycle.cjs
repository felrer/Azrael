"use strict";
// Feature-preservation entry point. Preparation/builds are separate checks.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const lifecycle = require("./artifact-lifecycle.cjs");
function commands(stage, platform = process.platform, artifactRoot, runRoot) {
  if (stage === "writers") {
    if (!runRoot) throw new Error("Writer checks require a registered run root");
    return [
      [process.execPath, ["scripts/test-artifact-run.cjs", path.join(runRoot, "temporary/helper")]],
      [process.execPath, ["scripts/test-deployment-workspace.cjs", path.join(runRoot, "temporary/workspace")]],
      [process.execPath, ["scripts/test-artifact-check-ownership.cjs", path.join(runRoot, "temporary/checks")]],
      [process.execPath, ["scripts/test-artifact-render-ownership.cjs", "--output-root=" + path.join(runRoot, "temporary/renderers")]],
      [process.execPath, ["--test", "--test-name-pattern=instruction release ownership", "scripts/tests/instruction-package.test.cjs"]],
    ];
  }
  if (stage === "source") return [
    [process.execPath, ["--test", "scripts/test-artifact-lifecycle.cjs", "scripts/test-build-platform.cjs"]],
    [process.execPath, ["scripts/test-platform-packaging.cjs"]],
  ];
  if (stage !== "windows" || platform !== "win32") throw new Error("Windows cleanup checks require --stage windows on Windows");
  return [
    ["pwsh", ["-NoLogo", "-NoProfile", "-File", "scripts/test-build-metrics.ps1",
      ...(runRoot ? ["-OutputDirectory", path.join(runRoot, "temporary/metrics")] : [])]],
    ["pwsh", ["-NoLogo", "-NoProfile", "-File", "scripts/test-build-metrics.ps1", "-PackagingOnly",
      ...(runRoot ? ["-OutputDirectory", path.join(runRoot, "temporary/retained-source")] : [])]],
    ["pwsh", ["-NoLogo", "-NoProfile", "-File", "scripts/test-build-module-cache.ps1"]],
    ["pwsh", ["-NoLogo", "-NoProfile", "-File", "scripts/test-build-module-cache.ps1", "-RegistryOnly",
      ...(runRoot ? ["-FixtureRoot", path.join(runRoot, "temporary/module-registry")] : [])]],
    ["pwsh", ["-NoLogo", "-NoProfile", "-File", "scripts/test-build-module-cache.ps1", "-LegacyRegistryOnly",
      ...(runRoot ? ["-FixtureRoot", path.join(runRoot, "temporary/module-legacy-registry")] : [])]],
    ...["legacy-releases", "verification-artifacts", "engine-caches"].map(name =>
      ["pwsh", ["-NoLogo", "-NoProfile", "-File", `scripts/test-clean-${name}.ps1`]]),
    ...["verify only", "account-success", "build-fail"].map(name =>
      ["pwsh", ["-NoLogo", "-NoProfile", "-File", "scripts/test-deploy-azrael.ps1", "-Case", name,
        ...(artifactRoot ? ["-ArtifactProjectRoot", artifactRoot] : [])]]),
  ];
}
function main(argv) {
  if (argv.length !== 2 || argv[0] !== "--stage") throw new Error("Usage: check-artifact-lifecycle.cjs --stage source|writers|windows");
  const root = path.resolve(__dirname, ".."), id = crypto.randomUUID();
  // Keep Git's initial config path below Windows' pre-config path limit.
  // The full UUID still identifies the run; removing separators is lossless.
  const run = path.join(root, "artifacts/tasks/lifecycle-checks/runs", id.replaceAll("-", ""));
  // Child deploy checks own registered sibling runs. Nesting another project
  // under this run can make Git discover the parent instead of its fixture.
  const selected = commands(argv[1], process.platform, root, run);
  const record = {id:`run:lifecycle-check:${id}`,kind:"run",owner:"artifact-lifecycle-checks",members:[{path:run,role:"run"}]};
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
module.exports = { commands, main };
if (require.main === module) { try { process.exitCode = main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
