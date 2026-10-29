"use strict";

// Execute the TypeScript host contracts without mutating its shared dist cache.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { beginArtifactRun, trackArtifactChild, finishArtifactRun } = require("./artifact-run.cjs");
const root = path.resolve(__dirname, "..");
const extension = path.join(root, "extensions/azrael-ex");
const run = beginArtifactRun(root, { workId: "management-recovery", owner: "scripts/check-management-recovery.cjs" });
const summary = { scope: "Windows host TypeScript typecheck and actual child bridge fixtures; no installed host or native engine execution", runRoot: run.runRoot, lifecycleId: run.lifecycleId };

async function main() {
  const ts = require(require.resolve("typescript", { paths: [extension] }));
  const config = ts.readConfigFile(path.join(extension, "tsconfig.json"), ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, extension);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true, typeRoots: [path.join(extension, "node_modules/@types")] });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  fs.writeFileSync(path.join(run.logs, "typecheck.log"), ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => extension, getNewLine: () => "\n",
  }));
  summary.typecheck = { diagnostics: diagnostics.length, exitCode: diagnostics.length ? 1 : 0 };
  if (diagnostics.length) throw Error("Host typecheck failed; see typecheck.log");
  const bootstrap = String.raw`
    const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
    const root = process.env.AZRAEL_RECOVERY_TEST_PROJECT;
    const extension = path.join(root, 'extensions/azrael-ex');
    const ts = require(require.resolve('typescript', {paths:[extension]}));
    const compile = filename => ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename
    }).outputText;
    require.extensions['.ts'] = (module, filename) => module._compile(compile(filename), filename);
    const nativeSpawn = cp.spawn;
    cp.spawn = (command, args, options) => {
      if (command === process.execPath && args?.length === 1 &&
          ['bridge-fixture.js','account-service-fixture.js'].includes(path.basename(args[0])) &&
          path.dirname(args[0]) === path.join(extension,'test')) {
        return nativeSpawn(command, ['-e', compile(args[0].replace(/\.js$/, '.ts'))], options);
      }
      return nativeSpawn(command, args, options);
    };
    require(path.join(extension,'test/accountService.test.ts'));
    require(path.join(extension,'test/bridgeTransport.test.ts'));
    require(path.join(root,'scripts/test-root-resume-controls.cjs'));
  `;
  const logPath = path.join(run.logs, "tests.log");
  const output = fs.openSync(logPath, "wx");
  let child;
  try {
    child = trackArtifactChild(run, spawn(process.execPath, ["-e", bootstrap], {
      cwd: root, windowsHide: true, stdio: ["ignore", output, output],
      env: { ...process.env, TMP: run.temporary, TEMP: run.temporary, TMPDIR: run.temporary, AZRAEL_RECOVERY_TEST_PROJECT: root },
    }));
  } finally { fs.closeSync(output); }
  summary.tests = await new Promise(resolve => {
    child.once("error", error => { summary.launchError = error.code; });
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal, logPath }));
  });
  run.producerStopped = child.artifactClosed;
  if (summary.tests.exitCode !== 0 || summary.tests.signal) throw Error("Management recovery tests failed; see tests.log");
  const count = fs.readFileSync(logPath, "utf8").match(/\btests (\d+)/);
  summary.tests.count = count ? Number(count[1]) : 0;
  if (!summary.tests.count) throw Error("Management recovery selection executed no tests");
}

main().catch(error => { summary.error = error.message; process.exitCode = 1; }).finally(async () => {
  // No asynchronous producer exists before the single tracked child launches.
  if (!run.children.size) run.producerStopped = true;
  summary.exitCode = process.exitCode || 0;
  fs.writeFileSync(path.join(run.logs, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  // A concurrent producer may briefly own the shared catalog. Reconcile this
  // completed execution without rerunning tests or changing the observed exit.
  for (let attempt = 0; ; attempt++) {
    try { finishArtifactRun(run, { exitCode: summary.exitCode, producerStopped: run.producerStopped }); break; }
    catch (error) {
      if (attempt >= 2 || !/OS lock busy/.test(error.message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  console.log(JSON.stringify(summary));
}).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
