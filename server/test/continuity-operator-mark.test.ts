// Overlord W1a, the renewal hand-offs, Task 3 (plan `w1a-renewal-handoffs.md`; spec §3.3.9 C50, Table 11.1e): the
// `operator-at-programme` mark. The console's prompt route writes a programme's mark `at` after a prompt is typed into any
// session of it; the generations lane ages the mark by observed time in a row of its own (`operator_mark_quiet`, keyed on the
// `at` it read: the coordinator's ruling F5), so a restart never ages it and a prompt between a pass's read and its write is
// never overwritten. A coordinator's soft renewal reads its programmes' youngest mark: younger than 20 minutes waits for a
// break, older starts, older than 30 minutes is no activity. A real coord.db, fixture HOMEs and the fake time ports.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { generationsPass, type GenerationsDeps, type GenReadings, type RegistryFacts } from '../src/continuity/generationsLane.js';
import { markProgrammesOf, operatorQuietOf } from '../src/continuity/operatorMark.js';
import { softRenewalMay, type SoftInputs } from '../src/continuity/softRenewal.js';
import { BREAK_NO_MESSAGE_MS, LEAST_AGE_MS, OPERATOR_MARK_MS, RENEWAL_LANE_PERIOD_MS } from '../../shared/continuity.js';
import { observedStepCapMs } from '../src/time/observed.js';
import { PROMPT_ID, promptRig } from './continuityPromptRig.js';
import { fakeTime, FAKE_T0, type FakeTime } from './fakeTime.js';
import { mkTmp } from './tmpHelpers.js';

const COORD = 'lane-a-project-a';
const U1 = '11111111-1111-4111-8111-111111111111';
const MIN = 60_000;
const CAP = observedStepCapMs(RENEWAL_LANE_PERIOD_MS);

const marks = (coord: CoordStore): unknown[] => coord.db.prepare('SELECT programme, at FROM operator_marks ORDER BY programme').all();
const prompt = (app: FastifyInstance) => app.inject({ method: 'POST', url: `/api/sessions/${PROMPT_ID}/prompt`, payload: { text: 'hello' } });
const openRun = (coord: CoordStore, program: string, col: 'claimedBy' | 'sessionId', id: string): void => {
  coord.db.prepare('INSERT OR IGNORE INTO programs (slug, title, createdAt, state) VALUES (?, ?, 1, ?)').run(program, 'P', 'active');
  coord.db.prepare(`INSERT INTO runs (program, wave, waveOf, project, state, ${col}, openedAt) VALUES (?, 1, 2, 'project-a', 'working', ?, 1)`).run(program, id);
};

// ── The prompt route writes `at` ─────────────────────────────────────────────────────────────────────────────────────

describe('the prompt route writes the mark (Task 3)', () => {
  it('a prompt into a coordinator of prog-a marks prog-a, at the wall time it was typed', async () => {
    const { app, coord, time } = await promptRig();
    openRun(coord, 'prog-a', 'claimedBy', PROMPT_ID);
    expect((await prompt(app)).statusCode).toBe(200);
    expect(marks(coord)).toEqual([{ programme: 'prog-a', at: time.ports.clock.wall() }]);
  });

  it('a prompt into a worker of prog-a marks prog-a (slug mark-for-any-session-of-the-programme)', async () => {
    const { app, coord } = await promptRig();
    openRun(coord, 'prog-a', 'sessionId', PROMPT_ID);
    expect((await prompt(app)).statusCode).toBe(200);
    expect(marks(coord)).toMatchObject([{ programme: 'prog-a' }]);
  });

  it('a prompt into a session with no programme marks nothing', async () => {
    const { app, coord } = await promptRig();
    expect((await prompt(app)).statusCode).toBe(200);
    expect(marks(coord)).toEqual([]);
  });

  it('a prompt the route refused (renewing) marks nothing: only a typed prompt marks', async () => {
    const { app, coord } = await promptRig();
    openRun(coord, 'prog-a', 'claimedBy', PROMPT_ID);
    const s = coord.insertStart({ sessionId: PROMPT_ID, reportId: 'r-1', uuid: U1, source: 'startup', model: null, rowIncarnation: 'inc',
      reportedAt: 1, receivedAt: 1 });
    if (!s.ok) throw new Error('start');
    coord.mintGeneration({ identity: PROMPT_ID, sessionId: PROMPT_ID, role: 'coordinator', term: 1, rowIncarnation: 'inc', startId: s.id,
      startReportedAt: 1, resumed: false, model: null, lane: 'claude-a', host: null, outcome: 'woken', mono: 1, proc: 'p1', now: 1 }, null, true);
    expect((await prompt(app)).statusCode).toBe(409);
    expect(marks(coord)).toEqual([]);
  });
});

