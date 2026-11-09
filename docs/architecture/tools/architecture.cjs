#!/usr/bin/env node
'use strict';

// Deliberately limited Markdown: ATX headings, fenced blocks, HTML id/name
// anchors and inline Markdown links. No HTML execution, plugins or network I/O.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const normalize = value => String(value).normalize('NFKC').toLowerCase();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const slash = value => value.split(path.sep).join('/');

function rootPath(root) {
  const absolute = path.resolve(root);
  if (!fs.statSync(absolute).isDirectory()) fail('INVALID_ROOT', 'Root must be a directory');
  // The selected root is canonical; links below that boundary are never followed.
  return fs.realpathSync(absolute);
}

function safePath(root, relative, { allowMissing = false } = {}) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') ||
      path.isAbsolute(relative) || /^[a-z]:|^[/\\]|^[a-z][a-z\d+.-]*:/i.test(relative)) {
    fail('UNSAFE_PATH', `Expected a repository-relative path: ${relative}`);
  }
  const parts = relative.replace(/\\/g, '/').split('/');
  if (parts.some(part => part === '..')) fail('UNSAFE_PATH', `Traversal is forbidden: ${relative}`);
  let current = root;
  for (const part of parts.filter(part => part && part !== '.')) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) fail('UNSAFE_PATH', `Linked input is forbidden: ${relative}`);
    } catch (error) {
      if (allowMissing && error.code === 'ENOENT') return current === root ? root : path.resolve(root, ...parts);
      throw error;
    }
  }
  if (current !== root && !current.startsWith(root + path.sep)) fail('UNSAFE_PATH', `Outside root: ${relative}`);
  return current;
}

function readStable(root, relative, observations) {
  const absolute = safePath(root, relative);
  const before = fs.statSync(absolute, { bigint: true });
  if (!before.isFile()) fail('INVALID_INPUT', `Expected file: ${relative}`);
  const content = fs.readFileSync(absolute, 'utf8');
  const after = fs.statSync(safePath(root, relative), { bigint: true });
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
    fail('INPUT_CHANGED', `Input changed during read: ${relative}`);
  }
  observations?.push({ file: relative, sha: digest(content), stat: after });
  return content;
}

function verifyObservations(index) {
  for (const observation of index.observations) {
    let content;
    try { content = readStable(index.root, observation.file); }
    catch (error) { fail('INPUT_CHANGED', `Input unavailable or changed: ${observation.file} (${error.code})`); }
    const stat = fs.statSync(safePath(index.root, observation.file), { bigint: true });
    if (digest(content) !== observation.sha || stat.ino !== observation.stat.ino || stat.ctimeNs !== observation.stat.ctimeNs) {
      fail('INPUT_CHANGED', `Input changed: ${observation.file}`);
    }
  }
  const files = architectureFiles(index.root);
  if (JSON.stringify(files) !== JSON.stringify(index.files)) fail('INPUT_CHANGED', 'Architecture file membership changed');
}

function visibleLines(text) {
  let fence = null;
  return text.split(/\r?\n/).map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return '';
    }
    if (marker) { fence = { character: marker[1][0], length: marker[1].length }; return ''; }
    return line;
  });
}

function slug(text) {
  return text.replace(/<[^>]*>/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '').normalize('NFC').toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
}

function declaredState(lines, offset) {
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:Status|State|(?:문서\s+)?상태)(?:\*\*)?\s*:\s*(.*)/i.exec(lines[i]);
    if (!match) continue;
    const value = match[1];
    const token = /(?:^|[^\p{L}])(current|partial|target|draft|reference(?:-candidates)?|historical|현재|부분|목표|초안|참고)(?=$|[^\p{L}])/iu.exec(value);
    const map = { 현재: 'current', 부분: 'partial', 목표: 'target', 초안: 'draft', 참고: 'reference', historical: 'reference', 'reference-candidates': 'reference' };
    return { value: token ? (map[token[1].toLowerCase()] || token[1].toLowerCase()) : 'unknown',
      declaration: value, line: offset + i, provenance: 'declared' };
  }
  return null;
}

