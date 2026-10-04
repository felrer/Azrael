"use strict";

const MAX_REASONING_ASSETS = [
  "webview/assets/app-initial-8b38f95f65ff.js",
  "webview/assets/app-initial-7d34126aa1b5.js",
  "webview/assets/agent-settings-17b70a93dcfc.js",
  "webview/assets/panel-d29764dc637b.js",
];
const MAX_REASONING_MARKER = "/*azrael-max-reasoning-v1*/";
// Availability overrides are inside the upstream supported-stage filters. They
// do not manufacture stages or alter authentication, defaults or selections.
const RULES = [
  [
    ["qC(e)&&i.has(e)", "qC(e)&&(e===`max`||i.has(e))"],
    ["(t==null||r==null||r.includes($8[t]))", "(t==null||$8[t]===`max`||r==null||r.includes($8[t]))"],
  ],
  [
    ["new Set([...qg(e,mWe.enabledReasoningEfforts),`persistent`])", "new Set([...qg(e,mWe.enabledReasoningEfforts),`persistent`,`max`])"],
    ["let p=n==null?u(hSn):new Set([...n,`persistent`])", "let p=new Set([...(n==null?u(hSn):n),`persistent`,`max`])"],
  ],
  [
    ["let r=Z.filter(e),i=l?.models.some(We)", "let r=Z.filter(e).filter(e=>e!==`max`),i=l?.models.some(We)"],
    ["if(l==null||r.length===0&&!i)", "if(l==null||r.length===0&&!i&&l.hasModelSupportingMaxReasoningEffort!==!0)"],
  ],
  [
    ["h=s==null?void 0:p(s)", "h=s==null?void 0:p(s).filter(e=>e!==`max`)"],
  ],
];
function injectMaxReasoning(text, asset) {
  const index = MAX_REASONING_ASSETS.indexOf(asset);
  if (index < 0) return { text, count: 0 };
  const markers = text.split(MAX_REASONING_MARKER).length - 1;
  if (markers > 1) throw new Error("Duplicate Max reasoning marker");
  if (markers === 1) return { text, count: 0 };
  for (const [before, after] of RULES[index]) {
    const count = text.split(before).length - 1;
    if (count !== 1) throw new Error(`Pinned Max reasoning anchor must occur once (found ${count}): ${before}`);
    text = text.replace(before, after);
  }
  return { text: text + "\n" + MAX_REASONING_MARKER, count: 1 };
}
module.exports = { MAX_REASONING_ASSETS, MAX_REASONING_MARKER, injectMaxReasoning };