describe('markProgrammesOf and operatorQuietOf (L1)', () => {
  it('the programmes of the claimed and worked runs, each once; either read failing is unmeasured', () => {
    expect(markProgrammesOf({ ok: true, siblings: [{ program: 'a' }, { program: 'b' }] }, { ok: true, siblings: [{ program: 'a' }] })).toEqual(['a', 'b']);
    expect(markProgrammesOf({ ok: true, siblings: [] }, { ok: true, siblings: [] })).toEqual([]);
    expect(markProgrammesOf({ ok: false }, { ok: true, siblings: [] })).toBe('unmeasured');
    expect(markProgrammesOf({ ok: true, siblings: [] }, { ok: false })).toBe('unmeasured');
  });

  it('the youngest mark of the programmes; no quiet for its `at` reads 0; no mark, or one 30 minutes old, is no activity', () => {
    const q = (ms: number) => ({ ms, mono: 0, proc: 'p1' });
    expect(operatorQuietOf(['a'], [{ programme: 'a', quiet: null }])).toEqual({ kind: 'measured', value: 0 });
    expect(operatorQuietOf(['a', 'b'], [{ programme: 'a', quiet: q(25 * MIN) }, { programme: 'b', quiet: q(5 * MIN) }])).toEqual({ kind: 'measured', value: 5 * MIN });
    expect(operatorQuietOf(['a'], [{ programme: 'a', quiet: q(OPERATOR_MARK_MS + 1) }])).toEqual({ kind: 'measured', value: OPERATOR_MARK_MS });
    expect(operatorQuietOf(['a'], [])).toEqual({ kind: 'measured', value: OPERATOR_MARK_MS });
    expect(operatorQuietOf([], [{ programme: 'a', quiet: null }])).toEqual({ kind: 'measured', value: OPERATOR_MARK_MS });
    expect(operatorQuietOf('unmeasured', [])).toMatchObject({ kind: 'unmeasured' });
    expect(operatorQuietOf(['a'], 'unmeasured')).toMatchObject({ kind: 'unmeasured' });
    expect(OPERATOR_MARK_MS).toBe(30 * MIN);
  });
});

// ── The lane ages `quiet`, and a coordinator's soft renewal reads it ─────────────────────────────────────────────────

interface LaneFx {
  s: CoordStore; t: FakeTime; soft: SoftInputs[];
  pass(proc?: string): ReturnType<typeof generationsPass>;
  quiet(): number | null;
}

/** prog-a's coordinator, at rest in shadow past its least age, with a soft due every pass and a free hold table. `hold`: the
 *  permit's answer is recorded and then held, so the generation stays at rest and every pass reads the mark. */
function laneFx(hold = false): LaneFx {
  const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-mark-lane-'), '.ccrc', 'coord.db')));
  openRun(s, 'prog-a', 'claimedBy', COORD);
  const t = fakeTime({ wallMs: FAKE_T0, monoMs: 1_000 });
  const st = s.insertStart({ sessionId: COORD, reportId: 'r-1', uuid: U1, source: 'startup', model: 'claude-opus-5-5', rowIncarnation: 'inc',
    reportedAt: t.ports.clock.wall(), receivedAt: t.ports.clock.wall() });
  if (!st.ok) throw new Error('start');
  const w = s.mintGeneration({ identity: COORD, sessionId: COORD, role: 'coordinator', term: 1, rowIncarnation: 'inc', startId: st.id,
    startReportedAt: t.ports.clock.wall(), resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'woken',
    mono: 1_000, proc: 'p1', now: t.ports.clock.wall() }, null, false);
  if (!w.ok) throw new Error('mint');
  s.db.prepare("UPDATE continuity_generations SET shadowState = NULL, walk = NULL, shadowDeadlineAt = NULL, mintedObservedMs = ? WHERE id = ?")
    .run(-LEAST_AGE_MS, w.id);
  // The starts cursor past the start, so the pass mints nothing more.
  s.advanceCursor({ lane: 'generations', from: 0, to: st.id });
  const registry: RegistryFacts[] = [{ id: COORD, uuid: U1, lane: 'lane-a', child: { kind: 'none' } }];
  const soft: SoftInputs[] = [];
  const free: GenReadings = { usage: { kind: 'absent' }, compactions: { kind: 'absent' }, turn: { ok: false, reason: 'absent' } as never,
    behind: { kind: 'measured', value: false }, drain: { held: false } };
  const pass = (proc = 'p1') => {
    const deps: GenerationsDeps = { coord: s, clock: t.ports.clock, entropy: t.ports.entropy, proc, log: () => {}, retried: new Set(),
      emptyTries: new Map(), gate: () => null, decide: {
        renewalDue: () => ({ due: true, cls: 'soft', why: 'two-compactions', blind: [] }),
        softRenewalMay: (i) => { soft.push(i); return hold ? { start: false, waitFor: 'no-break' } : softRenewalMay(i); },
      } };
    return generationsPass(deps, { registry, readings: new Map([[w.id, free]]), listedAt: t.ports.clock.wall() + 1, canRenew: true });
  };
  const quiet = (): number | null => {
    const r = s.operatorMarks();
    if (!r.ok) throw new Error(r.detail);
    const m = r.rows.find((x) => x.programme === 'prog-a');
    return m === undefined ? null : m.quiet?.ms ?? 0;
  };
  return { s, t, soft, pass, quiet };
}
const lastQuiet = (f: LaneFx): unknown => f.soft.at(-1)?.operatorQuietObservedMs;
/** Passes every lane period for `ms` of wall and monotonic time. */
const passFor = (f: LaneFx, ms: number, proc = 'p1'): ReturnType<typeof generationsPass> => {
  let r = f.pass(proc);
  for (let at = RENEWAL_LANE_PERIOD_MS; at <= ms; at += RENEWAL_LANE_PERIOD_MS) { f.t.advance(RENEWAL_LANE_PERIOD_MS); r = f.pass(proc); }
  return r;
};

