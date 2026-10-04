import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { parseProviderQuota, parseProviderSnapshot, ProviderAccountService } from "../src/providerAccountService";

const SNAPSHOT = {
  providers: [{
    id: "provider", label: "Provider", authKind: "oauth", quotaMode: "probe", inferenceConnected: true,
    accounts: [{ id: "account", label: "Account", selected: true, needsReauth: false }]
  }],
  availableProviders: [{ id: "provider", label: "Provider", authKind: "oauth" }]
};

test("usage boundary validates additive spend and unset cap fields", () => {
  const input = { providerId: "openrouter", accountId: "key", status: "ok", source: "key-info", observedAt: 1,
    rows: [{ label: "Cap", limitUnset: true, unit: "USD" }, { label: "Lifetime", used: 42, unit: "USD", secret: "drop" }] };
  const parsed = parseProviderQuota(input, "openrouter", "key");
  assert.deepEqual(parsed.rows, [{ label: "Cap", limitUnset: true, unit: "USD" }, { label: "Lifetime", used: 42, unit: "USD" }]);
  for (const row of [{ label: "Bad", used: -1 }, { label: "Bad", used: "42" }, { label: "Bad", used: Infinity },
    { label: "Bad", limitUnset: "true" }, { label: "Bad", limitUnset: true, limit: 0 }]) {
    assert.throws(() => parseProviderQuota({ ...input, rows: [row] }, "openrouter", "key"), /Invalid provider usage/);
  }
});

test("snapshot and quota parsing reject malformed identity and expose only public display fields", () => {
  const parsed = parseProviderSnapshot({
    ...SNAPSHOT,
    credentials: "secret",
    providers: [{ ...SNAPSHOT.providers[0], accessToken: "secret", accounts: [{ ...SNAPSHOT.providers[0].accounts[0], refreshToken: "secret" }] }],
    availableProviders: [{ ...SNAPSHOT.availableProviders[0], clientSecret: "secret" }]
  });
  assert.deepEqual(parsed, SNAPSHOT);
  assert.throws(() => parseProviderSnapshot({ ...SNAPSHOT, providers: [SNAPSHOT.providers[0], SNAPSHOT.providers[0]] }), /provider identity/);
  assert.throws(() => parseProviderSnapshot({ ...SNAPSHOT, providers: [{ ...SNAPSHOT.providers[0], accounts: [SNAPSHOT.providers[0].accounts[0], SNAPSHOT.providers[0].accounts[0]] }] }), /account identity/);
  assert.throws(() => parseProviderSnapshot({ ...SNAPSHOT, providers: [{ ...SNAPSHOT.providers[0], accounts: [{ ...SNAPSHOT.providers[0].accounts[0], id: "bad\nidentity" }] }] }), /account identity/);

  const quota = parseProviderQuota({ providerId: "provider", accountId: "account", status: "ok", source: "fixture", observedAt: 1,
    rows: [{ label: "Monthly", remaining: 4, secret: "drop" }], token: "drop" }, "provider", "account");
  assert.deepEqual(quota, { providerId: "provider", accountId: "account", status: "ok", source: "fixture", observedAt: 1,
    rows: [{ label: "Monthly", remaining: 4 }] });
  assert.throws(() => parseProviderQuota({ ...quota, accountId: "other" }, "provider", "account"), /requested account/);
});

test("key-mode and OpenAI helper identities are unavailable without changing OAuth identities", () => {
  const parsed = parseProviderSnapshot({
    providers: [SNAPSHOT.providers[0],
      { id: "key-provider", authKind: "apiKey", accounts: "unreadable key-mode data" },
      { ...SNAPSHOT.providers[0], id: "openai" }],
    availableProviders: [SNAPSHOT.availableProviders[0],
      { id: "key-provider", label: "Key Provider", authKind: "apiKey" },
      { id: "openai", label: "OpenAI", authKind: "oauth" }],
  });
  assert.deepEqual(parsed, SNAPSHOT);
});

test("spawned list sanitizes unknown secret fields and overrides the provider home", async () => {
  await withFixture({}, async ({ service, records, codexHome }) => {
    const snapshot = await service.refresh();
    assert.equal(JSON.stringify(snapshot).includes("secret"), false);
    assert.deepEqual(snapshot.providers.map(provider => provider.id), ["oauth-provider", "extra-provider"]);
    assert.deepEqual(snapshot.availableProviders.map(provider => provider.id), ["oauth-provider", "extra-provider"]);
    assert.deepEqual(Object.keys(snapshot.providers[0]).sort(), ["accounts", "authKind", "id", "inferenceConnected", "label", "quotaMode"]);
    const request = records().find(record => record.event === "request");
    assert.equal(request?.codeHome, codexHome);
    assert.equal(request?.openCodexHome, path.join(codexHome, "azrael", "providers", "opencodex"));
  });
});

