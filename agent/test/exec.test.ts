import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

/** A fake `tmux` binary that echoes its args, so exec tests can assert real
 *  stdout/stderr/code flow through the agent without depending on a real
 *  tmux install or an actual session existing in this sandbox. */
function makeStubBinary(name: string, body: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-agent-bin-'));
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

interface ExecRes { ok: boolean; code?: number; stdout?: string; stderr?: string; err?: string }

describe('ccrc-agent exec whitelist', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  let client: TestClient | undefined;

  afterEach(async () => {
    client?.ws.close();
    client = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  it('runs a whitelisted tmux subcommand and returns its exit code', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    // No real tmux session exists, but `has-session` is whitelisted — the
    // agent must actually invoke it (nonzero exit, not a forbidden error).
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: 'tmux', args: ['has-session', '-t', 'cc-nope'] });
    expect(res.ok).toBe(true);
    expect(typeof res.code).toBe('number');
  });

  it('runs a whitelisted ccd subcommand', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: '/does/not/exist/ccd', args: ['ensure', 'foo'] });
    expect(res.ok).toBe(true); // whitelisted by subcommand even though the binary itself 404s
    expect(typeof res.code).toBe('number');
  });

  it('rejects a non-whitelisted command entirely', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: 'rm', args: ['-rf', '/'] });
    expect(res).toEqual({ t: 'res', id: 1, ok: false, err: 'forbidden' });
  });

  it('rejects a whitelisted command with a non-whitelisted subcommand', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: 'tmux', args: ['kill-server'] });
    expect(res).toEqual({ t: 'res', id: 1, ok: false, err: 'forbidden' });
  });

  it('rejects ccd with a non-whitelisted subcommand', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: 'ccd', args: ['ls'] });
    expect(res).toEqual({ t: 'res', id: 1, ok: false, err: 'forbidden' });
  });

  it('actually invokes the binary and returns its real stdout/stderr/exit code', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    const bin = makeStubBinary('tmux', 'echo "out:$1"; echo "err:$1" 1>&2; exit 7');
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: bin, args: ['has-session'] });
    expect(res).toMatchObject({ ok: true, code: 7, stdout: 'out:has-session\n', stderr: 'err:has-session\n' });
  });

  it('matches the whitelist by basename, so an absolute binary path counts', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    const bin = makeStubBinary('ccd', 'exit 0');
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: bin, args: ['swap', 'x'] });
    expect(res).toMatchObject({ ok: true, code: 0 });
  });
});
