"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

test("core integration targets remain explicitly selectable without expanding unit checks", () => {
  const cargo = read("engine/codex-rs/core/Cargo.toml");
  assert.match(cargo, /autotests\s*=\s*false/);
  const targets = cargo.split("[[test]]").slice(1).map(block => ({
    name: block.match(/name\s*=\s*"([^"]+)"/)[1],
    source: block.match(/path\s*=\s*"([^"]+)"/)[1],
    selected: /required-features\s*=\s*\["integration-tests"\]/.test(block.split(/^\[/m)[0]),
  }));
  assert.deepEqual(targets.map(t => t.name).sort(), ["all", "mcp_trace_propagation", "request_user_input_async", "responses_headers"]);
  for (const target of targets) {
    assert.ok(target.selected, target.name);
    assert.ok(fs.existsSync(path.join(root, "engine/codex-rs/core", target.source)));
  }
  const features = cargo.split("[features]")[1].split(/^\[/m)[0];
  assert.match(features, /^integration-tests\s*=\s*\[\]/m);
  assert.doesNotMatch(features, /^default\s*=.*integration-tests/m);
});

test("question target shares helper dispatch setup and is omitted from the aggregate", () => {
  assert.doesNotMatch(read("engine/codex-rs/core/tests/suite/mod.rs"), /mod request_user_input_async;/);
  for (const file of ["all.rs", "request_user_input_async.rs"]) {
    assert.match(read(`engine/codex-rs/core/tests/${file}`), /mod integration_test_setup;/);
  }
  assert.match(read("engine/codex-rs/core/tests/request_user_input_async.rs"), /suite\/request_user_input_async\.rs/);
  const setup = read("engine/codex-rs/core/tests/integration_test_setup.rs");
  for (const marker of ["CODEX_CORE_APPLY_PATCH_ARG1", "CODEX_FS_HELPER_ARG1", "CODEX_WINDOWS_MXC_ARG1", "CODEX_LINUX_SANDBOX_ARG0"]) assert.ok(setup.includes(marker));
  assert.match(read("scripts/check-question-withdrawal-native.cjs"), /"--test", "request_user_input_async"/);
});