function parseDocument(file, text) {
  const lines = text.split(/\r?\n/);
  const sourceLines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const visible = visibleLines(text);
  const headings = [];
  const counts = new Map([['preamble', 0]]);
  for (let i = 0; i < visible.length; i++) {
    const match = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/.exec(visible[i]);
    if (!match) continue;
    const title = match[2].trim();
    const base = slug(title) || 'section';
    let anchor = base;
    while (counts.has(anchor)) anchor = `${base}-${(counts.get(base) || 0) + 1}`, counts.set(base, (counts.get(base) || 0) + 1);
    counts.set(anchor, counts.get(anchor) || 0);
    headings.push({ headingLine: i + 1, level: match[1].length, title, anchor });
  }
  const starts = [{ headingLine: 0, level: 0, title: '(preamble)', anchor: 'preamble' }, ...headings];
  const sections = [];
  const stack = [];
  for (let i = 0; i < starts.length; i++) {
    const heading = starts[i];
    const start = heading.headingLine + 1;
    const end = (starts[i + 1]?.headingLine || lines.length + 1) - 1;
    while (stack.length && stack.at(-1).level >= heading.level) stack.pop();
    const parent = stack.at(-1);
    const ownState = declaredState(visible.slice(start - 1, end), start);
    const state = ownState ? { ...ownState, source: `${file}#${heading.anchor}` }
      : parent ? { ...parent.state, provenance: parent.state.value === 'unknown' && !parent.state.source ? 'unknown' : 'inherited' }
        : { value: 'unknown', provenance: 'unknown' };
    const body = sourceLines.slice(start - 1, end).join('');
    const section = { id: `${file}#${heading.anchor}`, file, ...heading, startLine: start, endLine: end,
      parents: stack.map(item => ({ id: item.id, title: item.title })), parent: parent?.id || null,
      state, body, visible: visible.slice(start - 1, end).join('\n'), children: [], anchors: [heading.anchor] };
    section.sha = digest(JSON.stringify([heading.title, body, section.parents, state]));
    if (parent) parent.children.push({ id: section.id, title: section.title, headingLine: section.headingLine });
    sections.push(section);
    stack.push(section);
  }
  // Explicit anchors on an otherwise empty line immediately before a heading
  // belong to that heading; other anchors belong to their direct section.
  const anchors = new Map();
  for (const section of sections) anchors.set(section.anchor, section.id);
  const duplicateAnchors = [];
  for (let i = 0; i < visible.length; i++) {
    for (const match of visible[i].matchAll(/<a\s+[^>]*?(?:id|name)\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
      let next = i + 1;
      while (next < visible.length && !visible[next].trim()) next++;
      const heading = sections.find(section => section.headingLine === next + 1);
      const owner = heading || sections.find(section => section.startLine <= i + 1 && section.endLine >= i + 1);
      if (!owner) continue;
      if (anchors.has(match[1]) && anchors.get(match[1]) !== owner.id) duplicateAnchors.push({ anchor: match[1], line: i + 1 });
      else { anchors.set(match[1], owner.id); if (!owner.anchors.includes(match[1])) owner.anchors.push(match[1]); }
    }
  }
  return { file, sections, anchors, duplicateAnchors, visible };
}

function architectureFiles(root) {
  const directory = safePath(root, 'docs/architecture');
  return fs.readdirSync(directory).filter(name => name.endsWith('.md')).sort()
    .map(name => { const file = `docs/architecture/${name}`; safePath(root, file); return file; });
}

function validateTerms(terms) {
  if (!terms || terms.schema !== 1 || !Array.isArray(terms.concepts)) fail('INVALID_TERMS', 'Expected terms schema 1 with concepts array');
  const seen = new Set();
  return terms.concepts.map(concept => {
    if (!concept || typeof concept.id !== 'string' || !concept.id || typeof concept.label !== 'string' || !concept.label || seen.has(concept.id)) {
      fail('INVALID_TERMS', 'Concept IDs must be unique, nonempty strings with labels');
    }
    seen.add(concept.id);
    const result = { id: concept.id, label: concept.label };
    for (const key of ['aliases', 'legacy', 'features', 'related']) {
      if (concept[key] !== undefined && (!Array.isArray(concept[key]) || concept[key].some(item => typeof item !== 'string' || !item))) {
        fail('INVALID_TERMS', `${concept.id}.${key} must be an array of nonempty strings`);
      }
      result[key] = concept[key] || [];
    }
    return result;
  });
}

function createIndex(root, options = {}) {
  root = rootPath(root);
  const observations = [];
  const files = architectureFiles(root);
  const documents = files.map(file => parseDocument(file, readStable(root, file, observations)));
  const terms = validateTerms(options.terms || JSON.parse(readStable(root, 'docs/architecture/tools/terms.json', observations)));
  const inventory = options.inventory || JSON.parse(readStable(root, 'scripts/azrael-feature-contracts.json', observations));
  if (!Array.isArray(inventory.features)) fail('INVALID_INVENTORY', 'Expected feature inventory features array');
  const index = { root, files, documents, sections: documents.flatMap(document => document.sections),
    terms, features: inventory.features, observations };
  verifyObservations(index);
  return index;
}

function page(items, { offset = 0, limit = 8 } = {}, maximum = 100) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    fail('INVALID_RANGE', `offset must be nonnegative; limit must be 1..${maximum}`);
  }
  return { offset, limit, total: items.length, truncated: offset + limit < items.length,
    nextOffset: offset + limit < items.length ? offset + limit : null, items: items.slice(offset, offset + limit) };
}

