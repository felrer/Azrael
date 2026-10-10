"use strict";

const MARKER = "/*azrael-url-safety-transport-v1*/";
const ANCHOR = "let f=await fetch(o,{method:r.method,headers:p,body:r.body,signal:n});if(f.ok)";
const CURRENT_ANCHOR = "let h=await fetch(o,{method:r.method,headers:m,body:r.body,signal:n});if(h.ok)";
const STABLE_ANCHOR = "let g=await fetch(o,{method:r.method,headers:m,body:r.body,signal:n}),y=!g.ok&&h?await D4e(g):null";
const TARGET_ANCHOR = "let g=await fetch(o,{method:r.method,headers:m,body:r.body,signal:n}),y=!g.ok&&h?await w6e(g):null";
const PINNED = [
  { anchor: TARGET_ANCHOR, logger: "function ie(){return fM}", response: "g", headers: "m", tail: ",y=!g.ok&&h?await w6e(g):null" },
  { anchor: STABLE_ANCHOR, logger: "function ie(){return uM}", response: "g", headers: "m", tail: ",y=!g.ok&&h?await D4e(g):null" },
  { anchor: ANCHOR, logger: "function Z(){return eC}", response: "f", headers: "p" },
  { anchor: CURRENT_ANCHOR, logger: "function J(){return XC}", response: "h", headers: "m" },
];

function replacement({ logger, response, headers, tail }) {
  const loggerAccessor = logger.match(/^function (\w+)\(\)/)[1];
  return `let ${response}=await require("./url-safety-transport.cjs").fetchUrlSafety(o,{method:r.method,headers:${headers},body:r.body,signal:n},fetch,(level,event,safe)=>${loggerAccessor}()[level](event,{safe,sensitive:{}}),Boolean(require("vscode").workspace.getConfiguration("http").get("proxy")))${tail ?? ";"}${MARKER}${tail == null ? `if(${response}.ok)` : ""}`;
}

function injectUrlSafetyTransport(text) {
  const markers = text.split(MARKER).length - 1;
  if (markers === 1 && PINNED.some((shape) => text.includes(replacement(shape)))) return { text, count: 0 };
  if (markers) throw new Error("Invalid URL safety transport marker");
  const matches = PINNED.filter(({ anchor }) => text.split(anchor).length - 1 === 1);
  if (matches.length !== 1 || PINNED.some(({ anchor }) => text.split(anchor).length - 1 > 1)) {
    throw new Error(`Pinned URL safety fetch anchor must occur exactly once: found ${matches.length}`);
  }
  const shape = matches[0];
  if (text.split(shape.logger).length - 1 !== 1) throw new Error("Pinned URL safety logger accessor changed.");
  return { text: text.replace(shape.anchor, replacement(shape)), count: 1 };
}

module.exports = { MARKER, ANCHOR, CURRENT_ANCHOR, STABLE_ANCHOR, TARGET_ANCHOR, injectUrlSafetyTransport };
