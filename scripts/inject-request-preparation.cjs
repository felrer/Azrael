"use strict";

const ASSET = "webview/assets/app-initial-97d3534ad35f.js";
const MARKER = "/*azrael-request-preparation-v1*/";
// Keep parameters/overrides ahead of both reads, and apply their results in the
// native shell -> tools -> instructions order. Both promises are observed even
// if one rejects before the other completes.
const ORIGINAL_SHELL = "let c=t.readShellEnvironment;c!=null&&(t.markPreparation?.(`shell_environment_started`),o=await wDn(o,e.cwd,()=>c(n),async()=>e.hostConfig===void 0?p1(r,e.cwd,{priority:n,timeoutMs:500}):e.hostConfig,i),t.markPreparation?.(`shell_environment_finished`));";
const PATCHED_SHELL = "let c=t.readShellEnvironment;let azraelPreparationShell=(async()=>{if(c==null)return o;t.markPreparation?.(`shell_environment_started`);let a=await wDn(o,e.cwd,()=>c(n),async()=>e.hostConfig===void 0?p1(r,e.cwd,{priority:n,timeoutMs:500}):e.hostConfig,i);return t.markPreparation?.(`shell_environment_finished`),a})(),azraelPreparationTools=(async()=>{if(t.readDynamicTools==null)return null;t.markPreparation?.(`dynamic_tools_started`);let a=await t.readDynamicTools();return t.markPreparation?.(`dynamic_tools_finished`),a})();let azraelPreparationResults=await Promise.all([azraelPreparationShell,azraelPreparationTools]);o=azraelPreparationResults[0];";
const ORIGINAL_TOOLS = "if(t.readDynamicTools!=null){t.markPreparation?.(`dynamic_tools_started`);let n=await t.readDynamicTools();t.markPreparation?.(`dynamic_tools_finished`);let i=n.flatMap";
const PATCHED_TOOLS = "if(t.readDynamicTools!=null){let n=azraelPreparationResults[1];let i=n.flatMap";
const count = (text, token) => text.split(token).length - 1;

function injectRequestPreparation(text, asset) {
  if (asset !== ASSET) return { text, count: 0 };
  const originals = [ORIGINAL_SHELL, ORIGINAL_TOOLS];
  const patched = [PATCHED_SHELL, PATCHED_TOOLS];
  if (count(text, MARKER)) {
    if (count(text, MARKER) !== 1 || patched.some(anchor => count(text, anchor) !== 1) || originals.some(anchor => count(text, anchor))) {
      throw new Error("Damaged request preparation transformation");
    }
    return { text, count: 0 };
  }
  if (originals.some(anchor => count(text, anchor) !== 1) || patched.some(anchor => count(text, anchor))) {
    throw new Error("Pinned request preparation anchors must occur exactly once");
  }
  return { text: text.replace(ORIGINAL_SHELL, PATCHED_SHELL).replace(ORIGINAL_TOOLS, PATCHED_TOOLS) + `\n${MARKER}\n`, count: 1 };
}

module.exports = { ASSET, MARKER, injectRequestPreparation };
