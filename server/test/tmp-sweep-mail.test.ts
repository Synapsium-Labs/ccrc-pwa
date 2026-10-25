// D-6624 (fleet disk retention plan Task DR-12, spec §2.1 and §2.1.1): the tmp sweep's census is READ by the server
// (`parseTmpSweepCensus`), a session is told what the sweep moved (`tmpSweepReceipts`), and told once per over-budget
// episode that the budget will enforce (`tmpSweepBudget`). The L1 deciders are cases on literal censuses; the lane
// (`runTmpSweepCensusLane`) is proven against a real coord store and a fake fleet io. No box and no marker is touched.
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { FleetIO } from '../src/io.js';
import { localIO } from '../src/io.js';
import { runTmpSweepCensusLane, newTmpSweepLaneState } from '../src/tmpSweepLane.js';
import {
  parseTmpSweepCensus, tmpSweepBudget, tmpSweepHolders, tmpSweepInodeBudget, tmpSweepReceipts,
  type TmpSweepCensus, type TmpSweepMoved, type TmpSweepSession,
} from '../src/tmpSweep.js';
import { MAIL_BODY_MAX_BYTES, MAIL_SUBJECT_MAX_BYTES } from '../../shared/api.js';
import { NODE_FILES } from '../../shared/agent-protocol.js';
import { mkTmp } from './tmpHelpers.js';

const GIB = 1024 ** 3;
const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;

const moved = (seq: number, over: Partial<TmpSweepMoved> = {}): TmpSweepMoved => ({
  seq, id: 'project-a-quiet-basin', uuid: 'a'.repeat(36), name: `entry-${seq}`, kind: 'scratch', bytes: 3 * GIB,
  at: T0, shadow: false, quarantine: `/q/${'a'.repeat(36)}/${seq}.entry-${seq}`, ...over,
});
const session = (over: Partial<TmpSweepSession> = {}): TmpSweepSession => ({
  id: 'project-a-quiet-basin', uuid: 'a'.repeat(36), bytes: 1 * GIB,
  budget: { state: 'ok', overSince: null, enforceAt: null, removedBytes: 0, kept: [] }, top: [], ...over,
});
const census = (over: Partial<TmpSweepCensus> = {}): TmpSweepCensus => ({
  v: 1, at: T0, pressure: false, arm: 'live', seq: 0, sessions: [], moved: [], ...over,
});
const overBudget = (over: Partial<TmpSweepSession['budget']> = {}, top: TmpSweepSession['top'] = []): TmpSweepSession =>
  session({ bytes: 24 * GIB, top, budget: { state: 'over', overSince: T0, enforceAt: T0 + 24 * HOUR, removedBytes: 0, kept: [], ...over } });
const json = (c: unknown): string => JSON.stringify(c);

describe('parseTmpSweepCensus — the one reader', () => {
  // "The reader's own shape" is the writer's wire shape, not the parsed form: a test-run row parses its empty `id` and
  // `uuid` to `null` (D-6854), and the reader refuses `null` there on input. Nothing re-serialises a parsed census.
  it('round-trips a census of the reader\'s own shape', () => {
    const c = census({ seq: 2, sessions: [overBudget()], moved: [moved(1), moved(2)] });
    expect(parseTmpSweepCensus(json(c))).toEqual(c);
  });

  it('a test-run row in the writer\'s own shape (both fields empty) parses as naming no session (D-6854)', () => {
    const wire = { ...census(), moved: [{ ...moved(1), kind: 'test-run', id: '', uuid: '', quarantine: null }] };
    const got = parseTmpSweepCensus(json(wire));
    expect(got, 'the census reads as measured').not.toBeNull();
    expect(got!.moved).toMatchObject([{ kind: 'test-run', id: null, uuid: null }]);
  });

  it('tolerates the writer\'s extra fields and a session row with no `top`', () => {
    const wire = { ...census({ sessions: [overBudget()] }), liveAt: 5, roots: [{ arm: 'live', path: '/r', noatime: false }], counts: {}, probed: {} };
    delete (wire.sessions[0] as unknown as Record<string, unknown>)['top'];
    const got = parseTmpSweepCensus(json(wire));
    expect(got?.sessions[0]?.top).toEqual([]);
  });

  it.each([
    ['not json', '{'], ['an array', '[]'], ['a wrong version', json({ ...census(), v: 2 })],
    ['a non-boolean pressure', json({ ...census(), pressure: 'yes' })],
    ['a session with no budget', json({ ...census(), sessions: [{ id: 'a', uuid: 'b', bytes: 1 }] })],
    ['a negative size', json({ ...census({ sessions: [session({ bytes: -1 })] }) })],
    ['a moved row with no seq', json({ ...census(), moved: [{ ...moved(1), seq: undefined }] })],
    ['a half-written file', json(census()).slice(0, 40)],
    ['a scratch row with an empty id', json({ ...census(), moved: [moved(1, { id: '' })] })],
    ['a test-run row with only its id empty', json({ ...census(), moved: [moved(1, { kind: 'test-run', id: '', quarantine: null })] })],
    ['a test-run row with only its uuid empty', json({ ...census(), moved: [moved(1, { kind: 'test-run', uuid: '', quarantine: null })] })],
    ...(['scratch', 'budget', 'output-capped'] as const).map((kind): [string, string] =>
      [`${kind === 'output-capped' ? 'an' : 'a'} ${kind} row with both fields empty (only a test-run row may name no session)`, json({ ...census(), moved: [moved(1, { kind, id: '', uuid: '' })] })]),
  ])('%s is null (unmeasured), never an empty census', (_name, text) => {
    expect(parseTmpSweepCensus(text)).toBeNull();
  });
});

