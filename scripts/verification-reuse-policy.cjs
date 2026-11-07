'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Same bounded fixture-path contract as Get-LogicalBuildEnvironment in
// build-metrics.ps1. Only identity uses this view; execution keeps real paths.
function logicalBuildEnvironment(environment, ownership, projectRoot) {
  const logical = { ...environment };
  if (!ownership) return logical;
  const { pipelineRoot, sourceFixtureRoot } = ownership;
  if (![projectRoot, pipelineRoot, sourceFixtureRoot].every(value => typeof value === 'string' && path.isAbsolute(value))) {
    throw Error('Deployment fixture identity requires absolute owned paths');
  }
  if (path.dirname(path.resolve(pipelineRoot)) !== path.resolve(projectRoot, 'artifacts/logs') ||
      !path.basename(pipelineRoot).startsWith('deploy-') || path.basename(pipelineRoot).length <= 7) {
    throw Error('Deployment fixture identity is outside the project pipeline boundary');
  }
  const relative = path.relative(path.resolve(pipelineRoot), path.resolve(sourceFixtureRoot)).split(path.sep).join('/');
  if (!/^(source-fixtures|attempts\/[a-f0-9]{32}\/source-fixtures)$/.test(relative)) {
    throw Error('Deployment fixture identity is outside the expected pipeline attempt boundary');
  }
  const names = { AZRAEL_INSTRUCTION_TEST_ROOT: 'instructions', AZRAEL_CATALOG_TEST_ROOT: 'catalog',
    AZRAEL_MIGRATION_TEST_ROOT: 'migration', AZRAEL_WORKBENCH_TEST_ROOT: 'workbench' };
  for (const [key, name] of Object.entries(names)) {
    if (environment[key] === path.join(sourceFixtureRoot, name)) logical[key] = `<deployment-source-fixtures>/${name}`;
  }
  return logical;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(name => [name, canonical(value[name])]));
  return value;
}
const key = value => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');

function fieldKeys(value) {
  const fields = {};
  function visit(item, field) {
    if (item && typeof item === 'object' && Object.keys(item).length) {
      for (const name of Object.keys(item).sort()) visit(item[name], field ? `${field}.${name}` : name);
    } else fields[field || '$'] = key(item);
  }
  visit(value, '');
  return fields;
}

// Values may contain private environment settings. Report field names and
// fingerprints, never the settings themselves.
function differences(previous, current) {
  const result = [];
  function visit(before, after, field) {
    if (key(before) === key(after)) return;
    if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
      for (const name of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) visit(before[name], after[name], field ? `${field}.${name}` : name);
      return;
    }
    result.push({ field: field || '$', previousKey: key(before), currentKey: key(after) });
  }
  visit(previous, current, '');
  return result;
}

function validateDecisions(value) {
  const decisions = Array.isArray(value) ? value : value?.schema === 1 ? value.decisions : null;
  if (!Array.isArray(decisions)) throw Error('Reuse decisions require schema 1 and a decisions array.');
  const seen = new Set();
  for (const decision of decisions) {
    if (!decision || typeof decision.scope !== 'string' || !decision.scope.trim() ||
        !/^[a-f0-9]{64}$/.test(decision.reviewId || '') || !['reuse', 'rerun'].includes(decision.action) ||
        typeof decision.reason !== 'string' || !decision.reason.trim() || seen.has(decision.reviewId)) {
      throw Error('Each reuse decision requires a scope, unique review ID, reuse/rerun action and nonblank reason.');
    }
    seen.add(decision.reviewId);
  }
  return decisions;
}

function loadDecisions(filename) {
  if (filename === undefined || filename === null || filename === '') return [];
  if (!path.isAbsolute(filename)) throw Error('Reuse decision file must be absolute.');
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Reuse decision file must be a regular file.');
  return validateDecisions(JSON.parse(fs.readFileSync(filename, 'utf8')));
}

class ReuseReviewRequired extends Error {
  constructor(review) {
    super(`Verification reuse needs a model decision: ${review.scope}`);
    this.name = 'ReuseReviewRequired';
    this.code = 'VERIFICATION_REVIEW_REQUIRED';
    this.review = review;
  }
}

// Owners MUST validate the original successful outcome, required coverage,
// immutable evidence/output bytes and producer state before calling this policy.
// This helper decides relevance across input changes; it grants no permission to
// accept failed, missing, modified or unresolved evidence.
function reviewReuse({ scope, previous, current, evidence, decisions = [] }) {
  if (typeof scope !== 'string' || !scope.trim() || evidence === undefined) throw Error('Reuse review requires an explicit scope and validated evidence identity.');
  const previousKey = key(previous), currentKey = key(current);
  if (previousKey === currentKey) return { action: 'reuse', mode: 'exact' };
  const changes = differences(previous, current);
  const identity = { schema: 1, scope, previousKey, currentKey, evidenceKey: key(evidence) };
  const review = { ...identity, reviewId: key(identity), recommendation: 'rerun',
    differences: changes.slice(0, 128), differenceCount: changes.length };
  const choices = validateDecisions(decisions).filter(decision => decision.scope === scope);
  const choice = choices.find(decision => decision.reviewId === review.reviewId);
  if (!choice) {
    if (choices.length) {
      const error = new ReuseReviewRequired(review);
      error.message = `Reuse decision is stale for the selected candidate: ${scope}`;
      throw error;
    }
    throw new ReuseReviewRequired(review);
  }
  return { action: choice.action, mode: choice.action === 'reuse' ? 'reviewed' : 'rerun',
    decision: { scope, reviewId: choice.reviewId, action: choice.action, reason: choice.reason.trim() }, review };
}

function errorReport(error) {
  return error?.code === 'VERIFICATION_REVIEW_REQUIRED'
    ? { schema: 1, status: 'review-required', error: error.message, review: error.review }
    : null;
}

function reportCliError(error) {
  const report = errorReport(error);
  process.stderr.write((report ? JSON.stringify(report) : error.message) + '\n');
  process.exitCode = report ? 3 : 1;
}

module.exports = { canonical, key, fieldKeys, differences, validateDecisions, loadDecisions, reviewReuse, ReuseReviewRequired, errorReport, reportCliError, logicalBuildEnvironment };
