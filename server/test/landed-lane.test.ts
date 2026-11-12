// Landing order wave 5h (Task 4): the landed reader's lane (`coord/landedLane.ts#landedPass`). A temporary coord.db with
// real runs and pins, a fake `runCcd` that answers each `pr-state --project <p> --pr <n>` with a line built for that PR,
// and a real notice funnel over a ring and the store's archive. Fixture HOME only.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { noticeSink } from '../src/notice.js';
import { PR_BACKOFF_MAX_MS, PR_SWEEP_MS } from '../src/laneSchedule.js';
import { landedPass, type LandedLaneDeps, type LandedPassResult } from '../src/coord/landedLane.js';
import { LANDED_READS_PER_SWEEP, LANDED_STANDING_BACKOFF_MS, type LandedMemory } from '../src/coord/landed.js';
import type { CcdResult } from '../src/coord/ports.js';
import type { FleetState } from '../src/fleetstate.js';
import type { LandingAdvance } from '../src/coord/landingEntry.js';
import { PR_STATE_PR_CAP } from '../src/ccdargv.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { landingFactsOf, landingStoreOver } from './landingFixture.js';

const HEAD = 'a'.repeat(40);
const HEAD2 = 'b'.repeat(40);
const HC = 'c'.repeat(40);
const MERGE = 'e'.repeat(40);
const P = 'project-a';
const BASE_TIME = Date.parse('2026-11-11T12:00:00Z');

afterEach(() => { vi.useRealTimers(); removeTmpFixtures(); });

const ZERO = { stderr: '', killed: false as const, signal: null };
const ran = (stdout: string, ok = true): CcdResult => ({ ran: true, ok, stdout, ...ZERO });
const FACTS = { headRefOid: HEAD, baseRefName: 'main', isCrossRepository: false };
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const line = (pr: number, o: Record<string, unknown>): string => `${JSON.stringify({ number: pr, ...FACTS, mergedAt: null, mergeCommit: null, ...o })}\n`;
const mergedLine = (pr: number, mergedAt = iso(BASE_TIME - 3 * 3_600_000), o: Record<string, unknown> = {}): string =>
  line(pr, { state: 'merged', mergedAt, mergeCommit: MERGE, ...o });
const openLine = (pr: number): string => line(pr, { state: 'open' });
const unmeasured = (pr: number, reason: string): string => `${JSON.stringify({ number: pr, state: 'unmeasured', reason })}\n`;

interface Rig {
  coord: CoordStore; calls: number[]; memory: Map<number, LandedMemory>; warns: string[]; clock: { t: number };
  answer: { fn: (pr: number) => CcdResult | Promise<CcdResult> }; pushes: string[]; viewed: Set<string>;
  deps: LandedLaneDeps; pass: () => Promise<LandedPassResult>; feed: () => { kind: string; sessionId: string; runId: number | null; body: string }[];
}
const FLEET = { ccdVerbs: [PR_STATE_PR_CAP] } as unknown as FleetState;

async function rig(over: { fleetState?: FleetState | undefined } = {}): Promise<Rig> {
  const home = mkTmp('ccrc-landed-lane-');
  const dbPath = path.join(home, '.ccrc', 'coord.db');
  const coord = landingStoreOver(openCoordDb(dbPath), dbPath);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const viewed = new Set<string>();
  const pushes: string[] = [];
  const notice = noticeSink({ notifyLog, coord, viewers: { isVisible: (id: string) => viewed.has(id) },
    push: { notify: async (p: { sessionId: string }) => { pushes.push(p.sessionId); } } as never });
  const calls: number[] = [];
  const answer: Rig['answer'] = { fn: (pr) => ran(openLine(pr)) };
  const clock = { t: BASE_TIME };
  const warns: string[] = [];
  const memory = new Map<number, LandedMemory>();
  const deps: LandedLaneDeps = {
    coord, notice, memory, now: () => clock.t, warn: (l) => { warns.push(l); },
    runCcd: async (argv) => {
      const pr = Number(argv[argv.indexOf('--pr') + 1]);
      calls.push(pr);
      return answer.fn(pr);
    },
    ...('fleetState' in over ? (over.fleetState ? { fleetState: over.fleetState } : {}) : { fleetState: FLEET }),
  };
  return { coord, calls, memory, warns, clock, answer, pushes, viewed, deps, pass: () => landedPass(deps), feed: () => coord.feedEvents(200) };
}