describe('tmpSweepReceipts — one mail per session per pass, never for shadow', () => {
  it('two passes\' rows for one session send two mails, and a re-read of either sends none', () => {
    const pass1 = census({ seq: 2, moved: [moved(1), moved(2)] });
    const first = tmpSweepReceipts(pass1, 0);
    expect(first.mails).toHaveLength(1);
    expect(first.mails[0]!.subject).toBe(`tmp-sweep: moved 2 entries (seq 1-2, pass ${T0})`);
    expect(tmpSweepReceipts(pass1, first.mailed).mails.map((m) => m.subject), 'a re-read rebuilds the same subject').toEqual(first.mails.map((m) => m.subject));
    const pass2 = census({ seq: 4, at: T0 + HOUR, moved: [moved(1), moved(2), moved(3, { at: T0 + HOUR }), moved(4, { at: T0 + HOUR })] });
    const second = tmpSweepReceipts(pass2, first.mailed);
    expect(second.mails.map((m) => m.subject)).toEqual([`tmp-sweep: moved 2 entries (seq 1-2, pass ${T0})`, `tmp-sweep: moved 2 entries (seq 3-4, pass ${T0 + HOUR})`]);
    expect(tmpSweepReceipts(pass2, second.mailed).mails).toHaveLength(2);
  });

  it('shadow rows send no mail, and the high-water still passes them', () => {
    const c = census({ seq: 3, arm: 'shadow', moved: [moved(1, { shadow: true }), moved(2, { shadow: true }), moved(3, { shadow: true })] });
    const r = tmpSweepReceipts(c, 0);
    expect(r.mails).toEqual([]);
    expect(r.mailed).toBe(3);
  });

  it('one mail per session: two sessions in a pass get two mails', () => {
    const c = census({ seq: 3, moved: [moved(1), moved(2, { id: 'project-b-calm-mesa', uuid: 'b'.repeat(36) }), moved(3)] });
    const r = tmpSweepReceipts(c, 0);
    expect(r.mails.map((m) => [m.toId, m.subject])).toEqual([
      ['project-a-quiet-basin', `tmp-sweep: moved 2 entries (seq 1-3, pass ${T0})`],
      ['project-b-calm-mesa', `tmp-sweep: moved 1 entries (seq 2-2, pass ${T0})`],
    ]);
  });

  it('a live test-run row (no session owns it, D-6854) is mailed to no one; the session beside it still is', () => {
    const c = census({ seq: 2, moved: [moved(1), moved(2, { kind: 'test-run', id: null, uuid: null, quarantine: null })] });
    const r = tmpSweepReceipts(c, 0);
    expect(r.mails.map((m) => [m.toId, m.subject])).toEqual([['project-a-quiet-basin', `tmp-sweep: moved 1 entries (seq 1-1, pass ${T0})`]]);
  });

  it('a census whose seq fell below the high-water (a recreated file) is read from the start', () => {
    const c = census({ seq: 2, moved: [moved(1), moved(2)] });
    expect(tmpSweepReceipts(c, 50).mails).toHaveLength(1);
  });

  it('the body names the quarantine path and the time to move it back', () => {
    const c = census({ seq: 1, moved: [moved(1, { name: 'big-dir', bytes: 2 * GIB })] });
    const body = tmpSweepReceipts(c, 0).mails[0]!.body;
    expect(body).toContain('big-dir');
    expect(body).toContain(`/q/${'a'.repeat(36)}/1.entry-1`);
    expect(body).toContain('2.0 GiB');
    expect(body).toContain(`move it back before ${new Date(T0 + 24 * HOUR).toISOString()} to keep it`);
  });

  it('under pressure the quarantine lives one hour, and the body says so', () => {
    const c = census({ seq: 1, pressure: true, moved: [moved(1)] });
    expect(tmpSweepReceipts(c, 0).mails[0]!.body).toContain(`move it back before ${new Date(T0 + HOUR).toISOString()} to keep it`);
  });

  it('budget removals arrive as receipt rows with their quarantine paths, and kept entries with why', () => {
    const c = census({
      seq: 1, moved: [moved(1, { kind: 'budget', name: 'old-run' })],
      sessions: [session({ budget: { state: 'enforced', overSince: T0 - 30 * HOUR, enforceAt: T0 - 6 * HOUR, removedBytes: 3 * GIB,
        kept: [{ name: 'held-dir', why: 'held' }, { name: 'fresh-dir', why: 'touched-within-48h' }] } })],
    });
    const body = tmpSweepReceipts(c, 0).mails[0]!.body;
    expect(body).toMatch(/budget.*old-run/s);
    expect(body).toContain('/q/');
    expect(body).toContain('held-dir');
    expect(body).toContain('held');
    expect(body).toContain('fresh-dir');
    expect(body).toContain('touched-within-48h');
  });

  it('a body of about 200 rows stays inside the mail body bound and points at the census', () => {
    const rows = Array.from({ length: 200 }, (_, i) => moved(i + 1, { name: `a-fairly-long-entry-name-${i}` }));
    const kept = Array.from({ length: 200 }, (_, i) => ({ name: `kept-entry-with-a-long-name-${i}`, why: 'touched-within-48h' }));
    const c = census({ seq: 200, moved: rows, sessions: [session({ budget: { state: 'enforced', overSince: T0, enforceAt: T0, removedBytes: 0, kept } })] });
    const body = tmpSweepReceipts(c, 0).mails[0]!.body;
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(MAIL_BODY_MAX_BYTES);
    expect(body).toMatch(/and \d+ more entries; the census ~\/\.ccrc\/tmp-sweep\.json lists them/);
    expect(body.match(/more entries/g)).toHaveLength(2);
  });

  it('rows whose quarantine time has passed are not mailed', () => {
    const c = census({ seq: 2, at: T0 + 30 * HOUR, moved: [moved(1), moved(2, { at: T0 + 29 * HOUR })] });
    expect(tmpSweepReceipts(c, 0).mails.map((m) => m.subject)).toEqual([`tmp-sweep: moved 1 entries (seq 2-2, pass ${T0 + 29 * HOUR})`]);
  });

  it('a subject stays inside the mail subject bound', () => {
    const c = census({ seq: 999_999, moved: [moved(999_990), moved(999_999)] });
    expect(Buffer.byteLength(tmpSweepReceipts(c, 0).mails[0]!.subject)).toBeLessThanOrEqual(MAIL_SUBJECT_MAX_BYTES);
  });
});

