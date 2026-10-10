"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { UUID, parseSessionLink, registerMigrationCommand } = require("./session-links.cjs");
const { SESSION_LINK_ASSETS, LEGACY_SESSION_LINK_ASSETS, injectSessionLinks } = require("./inject-session-links.cjs");
// The fixture excludes font resource discovery: font binaries are not checked
// into this checkout. All actual namespace/injector code still runs unchanged.
const namespaceModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "namespace-azrael-host.cjs"), "utf8"), {
  module: namespaceModule, exports: namespaceModule.exports, __dirname, process, Buffer, performance,
  require(request) {
    if (request === "./content-fonts.cjs") return { ...require(request), getContentFontRules: () => ({}) };
    return require(request);
  },
});
const namespace = namespaceModule.exports;
const ts = require(require.resolve("typescript", { paths: [path.join(__dirname, "../extensions/azrael-ex")] }));
const id = "11111111-1111-4111-8111-111111111111";
const base = `azrael://threads/${id}`;

test("strict local parser, explicit migration boundary and launcher CLI", () => {
  assert.deepEqual(parseSessionLink(base), { id, canonicalUrl: base, vscodeUrl: `vscode://azrael-ex-local.azrael/local/${id}` });
  const query = "?view=review&diffFilter=branch&path=src%2Fa.ts";
  assert.equal(parseSessionLink(base + query).vscodeUrl, `vscode://azrael-ex-local.azrael/local/${id}${query}`);
  assert.equal(parseSessionLink(base + "?view=review&diffFilter=last-turn").canonicalUrl, base + "?view=review&diffFilter=last-turn");
  const legacy = base.replace("azrael:", "codex:");
  assert.throws(() => parseSessionLink(legacy));
  assert.equal(parseSessionLink(legacy, { allowLegacy: true }).canonicalUrl, base);
  for (const invalid of [base + "/turn/1", base + "/", base + "#turn", base + "?hostId=remote", base + "?threadAccess=read", base + "?artifact=document", base + "?view=other", base + "?diffFilter=commit", base + "?path=a", base + "?view=review&view=review", base.replace(id, "not-uuid"), base.replace("threads/", "user@threads/"), base.replace("threads/", "threads:80/"), base.replace(id, `other/../${id}`), ` ${base}`]) assert.throws(() => parseSessionLink(invalid), invalid);
  const fli = spawnSync(process.execPath, [path.join(__dirname, "session-links.cjs"), base], { encoding: "utf8" });
  assert.equal(fli.status, 0, fli.stderr);
  assert.deepEqual(JSON.parse(fli.stdout), parseSessionLink(base));
  assert.equal(spawnSync(process.execPath, [path.join(__dirname, "session-links.cjs"), legacy]).status, 1);
});

const functionCache = new Map();
function functionText(source, name) {
  if (functionCache.has(source)) return functionCache.get(source).get(name);
  const file = ts.createSourceFile("pinned.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(file.parseDiagnostics.length, 0);
  const result = new Map();
  const names = new Set(["B$n", "d2n", "HG", "Xlt", "Bht", "cct", "Hpt", "OPr", "R1r", "kPn", "QGn"]);
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) result.set(node.name.text, node.getText(file));
    if (ts.isObjectLiteralExpression(node) && node.properties.some(property =>
      ts.isPropertyAssignment(property) && property.name.getText(file) === "name" && property.initializer.text === "codexAutolink")) result.set("__autolink", node.getText(file));
    ts.forEachChild(node, visit);
  }
  visit(file);
  functionCache.set(source, result);
  assert(result.has(name), `Missing actual pinned function ${name}`);
  return result.get(name);
}

