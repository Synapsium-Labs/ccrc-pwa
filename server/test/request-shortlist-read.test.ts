// The code shortlist's reader (Overlord W2 request record plan, Task B2; §7, RQ4, RQ5). L3: it gathers the programmes, the live
// claims and the one history read, and decides nothing. The decider's own cases are `shortlistCases.ts`.
//
// - Each read says what it was: a throw is that read's own unmeasured word, never an empty list (the brief's point 2).
// - The one history read: its agent is the history door's choice, its wait the time port's, and every way it can fail to be a
//   reading has its own word; an older agent's refusal of the verb is "not served" (point 3).
// - Paths are data from another box: a planted marker on an item reaches neither a log line nor the answer (point 4).
// - No caller in production: a census over the source roots (point 5).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { ClaimSummary } from '../../shared/api.js';
import type { OverlordHistoryAnswer, OverlordHistoryRequest } from '../../shared/overlordHistory.js';
import type { ExpectedPath } from '../../shared/overlordRequests.js';
import type { OverlordHistoryAsked } from '../src/coord/overlordHistory.js';
import {
  claimsByProgramme, liveProgrammes, readShortlist, sessionRuns, touchedByProgramme, type ShortlistReadDeps,
} from '../src/coord/requestShortlistRead.js';
import { TOUCHED_OPEN_WAIT_MS } from '../src/coord/requestShortlist.js';
import { TOUCHED_OPEN_BUDGET_MS } from '../../ccd/history/overlord-read.mjs';
import { OVERLORD_HISTORY_DEADLINE_MS } from '../../agent/src/historyOp.js';
import { OVERLORD_HISTORY_OP } from '../../shared/agent-protocol.js';
import { fakeTime, FAKE_T0, type FakeTime } from './fakeTime.js';
import { walkSrc } from './rings/walkSrc.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = 'project-a';
const Q = 'project-b';
const NOW = FAKE_T0;
const ep = (p: string, project = P): ExpectedPath => ({ project, path: p });

let coord: CoordStore;
let ft: FakeTime;
beforeEach(() => {
  coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-shortlist-read-'), '.ccrc', 'coord.db')));
  ft = fakeTime({ wallMs: NOW });
});
afterEach(() => { try { coord.db.close(); } catch { /* closed by the case */ } removeTmpFixtures(); vi.restoreAllMocks(); });

const programme = (slug: string, state = 'active'): void => {
  coord.db.prepare('INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, ?)').run(slug, slug, NOW - 1000, state);
};
const run = (program: string, project: string, sessionId: string | null, claimedBy: string | null = null,
  coordProject: string | null = null): number => Number(coord.db.prepare(
  "INSERT INTO runs (program, wave, project, sessionId, claimedBy, coordProject, state, kind, openedAt) VALUES (?, 1, ?, ?, ?, ?, 'working', 'work', ?)",
).run(program, project, sessionId, claimedBy, coordProject, NOW - 900).lastInsertRowid);
const summary = (id: number, runId: number | null, paths: string[], over: Partial<ClaimSummary> = {}): ClaimSummary => ({
  id, project: P, paths, heldBy: 'lane-a-project-a', heldByUuid: null, intent: '', runId, state: 'live',
  createdAt: NOW - 500, renewedAt: NOW - 100, expiresAt: NOW + 60_000, hardExpiresAt: NOW + 120_000, endedAt: null, ...over,
} as ClaimSummary);

const rowsAnswer = (items: unknown[], shown = items.length, total = items.length): OverlordHistoryAsked => ({
  kind: 'answer',
  answer: { outcome: 'rows', exit: 0, items: items as never, shown, total,
    scope: { kind: 'overlord', id: 'all', project: null, families: [], families_total: 0, transcripts: 1 } },
});
const item = (asked: number, file: string, sessions: { ccrcId: string; latestMs: number | null }[], whole = true) =>
  ({ asked, file, whole, sessions, trust: 'untrusted' });

interface Io { calls: { req: OverlordHistoryRequest; signal: AbortSignal | undefined }[] }
function deps(answer: (req: OverlordHistoryRequest) => Promise<OverlordHistoryAsked>,
  links = [{ connected: true, agentOps: [OVERLORD_HISTORY_OP] }], over: Partial<ShortlistReadDeps> = {}): ShortlistReadDeps & Io {
  const calls: Io['calls'] = [];
  return {
    calls, coord, db: coord.db, links: () => links, time: ft.ports,
    io: { overlordHistory: (req, signal) => { calls.push({ req, signal }); return answer(req); } },
    ...over,
  };
}