describe('tmpSweepBudget — one notice per over-budget episode', () => {
  const NAMES = [['big-a', 9 * GIB], ['big-b', 6 * GIB], ['mid-c', 4 * GIB], ['mid-d', 3 * GIB], ['small-e', 2 * GIB]] as const;
  const top = NAMES.map(([name, bytes]) => ({ name, bytes }));

  it('over budget, first sighting: one notice naming the total, the five largest entries and enforceAt, and no receipt', () => {
    const c = census({ sessions: [overBudget({}, top)] });
    const notices = tmpSweepBudget(c, new Set());
    expect(notices).toHaveLength(1);
    const n = notices[0]!;
    expect(n.sessionId).toBe('project-a-quiet-basin');
    expect(n.body).toContain('24.0 GiB');
    for (const [name] of NAMES) expect(n.body).toContain(name);
    expect(n.body).toContain(new Date(T0 + 24 * HOUR).toISOString());
    expect(n.body).toContain('15 GiB');
    expect(n.body).not.toContain('enforcement has begun');
    expect(tmpSweepReceipts(c, 0).mails, 'a notice is not a receipt').toEqual([]);
  });

  it('only the five largest are named', () => {
    const six = [...top, { name: 'tiny-f', bytes: 1 }];
    const n = tmpSweepBudget(census({ sessions: [overBudget({}, six)] }), new Set())[0]!;
    expect(n.body).not.toContain('tiny-f');
  });

  it('the same episode on later passes sends no second notice', () => {
    const c = census({ sessions: [overBudget()] });
    const first = tmpSweepBudget(c, new Set());
    const noticed = new Set(first.map((n) => n.key));
    expect(tmpSweepBudget(c, noticed)).toEqual([]);
  });

  it('a new overSince (a new episode) sends a new notice', () => {
    const noticed = new Set(tmpSweepBudget(census({ sessions: [overBudget()] }), new Set()).map((n) => n.key));
    const again = tmpSweepBudget(census({ sessions: [overBudget({ overSince: T0 + 72 * HOUR, enforceAt: T0 + 96 * HOUR })] }), noticed);
    expect(again).toHaveLength(1);
    expect(again[0]!.subject).not.toBe(tmpSweepBudget(census({ sessions: [overBudget()] }), new Set())[0]!.subject);
  });

  it('a critical-pressure census: the notice says enforcement has begun', () => {
    const c = census({ pressure: true, sessions: [overBudget({ enforceAt: T0 })] });
    expect(tmpSweepBudget(c, new Set())[0]!.body).toContain('enforcement has begun');
  });

  it('a session on a root without pressure is not told enforcement has begun, though another root is at pressure', () => {
    const c = census({ pressure: true, sessions: [overBudget({ enforceAt: T0 + 24 * HOUR })] });
    const body = tmpSweepBudget(c, new Set())[0]!.body;
    expect(body).not.toContain('enforcement has begun');
    expect(body).toContain(new Date(T0 + 24 * HOUR).toISOString());
  });

  it('a row whose own enforceAt has passed is told enforcement has begun, with no pressure flag', () => {
    const c = census({ pressure: false, sessions: [overBudget({ enforceAt: T0 - HOUR })] });
    expect(tmpSweepBudget(c, new Set())[0]!.body).toContain('enforcement has begun');
  });

  it('a session under budget has no notice', () => {
    expect(tmpSweepBudget(census({ sessions: [session()] }), new Set())).toEqual([]);
  });

  it('a shadow census still notifies (the notice deletes nothing)', () => {
    expect(tmpSweepBudget(census({ arm: 'shadow', sessions: [overBudget()] }), new Set())).toHaveLength(1);
  });

  it('the coordinator copy says whose session it is about', () => {
    const n = tmpSweepBudget(census({ sessions: [overBudget()] }), new Set())[0]!;
    expect(n.coordinatorBody).toContain('project-a-quiet-basin');
    expect(n.coordinatorBody).toContain(new Date(T0 + 24 * HOUR).toISOString());
  });

  it('a subject stays inside the mail subject bound', () => {
    const n = tmpSweepBudget(census({ sessions: [overBudget()] }), new Set())[0]!;
    expect(Buffer.byteLength(n.subject)).toBeLessThanOrEqual(MAIL_SUBJECT_MAX_BYTES);
  });
});

