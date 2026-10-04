"use strict";

const https = require("node:https");
const ENDPOINT = "https://chatgpt.com/backend-api/ecosystem/url_safe";
const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 15_000;

function usesProxy(env = process.env) {
  return ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]
    .some((name) => Boolean(env[name]));
}

// Deliberately exact: never redirect credentials or change unrelated API traffic.
async function fetchUrlSafety(url, options, fallback, log, configuredProxy = false) {
  if (url !== ENDPOINT || options?.method !== "POST") return fallback(url, options);
  if (configuredProxy || usesProxy()) {
    emit(log, "warning", { transport: "upstream", outcome: "proxy_preserved" });
    return fallback(url, options);
  }
  return requestUrlSafety(options, log);
}

function emit(log, level, safe) {
  try { log?.(level, "azrael_url_safety_transport", safe); } catch { /* Logging must not authorize a URL. */ }
}

async function requestUrlSafety(options, log) {
  if (typeof options.body !== "string" || Buffer.byteLength(options.body) > MAX_BYTES) {
    throw new TypeError("Invalid URL safety request body");
  }
  const headers = new Headers(options.headers);
  headers.set("accept-encoding", "identity");
  headers.set("content-length", String(Buffer.byteLength(options.body)));
  const signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(TIMEOUT_MS)]);
  const started = Date.now();
  try {
    const response = await new Promise((resolve, reject) => {
      const request = https.request(ENDPOINT, {
        method: "POST", headers: Object.fromEntries(headers), signal,
        // A dedicated connection matches the verified standard HTTPS transport.
        // No custom TLS fingerprints, browser headers, cookies or challenge logic.
        agent: false,
      }, (incoming) => {
        const chunks = [];
        let bytes = 0;
        incoming.on("error", reject);
        incoming.on("aborted", () => reject(new Error("URL safety response interrupted")));
        incoming.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) {
            request.destroy(new Error("URL safety response exceeds limit"));
          } else chunks.push(chunk);
        });
        incoming.on("end", () => {
          if (bytes > MAX_BYTES) return;
          const encoding = incoming.headers["content-encoding"];
          if (encoding && encoding !== "identity") {
            reject(new Error("Unexpected URL safety response encoding"));
            return;
          }
          const status = incoming.statusCode;
          if (!Number.isInteger(status) || status < 200 || status > 599) {
            reject(new Error("Invalid URL safety response status"));
            return;
          }
          // Forward only response metadata needed by the existing host. Do not
          // export Set-Cookie, authentication headers or challenge HTML to logs.
          const responseHeaders = new Headers();
          for (const key of ["content-type", "cf-ray", "cf-mitigated", "retry-after"]) {
            const value = incoming.headers[key];
            if (typeof value === "string") responseHeaders.set(key, value);
          }
          const body = [204, 205, 304].includes(status) ? null : Buffer.concat(chunks);
          resolve(new Response(body, { status, headers: responseHeaders }));
        });
      });
      request.on("error", reject);
      request.end(options.body);
    });
    emit(log, response.ok ? "info" : "warning", {
      transport: "node_https", status: response.status,
      challenge: response.headers.get("cf-mitigated") === "challenge",
      durationMs: Date.now() - started,
    });
    return response;
  } catch (error) {
    emit(log, "warning", { transport: "node_https", outcome: signal.aborted ? "aborted" : "failed", durationMs: Date.now() - started });
    throw error;
  }
}

module.exports = { ENDPOINT, fetchUrlSafety };
