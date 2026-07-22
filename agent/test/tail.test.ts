import { describe, it, expect, afterEach } from 'vitest';
import { appendFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

interface Res { ok: boolean; err?: string; [k: string]: unknown }
interface TailMsg { t: 'tail'; tailId: number; dataB64?: string; reset?: boolean; size?: number }

const wait = { timeout: 3000 };

describe('ccrc-agent tailOpen/tailClose', () => {
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

  it('streams appended bytes as base64 TailData frames', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-sessions', 't.log');
    writeFileSync(file, 'one\n');
    const openRes = await client!.req<Res>(1, { op: 'tailOpen', path: file, offset: statSync(file).size });
    expect(openRes.ok).toBe(true);
    const tailId = openRes.tailId as number;

    appendFileSync(file, 'two\n');
    const frame = await client!.waitFor<TailMsg>(
      (m) => (m as { t?: unknown }).t === 'tail' && (m as { tailId?: unknown }).tailId === tailId,
      wait.timeout,
    );
    expect(frame.reset).toBeUndefined();
    expect(Buffer.from(frame.dataB64!, 'base64').toString('utf8')).toBe('two\n');
  });

  it('emits a TailReset when the file shrinks', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-sessions', 't2.log');
    writeFileSync(file, 'one\ntwo\nthree\n');
    const startSize = statSync(file).size;
    const openRes = await client!.req<Res>(1, { op: 'tailOpen', path: file, offset: startSize });
    const tailId = openRes.tailId as number;

    writeFileSync(file, 'x\n'); // shorter -> truncation/rotation
    const frame = await client!.waitFor<TailMsg>(
      (m) => (m as { t?: unknown }).t === 'tail' && (m as { tailId?: unknown }).tailId === tailId,
      wait.timeout,
    );
    expect(frame.reset).toBe(true);
    expect(frame.size).toBeLessThan(startSize);
  });

  it('tailClose stops further callbacks for that tailId', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-sessions', 't3.log');
    writeFileSync(file, 'one\n');
    const openRes = await client!.req<Res>(1, { op: 'tailOpen', path: file, offset: statSync(file).size });
    const tailId = openRes.tailId as number;

    const closeRes = await client!.req<Res>(2, { op: 'tailClose', tailId });
    expect(closeRes.ok).toBe(true);

    appendFileSync(file, 'two\n');
    await new Promise((r) => setTimeout(r, 1800)); // longer than the internal poll interval
    let sawFrame = false;
    try {
      await client!.waitFor((m) => (m as { t?: unknown; tailId?: unknown }).t === 'tail' && (m as { tailId?: unknown }).tailId === tailId, 200);
      sawFrame = true;
    } catch {
      sawFrame = false;
    }
    expect(sawFrame).toBe(false);
  });

  it('tailOpen rejects a path outside the whitelist', async () => {
    await open();
    const file = path.join(fixture!.outside, 'x.log');
    writeFileSync(file, 'x');
    const res = await client!.req<Res>(1, { op: 'tailOpen', path: file, offset: 0 });
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
  });
});
