import { createSettingsOwner } from './use-control-settings.mjs';
function owner() {
  if (!process.env.CODEX_HOME) throw new Error('Managed Computer Use requires explicit CODEX_HOME');
  return createSettingsOwner(process.env.CODEX_HOME);
}
export function currentComputerUsePolicy() { return owner().getSettings(); }
export function assertComputerUseEnabled(generation) {
  const state = currentComputerUsePolicy();
  if (!state.computerUseEnabled) throw new Error('Computer Use is disabled');
  if (generation !== undefined && generation !== state.computerUseGeneration) throw new Error('Computer Use policy changed while request was queued');
  return state.computerUseGeneration;
}