describe('liveProgrammes', () => {
  it('keeps active, paused and unknown, and drops done and abandoned', () => {
    for (const [slug, state] of [['p-active', 'active'], ['p-paused', 'paused'], ['p-unknown', 'unknown'], ['p-done', 'done'],
      ['p-abandoned', 'abandoned'], ['p-odd', 'no-such-state']] as const) programme(slug, state);
    const r = liveProgrammes(coord);
    expect(r.kind).toBe('measured');
    expect([...(r.kind === 'measured' ? r.live : [])].sort()).toEqual(['p-active', 'p-odd', 'p-paused', 'p-unknown']);
  });
  it('a read that throws is programmes-unreadable, never an empty set', () => {
    expect(liveProgrammes({ programs: () => { throw new Error('closed'); } })).toEqual({ kind: 'unmeasured', why: 'programmes-unreadable' });
  });
});

describe('claimsByProgramme', () => {
  it("joins each live, unexpired claim to its run's programme, and drops a claim with no run, an expired one and one whose run is gone", () => {
    programme('alpha');
    const r1 = run('alpha', P, 'lane-a-project-a');
    const claims = [
      summary(1, r1, ['a/x.ts']),
      summary(2, null, ['a/y.ts']),
      summary(3, r1, ['a/z.ts'], { expiresAt: NOW }),
      summary(4, 99_999, ['a/w.ts']),
      summary(5, r1, ['b/v.ts'], { project: Q, renewedAt: NOW - 7 }),
    ];
    expect(claimsByProgramme({ activeClaims: () => claims }, coord.db, NOW)).toEqual({ kind: 'measured', claims: [
      { programme: 'alpha', project: P, paths: ['a/x.ts'], renewedAt: NOW - 100 },
      { programme: 'alpha', project: Q, paths: ['b/v.ts'], renewedAt: NOW - 7 },
    ] });
  });
  it('reads the store itself: a real claim through activeClaims', () => {
    programme('alpha');
    const r1 = run('alpha', P, 'lane-a-project-a');
    coord.db.prepare("INSERT INTO claims (project, heldBy, heldByUuid, intent, runId, state, createdAt, renewedAt, expiresAt, hardExpiresAt) VALUES (?, 'lane-a-project-a', 'u', '', ?, 'live', ?, ?, ?, ?)")
      .run(P, r1, NOW - 10, NOW - 5, NOW + 60_000, NOW + 120_000);
    const id = (coord.db.prepare('SELECT max(id) AS id FROM claims').get() as { id: number }).id;
    coord.db.prepare('INSERT INTO claim_paths (claimId, project, path) VALUES (?, ?, ?)').run(id, P, 'a/x.ts');
    expect(claimsByProgramme(coord, coord.db, NOW)).toEqual({ kind: 'measured', claims: [
      { programme: 'alpha', project: P, paths: ['a/x.ts'], renewedAt: NOW - 5 }] });
  });
  it('a read that throws is claims-unreadable, never an empty list', () => {
    expect(claimsByProgramme({ activeClaims: () => { throw new Error('closed'); } }, coord.db, NOW))
      .toEqual({ kind: 'unmeasured', why: 'claims-unreadable' });
    programme('alpha');
    const r1 = run('alpha', P, 'lane-a-project-a');
    coord.db.close();
    expect(claimsByProgramme({ activeClaims: () => [summary(1, r1, ['a/x.ts'])] }, coord.db, NOW))
      .toEqual({ kind: 'unmeasured', why: 'claims-unreadable' });
  });
});

