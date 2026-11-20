// D-8792 (amending D-6094): `workerFactsFor` (`src/turnverdict.ts`), the reads behind the dispatch cap's worker port,
// over a real registry row, live file and turn marker and a fake tmux. A row the registry does not list, an archived,
// asleep or stopped row and a pane tmux proved gone are `gone`, each with its why; anything that could not be read is
// `unmeasured`; an awake worker carries its turn verdict, its row's background work and its turn marker, and
// `workerReadingOf` (L1) decides from them.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { workerFactsFor, type TurnReadDeps } from '../src/turnverdict.js';
import { workerReadingOf, type WorkerFacts } from '../src/coord/dispatchDecide.js';
import { STOP_DONE_PARKED_IDLE_MS } from '../src/stopDone.js';
import type { Tmux } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'project-a-quiet-basin';
const UUID = `u-${ID}`;
const WRAPPER = 'claude-a';
const PANE = 4242;
const MIN = 60_000;

interface Opts {
  extra?: Record<string, string>; verdict?: 'live' | 'gone' | 'unknown'; mark?: Record<string, unknown> | null;
  status?: string; quietMs?: number; listed?: boolean;
}

function box(o: Opts = {}): { deps: TurnReadDeps; now: number } {
  const now = Date.now();
  const t = now - (o.quietMs ?? 2 * STOP_DONE_PARKED_IDLE_MS);
  const home = mkTmp('ccrc-worker-facts-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  if (o.listed !== false) {
    const fields: Record<string, string> = {
      wrapper: WRAPPER, project: 'project-a', workdir: `/w/${ID}`, uuid: UUID, started: '1',
      workspace: ID, branch: `ws/${ID}`, base: 'origin/main', ...(o.extra ?? {}),
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  }
  const mark = {
    v: 1, sessionId: UUID, state: 'done', event: 'Stop', at: t, turnAt: t - MIN, stopAt: t,
    bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', crons: 0,
  };
  if (o.mark !== null) writeFileSync(path.join(reg, `${ID}.turn.json`), `${JSON.stringify({ ...mark, ...(o.mark ?? {}) })}\n`);
  const sdir = path.join(home, `.${WRAPPER}`, 'sessions');
  mkdirSync(sdir, { recursive: true });
  writeFileSync(path.join(sdir, `${PANE}.json`), JSON.stringify({
    pid: PANE, sessionId: UUID, status: o.status ?? 'idle', startedAt: t - 600 * MIN, statusUpdatedAt: t,
  }));
  const base = testDeps(home);
  return {
    now,
    deps: {
      io: base.io, cfg: base.cfg,
      tmux: { sessionVerdict: async () => ({ verdict: o.verdict ?? 'live' }), panePid: async () => PANE } as unknown as Tmux,
      pendingDialogs: () => undefined, statuslines: () => undefined,
    },
  };
}

const factsOf = async (o: Opts = {}): Promise<WorkerFacts> => workerFactsFor(box(o).deps, ID);
const readingOf = async (o: Opts = {}): Promise<string> => {
  const b = box(o);
  return workerReadingOf(await workerFactsFor(b.deps, ID), b.now);
};

describe('workerFactsFor (D-8792, amending D-6094)', () => {
  it('an awake, idle worker quiet for 30 minutes with nothing running reads waiting', async () => {
    expect(await readingOf()).toBe('waiting');
    expect(await readingOf({ quietMs: STOP_DONE_PARKED_IDLE_MS + MIN })).toBe('waiting');
  });

  it('the same worker quiet under 30 minutes reads busy (between turns)', async () => {
    expect(await readingOf({ quietMs: STOP_DONE_PARKED_IDLE_MS - MIN })).toBe('busy');
  });

  it('a row the registry does not list, an archived row, and a stopped or asleep row whose pane is gone, are gone, each with its why', async () => {
    expect(await factsOf({ listed: false })).toEqual({ kind: 'gone', why: 'absent' });
    expect(await factsOf({ extra: { stopped: '1700000000 pane' }, verdict: 'gone' })).toEqual({ kind: 'gone', why: 'stopped' });
    expect(await factsOf({ extra: { archived: '1700000000' } })).toEqual({ kind: 'gone', why: 'archived' });
    expect(await factsOf({ extra: { hibernated: '1700000000' }, verdict: 'gone' })).toEqual({ kind: 'gone', why: 'asleep' });
    for (const extra of [{ stopped: '1700000000 pane' }, { archived: '1700000000' }, { hibernated: '1700000000' }] as Record<string, string>[]) {
      expect(await readingOf({ extra, verdict: 'gone' }), JSON.stringify(extra)).toBe('gone');
    }
  });

  it('a sleeper carries a stop stamp too, and still reads asleep (the send-back resume reads it)', async () => {
    expect(await factsOf({ extra: { hibernated: '1700000000', stopped: '1700000000 ccd' }, verdict: 'gone' })).toEqual({ kind: 'gone', why: 'asleep' });
  });

  it('review 2875 F5: an asleep or stopped stamp over a pane tmux proves live reads like any awake worker, never gone', async () => {
    // A failed kill (`ccd hibernate`'s roll-kill-failed exit, or a plain hibernate whose kill-session failed) leaves the
    // pane up under the stamp: the worker is read, and only tmux's proof of a gone pane makes it `gone`.
    for (const extra of [{ hibernated: '1700000000' }, { stopped: '1700000000 pane' }, { hibernated: '1700000000', stopped: '1700000000 ccd' }] as Record<string, string>[]) {
      expect((await factsOf({ extra, verdict: 'live' })).kind, JSON.stringify(extra)).toBe('awake');
      expect(await readingOf({ extra, verdict: 'live' }), JSON.stringify(extra)).toBe('waiting');
      expect(await readingOf({ extra, verdict: 'live', status: 'busy' }), JSON.stringify(extra)).toBe('busy');
      expect(await factsOf({ extra, verdict: 'unknown' }), JSON.stringify(extra)).toEqual({ kind: 'unmeasured' });
    }
  });

  it('a pane tmux proved gone is gone; one tmux could not answer for is unmeasured', async () => {
    expect(await factsOf({ verdict: 'gone' })).toEqual({ kind: 'gone', why: 'no-pane' });
    expect(await readingOf({ verdict: 'gone' })).toBe('gone');
    expect(await readingOf({ verdict: 'unknown' })).toBe('unmeasured');
  });

  it('a busy live file reads busy', async () => {
    expect(await readingOf({ status: 'busy' })).toBe('busy');
  });

  it('background work (bg not exactly 0) or a session cron keeps an idle worker busy', async () => {
    for (const mark of [{ bg: 1, bgKinds: 'shell', bgIds: 'b1' }, { bg: -1 }, { crons: 1 }]) {
      expect(await readingOf({ mark }), JSON.stringify(mark)).toBe('busy');
    }
  });

  it('a marker that cannot be read is unmeasured, never waiting', async () => {
    expect(await readingOf({ mark: null })).toBe('unmeasured');
  });

  it('a marker with no stamp is unmeasured and counts, however long it has stood', async () => {
    expect(await readingOf({ mark: { turnAt: null, stopAt: null, restartAt: null } })).toBe('unmeasured');
  });
});
