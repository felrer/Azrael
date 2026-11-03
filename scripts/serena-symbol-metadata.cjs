// Experimental JS/TS metadata. Positions are zero-based UTF-16, like the LSP.
const fs = require('node:fs');
const path = require('node:path');
const ts = require(require.resolve('typescript', {
  paths: [path.join(__dirname, '../extensions/azrael-ex'), __dirname],
}));
const filename = process.argv[2];
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'),
  ts.ScriptTarget.Latest, true);
const entries = new Map();
const callablePositions = [];
function callable(expression) {
  while (expression && (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)
    || ts.isSatisfiesExpression(expression))) expression = expression.expression;
  return expression && (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)
    || ts.isClassExpression(expression)) ? expression : undefined;
}
function headerEnd(node) {
  if (node.body) return node.body.getStart(source);
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isInterfaceDeclaration(node)
      || ts.isEnumDeclaration(node)) {
    const brace = node.getChildren(source).find(child => child.kind === ts.SyntaxKind.OpenBraceToken);
    if (brace) return brace.getStart(source);
  }
  return node.end;
}
function documentation(node) {
  // Only compiler-attached JSDoc; ordinary comments and @tag text are excluded.
  const blocks = node.jsDoc || [];
  const comment = blocks.length ? blocks[blocks.length - 1].comment : undefined;
  if (!comment) return undefined;
  const text = typeof comment === 'string' ? comment
    : comment.map(part => part.text || part.getText(source)).join('');
  // First paragraph, then first sentence. No abbreviation/language inference.
  const paragraph = text.trim().split(/\r?\n\s*\r?\n/)[0].replace(/\s+/g, ' ').trim();
  const sentence = paragraph.match(/^.*?[.!?。！？](?=\s|$)/u);
  return (sentence ? sentence[0] : paragraph) || undefined;
}
function add(node, name, expression, outer) {
  const position = source.getLineAndCharacterOfPosition(name.getStart(source));
  const declaration = outer || node;
  const start = declaration.getStart(source);
  const end = Math.max(start, declaration.end - 1);
  const result = {
    line: position.line, column: position.character,
    start_line: source.getLineAndCharacterOfPosition(start).line + 1,
    end_line: source.getLineAndCharacterOfPosition(end).line + 1,
    signature: source.text.slice(start, headerEnd(expression || node)).trim(),
  };
  const variableStatement = ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)
    && ts.isVariableStatement(node.parent.parent) ? node.parent.parent : undefined;
  if (variableStatement && declaration === node) {
    // In a multi-declaration statement, never include another initializer/body.
    const first = node.parent.declarations[0];
    const prefix = source.text.slice(variableStatement.getStart(source), first.getStart(source));
    result.signature = prefix + result.signature;
  }
  const doc = documentation(declaration) || documentation(node)
    || (variableStatement && documentation(variableStatement));
  if (doc) result.doc = doc;
  const key = `${position.line}:${position.character}`;
  // Wrapper declarations own their callable initializer's name position.
  if (!entries.has(key)) entries.set(key, result);
}
function visit(node) {
  const initializer = callable(node.initializer);
  if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)
      || ts.isPropertyAssignment(node)) && node.name && initializer) {
    const position = source.getLineAndCharacterOfPosition(node.name.getStart(source));
    callablePositions.push([position.line, position.character]);
    const outer = ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)
      && ts.isVariableStatement(node.parent.parent) && node.parent.declarations.length === 1
      ? node.parent.parent : node;
    add(node, node.name, initializer, outer);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && callable(node.right)) {
    const name = ts.isPropertyAccessExpression(node.left) ? node.left.name : node.left;
    const position = source.getLineAndCharacterOfPosition(name.getStart(source));
    callablePositions.push([position.line, position.character]);
    add(node, name, callable(node.right));
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    // Native callback captions are generated, but their selection starts at
    // the original anonymous function/arrow expression (UTF-16 getStart).
    add(node, node.name || node);
  } else if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
      || ts.isMethodSignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
      || ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isInterfaceDeclaration(node)
      || ts.isEnumDeclaration(node)) {
    if (node.name) add(node, node.name);
  } else if (ts.isConstructorDeclaration(node)) {
    const token = node.getChildren(source).find(child => child.kind === ts.SyntaxKind.ConstructorKeyword);
    if (token) add(node, token);
  }
  ts.forEachChild(node, visit);
}
visit(source);
process.stdout.write(JSON.stringify({callable_positions: callablePositions, metadata: [...entries.values()]}));
