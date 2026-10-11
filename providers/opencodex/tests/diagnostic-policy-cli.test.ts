import { expect, test } from 'bun:test';
import { join } from 'node:path';

test('managed CLI default, off and re-enable gate observers before invalid request without hiding protocol progress', async () => {
  for (const setting of [undefined, 'off', 'on']) {
    const env = { ...process.env };
    delete env.AZRAEL_DIAGNOSTICS_INFERENCE;
    delete env.AZRAEL_DIAGNOSTICS_TOOLS;
    if (setting === undefined) delete env.AZRAEL_DIAGNOSTICS;
    else env.AZRAEL_DIAGNOSTICS = setting;
    const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'inference.ts')], {
      env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    });
    child.stdin.write(JSON.stringify({ type: 'init', protocol_version: 1, request_id: 'toggle' }) + '\n'
      + JSON.stringify({ type: 'request', protocol_version: 1, request_id: 'toggle', provider_id: 'anthropic' }) + '\n');
    child.stdin.end();
    const [output, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(code).toBe(1);
    expect(stderr).toBe('');
    const frames = output.trim().split('\n').map(line => JSON.parse(line));
    expect(frames).toHaveLength(1);
    const frame = frames[0];
    expect(frame).toEqual(expect.objectContaining({ type: 'error', code: 'invalid_request',
      protocol_version: 1, request_id: 'toggle', seq: 0 }));
    expect(frame.progress.phase).toBe('preflight');
    expect(frame.progress.thinking_wait.open).toBe(false);
    expect('transport' in frame.progress).toBe(setting !== 'off');
    expect('tool_diagnostics' in frame.progress).toBe(setting !== 'off');
  }
});
