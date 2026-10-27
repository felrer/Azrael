"use strict";
// Short-lived writer ownership. Cleanup remains an explicit maintenance decision.
const fs = require("node:fs");
const { acquire } = require("./maintenance-lock-owner.cjs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const lifecycle = require("./artifact-lifecycle.cjs");
const { isDeepStrictEqual } = require("node:util");
const roles = ["inputs", "temporary", "logs", "reports", "outputs"];
const activeRuns = new Map();
const runKey = (root, id) => fs.realpathSync(root) + "\0" + id;
function currentRun(run) {
  const current = lifecycle.catalog(run.projectRoot).find(record => record.id === run.lifecycleId);
  if (!current || current.revision !== run.record.revision) throw Error("Stale lifecycle revision");
  if (current.owner !== run.owner || current.kind !== "run" || current.owned_root !== run.runRoot ||
      !isDeepStrictEqual(current, JSON.parse(JSON.stringify(run.record)))) throw Error("Artifact run identity changed");
  return current;
}
function addArtifactRunReferences(projectRoot, lifecycleId, { owner, expected_revision, references }) {
  return lifecycle.withCatalogLock(projectRoot, () => {
    const record = lifecycle.catalog(projectRoot).find(value => value.id === lifecycleId);
    if (!record || record.owner !== owner || record.kind !== "run" || record.state !== "pending" || record.producer) throw Error("Active caller run with exact owner required");
    if (record.revision !== expected_revision) throw Error("Stale lifecycle revision");
    if (!Array.isArray(references) || !references.length) throw Error("Explicit caller references required");
    const run = activeRuns.get(runKey(projectRoot, lifecycleId));
    if (run) currentRun(run);
    const updated = lifecycle.recordLifecycle(projectRoot, { ...record, expected_revision, references: [...record.references, ...references] });
    // Publish the durable revision to its live wrapper before preparation can throw.
    if (run) run.record = updated;
    return updated;
  });
}
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
function beginArtifactRun(projectRoot, { workId, owner, runId = new Date().toISOString().replace(/[-:.]/g, "") + "-" + randomUUID(), references = [], paths = {}, requireStopEvidence = false }) {
  projectRoot = fs.realpathSync(projectRoot);
  safeId(workId); safeId(runId);
  if (typeof requireStopEvidence !== "boolean") throw Error("Boolean requireStopEvidence required");
  const runRoot = checked(projectRoot, path.join(projectRoot, "artifacts/tasks", workId, "runs", runId));
  const run = { projectRoot, workId, owner, runId, lifecycleId: `run:${workId}:${runId}`, runRoot, references, requireStopEvidence, children: new Set(), producerStopped: true };
  // Inputs owns handoff manifests only. Immutable payload dependencies use references.
  for (const role of Object.keys(paths)) if (!roles.includes(role)) throw Error("Unknown artifact role");
  for (const role of roles) run[role] = checked(projectRoot, paths[role] ?? path.join(runRoot, role));
  const members = [{ path: runRoot, role: "run", generated: true, protection_known: true }, ...roles.map(role => ({ path: run[role], role, ...(inside(runRoot, run[role]) ? { generated: true, protection_known: true } : {}) }))];
  for (const role of roles) {
    const value = run[role];
    if (inside(value, runRoot) || roles.some(other => other !== role && (inside(value, run[other]) || inside(run[other], value)))) throw Error("Overlapping artifact destinations");
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
  const claim = acquire(claimPath, { operation: "artifact-run.claim", waitMs: 5000 });
  try {
  const existingClaims = lifecycle.catalog(projectRoot);
  for (const member of members) {
    if (fs.existsSync(member.path)) throw Error(`Artifact destination already exists: ${member.path}`);
    if (existingClaims.some(record => record.members.some(old => inside(old.path, member.path) || inside(member.path, old.path)))) throw Error(`Artifact destination already claimed: ${member.path}`);
  }
  run.record = lifecycle.recordLifecycle(projectRoot, { id: run.lifecycleId, kind: "run", owner, ownership_scope: "run-root", owned_root: runRoot, state: "pending", membership_complete: false, members, references, expected_revision: 0 });
  activeRuns.set(runKey(projectRoot, run.lifecycleId), run);
  // Install before directory creation so partial preparation failures are reconciled too.
  run.onExit = exitCode => {
    try { finishArtifactRun(run, { exitCode, producerStopped: run.producerStopped && [...run.children].every(child => child.artifactClosed) }); }
    catch (error) { process.stderr.write(`Artifact lifecycle reconciliation failed: ${error.stack}\n`); process.exitCode = 1; }
  };
  process.once("exit", run.onExit);
  fs.mkdirSync(path.dirname(runRoot), { recursive: true });
  fs.mkdirSync(runRoot);
  for (const role of roles) fs.mkdirSync(run[role], { recursive: true });
  return run;
  } finally { claim.release(); }
}
function trackArtifactChild(run, child) {
  run.children.add(child);
  child.artifactClosed = false;
  child.once("close", () => { child.artifactClosed = true; });
  return child;
}
function finishArtifactRun(run, { exitCode, signal = null, producerStopped, reason = "Owned producer and tracked children stopped", cancellation, stopEvidence }) {
  if (run.record.producer) return run.record;
  if (signal !== null && (typeof signal !== "string" || !/^SIG[A-Z0-9]+$/.test(signal) || signal.trim() !== signal)) throw Error("Actual producer signal must be null or a SIG name");
  if (signal !== null && Number.isInteger(exitCode)) throw Error("Producer exit code and signal cannot both be present");
  if (typeof reason !== "string" || !reason.trim()) throw Error("Nonblank producer reason required");
  if (cancellation !== undefined && (!cancellation || typeof cancellation !== "object" || Array.isArray(cancellation))) throw Error("Cancellation metadata object required");
  let verifiedStop;
  if (stopEvidence !== undefined) {
    if (stopEvidence?.producer_stopped_verified !== true) throw Error("Verified producer stop required");
    verifiedStop = lifecycle.checkedEvidence(run.projectRoot, stopEvidence);
  }
  // Child close drains its streams. Only the controller can prove its owned tree stopped.
  const stopped = producerStopped === true && [...run.children].every(child => child.artifactClosed) && (!run.requireStopEvidence || !!verifiedStop);
  const success = exitCode === 0 && stopped;
  const knownOutcome = Number.isInteger(exitCode) || signal !== null;
  const state = success ? "complete" : stopped && knownOutcome ? "failed" : "pending";
  return lifecycle.withCatalogLock(run.projectRoot, () => {
    currentRun(run); // Reject stale or replaced ownership before touching any report.
    const view = fs.existsSync(run.reports) ? path.join(run.reports, "producer.json") : path.join(run.projectRoot, "artifacts/maintenance/lifecycle-evidence", createHash("sha256").update(run.lifecycleId).digest("hex") + ".json");
    const bytes = Buffer.from(JSON.stringify({ lifecycleId: run.lifecycleId, runRoot: run.runRoot, argv: process.argv, exitCode: Number.isInteger(exitCode) ? exitCode : null, signal, producerStopped: stopped, reason, ...(cancellation === undefined ? {} : { cancellation }), ...(verifiedStop ? { stopEvidence: verifiedStop } : {}), children: [...run.children].map(child => ({ pid: child.pid ?? null, closed: child.artifactClosed })), state, membership_complete: stopped && knownOutcome }, null, 2) + "\n");
    const digest = data => createHash("sha256").update(data).digest("hex");
    const immutablePath = data => view.slice(0, -5) + "-" + digest(data) + ".json";
    const evidence = immutablePath(bytes);
    if (verifiedStop && [view, evidence].some(file => path.resolve(verifiedStop.evidence_ref) === path.resolve(file))) throw Error("Stop evidence cannot be overwritten by producer report");
    // Check the complete report path, including the control fallback, before I/O.
    let ancestor = path.parse(view).root;
    for (const part of view.slice(ancestor.length).split(path.sep)) {
      ancestor = path.join(ancestor, part);
      try { if (fs.lstatSync(ancestor).isSymbolicLink()) throw Error("Linked producer report path"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    fs.mkdirSync(path.dirname(view), { recursive: true });
    function preserve(data) {
      const file = immutablePath(data);
      let fd;
      try { fd = fs.openSync(file, "wx"); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (fs.lstatSync(file).isSymbolicLink() || !fs.readFileSync(file).equals(data)) throw Error("Immutable producer report changed");
        return;
      }
      try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    if (fs.existsSync(view)) preserve(fs.readFileSync(view));
    preserve(bytes);
    fs.writeFileSync(view, bytes); // Query view only; committed evidence is immutable.
    run.record = stopped ? lifecycle.closeLifecycle(run.projectRoot, run.lifecycleId, { owner: run.owner, expected_revision: run.record.revision,
      producer_stopped_verified: true, outcome: knownOutcome ? (success ? "success" : "failure") : "unknown", exit_code: Number.isInteger(exitCode) ? exitCode : null,
      reason, evidence_ref: evidence, evidence_sha256: digest(bytes) })
      : lifecycle.recordLifecycle(run.projectRoot, { ...run.record, state, membership_complete: false, expected_revision: run.record.revision });
    process.removeListener("exit", run.onExit);
    if (run.record.producer) activeRuns.delete(runKey(run.projectRoot, run.lifecycleId));
    return run.record;
  });
}
async function confirmOwnedBrowserExit(child,profilePath,spawn){
 if(!child)return {confirmed:true,exitCode:null,signalCode:null,processIds:[]};
 if(process.platform!=='win32'&&child.exitCode===null&&child.signalCode===null)await new Promise(r=>{const timer=setTimeout(r,10000);child.once('exit',()=>{clearTimeout(timer);r()})});
 const result={confirmed:child.exitCode!==null||child.signalCode!==null,exitCode:child.exitCode,signalCode:child.signalCode};
 if(process.platform==='win32'){
  result.confirmed=false;
  const windowsPowerShell=path.join(process.env.SystemRoot || process.env.WINDIR || path.join('C:',path.sep,'Windows'),'System32','WindowsPowerShell','v1.0','powershell.exe');
  const deadline=Date.now()+10000;
  // Browser.close can finish the root before Chrome's profile-owning children drain.
  // These snapshots retain the existing profile/root predicate, not a full tree identity proof.
  do {
  const remaining=deadline-Date.now();
  if(remaining<=0)break;
  try {
  const query=spawn(windowsPowerShell,['-NoProfile','-Command',"$ErrorActionPreference='Stop'; $ownedChrome=@(Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" | Where-Object { $_.ProcessId -eq [int]$env:AZRAEL_RENDER_BROWSER_PID -or ($_.CommandLine -and $_.CommandLine.Contains($env:AZRAEL_RENDER_BROWSER_PROFILE)) } | Select-Object -ExpandProperty ProcessId); ConvertTo-Json -Compress -InputObject $ownedChrome"],{windowsHide:true,timeout:remaining,env:{...process.env,AZRAEL_RENDER_BROWSER_PID:String(child.pid),AZRAEL_RENDER_BROWSER_PROFILE:profilePath},stdio:['ignore','pipe','pipe']});
  let output='',error='';query.stdout.on('data',c=>output+=c);query.stderr.on('data',c=>error+=c);
  const queryExit=await new Promise(r=>{query.once('error',e=>{error+=String(e);r(null)});query.once('close',r)});
  result.processInspectionExitCode=queryExit;
  if(queryExit!==0)throw Error(error||'Process inspection failed');
  const processIds=JSON.parse(output);
  if(!Array.isArray(processIds)||!processIds.every(pid=>Number.isInteger(pid)&&pid>0))throw Error('Invalid process inspection result');
  result.processIds=processIds;
  result.exitCode=child.exitCode;result.signalCode=child.signalCode;
  result.confirmed=(result.exitCode!==null||result.signalCode!==null)&&processIds.length===0;
  } catch(e) {result.confirmed=false;result.inspectionError=String(e);break}
  if(result.confirmed)break;
  const pause=Math.min(200,deadline-Date.now());
  if(pause>0)await new Promise(r=>setTimeout(r,pause));
  } while(Date.now()<deadline);
  result.exitCode=child.exitCode;result.signalCode=child.signalCode;
 }
 if(result.confirmed){child.unref();child.stderr?.destroy()}
 return result;
}

module.exports = { beginArtifactRun, addArtifactRunReferences, finishArtifactRun, trackArtifactChild, confirmOwnedBrowserExit };
