"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const { installScrollFadeFallback } = require("./scroll-fade.cjs");
const { injectScrollFade, CSS_ASSET, JS_ASSET } = require("./inject-scroll-fade.cjs");
const path = require("node:path");
const uiRoot = process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434");

test("production CSS and bootstrap injectors compose and bind both cache dependencies", () => {
  const namespace = require("./namespace-azrael-host.cjs");
  const ts = require(process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH ?? "../extensions/azrael-ex/node_modules/typescript");
  const rules = namespace.getTransformRules();
  const css = fs.readFileSync(path.join(uiRoot, CSS_ASSET), "utf8");
  const result = namespace.transformAsset(css, CSS_ASSET, CSS_ASSET, ts);

  assert.equal(namespace.transformAsset(result.text, CSS_ASSET, CSS_ASSET, ts).asset, null);
  const { injectContentFonts } = require("./inject-content-fonts.cjs");
  const leaf = '(0,Voa.jsx)(`span`,{className:f,children:u})';
  const fonts = injectContentFonts(leaf, JS_ASSET, ts);
  const bootstrap = injectScrollFade(fonts.text, JS_ASSET);

  // Other bootstrap owners can prepend their own scripts on later transforms.
  const composed = "/*another-bootstrap-owner*/\n" + bootstrap.text;

  assert.equal(ts.createSourceFile(JS_ASSET, composed, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0);
  for (const asset of [CSS_ASSET, JS_ASSET]) {
    const scoped = namespace.getAssetTransformRules(asset, rules);
    assert.ok(scoped["inject-scroll-fade.cjs"]);
    assert.equal(Boolean(scoped["scroll-fade.cjs"]), asset === JS_ASSET);
  }
  const unrelated = namespace.getAssetTransformRules("webview/assets/unrelated.js", rules);
  assert.equal(unrelated["inject-scroll-fade.cjs"], undefined);
  assert.equal(unrelated["scroll-fade.cjs"], undefined);
});

test("pinned fade transforms reject drift and preserve masks, keyframes and unrelated timelines", () => {
  const source = fs.readFileSync(path.join(uiRoot, CSS_ASSET), "utf8");
  const result = injectScrollFade(source, CSS_ASSET);

  assert.equal(injectScrollFade(result.text, CSS_ASSET).text, result.text);
  assert.throws(() => injectScrollFade(source.replace("scroll(self x)", "scroll(nearest x)"), CSS_ASSET), /Pinned/);
  assert.throws(() => injectScrollFade(result.text.replace("azrael-fade:edge-fade-top", "damaged"), CSS_ASSET), /Damaged/);

});

function fixture(classes) {
  let raf, mutations, resized, writes = 0, reads = 0;
  const attributes = new Map();
  const target = { classList: { contains: value => classes.includes(value) }, scrollWidth: 1100, clientWidth: 100, scrollLeft: 0, scrollHeight: 1100, clientHeight: 100, scrollTop: 0,
    style: { getPropertyValue: key => attributes.get(key) ?? "", getPropertyPriority: () => "", setProperty(key, value) { attributes.set(key, value); writes++; }, removeProperty: key => attributes.delete(key) } };
  const events = new Map(), targets = [target];
  const view = { document: { documentElement: {}, querySelectorAll() { reads++; return targets; }, addEventListener: (k, v) => events.set(k, v), removeEventListener: k => events.delete(k) },
    requestAnimationFrame(fn) { raf = fn; return 1; }, cancelAnimationFrame() { raf = null; }, addEventListener() {}, removeEventListener() {},
    MutationObserver: class { constructor(fn) { mutations = fn; } observe() {} disconnect() {} },
    ResizeObserver: class { constructor(fn) { resized = fn; } observe() {} unobserve() {} disconnect() {} } };
  const dispose = installScrollFadeFallback(view);
  const flush = () => { const fn = raf; raf = null; fn?.(); };
  return { target, attributes, classes, targets, dispose, flush, scroll: () => events.get("scroll")(), change: () => mutations([{ type: "childList" }]), resize: () => resized(), stats: () => ({ reads, writes }) };
}

test("vertical fades preserve native stops and refresh after hidden content expands", () => {
  const f = fixture(["vertical-scroll-fade-mask"]);
  f.flush(); assert.equal(f.attributes.get("--top-fade"), "calc(var(--edge-fade-distance, 1rem) * 0)");
  f.target.scrollTop = 500; f.scroll(); f.flush();
  assert.equal(f.attributes.get("--top-fade"), "calc(var(--edge-fade-distance, 1rem) * 0.5)");
  assert.equal(f.attributes.get("--bottom-fade"), "calc(var(--edge-fade-distance, 1rem) * 0.5)");
  f.target.scrollTop = 1000; f.scroll(); f.flush(); assert.match(f.attributes.get("--bottom-fade"), /\* 0\)/);
  f.target.scrollHeight = 100; f.resize(); f.flush(); assert.match(f.attributes.get("--top-fade"), /\* 0\)/);
  f.target.scrollHeight = 1100; f.resize(); f.flush(); assert.match(f.attributes.get("--top-fade"), /\* 1\)/);
  f.dispose(); assert.equal(f.attributes.size, 0);
});

test("horizontal fades update at both edges, coalesce scroll events and accept negative offsets", () => {
  const f = fixture(["horizontal-scroll-fade-mask"]); f.flush();
  assert.match(f.attributes.get("--left-fade"), /\* 0\)/); assert.match(f.attributes.get("--right-fade"), /\* 1\)/);
  f.target.scrollLeft = -500; for (let i = 0; i < 20; i++) f.scroll(); f.flush();
  assert.match(f.attributes.get("--left-fade"), /\* 1\)/); assert.match(f.attributes.get("--right-fade"), /\* 1\)/);
  const before = f.stats(); f.scroll(); f.flush(); assert.deepEqual(f.stats(), before);
  f.target.scrollLeft = -1000; f.scroll(); f.flush(); assert.match(f.attributes.get("--right-fade"), /\* 0\)/);
  f.dispose();
});

test("top/bottom variants and dynamically inserted scrollers remain independent", () => {
  for (const [variant, top] of [["vertical-scroll-fade-mask-top", 1], ["vertical-scroll-fade-mask-bottom", 0]]) {
    const f = fixture([variant]); f.flush();
    assert.match(f.attributes.get("--top-fade"), new RegExp("\\* " + top + "\\)"));
    f.targets.length = 0; f.change(); f.flush();
    assert.equal(f.attributes.size, 0);
    f.dispose();
  }
});
