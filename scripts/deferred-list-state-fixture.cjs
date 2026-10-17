"use strict";
// Exercise the native list producer, rather than substituting its metadata snapshot.
const assert = require("node:assert/strict");
const vm = require("node:vm");
function createDeferredListStateFixture(source, ts) {
  const ast = ts.createSourceFile("native-list.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functionSource = name => {
    const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node, name);
    return node.getText(ast);
  };
  const methodSource = name => {
    const matches = [];
    const visit = node => {
      if (ts.isMethodDeclaration(node) && node.name?.getText(ast) === name) matches.push(node);
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.equal(matches.length, 1, name);
    return matches[0].getText(ast);
  };
  // Unrelated runtime admission and source/avatar metadata are external fixture inputs.
  const context = vm.createContext({ gQ: () => false, uQ: () => null, T_n: () => null });
  vm.runInContext(["pg", "h_n", "$Z", "__n", "rQ", "b_n", "aQ", "vQ", "Pbn", "F_n", "azraelIsRootResumePending"]
    .map(functionSource).join("\n"), context);
  const producer = vm.runInContext(`({listSummaryByConversation:new WeakMap(),
    access:{getHostId:()=>"local",readItemStatus:()=>null},
    ${methodSource("getListSummary")},${methodSource("getListState")}})`, context);
  return {
    getListState: conversation => producer.getListState(conversation),
    getMetadata: vm.runInContext("Pbn", context),
  };
}
module.exports = { createDeferredListStateFixture };
