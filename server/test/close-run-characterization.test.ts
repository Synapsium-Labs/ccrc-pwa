// Characterization of the run close (Overlord W2 done tests A, Task A2's precondition): what a close refuses, accepts
// and records TODAY, pinned green on `main` before `runs.closePr` is added. The one additive column is set aside
// (`withoutClosePr`), so this file is identical before and after that change and a red here is a change in what the
// close does, not in what it adds. Both layers: `closeRun` in `coord/close.ts` (the work close with its measured line,
// the abandon of a claim, the operator abandon, a refused claim) and `CoordStore.closeRun` (its refusals and the
// programme's retirement).
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { closeRun, type CloseRunDeps } from '../src/coord/close.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'project-a';
const COORD = 'project-a-coordinator';
const TIP = 'a'.repeat(40);
const MERGE = 'e'.repeat(40);
const GOOD = { branchTip: TIP, prNumber: 7, prPhase: 'open', handoffCommit: TIP };

type Row = Record<string, unknown>;
const prRow = (branch: string, state: 'OPEN' | 'MERGED' | 'CLOSED', extra: Row = {}): Row => ({
  number: 7, state, headRefName: branch, baseRefName: 'main', headRefOid: TIP,
  isCrossRepository: false, ours: true, isDraft: false,
  ...(state === 'MERGED' ? { mergedAt: '2020-01-01T00:00:00Z', mergeCommit: { oid: MERGE } } : {}),
  ...extra,
});
const lineOf = (id: string, rows: Row[]): string =>
  `${JSON.stringify({ id, rows, baseShort: 'main', branch: `ws/${id}`, ahead: 1, tip: TIP, checkedAt: 1 })}\n`;