describe('sessionRuns', () => {
  it("maps a worker through sessionId (the run's project) and a coordinator through claimedBy (its own project, else the run's)", () => {
    programme('alpha'); programme('beta');
    run('alpha', P, 'lane-a-project-a', 'lane-c-coord');
    run('beta', Q, 'lane-a-project-a', 'lane-c-coord', 'project-c');
    run('beta', Q, 'lane-b-project-b');
    const r = sessionRuns(coord.db, ['lane-a-project-a', 'lane-c-coord', 'lane-gone']);
    expect(r.kind).toBe('measured');
    const runs = r.kind === 'measured' ? r.runs : new Map();
    expect(runs.get('lane-a-project-a')).toEqual([{ programme: 'alpha', project: P }, { programme: 'beta', project: Q }]);
    expect(runs.get('lane-c-coord')).toEqual([{ programme: 'alpha', project: P }, { programme: 'beta', project: 'project-c' }]);
    expect(runs.has('lane-gone')).toBe(false);
    expect(runs.has('lane-b-project-b')).toBe(false);
  });
  it('a read that throws is unmeasured', () => {
    coord.db.close();
    expect(sessionRuns(coord.db, ['lane-a'])).toEqual({ kind: 'unmeasured' });
  });
});

const answering = (a: OverlordHistoryAsked) => async (): Promise<OverlordHistoryAsked> => a;