const pin = (pr: number, head = HEAD): LandingAdvance => ({ kind: 'pin', head, pr, mode: 'off', handoffCommit: HC });
let wave = 0;
/** One run with a session, advanced to awaiting-review and pinned at `merging`; pins are 10 ms apart, so `pinnedAt` orders them. */
function pinned(c: CoordStore, pr: number, project = P): number {
  vi.setSystemTime(Date.now() + 10);
  wave++;
  const o = c.openRun({ program: `prog-${wave}`, title: 't', project, wave, waveOf: 99, claimedBy: 'coord-a' });
  if (!('id' in o)) throw new Error('fixture openRun refused');
  c.setSession(o.id, `lane-a-ws${wave}`);
  for (const to of ['dispatched', 'working', 'awaiting-review'] as const) if (!c.advance(o.id, to, 'test').ok) throw new Error(`advance to ${to}`);
  if (!c.advanceLanding({ runId: o.id, to: 'merging', causedBy: 'coordinator', landing: pin(pr) }).ok) throw new Error('fixture pin refused');
  return o.id;
}
const stateOf = (c: CoordStore, pr: number, project = P): string => landingFactsOf(c, project).entries.find((e) => e.pr === pr)!.state;
const detailOf = (c: CoordStore, pr: number): Record<string, unknown> =>
  JSON.parse((c.db.prepare('SELECT detail FROM landing_entries WHERE pr = ?').get(pr) as { detail: string }).detail) as Record<string, unknown>;
const mergedRows = (r: Rig) => r.feed().filter((e) => e.kind === 'merged');

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(BASE_TIME); wave = 0; });

