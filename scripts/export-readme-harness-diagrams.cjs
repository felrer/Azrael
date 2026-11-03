'use strict';

// Edit the standalone HTML; README exports contain exactly the same SVGs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const directory = path.resolve(__dirname, '../docs/images');
const source = fs.readFileSync(path.join(directory, 'harness-guide-ko.html'), 'utf8').replace(/\r\n/g, '\n');
const css = source.match(/<style id="diagram-styles">([\s\S]*?)<\/style>/)?.[1];
assert.ok(css, 'Missing shared diagram styles');
const expected = ['harness-flow-ko', 'execution-modes-ko', 'work-memory-ko', 'artifact-lifecycle-ko'];
const diagrams = [...source.matchAll(/<svg\b[^>]*\bid="((?:harness-flow|execution-modes|work-memory|artifact-lifecycle)-ko)"[\s\S]*?<\/svg>/g)];
assert.deepEqual(diagrams.map(match => match[1]), expected, 'Missing or reordered diagrams');
const check = process.argv.includes('--check');

for (const [markup, name] of diagrams) {
  assert.ok(markup.includes('<title '), `${name}: missing accessible title`);
  assert.ok(markup.includes('<desc '), `${name}: missing accessible description`);
  assert.ok(!/<(?:foreignObject|script)\b/i.test(markup), `${name}: unsupported embedded content`);
  const svg = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + markup.replace(/(<svg\b[^>]*>)/, `$1\n<style>${css}</style>`) + '\n';
  const destination = path.join(directory, `${name}.svg`);
  if (check) {
    assert.equal(fs.readFileSync(destination, 'utf8').replace(/\r\n/g, '\n'), svg, `${name}: export is stale`);
  } else {
    fs.writeFileSync(destination, svg, 'utf8');
  }
  console.log(`${check ? 'Verified' : 'Exported'} ${name}.svg`);
}
