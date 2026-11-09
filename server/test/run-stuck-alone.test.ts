// D-8074 (operator ruling R1, 2026-11-08; spec §7, reason 5): "nothing else open in the programme" counts only open runs
// that are NOT themselves stuck. A run's own never-started verdict depends on its neighbours' verdicts, so the pass runs
// the other reasons first and then to a fixed point.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { localIO } from '../src/io.js';
import type { SessionVerdict } from '../src/exec.js';
import { DEAD_COORDINATOR_JOURNAL_TRUSTED } from '../src/deadCoordinator.js';
import { createRunVerdicts } from '../src/coord/runVerdicts.js';
import { runStuckPass } from '../src/coord/runStuckPass.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const T = 1_800_000_000_000;
const H = 3_600_000;
const D = 24 * H;
const COORD = 'demo-quiet-mesa';

const setup = () => {
  const home = mkTmp('ccrc-stuck-alone-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/${COORD}`, uuid: `u-${COORD}`, started: '1', workspace: COORD,
    branch: `ws/${COORD}`, base: 'origin/main',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${COORD}.${k}`), v);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const verdicts = createRunVerdicts();
  const live: SessionVerdict = { verdict: 'live' };
  const pass = () => runStuckPass({
    coord, io: localIO, cfg: testDeps(home).cfg, tmux: { sessionVerdict: async () => live }, verdicts,
    journalTrust: async () => ({ hold: null, trust: DEAD_COORDINATOR_JOURNAL_TRUSTED }), now: () => T,
  });
  const open = (program: string, wave: number, openedAgo: number, extra: Record<string, unknown> = {}): number => {
    const r = coord.openRun({ program, title: `Lane ${wave}`, project: 'demo', wave, waveOf: 3, claimedBy: COORD, ...extra });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    coord.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(T - openedAgo, r.id);
    return r.id;
  };
  return { coord, verdicts, pass, open };
};

/** A closed work run and a planned review of it: stuck as review-of-closed. */
const stuckReview = (s: ReturnType<typeof setup>, program: string): number => {
  const work = s.open(program, 1, 40 * D);
  s.coord.db.prepare("UPDATE runs SET state = 'done', closedAt = ? WHERE id = ?").run(T - 30 * D, work);
  return s.open(program, 1, 30 * D, { kind: 'review', reviews: work });
};

describe('never-started counts only open runs that are not themselves stuck (R1)', () => {
  it('a planned run whose only other open runs are stuck reviews reads never-started', async () => {
    const s = setup();
    const review = stuckReview(s, 'programme-a');
    const planned = s.open('programme-a', 2, 9 * D);
    await s.pass();
    expect(s.verdicts.of(review)!.stuck).toMatchObject({ reason: 'review-of-closed', cause: 'target-closed' });
    expect(s.verdicts.of(planned)!.stuck).toMatchObject({ reason: 'never-started', since: T - 9 * D });
  });

  it('a planned run with a healthy open neighbour does not read never-started', async () => {
    const s = setup();
    stuckReview(s, 'programme-a');
    const planned = s.open('programme-a', 2, 9 * D);
    s.open('programme-a', 3, 1 * H);
    await s.pass();
    expect(s.verdicts.of(planned)!.stuck).toBeNull();
  });

  it('a lone planned run still reads never-started, and a young one does not', async () => {
    const s = setup();
    const old = s.open('programme-a', 1, 9 * D);
    const young = s.open('programme-b', 1, 2 * D);
    await s.pass();
    expect(s.verdicts.of(old)!.stuck).toMatchObject({ reason: 'never-started' });
    expect(s.verdicts.of(young)!.stuck).toBeNull();
  });

  it('two eligible planned runs in one programme hold each other open, as before', async () => {
    const s = setup();
    const a = s.open('programme-a', 1, 9 * D);
    const b = s.open('programme-a', 2, 9 * D);
    await s.pass();
    expect(s.verdicts.of(a)!.stuck).toBeNull();
    expect(s.verdicts.of(b)!.stuck).toBeNull();
  });
});
