"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const pipeline = require("./namespace-azrael-host.cjs");
const ui = require("./inject-team-ui.cjs");
const runtime = require("./inject-team-runtime.cjs");
const project = path.resolve(__dirname, "..");
const pinned = path.join(project, "artifacts/upstream-ui/26.1007.21434");
const ts = require(require.resolve("typescript", { paths: [path.join(project, "extensions/azrael-ex")] }));
const sha = value => crypto.createHash("sha256").update(value).digest("hex");

test("Team transforms compose with native namespace, draft and session-flag owners", () => {
  for (const asset of [ui.ASSET, ...runtime.TEAM_RUNTIME_ASSETS]) {
    const input = fs.readFileSync(path.join(pinned, asset), "utf8");
    const result = pipeline.transformAsset(input, asset, asset, ts);
    assert(result.asset, asset);
    assert.equal(result.asset.sha256, sha(result.text), asset + " report must identify its final transformed bytes");
    assert.equal(result.asset.teamUIEdits ?? 0, asset === ui.ASSET ? 1 : 0, asset);
    assert.equal(result.asset.teamRuntimeEdits ?? 0, runtime.TEAM_RUNTIME_ASSETS.includes(asset) ? 1 : 0, asset);
    if (asset === runtime.HOST_ASSET) new vm.Script(result.text, { filename: asset });
    else assert.deepEqual(ts.createSourceFile(asset, result.text, ts.ScriptTarget.Latest, true).parseDiagnostics, [], asset);
    if (asset === ui.ASSET) {
      assert(result.text.includes("/*azrael-session-flags-v3*/"));
      assert(result.text.includes(ui.MARKER));
    } else assert(result.text.includes(runtime.MARKER));
  }
});

test("Maintained Lead instructions invalidate every affected runtime asset", () => {
  const rules = pipeline.getTransformRules();
  assert.equal(rules["team-design-collaboration"], sha(fs.readFileSync(path.join(project, "instructions/skills/design-collaboration/SKILL.md"))));
  assert.equal(rules["team-lead-guidance"], sha(fs.readFileSync(path.join(project, "instructions/skills/design-collaboration/references/team-lead.md"))));
  for (const asset of runtime.TEAM_RUNTIME_ASSETS) {
    const scoped = pipeline.getAssetTransformRules(asset, rules);
    assert.equal(scoped["team-design-collaboration"], rules["team-design-collaboration"]);
    assert.equal(scoped["team-lead-guidance"], rules["team-lead-guidance"]);
    assert.equal(scoped["inject-team-runtime.cjs"], rules["inject-team-runtime.cjs"]);
  }
  const unrelated = pipeline.getAssetTransformRules("webview/assets/unrelated.js", rules);
  assert.equal(unrelated["team-lead-guidance"], undefined);
  assert.equal(unrelated["inject-team-runtime.cjs"], undefined);
  for (const name of ["team-runtime-host.cjs", "team-change-service.cjs", "team-observability.cjs"]) {
    assert.equal(rules[name], sha(fs.readFileSync(path.join(project, "scripts", name))));
    assert.equal(pipeline.getAssetTransformRules(runtime.HOST_ASSET, rules)[name], rules[name]);
    assert.equal(pipeline.getAssetTransformRules(runtime.APP_ASSET, rules)[name], undefined);
    assert.equal(unrelated[name], undefined);
  }
});

test("Default local native selection accepts the Lead draft without a project assignment", async () => {
  const source = fs.readFileSync(path.join(pinned, runtime.BRIDGE_ASSET), "utf8");
  const nativeFunction = name => {
    const prefix = "async function " + name + "(";
    const start = source.indexOf(prefix);
    assert(start >= 0, name + " declaration must exist in the pinned owner");
    const end = source.indexOf("function ", start + prefix.length);
    assert(end > start, name + " next declaration boundary must exist");
    return source.slice(start, end).replace(/\s*async\s*$/, "");
  };
  const app = runtime.injectTeamRuntime(fs.readFileSync(path.join(pinned, runtime.APP_ASSET), "utf8"), runtime.APP_ASSET).text;
  const helper = app.slice(app.lastIndexOf(runtime.MARKER) + runtime.MARKER.length);
  for (const projectless of [false, true]) {
    const context = { globalThis: {}, Qmn: () => projectless, wu: roots => roots[0],
      mg: async () => ({ cwd: "C:/output", outputDirectory: "C:/output", workspaceRoot: "C:/output" }) };
    vm.runInNewContext(nativeFunction("$mn") + "\n" + nativeFunction("fQn") + "\n" + helper, context);
    const selection = await context.fQn({ hostId: "local", projectId: null, workspaceRoots: ["C:/project"] });
    assert.equal(selection.projectAssignment, undefined);
    context.globalThis.__azraelPendingTeamLeadDraft = { nativeDraft: true, token: "native-token", project: null };
    const request = context.azraelClaimLeadDraft("thread/start", { cwd: selection.cwd }, "local", selection);
    assert.equal(request.__azraelTeamLeadDraft.token, "native-token");
    assert.equal(request.__azraelTeamLeadDraft.project, null);
    assert.equal(request.cwd, selection.cwd);
  }
});
