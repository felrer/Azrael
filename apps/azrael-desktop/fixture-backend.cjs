"use strict";
// The artifact owner can synchronously wait for a catalog lease. Keep HTTP
// service independent of that wait; it never receives real credentials.
const { parentPort, workerData } = require("node:worker_threads");
const http = require("node:http");
const fs = require("node:fs");
const models = fs.readFileSync(workerData.models);
const requests = [];
const server = http.createServer((request, response) => {
  requests.push({ method: request.method, path: request.url });
  response.setHeader("Content-Type", "application/json");
  if (["azrael-app://view", "azrael-app://shell"].includes(request.headers.origin)) {
    response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", request.headers["access-control-request-headers"] || "content-type,authorization");
  }
  if (request.method === "OPTIONS") { response.statusCode = 204; response.end(); return; }
  if (request.url.endsWith("/accounts/check")) response.end(JSON.stringify({ accounts: [{ id: "desktop-fixture", account_id: "desktop-fixture", account_user_id: "desktop-fixture", account_user_role: "owner", structure: "personal", plan_type: "plus", is_zdr: false, is_openai_internal: false, can_access_with_session: true, name: "Desktop fixture", workspace_backend_origin: "https://fixture.invalid", account_routing_override: "NO_CONSTRAINT" }], account_ordering: ["desktop-fixture"], default_account_id: "desktop-fixture" }));
  else if (request.url.includes("/models")) response.end(models);
  else if (request.url.endsWith("/settings/user")) response.end('{}');
  else if (request.url.startsWith("/api/wham/tasks/list?")) response.end('{"items":[]}');
  else if (new URL(request.url, "http://localhost").pathname === "/api/wham/environments") response.end('[]');
  else { response.statusCode = 404; response.end('{}'); }
});
server.on("error", cause => parentPort.postMessage({ type: "error", message: cause.message }));
server.listen(0, "127.0.0.1", () => parentPort.postMessage({ type: "ready", url: `http://127.0.0.1:${server.address().port}` }));
parentPort.on("message", message => {
  if (message !== "stop") return;
  server.close(() => { parentPort.postMessage({ type: "stopped", requests }); parentPort.close(); });
  server.closeAllConnections();
});
