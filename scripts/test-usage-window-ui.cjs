"use strict";

// Run the retained TypeScript tests from selected source, including frozen inputs
// that intentionally do not contain generated dist files. Type checking is separate.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const extension = path.resolve(__dirname, "../extensions/azrael-ex");
const ts = require(require.resolve("typescript", { paths: [extension] }));
const previous = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => {
  const relative = path.relative(extension, filename);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    if (previous) return previous(module, filename);
    throw new Error("TypeScript test loader only accepts the account module's source");
  }
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  });
  // This module's runtime-relative media import is rooted at dist/src in a build.
  if (filename === path.join(extension, "src/usagePresentation.ts")) {
    const requireFromModule = module.require.bind(module);
    module.require = request => requireFromModule(request === "../../media/content-font-policy.cjs"
      ? path.join(extension, "media/content-font-policy.cjs") : request);
  }
  module._compile(compiled.outputText, filename);
};
for (const name of ["usagePresentation", "usageWindowService", "usageTimerView"]) {
  require(path.join(extension, "test", name + ".test.ts"));
}
