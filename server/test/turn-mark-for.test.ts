// D-5370 (`stop-worker-at-run-done`): `turnMarkFor` (`src/turnverdict.ts`), the adapter behind the stop-done lane's
// `marker` and `marker-background` holds. The pass's own suite stubs `mark`, so the judgement against the LIVE process
// is pinned here, over a real registry and live file and a fake tmux: a marker older than the live process's
// `startedAt` reads `stale`, a live file with no `startedAt` reads `stale`, and anything the adapter could not read (no
// config dir, no pane pid, an absent or unreadable live file) is `unmeasured`, never a marker taken on trust.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { turnMarkFor, type TurnReadDeps } from '../src/turnverdict.js';
import type { Tmux } from '../src/exec.js';
import type { FleetIO } from '../src/io.js';
import type { SessionRecord } from '../src/registry.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { degradedReadIO } from './ioDoubles.js';

const ID = 'project-a-quiet-basin';
const UUID = `u-${ID}`;
const WRAPPER = 'claude-a';
const PANE = 4242;
const T = 1_800_000_000_000;
const MIN = 60_000;

/** The hook's fifteen-key line: a `done` after one turn, nothing in the background. */
const MARK: Record<string, unknown> = {
  v: 1, sessionId: UUID, state: 'done', event: 'Stop', at: T, turnAt: T - MIN, stopAt: T,
  bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '',
};

interface Box { home: string; deps: (o?: { pid?: number | null; io?: FleetIO }) => TurnReadDeps; rec: SessionRecord }

const box = (): Box => {
  const home = mkTmp('ccrc-turn-mark-for-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const base = testDeps(home);
  const rec = { id: ID, uuid: UUID, wrapper: WRAPPER } as unknown as SessionRecord;
  return {
    home, rec,
    deps: (o = {}) => ({
      io: o.io ?? base.io, cfg: base.cfg,
      tmux: { panePid: async () => (o.pid === undefined ? PANE : o.pid) } as unknown as Tmux,
      pendingDialogs: () => undefined, statuslines: () => undefined,
    }),
  };
};
const mark = (b: Box, over: Record<string, unknown> = {}): void => {
  writeFileSync(path.join(b.home, '.cc-sessions', `${ID}.turn.json`), `${JSON.stringify({ ...MARK, ...over })}\n`);
};
const liveFile = (b: Box, body: Record<string, unknown>): void => {
  const dir = path.join(b.home, `.${WRAPPER}`, 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${PANE}.json`), JSON.stringify({ pid: PANE, sessionId: UUID, status: 'idle', ...body }));
};

describe('turnMarkFor: the marker judged against the live process (D-5370)', () => {
  it('a fresh `done` marker of the live process reads ok, with its state and background count', async () => {
    const b = box();
    mark(b);
    liveFile(b, { startedAt: T - 60 * MIN });
    expect(await turnMarkFor(b.deps(), b.rec)).toMatchObject({ ok: true, state: 'done', bg: 0 });
  });

  it('a marker written before the live process started (`at` and `restartAt` both before `startedAt`) is stale', async () => {
    const b = box();
    mark(b, { restartAt: T - 2 * MIN });
    liveFile(b, { startedAt: T + MIN });
    expect(await turnMarkFor(b.deps(), b.rec)).toEqual({ ok: false, reason: 'stale' });
  });

  it('a live file with no `startedAt` makes the marker stale: nothing ties it to this process', async () => {
    const b = box();
    mark(b);
    liveFile(b, {});
    expect(await turnMarkFor(b.deps(), b.rec)).toEqual({ ok: false, reason: 'stale' });
  });

  it('no pane pid is unmeasured', async () => {
    const b = box();
    mark(b);
    liveFile(b, { startedAt: T - 60 * MIN });
    expect(await turnMarkFor(b.deps({ pid: null }), b.rec)).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('a live file this box could not read is unmeasured, never a marker taken on trust', async () => {
    const b = box();
    mark(b);
    liveFile(b, { startedAt: T - 60 * MIN });
    const io = degradedReadIO((p) => p.endsWith(path.join('sessions', `${PANE}.json`)));
    expect(await turnMarkFor(b.deps({ io }), b.rec)).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('an absent live file is unmeasured too', async () => {
    const b = box();
    mark(b);
    expect(await turnMarkFor(b.deps(), b.rec)).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('a wrapper this roster does not carry (no config dir) is unmeasured', async () => {
    const b = box();
    mark(b);
    liveFile(b, { startedAt: T - 60 * MIN });
    const rec = { ...b.rec, wrapper: 'claude-not-on-roster' } as SessionRecord;
    expect(await turnMarkFor(b.deps(), rec)).toEqual({ ok: false, reason: 'unmeasured' });
  });
});
