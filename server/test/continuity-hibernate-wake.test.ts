// Overlord W1a, the renewal hand-offs, Task 6 (plan `w1a-renewal-handoffs.md`; spec §3.3.8 "any wake is a start"): a hibernate
// wake is a `resume` start report after a sleep, and the generations lane mints a generation from it with `resumed: true`, as
// from any start; nothing else changes for a wake. With the context above half the hard cap the new generation is due
// `resumed-long` (hard); below it, it goes to its card and probes as any start does. A real coord.db and the fake time ports.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { generationsPass, type GenReadings, type RegistryFacts } from '../src/continuity/generationsLane.js';
import { hardCapTokens } from '../src/continuity/renewalDue.js';
import type { GenRow } from '../src/continuity/continuityStore.js';
import type { UsageRead } from '../src/usage.js';
import { RESUMED_LONG_FRACTION } from '../../shared/continuity.js';
import { fakeTime, FAKE_T0 } from './fakeTime.js';
import { mkTmp } from './tmpHelpers.js';

const COORD = 'lane-a-project-a';
const U1 = '11111111-1111-4111-8111-111111111111';
const WINDOW = 1_000_000;
const HALF = hardCapTokens(WINDOW) * RESUMED_LONG_FRACTION;
const usage = (ctxTokens: number): UsageRead => ({ kind: 'reading', uuid: null, usage: {
  ts: 1, model: 'claude-opus-5-5', class: null, effort: null, ctxPct: null, ctxTokens, ctxWindow: WINDOW, cost: null, cacheExpiresAt: null, stale: false,
} });

function fx() {
  const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-hibernate-wake-'), '.ccrc', 'coord.db')));
  s.db.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'P', 1, 'active')");
  s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 1, 2, 'project-a', 'working', ?, 1)").run(COORD);
  const t = fakeTime({ wallMs: FAKE_T0, monoMs: 1_000 });
  const registry: RegistryFacts[] = [{ id: COORD, uuid: U1, lane: 'lane-a', child: { kind: 'none' } }];
  let n = 0;
  const start = (source: string): void => {
    n += 1;
    const r = s.insertStart({ sessionId: COORD, reportId: `r-${n}`, uuid: U1, source, model: 'claude-opus-5-5', rowIncarnation: 'inc-1',
      reportedAt: t.ports.clock.wall(), receivedAt: t.ports.clock.wall() });
    if (!r.ok) throw new Error('start');
  };
  const gens = (): GenRow[] => { const r = s.liveGenerations(); if (!r.ok) throw new Error(r.detail); return r.rows; };
  const pass = (ctx?: number) => {
    const readings = new Map<number, GenReadings>();
    if (ctx !== undefined) {
      for (const g of gens()) readings.set(g.id, { usage: usage(ctx), compactions: { kind: 'absent' }, turn: { ok: false, reason: 'absent' } as never,
        behind: { kind: 'measured', value: false } });
    }
    return generationsPass({ coord: s, clock: t.ports.clock, entropy: t.ports.entropy, proc: 'p1', log: () => {}, retried: new Set(),
      emptyTries: new Map(), gate: () => null }, { registry, readings, listedAt: t.ports.clock.wall() + 1, canRenew: true });
  };
  return { s, t, start, gens, pass };
}

describe('a hibernate wake is a start (Task 6)', () => {
  it('the wake\'s resume start mints a generation with resumed: true, and above half the hard cap it is due resumed-long (hard)', () => {
    const f = fx();
    f.start('startup');
    f.pass();
    // The session sleeps (the hibernate lane), and its wake resumes the same conversation hours later.
    f.t.advance(6 * 3_600_000);
    f.start('resume');
    f.pass();
    expect(f.gens()).toMatchObject([{ n: 2, resumed: true }]);
    f.t.advance(30_000);
    f.pass(HALF + 1_000);
    expect(f.gens()[0]).toMatchObject({ n: 2, resumed: true, dueWhy: 'resumed-long', dueClass: 'hard' });
  });

  it('below half the hard cap the woken generation is not due: it goes to its card and probes as any start does', () => {
    const f = fx();
    f.start('startup');
    f.pass();
    f.t.advance(6 * 3_600_000);
    f.start('resume');
    f.pass();
    f.t.advance(30_000);
    f.pass(HALF - 1_000);
    expect(f.gens()[0]).toMatchObject({ n: 2, resumed: true, dueWhy: null, shadowState: 'carded' });
  });
});
