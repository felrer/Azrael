"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

test("engine embeds the maintained provider-independent behavior exactly", () => {
  const maintained = fs.readFileSync(path.join(root, "instructions/instructions/agent-behavior.md"), "utf8");
  const embedded = fs.readFileSync(path.join(root, "engine/codex-rs/prompts/templates/agent_behavior.md"), "utf8");
  assert.equal(embedded, maintained);
});

test("native provider mappings preserve common behavior and V2 guidance", async () => {
  const { compileRequest } = await import("../providers/opencodex/inference-mapping.mjs");
  const { compileRequest: compileDevin } = await import("../providers/devin/mapping.mjs");
  const instructions = fs.readFileSync(path.join(root, "instructions/instructions/agent-behavior.md"), "utf8");
  const guidance = "<multi_agent_role>Use the V2 collaboration tools.</multi_agent_role>";
  const request = { type: "request", protocol_version: 1, request_id: "common-behavior", model: "fixture-model", instructions, input: [{ type: "message", role: "developer", content: [{ type: "input_text", text: guidance }] }], tools: [] };
  for (const compile of [compileRequest, compileDevin]) {
    const result = compile(request);
    assert.ok(result.messages.some(message => message.role === "system" && message.content === instructions));
    assert.ok(result.messages.some(message => message.role === "system" && message.content === guidance));
  }
});
