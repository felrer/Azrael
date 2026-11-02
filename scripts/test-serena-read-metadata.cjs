'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { describeSymbols } = require('./serena-read-metadata.cjs');
const ts = require(process.env.SERENA_TYPESCRIPT_MODULE || 'typescript');

// Retained to catch future range/printing simplifications that leak bodies, confuse
// duplicate exports, miscount UTF-16, or replace source evidence with inferred prose.
function range(source, text, name = text, occurrence = 0) {
  let offset = -1;
  for (let i = 0; i <= occurrence; i++) offset = source.indexOf(text, offset + 1);
  assert.ok(offset >= 0, 'fixture span exists');
  const position = at => {
    const lines = source.slice(0, at).split('\n');
    return { line: lines.length - 1, character: lines.at(-1).length };
  };
  return { name, kind: 12, start: position(offset), end: position(offset + text.length) };
}
const describe = (source, spans, fileName = 'fixture.ts') =>
  describeSymbols({ source, fileName, symbols: spans.map(s => typeof s === 'string' ? range(source, s) : s) }, ts);

test('source signatures preserve declared types/destructuring and omit implementations', () => {
  const source = `/** Adds values from the supplied pair. */
export function sum({ left, right }: { left: number; right: number }): number { return left + right; }
const arrow = async ({ value }: { value: string }): Promise<string> => value + "{ }";
class Box extends Base { constructor(public size: number) { super(); } method(x = "{"): string { return x; } }
let untyped = 3;`;
  const [fn, arrow, box, ctor, method, variable] = describe(source, [
    'export function sum({ left, right }: { left: number; right: number }): number { return left + right; }',
    'arrow = async ({ value }: { value: string }): Promise<string> => value + "{ }"',
    'class Box extends Base { constructor(public size: number) { super(); } method(x = "{"): string { return x; } }',
    'constructor(public size: number) { super(); }', 'method(x = "{"): string { return x; }', 'untyped = 3'
  ]);
  assert.equal(fn.signature, 'export function sum({ left, right }: { left: number; right: number }): number');
  assert.equal(fn.description, 'Adds values from the supplied pair.');
  assert.equal(fn.description_source, 'jsdoc');
  assert.equal(arrow.signature, 'arrow = async ({ value }: { value: string }): Promise<string> =>');
  assert.equal(box.signature, 'class Box extends Base');
  assert.equal(ctor.signature, 'constructor(public size: number)');
  assert.equal(method.signature, 'method(x = "{"): string');
  assert.equal(variable.signature, 'let untyped');
  assert.equal(variable.description, '');
  assert.equal(variable.description_source, 'none');
});

test('actual comments take precedence; callbacks use their source test title', () => {
  const callback = 'async () => { await run(); }';
  const source = `// Reads the current record.\nconst read = () => store.read();\ntest("handles braces { safely }", ${callback});`;
  const [read, cb] = describe(source, ['read = () => store.read()', range(source, callback, 'test("handles braces { safely }") callback')]);
  assert.equal(read.description, 'Reads the current record.');
  assert.equal(read.description_source, 'comment');
  assert.equal(cb.signature, 'async () =>');
  assert.equal(cb.description, 'Test title: handles braces { safely }');
  assert.equal(cb.description_source, 'test_title');
});

test('whole variable statement ranges and literal whitespace preserve source meaning', () => {
  const declaration = 'const spaced = (value = "a  b", pattern = /a  b/) => value;';
  const [result] = describe(declaration, [declaration]);
  assert.equal(result.signature, 'spaced = (value = "a  b", pattern = /a  b/) =>');
});

test('structural metadata reports observed calls, properties and returned keys', () => {
  const fn = 'function collect(input) { const text = input.value.trim(); return { text, count: input.count }; }';
  const [result] = describe(fn, [fn]);
  assert.equal(result.description_source, 'structure');
  assert.match(result.description, /^Observed:/);
  assert.match(result.description, /calls trim/);
  assert.match(result.description, /property accesses value, count/);
  assert.match(result.description, /returns keys text, count/);
});

test('compact structure prioritizes returned keys and does not attach file banners to imports', () => {
  const binding = 'const fs = require("node:fs").promises';
  const fn = 'function gauge(input) { const data = input.rows.filter("argument text must stay out").map(transform).flat().sort().slice().join(); return { total: data.length, active: input.active }; }';
  const source = '/** Experimental gauge reader for the whole file. */\n' + binding + ';\n' + fn;
  const [imported, gauge] = describe(source, [binding, fn]);
  assert.equal(imported.description_source, 'structure');
  assert.equal(imported.description, 'Observed: calls require; property accesses promises');
  assert.equal(gauge.description_source, 'structure');
  assert.match(gauge.description, /^Observed: returns keys total, active; calls /);
  assert.match(gauge.description, /join, slice, sort, flat, … \(\+2\)/);
  assert.doesNotMatch(gauge.description, /argument text|\.filter\(|\.map\(/);
  assert.equal(gauge.description_truncated, true);
  assert.ok(gauge.description.length <= 240);
});

test('UTF-16 positions and duplicate exports resolve distinct semantic declarations', () => {
  const source = 'const emoji = "😀"; function read(value) { return value.path; }\nmodule.exports = { read: function read(value) { return value.other; }, readAlias: read };';
  const [declaration, exported, alias, nameOnly] = describe(source, [
    'function read(value) { return value.path; }',
    'read: function read(value) { return value.other; }',
    'readAlias: read', range(source, 'read', 'read', 0)
  ], 'fixture.cjs');
  assert.equal(declaration.signature, 'function read(value)');
  assert.match(declaration.description, /property accesses path/);
  assert.equal(exported.signature, 'read: function read(value)');
  assert.match(exported.description, /property accesses other/);
  assert.equal(alias.signature, 'readAlias: read');
  assert.equal(nameOnly.signature, declaration.signature);
});

test('shortening is bounded and explicitly flagged, invalid ranges remain empty', () => {
  const source = `/** ${'long documentation '.repeat(30)} */\nfunction long(${Array.from({ length: 40 }, (_, i) => 'parameter' + i + ': string').join(', ')}) { return 1; }`;
  const [result, missing] = describe(source, [range(source, source.slice(source.indexOf('function'))),
    { name: 'missing', start: { line: 99, character: 0 }, end: { line: 99, character: 1 } }]);
  assert.equal(result.signature_truncated, true);
  assert.equal(result.description_truncated, true);
  assert.equal(Array.from(result.signature).length, 240);
  assert.equal(Array.from(result.description).length, 240);
  assert.deepEqual(missing, { signature: '', description: '', description_source: 'none' });
});

test('batch parses once and CLI emits the aligned JSON array', () => {
  const source = 'function first() {}\nfunction second() {}';
  const input = { source, fileName: 'fixture.js', symbols: [range(source, 'first'), range(source, 'second')] };
  let parses = 0;
  const wrapped = Object.create(ts);
  Object.defineProperty(wrapped, 'createSourceFile', { value(...args) { parses++; return ts.createSourceFile(...args); } });
  const expected = describeSymbols(input, wrapped);
  assert.equal(parses, 1);
  const child = spawnSync(process.execPath, [require.resolve('./serena-read-metadata.cjs')], {
    input: JSON.stringify(input), encoding: 'utf8', env: process.env
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  assert.deepEqual(JSON.parse(child.stdout), expected);
  assert.deepEqual(expected.map(x => x.signature), ['function first()', 'function second()']);
});
