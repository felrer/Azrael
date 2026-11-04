'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resolveInstalledApplication } = require('./window-child-session.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'azrael-installed-application-'));
  t.after(() => fs.rm(root, { recursive: true }));
  await fs.writeFile(path.join(root, 'mspaint.exe'), 'fixture executable');
  return { root, registration: { name: 'Microsoft.Paint', fullName: 'Microsoft.Paint_1.0.0.0_x64__fixture', installLocation: root,
    applications: [{ id: 'PaintApp', executable: 'mspaint.exe', entryPoint: 'Windows.FullTrustApplication' }] } };
}
function resolve(registration, request = { packageName: 'Microsoft.Paint' }) {
  return resolveInstalledApplication(request, { platform: 'win32', queryPackage: async () => registration });
}
function rejectsCode(promise, code) { return assert.rejects(promise, error => error.code === code); }

test('resolves one exact current-user full-trust registration to a file descriptor', async t => {
  const { root, registration } = await fixture(t);
  assert.deepEqual(await resolve(registration), { source: 'installed-package', packageName: 'Microsoft.Paint',
    packageFullName: registration.fullName, applicationId: 'PaintApp', executable: path.join(root, 'mspaint.exe'), title: 'Microsoft.Paint' });
});
test('rejects unsupported platforms before querying', async () => {
  await rejectsCode(resolveInstalledApplication({ packageName: 'Microsoft.Paint' }, { platform: 'linux', queryPackage: () => assert.fail('query') }), 'installed_application_platform_unsupported');
});
test('rejects wildcard, shell, URI, path and unknown request fields before querying', async () => {
  for (const packageName of ['Microsoft.*', '../Paint', 'shell:AppsFolder', 'Paint;whoami', ' Paint', 'A'.repeat(129)]) {
    await rejectsCode(resolveInstalledApplication({ packageName }, { platform: 'win32', queryPackage: () => assert.fail('query') }), 'installed_application_request_invalid');
  }
  await rejectsCode(resolve({}, { packageName: 'Microsoft.Paint', applicationId: '*'}), 'installed_application_request_invalid');
  await rejectsCode(resolve({}, { packageName: 'Microsoft.Paint', arguments: '-x'}), 'installed_application_request_invalid');
});
test('rejects foreign or malformed registration identity', async t => {
  const { registration } = await fixture(t);
  for (const delta of [{ name: 'Other.Paint' }, { fullName: 'Other.Paint_1.0' }, { applications: new Array(129).fill({}) }, { installLocation: 'relative' }]) {
    await rejectsCode(resolve({ ...registration, ...delta }), 'installed_application_registration_invalid');
  }
});
test('requires full-trust and rejects ambiguity unless exact application ID selects one', async t => {
  const { registration } = await fixture(t);
  await rejectsCode(resolve({ ...registration, applications: [{ ...registration.applications[0], entryPoint: 'Other' }] }), 'installed_application_not_found');
  registration.applications.push({ ...registration.applications[0], id: 'OtherApp' });
  await rejectsCode(resolve(registration), 'installed_application_ambiguous');
  assert.equal((await resolve(registration, { packageName: 'Microsoft.Paint', applicationId: 'PaintApp' })).applicationId, 'PaintApp');
  await rejectsCode(resolve(registration, { packageName: 'Microsoft.Paint', applicationId: 'Missing' }), 'installed_application_not_found');
});
test('rejects traversal, absolute paths, commands, alternate streams and missing files', async t => {
  const { root, registration } = await fixture(t);
  for (const executable of ['../mspaint.exe', '..\\mspaint.exe', path.join(root, 'mspaint.exe'), 'mspaint.exe -x', 'mspaint.exe:stream', 'sub/./mspaint.exe', 'sub./mspaint.exe']) {
    await rejectsCode(resolve({ ...registration, applications: [{ ...registration.applications[0], executable }] }), 'installed_application_path_invalid');
  }
  await rejectsCode(resolve({ ...registration, applications: [{ ...registration.applications[0], executable: 'missing.exe' }] }), 'installed_application_path_unavailable');
});
test('rejects directory masquerading as executable and junction ancestry', async t => {
  const { root, registration } = await fixture(t);
  await fs.mkdir(path.join(root, 'directory.exe'));
  await rejectsCode(resolve({ ...registration, applications: [{ ...registration.applications[0], executable: 'directory.exe' }] }), 'installed_application_path_invalid');
  await fs.symlink(root, path.join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  await rejectsCode(resolve({ ...registration, applications: [{ ...registration.applications[0], executable: 'alias/mspaint.exe' }] }), 'installed_application_path_invalid');
});
test('re-queries every resolve and rejects registration removed between calls', async t => {
  const { registration } = await fixture(t);
  let count = 0;
  const options = { platform: 'win32', queryPackage: async () => ++count === 1 ? registration : null };
  await resolveInstalledApplication({ packageName: 'Microsoft.Paint' }, options);
  await rejectsCode(resolveInstalledApplication({ packageName: 'Microsoft.Paint' }, options), 'installed_application_registration_invalid');
  assert.equal(count, 2);
});
