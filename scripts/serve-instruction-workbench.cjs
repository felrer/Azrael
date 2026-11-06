"use strict";

// The HTTP adapter shares the package domain with the future Webview adapter.
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { randomBytes, timingSafeEqual } = require("node:crypto");

async function roleModels(workbench) {
  const options = await workbench.profileOptions();
  const providers = Array.isArray(options.providers) ? options.providers : [];
  return (Array.isArray(options.models) ? options.models : []).flatMap(row => {
    const model = row.model || row.id;
    if (typeof model !== "string" || !model) return [];
    const identities = [...new Set((row.providerIds || []).flatMap(id => providers.filter(p => p.id === id && typeof p.modelProvider === "string").map(p => p.modelProvider)))];
    if (typeof row.modelProvider === "string") identities.push(row.modelProvider);
    return [...new Set(identities)].map(modelProvider => ({ ...row, model, id: model, modelProvider }));
  });
}

function createWorkbenchServer({ workbench, roleProfiles, token = randomBytes(32).toString("hex"), render, metadata = {}, log = () => {}, onStop }) {
  let closing = false;
  const actions = new Set(["createPackage", "derivePackage", "download", "createProfile", "saveProfile", "duplicateProfile", "deleteProfile", "equip", "unequip", "refresh", "captureRequest", "importFiles"]);
  const roleActions = new Set(["saveProfile", "deleteProfile", "saveTeamPreset", "deleteTeamPreset", "saveDirect", "saveTeamProfile"]);
  const same = value => typeof value === "string" && Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    const json = (status, data) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)); };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.on("finish", () => log({ method: req.method, status: res.statusCode, elapsedMs: Date.now() - start }));
    try {
      const address = server.address();
      const allowedHosts = [`127.0.0.1:${address.port}`, `localhost:${address.port}`];
      if (!allowedHosts.includes(req.headers.host)) return json(403, { error: "허용되지 않은 호스트입니다." });
      const origin = req.headers.origin;
      if (origin && !allowedHosts.some(host => origin === `http://${host}`)) return json(403, { error: "다른 사이트의 요청은 허용되지 않습니다." });
      if (closing) return json(503, { error: "개발 서버를 종료하는 중입니다." });
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "GET" && url.pathname === "/") {
        const nonce = randomBytes(18).toString("base64");
        res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
        const html = render({ token, locale: "ko" }).replace(/<script>/g, `<script nonce="${nonce}">`).replace(/<style>/g, `<style nonce="${nonce}">`);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(html);
      }
      if (url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
      if (!url.pathname.startsWith("/api/")) return json(404, { error: "페이지를 찾을 수 없습니다." });
      if (!same(req.headers["x-azrael-token"])) return json(403, { error: "이 개발 탭의 요청 토큰이 필요합니다." });
      if (req.method === "POST" && url.pathname === "/api/stop" && onStop) { json(200, { stopping: true }); setImmediate(onStop); return; }
      if (req.method === "GET" && url.pathname === "/api/state") {
        const state = await workbench.snapshot(url.searchParams.get("project") || null);
        return json(200, { ...state, development: metadata });
      }
      if (req.method === "GET" && url.pathname === "/api/package") return json(200, await workbench.detail(url.searchParams.get("key")));
      if (req.method === "GET" && url.pathname === "/api/profile-options") return json(200, await workbench.profileOptions());
      if (req.method === "GET" && url.pathname === "/api/resources") return json(200, await workbench.composerResources());
      if (req.method === "GET" && url.pathname === "/api/request") return json(200, await workbench.action("captureRequest", { projectId: url.searchParams.get("project") || null }));
      const roleRoute = url.pathname === "/api/role-profiles" && !!roleProfiles;
      if (req.method === "GET" && roleRoute) return json(200, { ...await roleProfiles.snapshot(), models: await roleModels(workbench) });
      if (req.method !== "POST" || url.pathname !== "/api/action" && !roleRoute) return json(404, { error: "요청을 찾을 수 없습니다." });
      if (!req.headers["content-type"]?.startsWith("application/json")) return json(415, { error: "JSON 요청이 필요합니다." });
      const declared = Number(req.headers["content-length"] || 0);
      const limit = 192 * 1024 * 1024;
      if (declared > limit) return json(413, { error: "요청 크기가 제한을 초과했습니다." });
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > limit) { json(413, { error: "요청 크기가 제한을 초과했습니다." }); req.resume(); return; }
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json(400, { error: "올바르지 않은 JSON입니다." }); }
      if (!input || !(roleRoute ? roleActions : actions).has(input.action) || !input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) return json(400, { error: "지원하지 않는 요청입니다." });
      if (roleRoute) return json(200, { ...await roleProfiles.action(input.action, input.payload), models: await roleModels(workbench) });
      return json(200, await workbench.action(input.action, input.payload) ?? {});
    } catch (error) {
      // Domain diagnostics contain no request bodies, credentials or package text.
      if (!res.headersSent) json(400, { error: error instanceof Error ? error.message : "요청을 처리하지 못했습니다." });
      else res.end();
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  return { server, token, async close() {
    closing = true;
    await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); });
    await workbench.close();
  } };
}

