// Add ranges and optional callable signatures to the unchanged v4 name selection.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ts = require(require.resolve('typescript', {
  paths: [path.join(__dirname, '../extensions/azrael-ex'), __dirname],
}));
const {declarations} = require('./serena-name-positions-v4.cjs');

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

if (require.main === module) {
  const filename = process.argv[2];
  process.stdout.write(JSON.stringify(metadata(filename, fs.readFileSync(filename, 'utf8'))));
}
module.exports = {metadata};