function metadata(section) {
  const { id, file, title, headingLine, startLine, endLine, sha, state, parents, parent } = section;
  const compactState = { ...state };
  if (compactState.declaration?.length > 240) {
    compactState.declaration = compactState.declaration.slice(0, 240);
    compactState.declarationTruncated = true;
  }
  return { id, file, title, headingLine, startLine, endLine, sha, state: compactState, parents, parent };
}

function getSection(index, id) {
  if (typeof id !== 'string' || !id.includes('#')) fail('INVALID_ID', 'Section ID must be repository-file#anchor');
  const separator = id.indexOf('#');
  const file = id.slice(0, separator), anchor = id.slice(separator + 1);
  safePath(index.root, file, { allowMissing: true });
  const document = index.documents.find(item => item.file === file);
  const canonical = document?.anchors.get(anchor);
  const section = index.sections.find(item => item.id === canonical);
  if (!section) fail('NOT_FOUND', `Unknown section: ${id}`);
  return section;
}

function search(index, query, options = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 2048) fail('INVALID_QUERY', 'Query must contain 1..2048 characters');
  const needle = normalize(query.trim());
  const tokens = [...new Set(needle.split(/\s+/).filter(Boolean))];
  const matches = term => normalize(term) === needle || tokens.includes(normalize(term));
  const concepts = index.terms.map(concept => ({ ...concept,
    matchKind: [concept.id, concept.label, ...concept.aliases].some(matches) ? 'equivalent'
      : concept.legacy.some(matches) ? 'legacy' : null })).filter(concept => concept.matchKind);
  const equivalents = concepts.filter(concept => concept.matchKind === 'equivalent');
  const expanded = [...new Set(equivalents.flatMap(concept => [concept.id, concept.label, ...concept.aliases]).map(normalize))];
  const exactFeatures = index.features.filter(feature => normalize(feature.id) === needle || equivalents.some(concept => concept.features.includes(feature.id)));
  const hits = [];
  for (const section of index.sections) {
    const title = normalize(section.title), context = normalize(section.parents.map(parent => parent.title).join(' '));
    const text = normalize(section.visible), identity = normalize(section.id);
    const matchedTerms = [...new Set([...tokens, ...expanded].filter(term => `${identity}\n${title}\n${context}\n${text}`.includes(term)))];
    const featureMatches = exactFeatures.filter(feature => feature.contract === section.file).map(feature => feature.id);
    if (!matchedTerms.length && !featureMatches.length) continue;
    let score = matchedTerms.reduce((sum, term) => sum + (title.includes(term) ? 12 : text.includes(term) ? 4 : 1), 0);
    if (`${title}\n${text}`.includes(needle)) score += 15;
    if (tokens.every(token => `${title}\n${context}\n${text}`.includes(token))) score += 8;
    score += featureMatches.length * 18;
    const lines = section.visible.split('\n');
    let line = lines.findIndex(value => matchedTerms.some(term => normalize(value).includes(term)));
    if (line < 0) line = 0;
    const excerpt = lines.slice(line, line + 3).join('\n').trim();
    hits.push({ ...metadata(section), score, matchedTerms, featureMatches,
      excerpt: excerpt.slice(0, 320), excerptStartLine: section.startLine + line,
      excerptTruncated: excerpt.length > 320 || line > 0 || line + 3 < lines.length });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { command: 'search', query, expansion: concepts.map(({ id, label, aliases, legacy, related, matchKind }) => ({ id, label, aliases, legacy, related, matchKind })),
    ...page(hits, options) };
}

function read(index, id, options = {}) {
  const section = getSection(index, id);
  if (options.sha !== undefined && options.sha !== section.sha) fail('STALE_SECTION', `Section changed: ${id}`);
  const { offset = 0, limit = 6000 } = options;
  page([], { offset, limit }, 24000);
  const content = section.body.slice(offset, offset + limit);
  return { command: 'read', ...metadata(section), children: section.children, anchors: section.anchors,
    offset, limit, total: section.body.length, truncated: offset + limit < section.body.length,
    nextOffset: offset + limit < section.body.length ? offset + limit : null, content,
    contentStartLine: section.startLine + section.body.slice(0, offset).split('\n').length - 1,
    contentEndLine: content ? section.startLine + section.body.slice(0, offset + content.length).split('\n').length - 1 : null,
    characterUnit: 'UTF-16 code units' };
}

