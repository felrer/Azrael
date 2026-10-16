import { acquireDesktopAuthority, withDesktopAuthority } from './sky-control-policy.mjs';
import { handleRpc as originalHandleRpc } from '@oai/sky/service';
export async function handleRpc(request) {
  const lease = await acquireDesktopAuthority();
  return withDesktopAuthority(lease, () => originalHandleRpc(request));
}
