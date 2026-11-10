// D-6096 (fleet-capacity W1-4b; spec §3.5 "The binding", §5.1 W1-4b; D-8126 amendment A8-4): a coordinator whose wave the
// concurrency cap refused may take that wave as the run's own worker, in place. The bind starts no process and composes no
// fleet act on the coordinator's workspace; a plain dispatch of a run claimed by the session it is bound to is refused
// `self-dispatch` before anything is composed; an in-place run's close and abandon compose no `ws-*` verb on the claimant;
// its done-claim is measured on the sibling worktree's recorded branch; and it is charged to neither cap.
//
// The operator's pause (answer 2, 2026-11-09) stops dispatch, the in-place bind and self-work on new waves, and nothing
// else: a close, an abandon and an advance are not refused by it, and a test below pins that.
//
// The first block is the CHARACTERIZATION: it is green on the base and pins what a self-claimed run does today. The
// behaviour commit flips exactly the rows it names.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import { closeRun, type CloseRunDeps } from '../src/coord/close.js';
import { resolveDoneBranch } from '../src/coord/fingerprint.js';
import { clearSender } from '../src/inject/send.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP, ROUTE_ARGV_CAP, ROUTE_CAP, ROUTE_DEFAULT_CAP } from '../src/ccdargv.js';
import { configDirFor } from '../src/config.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const PROJECT = 'demo';
/** The coordinator: it claims the run, and (a self-claimed run) is the session the run is bound to. */
const BOSS = 'demo-boss';
const CLEAR_PANES = ['scrollback\n❯ \n', 'scrollback\n❯ /clear\n', 'scrollback\n❯ \n'];
const VERBS = ['ws-add', 'ensure', 'ws-hold', 'ws-release', 'ws-archive', ACTOR_FLAGS_CAP, ROUTE_ARGV_CAP, ROUTE_DEFAULT_CAP, ROUTE_CAP];
/** An abandon-shaped ordinary close (`state:'failed'` skips `verifyDone`, D-49): the one ordinary-path body a fixture with
 *  no git repo can drive. */
const FAILED_CLOSE = { fingerprint: { branchTip: 'x', prNumber: null, prPhase: 'open', handoffCommit: 'x' },
  final: false, state: 'failed' };

