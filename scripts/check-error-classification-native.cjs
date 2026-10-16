'use strict';
const { isAbsolute } = require('node:path');
const { runCargoTest } = require('./cargo-verification.cjs');
const [sourceRoot, ...extra] = process.argv.slice(2);
if (!sourceRoot || !isAbsolute(sourceRoot) || extra.length) throw Error('Usage: check-error-classification-native.cjs <absolute engine source root>');
for (const [crate, filter] of [
  ['codex-protocol', 'unclassified_error_preserves_unknown_cause_without_automatic_retry'],
  ['codex-core', 'devin::native_runtime::errors::tests::'],
  ['codex-core', 'devin::native_runtime::transport::tests::'],
  ['codex-core', 'devin::native_runtime::tests::helper_failures_preserve_precise_client_error_categories'],
]) {
  const result = runCargoTest(sourceRoot, ['test', '-p', crate, '--lib', filter,
    '--locked', '--offline', '--', '--test-threads=1'], { isolateHostEnvironment: true });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
