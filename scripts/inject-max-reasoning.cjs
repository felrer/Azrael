"use strict";

const MAX_REASONING_ASSETS = [
  "webview/assets/app-initial-7a199c66e670.js",
  "webview/assets/app-initial-c014f9ee4429.js",
  "webview/assets/agent-settings-4d2487cc749f.js",
  "webview/assets/panel-8862779ad4db.js",
];
const MAX_REASONING_MARKER = "/*azrael-max-reasoning-v1*/";
// Availability overrides are inside the upstream supported-stage filters. They
// do not manufacture stages or alter authentication, defaults or selections.
const RULES = [
  [
    ["yC(e)&&a.has(e)", "yC(e)&&(e===`max`||a.has(e))"],
    ["(t==null||r==null||r.includes(t5[t]))", "(t==null||t5[t]===`max`||r==null||r.includes(t5[t]))"],
  ],
  [
    ["new Set([...vg(e,Pbe.enabledReasoningEfforts),`persistent`])", "new Set([...vg(e,Pbe.enabledReasoningEfforts),`persistent`,`max`])"],
    ["_=n==null?u(AMn):new Set([...n,`persistent`])", "_=new Set([...(n==null?u(AMn):n),`persistent`,`max`])"],
  ],
  [
    ["let r=Q.filter(e),a=d?.models.some(Ge)", "let r=Q.filter(e).filter(e=>e!==`max`),a=d?.models.some(Ge)"],
    ["if(d==null||r.length===0&&!a)", "if(d==null||r.length===0&&!a&&d.hasModelSupportingMaxReasoningEffort!==!0)"],
  ],
  [
    ["g=s==null?void 0:re(s)", "g=s==null?void 0:re(s).filter(e=>e!==`max`)"],
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
