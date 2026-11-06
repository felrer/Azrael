'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {reviewReuse, loadDecisions, errorReport, fieldKeys} = require('./verification-reuse-policy.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const key = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function measure(file) {
  const absolute = path.resolve(typeof file === 'string' ? file : file.path);
  const stat = fs.lstatSync(absolute, {bigint: true});
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`Pipeline output must be an explicit regular file: ${absolute}`);
  return {path: absolute, size: String(stat.size), sha256: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')};
}

// The caller holds its existing long-lived exclusive owner lease. The short
// metadata update lock below only serializes authorized parent/child writes;
// neither lock permits stale-owner recovery here. The state file, its sibling
// update-lock and atomic temporary files belong to the caller's output owner.
function openPipelineState({file, identity, resume = false, lockHeld = false, reuseDecisionsPath}) {
  if (!lockHeld) throw Error('Pipeline state requires the caller\'s exclusive owner lease.');
  file = path.resolve(file);
  const decisions = loadDecisions(reuseDecisionsPath);
  const exists = fs.existsSync(file);
  if (exists && !resume) throw Error('Pipeline state already exists; explicit resume is required.');
  if (!exists && resume) throw Error('Resume requires an existing pipeline state.');
  let state = exists ? JSON.parse(fs.readFileSync(file, 'utf8')) : {schema: 1, identity: canonical(identity), stages: {}};
  if (state.schema !== 1 || key(state.identity) !== key(identity)) throw Error('Pipeline identity changed; select a new frozen work identity.');
  const save = () => {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temporary = `${file}.tmp`;
    let created = false;
    try {
      const descriptor = fs.openSync(temporary, 'wx');
      created = true;
      try { fs.writeFileSync(descriptor, JSON.stringify(state, null, 2) + '\n'); }
      finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, file);
    } finally { if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  };
  if (!exists) save();
  const refresh = () => {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (state.schema !== 1 || key(state.identity) !== key(identity)) throw Error('Pipeline identity changed during observation.');
  };
  function update(operation) {
    // A deployment parent and its build child share the long-lived work lease.
    // Serialize their short metadata updates and reload after acquisition so
    // neither can overwrite a concurrently completed independent stage.
    const lock = `${file}.update-lock`;
    let descriptor;
    const deadline = Date.now() + 5000;
    while (descriptor === undefined) {
      try { descriptor = fs.openSync(lock, 'wx'); }
      catch (error) {
        if (error.code !== 'EEXIST' || Date.now() >= deadline) throw Error(`Pipeline state update lock is unavailable; preserve unresolved ownership: ${lock}`, {cause: error});
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    try {
      refresh();
      return operation();
    } finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
  }
  function current(name) { return state.stages[name]?.at(-1); }
  function recoveryEvidence(request) {
    if (request.producer_stopped_verified !== true || typeof request.reason !== 'string' || !request.reason.trim()) throw Error('Pipeline recovery requires verified producer stop and a nonblank reason.');
    const evidence = request.evidence_ref;
    if (typeof evidence !== 'string' || !path.isAbsolute(evidence) || evidence.split(/[\\/]/).includes('..') || !/^[a-f0-9]{64}$/.test(request.evidence_sha256 || '')) throw Error('Pipeline recovery requires absolute evidence without traversal and its SHA-256.');
    const inside = (parent, child) => { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
    const protectedPaths = [file, `${file}.update-lock`, `${file}.tmp`, ...Object.values(state.stages).flatMap(attempts => attempts.flatMap(record => record.outputs.map(output => output.path)))];
    if (protectedPaths.some(protectedPath => inside(protectedPath, evidence))) throw Error('Pipeline recovery evidence overlaps pipeline state or outputs.');
    function inspect() {
      let ancestor = path.resolve(evidence);
      while (true) {
        const stat = fs.lstatSync(ancestor, {bigint: true});
        if (stat.isSymbolicLink()) throw Error('Pipeline recovery evidence cannot be linked.');
        if (ancestor === path.resolve(evidence) && (!stat.isFile() || stat.nlink !== 1n)) throw Error('Pipeline recovery evidence requires an unlinked regular file.');
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
      return fs.lstatSync(evidence, {bigint: true});
    }
    const before = inspect(), actual = measure(evidence), after = inspect();
    if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(field => before[field] !== after[field]) || actual.sha256 !== request.evidence_sha256) throw Error('Pipeline recovery evidence changed or its SHA-256 does not match.');
  }
  function recovered(record) {
    const {recovery, ...stage} = record;
    if (!recovery || record.status !== 'unknown' || record.exitCode !== null || recovery.expectedStageId !== record.id ||
        !['running', 'unknown'].includes(recovery.priorStatus) || recovery.stageKey !== key(stage) || !Number.isFinite(Date.parse(recovery.recoveredUtc))) throw Error('Pipeline stage has no valid bound recovery receipt.');
    recoveryEvidence(recovery);
  }
  function dependencyKeys(dependencies = []) {
    return Object.fromEntries(dependencies.map(name => {
      const record = current(name);
      if (!record || record.status !== 'succeeded' || record.exitCode !== 0) throw Error(`Pipeline dependency is not successful: ${name}`);
      verifyOutputs(record);
      return [name, record.id];
    }));
  }
  function verifyOutputs(record) {
    if (!Array.isArray(record.outputs)) throw Error(`Pipeline output integrity is invalid: ${record.name}`);
    for (const output of record.outputs) {
      if (key(measure(output)) !== key(output)) throw Error(`Pipeline output integrity changed: ${record.name}`);
    }
  }
  function lookup(name, {inputs = {}, dependencies = [], outputs} = {}) {
    return update(() => {
    const record = current(name);
    if (!record) return null;
    if (record.status === 'running' || (record.status === 'unknown' && !record.recovery)) throw Error(`Pipeline stage ${name} has unresolved execution; verify its owned process tree stopped before recovery.`);
    if (record.status === 'unknown') { recovered(record); return null; }
    if (record.status === 'failed') return null;
    if (record.status !== 'succeeded' || record.exitCode !== 0) throw Error(`Pipeline stage has no valid successful evidence: ${name}`);
    verifyOutputs(record);
    const dependencyIdentity = dependencyKeys(dependencies);
    if (outputs && key(outputs.map(item => path.resolve(typeof item === 'string' ? item : item.path)).sort()) !== key(record.outputs.map(item => item.path).sort())) throw Error(`Pipeline requested output paths differ: ${name}`);
    const {reuseReviews, ...evidence} = record;
    const inputDetails = record.inputFieldKeys ? { previous: record.inputFieldKeys, current: fieldKeys(inputs) } : null;
    const review = reviewReuse({scope: `pipeline:${name}`, previous: {inputsKey: record.inputsKey, ...(inputDetails ? {fields: inputDetails.previous} : {}), dependencies: record.dependencies},
      current: {inputsKey: key(inputs), ...(inputDetails ? {fields: inputDetails.current} : {}), dependencies: dependencyIdentity}, evidence: {identity: state.identity, stage: evidence}, decisions});
    if (review.action === 'rerun') return null;
    if (review.mode === 'reviewed') {
      record.reuseReviews ||= [];
      if (!record.reuseReviews.some(item => item.review.reviewId === review.review.reviewId)) {
        record.reuseReviews.push(review); save();
      }
    }
    return structuredClone(record);
    });
  }
  return {
    lookup,
    recover(name, request = {}) {
      return update(() => {
        const record = current(name);
        if (!record || !['running', 'unknown'].includes(record.status) || record.exitCode !== null || request.expectedStageId !== record.id) throw Error('Pipeline recovery requires the exact current running/unknown stage with null exit code.');
        recoveryEvidence(request);
        const selected = {expectedStageId: request.expectedStageId, producer_stopped_verified: request.producer_stopped_verified,
          evidence_ref: request.evidence_ref, evidence_sha256: request.evidence_sha256, reason: request.reason};
        if (record.recovery) {
          const existing = Object.fromEntries(Object.keys(selected).map(field => [field, record.recovery[field]]));
          if (key(existing) !== key(selected)) throw Error('Pipeline recovery request differs from the recorded receipt.');
          recovered(record);
          return structuredClone(record);
        }
        const stage = {...record, status: 'unknown'};
        stage.recovery = {...selected, priorStatus: record.status, stageKey: key(stage), recoveredUtc: new Date().toISOString()};
        Object.assign(record, stage); save(); return structuredClone(record);
      });
    },
    start(name, {inputs = {}, dependencies = []} = {}) {
      return update(() => {
      const previous = current(name);
      if (previous?.status === 'running' || (previous?.status === 'unknown' && !previous.recovery)) throw Error(`Pipeline stage ${name} has unresolved execution; verify its owned process tree stopped before recovery.`);
      if (previous?.status === 'unknown') recovered(previous);
      const record = {id: crypto.randomUUID(), name, status: 'running', inputsKey: key(inputs), inputFieldKeys: fieldKeys(inputs), dependencies: dependencyKeys(dependencies), startedUtc: new Date().toISOString(), exitCode: null, outputs: []};
      (state.stages[name] ||= []).push(record); save(); return structuredClone(record);
      });
    },
    finish(name, {exitCode = null, outputs = [], data = null, error = null, outcome} = {}) {
      return update(() => {
      const record = current(name);
      if (!record || record.status !== 'running') throw Error(`No running pipeline stage: ${name}`);
      if (exitCode !== null && !Number.isInteger(exitCode)) throw Error('Pipeline exit code must be an actual integer or null.');
      if (outcome !== undefined && !['succeeded', 'failed', 'unknown'].includes(outcome)) throw Error('Invalid pipeline terminal outcome.');
      if (outcome === 'succeeded' && exitCode !== 0) throw Error('Successful pipeline outcome requires actual exit code zero.');
      if (outcome === 'unknown' && exitCode !== null) throw Error('Unknown pipeline outcome cannot have a terminal exit code.');
      record.exitCode = exitCode;
      record.completedUtc = new Date().toISOString();
      // Explicit failed/null is only for synchronously completed in-process
      // operations with no subprocess exit; callers must not use it to recover
      // an unobserved or potentially live subprocess.
      record.status = outcome ?? (exitCode === 0 ? 'succeeded' : exitCode === null ? 'unknown' : 'failed');
      record.data = data; record.error = error;
      try { record.outputs = outputs.map(measure); }
      catch (failure) { record.status = 'invalid-output'; record.error = failure.message; save(); throw failure; }
      save(); return structuredClone(record);
      });
    },
    get snapshot() { refresh(); return structuredClone(state); },
  };
}
module.exports = {openPipelineState};
if (require.main === module) {
  try {
    const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const pipeline = openPipelineState(request);
    const result = request.action === 'snapshot' ? pipeline.snapshot : pipeline[request.action](request.name, request.options);
    // PowerShell's native-pipe decoder can inherit a legacy Windows codepage.
    // ASCII JSON preserves Unicode file identities across that boundary.
    process.stdout.write(JSON.stringify(result ?? null).replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')) + '\n');
  } catch (error) {
    const report = errorReport(error);
    process.stderr.write((report ? JSON.stringify(report) : error.message) + '\n');
    process.exitCode = report ? 3 : 1;
  }
}
