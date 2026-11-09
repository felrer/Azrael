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
  const metadataFindings = [];
  const declarations = new Map();
  for (let i = 0; i < visible.length; i++) {
    const match = /^\s*<!--\s*architecture:\s*(.*?)\s*-->\s*$/.exec(visible[i]);
    if (!match) continue;
    visible[i] = '';
    try {
      const value = JSON.parse(match[1]);
      if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Expected metadata object');
      if ('id' in value && (typeof value.id !== 'string' || !value.id.trim() || /[\s#]/.test(value.id))) throw new Error('id must be a nonempty stable identifier without spaces or #');
      if ('feature' in value && value.feature !== null && (typeof value.feature !== 'string' || !value.feature.trim())) throw new Error('feature must be a nonempty string or null');
      if ('redirect' in value && (typeof value.redirect !== 'string' || !value.redirect.trim() || /[\s#]/.test(value.redirect))) throw new Error('redirect must be a stable document ID without spaces or #');
      if ('layers' in value && (!Array.isArray(value.layers) || value.layers.some(layer => !['ui', 'host', 'engine', 'tooling'].includes(layer)))) throw new Error('layers must contain ui, host, engine or tooling');
      if ('status' in value && !['current', 'partial', 'target', 'draft', 'reference', 'unknown', 'conflict'].includes(value.status)) throw new Error('Invalid status');
      if (value.status === 'conflict' && (typeof value.priorStatus !== 'string' || !value.priorStatus || typeof value.conflict !== 'string' || !value.conflict)) throw new Error('conflict requires priorStatus and conflict reference');
      declarations.set(i + 1, value);
    } catch (error) { metadataFindings.push({ kind: 'invalid-metadata', file, line: i + 1, message: error.message }); }
  }
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
    const ownDeclarations = [...declarations].filter(([line]) => line >= start && line <= end);
    if (ownDeclarations.length > 1) metadataFindings.push({ kind: 'duplicate-metadata', file, line: ownDeclarations[1][0] });
    const classification = ownDeclarations[0]?.[1] || {};
    const section = { id: `${file}#${heading.anchor}`, file, ...heading, startLine: start, endLine: end,
      parents: stack.map(item => ({ id: item.id, title: item.title })), parent: parent?.id || null,
      state, classification, body, visible: visible.slice(start - 1, end).join('\n'), children: [], anchors: [heading.anchor] };
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
  const standaloneAnchors = /^(?:\s*<a\s+[^>]*?(?:id|name)\s*=\s*["'][^"']+["'][^>]*>\s*<\/a>\s*)+$/i;
  for (let i = 0; i < visible.length; i++) {
    for (const match of visible[i].matchAll(/<a\s+[^>]*?(?:id|name)\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
      let next = i + 1;
      while (next < visible.length && (!lines[next].trim() || standaloneAnchors.test(visible[next]))) next++;
      const heading = standaloneAnchors.test(visible[i]) && sections.find(section => section.headingLine === next + 1);
      const owner = heading || sections.find(section => section.startLine <= i + 1 && section.endLine >= i + 1);
      if (!owner) continue;
      if (anchors.has(match[1]) && anchors.get(match[1]) !== owner.id) duplicateAnchors.push({ anchor: match[1], line: i + 1 });
      else { anchors.set(match[1], owner.id); if (!owner.anchors.includes(match[1])) owner.anchors.push(match[1]); }
    }
  }
  return { file, sections, anchors, duplicateAnchors, visible, metadataFindings };
}

function architectureFiles(root) {
  const files = [];
  const visit = directory => {
    for (const item of fs.readdirSync(safePath(root, directory), { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue;
      const file = `${directory}/${item.name}`;
      if (item.isDirectory() && item.name !== 'tools') visit(file);
      else if (item.isFile() && item.name.endsWith('.md')) files.push(file);
    }
  };
  visit('docs/architecture');
  return files.sort();
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
  index.metadataFindings = documents.flatMap(document => document.metadataFindings);
  index.ids = new Map();
  const remap = new Map();
  for (const document of documents) {
    document.entry = document.sections.find(section => section.level === 1) || document.sections[0];
    document.classification = document.entry.classification;
    document.redirect = document.classification.redirect;
  }
  for (const document of documents) {
    let directory = path.posix.dirname(document.file), folderFeature;
    while (directory.startsWith('docs/architecture')) {
      const owner = documents.find(item => item.file === `${directory}/README.md`);
      if (owner && Object.hasOwn(owner.classification, 'feature')) { folderFeature = owner.classification.feature; break; }
      if (directory === 'docs/architecture') break;
      directory = path.posix.dirname(directory);
    }
    const base = { feature: folderFeature, layers: [], ...document.classification };
    for (const section of document.sections) {
      const parent = document.sections.find(item => (item.legacyId || item.id) === section.parent);
      const inherited = parent?.effectiveClassification || base;
      section.effectiveClassification = { ...inherited, ...section.classification };
      const effective = section.effectiveClassification;
      section.feature = effective.feature;
      section.layers = effective.layers;
      section.redirect = document.redirect;
      section.legacyId = section.id;
      const stable = section.classification.id || (section === document.entry ? base.id : base.id && `${base.id}#${section.anchor}`);
      section.id = stable || section.id;
      remap.set(section.legacyId, section.id);
      if (index.ids.has(section.id)) index.metadataFindings.push({ kind: 'duplicate-id', id: section.id, file: section.file, otherFile: index.ids.get(section.id).file });
      else index.ids.set(section.id, section);
      // Conflict is sticky within its subtree even when a child declares a status.
      if (parent?.state.value === 'conflict' || effective.status === 'conflict') {
        const ownConflict = section.classification.status === 'conflict';
        const conflict = ownConflict ? section.classification : parent?.state.value === 'conflict' ? parent.state : effective;
        section.state = { value: 'conflict', priorStatus: conflict.priorStatus, conflict: conflict.conflict,
          provenance: ownConflict ? 'declared' : 'inherited', source: ownConflict ? section.id : conflict.source || section.id };
      } else if (section.classification.status) section.state = { value: section.classification.status, provenance: 'declared', source: section.id };
      else if (section.state.provenance !== 'declared' && parent) section.state = { ...parent.state,
        provenance: parent.state.value === 'unknown' && !parent.state.source ? 'unknown' : 'inherited' };
    }
  }
  for (const document of documents) {
    for (const [anchor, id] of document.anchors) document.anchors.set(anchor, remap.get(id));
    for (const section of document.sections) {
      section.parent = remap.get(section.parent) || null;
      section.parents = section.parents.map(parent => ({ ...parent, id: remap.get(parent.id) }));
      section.children = section.children.map(child => ({ ...child, id: remap.get(child.id) }));
      if (section.state.source) section.state.source = remap.get(section.state.source) || section.state.source;
      section.sha = digest(JSON.stringify([section.title, section.body, section.parents, section.state, section.effectiveClassification]));
    }
  }
  const stableDocuments = new Map(documents.filter(document => document.classification.id)
    .map(document => [document.classification.id, document]));
  for (const document of documents) {
    for (const section of document.sections) if (section !== document.entry && Object.hasOwn(section.classification, 'redirect')) {
      index.metadataFindings.push({ kind: 'invalid-redirect', file: document.file, source: section.id, message: 'redirect is document metadata only' });
    }
    if (!document.redirect) continue;
    if (!document.classification.id || document.entry.feature !== null || document.entry.layers.length || document.entry.state.value !== 'reference') {
      index.metadataFindings.push({ kind: 'invalid-router', file: document.file, source: document.entry.id,
        message: 'Router requires its own stable ID, feature:null, layers:[] and reference status' });
    }
    const visited = new Set([document]);
    let current = document;
    while (current.redirect) {
      const target = stableDocuments.get(current.redirect);
      if (!target) {
        index.metadataFindings.push({ kind: 'missing-redirect', file: document.file, source: document.entry.id, target: current.redirect });
        break;
      }
      if (visited.has(target)) {
        index.metadataFindings.push({ kind: target === document && current === document ? 'self-redirect' : 'redirect-cycle',
          file: document.file, source: document.entry.id, target: current.redirect });
        break;
      }
      visited.add(target);
      current = target;
    }
  }
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
  return { ...candidate(section), id, file, title, headingLine, startLine, endLine, sha, state: compactState, parents, parent,
    ...(section.redirect ? { redirect: section.redirect } : {}) };
}

function candidate(section) {
  return { id: section.id, title: section.title, feature: section.feature === undefined ? 'unknown' : section.feature,
    layers: section.layers || [], ...(section.state.value === 'conflict' ? { status: 'conflict', priorStatus: section.state.priorStatus, conflict: section.state.conflict } : {}) };
}

function matchesFacets(section, options) {
  const features = options.feature || [], layers = options.layer || [];
  if (layers.some(layer => !['ui', 'host', 'engine', 'tooling'].includes(layer))) fail('INVALID_ARGUMENT', 'Unknown layer');
  return (!features.length || features.includes(section.feature === undefined ? 'unknown' : section.feature === null ? 'null' : section.feature)) &&
    (!layers.length || layers.some(layer => section.layers.includes(layer)));
}

function map(index, options = {}) {
  if (options.groupBy !== undefined && !['feature', 'layer'].includes(options.groupBy)) fail('INVALID_ARGUMENT', 'group-by must be feature or layer');
  const items = index.documents.filter(document => !document.redirect && matchesFacets(document.entry, options)).map(document => {
    const conflicts = document.sections.filter(section => section.state.value === 'conflict').map(section => section.id);
    return { ...candidate(document.entry), ...(conflicts.length ? { conflicts: {
      total: conflicts.length, ids: conflicts.slice(0, 8), truncated: conflicts.length > 8 } } : {}) };
  });
  if (options.groupBy) {
    const groups = new Map();
    for (const document of items) {
      const keys = options.groupBy === 'feature' ? [document.feature] : document.layers.length ? [...new Set(document.layers)] : [null];
      for (const key of keys) groups.set(key, (groups.get(key) || 0) + 1);
    }
    const grouped = [...groups].map(([key, documents]) => ({ [options.groupBy]: key, documents }))
      .sort((a, b) => String(a[options.groupBy] ?? '').localeCompare(String(b[options.groupBy] ?? '')));
    return { command: 'map', groupBy: options.groupBy, ...page(grouped, options) };
  }
  return { command: 'map', ...page(items, options) };
}

function getSection(index, id) {
  if (index.ids.has(id)) return index.ids.get(id);
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
  // Only an equivalent of the entire query can supply a full-match phrase.
  // Token-level expansion still contributes candidates and the existing score.
  const fullEquivalents = equivalents.filter(concept =>
    [concept.id, concept.label, ...concept.aliases].some(term => normalize(term) === needle));
  const phrases = [...new Set([needle, ...fullEquivalents.flatMap(concept =>
    [concept.id, concept.label, ...concept.aliases]).map(normalize)])];
  const phraseMatch = (value, phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'u').test(value);
  };
  const expanded = [...new Set(equivalents.flatMap(concept => [concept.id, concept.label, ...concept.aliases]).map(normalize))];
  const exactFeatures = index.features.filter(feature => normalize(feature.id) === needle || equivalents.some(concept => concept.features.includes(feature.id)));
  const hits = [];
  const priorities = new Map();
  const entries = new Set(index.documents.map(document => document.entry));
  for (const section of index.sections) {
    if (section.redirect) continue;
    if (!matchesFacets(section, options)) continue;
    const title = normalize(section.title), context = normalize(section.parents.map(parent => parent.title).join(' '));
    const text = normalize(section.visible), identity = normalize(section.id);
    const matchedTerms = [...new Set([...tokens, ...expanded].filter(term => `${identity}\n${title}\n${context}\n${text}`.includes(term)))];
    const featureMatches = exactFeatures.filter(feature => feature.contract === section.file).map(feature => feature.id);
    const exactFeatureName = entries.has(section) && typeof section.feature === 'string' && normalize(section.feature) === needle;
    if (!matchedTerms.length && !featureMatches.length && !exactFeatureName) continue;
    const directFields = [identity, title, text];
    const exactOwner = entries.has(section) &&
      (exactFeatureName || featureMatches.some(id => normalize(id) === needle) ||
        fullEquivalents.some(concept => concept.features.some(id => featureMatches.includes(id))));
    // A group precedes score: unrelated synonym/token boosts cannot outrank a
    // complete direct phrase. Parent-only matches remain fallback candidates.
    priorities.set(section.id, exactOwner || phrases.some(phrase => directFields.some(value => phraseMatch(value, phrase))) ? 0
      : tokens.every(token => directFields.some(value => phraseMatch(value, token))) ? 1 : 2);
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
  hits.sort((a, b) => priorities.get(a.id) - priorities.get(b.id) || b.score - a.score || a.id.localeCompare(b.id));
  return { command: 'search', query, ...(options.detail ? { expansion: concepts.map(({ id, label, aliases, legacy, related, matchKind }) => ({ id, label, aliases, legacy, related, matchKind })) } : {}),
    ...page(options.detail ? hits : hits.map(hit => candidate(index.ids.get(hit.id))), options) };
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
  const direction = options.direction || 'both';
  if (!['incoming', 'outgoing', 'both'].includes(direction)) fail('INVALID_ARGUMENT', 'direction must be incoming, outgoing or both');
  const feature = index.features.find(item => item.id === id);
  const concept = index.terms.find(item => item.id === id);
  let features = feature ? [feature] : [];
  if (!feature && !concept) {
    const section = getSection(index, id);
    if (direction !== 'outgoing' && section.parent) items.push({ type: 'parent', direction: 'incoming', id: section.parent });
    if (direction !== 'incoming') {
      items.push(...section.children.map(child => ({ type: 'child', direction: 'outgoing', ...child })));
      items.push(...links(section).map(link => ({ type: 'link', direction: 'outgoing', source: section.id, sourceFile: section.file,
        ...(section.redirect ? { sourceRedirect: section.redirect } : {}), line: link.line, ...resolveLink(index, section.file, link.href) })));
    }
    if (direction !== 'outgoing') for (const source of index.sections) for (const link of links(source)) {
      const target = resolveLink(index, source.file, link.href);
      if (target.id === section.id || (!target.anchor && target.file === section.file && section === index.documents.find(document => document.file === section.file).entry)) {
        items.push({ type: 'link', direction: 'incoming', source: source.id, sourceFile: source.file,
          ...(source.redirect ? { sourceRedirect: source.redirect } : {}), line: link.line, ...target });
      }
    }
    if (options.detail) features = index.features.filter(item => item.contract === section.file);
  }
  const concepts = concept ? [concept] : index.terms.filter(item => features.some(feature => item.features.includes(feature.id)));
  for (const item of concepts) {
    items.push({ type: 'concept', ...item });
    items.push(...item.related.map(id => ({ type: 'related-concept', id,
      resolved: index.terms.some(term => term.id === id) })));
    features.push(...index.features.filter(feature => item.features.includes(feature.id)));
  }
  for (const item of [...new Map(features.map(feature => [feature.id, feature])).values()]) items.push(...featureRelations(index, item));
  return { command: 'related', id, direction, coverage: feature || concept || options.detail
    ? 'direct source links, hierarchy and inventory relationships; no transitive expansion'
    : 'direct source links and hierarchy only; no transitive expansion', ...page(items, options) };
}

function check(index, options = {}) {
  const changed = options.changed || [];
  const normalized = changed.map(file => { safePath(index.root, file, { allowMissing: true }); return path.posix.normalize(file.replace(/\\/g, '/')); });
  const affected = index.features.filter(feature => !normalized.length || normalized.includes(feature.contract) ||
    (feature.owners || []).some(owner => normalized.includes(owner)));
  const scopedFiles = new Set(affected.map(feature => feature.contract));
  for (const file of normalized) if (index.files.includes(file)) scopedFiles.add(file);
  const initialScope = new Set([...scopedFiles, ...normalized]);
  const incomingFiles = new Set();
  if (normalized.length) for (const section of index.sections) for (const link of links(section)) {
    const target = resolveLink(index, section.file, link.href);
    if (initialScope.has(target.file) && !initialScope.has(section.file)) incomingFiles.add(section.file);
  }
  for (const file of incomingFiles) scopedFiles.add(file);
  const documents = index.documents.filter(document => !normalized.length || scopedFiles.has(document.file));
  const findings = index.metadataFindings.slice(), references = [];
  const unmappedChanged = normalized.filter(file => !index.files.includes(file) &&
    !affected.some(feature => feature.contract === file || (feature.owners || []).includes(file)));
  for (const file of unmappedChanged) findings.push({ kind: 'unmapped-change', file,
    message: 'No registered contract or owner maps this changed path; owning architecture coverage is unknown' });
  for (const document of documents) {
    findings.push(...document.duplicateAnchors.map(anchor => ({ kind: 'duplicate-anchor', file: document.file, ...anchor })));
    for (const section of document.sections) {
      if (section.state.value === 'conflict') findings.push({ kind: 'conflict', source: section.id, file: section.file, ...section.state });
      const folderOwner = index.documents.find(item => item.file === `${path.posix.dirname(section.file)}/README.md`);
      if (Object.hasOwn(section.classification, 'feature') && folderOwner?.classification.feature !== undefined && section.classification.feature !== folderOwner.classification.feature) {
        findings.push({ kind: 'feature-override', source: section.id, file: section.file, feature: section.classification.feature, folderFeature: folderOwner.classification.feature });
      }
      if (section.classification.conflict) {
        const target = resolveLink(index, section.file, section.classification.conflict);
        if (!['local', 'section', 'external'].includes(target.kind)) findings.push({ kind: 'invalid-conflict-reference', source: section.id, target });
      }
      for (const link of links(section)) {
        const resolved = resolveLink(index, document.file, link.href);
        const item = { source: section.id, line: link.line, ...resolved };
        if (['external', 'unknown-anchor'].includes(resolved.kind)) references.push(item);
        else if (!['local', 'section'].includes(resolved.kind)) findings.push(item);
      }
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
    scope: { incomingHops: normalized.length ? 1 : 0, incomingFiles: [...incomingFiles].sort(), metadata: 'global' },
    references: { total: references.length, items: references.slice(0, 8), truncated: references.length > 8 }, ...page(findings, options) };
}

const HELP = `Local architecture retrieval (JSON, no source writes)
  node docs/architecture/tools/architecture.cjs [--root ROOT] COMMAND
  map [--feature ID|null|unknown] [--layer ui|host|engine|tooling] [--group-by feature|layer]
  search <query> [--feature ID|null|unknown] [--layer LAYER] [--detail]
  read <stable-id|file#anchor> [--limit 1..24000] [--offset N] [--sha HASH]
  related <stable-id|file#anchor|feature|concept> [--direction incoming|outgoing|both] [--detail]
  check [--changed repository-path ...]
  --help
All result lists accept --limit 1..100 and --offset N; default 8 results.
Repeat --feature/--layer for OR within a facet, AND between facets.
Read defaults to 6000 UTF-16 code units. check exit 0 means completed;
inspect clean/findingCount. Detailed search/read expose source SHA.
`;

function run(argv, defaultRoot = path.resolve(__dirname, '../../..')) {
  const positional = [], options = {}, changed = [];
  let root = defaultRoot;
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: HELP };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument.startsWith('--')) {
      if (argument === '--detail') { options.detail = true; continue; }
      if (!['--root', '--limit', '--offset', '--sha', '--changed', '--feature', '--layer', '--direction', '--group-by'].includes(argument)) fail('INVALID_ARGUMENT', `Unknown option: ${argument}`);
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) fail('INVALID_ARGUMENT', `Missing value: ${argument}`);
      if (argument === '--root') root = value;
      else if (argument === '--changed') changed.push(value);
      else if (argument === '--sha') options.sha = value;
      else if (argument === '--direction') options.direction = value;
      else if (argument === '--group-by') options.groupBy = value;
      else if (['--feature', '--layer'].includes(argument)) (options[argument.slice(2)] ||= []).push(value);
      else { if (!/^\d+$/.test(value)) fail('INVALID_RANGE', `${argument} must be a nonnegative integer`); options[argument.slice(2)] = Number(value); }
    } else positional.push(argument);
  }
  const [command, ...args] = positional;
  if (!['map', 'search', 'read', 'related', 'check'].includes(command)) fail('INVALID_ARGUMENT', 'Expected map, search, read, related or check; use --help');
  if (args.length !== (['map', 'check'].includes(command) ? 0 : 1)) fail('INVALID_ARGUMENT', `Unexpected arguments for ${command}; quote search queries`);
  if (changed.length && command !== 'check' || options.sha !== undefined && command !== 'read') fail('INVALID_ARGUMENT', 'Option is not valid for this command');
  if (options.detail && !['search', 'related'].includes(command) || (options.feature || options.layer) && !['map', 'search'].includes(command) || options.direction && command !== 'related') fail('INVALID_ARGUMENT', 'Option is not valid for this command');
  if (options.groupBy !== undefined && command !== 'map') fail('INVALID_ARGUMENT', 'group-by is valid only for map');
  const index = createIndex(root);
  const result = command === 'check' ? check(index, { ...options, changed })
    : command === 'map' ? map(index, options) : ({ search, read, related })[command](index, args[0], options);
  verifyObservations(index);
  return result;
}

if (require.main === module) {
  try { const result = run(process.argv.slice(2)); process.stdout.write(result.help || JSON.stringify(result) + '\n'); }
  catch (error) { process.stdout.write(JSON.stringify({ error: { code: error.code || 'ERROR', message: error.message } }) + '\n'); process.exitCode = 1; }
}

module.exports = { normalize, slug, parseDocument, validateTerms, rootPath, safePath, readStable,
  verifyObservations, createIndex, map, search, read, related, check, run, page, resolveLink };