const build = (rows: Row[] = [], tip = TIP) => {
  const home = mkTmp('ccrc-close-char-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const projects = mkTmp('ccrc-close-char-git-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    if (args[0] === 'pr-state') return { ran: true, code: 0, stdout: lineOf(args[2] ?? '', rows), stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const base = testDeps(home, run);
  const deps: CloseRunDeps = { coord, io: base.io, cfg: { ...base.cfg, projectsRoot: projects }, runCcd: base.runCcd };
  const seed = (session: string): void => {
    const fields: Record<string, string> = { wrapper: 'claude', project: PROJECT, workdir: `/w/${session}`,
      uuid: `u-${session}`, started: '1', workspace: session, branch: `ws/${session}`, base: 'origin/main' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${session}.${k}`), v);
    const refs = path.join(projects, PROJECT, '.git', 'refs', 'heads', 'ws');
    mkdirSync(refs, { recursive: true });
    writeFileSync(path.join(refs, session), `${tip}\n`);
  };
  /** A run of `program`, opened and (unless `session` is null) dispatched and advanced to `working`. */
  const open = (session: string | null, program = 'prog-a'): number => {
    const r = coord.openRun({ program, title: 't', project: PROJECT, wave: 1, waveOf: 2, claimedBy: COORD });
    if (!('id' in r)) throw new Error('openRun refused');
    if (session === null) return r.id;
    seed(session);
    coord.markDispatched(r.id, session, session, `ws/${session}`, false);
    for (const to of ['dispatched', 'working'] as const) {
      if (!coord.advance(r.id, to, 'test').ok) throw new Error(`fixture advance to ${to} refused`);
    }
    return r.id;
  };
  return { coord, deps, calls, open };
};

const TIMES = ['openedAt', 'dispatchStartedAt', 'dispatchedAt', 'closedAt', 'clearedAt'];
/** The whole `runs` row, every column but the one this piece adds, with its clock columns reduced to set or unset. */
const withoutClosePr = (coord: CoordStore, id: number): Row => {
  const row = { ...(coord.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row) };
  delete row.closePr;
  for (const k of TIMES) if (k in row) row[k] = row[k] === null ? null : 'set';
  return row;
};
const events = (coord: CoordStore, id: number): string[] =>
  (coord.db.prepare('SELECT fromState, toState, causedBy, detail FROM run_events WHERE runId = ? ORDER BY id').all(id) as
    { fromState: string; toState: string; causedBy: string; detail: string | null }[])
    .map((e) => `${e.fromState}>${e.toState} ${e.causedBy}${e.detail === null ? '' : ` ${e.detail}`}`);
const programState = (coord: CoordStore, slug: string): unknown =>
  (coord.db.prepare('SELECT state FROM programs WHERE slug = ?').get(slug) as { state: string } | undefined)?.state;
const untold = (coord: CoordStore, id: number): unknown =>
  coord.db.prepare('SELECT cause, detail, claimant FROM run_close_untold WHERE runId = ?').get(id) ?? null;
const verbs = (calls: string[][]): string[] => calls.map((c) => c[0] ?? '');

describe('closeRun (coord/close.ts): what a work close accepts and records today', () => {
  it('a done close that measures its PR merged closes done, releases, and records the handoff', async () => {
    const b = build([prRow('ws/project-a-w1', 'MERGED')]);
    const id = b.open('project-a-w1');
    const out = await closeRun(b.deps, id, { fingerprint: GOOD, final: true }, 'coordinator');
    expect(out).toEqual({ ok: true, id, state: 'done', released: true, childReclaim: 'not-queued', childReclaimWhy: 'not-a-child' });
    expect(withoutClosePr(b.coord, id)).toMatchObject({ state: 'done', handoffCommit: TIP, closedAt: 'set',
      closedBy: 'coordinator', closeDetail: null, sessionId: 'project-a-w1', prLineage: '[]' });
    expect(events(b.coord, id).slice(-2)).toEqual(['working>closing coordinator', 'closing>done coordinator']);
    expect(verbs(b.calls)).toEqual(['pr-state', 'ws-release']);
    expect(programState(b.coord, 'prog-a')).toBe('done');
    expect(untold(b.coord, id)).toBeNull();
  });

  it('a done close that measures its PR open closes done the same way', async () => {
    const b = build([prRow('ws/project-a-w2', 'OPEN')]);
    const id = b.open('project-a-w2');
    const out = await closeRun(b.deps, id, { fingerprint: GOOD, final: true }, 'coordinator');
    expect(out).toMatchObject({ ok: true, id, state: 'done', released: true });
    expect(withoutClosePr(b.coord, id)).toMatchObject({ state: 'done', handoffCommit: TIP, closeDetail: null });
  });

  it('the abandon of a claim (state failed) asks no pr-state and closes failed with the handoff it was given', async () => {
    const b = build([prRow('ws/project-a-w3', 'MERGED')]);
    const id = b.open('project-a-w3');
    const out = await closeRun(b.deps, id, { fingerprint: GOOD, final: true, state: 'failed' }, 'coordinator');
    expect(out).toMatchObject({ ok: true, id, state: 'failed', released: true });
    expect(verbs(b.calls)).toEqual(['ws-release']);
    const row = withoutClosePr(b.coord, id);
    expect(row).toMatchObject({ state: 'failed', closedBy: 'coordinator', closeDetail: null });
    expect(events(b.coord, id).slice(-2)).toEqual(['working>closing coordinator', 'closing>failed coordinator']);
    expect(programState(b.coord, 'prog-a')).toBe('abandoned');
  });

  it('the operator abandon of a planned run closes it failed with no closing hop and owes the claimant a word', async () => {
    const b = build();
    const id = b.open(null);
    const out = await closeRun(b.deps, id, { intent: 'abandon' }, 'operator');
    expect(out).toMatchObject({ ok: true, id, state: 'failed', released: false });
    expect(withoutClosePr(b.coord, id)).toMatchObject({ state: 'failed', handoffCommit: null, closedBy: 'operator' });
    expect(events(b.coord, id)).toEqual(['planned>failed operator']);
    expect(untold(b.coord, id)).toEqual({ cause: 'operator', detail: null, claimant: COORD });
    expect(verbs(b.calls)).toEqual([]);
  });

  it('a stale claim is refused and leaves the run exactly as it was', async () => {
    const b = build([prRow('ws/project-a-w4', 'MERGED')], 'b'.repeat(40));
    const id = b.open('project-a-w4');
    const before = withoutClosePr(b.coord, id);
    const out = await closeRun(b.deps, id, { fingerprint: GOOD, final: true }, 'coordinator');
    expect(out).toMatchObject({ ok: false });
    expect(withoutClosePr(b.coord, id)).toEqual(before);
    expect(verbs(b.calls)).not.toContain('ws-release');
  });
});

describe('CoordStore.closeRun: what the store refuses and records today', () => {
  const input = (id: number, over: Partial<Parameters<CoordStore['closeRun']>[0]> = {}) =>
    ({ runId: id, finalState: 'done' as const, causedBy: 'coordinator', handoffCommit: null, program: 'prog-a',
      viaClosing: true, ...over });

  it('a close with no legal edge refuses and writes nothing', () => {
    const b = build();
    const id = b.open(null);
    const before = withoutClosePr(b.coord, id);
    expect(b.coord.closeRun(input(id))).toMatchObject({ ok: false });
    expect(withoutClosePr(b.coord, id)).toEqual(before);
    expect(events(b.coord, id)).toEqual([]);
  });

  it('a claimant that changed refuses claimant-changed and writes nothing', () => {
    const b = build();
    const id = b.open('project-a-w5');
    const before = withoutClosePr(b.coord, id);
    expect(b.coord.closeRun(input(id, { expectClaimedBy: 'someone-else' })))
      .toEqual({ ok: false, error: 'claimant-changed', claimedBy: COORD });
    expect(withoutClosePr(b.coord, id)).toEqual(before);
  });

  it('an unknown run under the compare-and-set refuses unknown-run', () => {
    const b = build();
    expect(b.coord.closeRun(input(999, { expectClaimedBy: COORD }))).toEqual({ ok: false, error: 'unknown-run' });
  });

  it('a shape-valid handoff is written, the detail is stored, and the programme retires only at its last open run', () => {
    const b = build();
    const first = b.open('project-a-w6');
    const second = b.open('project-a-w7');
    expect(b.coord.closeRun(input(first, { handoffCommit: TIP, detail: 'why-a' })).ok).toBe(true);
    expect(withoutClosePr(b.coord, first)).toMatchObject({ state: 'done', handoffCommit: TIP, closeDetail: 'why-a' });
    expect(programState(b.coord, 'prog-a')).not.toBe('done');
    expect(b.coord.closeRun(input(second, { finalState: 'failed', causedBy: 'sweep' })).ok).toBe(true);
    expect(programState(b.coord, 'prog-a')).toBe('abandoned');
    expect(untold(b.coord, second)).toEqual({ cause: 'sweep', detail: null, claimant: COORD });
  });
});
