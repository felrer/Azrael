"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const toml = require(require.resolve("smol-toml", { paths: [__dirname, path.join(__dirname, "../extensions/azrael-ex")] }));

async function buildDefaultProfiles(repoRoot) {
  const read = relative => fs.readFile(path.join(repoRoot, relative), "utf8");
  const rootSource = await read("engine/codex-rs/prompts/src/root_coordination_instructions.rs");
  const root = /pub const ROOT_COORDINATION_INSTRUCTIONS:\s*&str\s*=\s*r(#+)"([\s\S]*?)"\1\s*;/.exec(rootSource);
  if (!root || !root[2].trim()) throw Error("ROOT_COORDINATION_INSTRUCTIONS raw constant is missing");
  const profiles = [
    { id: "azrael-lead", name: "Lead default", allowedRoles: ["lead"], model: "gpt-6.1-sol", provider: "openai", reasoningEffort: "medium", instructions: `${await read("instructions/skills/design-collaboration/SKILL.md")}\n\n${await read("instructions/skills/design-collaboration/references/team-lead.md")}`, builtin: true },
    { id: "azrael-root", name: "Azrael default", allowedRoles: ["root"], model: "gpt-6.1-sol", provider: "openai", reasoningEffort: "medium", instructions: root[2], builtin: true },
  ];
  for (const id of ["sol_executor", "luna_explorer"]) {
    const agent = toml.parse(await read(`instructions/agents/${id}.toml`));
    if (typeof agent.model !== "string" || typeof agent.developer_instructions !== "string" || !agent.developer_instructions.trim()) throw Error(`Incomplete maintained builtin: ${id}`);
    profiles.push({ id, name: id, allowedRoles: ["subagent"], model: agent.model, provider: agent.model_provider || "openai", ...(agent.model_reasoning_effort ? { reasoningEffort: agent.model_reasoning_effort } : {}), instructions: agent.developer_instructions, builtin: true });
  }
  return profiles;
}

async function loadDefaultProfiles() {
  try {
    const profiles = JSON.parse(await fs.readFile(path.join(__dirname, "role-profile-defaults.json"), "utf8"));
    if (!Array.isArray(profiles)) throw Error("Invalid packaged role-profile defaults");
    return profiles;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return buildDefaultProfiles(path.resolve(__dirname, ".."));
}
module.exports = { loadDefaultProfiles, buildDefaultProfiles };
if (require.main === module) {
  const [repoRoot, destination, ...extra] = process.argv.slice(2);
  if (extra.length || !path.isAbsolute(repoRoot || "") || !path.isAbsolute(destination || "")) throw Error("Usage: role-profile-defaults.cjs ABS_REPOSITORY ABS_STAGE_DEFAULTS_JSON");
  buildDefaultProfiles(repoRoot).then(profiles => fs.writeFile(destination, JSON.stringify(profiles) + "\n", { flag: "wx" })).catch(error => { console.error(error.message); process.exitCode = 1; });
}