test("concurrent quota reads share one provider batch and preserve exact account attribution without selection", async () => {
  await withFixture({}, async ({ service, records }) => {
    await service.refresh();
    const [quotaA, quotaB] = await Promise.all([
      service.quota("oauth-provider", "oauth-a", true),
      service.quota("oauth-provider", "oauth-b", true)
    ]);
    assert.deepEqual([quotaA.accountId, quotaB.accountId], ["oauth-a", "oauth-b"]);
    assert.equal(quotaA.observedAt, 1_700_000_000_123);
    assert.deepEqual(quotaA.rows[0], { label: "Monthly", usedPercent: 25, remaining: 75, limit: 100, unit: "requests",
      unlimited: false, resetsAt: 1_700_003_600 });
    assert.equal(JSON.stringify([quotaA, quotaB]).includes("secret"), false);
    const requests = records().filter(record => record.event === "request");
    assert.deepEqual(requests.map(record => record.action), ["list", "quotaBatch"]);
    assert.deepEqual({ protocol: requests[1].protocol, providerId: requests[1].providerId, accountId: requests[1].accountId, force: requests[1].force },
      { protocol: 1, providerId: "oauth-provider", accountId: undefined, force: true });
  });
});

test("quota batches from a stale account-list revision are rejected", async () => {
  await withFixture({ PROVIDER_FIXTURE_DELAY_QUOTA_MS: "80" }, async ({ service, records }) => {
    await service.refresh();
    const quota = service.quota("oauth-provider", "oauth-a");
    const rejected = assert.rejects(quota, /list changed during usage refresh/);
    await waitUntil(() => records().some(record => record.action === "quotaBatch"));
    await service.refresh();
    await rejected;
  });
});

test("quota rejection backs off normal refreshes while force bypasses the backoff", async () => {
  await withFixture({ PROVIDER_FIXTURE_FAIL_NONFORCE_QUOTA: "1" }, async ({ service, records }) => {
    await service.refresh();
    await assert.rejects(service.quota("oauth-provider", "oauth-a"), /fixture quota rejection/);
    await service.refresh();
    await assert.rejects(service.quota("oauth-provider", "oauth-a"), /temporarily backed off/);
    assert.equal(records().filter(record => record.action === "quotaBatch").length, 1);
    const forced = await service.quota("oauth-provider", "oauth-a", true);
    assert.equal(forced.accountId, "oauth-a");
    assert.equal(records().filter(record => record.action === "quotaBatch").length, 2);
  });
});

test("select and remove publish only the state returned by their refresh", async () => {
  await withFixture({}, async ({ service, records }) => {
    await service.refresh();
    await service.select("oauth-provider", "oauth-b");
    assert.equal(service.snapshot?.providers[0].accounts.find(account => account.id === "oauth-b")?.selected, true);
    assert.equal(service.snapshot?.providers[0].accounts.find(account => account.id === "oauth-a")?.selected, false);
    await service.remove("oauth-provider", "oauth-b");
    assert.deepEqual(service.snapshot?.providers[0].accounts.map(account => account.id), ["oauth-a"]);
    assert.deepEqual(records().filter(record => record.event === "request").map(record => record.action),
      ["list", "select", "list", "remove", "list"]);
    await assert.rejects(service.quota("oauth-provider", "oauth-b"), /Unknown provider account/);
  });
});

test("key-mode helper accounts cannot be selected, removed, queried, or logged into", async () => {
  await withFixture({}, async ({ service, records }) => {
    await service.refresh();
    await assert.rejects(service.quota("key-provider", "key-a"), /Unknown provider account/);
    await assert.rejects(service.select("key-provider", "key-a"), /Unknown provider account/);
    await assert.rejects(service.remove("key-provider", "key-a"), /Unknown provider account/);
    await assert.rejects(service.login("key-provider"), /Unknown provider/);
    assert.deepEqual(records().filter(record => record.event === "request").map(record => record.action), ["list"]);
  });
});

test("login prompt and URL replies preserve correlation and cancellation values", async () => {
  await withFixture({}, async ({ service, records, interaction }) => {
    interaction.promptResult = undefined;
    await service.refresh();
    await service.login("oauth-provider");
    const answer = records().find(record => record.event === "answer");
    assert.deepEqual({ correlationOk: answer?.correlationOk, type: answer?.type, value: answer?.value },
      { correlationOk: true, type: "answer", value: null });
    assert.deepEqual(interaction.prompts, [{ message: "Verification code", password: true }]);
  });

  await withFixture({ PROVIDER_FIXTURE_LOGIN: "openUrl" }, async ({ service, records, interaction }) => {
    interaction.openResult = false;
    await service.refresh();
    await service.login("oauth-provider");
    const answer = records().find(record => record.event === "answer");
    assert.deepEqual({ correlationOk: answer?.correlationOk, value: answer?.value }, { correlationOk: true, value: null });
    assert.deepEqual(interaction.urls, ["https://example.invalid/oauth"]);
  });
});

