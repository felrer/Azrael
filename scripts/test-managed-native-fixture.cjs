const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const checker = import('./check-managed-native-engine.mjs');

test('default and compatibility alias select Claude; Devin stays explicit and retired scope fails closed', async () => {
  const { selectFixtureMode } = await checker;
  assert.equal(selectFixtureMode([]), 'claude');
  assert.equal(selectFixtureMode(['--claude-only']), 'claude');
  assert.equal(selectFixtureMode(['--devin-handoff-only']), 'devin-handoff');
  assert.equal(selectFixtureMode(['--claude-only', '--devin-handoff-only']), 'devin-handoff');
  for (const args of [['--managed-only'], ['--managed-only', '--claude-only'], ['--managed-only', '--devin-handoff-only']]) {
    assert.throws(() => selectFixtureMode(args), /retired_managed_only_mode/);
  }
});

test('actual generated transport guard allows Claude only and preserves request/cancellation boundaries', async () => {
  const { buildInferenceWrapper } = await checker;
  const helper = 'data:text/javascript,export function runCli() { throw Error("unexpected_helper_call"); } export function catalog() { throw Error("unexpected_catalog_call"); }';
  const source = buildInferenceWrapper(helper, process.cwd(), 'http://127.0.0.1:12345');
  const result = spawnSync(process.execPath, ['--input-type=module', '-', '--guard-check'], { input: source, encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /guard_passed/);
});

async function withFixture(run) {
  const { startFixture, echoIdentity } = await import('./managed-native-api-fixture.mjs');
  const fixture = await startFixture();
  const body = { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'NATIVE_MANAGED_TURN_1' }], tools: [{ name: 'namespace_b_echo', description: echoIdentity }] };
  const post = (value = body, signal) => fetch(fixture.baseUrl + '/anthropic/v1/messages', { method: 'POST', headers: { authorization: 'Bearer synthetic-managed-anthropic-oauth-access', 'content-type': 'application/json' }, body: JSON.stringify(value), signal });
  try { await run(fixture, body, post); assert.deepEqual(fixture.errors, []); }
  finally { await fixture.close(); }
}

test('supported fixture emits Claude tool, compaction and quota responses', async () => {
  await withFixture(async (fixture, body, post) => {
    const tool = await (await post()).text();
    assert.match(tool, /"type":"tool_use"/);
    assert.match(tool, /"partial_json":"\{\\"value\\":\\"NATIVE_MANAGED_TURN_1/);
    assert.match(tool, /"type":"message_stop"/);
    fixture.controls.compact = true;
    const compact = await (await post()).text();
    assert.match(compact, /COMPACTION_SUMMARY/);
    assert.doesNotMatch(compact, /"type":"tool_use"/);
    fixture.controls.handoffQuota = true;
    const quota = await post({ ...body, messages: [{ role: 'user', content: 'NATIVE_MANAGED_TURN_1 Prepare a plain-text handoff for another provider.' }] });
    assert.equal(quota.status, 429);
    assert.equal((await quota.json()).error.code, 'insufficient_quota');
  });
});

for (const handoff of [false, true]) {
  test(`Claude ${handoff ? 'handoff text' : 'tool input'} partial stream remains incomplete until cancellation`, async () => {
    await withFixture(async (fixture, body, post) => {
      fixture.controls[handoff ? 'handoffDelay' : 'delay'] = true;
      const controller = new AbortController();
      const response = await post(handoff ? { ...body, messages: [{ role: 'user', content: 'NATIVE_MANAGED_TURN_1 Prepare a plain-text handoff for another provider.' }] } : body, controller.signal);
      await (handoff ? fixture.handoffStarted : fixture.delayedStarted);
      const reader = response.body.getReader();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const decoder = new TextDecoder();
        const partial = handoff ? /UNFINISHED_HANDOFF_MUST_NOT_PERSIST/ : /"partial_json":"\{\\"value\\":/;
        let text = '';
        while (!partial.test(text)) {
          const { value, done } = await reader.read();
          assert.equal(done, false, 'stream must reach the partial frame before ending');
          text += decoder.decode(value, { stream: true });
        }
        assert.match(text, /"type":"message_start"/);
        assert.match(text, partial);
        assert.doesNotMatch(text, /"type":"(content_block_stop|message_stop)"/);
        controller.abort();
        await assert.rejects(reader.read(), /abort/i);
      } finally { clearTimeout(timer); controller.abort(); await reader.cancel().catch(() => {}); }
    });
  });
}
