const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const base = path.join(root, 'artifacts/tasks/DN-01-disk-cleanup-candidates/runs');
const r3 = path.join(base, 'formal-custody-handoff-20261024-r3/reports');
const r4 = path.join(base, 'grouped-relocation-20261024-r4/reports');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const initial = read(path.join(base, 'log-version-cleanup-20261024-r1/reports/version-groups.json')).rows;
const preparation = read(path.join(r3, 'handoff-candidates.json'));
const relocation = read(path.join(r4, 'relocation-selection.json'));
const extra = read(path.join(r4, 'extra-relocation-selection.json'));
const cohorts = [
  { name: 'pilot', report: r3, paths: [path.join(root, 'artifacts/logs/app-release-2026.0.4')] },
  { name: 'old-1', report: r3 }, { name: 'unknown-1', report: r3 },
  ...relocation.groups.map(g => ({name:g.category, report:r4, paths:g.entries.map(e=>e.path)})),
  ...extra.groups.map(g => ({name:g.category, report:r4, paths:g.entries.map(e=>e.path)}))
];
const deleted = new Set();
const receipts = [];
for (const cohort of cohorts) {
  const applyPath = path.join(cohort.report, cohort.name + '-native-apply.json');
  const apply = read(applyPath);
  if (apply.aborted || !apply.results?.length || apply.results.some(x => x.status !== 'deleted' || x.remaining !== false || x.deletion?.remaining !== false)) throw Error('Deletion not verified: ' + applyPath);
  if (!cohort.paths) cohort.paths = read(path.join(cohort.report, cohort.name + '-request.json')).paths;
  for (const p of cohort.paths) {
    const canonical = path.resolve(p);
    if (deleted.has(canonical)) throw Error('Duplicate original boundary');
    if (fs.existsSync(canonical)) throw Error('Original boundary still exists: ' + canonical);
    deleted.add(canonical);
  }
  receipts.push({name:cohort.name, original_boundaries:cohort.paths.length, apply:applyPath, results:apply.results.length});
}
const byPath = new Map(initial.map(e=>[path.resolve(e.path),e]));
const removed = [...deleted].map(p=>{const row=byPath.get(p);if(!row)throw Error('Missing original inventory');return {path:p,bytes:row.bytes,category:row.category};});
const all = [...preparation.entries,...preparation.deferred];
const remaining = all.filter(e=>!deleted.has(path.resolve(e.path))).map(e=>({path:e.path,bytes:byPath.get(path.resolve(e.path))?.bytes ?? e.bytes,exists:fs.existsSync(e.path),category:byPath.get(path.resolve(e.path))?.category,reasons:path.basename(e.path)==='AF-01-resume-install'?['Git directories were confirmed generated fixtures; full-root unique source/patch integration, recovery role and terminal coverage remain unverified.']:e.reasons||['Credential/database or live-state boundary needs full independent generation and recovery evidence.'],revisit_condition:e.reasons?.some(s=>/ownership|ancestor|custody/.test(s))?'Resolve exact owner and active verification/recovery references before a new review.':'Prove full generated membership, preserve unique source/recovery inputs, and verify producer termination and consumer release before a new review.'}));
const totals = {};
for(const row of removed){const t=totals[row.category] ||= {count:0,bytes:0};t.count++;t.bytes+=row.bytes;}
const archive = read(path.join(r4,'extra-source-preservation.json'));
const result = {at:new Date().toISOString(),scope:'Exact 829 original legacy custody candidates; prior r2 cleanup reported separately.',deleted_boundaries:removed.length,deleted_logical_bytes:removed.reduce((n,e)=>n+e.bytes,0),by_original_category:totals,remaining_boundaries:remaining.length,remaining_logical_bytes:remaining.reduce((n,e)=>n+e.bytes,0),physical_bytes_reclaimed:null,physical_bytes_note:'Native deletion does not measure reclaimed allocation. Recovery archive and proof reports remain; this is not a measured free-space delta.',source_archive_bytes:fs.statSync(path.join(r4,'retained-source-and-config-evidence.zip')).size,receipts,remaining,source_preservation_manifest:path.join(r4,'extra-source-preservation.json')};
fs.writeFileSync(path.join(r4,'final-reconciliation.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,remaining:remaining.sort((a,b)=>b.bytes-a.bytes).slice(0,12),receipts:receipts.map(({name,original_boundaries})=>({name,original_boundaries}))}));