for (const [version, current] of [["26.928.31416", false], ["26.1007.21434", true]]) {
  test(`guarded pinned ${version} outgoing links, parsing, allowlists and preservation`, () => {
    const root = path.join(__dirname, "../artifacts/upstream-ui", version);
    const selected = current ? SESSION_LINK_ASSETS : LEGACY_SESSION_LINK_ASSETS;
    const transformed = new Map();
    for (const asset of selected) {
      const source = fs.readFileSync(path.join(root, asset), "utf8");
      const result = injectSessionLinks(source, asset);
      assert(result.count > 0);
      assert.equal(injectSessionLinks(result.text, asset).text, result.text);
      assert.throws(() => injectSessionLinks("anchor drift", asset), /anchor drift/);
      const file = ts.createSourceFile(asset, result.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
      assert.equal(file.parseDiagnostics.length, 0, asset);
      transformed.set(asset, result.text);
      assert.equal(fs.readFileSync(path.join(root, asset), "utf8"), source, "upstream source changed");
    }
    const copyName = current ? "d2n" : "B$n", copy = current ? "yk" : "qA", decorate = current ? "HG" : "yW";
    let copied;
    const copyScope = { URLSearchParams, [current ? "$m" : "eh"]: "local", [copy]: value => { copied = value; }, [decorate]: (url, host, access) => `${url}?hostId=${host}${access==null?"":"&threadAccess="+access}` };
    if(current)vm.runInNewContext(functionText(transformed.get(selected[1]),"HG"),copyScope);
    vm.runInNewContext(functionText(transformed.get(selected[1]), copyName) + `;${copyName}(${JSON.stringify(id)});`, copyScope);
    assert.equal(copied, base);
    vm.runInNewContext(functionText(transformed.get(selected[1]), copyName) + `;${copyName}(${JSON.stringify(id)},"remote");`, copyScope);
    assert.equal(copied, `codex://threads/${id}?hostId=remote`);
    if(current){
      vm.runInNewContext(functionText(transformed.get(selected[1]),copyName)+`;${copyName}(${JSON.stringify(id)},"local","read");`,copyScope);
      assert.equal(copied,`codex://threads/${id}?hostId=local&threadAccess=read`);
      assert.throws(()=>parseSessionLink(copied),"decorated sharing does not broaden local Azrael admission");
    }

    const core = transformed.get(selected[2]);
    const parser = current ? "Bht" : "Xlt", classifier = current ? "Hpt" : "cct", allowlist = current ? "R1r" : "OPr", handoff = current ? "QGn" : "kPn";
    assert(core.includes(`protocol:${current ? "Bu" : "xu"}(\`azrael:\`)`));
    const scope = { URL, URLSearchParams, [current ? "Nv" : "Zv"]: value => value, [current ? "Zgt" : "ddt"]: {
      safeParse(data) { return { success: UUID.test(data.conversationId) && data.protocol === "azrael:", data }; },
    }, [current ? "z1r" : "kPr"]: value => value.startsWith("/") && !value.startsWith("//"), [current ? "eKn" : "jPn"]: "{{ thread_url }}" };
    for (const name of [parser, classifier, allowlist, handoff]) vm.runInNewContext(functionText(core, name), scope);
    assert.equal(scope[parser](base).conversationId, id);
    assert.equal(scope[parser](base.replace("azrael:", "codex:")), null);
    assert.equal(scope[parser](base.replace(id, "invalid")), null);
    assert.equal(scope[parser](base + "?hostId=remote"), null);
    assert.equal(scope[parser](`codex://threads/${id}?hostId=remote`).conversationId, id);
    assert.equal(scope[parser](base + "/turn/1"), null);
    assert.equal(scope[parser](base + "?view=review&diffFilter=last-turn&path=a").reviewDiffFilter, "last-turn");
    assert.equal(scope[classifier](base).destination, "threads");
    assert.equal(scope[classifier](base.replace("azrael:", "codex:")), null);
    assert.equal(scope[classifier](`codex://threads/${id}?hostId=remote`).destination, "threads");
    for (const url of ["codex://review?pr=x", "codex://plugins/a", `codex://threads/${id}?artifact=document`]) assert(scope[classifier](url), url);
    assert.equal(scope[allowlist](base), true);
    assert.equal(scope[allowlist]("https://example.com/openai.chatgpt"), true);
    assert.equal(scope[handoff]("{{ thread_url }}", id), base);
    const autolinkScope = { [current ? "_o" : "tue"]: { prototype: { url(text) { return { raw: text.split(" ")[0] }; } } } };
    const autolink = vm.runInNewContext(`(${functionText(core, "__autolink")})`, autolinkScope);
    const lexer = { options: { tokenizer: {} }, state: { inLink: false, inRawBlock: false } };
    for (const url of [base, "codex://review?pr=x"]) {
      assert.equal(autolink.start(`text ${url}`), 5);
      assert.equal(autolink.tokenizer.call({ lexer }, `${url} following text`).href, url);
    }
    assert(transformed.get(selected[3]).includes('s=`azrael://threads/${a}`,c;'));
    assert(core.includes("codex:thread:"), "internal keys were removed");
    assert.deepEqual(namespace.ASSET_RULE_PATHS["inject-session-links.cjs"], SESSION_LINK_ASSETS);
    assert(namespace.getTransformRules()["session-links.cjs"]);
    if (current) {
      for (const asset of selected) {
        const source = fs.readFileSync(path.join(root, asset), "utf8");
        // Other feature injectors have independent pinned compatibility gates;
        // validate this transform after the actual namespace pass only.
        const namespaced = namespace.rewriteJavaScript(source, path.join(root, asset), ts);
        const combined = injectSessionLinks(namespaced.text, asset);
        assert(combined.count > 0, asset);
        assert.equal(ts.createSourceFile(asset, combined.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0);
      }
    }
  });
}

test("migration reads only the native Azrael store, copies owned threads and disposes registration", async () => {
  let handler, callback, copied, requested;
  const disposed = [];
  const messages = [];
  const vscode = { commands: { registerCommand(name, Qr) { assert.equal(name, "azrael.migrateSessionLink"); handler = Qr; return { dispose() { disposed.push("command"); } }; } },
    env: { clipboard: { async writeText(value) { copied = value; } } },
    window: { async showInputBox() { return undefined; }, async showInformationMessage(value) { messages.push(value); }, async showErrorMessage(value) { messages.push(value); } } };
  let owned = true;
  const connection = { registerProvider(name, value) { callback = value.onResult; return { dispose() { disposed.push("provider"); } }; },
    sendRequest(provider, requestId, method, params) {
      requested = { method, params };
      callback(owned ? { id: requestId, result: { thread: { id } } } : { id: requestId, error: { message: "Thread not found in Azrael" } });
    }, abandonRequest() {} };
  const registration = registerMigrationCommand(vscode, connection);
  assert.equal(await handler(`codex://threads/${id}`), base);
  assert.deepEqual(requested, { method: "thread/read", params: { threadId: id, includeTurns: false } });
  assert.equal(copied, base);
  copied = undefined; owned = false;
  await assert.rejects(handler(`codex://threads/${id}`), /not found/);
  assert.equal(copied, undefined);
  assert(messages.some(value => value.includes("Cannot migrate")));
  assert.equal(await handler(), undefined);
  registration.dispose();
  assert.deepEqual(disposed, ["command", "provider"]);
  const root = process.env.AZRAEL_PRESERVATION_UI_ROOT || path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434");
  const accountManifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../extensions/azrael-ex/package.json")));
  const manifest = namespace.transformManifest(JSON.parse(fs.readFileSync(path.join(root, "package.json"))), "0.5.0", accountManifest);
  assert(manifest.contributes.commands.some(value => value.command === "azrael.migrateSessionLink"));
});
