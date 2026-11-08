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
const PAYLOAD_BYTES = 64 * 1024;
const PAYLOAD_FORMAT = 'pipeline-payloads-v1';
const PAYLOAD_FIELDS = ['data', 'error', 'inputFieldKeys'];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sameIdentity = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink'].every(field => a[field] === b[field]);
function physical(file) {
  if (!path.isAbsolute(file) || file.includes('\0') || file.split(/[\\/]/).includes('..')) throw Error('Absolute pipeline payload path without traversal required.');
  let current = path.parse(file).root;
  for (const part of file.slice(current.length).split(path.sep).filter(Boolean)) {
    if (!fs.lstatSync(current).isDirectory()) throw Error('Pipeline payload ancestor must be a physical directory.');
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Pipeline payload path cannot be linked.');
  }
  return file;
}
function readPayload(file, reference) {
  physical(file);
  const before = fs.lstatSync(file, {bigint: true});
  if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(reference.bytes)) throw Error('Pipeline payload requires an unlinked regular file with matching bytes.');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    if (!sameIdentity(before, fs.fstatSync(descriptor, {bigint: true}))) throw Error('Pipeline payload identity changed while opening.');
    const bytes = fs.readFileSync(descriptor);
    if (!sameIdentity(before, fs.fstatSync(descriptor, {bigint: true})) || !sameIdentity(before, fs.lstatSync(physical(file), {bigint: true})) || bytes.length !== reference.bytes || digest(bytes) !== reference.sha256) throw Error('Pipeline payload identity or SHA-256 changed.');
    return bytes;
  } finally { fs.closeSync(descriptor); }
}
function payloadStore(file) {
  const directory = `${file}.payloads`;
  function resolve(reference) {
    if (!reference || Object.keys(reference).sort().join(',') !== 'bytes,sha256' || !/^[a-f0-9]{64}$/.test(reference.sha256) || !Number.isSafeInteger(reference.bytes) || reference.bytes < PAYLOAD_BYTES) throw Error('Invalid pipeline payload reference.');
    return path.join(directory, `${reference.sha256}.json`);
  }
  function publish(value) {
    const bytes = Buffer.from(JSON.stringify(canonical(value)));
    if (bytes.length < PAYLOAD_BYTES) return null;
    const reference = {sha256: digest(bytes), bytes: bytes.length};
    physical(path.dirname(directory));
    try { fs.mkdirSync(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (!fs.lstatSync(physical(directory)).isDirectory()) throw Error('Pipeline payload root must be a physical directory.');
    const target = resolve(reference);
    try { fs.lstatSync(target); readPayload(target, reference); return reference; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = `${target}.tmp`;
    const descriptor = fs.openSync(temporary, 'wx');
    let owned;
    try {
      try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); owned = fs.fstatSync(descriptor, {bigint: true}); }
      finally { fs.closeSync(descriptor); }
      // link is the platform's atomic create-if-absent publication. Remove the
      // private name before accepting the final unlinked physical file. A crash
      // leaving two names is rejected on resume, never silently repaired.
      physical(directory);
      if (!sameIdentity(owned, fs.lstatSync(physical(temporary), {bigint: true}))) throw Error('Pipeline payload temporary identity changed.');
      fs.linkSync(temporary, target);
    } finally {
      if (owned) {
        const current = fs.lstatSync(physical(temporary), {bigint: true});
        // Publication changes ctime and nlink, but not the private inode/data.
        if (['dev', 'ino', 'size', 'mtimeNs'].some(field => owned[field] !== current[field])) throw Error('Pipeline payload temporary identity changed; preserve unresolved ownership.');
        fs.unlinkSync(temporary);
      }
    }
    readPayload(target, reference);
    return reference;
  }
  return {
    directory,
    encode(state) {
      const stored = {...state, schema: 2, storageFormat: PAYLOAD_FORMAT, stages: {}};
      for (const [name, attempts] of Object.entries(state.stages)) stored.stages[name] = attempts.map(record => {
        const result = {...record}, payloadRefs = {};
        // Keep varying timing/process metadata inline while sharing large
        // stdout, stderr or receipt values across otherwise different results.
        // These descriptors name literal data properties, never file paths.
        if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
          const inline = [], references = [];
          for (const [field, value] of Object.entries(record.data)) {
            const reference = value === undefined ? null : publish(value);
            if (reference) references.push([field, reference]);
            else inline.push([field, value]);
          }
          if (references.length) {
            result.data = Object.fromEntries(inline);
            result.dataFieldRefs = Object.fromEntries(references);
          }
        }
        for (const field of PAYLOAD_FIELDS) if (Object.hasOwn(result, field) && result[field] !== undefined) {
          const reference = publish(result[field]);
          if (reference) { payloadRefs[field] = reference; delete result[field]; }
        }
        if (Object.keys(payloadRefs).length) result.payloadRefs = payloadRefs;
        return result;
      });
      return stored;
    },
    decode(stored) {
      if (stored.schema === 1) return stored;
      if (stored.schema !== 2 || stored.storageFormat !== PAYLOAD_FORMAT) throw Error('Unsupported pipeline storage format.');
      const {storageFormat, ...state} = stored;
      state.schema = 1;
      state.stages = Object.fromEntries(Object.entries(stored.stages).map(([name, attempts]) => [name, attempts.map(record => {
        const {payloadRefs, dataFieldRefs, ...result} = record;
        if (payloadRefs !== undefined) {
          if (!payloadRefs || typeof payloadRefs !== 'object' || Array.isArray(payloadRefs)) throw Error('Invalid pipeline payload references.');
          for (const [field, reference] of Object.entries(payloadRefs)) {
            if (!PAYLOAD_FIELDS.includes(field) || Object.hasOwn(result, field)) throw Error('Invalid pipeline payload field.');
            result[field] = JSON.parse(readPayload(resolve(reference), reference).toString('utf8'));
          }
        }
        if (dataFieldRefs !== undefined) {
          if (!dataFieldRefs || typeof dataFieldRefs !== 'object' || Array.isArray(dataFieldRefs) || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw Error('Invalid pipeline data field references.');
          for (const [field, reference] of Object.entries(dataFieldRefs)) {
            if (Object.hasOwn(result.data, field)) throw Error('Duplicate pipeline data field.');
            Object.defineProperty(result.data, field, {value: JSON.parse(readPayload(resolve(reference), reference).toString('utf8')), enumerable: true, writable: true, configurable: true});
          }
        }
        return result;
      })]));
      return state;
    },
  };
}
function measure(file) {
  const absolute = path.resolve(typeof file === 'string' ? file : file.path);
  const stat = fs.lstatSync(absolute, {bigint: true});
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`Pipeline output must be an explicit regular file: ${absolute}`);
  return {path: absolute, size: String(stat.size), sha256: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')};
}

// The caller holds its existing long-lived exclusive owner lease. The short
// metadata update lock below serializes authorized parent/child reads and writes;
// neither lock permits stale-owner recovery here. The state file, its sibling
// update-lock, payload sibling root and atomic temporary files belong to the
// caller's output owner. Payload files remain referenced by retained attempts;
// this writer never prunes execution history or collects payloads independently.
function withPipelineStateLock(file, operation) {
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
  try { return operation(); }
  finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
}
function openPipelineState({file, identity, resume = false, lockHeld = false, reuseDecisionsPath}) {
  if (!lockHeld) throw Error('Pipeline state requires the caller\'s exclusive owner lease.');
  file = path.resolve(file);
  const payloads = payloadStore(file);
  const decisions = loadDecisions(reuseDecisionsPath);
  if (resume && !fs.existsSync(file)) throw Error('Resume requires an existing pipeline state.');
  if (!resume) fs.mkdirSync(path.dirname(file), {recursive: true});
  let state;
  const save = () => {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temporary = `${file}.tmp`;
    let created = false;
    try {
      const descriptor = fs.openSync(temporary, 'wx');
      created = true;
      try { fs.writeFileSync(descriptor, JSON.stringify(payloads.encode(state), null, 2) + '\n'); }
      finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, file);
    } finally { if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  };
  withPipelineStateLock(file, () => {
    const exists = fs.existsSync(file);
    if (exists && !resume) throw Error('Pipeline state already exists; explicit resume is required.');
    if (!exists && resume) throw Error('Resume requires an existing pipeline state.');
    state = exists ? payloads.decode(JSON.parse(fs.readFileSync(file, 'utf8'))) : {schema: 1, identity: canonical(identity), stages: {}};
    if (state.schema !== 1 || key(state.identity) !== key(identity)) throw Error('Pipeline identity changed; select a new frozen work identity.');
    if (!exists) save();
  });
  const refresh = () => {
    state = payloads.decode(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (state.schema !== 1 || key(state.identity) !== key(identity)) throw Error('Pipeline identity changed during observation.');
  };
  function update(operation) {
    // A deployment parent and its build child share the long-lived work lease.
    // Serialize their short metadata updates and reload after acquisition so
    // neither can overwrite a concurrently completed independent stage.
    return withPipelineStateLock(file, () => {
      refresh();
      return operation();
    });
  }
  function current(name) { return state.stages[name]?.at(-1); }
  function recoveryEvidence(request) {
    if (request.producer_stopped_verified !== true || typeof request.reason !== 'string' || !request.reason.trim()) throw Error('Pipeline recovery requires verified producer stop and a nonblank reason.');
    const evidence = request.evidence_ref;
    if (typeof evidence !== 'string' || !path.isAbsolute(evidence) || evidence.split(/[\\/]/).includes('..') || !/^[a-f0-9]{64}$/.test(request.evidence_sha256 || '')) throw Error('Pipeline recovery requires absolute evidence without traversal and its SHA-256.');
    const inside = (parent, child) => { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
    const protectedPaths = [file, `${file}.update-lock`, `${file}.tmp`, payloads.directory, ...Object.values(state.stages).flatMap(attempts => attempts.flatMap(record => record.outputs.map(output => output.path)))];
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
    get snapshot() { return update(() => structuredClone(state)); },
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
