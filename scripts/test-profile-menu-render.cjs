"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const ts = require(process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH ?? require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const root = process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434");

test("production profile menu patch binds both commands to the real component despite local N boolean", () => {
  const verificationRoot = path.resolve(__dirname, "../artifacts/verification");
  fs.mkdirSync(verificationRoot, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(verificationRoot, "profile-menu-render-"));
  try {
    // Extract production functions with PowerShell's parser; never execute the
    // preparation script's top level, which copies an entire extension.
    const command = `
      $ErrorActionPreference = 'Stop'
      $source = $env:AZRAEL_MENU_SOURCE
      $ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$null, [ref]$null)
      foreach ($name in @('menuScriptRelativePath', 'menuSourceHash')) {
        $assignment = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq ('$' + $name) }, $true)
        if (-not $assignment) { throw "Missing production assignment $name" }
        . ([scriptblock]::Create($assignment.Extent.Text))
      }
      foreach ($name in @('Set-AccountMenuEntry', 'Get-Sha256', 'Assert-Hash')) {
        $function = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
        if (-not $function) { throw "Missing production function $name" }
        . ([scriptblock]::Create($function.Extent.Text))
      }
      $destinationAsset = Join-Path $env:AZRAEL_MENU_FIXTURE $menuScriptRelativePath
      New-Item -ItemType Directory -Force -Path (Split-Path $destinationAsset) | Out-Null
      Copy-Item -LiteralPath (Join-Path $env:AZRAEL_MENU_UPSTREAM $menuScriptRelativePath) -Destination $destinationAsset
      Set-AccountMenuEntry -Destination $env:AZRAEL_MENU_FIXTURE
      $firstHash = Get-Sha256 $destinationAsset
      Set-AccountMenuEntry -Destination $env:AZRAEL_MENU_FIXTURE
      if ((Get-Sha256 $destinationAsset) -cne $firstHash) { throw 'Profile menu patch is not idempotent' }
      Write-Output $menuScriptRelativePath
    `;
    const run = spawnSync("pwsh", ["-NoProfile", "-Command", command], {
      encoding: "utf8", timeout: 30000,
      env: { ...process.env, AZRAEL_MENU_SOURCE: path.join(__dirname, "prepare-official-ui.ps1"), AZRAEL_MENU_FIXTURE: fixture, AZRAEL_MENU_UPSTREAM: root },
    });
    assert.equal(run.error, undefined);
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const relative = run.stdout.trim();
    const originalFilename = path.resolve(root, relative), transformed = fs.readFileSync(path.join(fixture, relative), "utf8");
    const marker = JSON.parse(fs.readFileSync(path.join(fixture, ".azrael-profile-menu.json"), "utf8"));
    assert.equal(marker.schema, 6);
    // Resolve only the menu and its component owner. Loading the owner's whole
    // UI graph adds no evidence about this import's lexical binding.
    const compilerOptions = { allowJs: true, noLib: true, noEmit: true, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext };
    const host = ts.createCompilerHost(compilerOptions);
    host.resolveModuleNames = (names, containingFile) => names.map(name => path.resolve(containingFile) === originalFilename && name === "./app-initial-7a199c66e670.js"
      ? { resolvedFileName: path.resolve(path.dirname(originalFilename), name), extension: ts.Extension.Js }
      : undefined);
    const readSource = host.getSourceFile;
    host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) => path.resolve(filename) === originalFilename
      ? ts.createSourceFile(filename, transformed, languageVersion, true, ts.ScriptKind.JS)
      : readSource(filename, languageVersion, onError, shouldCreateNewSourceFile);
    const program = ts.createProgram([originalFilename], compilerOptions, host);
    const checker = program.getTypeChecker(), source = program.getSourceFile(originalFilename);
    assert.equal(source.parseDiagnostics.length, 0);
    const imported = source.statements.filter(ts.isImportDeclaration).flatMap(n => n.importClause?.namedBindings?.elements ?? [])
      .find(e => e.name.text === "L");
    assert(imported, "Profile component needs a distinct import binding");
    assert.equal(imported.propertyName.text, "a9");
    const component = checker.getAliasedSymbol(checker.getSymbolAtLocation(imported.name));
    assert(component.declarations?.length, "Pinned component export must resolve to an actual declaration");
    assert(component.declarations.some(d => path.basename(d.getSourceFile().fileName) === "app-initial-7a199c66e670.js"));
    assert(component.declarations.some(d => ts.isFunctionDeclaration(d) || ts.isVariableDeclaration(d)), "Component must have a value declaration");
    const calls = [];
    const visit = node => {
      if (ts.isCallExpression(node) && node.arguments.length >= 2 && ts.isObjectLiteralExpression(node.arguments[1]) &&
          node.arguments[1].properties.some(p => p.name?.text === "children" && /계정 및 사용량|루트 재개 예약/.test(p.initializer?.text ?? ""))) calls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(calls.length, 2);
    const commands = [];
    const menuItem = () => {};
    for (const call of calls) {
      assert(ts.isIdentifier(call.arguments[0]));
      const symbol = checker.getSymbolAtLocation(call.arguments[0]);
      assert.equal(checker.getAliasedSymbol(symbol), component, "Rendered component must resolve to the actual a9 export");
      let owner = call.parent;
      while (owner && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
      assert(owner);
      const shadowed = [];
      const findShadow = node => {
        if (ts.isVariableDeclaration(node) && node.name.text === "N") shadowed.push(node);
        ts.forEachChild(node, findShadow);
      };
      findShadow(owner);
      assert.equal(shadowed.length, 1);
      assert.equal(shadowed[0].initializer.getText(source), 'x===`apikey`');
      for (const N of [false, true]) {
        const context = { N, L: menuItem, ne: {}, s: () => {},
          yt: { dispatchMessage: (kind, payload) => { assert.equal(kind, "open-vscode-command"); commands.push(payload.command); } },
          $: { jsx: (type, props) => { assert.equal(typeof type, "function", "React rejects boolean element types"); return { type, props }; } } };
        const rendered = vm.runInNewContext(call.getText(source), context);
        assert.equal(rendered.type, menuItem);
        rendered.props.onClick();
      }
    }
    assert.deepEqual(commands, ["azrael-ex.usage", "azrael-ex.usage", "azrael-ex.rootResume", "azrael-ex.rootResume"]);
  } finally {
    const resolved = fs.realpathSync(fixture), owner = fs.realpathSync(verificationRoot);
    assert(resolved.startsWith(owner + path.sep) && path.basename(resolved).startsWith("profile-menu-render-"), "Unsafe fixture cleanup path");
    fs.rmSync(resolved, { recursive: true });
    assert.equal(fs.existsSync(resolved), false);
  }
});
