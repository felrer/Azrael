import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [engineArg, stateArg] = process.argv.slice(2);
if (!engineArg || !stateArg) throw new Error("Usage: check-openai-catalog.mjs <engine> <Azrael state home>");
const stateRoot = resolve(stateArg);
const liveRoot = resolve(homedir(), ".azrael-ex").toLowerCase();
if (stateRoot.toLowerCase() === liveRoot || stateRoot.toLowerCase().startsWith(`${liveRoot}\\`)) {
  throw new Error("Live Azrael state is not a safe catalog fixture; pass a verified state copy.");
}
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(OPENAI|CODEX|ANTHROPIC|AZURE_OPENAI)_/.test(key) || key === "OPENCODEX_HOME" || /(?:^|_)API_?(?:KEY|TOKEN)(?:_|$)/.test(key) || key.startsWith("AZRAEL_")) delete env[key];
}
env.CODEX_HOME = stateRoot;
env.OPENCODEX_HOME = join(stateRoot, "azrael", "providers", "opencodex");
env.AZRAEL_EX_MANAGEMENT_SOCKET = join(tmpdir(), `azo-${randomBytes(6).toString("hex")}`, "m.sock");
const child = spawn(resolve(engineArg), ["app-server"], { cwd: process.cwd(), env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
let stdout = "";
let stderrBytes = 0;
let stderrText = "";
let done = false;
let nextRequestId = 2;
let pageCount = 0;
const models = [];
const catalogs = [];
const timer = setTimeout(() => fail("model catalog timed out"), 45_000);
child.stderr.on("data", chunk => { stderrBytes += chunk.length; stderrText = (stderrText + chunk.toString("utf8")).slice(0, 800); });
child.on("error", () => fail("engine process could not start"));
child.on("exit", code => { if (!done) fail(`engine exited before catalog response (${code ?? "unknown"})`); });
child.stdout.on("data", chunk => {
  stdout += chunk.toString("utf8");
  if (stdout.length > 8 * 1024 * 1024) return fail("engine response exceeded limit");
  let index;
  while ((index = stdout.indexOf("\n")) >= 0) {
    const line = stdout.slice(0, index);
    stdout = stdout.slice(index + 1);
    let message;
    try { message = JSON.parse(line); } catch { return fail("engine emitted invalid JSON"); }
    if (message.id === 1 && message.result) {
      child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
      requestPage();
    } else if (message.id === nextRequestId - 1 && message.id >= 2) {
      if (message.error) return fail(`model/list failed: ${String(message.error.message ?? "unknown").slice(0, 160)}`);
      const result = message.result;
      if (!Array.isArray(result?.data)) return fail("model/list returned invalid catalog");
      models.push(...result.data.map(model => ({ id: model.id, provider: model.provider ?? model.modelProvider ?? null })));
      catalogs.push(...(result.providerCatalogs?.map(row => ({ providerId: row.providerId, state: row.state ?? row.status })) ?? []));
      pageCount += 1;
      if (pageCount > 100 || models.length > 10_000) return fail("model catalog exceeded pagination limit");
      if (result.nextCursor) requestPage(result.nextCursor);
      else {
        console.log(JSON.stringify({ ok: true, count: models.length, pages: pageCount, models, providerCatalogs: catalogs }));
        finish();
      }
    } else if (message.id === 1 && message.error) fail("engine initialization failed");
  }
});
child.stdin.write(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "azrael-release-catalog-check", version: "0.1.0" }, capabilities: { experimentalApi: true } } }) + "\n");

function finish() { if (done) return; done = true; clearTimeout(timer); child.kill(); }
function requestPage(cursor) {
  child.stdin.write(JSON.stringify({ id: nextRequestId++, method: "model/list", params: { ...(cursor ? { cursor } : { refresh: true }), includeHidden: true, limit: 100 } }) + "\n");
}
function fail(reason) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  child.kill();
  const diagnostic = stderrText.replace(/(?:Bearer\s+|sk-[A-Za-z0-9_-]+|[A-Za-z0-9_-]{48,})/g, "[redacted]").slice(0, 400);
  console.error(JSON.stringify({ ok: false, reason, stderrBytes, diagnostic }));
  process.exitCode = 1;
}