describe('tmpSweepHolders — the five largest sessions', () => {
  it('names the five largest by bytes', () => {
    const rows = [1, 7, 3, 9, 5, 2, 8].map((g, i) => session({ id: `s-${i}`, uuid: `u-${i}`, bytes: g * GIB }));
    expect(tmpSweepHolders(census({ sessions: rows }))).toEqual([
      { label: 's-3', bytes: 9 * GIB }, { label: 's-6', bytes: 8 * GIB }, { label: 's-1', bytes: 7 * GIB },
      { label: 's-4', bytes: 5 * GIB }, { label: 's-2', bytes: 3 * GIB },
    ]);
  });
  it('a malformed or absent census has no holders', () => {
    expect(tmpSweepHolders(null)).toEqual([]);
  });
});

// ── the lane: real coord store, fake fleet io ──────────────────────────────────────────────────────────────────────
const WORKER = 'project-a-quiet-basin';
const COORD = 'project-a-calm-mesa';

function laneRig(text: string | null) {
  const home = mkTmp('ccrc-tmp-sweep-mail-');
  const coord = new CoordStore(openCoordDb(path.join(home, 'coord.db')));
  const ccrcDir = path.join(home, '.ccrc');
  const reads: string[] = [];
  const body = { current: text };
  const io: FleetIO = {
    ...localIO,
    lstatMeasured: async () => (body.current === null ? { ok: false, reason: 'absent' } : { ok: true, kind: 'regular' }),
    statMeasured: async () => (body.current === null ? { ok: false, reason: 'absent' } : { ok: true, size: Buffer.byteLength(body.current) }),
    readFileMeasured: async (p) => {
      reads.push(p);
      return body.current === null ? { ok: false, reason: 'absent' } : { ok: true, content: body.current };
    },
  } as FleetIO;
  const state = newTmpSweepLaneState();
  const deps = { io, ccrcDir, coord };
  const mailTo = (to: string): { subject: string; body: string }[] =>
    (coord.db.prepare('SELECT subject, body FROM mail WHERE toId = ? ORDER BY id').all(to) as { subject: string; body: string }[]);
  return { coord, deps, state, reads, body, mailTo, ccrcDir };
}
const workerOfCoordinator = (coord: CoordStore, worker = WORKER): void => {
  const opened = coord.openRun({ program: 'prog-a', title: 'prog-a', project: 'project-a', wave: 1, waveOf: 2, claimedBy: COORD });
  if (!('id' in opened)) throw new Error('openRun refused');
  coord.markDispatched(opened.id, worker, `${worker}-ws`, `ws/${worker}`, false, Date.now());
  const adv = coord.advance(opened.id, 'dispatched', 'coordinator');
  if (!adv.ok) throw new Error('advance refused');
};
const KNOWN = new Set([WORKER, COORD]);

