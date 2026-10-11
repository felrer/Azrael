"use strict";

function parseDiagnosticBoolean(value) {
  if (typeof value !== "string") return undefined;
  switch (value.trim().toLowerCase()) {
    case "1": case "true": case "on": return true;
    case "0": case "false": case "off": return false;
    default: return undefined;
  }
}
function diagnosticsEnabled(category, env = process.env) {
  return parseDiagnosticBoolean(env[`AZRAEL_DIAGNOSTICS_${category}`]) ??
    parseDiagnosticBoolean(env.AZRAEL_DIAGNOSTICS) ?? true;
}
function injectUiInputPolicy(html) {
  const enabled = diagnosticsEnabled("UI_INPUT");
  // A resolved boolean in metadata needs no executable content or CSP change.
  if (!/<head\b[^>]*>/i.test(html)) throw new Error("Pinned UI diagnostics bootstrap head changed.");
  return html.replace(/<head\b[^>]*>/i, tag => tag + `<meta name="azrael-ui-input-diagnostics" content="${enabled}">`);
}
module.exports = { parseDiagnosticBoolean, diagnosticsEnabled, injectUiInputPolicy };
