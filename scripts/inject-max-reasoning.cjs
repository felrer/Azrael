"use strict";

const MAX_REASONING_ASSETS = [
  "webview/assets/app-initial-532d60c9b397.js",
  "webview/assets/app-initial-5120fa5fe295.js",
  "webview/assets/agent-settings-88a967588321.js",
  "webview/assets/panel-f5a3846c3434.js",
];
const MAX_REASONING_MARKER = "/*azrael-max-reasoning-v1*/";
// Availability overrides are inside the upstream supported-stage filters. They
// do not manufacture stages or alter authentication, defaults or selections.
const RULES = [
  [
    ["ZC(e)&&i.has(e)", "ZC(e)&&(e===`max`||i.has(e))"],
    ["(t==null||r==null||r.includes($8[t]))", "(t==null||$8[t]===`max`||r==null||r.includes($8[t]))"],
  ],
  [
    ["new Set([...Wg(e,JXe.enabledReasoningEfforts),`persistent`])", "new Set([...Wg(e,JXe.enabledReasoningEfforts),`persistent`,`max`])"],
    ["let p=n==null?u(_Sn):new Set([...n,`persistent`])", "let p=new Set([...(n==null?u(_Sn):n),`persistent`,`max`])"],
  ],
  [
    ["let r=Z.filter(e),i=l?.models.some(We)", "let r=Z.filter(e).filter(e=>e!==`max`),i=l?.models.some(We)"],
    ["if(l==null||r.length===0&&!i)", "if(l==null||r.length===0&&!i&&l.hasModelSupportingMaxReasoningEffort!==!0)"],
  ],
  [
    ["m=s==null?void 0:f(s)", "m=s==null?void 0:f(s).filter(e=>e!==`max`)"],
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
