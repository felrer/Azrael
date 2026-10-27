const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const lifecycle = require('../../scripts/artifact-lifecycle.cjs');
const root = path.resolve(__dirname, '../..');
const evidence = path.join(__dirname, 'reports/external-uninstall-results.json');
const results = JSON.parse(fs.readFileSync(evidence, 'utf8').replace(/^\uFEFF/, ''));
if (results.length !== 2 || results.some(r => r.exit_code !== 0 || !r.azrael_registration_absent || !r.other_registrations_preserved)) throw new Error('External retirement not verified');
const released = [];
for (const id of ['version:window-use-u17b', 'cf01-viewer-deploy-u22c']) {
  const record = lifecycle.catalog(root).find(r => r.id === id);
  const request = { owner: record.owner, expected_revision: record.revision,
    reference_ids: record.references.map(r => r.reference_id),
    reason: 'User authorized retirement of both external 2026.0.10 installations and linked builds, cancelling pending acceptance and rollback consumers. Both registrations removed with exit 0.',
    evidence_ref: evidence, evidence_sha256: crypto.createHash('sha256').update(fs.readFileSync(evidence)).digest('hex') };
  fs.writeFileSync(path.join(__dirname, 'reports', id.replaceAll(':', '-') + '-release-request.json'), JSON.stringify(request, null, 2));
  released.push(lifecycle.releaseReferences(root, id, request));
}
fs.writeFileSync(path.join(__dirname, 'reports/released-references.json'), JSON.stringify(released, null, 2));
console.log(JSON.stringify(released.map(r => ({id:r.id, revision:r.revision, references:r.references}))));
