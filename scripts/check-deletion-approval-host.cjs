"use strict";
// Type-check and execute the actual host tests entirely in memory.
const fs = require("node:fs"), path = require("node:path");
const extension = path.resolve(__dirname, "../extensions/azrael-ex");
const ts = require(require.resolve("typescript", { paths: [extension] }));
const config = ts.readConfigFile(path.join(extension, "tsconfig.json"), ts.sys.readFile);
if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, extension);
const options = { ...parsed.options, noEmit: true, typeRoots: [path.join(extension, "node_modules/@types")] };
const testFile = path.join(extension, "test/chatSession.test.ts");
const program = ts.createProgram([testFile], options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: file => file, getCurrentDirectory: () => extension, getNewLine: () => "\n",
}));
require.extensions[".ts"] = (module, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { ...parsed.options, sourceMap: false }, fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};
require(testFile);
