'use strict';
// Ordinary-token, closure-only entry point. Product cleanup policy stays in resources.
const fs = require('node:fs/promises');
const path = require('node:path');
const IDENTITY_KEYS = ['sid','profile','parentSessionId','childSessionId','workerPid','workerCreated','sessionAnchorPid','sessionAnchorCreated'];
const UNSAFE_FLAGS = ['pendingWork','directUser','unsavedWork','unknownState','unrelatedApps','pendingUserDecision','heldInput'];
function validateIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== IDENTITY_KEYS.length || IDENTITY_KEYS.some(k => !Object.hasOwn(value,k))) throw new Error('Exact closure identity required');
  for (const k of ['sid','profile','workerCreated','sessionAnchorCreated']) if (typeof value[k] !== 'string' || !value[k] || value[k].length > 2048 || /[\x00-\x1f]/.test(value[k])) throw new Error('Invalid identity field');
  if (!/^S-1-\d+(?:-\d+)+$/.test(value.sid) || !path.win32.isAbsolute(value.profile)) throw new Error('Invalid Windows identity');
  for (const k of ['parentSessionId','childSessionId','workerPid','sessionAnchorPid']) if (!Number.isSafeInteger(value[k]) || value[k] < (k === 'parentSessionId' ? 0 : 1)) throw new Error('Invalid identity number');
  if (value.parentSessionId === value.childSessionId) throw new Error('Parent session cannot be targeted');
  return value;
}
const sameIdentity = (a,b) => { try { validateIdentity(a); validateIdentity(b); return IDENTITY_KEYS.every(k => a[k] === b[k]); } catch { return false; } };
async function safePath(file, { directory = false } = {}) {
  if (!path.isAbsolute(file) || /[\x00-\x1f"]/.test(file)) throw new Error('Absolute safe path required');
  const resolved = path.resolve(file), root = path.parse(resolved).root;
  let current = root;
  for (const part of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current,part); const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (current !== resolved && !stat.isDirectory())) throw new Error('Reparse or invalid path ancestry');
    if (current === resolved && (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw new Error('Invalid path type');
  }
  return resolved;
}
async function boundedJson(file, limit) { await safePath(file); const stat = await fs.stat(file); if (stat.size > limit) throw new Error('Bounded JSON exceeded'); return JSON.parse(await fs.readFile(file,'utf8')); }
function validateOptions(options) {
  if (!options || !path.isAbsolute(options.stateRoot || '') || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(options.resourceId || '') || !path.isAbsolute(options.nativeHelperPath || '') || !/^[a-fA-F0-9]{64}$/.test(options.nativeHelperSha256 || '')) throw new Error('Explicit state root, resource ID and pinned helper required');
  if (path.resolve(options.stateRoot) === path.parse(path.resolve(options.stateRoot)).root || [process.env.USERPROFILE,require('node:os').homedir()].filter(Boolean).some(p => path.resolve(p).toLowerCase() === path.resolve(options.stateRoot).toLowerCase())) throw new Error('Dedicated StateRoot required');
}
function createSessionCleanup(dependencies = {}) {
  const managerFactory = dependencies.managerFactory || (options => require('./window-child-session.cjs').createWindowsChildSessionManager(options));
  const resourceFactory = dependencies.resourceFactory || require('./window-use-resources.cjs').createResourceManager;
  async function inspect(options) {
    validateOptions(options); await safePath(options.stateRoot,{directory:true}); await safePath(options.nativeHelperPath);
    const hash = require('node:crypto').createHash('sha256').update(await fs.readFile(options.nativeHelperPath)).digest('hex');
    if (hash !== options.nativeHelperSha256.toLowerCase()) throw new Error('Pinned helper hash mismatch');
    const directory = path.join(options.stateRoot,'azrael','window-use','resources');
    const manifest = await boundedJson(path.join(directory,'management','resources.json'),8*1024*1024);
    if (manifest.schema !== 1 || !Array.isArray(manifest.records)) throw new Error('Invalid resource manifest');
    const matches = manifest.records.filter(r => r.id === options.resourceId);
    if (matches.length !== 1 || matches[0].kind !== 'session') throw new Error('Exact registered session required');
    const identity = validateIdentity(matches[0].identity);
    if (options.identity && !sameIdentity(options.identity,identity)) throw new Error('Registered identity mismatch');
    const remainingPaths = manifest.records.filter(r => r.kind === 'generated' && Array.isArray(r.sessionIds) && r.sessionIds.includes(options.resourceId)).map(r => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(r.id || '')) throw new Error('Unsafe registered payload ID');
      return path.join(directory,'payload',r.id);
    });
    return { schemaVersion:1,resourceId:options.resourceId,identity,directory,remainingPaths };
  }
  async function finalize(options) {
    validateIdentity(options.identity);
    const selected = await inspect(options);
    const manager = managerFactory({nativeHelper:{path:options.nativeHelperPath,sha256:options.nativeHelperSha256}});
    const proof = await manager.inspectClosure(selected.identity);
    if (!proof || proof.state !== 'closed' || proof.ownershipVerified !== true || proof.logoffConfirmed !== true || proof.processesStopped !== true || !sameIdentity(proof.identity,selected.identity) || UNSAFE_FLAGS.some(k=>proof[k] !== false)) return {logoffConfirmed:false,filesCleanupState:'deferred',remainingPaths:selected.remainingPaths,code:'closure_unconfirmed'};
    const resources = resourceFactory({directory:selected.directory,inspectSession:identity => manager.inspectClosure(identity)});
    const cleanup = await resources.cleanup({ids:[selected.resourceId],reason:'explicit administrator logoff; exact closure verified'});
    const results = cleanup.results || [];
    const complete = results.length > 0 && results.every(r => r.state === 'deleted');
    const remainingPaths = results.flatMap(r=>r.remainingPaths || []);
    if (!complete) {
      const status = await resources.inspect();
      const retained = new Set(results.filter(r=>r.state !== 'deleted').flatMap(r=>r.ids || []));
      for (const resource of status.resources || []) if (retained.has(resource.id) && resource.path) remainingPaths.push(resource.path);
    }
    return {logoffConfirmed:true,filesCleanupState:complete?'complete':results.some(r => r.state === 'failed')?'partial':'deferred',remainingPaths:[...new Set(remainingPaths)],results};
  }
  return {inspect,finalize};
}
function parseArgs(args) {
  const command = args[0]; if (!['inspect','finalize'].includes(command) || args.length % 2 !== 1) throw new Error('Use inspect|finalize with explicit named options');
  const names = {'--state-root':'stateRoot','--resource-id':'resourceId','--native-helper-path':'nativeHelperPath','--native-helper-sha256':'nativeHelperSha256','--request-file':'requestFile'}, options = {};
  for(let i=1;i<args.length;i+=2) { const name=names[args[i]]; if (!name || Object.hasOwn(options,name) || !args[i+1]) throw new Error('Unknown, duplicate or missing option'); options[name]=args[i+1]; }
  validateOptions(options); if ((command === 'finalize') !== Boolean(options.requestFile)) throw new Error('Finalize requires exact request file');
  return {command,options};
}
async function main(args) {
  if (process.platform !== 'win32') throw new Error('Child-session cleanup requires local Windows');
  const {command,options}=parseArgs(args);
  if (options.requestFile) { const request=await boundedJson(options.requestFile,16384); if (request.resourceId !== options.resourceId || request.stateRoot !== options.stateRoot || request.nativeHelperPath !== options.nativeHelperPath || request.nativeHelperSha256 !== options.nativeHelperSha256) throw new Error('Request options mismatch'); options.identity=validateIdentity(request.identity); }
  return createSessionCleanup()[command](options);
}
module.exports={createSessionCleanup,validateIdentity,sameIdentity,safePath,parseArgs,main};
if(require.main===module) main(process.argv.slice(2)).then(result=>{process.stdout.write(JSON.stringify(result)+'\n'); if(result.filesCleanupState && result.filesCleanupState !== 'complete') process.exitCode=2;},error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
