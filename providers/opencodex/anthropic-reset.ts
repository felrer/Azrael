import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { managedClaudeIdentity } from './inference-config.ts';

export type AnthropicResetOutcome = 'reset' | 'alreadyUsed' | 'noCredit' | 'nothingToReset' | 'cooldown';
export class AnthropicResetError extends Error {}
const base = 'https://api.anthropic.com';
const record = (value: any) => value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
const safeId = (value: any): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
type Attempt = { org: string; grantId: string; requestId: string };
interface Attempts {
  read(): Attempt | undefined;
  admit(attempt: Attempt): Attempt;
  clear(requestId: string): void;
}
function savedAttempts(identity: [string, string], m: any): Attempts {
  const home = process.env.OPENCODEX_HOME;
  if (!home || !isAbsolute(home)) throw new AnthropicResetError('리셋 요청을 저장할 계정 경로를 확인하지 못했습니다.');
  const directory = join(home, 'anthropic-reset-attempts');
  const path = join(directory, createHash('sha256').update(JSON.stringify(identity)).digest('hex') + '.json');
  const read = () => {
    if (!existsSync(path)) return undefined;
    try {
      const raw = readFileSync(path, 'utf8');
      if (raw.length > 4096) throw Error();
      const value = JSON.parse(raw);
      if (!safeId(value.org) || !safeId(value.grantId) || !/^azrael-[a-f0-9]{64}$/.test(value.requestId)) throw Error();
      return { org: value.org, grantId: value.grantId, requestId: value.requestId };
    } catch { throw new AnthropicResetError('이전 리셋 요청을 확인하지 못했습니다. Claude 설정의 사용량 화면에서 결과를 확인해주세요.'); }
  };
  return { read,
    admit(attempt) {
      return m.config.withConfigMutationLockSync(() => {
        const previous = read(); if (previous) return previous;
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const temporary = path + '.' + randomUUID() + '.tmp';
        try { writeFileSync(temporary, JSON.stringify(attempt), { flag: 'wx', mode: 0o600 }); renameSync(temporary, path); }
        finally { if (existsSync(temporary)) unlinkSync(temporary); }
        return attempt;
      });
    },
    clear(requestId) { m.config.withConfigMutationLockSync(() => { if (read()?.requestId === requestId) unlinkSync(path); }); },
  };
}

