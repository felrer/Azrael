import { assertComputerUseEnabled } from './sky-control-policy.mjs';
import { handleRpc as originalHandleRpc } from '@oai/sky/service';
export async function handleRpc(request) {
  assertComputerUseEnabled();
  return originalHandleRpc(request);
}
