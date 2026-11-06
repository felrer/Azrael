"use strict";
// Keep the metadata boundary check: later UI expansion must not expose MCP secrets.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path");
const { readComposerResources, resolveComposerResource } = require("../instruction-workbench-resources.cjs");
async function fixture() {
  const base = process.env.AZRAEL_WORKBENCH_TEST_ROOT;
  if (!base) throw Error("Run through check-instruction-workbench.cjs");
  return fs.mkdtemp(path.join(base, "composer-resources-"));
}
test("composer exposes safe configured MCP identities without commands, URLs or credentials", async () => {
  const home = await fixture();
  await fs.writeFile(path.join(home, "config.toml"), '[mcp_servers.private_docs]\nurl="https://secret.example/api"\nbearer_token_env_var="PRIVATE_KEY"\n[mcp_servers.private_docs.http_headers]\nAuthorization="secret-header"\n[mcp_servers.node_repl]\ncommand="required-runtime"\n');
  const result = await readComposerResources({ codexHome: home });
  assert.equal(result.core.id, "azrael-core");
  assert.deepEqual(result.resources.map(r => r.id), ["host:mcp:private_docs"]);
  const serialized = JSON.stringify(result);
  for (const forbidden of ["secret.example", "PRIVATE_KEY", "secret-header", "required-runtime"]) assert.equal(serialized.includes(forbidden), false);
});
test("installed skill resolution includes support bytes and accepts only discovered resource identities", async () => {
  const home = await fixture(), directory = path.join(home, "skills", "example");
  await fs.mkdir(path.join(directory, "references"), { recursive: true });
  await fs.writeFile(path.join(directory, "SKILL.md"), "---\nname: example\ndescription: Example skill\n---\nRead the reference.\n");
  await fs.writeFile(path.join(directory, "references", "guide.md"), "support bytes");
  await fs.writeFile(path.join(home, "config.toml"), '[[skills.config]]\nname="example"\nenabled=false\n');
  const inventory = await readComposerResources({ codexHome: home });
  assert.equal(inventory.resources[0].name, "example");
  assert.equal(inventory.resources[0].directory, undefined);
  assert.equal(inventory.resources[0].component, undefined);
  assert.equal(inventory.resources[0].defaultEnabled, false);
  const selected = await resolveComposerResource(inventory.resources[0].id, { codexHome: home });
  assert.equal(selected.component.files.find(f => f.path === "references/guide.md").content, "support bytes");
  await assert.rejects(resolveComposerResource("../../config.toml", { codexHome: home }));
});
