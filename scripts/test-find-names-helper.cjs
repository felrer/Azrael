// Retained: direct contracts that future parser/packaging simplifications could omit.
'use strict';
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const ts = require('../extensions/azrael-ex/node_modules/typescript');
const {createSearch} = require('./find-names-helper.cjs');
const search = createSearch(ts).findNames;
const source = `import {widthImport} from 'missing-module';
interface WidthInterface { widthSignature(): void }
const widthConfig = { width: 120, widthMethod() {}, arrowWidth: () => 0 };
function scopeWidth(widthParam: string): ReturnSecret { throw 'bodySecret' }
class WidthBox {
  widthField = 1;
  arrowWidth = (value: number = 1): number => value;
  unrelated() { const widthLocal = 1; function nestedWidth() {} }
}
function Straße() {}
function Σςσ() {}
function ﬃ() {}
`;
const request = {filename: 'nested/sample.ts', source, query: ' width '};
const expected = [
  ['scopeWidth', 4, 4], ['WidthBox', 5, 9], ['WidthBox/arrowWidth', 7, 7],
  ['WidthBox/unrelated/nestedWidth', 8, 8], ['widthConfig', 3, 3],
  ['widthConfig/arrowWidth', 3, 3], ['widthConfig/widthMethod', 3, 3],
];
assert.deepEqual(search(request), expected);
assert.deepEqual(search({...request, query: 'WIDTH', include_signature: false}), expected);
assert.deepEqual(search({...request, query: 'arrowWidth', include_signature: true}), [
  ['WidthBox/arrowWidth', 7, 7, '(value: number = 1): number'],
  ['widthConfig/arrowWidth', 3, 3, '()'],
]);
for (const query of ['bodySecret', 'ReturnSecret', 'widthParam', 'widthImport', 'WidthInterface', 'widthField', 'widthLocal', '.*']) {
  assert.deepEqual(search({...request, query}), []);
}
for (const [query, name, line] of [['STRASSE', 'Straße', 10], ['σσσ', 'Σςσ', 11], ['FFI', 'ﬃ', 12]]) {
  assert.deepEqual(search({...request, query}), [[name, line, line]]);
}
assert.deepEqual(search({...request, query: '\u001cSTRASSE\u0085'}), [['Straße', 10, 10]]);
assert.deepEqual(search({...request, query: '\ufeffSTRASSE'}), []);
for (const query of ['', ' \n', '\u001c\u0085', null, 1]) assert.throws(() => search({...request, query}));
for (const include_signature of [null, 0, 1, 'true', [], {}]) assert.throws(() => search({...request, include_signature}));
for (const filename of ['../sample.ts', '/sample.ts', 'C:\\sample.ts', 'sample.py']) assert.throws(() => search({...request, filename}));
for (const extension of ['js', 'jsx', 'cjs', 'mjs', 'ts', 'tsx', 'cts', 'mts']) {
  assert.deepEqual(search({filename: `sample.${extension}`, source: 'const target = () => 1;', query: 'target'}), [['target', 1, 1]]);
}
// Retain the actual-provider overload conversion contract: all spans count in IDs,
// even when signature-only declarations are excluded by the name-target filter.
const edgeSource = `export class Box {
  get width(): number { return 1; }
  set width(value: number) { void value; }
  method(x: string): string;
  method(x: number): number;
  method(x: string | number): string | number { return x; }
  constructor() {}
}
export function overload(x: string): string;
export function overload(x: number): number;
export function overload(x: string | number): string | number { return x; }
`;
const edge = query => search({filename: 'edge.ts', source: edgeSource, query, include_signature: true});
assert.deepEqual(edge('width'), [['Box/width[0]', 2, 2, 'get (): number'],
  ['Box/width[1]', 3, 3, 'set (value: number)']]);
assert.deepEqual(edge('method'), [['Box/method[2]', 6, 6, '(x: string | number): string | number']]);
// Preserve v5's observed exported-overload selection-coordinate limitation.
assert.deepEqual(edge('overload'), []);
const cli = input => spawnSync(process.execPath, ['-e',
  "require('./scripts/find-names-helper.cjs').runCli(require('./extensions/azrael-ex/node_modules/typescript'))"],
{cwd: path.resolve(__dirname, '..'), input, encoding: 'utf8', env: process.env});
let result = cli(JSON.stringify({...request, query: 'STRASSE'}));
assert.equal(result.status, 0);
assert.equal(result.stderr, '');
assert.deepEqual(JSON.parse(result.stdout), [['Straße', 10, 10]]);
for (const input of ['{sourceSecret', JSON.stringify({...request, query: '', source: 'sourceSecret'})]) {
  result = cli(input);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Declaration-name search failed\n');
}
console.log('PASS declaration selection, Unicode casefold, ranges, signatures, 8 extensions, CLI success/errors');
