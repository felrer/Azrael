import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import lifecycle from '../../scripts/artifact-lifecycle.cjs';
const root = resolve('.m'), id = 'run:DJ-01:real-history-r14';
const reportPath = join(root, 'artifacts/tasks/DJ-01/runs/real-history-r14/reports/report.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert(report.childOutcomes.every(c => c.closed === true));
const identities = report.modes.flatMap(m => m.observedIdentities ?? []);
assert(identities.length >= 3);
const script = `$ErrorActionPreference='Stop'
$ids=ConvertFrom-Json $env:AZRAEL_RECOVER_IDENTITIES
$all=@(Get-CimInstance Win32_Process)
$ownedMatches=@(foreach($p in $all){
 $creation=$p.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString()
 $known=@($ids|Where-Object { $_.pid -eq $p.ProcessId -and $_.creation -eq $creation })
 $ownedProfileMatch=($p.ProcessId -ne [int]$env:AZRAEL_RECOVER_SELF -and $p.Name -match '^(azrael|azrael-bridge|azrael-code-host|node)\\.exe$' -and $p.CommandLine -and ($p.CommandLine.Contains($env:AZRAEL_RECOVER_HOME) -or $p.CommandLine.Contains($env:AZRAEL_RECOVER_HOME.Replace('\\','/'))))
 if($known.Count -or $ownedProfileMatch){[pscustomobject]@{pid=[int]$p.ProcessId;creation=$creation;known=[bool]$known.Count;profile=$ownedProfileMatch}}
})
ConvertTo-Json -InputObject $ownedMatches -Compress`;
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
  env: { ...process.env, AZRAEL_RECOVER_IDENTITIES: JSON.stringify(identities), AZRAEL_RECOVER_HOME: report.home, AZRAEL_RECOVER_SELF: String(process.pid) },
  encoding: 'utf8', windowsHide: true
});
if (result.status !== 0) process.stderr.write(result.stderr);
assert.equal(result.status, 0); const remaining = JSON.parse(result.stdout); assert.deepEqual(remaining, []);
const evidence = { atUtc: new Date().toISOString(), id, originalStatus: report.status, originalProducerStopped: report.producerStopped,
  observedDriverExitCode: 1, allTrackedChildrenClosed: true, identities, remaining,
  reportSha256: createHash('sha256').update(readFileSync(reportPath)).digest('hex'),
  procedure: 'After normal owner closure: all tracked subprocess close events; recheck every observed process generation and all owned profile command-line matches. No process termination or registry editing.' };
const evidencePath = join(root, 'artifacts/maintenance/lifecycle-evidence/real-r14-stopped.json');
mkdirSync(join(root, 'artifacts/maintenance/lifecycle-evidence'), { recursive: true });
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
writeFileSync(resolve('work/DJ-01-azrael-memory-analysis/evidence/real-r14-stopped.json'), JSON.stringify(evidence, null, 2));
const record = lifecycle.catalog(root).find(r => r.id === id); assert(record);
const closed = lifecycle.closeLifecycle(root, id, { owner: record.owner, expected_revision: record.revision, producer_stopped_verified: true,
  outcome: 'failure', exit_code: 1, reason: 'Verified stopped after diagnostic cleanup assertion; preserve actual failed execution',
  evidence_ref: evidencePath, evidence_sha256: createHash('sha256').update(readFileSync(evidencePath)).digest('hex') });
console.log(JSON.stringify({ id, state: closed.state, remaining, evidencePath }));
