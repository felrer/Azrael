"use strict";
// Real standalone-process regression for transient lock contention and registration merging.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { performance } = require("node:perf_hooks");

const repo = path.resolve(__dirname, "..");
const boundary = path.join(repo, "artifacts/tasks");
const args = process.argv.slice(2);
const expectBusy = args.includes("--expect-busy");
const partition = args.includes("--partition");
const at = args.indexOf("--fixture-root");
assert(at >= 0 && args[at + 1], "--fixture-root ABS is required");
const valueOptions = new Set(["--fixture-root", "--state-bytes", "--state-records", "--parallel"]);
const seenOptions = new Set();
for (let index = 0; index < args.length; index++) {
  const option = args[index];
  assert(!seenOptions.has(option), "duplicate argument: " + option);
  seenOptions.add(option);
  if (valueOptions.has(option)) assert(args[++index] !== undefined, "missing argument: " + option);
  else assert(["--expect-busy", "--partition"].includes(option), "unknown argument: " + option);
}
function integerOption(name, fallback, minimum, maximum) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  assert(/^\d+$/.test(args[index + 1]), name + " requires an integer");
  const value = Number(args[index + 1]);
  assert(Number.isSafeInteger(value) && value >= minimum && value <= maximum, name + " out of range");
  return value;
}
const stateBytes = integerOption("--state-bytes", 0, 0, 32 * 1024 * 1024);
const stateRecords = integerOption("--state-records", 1, 1, 2000);
const parallelCount = integerOption("--parallel", 6, 1, 8);
const fixture = path.resolve(args[at + 1]);
assert(path.isAbsolute(args[at + 1]) && fixture.startsWith(boundary + path.sep), "fresh contained fixture required");
assert(!fs.existsSync(fixture), "fixture must not exist");
const binary = process.env.AZRAEL_MAINTENANCE_OWNER;
assert(binary && path.isAbsolute(binary) && fs.statSync(binary).isFile(), "explicit absolute AZRAEL_MAINTENANCE_OWNER required");
const identity = { path: binary, sha256: createHash("sha256").update(fs.readFileSync(binary)).digest("hex") };
const active = new Set();
const observations = [];
let sequence = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const write = (name, value) => {
  const filename = path.join(fixture, name);
  fs.writeFileSync(filename, JSON.stringify(value));
  return filename;
};
function launch(argv, timing) {
  const started = performance.now();
  const env = { ...process.env };
  if (timing) env.AZRAEL_MAINTENANCE_TIMING = "1";
  else delete env.AZRAEL_MAINTENANCE_TIMING;
  const child = spawn(binary, argv, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  active.add(child);
  let stdout = "", stderr = "";
  child.stdout.on("data", bytes => { stdout += bytes; });
  child.stderr.on("data", bytes => { stderr += bytes; });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      active.delete(child);
      resolve({ code, signal, elapsed_ms: performance.now() - started, stdout, stderr });
    });
  });
  // Always observe completion, even if readiness parsing fails.
  done.catch(() => {});
  return { child, done };
}
function request(value, timing = true) {
  // Successful transient-contention scenarios opt in; ordinary calls stay immediate.
  const filename = write(`request-${++sequence}.json`, expectBusy ? value : { lock_wait_ms: 5000, ...value });
  const launched = launch(["--project-root", fixture, "--request", filename], timing);
  launched.child.stdin.end();
  return launched.done;
}
function parsed(result) {
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert(value && typeof value === "object");
  return value;
}
function item(id) {
  const relative = `artifacts/tasks/${id}`;
  fs.mkdirSync(path.join(fixture, relative), { recursive: true });
  fs.writeFileSync(path.join(fixture, relative, "payload.txt"), id);
  return { operation: "register", item: { id, path: relative, kind: "work", generated: true, owner: "test-maintenance-contention", protection_known: true, references: [] } };
}
function reservationsEmpty() {
  const directory = path.join(fixture, "artifacts/maintenance/lifecycles/reservations");
  assert.deepEqual(fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.endsWith(".json")) : [], [], "registration must leave no reservation");
}
async function holder(lock) {
  assert(fs.statSync(lock).isFile(), "initialize existing metadata before taking its OS lock");
  const lease = launch(["--lease", lock, "--operation", "test.contention", "--wait-ms", "0", "--parent-pid", String(process.pid)], false);
  const ready = await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(Error("lease readiness timeout")), 10000);
    const onData = bytes => {
      buffer += bytes;
      if (!buffer.includes("\n")) return;
      clearTimeout(timer);
      lease.child.stdout.off("data", onData);
      try { resolve(JSON.parse(buffer.split("\n")[0])); } catch (error) { reject(error); }
    };
    lease.child.stdout.on("data", onData);
    lease.done.then(result => { clearTimeout(timer); reject(Error(`lease exited before readiness: ${result.code} ${result.stderr}`)); }, reject);
  });
  assert.equal(ready.id, 0);
  assert.equal(ready.ok, true);
  assert(Number.isInteger(lease.child.pid));
  assert.equal(ready.result.pid, lease.child.pid);
  assert.equal(ready.result.parent_pid, process.pid);
  assert.equal(ready.result.operation, "test.contention");
  assert.equal(ready.result.schema, 2);
  return { ...lease, ready };
}
function timingSummary(results) {
  const eventNames = ["maintenance.lock_wait", "maintenance.lock_hold", "maintenance.phase"];
  const events = results.flatMap(result => result.stderr.split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  })).filter(value => value && eventNames.includes(value.event));
  function aggregate(rows) {
    const times = rows.map(value => value.elapsed_us).sort((left, right) => left - right);
    assert(times.every(value => typeof value === "number" && value >= 0), "invalid timing duration");
    const percentile = fraction => times.length ? times[Math.ceil(times.length * fraction) - 1] : 0;
    const attempts = rows.filter(value => value.attempts !== undefined && value.attempts !== null).map(value => value.attempts);
    assert(attempts.every(value => Number.isInteger(value) && value >= 0), "invalid timing attempts");
    return {
      count: rows.length,
      total_us: times.reduce((sum, value) => sum + value, 0),
      max_us: times.at(-1) || 0,
      p50_us: percentile(0.50),
      p95_us: percentile(0.95),
      outcomes: [...new Set(rows.map(value => value.outcome))],
      attempts: {
        count: attempts.length,
        total: attempts.reduce((sum, value) => sum + value, 0),
        max: Math.max(0, ...attempts),
        counts: Object.fromEntries([...new Set(attempts)].sort((left, right) => left - right).map(value => [String(value), attempts.filter(attempt => attempt === value).length])),
      },
    };
  }
  return Object.fromEntries(eventNames.map(event => {
    const rows = events.filter(value => value.event === event);
    const groups = new Map();
    for (const row of rows) {
      const operation = row.operation ?? null;
      // Normalize only fixture-local paths; keep unexpected paths visible for diagnosis.
      const relative = typeof row.path === "string" && path.isAbsolute(row.path) ? path.relative(fixture, row.path) : null;
      const contained = relative !== null && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
      const lockPath = contained ? relative.split(path.sep).join("/") : row.path ?? null;
      const key = JSON.stringify([lockPath, operation]);
      if (!groups.has(key)) groups.set(key, { key, path: lockPath, operation, rows: [] });
      groups.get(key).rows.push(row);
    }
    return [event, {
      ...aggregate(rows),
      groups: [...groups.values()].map(group => ({ key: group.key, path: group.path, operation: group.operation, ...aggregate(group.rows) })),
    }];
  }));
}
async function main() {
  fs.mkdirSync(fixture, { recursive: true });
  write("project-maintenance.json", { schema_version: 1, project_id: "maintenance-contention-fixture", managed_roots: ["artifacts/tasks"], protected_paths: [], bundles: [] });
  parsed(await request({ operation: "inventory" }, false));
  parsed(await request(item("seed"), false));
  // Only this fresh fixture's opaque item metadata is padded. The native seed
  // registration supplies the valid path and measurement fields unchanged.
  const manifestPath = path.join(fixture, "artifacts/maintenance/manifest.json");
  const seedState = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert(seedState.items.seed);
  const seedIds = Array.from({ length: stateRecords }, (_, index) => index ? `seed-${index}` : "seed");
  const seedTemplate = seedState.items.seed;
  seedIds.forEach((id, index) => {
    const bytes = Math.floor(stateBytes / stateRecords) + (index < stateBytes % stateRecords ? 1 : 0);
    seedState.items[id] = { ...seedTemplate, id, contention_test_padding: "x".repeat(bytes) };
  });
  if (stateBytes || stateRecords > 1) {
    fs.writeFileSync(manifestPath, JSON.stringify(seedState));
  }
  const initialStateBytes = fs.statSync(manifestPath).size;
  let partitionResult = null;
  if (partition) {
    assert.equal(active.size, 0, "partition requires all fixture writers stopped");
    reservationsEmpty();
    const evidence = path.join(fixture, "artifacts/maintenance/evidence/contention-writers-stopped.json");
    fs.mkdirSync(path.dirname(evidence), { recursive: true });
    fs.writeFileSync(evidence, JSON.stringify({ schema: 1, fixture, probe_pid: process.pid, binary: identity, writers_stopped_verified: true, active_children: 0, boundary: "after-seed-padding-before-contention", timestamp: new Date().toISOString() }));
    const result = await request({ operation: "partition_storage", writers_stopped_verified: true, reason: "Fresh isolated performance fixture; all owned native processes observed closed after seed preparation", evidence_ref: evidence, evidence_sha256: sha256(fs.readFileSync(evidence)), expected_manifest_sha256: sha256(fs.readFileSync(manifestPath)) });
    partitionResult = { actual_exit: result.code, elapsed_ms: result.elapsed_ms, result: parsed(result) };
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, "utf8")).storage_format, "partitioned-v1");
  }
  const results = [];
  for (const [label, relative] of [["maintenance", "artifacts/maintenance/maintenance.lock"], ["catalog", "artifacts/maintenance/lifecycles/catalog.lock"]]) {
    const held = await holder(path.join(fixture, relative));
    const contender = request(item(`contended-${label}`));
    await delay(150);
    held.child.stdin.end();
    const released = await held.done;
    assert.equal(released.code, 0, released.stderr);
    const result = await contender;
    results.push(result);
    observations.push({ scenario: label, actual_exit: result.code, elapsed_ms: result.elapsed_ms, ready: held.ready, ...(result.code === 0 ? {} : { diagnostic: result.stderr.trim() }) });
    if (expectBusy) {
      assert.equal(result.code, 1, "baseline must reproduce busy failure");
      assert.match(result.stderr, /busy|held|lock|occup/i);
    } else {
      assert.equal(parsed(result).item.id, `contended-${label}`);
    }
    reservationsEmpty();
  }
  const uncontended = await request(item("uncontended"));
  assert.equal(parsed(uncontended).item.id, "uncontended");
  results.push(uncontended);
  observations.push({ scenario: "uncontended", actual_exit: uncontended.code, elapsed_ms: uncontended.elapsed_ms });
  const started = performance.now();
  const requests = Array.from({ length: parallelCount }, (_, index) => item(`parallel-${index}`));
  const parallel = await Promise.all(requests.map(value => request(value)));
  const total = performance.now() - started;
  parallel.forEach((result, index) => {
    if (!expectBusy || result.code === 0) assert.equal(parsed(result).item.id, requests[index].item.id);
    else assert.equal(result.code, 1, result.stderr);
  });
  results.push(...parallel);
  observations.push({ scenario: "parallel", total_elapsed_ms: total, success_count: parallel.filter(result => result.code === 0).length, results: parallel.map(result => ({ actual_exit: result.code, elapsed_ms: result.elapsed_ms })) });
  reservationsEmpty();
  const off = await request(item("timing-off"), false);
  assert.equal(parsed(off).item.id, "timing-off");
  assert(!/"event"\s*:\s*"maintenance\.(?:lock_|phase")/.test(off.stderr), "timing disabled must omit timing events");
  const inventory = parsed(await request({ operation: "inventory" }, false));
  // Inspect persistent state as well as each CLI response: concurrent commits must survive.
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture, "artifacts/maintenance/manifest.json"), "utf8"));
  assert.equal(manifest.storage_format === "partitioned-v1", partition, "fixture storage format changed unexpectedly");
  const blobCache = new Map();
  function storedItem(id) {
    if (!partition) return manifest.items[id];
    const hash = manifest.items[id];
    assert(typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash), "invalid item blob hash");
    if (!blobCache.has(hash)) {
      const bytes = fs.readFileSync(path.join(fixture, "artifacts/maintenance/state-records", hash + ".json"));
      assert.equal(sha256(bytes), hash, "item blob SHA mismatch");
      blobCache.set(hash, JSON.parse(bytes));
    }
    const value = blobCache.get(hash)[id];
    assert(value, "item absent from referenced bucket");
    return value;
  }
  let preservedPadding = 0;
  for (const id of seedIds) {
    const value = storedItem(id);
    const expected = seedState.items[id].contention_test_padding || "";
    assert.equal(value.contention_test_padding || "", expected, "native saves must preserve padding");
    preservedPadding += (value.contention_test_padding || "").length;
  }
  assert.equal(preservedPadding, stateBytes);
  for (const value of requests) {
    const index = requests.indexOf(value);
    if (parallel[index].code === 0) assert(manifest.items[value.item.id], "successful concurrent registration lost");
  }
  assert(inventory);
  const timing = timingSummary(results);
  if (!expectBusy) for (const event of Object.keys(timing)) assert(timing[event].count > 0, `missing ${event}`);
  const blobs = partition ? fs.readdirSync(path.join(fixture, "artifacts/maintenance/state-records")).filter(name => /^[a-f0-9]{64}\.json$/.test(name)) : [];
  const blobBytes = blobs.reduce((sum, name) => sum + fs.statSync(path.join(fixture, "artifacts/maintenance/state-records", name)).size, 0);
  return { status: expectBusy ? "baseline-reproduced" : "passed", platform: process.platform, arch: process.arch, binary: identity, state: { model: "synthetic item metadata; seed clones share one valid payload path", records: stateRecords, padding_bytes: stateBytes, initial_manifest_bytes: initialStateBytes, final_manifest_bytes: fs.statSync(manifestPath).size, blob_count: blobs.length, blob_bytes: blobBytes }, partition: partitionResult, parallel: parallelCount, observations, timing, timing_off_stdout_json: true };
}

(async () => {
  let summary, failure;
  try { summary = await main(); } catch (error) { failure = error; }
  // This binary invokes no descendant executables. Closing each lease stdin and
  // awaiting close proves every owned native process has terminated before removal.
  try {
    for (const child of active) child.stdin.end();
    const deadline = performance.now() + 12000;
    while (active.size && performance.now() < deadline) await delay(25);
    assert.equal(active.size, 0, "native children still active; fixture preserved");
    if (fs.existsSync(fixture)) fs.rmSync(fixture, { recursive: true });
    assert.equal(fs.existsSync(fixture), false);
  } catch (error) { failure = failure || error; }
  if (failure) {
    console.error(JSON.stringify({ status: "failed", binary: identity, observations, error: failure.stack, remaining_fixture: fs.existsSync(fixture) ? fixture : null }));
    process.exitCode = 1;
  } else console.log(JSON.stringify({ ...summary, fixture_removed: true }));
})();