test("app-server unit preflight omits its aggregate and explicit helper binaries", () => {
  const cargo = read("engine/codex-rs/app-server/Cargo.toml");
  assert.match(cargo, /autotests\s*=\s*false/);
  const integration = cargo.split("[[test]]")[1].split(/^\[/m)[0];
  assert.match(integration, /name\s*=\s*"all"/);
  assert.match(integration, /required-features\s*=\s*\["integration-tests"\]/);
  const features = cargo.split("[features]")[1].split(/^\[/m)[0];
  assert.match(features, /^integration-tests\s*=\s*\[\]/m);
  assert.doesNotMatch(features, /^default\s*=.*integration-tests/m);
  const bins = cargo.split("[[bin]]").slice(1).map(block => block.split(/^\[/m)[0]);
  assert.deepEqual(bins.map(block => block.match(/name\s*=\s*"([^"]+)"/)[1]).sort(),
    ["azrael", "codex-app-server", "codex-app-server-test-notify-capture", "exec-server"]);
  for (const bin of bins) assert.match(bin, /test\s*=\s*false/);
});

test("full regression entry uses target selection on both shells", () => {
  const commands = read("engine/justfile").split(/\r?\n/).filter(line => /cargo nextest run/.test(line));
  assert.equal(commands.length, 2);
  for (const command of commands) assert.match(command, /\{test-targets\}/);
  const archive = read("engine/.github/workflows/rust-ci-full-nextest-platform.yml").split("cargo nextest archive")[1].split("--archive-file")[0];
  assert.match(archive, /--tests --bins/);
  assert.match(archive, /--features codex-core\/integration-tests,codex-app-server\/integration-tests/);
  assert.doesNotMatch(archive, /--lib|--test '\*'/);
  assert.doesNotMatch(archive, /--test(?:=|\s)|--bin(?:=|\s)/);
});

test("shell adapter preserves full default coverage and explicit narrow selectors", () => {
  const script = `
import importlib.util, json, sys, types
from pathlib import Path
spec = importlib.util.spec_from_file_location("just_shell", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
root = Path(m.__file__).resolve().parent.parent / "codex-rs"
packages = [dict(id=name, name=name, manifest_path=str(root / directory / "Cargo.toml")) for name, directory in [("codex-core", "core"), ("codex-app-server", "app-server"), ("codex-protocol", "protocol")]]
metadata = dict(workspace_root=str(root), packages=packages, workspace_members=[p["id"] for p in packages], workspace_default_members=[p["id"] for p in packages])
metadata_calls = []
def output(argv, **kwargs):
    if argv[1] == "metadata":
        metadata_calls.append(argv)
        return json.dumps(metadata)
    return argv[argv.index("--package") + 1].split("@")[0]
m.subprocess.check_output = output
cases = [
    ([], "--tests --bins --features codex-core/integration-tests,codex-app-server/integration-tests"),
    (["-p", "codex-core"], "--tests --bins --features codex-core/integration-tests"),
    (["-p", "codex-core", "--lib"], ""),
    (["--test=all"], "--features codex-core/integration-tests,codex-app-server/integration-tests"),
    (["--bin", "azrael"], ""),
    (["--", "--lib"], "--tests --bins --features codex-core/integration-tests,codex-app-server/integration-tests"),
    (["-p", "codex-protocol"], "--tests --bins"),
    (["--workspace", "--exclude", "codex-*"], "--tests --bins"),
    (["-pcodex-core"], "--tests --bins --features codex-core/integration-tests"),
    (["--package=codex-core", "--test", "all"], "--features codex-core/integration-tests"),
    (["--workspace", "--exclude=codex-core"], "--tests --bins --features codex-app-server/integration-tests"),
    (["--workspace", "--exclude=codex-app-server"], "--tests --bins --features codex-core/integration-tests"),
    (["--package=codex-protocol", "--tests"], ""),
    (["--all", "--exclude=codex-*"], "--tests --bins"),
    (["--package=codex-app-server", "--test=all"], "--features codex-app-server/integration-tests"),
    (["-p", "codex-*"], "--tests --bins --features codex-core/integration-tests,codex-app-server/integration-tests"),
]
results = []
for args, expected in cases:
    calls = []
    metadata_calls.clear()
    m.os.execvp = lambda command, argv: calls.append(argv)
    m.run_sh("cargo nextest run {test-targets} {args}", "test", args)
    sh = calls.pop()
    m.shutil.which = lambda name: "pwsh"
    def run(argv, **kwargs):
        calls.append(argv)
        return types.SimpleNamespace(returncode=0)
    m.subprocess.run = run
    m.run_powershell("cargo nextest run {test-targets} {args}", "test", args)
    ps = calls.pop()
    flags = m.test_target_flags(args)
    results.append(dict(args=args, expected=expected, flags=flags, sh=sh, ps=ps, metadata_calls=len(metadata_calls)))

# Ordinary recipes have no target placeholder and must never inspect Cargo metadata.
def unexpected_metadata(*args, **kwargs):
    raise AssertionError("non-test recipe queried Cargo metadata")
m.subprocess.check_output = unexpected_metadata
for command in ["cargo fmt {args}", "cargo build {args}"]:
    m.run_sh(command, "ordinary", ["--locked"])
    m.run_powershell(command, "ordinary", ["--locked"])
print(json.dumps(results))
`;
  const sdkPython = path.join(root, "engine/sdk/python/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const python = process.env.AZRAEL_PYTHON || (fs.existsSync(sdkPython) ? sdkPython : process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(python, ["-B", "-c", script, path.join(root, "engine/scripts/just-shell.py")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.error ? `${result.error.message}; set AZRAEL_PYTHON to the installed Python interpreter` : result.stderr);
  for (const item of JSON.parse(result.stdout)) {
    assert.equal(item.flags, item.expected, JSON.stringify(item.args));
    const narrow = (item.args.includes("--lib") && item.args[0] !== "--") || item.args[0] === "--bin";
    assert.equal(item.metadata_calls, narrow ? 0 : 3);
    assert.doesNotMatch(item.flags, /--lib|--test '\*'|installed_client/);
    assert.deepEqual(item.sh.slice(4), item.args);
    assert.deepEqual(item.ps.slice(6), item.args);
    assert.equal(item.sh[2], `cargo nextest run ${item.expected} "$@"`);
    assert.equal(item.ps[4], `cargo nextest run ${item.expected} @($args | Select-Object -Skip 1)`);
  }
});

test("Windows and portable product builds request the remote-only bridge", () => {
  for (const file of ["scripts/build-azrael.ps1", "scripts/build-platform.cjs"]) {
    const command = read(file).split(/\r?\n/).find(line => /--bin/.test(line) && /azrael-bridge/.test(line));
    assert.ok(command, file);
    assert.ok(command.includes("--no-default-features"), file);
  }
});

test("shared-engine verification retains relocated registration tests", () => {
  assert.match(read("scripts/check-shared-engine-native.cjs"), /\["codex-app-server-daemon", "registration::tests::"\]/);
});