describe('runTmpSweepCensusLane', () => {
  it('reads the census at <ccrcDir>/tmp-sweep.json through the fleet io', async () => {
    const r = laneRig(json(census()));
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(r.reads).toEqual([path.join(r.ccrcDir, NODE_FILES.tmpSweep)]);
  });

  it('two passes\' rows for one session send two mails, and a re-read sends none', async () => {
    const r = laneRig(json(census({ seq: 2, moved: [moved(1), moved(2)] })));
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(r.mailTo(WORKER).map((m) => m.subject)).toEqual([`tmp-sweep: moved 2 entries (seq 1-2, pass ${T0})`]);
    r.body.current = json(census({ seq: 3, at: T0 + HOUR, moved: [moved(1), moved(2), moved(3, { at: T0 + HOUR })] }));
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(r.mailTo(WORKER).map((m) => m.subject)).toEqual([`tmp-sweep: moved 2 entries (seq 1-2, pass ${T0})`, `tmp-sweep: moved 1 entries (seq 3-3, pass ${T0 + HOUR})`]);
  });

  it('a restart (fresh lane state) does not re-send a receipt the coord store already holds', async () => {
    const r = laneRig(json(census({ seq: 2, moved: [moved(1), moved(2)] })));
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    // The session has since read it: the store's own outstanding-mail dedupe no longer sees it, so only the lane's
    // every-delivery-state subject check stands between a restart and a repeat.
    r.coord.db.prepare("UPDATE mail_deliveries SET state = 'acked'").run();
    await runTmpSweepCensusLane(r.deps, newTmpSweepLaneState(), KNOWN);
    expect(r.mailTo(WORKER)).toHaveLength(1);
  });

  it('a restart after two passes sends nothing new (the cold read rebuilds the subjects already sent)', async () => {
    const r = laneRig(json(census({ seq: 2, moved: [moved(1), moved(2)] })));
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    r.body.current = json(census({ seq: 3, at: T0 + HOUR, moved: [moved(1), moved(2), moved(3, { at: T0 + HOUR })] }));
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    r.coord.db.prepare("UPDATE mail_deliveries SET state = 'acked'").run();
    await runTmpSweepCensusLane(r.deps, newTmpSweepLaneState(), KNOWN);
    expect(r.mailTo(WORKER)).toHaveLength(2);
  });

  it('a recreated census whose seq range collides with an old pass still mails the new pass', async () => {
    const r = laneRig(json(census({ seq: 2, moved: [moved(1), moved(2)] })));
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    r.body.current = json(census({ seq: 2, at: T0 + 2 * HOUR, moved: [moved(1, { at: T0 + 2 * HOUR }), moved(2, { at: T0 + 2 * HOUR })] }));
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(r.mailTo(WORKER).map((m) => m.subject)).toEqual([
      `tmp-sweep: moved 2 entries (seq 1-2, pass ${T0})`, `tmp-sweep: moved 2 entries (seq 1-2, pass ${T0 + 2 * HOUR})`]);
  });

  it('shadow rows send no mail', async () => {
    const r = laneRig(json(census({ seq: 1, arm: 'shadow', moved: [moved(1, { shadow: true })] })));
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(r.mailTo(WORKER)).toEqual([]);
  });

  it('a row whose id has no registry row sends nothing and logs once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const r = laneRig(json(census({ seq: 1, moved: [moved(1, { id: 'project-z-gone' })] })));
      await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
      r.body.current = json(census({ seq: 2, moved: [moved(1, { id: 'project-z-gone' }), moved(2, { id: 'project-z-gone' })] }));
      await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
      expect(r.mailTo('project-z-gone')).toEqual([]);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('project-z-gone'))).toHaveLength(1);
    } finally { warn.mockRestore(); }
  });

  it('a notice for an id with no registry row this pass is not latched: the row appearing later is told', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const r = laneRig(json(census({ sessions: [overBudget()] })));
      await runTmpSweepCensusLane(r.deps, r.state, new Set([COORD]));
      expect(r.mailTo(WORKER)).toEqual([]);
      await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
      expect(r.mailTo(WORKER)).toHaveLength(1);
    } finally { warn.mockRestore(); }
  });

  it('a census of several MiB (a session far over budget kept many entries) still mails its notice and receipt', async () => {
    const kept = Array.from({ length: 4000 }, (_, i) => ({ name: `kept-entry-${i}-${'x'.repeat(300)}`, why: 'held-open' }));
    const big = census({ seq: 1, sessions: [overBudget({ kept })], moved: [moved(1)] });
    const text = json(big);
    expect(Buffer.byteLength(text)).toBeGreaterThan(1024 * 1024);
    const r = laneRig(text);
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(r.mailTo(WORKER).map((m) => m.subject.split(' ')[1])).toEqual(expect.arrayContaining(['moved']));
    expect(r.mailTo(WORKER).some((m) => m.subject.includes('over budget'))).toBe(true);
  });

  it('over budget, first sighting: one notice to the session and its coordinator naming enforceAt, and no receipt', async () => {
    const r = laneRig(json(census({ sessions: [overBudget()] })));
    workerOfCoordinator(r.coord);
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(r.mailTo(WORKER)).toHaveLength(1);
    expect(r.mailTo(WORKER)[0]!.subject).toMatch(/^tmp-sweep: project-a-quiet-basin over budget/);
    expect(r.mailTo(WORKER)[0]!.body).toContain(new Date(T0 + 24 * HOUR).toISOString());
    expect(r.mailTo(COORD)).toHaveLength(1);
    expect(r.mailTo(COORD)[0]!.body).toContain(WORKER);
    expect(r.mailTo(WORKER).filter((m) => m.subject.startsWith('tmp-sweep: moved'))).toEqual([]);
  });

  it('the same episode on later passes (and after a restart) sends no second notice; a new overSince sends one', async () => {
    const r = laneRig(json(census({ sessions: [overBudget()] })));
    workerOfCoordinator(r.coord);
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    r.coord.db.prepare("UPDATE mail_deliveries SET state = 'acked'").run();
    await runTmpSweepCensusLane(r.deps, newTmpSweepLaneState(), KNOWN);
    expect(r.mailTo(WORKER)).toHaveLength(1);
    expect(r.mailTo(COORD)).toHaveLength(1);
    r.body.current = json(census({ sessions: [overBudget({ overSince: T0 + 72 * HOUR, enforceAt: T0 + 96 * HOUR })] }));
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(r.mailTo(WORKER)).toHaveLength(2);
    expect(r.mailTo(COORD)).toHaveLength(2);
  });

  it('a session that coordinates (no run of its own) gets no coordinator copy', async () => {
    const r = laneRig(json(census({ sessions: [overBudget()] })));
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(r.mailTo(WORKER)).toHaveLength(1);
    expect(r.mailTo(COORD)).toEqual([]);
  });

  it('the coordinator copy goes to the over-budget session\'s OWN run\'s coordinator, not to any coordinator on the fleet', async () => {
    const r = laneRig(json(census({ sessions: [overBudget()] })));
    workerOfCoordinator(r.coord, 'project-a-other-worker');
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(r.mailTo(WORKER)).toHaveLength(1);
    expect(r.mailTo(COORD), 'WORKER has no run; the other worker\'s coordinator is not told about it').toEqual([]);
  });

  it('a coordinator that is itself over budget is told once, not twice', async () => {
    const r = laneRig(json(census({ sessions: [overBudget()] })));
    workerOfCoordinator(r.coord);
    const asCoord = JSON.parse(r.body.current!) as TmpSweepCensus;
    r.body.current = json({ ...asCoord, sessions: [{ ...asCoord.sessions[0]!, id: COORD, uuid: 'c'.repeat(36) }] });
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(r.mailTo(COORD)).toHaveLength(1);
  });

  it('two workers of one coordinator over budget in the same pass: the coordinator gets one copy per worker', async () => {
    const W2 = 'project-a-other-worker';
    const r = laneRig(json(census({ sessions: [overBudget(), { ...overBudget(), id: W2, uuid: 'd'.repeat(36) }] })));
    workerOfCoordinator(r.coord);
    const opened = r.coord.openRun({ program: 'prog-b', title: 'prog-b', project: 'project-a', wave: 2, waveOf: 2, claimedBy: COORD });
    if (!('id' in opened)) throw new Error('openRun refused');
    r.coord.markDispatched(opened.id, W2, `${W2}-ws`, `ws/${W2}`, false, Date.now());
    await runTmpSweepCensusLane(r.deps, r.state, new Set([WORKER, COORD, W2]));
    expect(r.mailTo(COORD)).toHaveLength(2);
    expect(r.mailTo(COORD).map((m) => m.body).join('\n')).toContain(W2);
    expect(r.mailTo(COORD).map((m) => m.body).join('\n')).toContain(`Session ${WORKER}:`);
  });

  it('a coordinator and its worker both over budget in the same pass: the coordinator gets its own notice and the worker\'s copy', async () => {
    const r = laneRig(json(census({ sessions: [overBudget(), { ...overBudget(), id: COORD, uuid: 'c'.repeat(36) }] })));
    workerOfCoordinator(r.coord);
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(r.mailTo(COORD)).toHaveLength(2);
  });

  it('a malformed census is unmeasured: no mail, no holders', async () => {
    const r = laneRig('{"v":1,');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const out = await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
      expect(out.holders).toEqual([]);
      expect(r.mailTo(WORKER)).toEqual([]);
    } finally { warn.mockRestore(); }
  });

  it('an absent census has no holders and sends nothing', async () => {
    const r = laneRig(null);
    const out = await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(out.holders).toEqual([]);
  });

  it('the holders are the five largest sessions', async () => {
    const rows = [1, 7, 3, 9, 5, 2].map((g, i) => session({ id: `s-${i}`, uuid: `u-${i}`, bytes: g * GIB }));
    const r = laneRig(json(census({ sessions: rows })));
    const out = await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(out.holders.map((h) => h.label)).toEqual(['s-3', 's-1', 's-4', 's-2', 's-5']);
  });

  it('with no registry listing this tick, nothing is mailed and the receipts wait for the next pass', async () => {
    const r = laneRig(json(census({ seq: 1, moved: [moved(1)] })));
    await runTmpSweepCensusLane(r.deps, r.state, null);
    expect(r.mailTo(WORKER)).toEqual([]);
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(r.mailTo(WORKER)).toHaveLength(1);
  });
});