function links(section) {
  const result = [];
  for (const [offset, line] of section.visible.split('\n').entries()) {
    for (const match of line.matchAll(/!?\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g)) {
      result.push({ href: match[1].replace(/^<|>$/g, ''), line: section.startLine + offset });
    }
  }
  return result;
}

function resolveLink(index, file, href) {
  if (/^(?:https?:|mailto:)/i.test(href)) return { kind: 'external', href };
  if (/^(?:[a-z][a-z\d+.-]*:|[/\\])/i.test(href)) return { kind: 'unsafe', href };
  let decoded;
  try { decoded = decodeURIComponent(href); } catch { return { kind: 'invalid', href }; }
  const [target, anchor] = decoded.split('#', 2);
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file), target || path.posix.basename(file)));
  let absolute;
  try { absolute = safePath(index.root, relative, { allowMissing: true }); }
  catch { return { kind: 'unsafe', href }; }
  if (!fs.existsSync(absolute)) return { kind: 'missing-file', file: relative, anchor, href };
  if (!anchor) return { kind: 'local', file: relative, href };
  let document = index.documents.find(item => item.file === relative);
  if (!document && relative.endsWith('.md')) document = parseDocument(relative, readStable(index.root, relative, index.observations));
  if (!document) return { kind: 'unknown-anchor', file: relative, anchor, href };
  const id = document.anchors.get(anchor);
  return id ? { kind: 'section', file: relative, anchor, id, href } : { kind: 'missing-anchor', file: relative, anchor, href };
}

function featureRelations(index, feature) {
  const source = file => {
    try { return { file, available: fs.existsSync(safePath(index.root, file, { allowMissing: true })) }; }
    catch (error) { return { file, available: false, error: error.code }; }
  };
  return [{ type: 'contract', feature: feature.id, ...source(feature.contract) },
    ...(feature.owners || []).map(file => ({ type: 'owner', feature: feature.id, ...source(file) })),
    ...(feature.checks || []).map(check => ({ type: 'check', feature: feature.id, id: check.id,
      level: check.level, executable: check.executable, args: check.args }))];
}

function related(index, id, options = {}) {
  const items = [];
  const feature = index.features.find(item => item.id === id);
  const concept = index.terms.find(item => item.id === id);
  let features = feature ? [feature] : [];
  if (!feature && !concept) {
    const section = getSection(index, id);
    if (section.parent) items.push({ type: 'parent', id: section.parent });
    items.push(...section.children.map(child => ({ type: 'child', ...child })));
    items.push(...links(section).map(link => ({ type: 'link', source: section.id, line: link.line, ...resolveLink(index, section.file, link.href) })));
    features = index.features.filter(item => item.contract === section.file);
  }
  const concepts = concept ? [concept] : index.terms.filter(item => features.some(feature => item.features.includes(feature.id)));
  for (const item of concepts) {
    items.push({ type: 'concept', ...item });
    items.push(...item.related.map(id => ({ type: 'related-concept', id,
      resolved: index.terms.some(term => term.id === id) })));
    features.push(...index.features.filter(feature => item.features.includes(feature.id)));
  }
  for (const item of [...new Map(features.map(feature => [feature.id, feature])).values()]) items.push(...featureRelations(index, item));
  return { command: 'related', id, ...page(items, options) };
}

