'use strict';

// Edit the self-contained HTML; the README poster is exported from its inert source.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const directory = path.resolve(__dirname, '../docs/images');
const normalize = value => value.replace(/\r\n/g, '\n');
const source = normalize(fs.readFileSync(path.join(directory, 'window-use-cursor-ko.html'), 'utf8'));
const poster = source.match(/<script id="cursor-poster" type="application\/svg\+xml">\s*([\s\S]*?)\s*<\/script>/)?.[1];
assert.ok(poster, 'Missing canonical cursor poster source');
assert.ok(poster.startsWith('<svg '), 'Poster must be standalone SVG');
assert.ok(poster.includes('<title ') && poster.includes('<desc '), 'Missing accessible poster description');
assert.ok(!/<(?:foreignObject|script)\b/i.test(poster), 'Unsupported embedded poster content');

const svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + poster + '\n';
const destination = path.join(directory, 'window-use-cursor-ko.svg');
const check = process.argv.includes('--check');
if (check) {
  assert.equal(normalize(fs.readFileSync(destination, 'utf8')), svg, 'Cursor poster export is stale');
} else {
  fs.writeFileSync(destination, svg, 'utf8');
}
console.log(`${check ? 'Verified' : 'Exported'} window-use-cursor-ko.svg`);
