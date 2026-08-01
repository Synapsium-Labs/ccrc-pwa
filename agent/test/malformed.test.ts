import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import type { RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

/**
 * Regression coverage for the crash class described in commit 49c1272's own
 * message: an unhandled promise rejection in handleReq's fire-and-forget
 * dispatch, crashing the whole ccrc-agent process. That fix only patched the
 * one call site (writeB64's mkdir/writeFile) the original regression test
 * exercised — every other op (read/readFrom/readdir/stat/tailOpen via
 * whitelist.checkPath→canonicalize→path.resolve, exec via
 * whitelist.isExecAllowed→path.basename/args[0]) still threw synchronously
 * on a missing/wrong-typed field, and `msg as AgentReq` at the dispatch site
 * is a compile-time-only assertion that does nothing to stop that at
 * runtime. This file drives every op in the protocol with malformed shapes
 * through the real WS surface (not the internal helpers directly) and
 * proves: (a) the agent replies ok:false or drops the frame rather than
 * tearing the connection down, and (b) the agent process itself survives —
 * proven by a subsequent valid request still getting answered. If any case
 * here crashes the process, the whole vitest run aborts, not just this test.
 */
interface Res { ok: boolean; err?: string; [k: string]: unknown }

describe('ccrc-agent malformed requests never crash the process', () => {
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

  async function open(): Promise<void> {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
  }

  /** After sending a possibly-malformed frame, prove the connection — and
   *  the agent process itself — is still alive via a real ping/pong. */
  async function assertStillAlive(): Promise<void> {
    client!.send({ t: 'ping' });
    const pong = await client!.waitFor((m) => (m as { t?: unknown }).t === 'pong');
    expect(pong).toEqual({ t: 'pong' });
  }

  const cases: Array<{ name: string; frame: Record<string, unknown> }> = [
    { name: 'exec missing cmd and args', frame: { op: 'exec' } },
    { name: 'exec non-string cmd', frame: { op: 'exec', cmd: 123, args: [] } },
    { name: 'exec cmd is undefined-shaped (field absent)', frame: { op: 'exec', args: ['has-session'] } },
    { name: 'exec args not an array', frame: { op: 'exec', cmd: 'tmux', args: 'has-session' } },
    { name: 'exec args with a non-string element', frame: { op: 'exec', cmd: 'tmux', args: [1, 2] } },
    { name: 'exec absolute-path cmd (basename matches, must still be forbidden)', frame: { op: 'exec', cmd: '/tmp/x/tmux', args: ['has-session'] } },
    { name: 'exec fleet-checkout absolute-path cmd', frame: { op: 'exec', cmd: '/srv/projects/some-repo/ccd', args: ['swap', 'x'] } },
    { name: 'read missing path', frame: { op: 'read' } },
    { name: 'read non-string path', frame: { op: 'read', path: 42 } },
    { name: 'readFrom missing path', frame: { op: 'readFrom', offset: 0 } },
    { name: 'readFrom missing offset', frame: { op: 'readFrom', path: '/x' } },
    { name: 'readFrom non-number offset', frame: { op: 'readFrom', path: '/x', offset: 'zero' } },
    { name: 'readdir missing path', frame: { op: 'readdir' } },
    { name: 'readdir non-string path', frame: { op: 'readdir', path: null } },
    { name: 'stat missing path', frame: { op: 'stat' } },
    { name: 'stat non-string path', frame: { op: 'stat', path: {} } },
    { name: 'writeB64 missing path', frame: { op: 'writeB64', dataB64: 'aGk=' } },
    { name: 'writeB64 missing dataB64', frame: { op: 'writeB64', path: '/x' } },
    { name: 'tailOpen missing path', frame: { op: 'tailOpen', offset: 0 } },
    { name: 'tailOpen missing offset', frame: { op: 'tailOpen', path: '/x' } },
    { name: 'tailClose missing tailId', frame: { op: 'tailClose' } },
    { name: 'tailClose non-number tailId', frame: { op: 'tailClose', tailId: 'one' } },
    { name: 'ptyOpen missing all fields', frame: { op: 'ptyOpen' } },
    { name: 'ptyOpen non-number cols/rows', frame: { op: 'ptyOpen', sessionId: 'x', cols: 'wide', rows: 24 } },
    { name: 'unknown op', frame: { op: 'frobnicate', path: '/x' } },
  ];

  for (const { name, frame } of cases) {
    it(`replies ok:false (not a crash) for: ${name}`, async () => {
      await open();
      const res = await client!.req<Res>(1, frame);
      expect(res.ok).toBe(false);
      await assertStillAlive();
    });
  }

  it('drops the frame silently when id is missing or non-numeric, and stays alive', async () => {
    await open();
    client!.send({ t: 'req', op: 'read' }); // no id at all
    client!.send({ t: 'req', id: 'not-a-number', op: 'read', path: '/x' });
    // Neither malformed frame gets a reply — liveness is proven below.
    await assertStillAlive();
  });

  it('rejects an exec whose args contain a non-string inside a pinned prefix', async () => {
    await open();
    const res = await client!.req<Res>(1, {
      op: 'exec', cmd: 'ccd', args: ['ws-reap', 42 as unknown as string, '--session', 'x'],
    });
    expect(res.ok).toBe(false);
    const again = await client!.req<Res>(2, { op: 'exec', cmd: 'tmux', args: ['has-session', '-t', 'x'] });
    expect(again.ok).toBe(true);   // the process survived
  });

  it('surviving one malformed request per op in sequence still leaves a normal request working', async () => {
    await open();
    for (const { frame } of cases) {
      await client!.req<Res>(1, frame);
    }
    const res = await client!.req<Res>(2, { op: 'read', path: '/definitely/not/whitelisted' });
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
    await assertStillAlive();
  });
});