const seedRow = (home: string, id: string, over: Partial<Record<string, string>> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

function build() {
  const home = mkTmp('ccrc-dispatch-in-place-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const calls: string[][] = [];
  let cap = 0;
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    if (verb === 'ws-add') { seedRow(home, `${PROJECT}-fresh`); return { ran: true, code: 0, stdout: '', stderr: '' }; }
    if (verb === 'capture-pane') {
      const p = CLEAR_PANES[Math.min(cap, CLEAR_PANES.length - 1)]!;
      cap++;
      return { ran: true, code: 0, stdout: p, stderr: '' };
    }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const base = testDeps(home, run);
  const fleetState = { connected: true, downSince: null, ccdVerbs: VERBS, rosterFp: null, build: null };
  const deps: DispatchRunDeps & CloseRunDeps = {
    ...base, coord, fleetState,
    configDir: (w: string) => configDirFor(base.cfg, w), turnVerdict: async () => 'idle' as const, sendClear: clearSender(base),
  };
  seedRow(home, BOSS);
  /** A run claimed by BOSS, optionally bound to `session`, at `state`. */
  const open = (over: { wave?: number; session?: string | null; state?: 'planned' | 'dispatched' } = {}): number => {
    const o = coord.openRun({ program: 'p', title: 't', project: PROJECT, wave: over.wave ?? 1, waveOf: 3, claimedBy: BOSS });
    if (!('id' in o)) throw new Error(`fixture openRun refused: ${JSON.stringify(o)}`);
    const session = over.session === undefined ? null : over.session;
    if (session !== null) {
      if (over.state === 'dispatched') {
        coord.markDispatched(o.id, session, session, `ws/${session}`, false);
        if (!coord.advance(o.id, 'dispatched', 'test').ok) throw new Error('fixture: could not dispatch');
      } else coord.setSession(o.id, session);
    }
    return o.id;
  };
  const verbs = (): string[] => calls.map((c) => c[0] ?? '');
  /** The `ws-*` fleet acts, as `[verb, session it names]`. */
  const acts = (): [string, string | undefined][] => calls
    .filter((c) => c[0] === 'ws-hold' || c[0] === 'ws-release' || c[0] === 'ws-archive')
    .map((c) => [c[0]!, c[c.indexOf('--session') + 1]]);
  return { home, coord, deps, calls, open, verbs, acts, base, fleetState };
}

describe('characterization: today a self-claimed run is dispatched and closed like any other (green on the base)', () => {
  it('a fresh run (no session) is dispatched by minting a workspace, holding it and queueing the brief', async () => {
    const b = build();
    const id = b.open();
    const out = await dispatchRun(b.deps, id, 'go', undefined);
    expect(out).toMatchObject({ ok: true, resumed: false });
    expect(b.verbs()).toContain('ws-add');
    expect(b.verbs()).toContain('ws-hold');
    expect(b.verbs()).not.toContain('ensure');
  });

  it('today: a run bound to its own claimant is dispatched through the resume arm, which runs ensure, the hold and /clear on the coordinator', async () => {
    const b = build();
    const id = b.open({ wave: 2, session: BOSS });
    const out = await dispatchRun(b.deps, id, 'go', undefined);
    expect(out).toMatchObject({ ok: true, resumed: true, sessionId: BOSS, clearedAt: expect.any(Number) });
    expect(b.calls.find((c) => c[0] === 'ensure')).toEqual(['ensure', BOSS]);
    expect(b.acts()).toEqual([['ws-hold', BOSS]]);
    expect(b.calls.some((c) => c[0] === 'send-keys')).toBe(true);
    expect(okRun(b.coord.run(id))!.state).toBe('dispatched');
  });

  it('today: closing a self-claimed run releases, holds or archives the COORDINATOR’s workspace', async () => {
    const final = build();
    const f = final.open({ session: BOSS, state: 'dispatched' });
    expect(await closeRun(final.deps, f, { ...FAILED_CLOSE, final: true }, 'coordinator')).toMatchObject({ ok: true, released: true });
    expect(final.acts()).toEqual([['ws-release', BOSS]]);

    const next = build();
    const n = next.open({ session: BOSS, state: 'dispatched' });
    expect(await closeRun(next.deps, n, FAILED_CLOSE, 'coordinator')).toMatchObject({ ok: true, released: false });
    expect(next.acts()).toEqual([['ws-hold', BOSS]]);

    const arch = build();
    const a = arch.open({ session: BOSS, state: 'dispatched' });
    expect(await closeRun(arch.deps, a, { ...FAILED_CLOSE, archive: true }, 'coordinator')).toMatchObject({ ok: true });
    expect(arch.acts()).toEqual([['ws-archive', BOSS]]);
  });

  it('today: abandoning a self-claimed run releases the coordinator’s workspace', async () => {
    const b = build();
    const id = b.open({ session: BOSS, state: 'dispatched' });
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator')).toMatchObject({ ok: true, state: 'failed' });
    expect(b.acts()).toEqual([['ws-release', BOSS]]);
  });

  it('today: the done branch is the registry’s branch for the session, never the run row’s', async () => {
    const b = build();
    const r = await resolveDoneBranch(b.base, { sessionId: BOSS, project: PROJECT, branch: 'feat/sibling' });
    expect(r).toMatchObject({ ok: true, branch: `ws/${BOSS}`, provenance: '' });
  });
});

describe('the column and the store call (D-6096)', () => {
  it('the migration is one nullable column and nothing else', () => {
    const entry = MIGRATIONS[51]!;
    expect(entry).toMatch(/ALTER TABLE runs ADD COLUMN inPlace INTEGER;/);
    expect(entry.replace(/--.*$/gm, '').match(/ALTER TABLE|CREATE |NOT NULL|CHECK|DEFAULT/g)).toEqual(['ALTER TABLE']);
    const b = build();
    const col = (b.coord.db.prepare('PRAGMA table_info(runs)').all() as { name: string; notnull: number; type: string }[])
      .find((c) => c.name === 'inPlace');
    expect(col).toMatchObject({ type: 'INTEGER', notnull: 0 });
  });

  it('bindInPlace moves planned to working in one transaction, binds the claimant and charges no slot', () => {
    const b = build();
    const id = b.open();
    expect(b.coord.bindInPlace(id, BOSS, 'feat/sibling')).toEqual({ ok: true, from: 'dispatched', to: 'working' });
    const run = okRun(b.coord.run(id))!;
    expect(run).toMatchObject({ state: 'working', sessionId: BOSS, branch: 'feat/sibling', resumed: false, inPlace: true,
      dispatchedAt: null, workspace: null });
    expect(b.coord.runEvents(id).map((e) => [e.fromState, e.toState, e.detail])).toEqual([
      ['planned', 'dispatched', 'in-place'], ['dispatched', 'working', 'in-place'],
    ]);
    // an in-place run takes no concurrency slot: neither the plain count nor the stale-run predicate's list sees it
    expect(b.coord.capsUsage().running).toBe(0);
    expect(b.coord.activeRunWorkers()).toEqual([]);
  });

  it('bindInPlace clears the admission stamp the cap left on the run', () => {
    const b = build();
    const id = b.open();
    b.coord.stampAdmissionWait(id, 1000);
    expect(b.coord.admissionStampOf(id)!.since).toBe(1000);
    b.coord.bindInPlace(id, BOSS, 'feat/sibling');
    expect(b.coord.admissionStampOf(id)).toMatchObject({ since: null, lastRefusedAt: null, wokenAt: null });
  });

  it('a run that is not planned is refused bad-transition with nothing written', () => {
    const b = build();
    const id = b.open({ session: 'demo-worker', state: 'dispatched' });
    const before = JSON.stringify(okRun(b.coord.run(id)));
    expect(b.coord.bindInPlace(id, BOSS, 'feat/sibling')).toMatchObject({ ok: false, error: 'bad-transition', from: 'dispatched' });
    expect(JSON.stringify(okRun(b.coord.run(id)))).toBe(before);
    expect(b.coord.runEvents(id)).toHaveLength(1);
  });

  it('an ordinary run carries no inPlace field on the wire', () => {
    const b = build();
    const id = b.open({ session: 'demo-worker', state: 'dispatched' });
    expect(okRun(b.coord.run(id))).not.toHaveProperty('inPlace');
  });
});
