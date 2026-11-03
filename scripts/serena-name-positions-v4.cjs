// Internal JS/TS declaration classification. No source bodies are emitted.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ts = require(require.resolve('typescript', {
  paths: [path.join(__dirname, '../extensions/azrael-ex'), __dirname],
}));

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

if (require.main === module) {
  const filename = process.argv[2];
  process.stdout.write(JSON.stringify(declarations(filename, fs.readFileSync(filename, 'utf8'))));
}
module.exports = {declarations};
