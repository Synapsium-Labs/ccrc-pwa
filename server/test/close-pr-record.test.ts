// The close records its own pull request (Overlord W2 done tests A, Task A2; plan docs/superpowers/plans/2026-11-16-
// overlord-w2/w2-done-tests.md DT7). `.prhistory` is appended only when a workspace's bound PR is replaced, so a run's
// own PR that merged never appears there, and the next wave on the same workspace carries the previous wave's merged PR
// in its lineage. The close measures its own bound row anyway (`verifyDone`'s line), and `runs.closePr` keeps it: one
// column, one writer (`CoordStore.closeRun`, in the close's transaction), off the wire.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, toRunSummary } from '../src/coord/store.js';
import { closeRun, type CloseRunDeps } from '../src/coord/close.js';
import { closePrFactsOf, type CcdPrLine } from '../src/prstate.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const PROJECT = 'project-a';
const COORD = 'project-a-coordinator';
const TIP = 'a'.repeat(40);
const HEAD = 'c'.repeat(40);
const GOOD = { branchTip: TIP, prNumber: 7, prPhase: 'open', handoffCommit: TIP };

type Row = Record<string, unknown>;
const prRow = (branch: string, state: 'OPEN' | 'MERGED' | 'CLOSED', extra: Row = {}): Row => ({
  number: 7, state, headRefName: branch, baseRefName: 'main', headRefOid: HEAD,
  isCrossRepository: false, ours: true, isDraft: false,
  ...(state === 'MERGED' ? { mergedAt: '2020-01-01T00:00:00Z', mergeCommit: { oid: 'e'.repeat(40) } } : {}),
  ...extra,
});
const line = (rows: Row[], branch = 'ws/project-a-s'): CcdPrLine => ({
  id: 'project-a-s', project: PROJECT, repo: 'r', branch, base: 'origin/main', baseShort: 'main', tip: TIP, ahead: 1,
  dirty: 0, commits: [], template: null, rows: rows as CcdPrLine['rows'], phase: 'open', number: 7, checkedAt: 1, reason: null,
});

describe('closePrFactsOf: the bound row of the close\'s own measured line', () => {
  const B = 'ws/project-a-s';
  it.each([
    ['a merged bound row', [prRow(B, 'MERGED')], { pr: 7, merged: true, head: HEAD }],
    ['an open bound row', [prRow(B, 'OPEN')], { pr: 7, merged: false, head: HEAD }],
    ['a closed bound row', [prRow(B, 'CLOSED')], { pr: 7, merged: false, head: HEAD }],
    ['a row a merge train landed', [prRow(B, 'CLOSED', { landedInTrain: true })], { pr: 7, merged: true, head: HEAD }],
    ['the highest bound number of two', [prRow(B, 'MERGED', { number: 5 }), prRow(B, 'OPEN', { number: 9 })], { pr: 9, merged: false, head: HEAD }],
  ])('%s', (_name, rows, want) => {
    expect(closePrFactsOf(line(rows))).toEqual(want);
  });

  it.each([
    ['no rows', []],
    ['a row of another branch', [prRow('ws/other', 'MERGED')]],
    ['a row not ours', [prRow(B, 'MERGED', { ours: false })]],
    ['a row with no number', [prRow(B, 'MERGED', { number: undefined })]],
    ['a row with a fractional number', [prRow(B, 'MERGED', { number: 7.5 })]],
    ['a row with a short head', [prRow(B, 'MERGED', { headRefOid: 'abc123' })]],
    ['a row with no head', [prRow(B, 'MERGED', { headRefOid: undefined })]],
  ])('%s answers null, never a guess', (_name, rows) => {
    expect(closePrFactsOf(line(rows))).toBeNull();
  });
});

const lineOf = (id: string, rows: Row[]): string =>
  `${JSON.stringify({ id, rows, baseShort: 'main', branch: `ws/${id}`, ahead: 1, tip: TIP, checkedAt: 1 })}\n`;