/** Manual, account-scoped redemption; never called by polling or quota recovery. */
export async function resetAnthropicUsage(accountId: string, m: any, fetcher: typeof fetch = fetch, injectedAttempts?: Attempts): Promise<AnthropicResetOutcome> {
  const account = () => m.store.getAccountSet('anthropic')?.accounts.find((entry: any) => entry.id === accountId);
  const identity = managedClaudeIdentity(account()?.credential);
  if (!identity || account()?.needsReauth) throw new AnthropicResetError('Anthropic 계정을 다시 인증해주세요.');
  const { accessToken } = await m.oauth.getValidAccessSnapshotForAccount('anthropic', accountId, { requireUsableAccount: true });
  const attempts = injectedAttempts ?? savedAttempts(identity, m);
  let pending = attempts.read();
  const assertIdentity = () => {
    if (account()?.needsReauth || JSON.stringify(managedClaudeIdentity(account()?.credential)) !== JSON.stringify(identity)) {
      throw new AnthropicResetError('리셋 도중 계정이 변경되었습니다. 계정 목록을 새로고침해주세요.');
    }
  };
  const headers = { Authorization: `Bearer ${accessToken}`, 'anthropic-beta': 'oauth-2025-04-20',
    'User-Agent': 'claude-cli/2.1.283 (external, cli)', Accept: 'application/json', 'Content-Type': 'application/json' };
  const signal = AbortSignal.timeout(20_000);
  const request = async (path: string, body?: any) => {
    assertIdentity();
    let response: Response;
    try { response = await fetcher(base + path, { method: body ? 'POST' : 'GET', headers, signal, redirect: 'error', ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw new AnthropicResetError(body ? '리셋 결과를 확인하지 못했습니다. 다시 시도해 결과를 확인해주세요.' : 'Anthropic 리셋 정보를 확인하지 못했습니다. 다시 시도해주세요.'); }
    assertIdentity();
    if (response.status === 401 || response.status === 403) throw new AnthropicResetError('Anthropic 리셋 권한을 확인하지 못했습니다. 계정을 다시 인증해주세요.');
    if (response.status === 429) throw new AnthropicResetError('Anthropic 요청이 제한되었습니다. 잠시 후 다시 시도해주세요.');
    if (!response.ok) throw new AnthropicResetError(body ? 'Anthropic 리셋 요청에 실패했습니다. 다시 시도해주세요.' : 'Anthropic 리셋 정보를 불러오지 못했습니다.');
    try { const value = record(await response.json()); if (value) return value; } catch { /* sanitized below */ }
    throw new AnthropicResetError(body ? 'Anthropic 리셋 결과를 확인하지 못했습니다. 다시 시도해 결과를 확인해주세요.' : 'Anthropic 리셋 정보의 형식을 확인하지 못했습니다.');
  };
  let grant: any;
  if (!pending) {
    const usage = await request('/api/oauth/usage?cedar_ember=1');
    const program = record(usage.cedar_ember);
    if (!program || typeof program.eligible !== 'boolean' || (program.eligible && !Array.isArray(program.grants))) {
      throw new AnthropicResetError('이 계정의 무료 리셋 지원 여부를 확인하지 못했습니다. Claude 설정의 사용량 화면을 확인해주세요.');
    }
    if (!program.eligible) {
      if (['surface', 'cli_version'].includes(program.ineligible_reason)) throw new AnthropicResetError('이 계정의 무료 리셋 지원 여부를 확인하지 못했습니다. Claude 설정의 사용량 화면을 확인해주세요.');
      return 'noCredit';
    }
    if (program.grants.some((value: any) => !record(value) || !Number.isInteger(value.resets_left) || value.resets_left < 0)) throw new AnthropicResetError('Anthropic 무료 리셋 정보의 형식을 확인하지 못했습니다.');
    if (typeof program.cooldown_until === 'string' && Date.parse(program.cooldown_until) > Date.now()) return 'cooldown';
    grant = program.grants.find((value: any) => record(value) && value.id === program.next_grant_id);
    if (!grant) {
      if (program.grants.some((value: any) => record(value) && Number.isInteger(value.resets_left) && value.resets_left > 0)) {
        throw new AnthropicResetError('무료 리셋이 있지만 지금 사용할 수 없습니다. Claude 설정의 사용량 화면을 확인해주세요.');
      }
      return 'noCredit';
    }
    if (!safeId(grant.id) || !Number.isInteger(grant.resets_left) || grant.resets_left < 0 || typeof grant.ends_at !== 'string' || !Number.isFinite(Date.parse(grant.ends_at))) {
      throw new AnthropicResetError('Anthropic 무료 리셋 정보의 형식을 확인하지 못했습니다.');
    }
    if (grant.resets_left === 0 || Date.parse(grant.ends_at) <= Date.now()) return 'noCredit';
    if (grant.paused === true || grant.usable_now !== true) return 'cooldown';
  }
  const profile = await request('/api/oauth/profile');
  const principal = record(profile.account);
  if (!principal || (identity[0] === 'accountId' ? principal.uuid !== identity[1] : principal.email_address !== identity[1])) {
    throw new AnthropicResetError('Anthropic 리셋 대상 계정이 일치하지 않습니다. 다시 인증해주세요.');
  }
  const org = record(profile.organization)?.uuid;
  if (!safeId(org)) throw new AnthropicResetError('Anthropic 리셋 대상 조직을 확인하지 못했습니다.');
  // Stable across helper restarts/windows for the same server-selected grant slot.
  if (!pending) {
    const requestId = 'azrael-' + createHash('sha256').update(JSON.stringify([identity, org, 'cedar_ember', grant.id, grant.resets_left, grant.ends_at])).digest('hex');
    pending = attempts.admit({ org, grantId: grant.id, requestId });
  }
  if (pending.org !== org) throw new AnthropicResetError('이전 리셋 요청의 조직과 현재 계정이 일치하지 않습니다. Claude 설정에서 결과를 확인해주세요.');
  const result = await request(`/api/organizations/${org}/reset_rate_limits`, { program: 'cedar_ember', grant_id: pending.grantId, request_id: pending.requestId });
  let outcome: AnthropicResetOutcome;
  switch (result.result) {
    case 'reset': outcome = 'reset'; break;
    case 'already_used': outcome = 'alreadyUsed'; break;
    case 'not_limited': outcome = 'nothingToReset'; break;
    case 'ineligible': case 'unavailable': outcome = 'noCredit'; break;
    case 'cooldown': outcome = 'cooldown'; break;
    default: throw new AnthropicResetError('Anthropic 리셋 결과를 확인하지 못했습니다. 다시 시도해 결과를 확인해주세요.');
  }
  attempts.clear(pending.requestId);
  return outcome;
}