describe('the landed reader marks what GitHub says', () => {
  it('the backlog: twelve merged entries mark ten on the first pass, oldest first, and the last two on the second', async () => {
    const r = await rig();
    const prs = Array.from({ length: 12 }, (_, i) => 201 + i);
    prs.forEach((pr) => pinned(r.coord, pr));
    r.answer.fn = (pr) => ran(mergedLine(pr));
    const first = await r.pass();
    expect(first).toMatchObject({ read: LANDED_READS_PER_SWEEP, landed: LANDED_READS_PER_SWEEP, stopped: null });
    expect(r.calls).toEqual(prs.slice(0, 10));
    expect(prs.map((pr) => stateOf(r.coord, pr))).toEqual([...Array(10).fill('landed'), 'pinned', 'pinned']);
    const second = await r.pass();
    expect(second).toMatchObject({ read: 2, landed: 2 });
    expect(r.calls.slice(10)).toEqual([211, 212]);
    const rows = mergedRows(r);
    expect(rows).toHaveLength(12);
    expect(rows.every((e) => e.runId === null)).toBe(true);
    expect(new Set(rows.map((e) => e.sessionId)).size).toBe(12);
    expect(r.pushes, 'a merge older than an hour is record-only').toEqual([]);
  });

  it('a fresh merge whose session the operator is viewing is still archived', async () => {
    const r = await rig();
    pinned(r.coord, 301);
    r.viewed.add('lane-a-ws1');
    r.answer.fn = (pr) => ran(mergedLine(pr, iso(BASE_TIME - 60_000)));
    await r.pass();
    expect(mergedRows(r)).toHaveLength(1);
    expect(r.pushes).toEqual([]);
  });

  it('a fresh merge nobody is viewing is archived and pushed', async () => {
    const r = await rig();
    pinned(r.coord, 302);
    r.answer.fn = (pr) => ran(mergedLine(pr, iso(BASE_TIME - 60_000)));
    await r.pass();
    expect(mergedRows(r)).toHaveLength(1);
    expect(r.pushes).toEqual(['lane-a-ws1']);
  });

  it('a session that already has its merged record gets no second one', async () => {
    const r = await rig();
    const id = pinned(r.coord, 303);
    const sid = (r.coord.run(id) as { run: { sessionId: string } }).run.sessionId;
    const rec = { kind: 'merged' as const, sessionId: sid, title: 'x', body: 'PR #303 merged; nothing archived.', runId: null };
    r.coord.recordFeedEvent('e', { ...rec, seq: 1, at: 1 }, `${sid}#303`);
    r.answer.fn = (pr) => ran(mergedLine(pr));
    await r.pass();
    expect(stateOf(r.coord, 303)).toBe('landed');
    expect(mergedRows(r)).toHaveLength(1);
  });

  it('an open entry stays pinned, and eleven open entries are all read within two passes', async () => {
    const r = await rig();
    const prs = Array.from({ length: 11 }, (_, i) => 401 + i);
    prs.forEach((pr) => pinned(r.coord, pr));
    await r.pass();
    expect(r.calls).toHaveLength(10);
    expect(stateOf(r.coord, 401)).toBe('pinned');
    await r.pass();
    expect(r.calls).toHaveLength(11);
    expect([...new Set(r.calls)].sort()).toEqual(prs);
  });

  it('closed and absent mark closed', async () => {
    const r = await rig();
    pinned(r.coord, 501);
    pinned(r.coord, 502);
    r.answer.fn = (pr) => ran(pr === 501 ? line(501, { state: 'closed' }) : `${JSON.stringify({ number: 502, state: 'absent' })}\n`);
    expect(await r.pass()).toMatchObject({ read: 2, landed: 0, closed: 2 });
    expect(stateOf(r.coord, 501)).toBe('closed');
    expect(stateOf(r.coord, 502)).toBe('closed');
    expect(detailOf(r.coord, 502)).toMatchObject({ by: 'reader', word: 'absent' });
    expect(mergedRows(r)).toEqual([]);
  });

  it('a merged PR at another head marks landed with the head in its detail', async () => {
    const r = await rig();
    pinned(r.coord, 601);
    r.answer.fn = (pr) => ran(mergedLine(pr, undefined, { headRefOid: HEAD2 }));
    await r.pass();
    expect(stateOf(r.coord, 601)).toBe('landed');
    expect(detailOf(r.coord, 601)).toMatchObject({ word: 'merged', head: HEAD2 });
  });

  it('a train landing marks landed with its train', async () => {
    const r = await rig();
    pinned(r.coord, 701);
    r.answer.fn = (pr) => ran(line(pr, { state: 'merged', landedInTrain: true, train: 50, trainMergeCommit: 'f'.repeat(40) }));
    await r.pass();
    expect(stateOf(r.coord, 701)).toBe('landed');
    expect(detailOf(r.coord, 701)).toMatchObject({ train: 50, trainMergeCommit: 'f'.repeat(40) });
  });

  it('a no-run entry marks landed and raises no record', async () => {
    const r = await rig();
    const w = r.coord.writeLandingAuthority({ kind: 'entry', project: P, pr: 801, pinnedSha: HEAD, handoffCommit: HC, setBy: 'lane-a' }, 1000);
    expect(w.ok).toBe(true);
    r.answer.fn = (pr) => ran(mergedLine(pr));
    expect(await r.pass()).toMatchObject({ landed: 1 });
    expect(stateOf(r.coord, 801)).toBe('landed');
    expect(mergedRows(r)).toEqual([]);
  });
});

