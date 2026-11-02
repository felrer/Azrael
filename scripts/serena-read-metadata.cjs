'use strict';

// Experimental source-only metadata. The caller owns source retrieval and TS loading.
function describeSymbols({ source, fileName = 'source.ts', symbols }, ts) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const nodes = [];
  const callable = n => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);
  const semantic = n => callable(n) || ts.isVariableDeclaration(n) ||
    ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isPropertyAssignment(n) ||
    ts.isShorthandPropertyAssignment(n) || ts.isPropertyDeclaration(n) ||
    ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n);
  function index(n) {
    if (semantic(n)) nodes.push({ node: n, start: n.getStart(file), end: n.end });
    if (ts.isVariableStatement(n) && n.declarationList.declarations.length === 1) {
      nodes.push({ node: n.declarationList.declarations[0], start: n.getStart(file), end: n.end });
    }
    ts.forEachChild(n, index);
  }
  index(file);
  const compact = text => text.replace(/\s+/g, ' ').trim();
  function shorten(text, preserveSource = false) {
    // Signatures can contain meaningful whitespace inside literals or templates.
    const chars = Array.from(preserveSource ? text.trim() : compact(text));
    return { text: chars.length > 240 ? chars.slice(0, 239).join('') + '…' : chars.join(''),
      truncated: chars.length > 240 };
  }
  function position(p) {
    if (!p || !Number.isInteger(p.line) || !Number.isInteger(p.character) || p.line < 0 || p.character < 0) return null;
    const starts = file.getLineStarts();
    if (p.line >= starts.length) return null;
    const offset = starts[p.line] + p.character;
    const end = p.line + 1 < starts.length ? starts[p.line + 1] : source.length;
    return offset <= end ? offset : null;
  }
  function signature(n) {
    if (callable(n)) {
      return source.slice(n.getStart(file), n.body ? n.body.getStart(file) : n.end).trim().replace(/;$/, '');
    }
    if (ts.isVariableDeclaration(n) || ts.isPropertyDeclaration(n)) {
      if (n.initializer && callable(n.initializer)) {
        return source.slice(n.getStart(file), n.initializer.body.getStart(file)).trim();
      }
      const prefix = ts.isVariableDeclaration(n) && ts.isVariableDeclarationList(n.parent)
        ? (n.parent.flags & ts.NodeFlags.Const ? 'const ' : n.parent.flags & ts.NodeFlags.Let ? 'let ' : 'var ') : '';
      return prefix + source.slice(n.getStart(file), n.initializer ? n.initializer.getFullStart() : n.end).trim().replace(/\s*=\s*$/, '');
    }
    if (ts.isPropertyAssignment(n)) {
      return callable(n.initializer)
        ? source.slice(n.getStart(file), n.initializer.body.getStart(file)).trim()
        : n.name.getText(file) + ': ' + (ts.isIdentifier(n.initializer) ? n.initializer.getText(file) : '[initializer omitted]');
    }
    if (ts.isShorthandPropertyAssignment(n)) return n.name.getText(file);
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isInterfaceDeclaration(n) || ts.isEnumDeclaration(n)) {
      const brace = n.getChildren(file).find(child => child.kind === ts.SyntaxKind.OpenBraceToken);
      return source.slice(n.getStart(file), brace ? brace.getStart(file) : n.end).trim();
    }
    return n.getText(file);
  }
  function docs(n) {
    // File banners preceding CommonJS imports describe the file, not the binding.
    if (ts.isVariableDeclaration(n) && n.initializer) {
      let initializer = n.initializer;
      while (ts.isPropertyAccessExpression(initializer) || ts.isElementAccessExpression(initializer) ||
        ts.isParenthesizedExpression(initializer)) initializer = initializer.expression;
      if (ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) &&
        initializer.expression.text === 'require') return null;
    }
    // Only declaration wrappers share leading documentation; never inherit a containing function's prose.
    for (let current = n; current && !ts.isSourceFile(current); current = current.parent) {
      const ranges = ts.getLeadingCommentRanges(source, current.pos) || [];
      const comments = ranges.filter(r => source.slice(r.end, current.getStart(file)).trim() === '' ||
        ranges.some(next => next.pos >= r.end));
      if (comments.length) {
        const raw = comments.map(r => source.slice(r.pos, r.end)).join('\n');
        return { text: raw.replace(/\/\*\*?|\*\//g, '').replace(/^\s*(?:\/\/|\*) ?/gm, '').trim(),
          source: raw.startsWith('/**') ? 'jsdoc' : 'comment' };
      }
      const parent = current.parent;
      if (!(ts.isVariableDeclarationList(parent) || ts.isVariableStatement(parent) ||
        ts.isPropertyAssignment(parent) || ts.isVariableDeclaration(parent) ||
        ts.isExportAssignment(parent) || ts.isExpressionStatement(parent))) break;
    }
    return null;
  }
  function callbackTitle(n) {
    const fn = callable(n) ? n : n.initializer;
    if (!fn || !callable(fn) || !ts.isCallExpression(fn.parent)) return null;
    const call = fn.parent;
    if (!/^(?:test|it|describe)(?:\.[\w]+)*$/.test(call.expression.getText(file))) return null;
    const title = call.arguments.find(a => ts.isStringLiteralLike(a));
    return title ? title.text : null;
  }
  function structure(n) {
    const properties = new Set(), calls = new Set(), keys = new Set();
    function conciseName(expression) {
      if (ts.isIdentifier(expression)) return expression.text;
      if (ts.isPropertyAccessExpression(expression)) return expression.name.getText(file);
      if (ts.isElementAccessExpression(expression) && expression.argumentExpression &&
        ts.isStringLiteralLike(expression.argumentExpression)) return '[' + expression.argumentExpression.getText(file) + ']';
      return null;
    }
    function visit(child) {
      if (child !== n && callable(child) && !(n.initializer === child)) return;
      if (ts.isPropertyAccessExpression(child) &&
        !(ts.isCallExpression(child.parent) && child.parent.expression === child)) properties.add(child.name.getText(file));
      if (ts.isCallExpression(child)) {
        const name = conciseName(child.expression);
        if (name) calls.add(name);
      }
      const returned = ts.isReturnStatement(child) ? child.expression
        : ts.isArrowFunction(child) && child.body && !ts.isBlock(child.body) ? child.body : null;
      const value = returned && ts.isParenthesizedExpression(returned) ? returned.expression : returned;
      if (value && ts.isObjectLiteralExpression(value)) {
        value.properties.forEach(p => { if (p.name) keys.add(p.name.getText(file)); });
      }
      ts.forEachChild(child, visit);
    }
    visit(n);
    const parts = [];
    let truncated = false;
    function list(values, limit) {
      const omitted = Math.max(0, values.size - limit);
      truncated ||= omitted > 0;
      return [...values].slice(0, limit).join(', ') + (omitted ? `, … (+${omitted})` : '');
    }
    if (keys.size) parts.push('returns keys ' + list(keys, 8));
    if (calls.size) parts.push('calls ' + list(calls, 4));
    if (properties.size) parts.push('property accesses ' + list(properties, 4));
    return { text: parts.length ? 'Observed: ' + parts.join('; ') : '', truncated };
  }
  return symbols.map(symbol => {
    const start = position(symbol.start), end = position(symbol.end);
    const candidates = start === null || end === null || end < start ? []
      : nodes.filter(n => n.start <= start && n.end >= end);
    candidates.sort((a, b) => (a.end - a.start) - (b.end - b.start));
    const node = candidates[0]?.node;
    if (!node) return { signature: '', description: '', description_source: 'none' };
    const doc = docs(node), title = callbackTitle(node);
    const sig = shorten(signature(node), true);
    const observed = !doc?.text && title === null ? structure(node) : null;
    const desc = shorten(doc?.text || (title !== null ? 'Test title: ' + title : observed.text));
    return { signature: sig.text, description: desc.text,
      description_source: doc?.text ? doc.source : title !== null ? 'test_title' : desc.text ? 'structure' : 'none',
      ...(sig.truncated ? { signature_truncated: true } : {}),
      ...(desc.truncated || observed?.truncated ? { description_truncated: true } : {}) };
  });
}

module.exports = { describeSymbols };

if (require.main === module) {
  const chunks = [];
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => chunks.push(chunk));
  process.stdin.on('end', () => {
    try {
      const ts = require(process.env.SERENA_TYPESCRIPT_MODULE || 'typescript');
      process.stdout.write(JSON.stringify(describeSymbols(JSON.parse(chunks.join('')), ts)));
    } catch (error) {
      process.stderr.write(String(error.stack || error) + '\n');
      process.exitCode = 1;
    }
  });
}