// ── inodes (#1411, D-TBD-inode-budget): measured next to bytes, told once per episode, deleting nothing ────────────────
const MI = 1_000_000;
const inodeTop = [['mut-a', 3_400_000], ['mut-b', 200_000], ['mut-c', 90_000], ['mut-d', 40_000], ['mut-e', 9_000], ['mut-f', 1]] as const;
const overInodes = (over: Partial<TmpSweepSession> = {}): TmpSweepSession => session({
  bytes: 2 * GIB, inodes: 3_700_000, inodesAtLeast: 3_700_000,
  inodeTop: inodeTop.map(([name, inodes]) => ({ name, inodes })),
  inodeBudget: { state: 'over', overSince: T0, limit: MI }, ...over,
});

describe('the census reader — inode fields', () => {
  it('round-trips a session row with its inode fields', () => {
    const c = census({ sessions: [overInodes()] });
    expect(parseTmpSweepCensus(json(c))).toEqual(c);
  });
  it('a row with an unfinished walk (inodes null) is measured: null is the writer\'s word for unmeasured', () => {
    const c = census({ sessions: [overInodes({ inodes: null })] });
    expect(parseTmpSweepCensus(json(c))?.sessions[0]?.inodes).toBeNull();
  });
  it.each([
    ['a negative count', { inodes: -1 }], ['a non-integer lower bound', { inodesAtLeast: 1.5 }],
    ['a top row with no name', { inodeTop: [{ inodes: 3 }] }], ['an inodeBudget with no state', { inodeBudget: { overSince: null } }],
    ['a string overSince', { inodeBudget: { state: 'over', overSince: 'x' } }],
  ])('%s makes the whole census unmeasured', (_n, bad) => {
    const wire = census({ sessions: [overInodes()] });
    Object.assign(wire.sessions[0] as object, bad);
    expect(parseTmpSweepCensus(json(wire))).toBeNull();
  });
});

