// Single-source JS/TS declaration-name search. Source is received only over stdin.
'use strict';

const casefoldData = require('./find-names-casefold.json');
const fold = value => Array.from(value, char =>
  casefoldData.mapping[char.codePointAt(0).toString(16)] ?? char).join('');
// Python str.strip whitespace: ECMAScript trim differs for U+001C..001F and U+FEFF.
const strip = value => value.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, '');
function validate(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Expected a JSON object');
  if (typeof request.query !== 'string' || !strip(request.query)) throw new Error('Provide a nonempty declaration-name search query');
  if (request.include_signature !== undefined && typeof request.include_signature !== 'boolean') throw new Error('include_signature must be a boolean');
  if (typeof request.filename !== 'string' || !request.filename || request.filename.includes('\0')
      || /^(?:[a-z]:|[\\/])/i.test(request.filename)
      || request.filename.split(/[\\/]/).some(part => part === '..')) throw new Error('Expected a relative source filename');
  if (!/\.(?:js|jsx|cjs|mjs|ts|tsx|cts|mts)$/i.test(request.filename)) throw new Error('Name search supports JS/TS source files only');
  if (typeof request.source !== 'string') throw new Error('source must be a string');
}

function createSearch(ts) {
function declarations(filename, text) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const entries = new Map();
  function add(name) {
    if (!name) return;
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) add(element.name);
      }
      return;
    }
    if (!ts.isIdentifier(name) && !ts.isPrivateIdentifier(name)
        && !ts.isStringLiteral(name) && !ts.isNumericLiteral(name)) return;
    const position = source.getLineAndCharacterOfPosition(name.getStart(source));
    entries.set(`${position.line}:${position.character}`, {
      line: position.line, column: position.character, name: name.text,
    });
  }
  function callable(expression) {
    while (expression && (ts.isParenthesizedExpression(expression)
        || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)
        || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression))) {
      expression = expression.expression;
    }
    return expression && (ts.isArrowFunction(expression)
      || ts.isFunctionExpression(expression) || ts.isClassExpression(expression));
  }
  function topLevelVariable(node) {
    return ts.isVariableDeclarationList(node.parent)
      && ts.isVariableStatement(node.parent.parent)
      && ts.isSourceFile(node.parent.parent.parent);
  }
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.body) {
      add(node.name);
    } else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      add(node.name);
    } else if ((ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)
        || ts.isSetAccessorDeclaration(node)) && node.body) {
      add(node.name);
    } else if (ts.isVariableDeclaration(node)
        && (topLevelVariable(node) || callable(node.initializer))) {
      add(node.name);
    } else if ((ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node))
        && callable(node.initializer)) {
      add(node.name);
    } else if (ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && callable(node.right)) {
      const name = ts.isPropertyAccessExpression(node.left) ? node.left.name : node.left;
      if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) add(name);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...entries.values()];
}

