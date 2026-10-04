const fs = require("node:fs");

const logFile = process.env.PROVIDER_FIXTURE_LOG;
const stateFile = process.env.PROVIDER_FIXTURE_STATE;
const hangActions = new Set((process.env.PROVIDER_FIXTURE_HANG_ACTIONS || "").split(",").filter(Boolean));

function append(entry) {
  fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");
}

function initialState() {
  return {
    oauthAccounts: [
      { id: "oauth-a", label: "OAuth A", selected: true, needsReauth: false },
      { id: "oauth-b", label: "OAuth B", selected: false, needsReauth: false }
    ],
    keyAccounts: [{ id: "key-a", label: "Key A", selected: true, needsReauth: false }],
    extraAccounts: [{ id: "extra-a", label: "Extra A", selected: true, needsReauth: false }]
  };
}

function readState() {
  if (!fs.existsSync(stateFile)) fs.writeFileSync(stateFile, JSON.stringify(initialState()));
  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

function writeState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state));
}

function snapshot() {
  const state = readState();
  return {
    providers: [
      {
        id: "oauth-provider", label: "OAuth Provider", authKind: "oauth", quotaMode: "probe",
        inferenceConnected: true, accounts: state.oauthAccounts,
        accessToken: "list-secret-must-be-dropped"
      },
      {
        id: "key-provider", label: "Key Provider", authKind: "apiKey", quotaMode: "passive",
        inferenceConnected: true, accounts: state.keyAccounts,
        apiKey: "list-key-must-be-dropped"
      },
      {
        id: "extra-provider", label: "Extra Provider", authKind: "oauth", quotaMode: "probe",
        inferenceConnected: true, accounts: state.extraAccounts
      }
    ],
    availableProviders: [
      { id: "oauth-provider", label: "OAuth Provider", authKind: "oauth", clientSecret: "drop-me" },
      { id: "key-provider", label: "Key Provider", authKind: "apiKey", token: "drop-me" },
      { id: "extra-provider", label: "Extra Provider", authKind: "oauth" }
    ],
    credentials: "drop-me"
  };
}

function send(id, type, value) {
  process.stdout.write(JSON.stringify({ id, type, ...(type === "result" ? { value } : value) }) + "\n");
}

let buffer = "";
let request;
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    const frame = JSON.parse(line);
    if (!request) handleRequest(frame);
    else handleAnswer(frame);
  }
});

function handleRequest(frame) {
  request = frame;
  append({
    event: "request", pid: process.pid, protocol: frame.protocol, id: frame.id, action: frame.action,
    providerId: frame.providerId, accountId: frame.accountId, force: frame.force, label: frame.label,
    keyReceived: typeof frame.key === "string", keyInArgv: process.argv.some(arg => typeof frame.key === "string" && arg.includes(frame.key)),
    argv: process.argv.slice(2), codeHome: process.env.CODEX_HOME, openCodexHome: process.env.OPENCODEX_HOME
  });

  if (process.env.PROVIDER_FIXTURE_MODE === "correlation-mismatch") {
    return send("wrong-" + frame.id, "result", snapshot());
  }
  if (process.env.PROVIDER_FIXTURE_MODE === "stderr-exit") {
    process.stderr.write("stderr-secret-credential-value\n");
    return process.exit(7);
  }
  if (hangActions.has(frame.action)) return setInterval(() => {}, 1000);

  const state = readState();
  switch (frame.action) {
    case "list":
      return send(frame.id, "result", snapshot());
    case "quotaBatch": {
      if (process.env.PROVIDER_FIXTURE_FAIL_NONFORCE_QUOTA === "1" && !frame.force) {
        return send(frame.id, "error", { error: "fixture quota rejection" });
      }
      const accounts = frame.providerId === "oauth-provider" ? state.oauthAccounts
        : frame.providerId === "key-provider" ? state.keyAccounts : state.extraAccounts;
      const result = {
        providerId: frame.providerId,
        quotas: accounts.map((account, index) => ({
          providerId: frame.providerId, accountId: account.id, status: "ok", source: "fixture",
          observedAt: 1_700_000_000_123 + index,
          rows: [{ label: "Monthly", usedPercent: 25, remaining: 75, limit: 100, unit: "requests", unlimited: false,
            resetsAt: 1_700_003_600, secret: "drop-row-secret" }],
          token: "drop-quota-secret"
        }))
      };
      const delay = Number(process.env.PROVIDER_FIXTURE_DELAY_QUOTA_MS || 0);
      return delay > 0 ? setTimeout(() => send(frame.id, "result", result), delay) : send(frame.id, "result", result);
    }
    case "select": {
      const accounts = frame.providerId === "oauth-provider" ? state.oauthAccounts : state.keyAccounts;
      for (const account of accounts) account.selected = account.id === frame.accountId;
      writeState(state);
      return send(frame.id, "result", { ok: true });
    }
    case "remove":
      if (frame.providerId === "oauth-provider") state.oauthAccounts = state.oauthAccounts.filter(account => account.id !== frame.accountId);
      else state.keyAccounts = state.keyAccounts.filter(account => account.id !== frame.accountId);
      writeState(state);
      return send(frame.id, "result", { ok: true });
    case "addKey":
      state.keyAccounts.push({ id: "key-added", label: frame.label || "Added key", selected: false, needsReauth: false });
      writeState(state);
      return send(frame.id, "result", { ok: true });
    case "login":
      if (process.env.PROVIDER_FIXTURE_LOGIN === "openUrl") {
        return send(frame.id, "openUrl", { url: "https://example.invalid/oauth" });
      }
      return send(frame.id, "prompt", { prompt: "Verification code", password: true });
    default:
      return send(frame.id, "error", { error: "unknown action" });
  }
}

function handleAnswer(frame) {
  append({ event: "answer", pid: process.pid, action: request.action, correlationOk: frame.id === request.id, type: frame.type, value: frame.value });
  if (frame.id !== request.id || frame.type !== "answer") return process.exit(8);
  send(request.id, "result", { ok: true });
}
