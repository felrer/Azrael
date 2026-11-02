// Internal JS/TS classification only; no source text or metadata is sent to the model.
const fs = require('node:fs');
const path = require('node:path');
const ts = require(require.resolve('typescript', {
  paths: [path.join(__dirname, '../extensions/azrael-ex'), __dirname],
}));
const filename = process.argv[2];
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'),
  ts.ScriptTarget.Latest, true);
const positions = [];
function callable(expression) {
  while (expression && (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)
    || ts.isSatisfiesExpression(expression))) expression = expression.expression;
  return expression && (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)
    || ts.isClassExpression(expression));
}
function visit(node) {
  if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)
      || ts.isPropertyAssignment(node)) && node.name && callable(node.initializer)) {
    const start = source.getLineAndCharacterOfPosition(node.name.getStart(source));
    positions.push([start.line, start.character]);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && callable(node.right)) {
    const name = ts.isPropertyAccessExpression(node.left) ? node.left.name : node.left;
    const start = source.getLineAndCharacterOfPosition(name.getStart(source));
    positions.push([start.line, start.character]);
  }
  ts.forEachChild(node, visit);
}
visit(source);
process.stdout.write(JSON.stringify(positions));
