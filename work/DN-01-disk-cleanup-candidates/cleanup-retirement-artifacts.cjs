"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const lifecycle = require(path.join(root, "scripts/artifact-lifecycle.cjs"));
const evidenceDir = path.join(__dirname, "temp-delete-evidence-20261024");
const owns = r => /^run:DN-01-root-retirement:validation-20261024(?:-2)?$/.test(r.id)
  || r.id.startsWith("run:dn01-root-provenance:") || r.id.startsWith("run:dn01-root-receipt-isolation:");
const output = name => path.join(evidenceDir, name);
const write = (name, value) => fs.writeFileSync(output(name), JSON.stringify(value, null, 2) + "\n");
if (process.argv[2] === "prepare") {
  const records = lifecycle.catalog(root).filter(owns);
  if (records.length !== 11 || records.some(r => r.producer?.status !== "stopped" || r.producer.outcome === "unknown" || !r.membership_complete)) throw Error("Exact11 known terminal producers required");
  if (records.some(r => r.members.some(m => m.generated === false || m.protection_known === false))) throw Error("Explicitly protected member");
  const worktrees = require("node:child_process").execFileSync("git", ["worktree", "list", "--porcelain"], {cwd:root, encoding:"utf8"});
  if (worktrees.includes("dn01-root-receipt-isolation")) throw Error("Private worktree still registered");
  const proof = {reason:"Approved10 deletion and task commit complete; compact causal logs, test/source proofs and deletion results preserved in work; no remaining consumer needs temporary payloads.", commit:require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], {cwd:root, encoding:"utf8"}).trim(), records};
  write("artifact-cleanup-owner-evidence.json", proof);
  const evidence_ref = output("artifact-cleanup-owner-evidence.json");
  const evidence_sha256 = crypto.createHash("sha256").update(fs.readFileSync(evidence_ref)).digest("hex");
  for (const record of records) {
    let current = lifecycle.recordLifecycle(root, {...record, expected_revision:record.revision, members:record.members.map(m => ({...m, generated:true, protection_known:true}))});
    if (current.references.length) current = lifecycle.releaseReferences(root, current.id, {owner:current.owner, expected_revision:current.revision, reference_ids:current.references.map(r => r.reference_id), reason:proof.reason, evidence_ref, evidence_sha256});
  }
  const requests = [], deferred = [];
  for (const record of lifecycle.catalog(root).filter(owns)) {
    const linked = record.members.map(m => path.join(m.path,"codex-rs/vendor/bubblewrap/LICENSE")).filter(p => { try {return fs.lstatSync(p).isSymbolicLink();} catch(e) {if(e.code === "ENOENT" || e.code === "ENOTDIR") return false; throw e;} });
    if (linked.length) deferred.push({id:record.id,linked,decision:"defer",reason:"Owned failed baseline contains a file symlink rejected by native traversal; no supported owner unlink procedure established.",revisit_condition:"A supported owner procedure safely retires the link and reconciles complete group membership without bypassing native guards."});
    else requests.push(lifecycle.registerRequest(root,record.id));
  }
  write("artifact-cleanup-registration-requests.json",requests);
  write("artifact-cleanup-deferred.json",deferred);
  console.log(JSON.stringify({registrations:requests.length,deferred:deferred.length}));
} else if (process.argv[2] === "finalize") {
  const requests=JSON.parse(fs.readFileSync(output("artifact-cleanup-registration-requests.json"),"utf8"));
  const result=requests.map(r=>lifecycle.finalize(root,r.group.id));
  write("artifact-cleanup-finalized.json",result);
  console.log(JSON.stringify(result.map(r=>({id:r.id,status:r.status,remaining:r.remaining}))));
} else throw Error("prepare or finalize required");
