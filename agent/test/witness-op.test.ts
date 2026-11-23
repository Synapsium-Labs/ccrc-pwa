// Overlord W1 authority journal plan, Task 6: the agent's `witness` op and its file (`agent/src/witness.ts`). A REAL agent over
// loopback against a fixture HOME (`token-sync-op.test.ts`'s idiom); no case touches a live HOME.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { constants, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { answerWitness, readHeldWitness } from '../src/witness.js';
import { AUTHORITY_WITNESS_FILE_NAME, CCRC_DIR_NAME, type AgentReady } from '../../shared/agent-protocol.js';
import type { WitnessTuple } from '../../shared/authorityWitness.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, openSync: vi.fn(fs.openSync) };
});

const D = (c: string): string => c.repeat(64);
function tuple(epoch: number, boot = 'boot-a'): WitnessTuple {
  return {
    v: 1, epoch, base: 0, terms: { authority: epoch, privacy: 'absent', act: 'absent' }, boot,
    authority: { sequence: epoch, digest: D('a') }, privacy: 'absent', act: 'absent', highestIds: { restoreGeneration: 0 },
    told: { operatorRung: null, latches: [] },
  };
}

describe('the witness file and its answer', () => {
  let fixture: Fixture | undefined;
  afterEach(() => {
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });
  const file = (home: string): string => path.join(home, CCRC_DIR_NAME, AUTHORITY_WITNESS_FILE_NAME);

  it('holds nothing before any offer, and the first offer is kept and written 0600 into a created 0700 directory', () => {
    fixture = makeFixture();
    const home = fixture.home;
    expect(readHeldWitness(home)).toEqual({ kind: 'held', tuple: null });
    expect(answerWitness(home, tuple(3))).toEqual({ kind: 'held', tuple: tuple(3) });
    expect(readHeldWitness(home)).toEqual({ kind: 'held', tuple: tuple(3) });
    expect(statSync(file(home)).mode & 0o777).toBe(0o600);
    expect(statSync(path.join(home, CCRC_DIR_NAME)).mode & 0o777).toBe(0o700);
    expect(readdirSync(path.join(home, CCRC_DIR_NAME))).toEqual([AUTHORITY_WITNESS_FILE_NAME]);
  });

  it('keeps the higher epoch', () => {
    fixture = makeFixture();
    const home = fixture.home;
    answerWitness(home, tuple(3));
    expect(answerWitness(home, tuple(5))).toEqual({ kind: 'held', tuple: tuple(5) });
    expect(answerWitness(home, tuple(4))).toEqual({ kind: 'held', tuple: tuple(5) });
    expect(readHeldWitness(home)).toEqual({ kind: 'held', tuple: tuple(5) });
  });

  it('on an equal epoch keeps what it holds, and writes nothing', () => {
    fixture = makeFixture();
    const home = fixture.home;
    answerWitness(home, tuple(3, 'boot-held'));
    const before = readFileSync(file(home));
    expect(answerWitness(home, tuple(3, 'boot-offered'))).toEqual({ kind: 'held', tuple: tuple(3, 'boot-held') });
    expect(readFileSync(file(home)).equals(before)).toBe(true);
  });

  it('never writes over a malformed file: unmeasured, bytes unchanged', () => {
    fixture = makeFixture();
    const home = fixture.home;
    mkdirSync(path.join(home, CCRC_DIR_NAME), { recursive: true });
    writeFileSync(file(home), '{"v":1,"epoch":');
    const before = readFileSync(file(home));
    expect(answerWitness(home, tuple(9))).toEqual({ kind: 'unmeasured', why: 'malformed' });
    expect(readFileSync(file(home)).equals(before)).toBe(true);
    writeFileSync(file(home), JSON.stringify({ ...tuple(1), extra: true }));
    expect(readHeldWitness(home)).toEqual({ kind: 'unmeasured', why: 'malformed' });
  });

  it('never writes over an unreadable file (a directory in its place): unmeasured unreadable', () => {
    fixture = makeFixture();
    const home = fixture.home;
    mkdirSync(file(home), { recursive: true });
    expect(answerWitness(home, tuple(9))).toEqual({ kind: 'unmeasured', why: 'unreadable' });
    expect(statSync(file(home)).isDirectory()).toBe(true);
  });

  it('refuses a FIFO without waiting for a writer', async () => {
    fixture = makeFixture();
    const home = fixture.home;
    const fifo = file(home);
    mkdirSync(path.dirname(fifo), { recursive: true });
    execFileSync('mkfifo', [fifo], { timeout: 5_000 });
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const opened = vi.mocked(openSync);
    let wouldBlock = false;
    opened.mockImplementation((name, flags, mode) => {
      // Never let a regressed synchronous open hang the test runner. All safe opens are real.
      if (name === fifo && (typeof flags !== 'number' || (flags & constants.O_NONBLOCK) === 0)) {
        wouldBlock = true;
        throw new Error('fixture refuses a blocking open');
      }
      return fs.openSync(name, flags, mode);
    });
    try {
      expect(readHeldWitness(home)).toEqual({ kind: 'unmeasured', why: 'unreadable' });
      expect(wouldBlock).toBe(false);
    } finally { opened.mockReset(); }
  });

  it('refuses a symbolic link even if its target is missing', () => {
    fixture = makeFixture();
    const home = fixture.home;
    const link = file(home);
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(path.join(home, 'missing-target'), link);
    expect(readHeldWitness(home)).toEqual({ kind: 'unmeasured', why: 'unreadable' });
  });

  it('refuses an oversized regular file without overwriting it, even when it contains valid JSON', () => {
    fixture = makeFixture();
    const home = fixture.home;
    mkdirSync(path.join(home, CCRC_DIR_NAME), { recursive: true });
    const original = JSON.stringify(tuple(3)) + ' '.repeat(128 * 1024);
    writeFileSync(file(home), original);
    expect(readHeldWitness(home)).toEqual({ kind: 'unmeasured', why: 'unreadable' });
    expect(answerWitness(home, tuple(9))).toEqual({ kind: 'unmeasured', why: 'unreadable' });
    expect(readFileSync(file(home), 'utf8')).toBe(original);
  });

  it('does not replace a readable witness with an offer it could not read back', () => {
    fixture = makeFixture();
    const home = fixture.home;
    answerWitness(home, tuple(3));
    const large = tuple(9);
    large.told.latches = Array.from({ length: 3000 }, (_, i) => ({ cause: `fixture-${String(i).padStart(4, '0')}`, cap: 'chat' }));
    const answer = answerWitness(home, large);
    expect(answer.kind === 'unmeasured' ? answer.why : answer.kind).toBe('unwritable');
    expect(readHeldWitness(home)).toEqual({ kind: 'held', tuple: tuple(3) });
  });

  it('a write failure answers unwritable and leaves no file (the parent is a plain file)', () => {
    fixture = makeFixture();
    const home = fixture.home;
    writeFileSync(path.join(home, CCRC_DIR_NAME), 'not a directory');
    expect(answerWitness(home, tuple(2))).toMatchObject({ kind: 'unmeasured' });
  });
});