describe('touchedByProgramme: the one history read', () => {
  it('no expected path is not asked, and no agent is asked', async () => {
    const d = deps(answering(rowsAnswer([])));
    expect(await touchedByProgramme(d, [])).toEqual({ kind: 'not-asked' });
    expect(d.calls).toEqual([]);
  });

  it('one op call carries every path; each row maps to its programmes; a session in two counts toward both', async () => {
    programme('alpha'); programme('beta');
    run('alpha', P, 'lane-a-project-a');
    run('beta', P, 'lane-a-project-a');
    const d = deps(answering(rowsAnswer([item(0, 'a/x.ts', [{ ccrcId: 'lane-a-project-a', latestMs: NOW - 3 }]),
      item(1, 'a/y.ts', [{ ccrcId: 'lane-unmapped', latestMs: NOW }])])));
    const r = await touchedByProgramme(d, [ep('a/x.ts'), ep('a/y.ts')]);
    expect(d.calls.map((c) => c.req)).toEqual([{ verb: 'touched', target: { kind: 'all' }, agents: false, args: ['a/x.ts', 'a/y.ts'] }]);
    expect(r).toEqual({ kind: 'measured', hits: [
      { programme: 'alpha', project: P, file: 'a/x.ts', latestMs: NOW - 3 }, { programme: 'beta', project: P, file: 'a/x.ts', latestMs: NOW - 3 }] });
  });

  it('more than eight paths: the first eight in stated order, and partial more-than-eight', async () => {
    const paths = ['a/1', 'a/2', 'a/3', 'a/4', 'a/5', 'a/6', 'a/7', 'a/8', 'a/9', 'a/10'];
    const d = deps(async (req) => rowsAnswer(req.args.map((p, k) => item(k, p, []))));
    const r = await touchedByProgramme(d, paths.map((p) => ep(p)));
    expect(d.calls[0]!.req.args).toEqual(paths.slice(0, 8));
    expect(r).toEqual({ kind: 'partial', hits: [], why: ['more-than-eight'] });
  });

  it('a capped read and a read cut by its budget are partial', async () => {
    const capped = deps(answering(rowsAnswer([item(0, 'a/x.ts', [], false), item(1, 'a/y.ts', [])])));
    expect(await touchedByProgramme(capped, [ep('a/x.ts'), ep('a/y.ts')])).toEqual({ kind: 'partial', hits: [], why: ['shown-below-total'] });
    const budget = deps(answering(rowsAnswer([item(0, 'a/x.ts', [])], 1, 2)));
    expect(await touchedByProgramme(budget, [ep('a/x.ts'), ep('a/y.ts')])).toEqual({ kind: 'partial', hits: [], why: ['budget'] });
  });

  it('busy, the agent deadline, an older agent, an unreadable history and a refused request each have their own word', async () => {
    const one = async (a: OverlordHistoryAnswer) => touchedByProgramme(deps(answering({ kind: 'answer', answer: a })), [ep('a/x.ts')]);
    expect(await one({ outcome: 'busy' })).toEqual({ kind: 'unmeasured', why: 'busy' });
    expect(await one({ outcome: 'deadline' })).toEqual({ kind: 'unmeasured', why: 'deadline' });
    expect(await one({ outcome: 'request-refused', word: 'bad-verb' })).toEqual({ kind: 'unmeasured', why: 'not-served' });
    expect(await one({ outcome: 'request-refused', word: 'bad-args' })).toEqual({ kind: 'unmeasured', why: 'refused' });
    expect(await one({ outcome: 'store-refused', word: 'store-missing' })).toEqual({ kind: 'unmeasured', why: 'history-unreadable' });
  });

  it('the port that does not serve the op, and a link that dropped the read, have their own words', async () => {
    const port = async (a: OverlordHistoryAsked) => touchedByProgramme(deps(answering(a)), [ep('a/x.ts')]);
    expect(await port({ kind: 'unsupported' })).toEqual({ kind: 'unmeasured', why: 'not-served' });
    expect(await port({ kind: 'lost' })).toEqual({ kind: 'unmeasured', why: 'link-down' });
    expect(await port({ kind: 'not-started' })).toEqual({ kind: 'unmeasured', why: 'link-down' });
    expect(await port({ kind: 'timeout' })).toEqual({ kind: 'unmeasured', why: 'deadline' });
    const thrown = deps(async () => { throw new Error('boom'); });
    expect(await touchedByProgramme(thrown, [ep('a/x.ts')])).toEqual({ kind: 'unmeasured', why: 'link-down' });
  });

  it('no agent advertises the op: not-served, or link-down when a link is not connected; no agent is asked', async () => {
    const none = deps(answering(rowsAnswer([])), []);
    expect(await touchedByProgramme(none, [ep('a/x.ts')])).toEqual({ kind: 'unmeasured', why: 'not-served' });
    const older = deps(answering(rowsAnswer([])), [{ connected: true, agentOps: ['update'] }]);
    expect(await touchedByProgramme(older, [ep('a/x.ts')])).toEqual({ kind: 'unmeasured', why: 'not-served' });
    const down = deps(answering(rowsAnswer([])), [{ connected: false, agentOps: [OVERLORD_HISTORY_OP] }]);
    expect(await touchedByProgramme(down, [ep('a/x.ts')])).toEqual({ kind: 'unmeasured', why: 'link-down' });
    const two = deps(answering(rowsAnswer([])), [{ connected: true, agentOps: [OVERLORD_HISTORY_OP] }, { connected: true, agentOps: [OVERLORD_HISTORY_OP] }]);
    expect(await touchedByProgramme(two, [ep('a/x.ts')])).toEqual({ kind: 'unmeasured', why: 'many-agents' });
    expect([...none.calls, ...older.calls, ...down.calls, ...two.calls]).toEqual([]);
  });

  it('a wait past TOUCHED_OPEN_WAIT_MS is deadline, through the time port, and aborts the read; no timer is left behind', async () => {
    const d = deps(() => new Promise(() => {}));
    const p = touchedByProgramme(d, [ep('a/x.ts')]);
    await Promise.resolve();
    expect(ft.pending()).toBe(1);
    ft.advance(TOUCHED_OPEN_WAIT_MS - 1);
    let settled = false;
    void p.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    ft.advance(1);
    expect(await p).toEqual({ kind: 'unmeasured', why: 'deadline' });
    expect(d.calls[0]!.signal?.aborted).toBe(true);
    const quick = deps(answering(rowsAnswer([item(0, 'a/x.ts', [])])));
    await touchedByProgramme(quick, [ep('a/x.ts')]);
    expect(ft.pending(), 'an answer before the wait cancels its timer').toBe(0);
  });

  it("the runner's budget, the door's wait and the agent's deadline are in order", () => {
    expect(TOUCHED_OPEN_BUDGET_MS).toBeLessThan(TOUCHED_OPEN_WAIT_MS);
    expect(TOUCHED_OPEN_WAIT_MS).toBeLessThan(OVERLORD_HISTORY_DEADLINE_MS);
  });

  it('an unreadable runs read is runs-unreadable, never an empty reading', async () => {
    const d = deps(answering(rowsAnswer([item(0, 'a/x.ts', [{ ccrcId: 'lane-a', latestMs: NOW }])])));
    coord.db.close();
    expect(await touchedByProgramme(d, [ep('a/x.ts')])).toEqual({ kind: 'unmeasured', why: 'runs-unreadable' });
  });

  it('paths are data from another box: a planted marker reaches no log line and no answer', async () => {
    const MARK = 'MARKER-PLANTED-PATH';
    const lines: string[] = [];
    for (const k of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
    }
    programme('alpha');
    run('alpha', P, 'lane-a-project-a');
    const d = deps(answering(rowsAnswer([
      item(0, `../${MARK}`, [{ ccrcId: 'lane-a-project-a', latestMs: NOW }]),
      item(1, 'a/y.ts', [{ ccrcId: `${MARK}/..`, latestMs: NOW }]),
      { ...item(2, '/etc/x', []), file: `/abs/${MARK}` },
    ])));
    const r = await touchedByProgramme(d, [ep('a/x.ts'), ep('a/y.ts'), ep('a/z.ts')]);
    expect(r).toEqual({ kind: 'partial', hits: [], why: ['item-refused'] });
    const s = await readShortlist(d, [ep('a/x.ts'), ep('a/y.ts'), ep('a/z.ts')]);
    expect(JSON.stringify([r, s])).not.toContain(MARK);
    expect(lines.filter((l) => l.includes(MARK))).toEqual([]);
    expect(lines, 'the reader logs nothing at all').toEqual([]);
  });
});