describe('tmpSweepInodeBudget — one notice per over-inode-budget episode', () => {
  it('first sighting: one notice naming the count, the budget and the five largest entries by inodes, biggest first', () => {
    const [n, ...rest] = tmpSweepInodeBudget(census({ sessions: [overInodes()] }), new Set());
    expect(rest).toEqual([]);
    expect(n!.sessionId).toBe('project-a-quiet-basin');
    expect(n!.subject).toBe(`tmp-sweep: project-a-quiet-basin over inode budget (since ${new Date(T0).toISOString()})`);
    expect(n!.body).toContain('3,700,000 inodes');
    expect(n!.body).toContain('1,000,000');
    expect(n!.body.indexOf('mut-a')).toBeLessThan(n!.body.indexOf('mut-b'));
    expect(n!.body).toContain('mut-a (3,400,000)');
    expect(n!.body).not.toContain('mut-f');
    expect(n!.body).toMatch(/nothing is removed/i);
    expect(n!.coordinatorBody).toBe(`Session project-a-quiet-basin: ${n!.body}`);
  });
  it('an unfinished walk says "at least", never a plain count', () => {
    const [n] = tmpSweepInodeBudget(census({ sessions: [overInodes({ inodes: null, inodesAtLeast: 2_000_000 })] }), new Set());
    expect(n!.body).toContain('at least 2,000,000 inodes');
  });
  it('the same episode sends no second notice; a new overSince sends one; its key never collides with the byte budget\'s', () => {
    const c = census({ sessions: [overInodes()] });
    const noticed = new Set(tmpSweepInodeBudget(c, new Set()).map((n) => n.key));
    expect(tmpSweepInodeBudget(c, noticed)).toEqual([]);
    expect(tmpSweepInodeBudget(census({ sessions: [overInodes({ inodeBudget: { state: 'over', overSince: T0 + HOUR, limit: MI } })] }), noticed)).toHaveLength(1);
    const both = census({ sessions: [overBudget({}, [])] });
    const byteKey = tmpSweepBudget(both, new Set())[0]!.key;
    expect(tmpSweepInodeBudget(census({ sessions: [overInodes({ inodeBudget: { state: 'over', overSince: T0, limit: MI } })] }), new Set())[0]!.key).not.toBe(byteKey);
  });
  it('a session under the budget, unmeasured and not over, or with no inode fields has no notice', () => {
    expect(tmpSweepInodeBudget(census({ sessions: [overInodes({ inodeBudget: { state: 'ok', overSince: null, limit: MI } })] }), new Set())).toEqual([]);
    expect(tmpSweepInodeBudget(census({ sessions: [overInodes({ inodes: null, inodeBudget: { state: 'unmeasured', overSince: null, limit: MI } })] }), new Set())).toEqual([]);
    expect(tmpSweepInodeBudget(census({ sessions: [session()] }), new Set())).toEqual([]);
  });
  it('a shadow census still notifies, and a subject stays inside the mail subject bound', () => {
    const n = tmpSweepInodeBudget(census({ arm: 'shadow', sessions: [overInodes({ id: 'x'.repeat(40) })] }), new Set())[0]!;
    expect(n).toBeDefined();
    expect(Buffer.byteLength(n.subject)).toBeLessThanOrEqual(MAIL_SUBJECT_MAX_BYTES);
  });
});

