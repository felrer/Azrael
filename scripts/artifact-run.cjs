"use strict";
// Short-lived writer ownership. Cleanup remains an explicit maintenance decision.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const lifecycle = require("./artifact-lifecycle.cjs");
const inside = (parent, child) => { const rel = path.relative(parent, child); return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)); };
function safeId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value) || /[. ]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw Error("Invalid artifact run ID");
  return value;
}
function checked(root, value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) throw Error("Absolute artifact path without traversal required");
  const result = path.resolve(value);
  if (!inside(path.join(root, "artifacts"), result) || result === path.join(root, "artifacts") || inside(path.join(root, "artifacts/maintenance"), result)) throw Error("Artifact path outside generated output scope");
  let current = path.parse(result).root;
  for (const part of result.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error("Linked artifact path"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  return result;
}
function beginArtifactRun(projectRoot, { workId, owner, runId = new Date().toISOString().replace(/[-:.]/g, "") + "-" + randomUUID(), references = [], paths = {} }) {
  projectRoot = fs.realpathSync(projectRoot);
  safeId(workId); safeId(runId);
  const runRoot = checked(projectRoot, path.join(projectRoot, "artifacts/tasks", workId, "runs", runId));
  const run = { projectRoot, workId, owner, runId, lifecycleId: `run:${workId}:${runId}`, runRoot, references, children: new Set(), producerStopped: true };
  for (const role of ["temporary", "logs", "reports", "outputs"]) run[role] = checked(projectRoot, paths[role] ?? path.join(runRoot, role));
  const members = [{ path: runRoot, role: "run" }, ...["temporary", "logs", "reports", "outputs"].map(role => ({ path: run[role], role }))];
  for (const [role, value] of Object.entries(paths)) {
    if (!["temporary", "logs", "reports", "outputs"].includes(role)) throw Error("Unknown artifact role");
    if (inside(value, runRoot) || Object.entries(paths).some(([other, otherPath]) => other !== role && (inside(value, otherPath) || inside(otherPath, value)))) throw Error("Overlapping artifact destinations");
  }
  const claimDirectory = path.join(projectRoot, "artifacts/maintenance/lifecycles");
  // recordLifecycle validates linked registry paths before writing its own lock.
  // Check each existing registry ancestor before creating the shared claim lock.
  let current = projectRoot;
  for (const part of ["artifacts", "maintenance", "lifecycles"]) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error("Linked registry path"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  fs.mkdirSync(claimDirectory, { recursive: true });
  const claimPath = path.join(claimDirectory, ".run-claim.lock");
  const claim = fs.openSync(claimPath, "wx");
  try {
  for (const member of members) {
    if (fs.existsSync(member.path)) throw Error(`Artifact destination already exists: ${member.path}`);
    if (lifecycle.catalog(projectRoot).some(record => record.members.some(old => inside(old.path, member.path) || inside(member.path, old.path)))) throw Error(`Artifact destination already claimed: ${member.path}`);
  }
  run.record = lifecycle.recordLifecycle(projectRoot, { id: run.lifecycleId, kind: "run", owner, state: "pending", membership_complete: false, members, references, expected_revision: 0 });
  // Install before directory creation so partial preparation failures are reconciled too.
  run.onExit = exitCode => {
    try { finishArtifactRun(run, { exitCode, producerStopped: run.producerStopped && [...run.children].every(child => child.artifactClosed) }); }
    catch (error) { process.stderr.write(`Artifact lifecycle reconciliation failed: ${error.stack}\n`); process.exitCode = 1; }
  };
  process.once("exit", run.onExit);
  fs.mkdirSync(path.dirname(runRoot), { recursive: true });
  fs.mkdirSync(runRoot);
  for (const role of ["temporary", "logs", "reports", "outputs"]) fs.mkdirSync(run[role], { recursive: true });
  return run;
  } finally { fs.closeSync(claim); fs.unlinkSync(claimPath); }
}
function trackArtifactChild(run, child) {
  run.children.add(child);
  child.artifactClosed = false;
  child.once("close", () => { child.artifactClosed = true; });
  return child;
}
function finishArtifactRun(run, { exitCode, producerStopped }) {
  const stopped = producerStopped === true && [...run.children].every(child => child.artifactClosed);
  const success = exitCode === 0 && stopped;
  const state = success ? "complete" : stopped && Number.isInteger(exitCode) && exitCode !== 0 ? "failed" : "pending";
  if (fs.existsSync(run.reports)) fs.writeFileSync(path.join(run.reports, "producer.json"), JSON.stringify({ lifecycleId: run.lifecycleId, runRoot: run.runRoot, argv: process.argv, exitCode, producerStopped: stopped, state, membership_complete: success }, null, 2) + "\n");
  run.record = lifecycle.recordLifecycle(run.projectRoot, { ...run.record, state, membership_complete: success, expected_revision: run.record.revision });
  process.removeListener("exit", run.onExit);
  return run.record;
}
async function confirmOwnedBrowserExit(child,profilePath,spawn){
 if(!child)return {confirmed:true,exitCode:null,signalCode:null,processIds:[]};
 if(child.exitCode===null&&child.signalCode===null)await new Promise(r=>{const timer=setTimeout(r,10000);child.once('exit',()=>{clearTimeout(timer);r()})});
 const result={confirmed:child.exitCode!==null||child.signalCode!==null,exitCode:child.exitCode,signalCode:child.signalCode};
 if(process.platform==='win32'){
  const windowsPowerShell=path.join(process.env.SystemRoot || process.env.WINDIR || path.join('C:',path.sep,'Windows'),'System32','WindowsPowerShell','v1.0','powershell.exe');
  const query=spawn(windowsPowerShell,['-NoProfile','-Command',"$ErrorActionPreference='Stop'; $ownedChrome=@(Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" | Where-Object { $_.ProcessId -eq [int]$env:AZRAEL_RENDER_BROWSER_PID -or ($_.CommandLine -and $_.CommandLine.Contains($env:AZRAEL_RENDER_BROWSER_PROFILE)) } | Select-Object -ExpandProperty ProcessId); ConvertTo-Json -Compress -InputObject $ownedChrome"],{windowsHide:true,timeout:15000,env:{...process.env,AZRAEL_RENDER_BROWSER_PID:String(child.pid),AZRAEL_RENDER_BROWSER_PROFILE:profilePath},stdio:['ignore','pipe','pipe']});
  let output='',error='';query.stdout.on('data',c=>output+=c);query.stderr.on('data',c=>error+=c);
  const queryExit=await new Promise(r=>{query.once('error',e=>{error+=String(e);r(null)});query.once('exit',r)});
  result.processInspectionExitCode=queryExit;
  try{if(queryExit!==0)throw Error(error||'Process inspection failed');result.processIds=JSON.parse(output);if(!Array.isArray(result.processIds))throw Error('Invalid process inspection result');result.confirmed=result.processIds.length===0}catch(e){result.confirmed=false;result.inspectionError=String(e)}
 }
 if(result.confirmed){child.unref();child.stderr?.destroy()}
 return result;
}

module.exports = { beginArtifactRun, finishArtifactRun, trackArtifactChild, confirmOwnedBrowserExit };
