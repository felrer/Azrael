'use strict';
const crypto = require('node:crypto');
const TRANSPORT = 'node_modules/@oai/sky/dist/project/cua/sky_js/src/targets/windows/internal/computer_use_client.js';
const TRANSPORT_POLICY_MODULES = ['sky-control-policy.mjs', 'use-control-settings.mjs'].map(name => `${TRANSPORT.slice(0, TRANSPORT.lastIndexOf('/') + 1)}${name}`);
const SOURCE_SHA256 = 'f72d64c30dfad7f8894cf31bc92a982df46c7ef4ece82cf03a41aab514e80365';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const PREFIX = '/* azrael-sky-control-policy-v3 */import{assertComputerUseEnabled as azraelAssertCU}from"./sky-control-policy.mjs";const azraelSocketGenerations=new WeakMap;';
function generateSettingsModule(input) {
  const bytes = Buffer.from(input), source = bytes.toString('utf8').replace(/\r\n/g, '\n');
  const header = '"use strict";\nconst fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");\n';
  const tail = 'const registry = globalThis[Symbol.for("azrael.use-control.settings-owners.v1")] ??= new Map();\nfunction owner() { const home = require("./azrael-runtime.cjs").runtime.codexHome, key = path.resolve(home).toLowerCase(); if (!registry.has(key)) registry.set(key, createSettingsOwner(home)); return registry.get(key); }\nmodule.exports = { createSettingsOwner, getSettings: () => owner().getSettings(), updateSettings: (...args) => owner().updateSettings(...args), assertComputerUseEnabled: () => owner().assertComputerUseEnabled() };\n';
  if (!source.startsWith(header) || !source.endsWith(tail) || source.split(header).length !== 2 || source.split(tail).length !== 2) throw new Error('Unsupported settings owner module shape');
  const body = source.slice(header.length, -tail.length);
  for (const anchor of ['const DEFAULTS = ', 'function validate(state) {', 'function createSettingsOwner(codexHome) {']) if (body.split(anchor).length !== 2) throw new Error('Settings owner extraction anchor mismatch');
  if (/\brequire\s*\(|\bmodule\.exports\b/.test(body)) throw new Error('Unsupported settings owner factory dependency');
  const content = Buffer.from('/* Generated from use-control-settings.cjs; factory body is unchanged. */\nimport fs from "node:fs";\nimport path from "node:path";\nimport crypto from "node:crypto";\n' + body + 'export { createSettingsOwner };\n');
  return { content, transform: { kind: 'azrael-settings-owner-esm', version: 1, sourceSha256: hash(bytes), outputSha256: hash(content) } };
}
const replacements = [
  ['request(s,o,n={}){const l=', 'request(s,o,n={}){const azraelGeneration=azraelAssertCU();const l='],
  ['const t=yield i(this,h,"m",T).call(this);if(i(this,d,"f"))', 'const t=yield i(this,h,"m",T).call(this);azraelAssertCU(azraelGeneration);azraelSocketGenerations.set(t,azraelGeneration);if(i(this,d,"f"))'],
  ['U=function(t,e){const i=s.from(JSON.stringify(e),"utf8");', 'U=function(t,e){if(e.method==="request")azraelAssertCU(azraelSocketGenerations.get(t));else if(Object.hasOwn(e,"result")){try{azraelAssertCU(azraelSocketGenerations.get(t))}catch(azraelError){e={id:e.id,jsonrpc:"2.0",error:{code:-32000,message:azraelError.message}}}}const i=s.from(JSON.stringify(e),"utf8");'],
  ['r.writeUInt32LE(i.length,0),i.copy(r,4),t.write(r)', 'r.writeUInt32LE(i.length,0),i.copy(r,4);if(e.method==="request")azraelAssertCU(azraelSocketGenerations.get(t));else if(Object.hasOwn(e,"result")){try{azraelAssertCU(azraelSocketGenerations.get(t))}catch(azraelError){return U.call(this,t,{id:e.id,jsonrpc:"2.0",error:{code:-32000,message:azraelError.message}})}}t.write(r)'],
];
function transformTransport(input, version) {
  if (version !== '0.7.4') throw new Error('Unsupported Sky policy transport version');
  const original = Buffer.from(input).toString('utf8');
  let source = original;
  if (source.startsWith(PREFIX)) {
    source = source.slice(PREFIX.length);
    for (const [before, after] of replacements) {
      if (source.split(after).length !== 2) throw new Error('Invalid existing Sky policy transform');
      source = source.replace(after, before);
    }
  }
  if (hash(source) !== SOURCE_SHA256) throw new Error('Unsupported Sky policy transport source');
  let transformed = source;
  for (const [before, after] of replacements) {
    if (transformed.split(before).length !== 2) throw new Error('Sky policy transport anchor mismatch');
    transformed = transformed.replace(before, after);
  }
  const content = Buffer.from(PREFIX + transformed);
  if (original !== source && original !== content.toString('utf8')) throw new Error('Invalid existing Sky policy transform');
  return { content, transform: { kind: 'azrael-sky-control-policy', version: 3, packageVersion: version, sourceSha256: SOURCE_SHA256, outputSha256: hash(content) } };
}
module.exports = { TRANSPORT, TRANSPORT_POLICY_MODULES, SOURCE_SHA256, transformTransport, generateSettingsModule };
