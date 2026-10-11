export function parseDiagnosticBoolean(value: string | undefined): boolean | undefined {
  switch (value?.trim().toLowerCase()) {
    case "1": case "true": case "on": return true;
    case "0": case "false": case "off": return false;
    default: return undefined;
  }
}

export function diagnosticsEnabled(category: "ACCOUNTS", env = process.env): boolean {
  return parseDiagnosticBoolean(env[`AZRAEL_DIAGNOSTICS_${category}`]) ??
    parseDiagnosticBoolean(env.AZRAEL_DIAGNOSTICS) ?? true;
}