function metadata(filename, text) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const allowed = new Map(declarations(filename, text).map(item =>
    [`${item.line}:${item.column}`, item]));
  const entries = new Map();
  const printer = ts.createPrinter({removeComments: true, newLine: ts.NewLineKind.LineFeed});
  const print = node => printer.printNode(ts.EmitHint.Unspecified, node, source);
  function callable(expression) {
    while (expression && (ts.isParenthesizedExpression(expression)
        || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)
        || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression))) {
      expression = expression.expression;
    }
    return expression && (ts.isArrowFunction(expression)
      || ts.isFunctionExpression(expression) || ts.isClassExpression(expression))
      ? expression : undefined;
  }
  function signature(node) {
    if (!node || !node.parameters) return undefined;
    const prefix = [];
    if (node.modifiers?.some(item => item.kind === ts.SyntaxKind.StaticKeyword)) prefix.push('static');
    if (node.modifiers?.some(item => item.kind === ts.SyntaxKind.AsyncKeyword)) prefix.push('async');
    if (ts.isGetAccessorDeclaration(node)) prefix.push('get');
    if (ts.isSetAccessorDeclaration(node)) prefix.push('set');
    const generic = node.typeParameters?.length
      ? `<${node.typeParameters.map(print).join(', ')}>` : '';
    const parameters = node.parameters.map(print).join(', ');
    const returns = node.type ? `: ${print(node.type)}` : '';
    return (prefix.length ? `${prefix.join(' ')} ` : '')
      + (node.asteriskToken ? '*' : '') + generic + `(${parameters})` + returns;
  }
  function add(name, node, expression) {
    if (!name) return;
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) add(element.name, node, expression);
      }
      return;
    }
    const pos = source.getLineAndCharacterOfPosition(name.getStart(source));
    const key = `${pos.line}:${pos.character}`;
    const selected = allowed.get(key);
    if (!selected || entries.has(key)) return;
    let range = node;
    if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)
        && node.parent.declarations.length === 1 && ts.isVariableStatement(node.parent.parent)) {
      range = node.parent.parent;
    }
    const start = range.getStart(source);
    const result = {...selected,
      start_line: source.getLineAndCharacterOfPosition(start).line + 1,
      end_line: source.getLineAndCharacterOfPosition(Math.max(start, range.end - 1)).line + 1,
    };
    const compact = signature(expression || node);
    if (compact !== undefined) result.signature = compact;
    entries.set(key, result);
  }
  function visit(node) {
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)
        || ts.isPropertyAssignment(node)) && node.name) {
      add(node.name, node, callable(node.initializer));
    } else if (ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && callable(node.right)) {
      add(ts.isPropertyAccessExpression(node.left) ? node.left.name : node.left,
        node, callable(node.right));
    } else if (node.name) {
      add(node.name, node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (entries.size !== allowed.size) throw new Error('Cannot map a v4 declaration to v5 metadata');
  return [...entries.values()];
}

function findNames(request) {
  validate(request);
  const {filename, source: text} = request;
  const catalog = new Map(metadata(filename, text).map(item => [item.line + ':' + item.column, item]));
  const snapshot = ts.ScriptSnapshot.fromString(text);
  const host = {
    getScriptFileNames: () => [filename],
    getScriptVersion: () => '0',
    getScriptSnapshot: name => name === filename ? snapshot : undefined,
    getCurrentDirectory: () => '',
    getCompilationSettings: () => ({noResolve: true, noLib: true, allowJs: true}),
    getDefaultLibFileName: () => '',
    fileExists: name => name === filename,
    readFile: () => undefined,
    readDirectory: () => [],
    directoryExists: () => false,
    useCaseSensitiveFileNames: () => true,
  };
  const service = ts.createLanguageService(host);
  try {
    const tree = service.getNavigationTree(filename);
    const parsed = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
    const needle = fold(strip(request.query));
    const result = [], seen = new Set();
    function children(items, parent, containingSpan) {
      // The LSP document-symbol conversion emits one sibling per navigation span.
      // A merged overload's nameSpan belongs only to its first declaration;
      // later declarations use their span start, preserving v5's coordinate join.
      const nodes = items.flatMap(node => node.spans
        .filter(span => !containingSpan || (span.start >= containingSpan.start
          && span.start + span.length <= containingSpan.start + containingSpan.length))
        .map(span => ({...node, span, position: node.nameSpan
          && node.nameSpan.start >= span.start
          && node.nameSpan.start + node.nameSpan.length <= span.start + span.length
          ? node.nameSpan.start : span.start})));
      const counts = new Map(), indexes = new Map();
      for (const node of nodes) counts.set(node.text, (counts.get(node.text) || 0) + 1);
      for (const node of nodes) {
        const index = indexes.get(node.text) || 0;
        indexes.set(node.text, index + 1);
        const leaf = node.text + (counts.get(node.text) > 1 ? '[' + index + ']' : '');
        const id = parent ? parent + '/' + leaf : leaf;
        {
          const pos = parsed.getLineAndCharacterOfPosition(node.position);
          const item = catalog.get(pos.line + ':' + pos.character);
          if (item && fold(item.name).includes(needle)) {
            if (seen.has(id)) throw new Error('Ambiguous symbol paths');
            seen.add(id);
            const row = [id, item.start_line, item.end_line];
            if (request.include_signature && item.signature !== undefined) row.push(item.signature);
            result.push(row);
          }
        }
        children(node.childItems || [], id, node.span);
      }
    }
    children(tree.childItems || [], '');
    return result;
  } finally {
    service.dispose();
  }
}
return {findNames};
}
function runCli(ts) {
  try {
    const input = require('node:fs').readFileSync(0, 'utf8');
    const request = JSON.parse(input);
    validate(request);
    process.stdout.write(JSON.stringify(createSearch(ts || require('./typescript.js')).findNames(request)));
  } catch (_) {
    // Never include source content, parser diagnostics, or caller input in logs.
    process.stderr.write('Declaration-name search failed\n');
    process.exitCode = 1;
  }
}
if (require.main === module) runCli();
module.exports = {createSearch, runCli};
