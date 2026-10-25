"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const python = process.platform === "win32" ? "python" : "python3";
const checks = [
  ["test_import_engine_source.py",
    "ImportTests.test_inventory_rejects_root_replaced_with_identical_files",
    "ImportTests.test_destination_rejects_root_replaced_with_identical_files",
    "ImportTests.test_validation_context_retains_file_escape_and_lexical_guards"],
  ["test_engine_provenance.py",
    "ImportedEngineProvenanceTests.test_snapshot_rejects_identical_root_replacement_after_validation",
    "EngineProvenanceTests.test_release_reuse_rejects_dev_and_legacy_receipts",
    "EngineProvenanceTests.test_release_profile_keeps_source_binary_and_host_guards",
    "NativeTargetProvenanceTests.test_unix_source_build_binds_target_three_hashes_and_source"],
];

for (const [file, ...cases] of checks) {
  const result = spawnSync(python, ["-I", "-B", path.join(__dirname, "tests", file), ...cases], {
    cwd: path.resolve(__dirname, ".."), stdio: "inherit", windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}