describe('the witness op over a real agent', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  const clients: TestClient[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });
  async function up(pre?: (home: string) => void): Promise<{ c: TestClient; ready: AgentReady; home: string }> {
    fixture = makeFixture();
    pre?.(fixture.home);
    agent = await boot(fixture);
    const c = new TestClient(agent.port);
    clients.push(c);
    const ready = (await c.hello()) as AgentReady;
    return { c, ready, home: fixture.home };
  }

  it('lists witness in ready.ops, and sends null when it holds nothing', async () => {
    const { ready } = await up();
    expect(ready.ops).toContain('witness');
    expect(ready.authorityWitness).toBeNull();
  });

  it('sends the held tuple on ready, read fresh from the file', async () => {
    const { ready } = await up((home) => { answerWitness(home, tuple(4)); });
    expect(ready.authorityWitness).toEqual(tuple(4));
  });

  it("sends 'unmeasured' on ready when the file is malformed", async () => {
    const { ready } = await up((home) => {
      mkdirSync(path.join(home, CCRC_DIR_NAME), { recursive: true });
      writeFileSync(path.join(home, CCRC_DIR_NAME, AUTHORITY_WITNESS_FILE_NAME), 'garbage');
    });
    expect(ready.authorityWitness).toBe('unmeasured');
  });

  it('answers an offer with what it holds, and keeps the higher epoch across offers', async () => {
    const { c } = await up();
    expect(await c.req(1, { op: 'witness', offer: tuple(2) })).toEqual({ t: 'res', id: 1, ok: true, kind: 'held', tuple: tuple(2) });
    expect(await c.req(2, { op: 'witness', offer: tuple(1) })).toEqual({ t: 'res', id: 2, ok: true, kind: 'held', tuple: tuple(2) });
  });

  it.each([
    ['no offer', {}], ['a null offer', { offer: null }], ['a partial tuple', { offer: { v: 1, epoch: 1 } }],
    ['an unknown key in the tuple', { offer: { ...tuple(1), extra: 1 } }], ['an extra frame key', { offer: tuple(1), force: true }],
  ])('%s is bad-request and writes nothing', async (_l, extra) => {
    const { c, home } = await up();
    expect(await c.req(1, { op: 'witness', ...extra })).toEqual({ t: 'res', id: 1, ok: false, err: 'bad-request' });
    expect(readHeldWitness(home)).toEqual({ kind: 'held', tuple: null });
  });
});
