"use strict";

// Keep the pinned masks without native ScrollTimeline lifecycle reentrance.
// Serialized into the renderer; layout reads and writes run in separate RAF passes.
function installScrollFadeFallback(view) {
  const document = view.document;
  const selector = ".horizontal-scroll-fade-mask,.vertical-scroll-fade-mask,.vertical-scroll-fade-mask-top,.vertical-scroll-fade-mask-bottom";
  const targets = new Set();
  const owned = new WeakMap();
  let frame = null, rescan = true, disposed = false;
  const schedule = (scan = false) => {
    if (disposed) return;
    rescan ||= scan;
    if (frame == null) frame = view.requestAnimationFrame(update);
  };
  const resize = new view.ResizeObserver(() => schedule());
  function restore(target) {
    for (const [property, [value, priority, last]] of owned.get(target) ?? []) {
      if (target.style.getPropertyValue(property) !== last) continue;
      if (value) target.style.setProperty(property, value, priority); else target.style.removeProperty(property);
    }
    owned.delete(target);
  }
  function update() {
    frame = null;
    const removed = [];
    if (rescan) {
      rescan = false;
      const found = new Set(document.querySelectorAll(selector));
      for (const target of targets) if (!found.has(target)) { resize.unobserve(target); targets.delete(target); removed.push(target); }
      for (const target of found) if (!targets.has(target)) { targets.add(target); resize.observe(target); }
    }
    const changes = [];
    for (const target of targets) {
      const horizontal = target.classList.contains("horizontal-scroll-fade-mask");
      const extent = horizontal ? target.scrollWidth - target.clientWidth : target.scrollHeight - target.clientHeight;
      const position = horizontal ? Math.abs(target.scrollLeft) : target.scrollTop;
      const progress = extent > 0 ? Math.max(0, Math.min(1, position / extent)) : 0;
      // These stops exactly match edge-fade(-horizontal/-top/-bottom).
      const transition = Math.max(0, Math.min(1, (progress - .01) / .98));
      const values = horizontal
        ? [Math.min(1, progress / .001), Math.min(1, (1 - progress) / .001)]
        : [target.classList.contains("vertical-scroll-fade-mask-top") ? 1 : target.classList.contains("vertical-scroll-fade-mask-bottom") ? 0 : transition, 1 - transition];
      changes.push([target, horizontal ? ["--left-fade", "--right-fade"] : ["--top-fade", "--bottom-fade"], extent > 0 ? values : [0, 0]]);
    }
    for (const target of removed) restore(target);
    for (const [target, properties, values] of changes) {
      let previous = owned.get(target);
      if (!previous) { previous = new Map(); owned.set(target, previous); }
      properties.forEach((property, index) => {
        const value = `calc(var(--edge-fade-distance, 1rem) * ${values[index]})`;
        if (target.style.getPropertyValue(property) !== value) {
          if (!previous.has(property)) previous.set(property, [target.style.getPropertyValue(property), target.style.getPropertyPriority(property)]);
          target.style.setProperty(property, value);
          previous.get(property)[2] = value;
        }
      });
    }
  }
  const mutations = new view.MutationObserver(records => schedule(records.some(record => record.type === "childList" || record.attributeName === "class")));
  mutations.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style"], characterData: true });
  const scroll = () => schedule();
  document.addEventListener("scroll", scroll, { capture: true, passive: true });
  view.addEventListener("resize", scroll);
  schedule(true);
  return () => {
    disposed = true;
    if (frame != null) view.cancelAnimationFrame(frame);
    resize.disconnect(); mutations.disconnect();
    document.removeEventListener("scroll", scroll, true);
    view.removeEventListener("resize", scroll);
    for (const target of targets) restore(target);
    targets.clear();
  };
}

module.exports = { installScrollFadeFallback };