describe('the generations lane ages the mark and a coordinator reads it (Task 3)', () => {
  it('a prompt, then a check before the next pass: the mark reads 0 and the soft renewal waits for a break (ruling F5)', () => {
    const f = laneFx();
    expect(f.s.putOperatorMark('prog-a', f.t.ports.clock.wall())).toEqual({ ok: true });
    expect(f.quiet()).toBe(0);
    const r = f.pass();
    expect(lastQuiet(f)).toEqual({ kind: 'measured', value: 0 });
    expect(r.waits).toMatchObject({ 'no-break': 1 });
  });

  it('the soft renewal waits while the mark is younger than 20 minutes and starts after', () => {
    const f = laneFx();
    f.s.putOperatorMark('prog-a', f.t.ports.clock.wall());
    const before = passFor(f, BREAK_NO_MESSAGE_MS - RENEWAL_LANE_PERIOD_MS);
    expect(before.waits).toMatchObject({ 'no-break': 1 });
    expect((lastQuiet(f) as { value: number }).value).toBeLessThan(BREAK_NO_MESSAGE_MS);
    f.t.advance(RENEWAL_LANE_PERIOD_MS);
    const after = f.pass();
    expect((lastQuiet(f) as { value: number }).value).toBeGreaterThanOrEqual(BREAK_NO_MESSAGE_MS);
    expect(after.waits).toEqual({});
    expect(f.s.liveGenerations()).toMatchObject({ ok: true, rows: [{ shadowState: 'draining' }] });
  });

  it('a mark older than 30 minutes reads as no activity and stops aging', () => {
    const f = laneFx(true);
    f.s.putOperatorMark('prog-a', f.t.ports.clock.wall());
    passFor(f, OPERATOR_MARK_MS + 2 * RENEWAL_LANE_PERIOD_MS);
    const q = f.quiet()!;
    expect(q).toBeGreaterThanOrEqual(OPERATOR_MARK_MS);
    expect(lastQuiet(f)).toEqual({ kind: 'measured', value: OPERATOR_MARK_MS });
    f.t.advance(RENEWAL_LANE_PERIOD_MS);
    f.pass();
    expect(f.quiet()).toBe(q);
  });

  it('a mark written before a server restart does not age across the gap: the first pass after it advances nothing', () => {
    const f = laneFx();
    f.s.putOperatorMark('prog-a', f.t.ports.clock.wall());
    passFor(f, 5 * MIN);
    const q = f.quiet()!;
    expect(q).toBe(5 * MIN);
    // The server is down an hour; a new process's first pass re-anchors with no advance, its second ages by one period.
    f.t.advance(60 * MIN);
    f.pass('p2');
    expect(f.quiet()).toBe(q);
    f.t.advance(RENEWAL_LANE_PERIOD_MS);
    f.pass('p2');
    expect(f.quiet()).toBe(q + RENEWAL_LANE_PERIOD_MS);
  });

  it('a freeze advances the mark by the step cap only', () => {
    const f = laneFx();
    f.s.putOperatorMark('prog-a', f.t.ports.clock.wall());
    f.pass();
    f.t.advance(60 * MIN);
    f.pass();
    expect(f.quiet()).toBe(CAP);
  });

  it('a prompt between a pass\'s read and its write resets quiet, and the pass\'s advance is refused by the compare-and-set', () => {
    const f = laneFx();
    const at0 = f.t.ports.clock.wall();
    f.s.putOperatorMark('prog-a', at0);
    passFor(f, 3 * MIN);
    const read = f.s.operatorMarks();
    if (!read.ok) throw new Error(read.detail);
    const m = read.rows[0]!;
    // The prompt lands after the lane's read ...
    f.t.advance(1_000);
    f.s.putOperatorMark('prog-a', f.t.ports.clock.wall());
    // ... so the write of what the lane read is refused, and the new mark reads 0.
    expect(f.s.advanceMarkQuiet('prog-a', m.at, { ms: 99 * MIN, mono: 0, proc: 'p1' })).toEqual({ changed: false });
    expect(f.quiet()).toBe(0);
    expect(m.at).toBe(at0);
  });
});