test("protocol correlation mismatches fail closed", async () => {
  await withFixture({ PROVIDER_FIXTURE_MODE: "correlation-mismatch" }, async ({ service }) => {
    await assert.rejects(service.refresh(), /identity mismatch/);
    assert.match(service.error ?? "", /identity mismatch/);
  });
});

test("cancelLogin kills only its login helper and dispose kills remaining helpers", async () => {
  await withFixture({ PROVIDER_FIXTURE_HANG_ACTIONS: "login,quotaBatch" }, async ({ service, records }) => {
    await service.refresh();
    const login = service.login("oauth-provider");
    const quota = service.quota("oauth-provider", "oauth-a");
    await waitUntil(() => records().filter(record => record.action === "login" || record.action === "quotaBatch").length === 2);
    const loginPid = Number(records().find(record => record.action === "login")?.pid);
    const quotaPid = Number(records().find(record => record.action === "quotaBatch")?.pid);
    service.cancelLogin();
    await assert.rejects(login, /canceled/);
    await waitUntil(() => !isProcessAlive(loginPid));
    assert.equal(isProcessAlive(quotaPid), true);
    service.dispose();
    await assert.rejects(quota, /canceled/);
    await waitUntil(() => !isProcessAlive(quotaPid));
  });
});

test("only two provider quota helpers run concurrently and dispose cancels the queued batch", async () => {
  await withFixture({ PROVIDER_FIXTURE_HANG_ACTIONS: "quotaBatch" }, async ({ service, records }) => {
    await service.refresh();
    const pending = [
      service.quota("oauth-provider", "oauth-a"),
      service.quota("extra-provider", "extra-a"),
      service.quota("oauth-provider", "oauth-a", true)
    ];
    const settled = Promise.allSettled(pending);
    await waitUntil(() => records().filter(record => record.action === "quotaBatch").length === 2);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(records().filter(record => record.action === "quotaBatch").length, 2);
    const runningPids = records().filter(record => record.action === "quotaBatch").map(record => Number(record.pid));
    service.dispose();
    const outcomes = await settled;
    assert.equal(outcomes.every(outcome => outcome.status === "rejected" && /canceled/.test(String(outcome.reason))), true);
    await waitUntil(() => runningPids.every(pid => !isProcessAlive(pid)));
  });
});

test("helper stderr secrets are omitted from surfaced errors", async () => {
  await withFixture({ PROVIDER_FIXTURE_MODE: "stderr-exit" }, async ({ service }) => {
    await assert.rejects(service.refresh(), error => {
      assert(error instanceof Error);
      assert.equal(error.message.includes("stderr-secret-credential-value"), false);
      assert.match(error.message, /ended without a result/);
      return true;
    });
    assert.equal((service.error ?? "").includes("stderr-secret-credential-value"), false);
  });
});

type RecordValue = Record<string, unknown>;
class InteractionFixture {
  readonly urls: string[] = [];
  readonly prompts: Array<{ message: string; password: boolean }> = [];
  openResult = true;
  promptResult: string | undefined = "code";
  async openUrl(url: string): Promise<boolean> { this.urls.push(url); return this.openResult; }
  async prompt(message: string, password: boolean): Promise<string | undefined> {
    this.prompts.push({ message, password }); return this.promptResult;
  }
}

async function withFixture(
  environment: NodeJS.ProcessEnv,
  run: (fixture: { service: ProviderAccountService; records(): RecordValue[]; codexHome: string; interaction: InteractionFixture }) => Promise<void>
): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-provider-service-"));
  const logFile = path.join(directory, "fixture.log");
  const stateFile = path.join(directory, "state.json");
  const codexHome = path.join(directory, "codex-home");
  const helper = path.resolve(__dirname, "../../test/provider-helper-fixture.cjs");
  const interaction = new InteractionFixture();
  const service = new ProviderAccountService(codexHome, {
    ...process.env,
    ...environment,
    AZRAEL_PROVIDER_BUN: process.execPath,
    AZRAEL_PROVIDER_ACCOUNTS_HELPER: helper,
    PROVIDER_FIXTURE_LOG: logFile,
    PROVIDER_FIXTURE_STATE: stateFile,
    OPENCODEX_HOME: path.join(directory, "must-be-overridden")
  }, interaction);
  const records = (): RecordValue[] => fs.existsSync(logFile)
    ? fs.readFileSync(logFile, "utf8").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as RecordValue)
    : [];
  try {
    await run({ service, records, codexHome, interaction });
  } finally {
    service.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("condition was not reached");
}