async function main(args = process.argv.slice(2)) {
  const options = { libraries: [], repositories: [], projects: [] };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--help") {
      process.stdout.write("node scripts/serve-instruction-workbench.cjs [--port 4318] [--library ABSOLUTE_ROOT] [--repository owner/repo] [--project ABSOLUTE_ROOT] [--data-run ABSOLUTE_RUN_ROOT]\n--data-run: 기존 개발 데이터를 그대로 사용합니다. --seed-run과 함께 사용할 수 없습니다.\n종료: node scripts/serve-instruction-workbench.cjs --stop-run ABSOLUTE_RUN_ROOT\n조회/편집은 개발 저장소에서 실행됩니다. GitHub 토큰은 AZRAEL_WORKBENCH_GITHUB_TOKEN 환경변수로만 전달합니다. 원격 게시와 설치본 변경은 하지 않습니다.\n"); return;
    }
    if (!["--port", "--library", "--repository", "--collaborator-repository", "--project", "--stop-run", "--seed-run", "--data-run"].includes(flag) || !args[i + 1] || args[i + 1].startsWith("--")) throw Error(`알 수 없거나 값이 없는 옵션: ${flag}`);
    const value = args[++i];
    if (flag === "--port") { options.port = Number(value); if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw Error("올바르지 않은 포트입니다."); }
    if (flag === "--stop-run") options.stopRun = value;
    if (flag === "--seed-run") options.seedRun = value;
    if (flag === "--data-run") options.dataRun = value;
    if (flag === "--repository" || flag === "--collaborator-repository") { if (!/^[\w.-]+\/[\w.-]+$/.test(value)) throw Error("저장소는 owner/repo 형식이어야 합니다."); options.repositories.push({ repository: value, sharing: flag === "--repository" ? "public" : "collaborators", branch: "main" }); }
    if (flag === "--library" || flag === "--project") { if (!path.isAbsolute(value)) throw Error("프로젝트와 라이브러리는 절대 경로를 사용하세요."); options[flag === "--library" ? "libraries" : "projects"].push(fs.realpathSync(value)); }
  }
  const projectRoot = path.resolve(__dirname, "..");
  if (options.stopRun) {
    const ownedRuns = path.join(projectRoot, "artifacts/tasks/FA-01-instruction-package-dev-tab/runs") + path.sep;
    if (!path.isAbsolute(options.stopRun) || !fs.realpathSync(options.stopRun).startsWith(ownedRuns)) throw Error("이 작업의 실행 경로가 필요합니다.");
    const control = JSON.parse(fs.readFileSync(path.join(options.stopRun, "reports/server-control.json"), "utf8"));
    if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(control.url)) throw Error("올바르지 않은 개발 서버 주소입니다.");
    const response = await fetch(control.url + "api/stop", { method: "POST", headers: { "X-Azrael-Token": control.token } });
    if (!response.ok) throw Error("개발 서버 종료 요청이 거절됐습니다.");
    process.stdout.write("Development server shutdown requested.\n"); return;
  }
  const { InstructionWorkbench } = require("./instruction-workbench.cjs");
  // Browser reload picks up UI changes without an app build or losing sandbox state.
  const renderWorkbenchPage = input => { const filename = require.resolve("./instruction-workbench-view.cjs"); delete require.cache[filename]; return require(filename).renderWorkbenchPage(input); };
  const lifecycle = require("./artifact-run.cjs");
  if (options.seedRun && options.dataRun) throw Error("가져오기와 기존 데이터 사용은 함께 지정할 수 없습니다.");
  let dataRecord;
  if (options.dataRun) {
    if (!path.isAbsolute(options.dataRun)) throw Error("기존 개발 데이터의 절대 실행 경로가 필요합니다.");
    const previous = fs.realpathSync(options.dataRun), ownedRuns = path.join(projectRoot, "artifacts/tasks/FA-01-instruction-package-dev-tab/runs") + path.sep;
    dataRecord = require("./artifact-lifecycle.cjs").catalog(projectRoot).find(r => r.owned_root === previous);
    if (!previous.startsWith(ownedRuns) || !dataRecord || dataRecord.owner !== "scripts/serve-instruction-workbench.cjs") throw Error("이 개발 작업의 데이터 소유 실행이 필요합니다.");
    options.dataRun = previous;
  }
  const run = lifecycle.beginArtifactRun(projectRoot, { workId: "FA-01-instruction-package-dev-tab", owner: "scripts/serve-instruction-workbench.cjs",
    references: dataRecord ? [{ id: dataRecord.id, reason: "Live development adapter uses retained profile data; historical producer outcome unchanged" }] : [] });
  if (options.seedRun) {
    const ownedRuns = path.join(projectRoot, "artifacts/tasks/FA-01-instruction-package-dev-tab/runs") + path.sep;
    if (!path.isAbsolute(options.seedRun)) throw Error("이전 개발 실행의 절대 경로가 필요합니다.");
    const previous = fs.realpathSync(options.seedRun);
    const record = require("./artifact-lifecycle.cjs").catalog(projectRoot).find(r => r.owned_root === previous);
    if (!previous.startsWith(ownedRuns) || !record || record.owner !== "scripts/serve-instruction-workbench.cjs" || record.state !== "complete" || record.producer?.status !== "stopped" || record.producer?.outcome !== "success") throw Error("정상 종료가 확인된 개발 실행만 가져올 수 있습니다.");
    let count = 0, bytes = 0;
    const copy = (source, destination) => {
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) throw Error("개발 자료의 링크는 가져올 수 없습니다.");
      if (stat.isDirectory()) {
        fs.mkdirSync(destination, { recursive: true });
        for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(destination, name));
      } else {
        if (!stat.isFile() || ++count > 100000 || (bytes += stat.size) > 512 * 1024 * 1024) throw Error("개발 자료 가져오기 한도를 초과했습니다.");
        fs.writeFileSync(destination, fs.readFileSync(source), { flag: "wx" });
      }
    };
    copy(path.join(previous, "outputs/library"), path.join(run.outputs, "library"));
    fs.writeFileSync(path.join(run.reports, "seed.json"), JSON.stringify({ previousRun: previous, files: count, bytes }));
  }
  const codexHome = process.env.CODEX_HOME || path.join(require("node:os").homedir(), ".azrael-ex");
  const personal = `${path.resolve(codexHome)}-instruction-library`;
  if (fs.existsSync(path.join(personal, "registry.json")) && !options.libraries.includes(personal)) options.libraries.push(personal);
  const projects = (options.projects.length ? options.projects : [projectRoot]).map(id => ({ id, name: path.basename(id) }));
  // Existing libraries are read only. All mutable state belongs to this run.
  const dataRoot = options.dataRun ? path.join(options.dataRun, "outputs/library") : path.join(run.outputs, "library");
  let dataLease;
  const installedRoot = path.join(run.temporary, "installation");
  const { RoleProfileStore } = require("./role-profile-store.cjs");
  const roleProfiles = new RoleProfileStore({ codexHome: path.join(dataRoot, "profile-home"), models: () => roleModels(workbench) });
  const workbench = new InstructionWorkbench({ root: dataRoot, installedRoot,
    profileRepository: roleProfiles,
    localRoots: options.libraries, baselineRoot: path.join(projectRoot, "instructions"), projects,
    connections: options.repositories, token: process.env.AZRAEL_WORKBENCH_GITHUB_TOKEN,
    readProfileOptions: () => require("./instruction-workbench-options.cjs").readProfileOptions({ codexHome }),
    readComposerResources: () => require("./instruction-workbench-resources.cjs").readComposerResources({ codexHome }),
    resolveComposerResource: id => require("./instruction-workbench-resources.cjs").resolveComposerResource(id, { codexHome }) });
  const app = createWorkbenchServer({ workbench, roleProfiles, render: renderWorkbenchPage, metadata: { sandbox: true, runRoot: run.runRoot }, onStop: () => shutdown(0).catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; }),
    log: record => fs.appendFileSync(path.join(run.logs, "http.jsonl"), JSON.stringify(record) + "\n") });
  let ended = false;
  async function shutdown(exitCode) {
    if (ended) return; ended = true;
    await app.close();
    dataLease?.release();
    lifecycle.finishArtifactRun(run, { exitCode, producerStopped: true, reason: "Development HTTP server and background package queries stopped" });
    process.exitCode = exitCode;
  }
  try {
    fs.mkdirSync(dataRoot, { recursive: true });
    dataLease = require("./maintenance-lock-owner.cjs").acquire(path.join(dataRoot, ".workbench-server.lock"), { operation: "workbench.data", waitMs: 0 });
    await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(options.port ?? 4318, "127.0.0.1", resolve); });
    const ready = { url: `http://127.0.0.1:${app.server.address().port}/`, runRoot: run.runRoot, dataRoot, lifecycleId: run.lifecycleId, projects, startedAt: new Date().toISOString(), pid: process.pid };
    fs.writeFileSync(path.join(run.reports, "server.json"), JSON.stringify(ready, null, 2));
    fs.writeFileSync(path.join(run.reports, "server-control.json"), JSON.stringify({ url: ready.url, token: app.token }));
    process.stdout.write(JSON.stringify(ready) + "\n");
    process.once("SIGINT", () => shutdown(0).catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; }));
    process.once("SIGTERM", () => shutdown(0).catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; }));
    process.once("message", value => { if (value === "shutdown") void shutdown(0); });
  } catch (error) {
    await workbench.close();
    dataLease?.release();
    lifecycle.finishArtifactRun(run, { exitCode: 1, producerStopped: true, reason: "Development server startup failed before accepting requests" });
    throw error;
  }
  return { app, run, shutdown };
}

module.exports = { createWorkbenchServer, roleModels, main };
if (require.main === module) main().catch(error => { process.stderr.write(String(error.stack || error) + "\n"); process.exitCode = 1; });
