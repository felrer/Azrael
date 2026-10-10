"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), test = require("node:test");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { ASSET, MARKER, HELPER, injectSessionFlags } = require("./inject-session-flags.cjs");
const original = fs.readFileSync(path.resolve("artifacts/upstream-ui/26.1007.21434", ASSET), "utf8");

test("pinned local/recent rows transform once and fail closed on drift or damage", () => {
  const result = injectSessionFlags(original, ASSET);
  assert.equal(result.count, 1);
  assert.equal(injectSessionFlags(result.text, ASSET).count, 0);
  assert.equal(ts.createSourceFile(ASSET, result.text, 99, true, 1).parseDiagnostics.length, 0);
  for (const damaged of ["", original + original, result.text + MARKER, result.text.replace(HELPER, "")])
    assert.throws(() => injectSessionFlags(damaged, ASSET));
  assert.deepEqual(injectSessionFlags("unrelated", "other.js"), { text: "unrelated", count: 0 });
});

test("native preference writes isolate hosts, retain other flags, and prevent row actions", () => {
  let saved = {}, atom, prevent = 0, stop = 0;
  const jsx = (type, props) => ({ type, props });
  const context = { It() {}, Ce: (key, initial) => (atom = { key, initial }), l: () => saved,
    f: () => ({ set: (target, update) => { assert.equal(target, atom); saved = update(saved); } }),
    Re: {}, i: () => ({ formatMessage: message => message.defaultMessage }), Z: { jsx }, qe: "nativeRow" };
  vm.createContext(context); vm.runInContext(HELPER, context);
  const render = hostId => context.azraelFlaggedSessionRow({ hostId, conversationId: "thread", metaContent: "1h", onClick: "nativeNavigate" });
  const click = hostId => render(hostId).props.titleSuffix.props.onClick({ preventDefault() { prevent++; }, stopPropagation() { stop++; } });
  assert.equal(render("local").props.titleSuffix.props["aria-pressed"], false);
  click("local"); click("remote");
  assert.equal(render("local").props.titleSuffix.props["aria-pressed"], true);
  assert.equal(render("remote").props.titleSuffix.props["aria-pressed"], true);
  click("local");
  assert.equal(render("local").props.titleSuffix.props["aria-pressed"], false);
  assert.equal(render("remote").props.titleSuffix.props["aria-pressed"], true);
  assert.equal(Object.keys(saved).length, 1);
  assert.equal(prevent, 3); assert.equal(stop, 3);
  assert.equal(render("local").props.metaContent, "1h");
  assert.equal(render("local").props.onClick, "nativeNavigate");
  assert.equal(atom.key, "azrael-session-flags");
});

test("production pipeline reports flags and binds its owner to the header asset cache", () => {
  const { transformAsset, getAssetTransformRules } = require("./namespace-azrael-host.cjs");
  const result = transformAsset(original, ASSET, ASSET, ts);
  assert.equal(result.asset.sessionFlagEdits, 1);
  assert.ok(result.text.includes(HELPER));
  assert.ok(getAssetTransformRules(ASSET)["inject-session-flags.cjs"]);
  assert.equal(getAssetTransformRules("other.js")["inject-session-flags.cjs"], undefined);
});
