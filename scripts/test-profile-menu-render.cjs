"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const ts = require(process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH ?? require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const root = process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434");

test("production profile menu keeps account usage bound to the real component and omits root resume", () => {
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
    const transformed = fs.readFileSync(path.join(fixture, relative), "utf8");
    const marker = JSON.parse(fs.readFileSync(path.join(fixture, ".azrael-profile-menu.json"), "utf8"));
    assert.equal(marker.schema, 7);
    assert.equal(marker.rootResumeCommand, undefined);

    const source = ts.createSourceFile(relative, transformed, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(source.parseDiagnostics.length, 0);

    const calls = [];
    const visit = node => {
      if (ts.isCallExpression(node) && node.arguments.length >= 2 && ts.isObjectLiteralExpression(node.arguments[1]) &&
          node.arguments[1].properties.some(p => p.name?.text === "children" && /계정 및 사용량|루트 재개 예약/.test(p.initializer?.text ?? ""))) calls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);

    const commands = [];
    const menuItem = () => {};
    for (const call of calls) {

      for (const N of [false, true]) {
        const context = { N, L: menuItem, ne: {}, s: () => {},
          yt: { dispatchMessage: (kind, payload) => { assert.equal(kind, "open-vscode-command"); commands.push(payload.command); } },
          $: { jsx: (type, props) => { assert.equal(typeof type, "function", "React rejects boolean element types"); return { type, props }; } } };
        const rendered = vm.runInNewContext(call.getText(source), context);
        assert.equal(rendered.type, menuItem);
        rendered.props.onClick();
      }
    }
    assert.deepEqual(commands, ["azrael-ex.usage", "azrael-ex.usage"]);
  } finally {
    const resolved = fs.realpathSync(fixture), owner = fs.realpathSync(verificationRoot);
    assert(resolved.startsWith(owner + path.sep) && path.basename(resolved).startsWith("profile-menu-render-"), "Unsafe fixture cleanup path");
    fs.rmSync(resolved, { recursive: true });
    assert.equal(fs.existsSync(resolved), false);
  }
});
