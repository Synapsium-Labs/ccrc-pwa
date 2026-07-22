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

  it('runs a whitelisted ccd subcommand by exact bare command name', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    // Bare "ccd" — exact match, no basename matching — resolves via PATH.
    // Even if it 404s (ENOENT) the whitelist check itself must pass, and
    // execFile's ENOENT still comes back as a real (non-forbidden) result.
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: 'ccd', args: ['ensure', 'foo'] });
    expect(res.ok).toBe(true);
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
    // Exec now requires an EXACT bare command name ("tmux"), so to exercise
    // real process invocation with controlled output we put our stub on
    // PATH under that exact name rather than passing an absolute path.
    const bin = makeStubBinary('tmux', 'echo "out:$1"; echo "err:$1" 1>&2; exit 7');
    const origPath = process.env.PATH;
    process.env.PATH = `${path.dirname(bin)}${path.delimiter}${origPath ?? ''}`;
    try {
      const res = await client.req<ExecRes>(1, { op: 'exec', cmd: 'tmux', args: ['has-session'] });
      expect(res).toMatchObject({ ok: true, code: 7, stdout: 'out:has-session\n', stderr: 'err:has-session\n' });
    } finally {
      process.env.PATH = origPath;
    }
  });

  it('rejects an absolute path even when its basename matches a whitelisted command (no basename matching)', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    const bin = makeStubBinary('ccd', 'exit 0');
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: bin, args: ['swap', 'x'] });
    expect(res).toEqual({ t: 'res', id: 1, ok: false, err: 'forbidden' });
  });
});
