// The agent's reads refuse what is not a regular file (accounts plan Task A12; D-5755 (13d)). A12 is the first task to
// read `~/.cc-sessions/.accounts` over the `read` op, and the sign-in helper's FIFOs (`~/.cc-sessions/.auth/<id>.run/
// {in,out,in.child}`) sit inside the same read root: a plain `readFile` on `in` would block, and could take the relayed
// code from the helper. So `read`, `readFrom` and `readB64` open with `O_NONBLOCK`, `fstat`, and answer a FIFO, a socket
// or a device as unreadable; and a lane-state file is opened with `O_NOFOLLOW`, so a symlink planted at its name is
// unreadable rather than its target's bytes.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, linkSync, mkdirSync, openSync, readSync, rmSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { boot, makeFixture, TestClient, type Fixture } from './helpers.js';

interface Res { ok: boolean; err?: string; [k: string]: unknown }

describe('the agent reads regular files only (A12)', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  let client: TestClient | undefined;
  const fds: number[] = [];
  let id = 0;

  afterEach(async () => {
    for (const fd of fds.splice(0)) { try { closeSync(fd); } catch { /* already closed */ } }
    client?.ws.close();
    client = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      for (const d of [fixture.home, fixture.projectsRoot, fixture.outside]) rmSync(d, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  async function open(): Promise<Fixture> {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    return fixture;
  }

  /** The helper's `in` FIFO with the helper holding its read end and the relayed code written into it. */
  function helperFifo(f: Fixture): { fifo: string; helperRead: number } {
    const run = path.join(f.home, '.cc-sessions', '.auth', 'lane-a.run');
    mkdirSync(run, { recursive: true });
    const fifo = path.join(run, 'in');
    execFileSync('mkfifo', [fifo]);
    const helperRead = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    const writer = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
    fds.push(helperRead, writer);
    writeSync(writer, 'the-relayed-code');
    return { fifo, helperRead };
  }

  it.each(['read', 'readFrom', 'readB64'] as const)(
    'a `%s` of `~/.cc-sessions/.auth/<id>.run/in` (a FIFO in the fixture) is refused at once and leaves the FIFO\'s bytes for the helper',
    async (op) => {
      const f = await open();
      const { fifo, helperRead } = helperFifo(f);
      const req = op === 'readFrom' ? { op, path: fifo, offset: 0 } : { op, path: fifo };
      const t0 = Date.now();
      const res = await client!.req<Res>(++id, req);
      expect(Date.now() - t0).toBeLessThan(1_000);
      expect(res.ok).toBe(true);
      expect(res).not.toHaveProperty('absent');
      if (op === 'read') expect(res.data).toBeNull();
      if (op === 'readB64') expect(res.dataB64).toBeNull();
      if (op === 'readFrom') expect(res.data ?? null).toBeNull();
      const buf = Buffer.alloc(64);
      const n = readSync(helperRead, buf, 0, buf.length, null);
      expect(buf.subarray(0, n).toString('utf8')).toBe('the-relayed-code');
    },
    4_000,
  );

  it.each(['read', 'readFrom', 'readB64'] as const)(
    'a `%s` of a FIFO no process holds open is refused at once: the open never waits for a writer',
    async (op) => {
      const f = await open();
      const run = path.join(f.home, '.cc-sessions', '.auth', 'lane-b.run');
      mkdirSync(run, { recursive: true });
      const fifo = path.join(run, 'in');
      execFileSync('mkfifo', [fifo]);
      const req = op === 'readFrom' ? { op, path: fifo, offset: 0 } : { op, path: fifo };
      try {
        const t0 = Date.now();
        const res = await client!.req<Res>(++id, req);
        expect(Date.now() - t0).toBeLessThan(1_000);
        expect(res.ok).toBe(true);
        expect(res).not.toHaveProperty('absent');
      } finally {
        // A blocking open (the mutant) waits for a writer: give it one, so a red run frees its thread.
        try { fds.push(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK)); } catch { /* nothing waits */ }
      }
    },
    4_000,
  );

  it('a regular lane-state file still reads', async () => {
    const f = await open();
    const dir = path.join(f.home, '.cc-sessions', '.accounts');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'lane-a.json');
    writeFileSync(file, '{"check":{"verdict":"ok","at":"2026-10-20T10:00:00Z"}}', { mode: 0o600 });
    const res = await client!.req<Res>(++id, { op: 'read', path: file });
    expect(res).toMatchObject({ ok: true, data: '{"check":{"verdict":"ok","at":"2026-10-20T10:00:00Z"}}' });
  });

  it('a symlink planted at a lane-state file\'s name reads as unreadable, never as its target', async () => {
    const f = await open();
    const target = path.join(f.home, '.cc-sessions', 'a.wrapper');
    writeFileSync(target, 'what-the-target-holds');
    const dir = path.join(f.home, '.cc-sessions', '.accounts');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const link = path.join(dir, 'lane-a.json');
    symlinkSync(target, link);
    const res = await client!.req<Res>(++id, { op: 'read', path: link });
    expect(res).toMatchObject({ ok: true, data: null });
    expect(res).not.toHaveProperty('absent');
    // The same target read by its own name still reads: only the lane-state name refuses to follow.
    expect(await client!.req<Res>(++id, { op: 'read', path: target })).toMatchObject({ data: 'what-the-target-holds' });
  });
  it('a `.accounts` directory that is a symlink out of the read roots reads as unreadable, never its file', async () => {
    const f = await open();
    const away = path.join(f.outside, 'accounts-elsewhere');
    mkdirSync(away, { recursive: true });
    writeFileSync(path.join(away, 'lane-a.json'), '{"identity":"what-the-outside-holds"}');
    mkdirSync(path.join(f.home, '.cc-sessions'), { recursive: true });
    symlinkSync(away, path.join(f.home, '.cc-sessions', '.accounts'));
    const res = await client!.req<Res>(++id, { op: 'read', path: path.join(f.home, '.cc-sessions', '.accounts', 'lane-a.json') });
    expect(res).toMatchObject({ ok: true, data: null });
    expect(res).not.toHaveProperty('absent');
  });

  it('a hardlink at a lane-state file\'s name reads as unreadable, never as the other file\'s bytes (D-6058 (2))', async () => {
    const f = await open();
    const other = path.join(f.home, '.claude', 'x.json');
    mkdirSync(path.dirname(other), { recursive: true });
    writeFileSync(other, '{"identity":"what-the-other-file-holds"}');
    const dir = path.join(f.home, '.cc-sessions', '.accounts');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const name = path.join(dir, 'lane-a.json');
    linkSync(other, name);
    const res = await client!.req<Res>(++id, { op: 'read', path: name });
    expect(res).toMatchObject({ ok: true, data: null });
    expect(res).not.toHaveProperty('absent');
  });
});
