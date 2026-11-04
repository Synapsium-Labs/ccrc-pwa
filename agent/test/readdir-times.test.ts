// Console speed S1, the times arm: the agent's `readdir` op answers each entry's modification time on request, behind
// the `readdir-mtimes` word in `ready.ops`. A REAL agent over loopback against a fixture HOME (`disk-op.test.ts`'s idiom).
import { describe, it, expect, afterEach } from 'vitest';
import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { READDIR_MTIMES_OP, type AgentReady } from '../../shared/agent-protocol.js';
import { CAP_WORD } from '../../shared/api.js';
import { makeFixture, boot, TestClient } from './helpers.js';

describe('the readdir op answers modification times on request', () => {
  let agent: RunningAgent | undefined;
  const clients: TestClient[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    await agent?.close();
    agent = undefined;
  });
  async function connect(): Promise<{ c: TestClient; dir: string }> {
    const fx = makeFixture();
    const dir = path.join(fx.home, '.cc-sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'sess-a.uuid'), 'u');
    writeFileSync(path.join(dir, 'sess-a.hold'), 'h');
    agent = await boot(fx);
    const c = new TestClient(agent.port);
    clients.push(c);
    return { c, dir };
  }

  it('readdir with times answers one mtime per name', async () => {
    const { c, dir } = await connect();
    await c.hello();
    const res = await c.req<{ ok: boolean; names: string[]; times: Record<string, number> }>(1, { op: 'readdir', path: dir, times: true });
    expect(res.ok).toBe(true);
    expect([...res.names].sort()).toEqual(['sess-a.hold', 'sess-a.uuid']);
    expect(Object.keys(res.times).sort()).toEqual(['sess-a.hold', 'sess-a.uuid']);
    expect(res.times['sess-a.uuid']).toBe(lstatSync(path.join(dir, 'sess-a.uuid')).mtimeMs);
  });

  it('readdir without times is byte-identical to today', async () => {
    const { c, dir } = await connect();
    await c.hello();
    const plain = await c.req(1, { op: 'readdir', path: dir });
    expect(Object.keys(plain as object).sort()).toEqual(['id', 'names', 'ok', 't']);
    expect(plain).toEqual({ t: 'res', id: 1, ok: true, names: expect.any(Array) });
    // Anything but the literal true is ignored: never refused, never answered with times.
    const loose = await c.req(2, { op: 'readdir', path: dir, times: 'yes' });
    expect(Object.keys(loose as object).sort()).toEqual(['id', 'names', 'ok', 't']);
    // A failure keeps its shape with the flag set too.
    const gone = await c.req(3, { op: 'readdir', path: path.join(dir, 'nope'), times: true });
    expect(gone).toEqual({ t: 'res', id: 3, ok: true, names: null, absent: true });
  });

  it('caps lists readdir-mtimes', async () => {
    const { c } = await connect();
    const ops = (await c.hello() as AgentReady).ops!;
    expect(READDIR_MTIMES_OP).toBe('readdir-mtimes');
    expect(ops[ops.length - 1]).toBe('readdir-mtimes');
    expect(ops.filter((w) => !CAP_WORD.test(w))).toEqual([]);
  });
});
