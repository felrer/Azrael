// Shared helper collection policy. Read at request setup so child-process
// environment overrides take effect without changing protocol progress.
export function diagnosticFlag(value) {
  if (typeof value !== 'string') return undefined;
  switch (value.trim().toLowerCase()) {
    case '1': case 'true': case 'on': return true;
    case '0': case 'false': case 'off': return false;
    default: return undefined;
  }
}

export function diagnosticPolicy(env = process.env) {
  const master = diagnosticFlag(env.AZRAEL_DIAGNOSTICS) ?? true;
  return {
    inference: diagnosticFlag(env.AZRAEL_DIAGNOSTICS_INFERENCE) ?? master,
    tools: diagnosticFlag(env.AZRAEL_DIAGNOSTICS_TOOLS) ?? master,
  };
}