describe('the reader backs off and stops', () => {
  it('a second missing-field in a row is not read again within the hour', async () => {
    const r = await rig();
    pinned(r.coord, 901);
    r.answer.fn = (pr) => ran(unmeasured(pr, 'missing-field'));
    await r.pass();
    expect(r.calls).toHaveLength(1);
    r.clock.t += 2 * PR_SWEEP_MS;
    await r.pass();
    expect(r.calls).toHaveLength(2);
    expect(r.warns).toEqual(['ccrc-server: landed reader: project-a #901 reads missing-field twice; reading it hourly']);
    r.clock.t += 30 * 60_000;
    await r.pass();
    expect(r.calls, 'inside the hour').toHaveLength(2);
    r.clock.t += LANDED_STANDING_BACKOFF_MS;
    await r.pass();
    expect(r.calls).toHaveLength(3);
    expect(r.warns, 'said once').toHaveLength(1);
  });

  it('a timeout backs off by doubling to fifteen minutes', async () => {
    const r = await rig();
    pinned(r.coord, 1001);
    r.answer.fn = () => ran('', false);
    await r.pass();
    let seen = r.calls.length;
    expect(seen).toBe(1);
    for (const step of [2 * PR_SWEEP_MS, 4 * PR_SWEEP_MS, PR_BACKOFF_MAX_MS, PR_BACKOFF_MAX_MS]) {
      r.clock.t += step - 1;
      await r.pass();
      expect(r.calls, `inside ${step}`).toHaveLength(seen);
      r.clock.t += 1;
      await r.pass();
      seen++;
      expect(r.calls, `at ${step}`).toHaveLength(seen);
    }
    expect(stateOf(r.coord, 1001)).toBe('pinned');
  });

  it('a call that did not run ends the pass: no further call', async () => {
    const r = await rig();
    [1101, 1102, 1103].forEach((pr) => pinned(r.coord, pr));
    r.answer.fn = () => ({ ran: false, ok: false, reason: 'transport', detail: 'agent down', stdout: '', ...ZERO });
    expect(await r.pass()).toMatchObject({ read: 0, stopped: 'link' });
    expect(r.calls).toEqual([1101]);
  });

  it('no pr-state-pr-v1 capability: no call', async () => {
    for (const fleetState of [undefined, { ccdVerbs: ['pr-state'] } as unknown as FleetState]) {
      const r = await rig({ fleetState });
      pinned(r.coord, 1201);
      expect(await r.pass()).toMatchObject({ read: 0, stopped: 'unsupported' });
      expect(r.calls).toEqual([]);
    }
  });

  it('a fenced store: no call, and one stopped warning across two passes', async () => {
    const r = await rig();
    pinned(r.coord, 1301);
    r.coord.db.exec("CREATE TRIGGER boom BEFORE UPDATE ON landing_entries BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    r.answer.fn = (pr) => ran(mergedLine(pr));
    expect(await r.pass()).toMatchObject({ stopped: 'store' }); // the throwing mark fences the line
    const callsBefore = r.calls.length;
    r.warns.length = 0;
    expect(await r.pass()).toMatchObject({ read: 0, stopped: 'store' });
    expect(await r.pass()).toMatchObject({ read: 0, stopped: 'store' });
    expect(r.calls).toHaveLength(callsBefore);
    expect(r.warns).toEqual(['ccrc-server: landed reader: stopped (landing-fenced); no entry is read until it clears']);
  });

  it('a mark that throws in its UPDATE fences the line, ends the pass, and warns once', async () => {
    const r = await rig();
    [1401, 1402].forEach((pr) => pinned(r.coord, pr));
    r.coord.db.exec("CREATE TRIGGER boom BEFORE UPDATE ON landing_entries BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    r.answer.fn = (pr) => ran(mergedLine(pr));
    expect(await r.pass()).toMatchObject({ read: 1, landed: 0, stopped: 'store' });
    expect(r.calls).toEqual([1401]);
    expect(r.warns).toEqual(['ccrc-server: landed reader: the mark of project-a #1401 answered landing-db-apply; the landing line is fenced until the server restarts']);
    r.coord.db.exec('DROP TRIGGER boom');
    await r.pass();
    await r.pass();
    expect(r.calls, 'no call while the line is fenced').toEqual([1401]);
    expect(r.warns.filter((w) => w.includes('answered landing-db'))).toHaveLength(1);
  });

  it('a pin between the read and the mark answers moved and writes nothing; the next pass reads it again', async () => {
    const r = await rig();
    const runId = pinned(r.coord, 1501);
    let repinned = false;
    r.answer.fn = (pr) => {
      if (!repinned) {
        repinned = true;
        vi.setSystemTime(Date.now() + 1000);
        const w = r.coord.advanceLanding({ runId, to: 'working', causedBy: 'coordinator', landing: { kind: 'retreat', ejection: { base: HEAD2, kind: 'conflict' } } });
        if (!w.ok) throw new Error('fixture retreat refused');
        r.coord.advance(runId, 'awaiting-review', 'test');
        const p = r.coord.advanceLanding({ runId, to: 'merging', causedBy: 'coordinator', landing: pin(1501, HEAD2) });
        if (!p.ok) throw new Error('fixture re-pin refused');
      }
      return ran(mergedLine(pr));
    };
    const first = await r.pass();
    expect(first).toMatchObject({ read: 1, landed: 0, stopped: null });
    expect(stateOf(r.coord, 1501)).toBe('pinned');
    expect(r.memory.size, 'moved drops the memory').toBe(0);
    const second = await r.pass();
    expect(second).toMatchObject({ read: 1, landed: 1 });
    expect(r.calls).toEqual([1501, 1501]);
    expect(stateOf(r.coord, 1501)).toBe('landed');
  });
});

// Review 1840 round 1 (F1): a held subject costs no read, and a mark held between the read and the write is remembered
// by L1 (`landed.ts#landedNext`, the `held` answer), never by the lane.
describe('the landed reader and a recovery hold', () => {
  /** The store's own answers for a held subject, forged: the facts say `prs` are unresolved recovery subjects of the
   *  project (or, with `conflict`, that an identity collision holds it whole), and the land arm refuses their marks the
   *  way the real store does. */
  function hold(r: Rig, prs: number[], conflict = false): { clear: () => void; marks: number[] } {
    const realRead = r.coord.readLanding.bind(r.coord);
    const realAdvance = r.coord.advanceLanding.bind(r.coord);
    let held = true;
    const marks: number[] = [];
    vi.spyOn(r.coord, 'readLanding').mockImplementation((project: string) => {
      const out = realRead(project);
      if (!out.ok || !held) return out;
      const subjects = conflict ? [{ project: P, pr: prs[0]!, projection: { kind: 'identity-conflict' } }]
        : prs.map((pr) => ({ project: P, pr, projection: { kind: 'missing' } }));
      return { ...out, facts: { ...out.facts, recovery: { hold: { ids: [1] }, subjects } } } as typeof out;
    });
    vi.spyOn(r.coord, 'advanceLanding').mockImplementation(((cmd: Parameters<typeof realAdvance>[0]) => {
      if (held && 'kind' in cmd && cmd.kind === 'land' && (conflict || prs.includes(cmd.pr))) {
        marks.push(cmd.pr);
        return { ok: false, error: conflict ? 'landing-identity-conflict' : 'landing-recovery-unresolved' };
      }
      return realAdvance(cmd);
    }) as typeof realAdvance);
    return { clear: () => { held = false; }, marks };
  }

  it('held before the read: a held subject is not asked of ccd, ten of them do not starve the live entry, and it is read once the hold clears', async () => {
    const r = await rig();
    const heldPrs = Array.from({ length: LANDED_READS_PER_SWEEP }, (_, i) => 2001 + i);
    heldPrs.forEach((pr) => pinned(r.coord, pr));
    pinned(r.coord, 2100);
    r.answer.fn = (pr) => ran(mergedLine(pr));
    const h = hold(r, heldPrs);
    expect(await r.pass()).toMatchObject({ read: 1, landed: 1, stopped: null });
    expect(r.calls, 'no call for a held entry; the live one is read in the first pass').toEqual([2100]);
    expect(h.marks).toEqual([]);
    expect(await r.pass()).toMatchObject({ read: 0, stopped: null });
    expect(r.calls).toEqual([2100]);
    h.clear();
    r.clock.t += 1;
    expect(await r.pass()).toMatchObject({ read: LANDED_READS_PER_SWEEP, landed: LANDED_READS_PER_SWEEP });
    expect(r.calls.slice(1)).toEqual(heldPrs);
  });

  it('held before the read by an identity conflict: the whole project is skipped, and the pass ends clean', async () => {
    const r = await rig();
    [2201, 2202].forEach((pr) => pinned(r.coord, pr));
    hold(r, [2201], true);
    expect(await r.pass()).toMatchObject({ read: 0, stopped: null });
    expect(r.calls).toEqual([]);
  });

  it.each([['landing-recovery-unresolved', false], ['landing-identity-conflict', true]] as const)(
    'held at the write (%s): the entry is due next pass by L1\'s memory, the pass goes on to the next entry', async (_word, conflict) => {
      const r = await rig();
      pinned(r.coord, 2301);
      pinned(r.coord, 2302);
      r.answer.fn = (pr) => ran(mergedLine(pr));
      // the facts show no hold when the pass reads them: the hold appears between the read and the write
      const realAdvance = r.coord.advanceLanding.bind(r.coord);
      const refused: number[] = [];
      vi.spyOn(r.coord, 'advanceLanding').mockImplementation(((cmd: Parameters<typeof realAdvance>[0]) => {
        if ('kind' in cmd && cmd.kind === 'land' && cmd.pr === 2301) {
          refused.push(cmd.pr);
          return { ok: false, error: conflict ? 'landing-identity-conflict' : 'landing-recovery-unresolved' };
        }
        return realAdvance(cmd);
      }) as typeof realAdvance);
      const at = r.clock.t;
      const first = await r.pass();
      expect(first).toMatchObject({ read: 2, landed: 1, stopped: null });
      expect(r.calls).toEqual([2301, 2302]);
      expect(stateOf(r.coord, 2302)).toBe('landed');
      const entryId = (r.coord.db.prepare('SELECT id FROM landing_entries WHERE pr = 2301').get() as { id: number }).id;
      expect(r.memory.get(entryId)).toEqual({ pinnedAt: expect.any(Number), lastReadAt: at, nextAt: at, step: PR_SWEEP_MS, missingStreak: 0 });
      r.clock.t += 1;
      await r.pass();
      expect(r.calls.filter((c) => c === 2301), 'due on the very next pass').toHaveLength(2);
      expect(refused).toHaveLength(2);
      expect(r.warns).toEqual([]);
    });
});

describe('the landed reader walks projects one by one', () => {
  const Q = 'project-b';
  it('a store stop in the first project ends the pass: the second project is not read', async () => {
    const r = await rig();
    pinned(r.coord, 2401, P);
    pinned(r.coord, 2402, Q);
    const realRead = r.coord.readLanding.bind(r.coord);
    vi.spyOn(r.coord, 'readLanding').mockImplementation((project: string) =>
      project === P ? { ok: false, error: 'landing-fenced' } as ReturnType<typeof realRead> : realRead(project));
    expect(await r.pass()).toMatchObject({ read: 0, stopped: 'store' });
    expect(r.calls).toEqual([]);
    expect(r.warns).toEqual(['ccrc-server: landed reader: stopped (landing-fenced); no entry is read until it clears']);
  });

  it('a project whose projection is unreadable is skipped, and the pass goes on to the next project', async () => {
    const r = await rig();
    pinned(r.coord, 2501, P);
    pinned(r.coord, 2502, Q);
    const realRead = r.coord.readLanding.bind(r.coord);
    vi.spyOn(r.coord, 'readLanding').mockImplementation((project: string) =>
      project === P ? { ok: false, error: 'landing-projection-unreadable' } as ReturnType<typeof realRead> : realRead(project));
    expect(await r.pass()).toMatchObject({ read: 1, stopped: null });
    expect(r.calls).toEqual([2502]);
    expect(r.warns).toEqual([]);
  });
});

describe('the landed reader stamps memory with the start of the pass', () => {
  it('an entry read late in a pass is due at the next sweep, one beat after the pass began', async () => {
    const r = await rig();
    const prs = [2601, 2602, 2603];
    prs.forEach((pr) => pinned(r.coord, pr));
    const t0 = r.clock.t;
    r.deps.runCcd = async (argv) => {
      const pr = Number(argv[argv.indexOf('--pr') + 1]);
      r.calls.push(pr);
      r.clock.t += 5_000; // each read takes five seconds
      return ran(openLine(pr));
    };
    await r.pass();
    expect([...r.memory.values()].map((m) => [m.lastReadAt, m.nextAt])).toEqual(prs.map(() => [t0, t0 + PR_SWEEP_MS]));
    r.clock.t = t0 + PR_SWEEP_MS;
    await r.pass();
    expect(r.calls, 'all three are due one beat after the pass began').toHaveLength(6);
  });
});