function check(index, options = {}) {
  const changed = options.changed || [];
  const normalized = changed.map(file => { safePath(index.root, file, { allowMissing: true }); return path.posix.normalize(file.replace(/\\/g, '/')); });
  const affected = index.features.filter(feature => !normalized.length || normalized.includes(feature.contract) ||
    (feature.owners || []).some(owner => normalized.includes(owner)));
  const scopedFiles = new Set(affected.map(feature => feature.contract));
  for (const file of normalized) if (index.files.includes(file)) scopedFiles.add(file);
  const documents = index.documents.filter(document => !normalized.length || scopedFiles.has(document.file));
  const findings = [], references = [];
  const unmappedChanged = normalized.filter(file => !index.files.includes(file) &&
    !affected.some(feature => feature.contract === file || (feature.owners || []).includes(file)));
  for (const file of unmappedChanged) findings.push({ kind: 'unmapped-change', file,
    message: 'No registered contract or owner maps this changed path; owning architecture coverage is unknown' });
  for (const document of documents) {
    findings.push(...document.duplicateAnchors.map(anchor => ({ kind: 'duplicate-anchor', file: document.file, ...anchor })));
    for (const section of document.sections) for (const link of links(section)) {
      const resolved = resolveLink(index, document.file, link.href);
      const item = { source: section.id, line: link.line, ...resolved };
      if (['external', 'unknown-anchor'].includes(resolved.kind)) references.push(item);
      else if (!['local', 'section'].includes(resolved.kind)) findings.push(item);
    }
  }
  for (const feature of affected) {
    for (const [role, files] of [['contract', [feature.contract]], ['owner', feature.owners || []]]) {
      for (const file of files) {
        try {
          const absolute = safePath(index.root, file, { allowMissing: true });
          if (!fs.existsSync(absolute)) findings.push({ kind: `missing-${role}`, feature: feature.id, file });
        } catch (error) { findings.push({ kind: `unsafe-${role}`, feature: feature.id, file, error: error.code }); }
      }
    }
  }
  // Term metadata is small and global; validate all links even in changed scope.
  for (const term of index.terms) {
    for (const id of term.features) if (!index.features.some(feature => feature.id === id)) findings.push({ kind: 'invalid-term-feature', concept: term.id, id });
    for (const id of term.related) if (!index.terms.some(concept => concept.id === id)) findings.push({ kind: 'invalid-term-related', concept: term.id, id });
  }
  return { command: 'check', clean: findings.length === 0, findingCount: findings.length,
    coverage: unmappedChanged.length ? 'incomplete' : 'complete', unmappedChanged,
    changed: normalized, affectedFeatures: affected.map(feature => feature.id), scannedFiles: documents.map(document => document.file),
    references: { total: references.length, items: references.slice(0, 8), truncated: references.length > 8 }, ...page(findings, options) };
}

const HELP = `Local architecture retrieval (JSON, no source writes)\n  node docs/architecture/tools/architecture.cjs [--root ROOT] COMMAND\n  search <query> [--limit 1..100] [--offset N]\n  read <file#anchor> [--limit 1..24000] [--offset N] [--sha HASH]\n  related <file#anchor|feature|concept> [--limit 1..100] [--offset N]\n  check [--changed repository-path ...] [--limit 1..100] [--offset N]\n  --help\nDefaults: 8 results, read 6000 UTF-16 code units. check exit 0 means\ncompleted; inspect clean/findingCount. IDs and SHA come from search.\n`;

function run(argv, defaultRoot = path.resolve(__dirname, '../../..')) {
  const positional = [], options = {}, changed = [];
  let root = defaultRoot;
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: HELP };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument.startsWith('--')) {
      if (!['--root', '--limit', '--offset', '--sha', '--changed'].includes(argument)) fail('INVALID_ARGUMENT', `Unknown option: ${argument}`);
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) fail('INVALID_ARGUMENT', `Missing value: ${argument}`);
      if (argument === '--root') root = value;
      else if (argument === '--changed') changed.push(value);
      else if (argument === '--sha') options.sha = value;
      else { if (!/^\d+$/.test(value)) fail('INVALID_RANGE', `${argument} must be a nonnegative integer`); options[argument.slice(2)] = Number(value); }
    } else positional.push(argument);
  }
  const [command, ...args] = positional;
  if (!['search', 'read', 'related', 'check'].includes(command)) fail('INVALID_ARGUMENT', 'Expected search, read, related or check; use --help');
  if (args.length !== (command === 'check' ? 0 : 1)) fail('INVALID_ARGUMENT', `Unexpected arguments for ${command}; quote search queries`);
  if (changed.length && command !== 'check' || options.sha !== undefined && command !== 'read') fail('INVALID_ARGUMENT', 'Option is not valid for this command');
  const index = createIndex(root);
  const result = command === 'check' ? check(index, { ...options, changed })
    : ({ search, read, related })[command](index, args[0], options);
  verifyObservations(index);
  return result;
}

if (require.main === module) {
  try { const result = run(process.argv.slice(2)); process.stdout.write(result.help || JSON.stringify(result) + '\n'); }
  catch (error) { process.stdout.write(JSON.stringify({ error: { code: error.code || 'ERROR', message: error.message } }) + '\n'); process.exitCode = 1; }
}

module.exports = { normalize, slug, parseDocument, validateTerms, rootPath, safePath, readStable,
  verifyObservations, createIndex, search, read, related, check, run, page, resolveLink };