describe('readShortlist: the three reads, then the decider', () => {
  it('a claim outranks history, end to end, and each read is named', async () => {
    programme('alpha'); programme('beta'); programme('gamma', 'done');
    const ra = run('alpha', P, 'lane-a-project-a');
    run('beta', P, 'lane-b-project-a');
    run('gamma', P, 'lane-g-project-a');
    const d = deps(answering(rowsAnswer([item(0, 'a/x.ts', [{ ccrcId: 'lane-b-project-a', latestMs: NOW }, { ccrcId: 'lane-g-project-a', latestMs: NOW }]),
      item(1, 'a/y.ts', [{ ccrcId: 'lane-b-project-a', latestMs: NOW }])])),
    undefined, { coord: { programs: () => coord.programs(), activeClaims: () => [summary(1, ra, ['a'])] } });
    const s = await readShortlist(d, [ep('a/x.ts'), ep('a/y.ts')]);
    expect(s).toEqual({ candidates: [
      { programme: 'alpha', claimHits: 2, touchedHits: 0, newest: NOW - 100 },
      { programme: 'beta', claimHits: 0, touchedHits: 2, newest: NOW }],
    basis: 'paths', live: 'measured', claims: 'measured', touched: 'measured', touchedWhy: [] });
  });

  it('a claims read that throws is its own word, and the history still stands', async () => {
    programme('beta');
    run('beta', P, 'lane-b-project-a');
    const d = deps(answering(rowsAnswer([item(0, 'a/x.ts', [{ ccrcId: 'lane-b-project-a', latestMs: NOW }])])),
      undefined, { coord: { programs: () => coord.programs(), activeClaims: () => { throw new Error('closed'); } } });
    const s = await readShortlist(d, [ep('a/x.ts')]);
    expect([s.claims, s.candidates.map((c) => c.programme)]).toEqual(['unmeasured', ['beta']]);
  });

  it('no expected path: claims only, and history is not asked', async () => {
    programme('alpha');
    const ra = run('alpha', P, 'lane-a-project-a');
    const d = deps(answering(rowsAnswer([])), undefined,
      { coord: { programs: () => coord.programs(), activeClaims: () => [summary(1, ra, ['a/x.ts', 'a/y.ts'])] } });
    const s = await readShortlist(d, []);
    expect([s.basis, s.touched, s.candidates]).toEqual(['claims-only', 'not-asked', [{ programme: 'alpha', claimHits: 2, touchedHits: 0, newest: NOW - 100 }]]);
    expect(d.calls).toEqual([]);
  });
});

describe('no caller in production (the open door of the next part is the first)', () => {
  it('no source imports the reader', () => {
    const files = walkSrc({ roots: ['server/src', 'shared', 'agent/src', 'pwa/src'], min: 300 });
    expect(files.length, 'CONTROL: the walk read the source roots').toBeGreaterThan(300);
    const IMPORTS = /requestShortlistRead(\.js)?['"]/;
    const importing = files.filter((f) => IMPORTS.test(readFileSync(path.join(ROOT, f), 'utf8')));
    expect(importing).toEqual([]);
    expect(IMPORTS.test("import { readShortlist } from './requestShortlistRead.js';"), 'CONTROL: an import is seen').toBe(true);
  });
});
