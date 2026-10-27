"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "../.."), output = path.join(root, "artifacts/verification/ds01n1");
const lifecycle = require(path.join(root, "scripts/artifact-lifecycle.cjs"));
const freeze = require(path.join(root, "scripts/freeze-platform-inputs.cjs"));
const id = "run:DS-01-native-nested-retirement-r1";
if (fs.existsSync(output)) throw Error("Fresh output identity required");
lifecycle.recordLifecycle(root, {id, kind:"run", owner:"DS-01-version-011-cleanup", state:"pending", membership_complete:false,
  members:[{path:output,role:"verification"}],references:[]});
fs.mkdirSync(output, {recursive:true});
freeze.copyTree(path.join(root,"engine"), path.join(output,"engine"), ["target","node_modules",".git","artifacts",".ruff_cache"]);
const inventory = freeze.inventoryTree(path.join(output,"engine"));
fs.writeFileSync(path.join(output,"inputs.json"),JSON.stringify(inventory));
const temp = path.join(output,"temp"); fs.mkdirSync(temp);
const env = {...process.env, PATH:`C:/Users/felre/.cargo/bin;${process.env.PATH}`, RUSTUP_TOOLCHAIN:"stable",
  CARGO_TARGET_DIR:path.join(root,"artifacts/cache/cargo/e6800e57b513189b18e235159d5808a618fd56e99b4e3ae13f0b16d4075f1388/target"),
  TEMP:temp,TMP:temp, AZRAEL_CARGO_RUN_ID:id};
const {runCargoTest} = require(path.join(root,"scripts/cargo-verification.cjs"));
let result;
try {
  result = runCargoTest(path.join(output,"engine"), ["test","-p","azrael-project-maintenance","--locked","--offline","--","--test-threads=1"], {env,isolateHostEnvironment:true,capture:true});
  fs.writeFileSync(path.join(output,"cargo.stdout.log"),result.stdout || "");
  fs.writeFileSync(path.join(output,"cargo.stderr.log"),result.stderr || "");
  fs.writeFileSync(path.join(output,"result.json"),JSON.stringify({exitCode:result.status, signal:result.signal,error:result.error?.message,ended:new Date().toISOString()}));
  console.log(JSON.stringify({exitCode:result.status,signal:result.signal,error:result.error?.message,output}));
} finally {
  if (result && !result.signal && Number.isInteger(result.status)) lifecycle.recordLifecycle(root,{id,kind:"run",owner:"DS-01-version-011-cleanup",state:result.status===0?"complete":"failed",membership_complete:true,members:[{path:output,role:"verification"}],references:[]});
}
process.exitCode=result?.status ?? 1;