const build = (rows: Row[] = []) => {
  const home = mkTmp('ccrc-close-pr-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const projects = mkTmp('ccrc-close-pr-git-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const run: Runner = async (_cmd, args) =>
    args[0] === 'pr-state' ? { ran: true, code: 0, stdout: lineOf(args[2] ?? '', rows), stderr: '' }
      : { ran: true, code: 0, stdout: '', stderr: '' };
  const base = testDeps(home, run);
  const deps: CloseRunDeps = { coord, io: base.io, cfg: { ...base.cfg, projectsRoot: projects }, runCcd: base.runCcd };
  const open = (session: string | null, wave = 1): number => {
    const r = coord.openRun({ program: 'prog-a', title: 't', project: PROJECT, wave, waveOf: 2, claimedBy: COORD });
    if (!('id' in r)) throw new Error('openRun refused');
    if (session === null) return r.id;
    const fields: Record<string, string> = { wrapper: 'claude', project: PROJECT, workdir: `/w/${session}`,
      uuid: `u-${session}`, started: '1', workspace: session, branch: `ws/${session}`, base: 'origin/main' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${session}.${k}`), v);
    const refs = path.join(projects, PROJECT, '.git', 'refs', 'heads', 'ws');
    mkdirSync(refs, { recursive: true });
    writeFileSync(path.join(refs, session), `${TIP}\n`);
    coord.markDispatched(r.id, session, session, `ws/${session}`, false);
    for (const to of ['dispatched', 'working'] as const) {
      if (!coord.advance(r.id, to, 'test').ok) throw new Error(`fixture advance to ${to} refused`);
    }
    return r.id;
  };
  const stored = (id: number): unknown => {
    const raw = okRun(coord.run(id))!.closePr;
    return raw === null ? null : JSON.parse(raw);
  };
  return { reg, coord, deps, open, stored };
};

describe('the close writes runs.closePr in its own transaction', () => {
  it('a done close that measured its PR merged records { pr, merged: true, head }', async () => {
    const b = build([prRow('ws/project-a-r1', 'MERGED')]);
    const id = b.open('project-a-r1');
    expect(await closeRun(b.deps, id, { fingerprint: GOOD, final: true }, 'coordinator')).toMatchObject({ ok: true, state: 'done' });
    expect(b.stored(id)).toEqual({ pr: 7, merged: true, head: HEAD });
  });

  it('a done close that measured its PR open records it not merged', async () => {
    const b = build([prRow('ws/project-a-r2', 'OPEN')]);
    const id = b.open('project-a-r2');
    await closeRun(b.deps, id, { fingerprint: GOOD, final: true }, 'coordinator');
    expect(b.stored(id)).toEqual({ pr: 7, merged: false, head: HEAD });
  });

  it('a close that measured no line records nothing: an operator abandon, and the abandon of a claim', async () => {
    const b = build([prRow('ws/project-a-r3', 'MERGED')]);
    const planned = b.open(null);
    expect(await closeRun(b.deps, planned, { intent: 'abandon' }, 'operator')).toMatchObject({ ok: true, state: 'failed' });
    expect(b.stored(planned)).toBeNull();
    const claimed = b.open('project-a-r3');
    expect(await closeRun(b.deps, claimed, { fingerprint: GOOD, final: true, state: 'failed' }, 'coordinator'))
      .toMatchObject({ ok: true, state: 'failed' });
    expect(b.stored(claimed)).toBeNull();
  });

  it('a refused close records nothing', async () => {
    const b = build([prRow('ws/project-a-r4', 'MERGED')]);
    const id = b.open('project-a-r4');
    const out = await closeRun(b.deps, id, { fingerprint: { ...GOOD, branchTip: 'b'.repeat(40), handoffCommit: 'b'.repeat(40) },
      final: true }, 'coordinator');
    expect(out).toMatchObject({ ok: false });
    expect(b.stored(id)).toBeNull();
  });

  it('a row closed with no record (an older build, or the store called without one) reads null', () => {
    const b = build();
    const id = b.open('project-a-r5');
    expect(b.coord.closeRun({ runId: id, finalState: 'done', causedBy: 'test', handoffCommit: null, program: 'prog-a',
      viaClosing: true }).ok).toBe(true);
    expect(okRun(b.coord.run(id))!.closePr).toBeNull();
  });

  it('the reuse case (F1): wave 1\'s merged PR in .prhistory never becomes wave 2\'s record', async () => {
    const s = 'project-a-r6';
    const b = build([prRow(`ws/${s}`, 'OPEN')]);
    writeFileSync(path.join(b.reg, `${s}.prhistory`),
      `${JSON.stringify({ pr: 5, branch: `ws/${s}`, prbranch: `ws/${s}`, phase: 'merged', recordedAt: 1 })}\n`);
    const id = b.open(s, 2);
    expect(await closeRun(b.deps, id, { fingerprint: GOOD, final: true }, 'coordinator')).toMatchObject({ ok: true, state: 'done' });
    const run = okRun(b.coord.run(id))!;
    expect(run.prLineage.map((e) => [e.pr, e.phase])).toEqual([[5, 'merged']]);
    expect(b.stored(id)).toEqual({ pr: 7, merged: false, head: HEAD });
  });

  it('the run summary on the wire carries no closePr', async () => {
    const b = build([prRow('ws/project-a-r7', 'MERGED')]);
    const id = b.open('project-a-r7');
    await closeRun(b.deps, id, { fingerprint: GOOD, final: true }, 'coordinator');
    const row = okRun(b.coord.run(id))!;
    expect(row.closePr).not.toBeNull();
    expect('closePr' in toRunSummary(row)).toBe(false);
  });
});
