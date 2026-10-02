"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readBundle } = require("./provider-accounts-host.cjs");

const releaseDirectory = path.resolve(process.argv[2] || "");
const codexHome = path.resolve(process.argv[3] || "");
if (!process.argv[2] || !path.isAbsolute(process.argv[2]) || !process.argv[3] || !path.isAbsolute(process.argv[3])) {
  throw new Error("Usage: node check-provider-accounts-release.cjs <absolute-release-directory> <new-absolute-fixture-codex-home>");
}
if (fs.existsSync(codexHome)) throw new Error("Fixture Codex home must be a new path.");

const bundle = readBundle(releaseDirectory, true);
const opencodexHome = path.join(codexHome, "azrael", "providers", "opencodex");
fs.mkdirSync(opencodexHome, { recursive: true });
const firstId = "10000000000000000000000000000001";
const secondId = "20000000000000000000000000000002";
fs.writeFileSync(path.join(opencodexHome, "auth.json"), JSON.stringify({
  devin: {
    activeAccountId: firstId,
    accounts: [
      {
        id: firstId,
        credential: {
          access: "private-fixture-a",
          refresh: "private-fixture-a",
          expires: Number.MAX_SAFE_INTEGER,
          accountId: "fixture-a",
          source: "oauth",
          apiBaseUrl: "https://server.codeium.com",
        },
        addedAt: 1,
      },
      {
        id: secondId,
        credential: {
          access: "private-fixture-b",
          refresh: "private-fixture-b",
          expires: Number.MAX_SAFE_INTEGER,
          accountId: "fixture-b",
          source: "oauth",
          apiBaseUrl: "https://eu.windsurf.com/_route/api_server",
        },
        addedAt: 2,
      },
    ],
    selectionRevision: "00000000-0000-4000-8000-000000000001",
  },
}, null, 2));

const childEnv = {
  ...process.env,
  CODEX_HOME: codexHome,
  OPENCODEX_HOME: opencodexHome,
};
delete childEnv.AZRAEL_PROVIDER_ACCOUNTS_HELPER;
delete childEnv.AZRAEL_PROVIDER_INFERENCE_HELPER;
delete childEnv.AZRAEL_PROVIDER_BUN;

function request(value) {
  const result = spawnSync(bundle.bun, [bundle.helper], {
    input: `${JSON.stringify({ protocol: 1, ...value })}\n`,
    encoding: "utf8",
    env: childEnv,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || "Provider accounts helper failed.");
  assert.equal(result.stderr, "");
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1, "Provider accounts helper returned an unexpected frame count.");
  const frame = JSON.parse(lines[0]);
  assert.equal(frame.id, value.id);
  assert.equal(frame.type, "result", frame.error);
  return frame.value;
}

const listed = request({ id: "list", action: "list" });
const devin = listed.providers.find(provider => provider.id === "devin");
assert.ok(devin);
assert.equal(devin.accounts.length, 2);
assert.deepEqual(devin.accounts.filter(account => account.selected).map(account => account.id), [firstId]);

const selected = request({ id: "selected", action: "credential", providerId: "devin" });
const exact = request({ id: "exact", action: "credential", providerId: "devin", accountId: secondId });
assert.deepEqual(selected, {
  api_key: "private-fixture-a",
  api_server_url: "https://server.codeium.com",
  account_id: firstId,
});
assert.deepEqual(exact, {
  api_key: "private-fixture-b",
  api_server_url: "https://eu.windsurf.com/_route/api_server",
  account_id: secondId,
});

let inferenceCatalogChecked = false;
if (bundle.inferenceHelper) {
  const result = spawnSync(bundle.bun, [bundle.inferenceHelper, "--catalog"], {
    encoding: "utf8", env: childEnv, windowsHide: true,
    timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, "Packaged provider inference catalog failed.");
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), { models: [], provider_statuses: [] });
  inferenceCatalogChecked = true;
}

process.stdout.write(`${JSON.stringify({
  releaseDirectory: bundle.releaseDirectory,
  fixtureCodexHome: codexHome,
  accounts: devin.accounts.length,
  selectedCredentialMatched: true,
  exactCredentialMatched: true,
  inferenceCatalogChecked,
  networkLoginQuotaCalls: 0,
})}\n`);