describe('tmpSweepHolders — inodes beside bytes', () => {
  it('a holder carries its inode count; a partial one is marked, and an inode-heavy small session is named too', () => {
    const rows = [
      ...[9, 8, 7, 6, 5].map((g, i) => session({ id: `b-${i}`, uuid: `ub-${i}`, bytes: g * GIB, inodes: 100, inodesAtLeast: 100 })),
      overInodes({ id: 'many', uuid: 'umany', bytes: 1 * GIB, inodes: null, inodesAtLeast: 2_000_000 }),
    ];
    const got = tmpSweepHolders(census({ sessions: rows }));
    expect(got.slice(0, 5).map((h) => h.label)).toEqual(['b-0', 'b-1', 'b-2', 'b-3', 'b-4']);
    expect(got[0]).toEqual({ label: 'b-0', bytes: 9 * GIB, inodes: 100 });
    expect(got[5]).toEqual({ label: 'many', bytes: 1 * GIB, inodes: 2_000_000, inodesPartial: true });
    expect(got).toHaveLength(6);
  });
});

describe('runTmpSweepCensusLane — the inode notice', () => {
  it('over the inode budget: the session and its coordinator are each mailed once, naming the biggest subtrees; a re-read and a restart send nothing', async () => {
    const r = laneRig(json(census({ sessions: [overInodes()] })));
    workerOfCoordinator(r.coord);
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    await runTmpSweepCensusLane(r.deps, newTmpSweepLaneState(), KNOWN);
    expect(r.mailTo(WORKER)).toHaveLength(1);
    expect(r.mailTo(WORKER)[0]!.subject).toMatch(/^tmp-sweep: project-a-quiet-basin over inode budget/);
    expect(r.mailTo(WORKER)[0]!.body).toContain('mut-a (3,400,000)');
    expect(r.mailTo(COORD)).toHaveLength(1);
    expect(r.mailTo(COORD)[0]!.body).toContain(WORKER);
  });
  it('a session over both budgets is told twice, once for each', async () => {
    const r = laneRig(json(census({ sessions: [overInodes({ bytes: 24 * GIB, budget: { state: 'over', overSince: T0, enforceAt: T0 + 24 * HOUR, removedBytes: 0, kept: [] } })] })));
    await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(r.mailTo(WORKER).map((m) => m.subject.includes('inode'))).toEqual([false, true]);
  });
  it('the holders carry inodes', async () => {
    const r = laneRig(json(census({ sessions: [overInodes()] })));
    const out = await runTmpSweepCensusLane(r.deps, r.state, KNOWN);
    expect(out.holders).toEqual([{ label: WORKER, bytes: 2 * GIB, inodes: 3_700_000 }]);
  });
});
