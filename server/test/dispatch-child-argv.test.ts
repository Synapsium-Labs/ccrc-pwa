// Child-workspace reclamation, spec §5.1 and §6 "Deploy", wave 1: dispatch is
// the server's ONE writer of the `--child <runId>` flag — the server half of
// the two authorities that make a workspace a child. It rides the fresh-spawn
// `ws-add` only, gated on the `child-argv-v1` capability read with
// `capSupported` (no evidence REFUSES), and its omission is journalled on the
// run exactly as `--route`'s is.
//
// The harness is `dispatch-route.test.ts`'s, trimmed: a direct `dispatchRun`
// over a real `CoordStore`, with one recording `Runner` shared by `runCcd` and
// `tmux` so every ccd call is observable in order.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP, CHILD_ARGV_CAP, ROUTE_ARGV_CAP, ROUTE_CAP } from '../src/ccdargv.js';
import { configDirFor } from '../src/config.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';
const OMITTED = 'child-omitted:no-child-argv-cap';

const seed = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const CLEAR_PANES = ['scrollback\n❯ \n', 'scrollback\n❯ /clear\n', 'scrollback\n❯ \n'];

function makeRunner(home: string, creates: string): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    if (verb === 'ws-add') { seed(home, creates); return { code: 0, stdout: '', stderr: '' }; }
    if (verb === 'capture-pane') {
      const p = CLEAR_PANES[Math.min(capIdx, CLEAR_PANES.length - 1)]!;
      capIdx++;
      return { code: 0, stdout: p, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

const WITH_CHILD = ['ws-add', 'ensure', 'ws-hold', ACTOR_FLAGS_CAP, ROUTE_ARGV_CAP, ROUTE_CAP, CHILD_ARGV_CAP];
const WITHOUT_CHILD = ['ws-add', 'ensure', 'ws-hold', ACTOR_FLAGS_CAP, ROUTE_ARGV_CAP, ROUTE_CAP];

interface HarnessCfg {
  /** `null` is "the agent sent no caps list at all" — no evidence. */
  ccdVerbs: string[] | null;
  kind?: 'work' | 'review';
  /** Bind the run to an existing session first: the resume arm. */
  sessionId?: string;
}

const harness = (cfg: HarnessCfg) => {
  const home = mkTmp('ccrc-dispatch-child-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  let reviews: number | null = null;
  if (cfg.kind === 'review') {
    const work = coord.openRun({ program: 'p', title: 'w', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'c' });
    if (!('id' in work)) throw new Error(`fixture openRun refused: ${JSON.stringify(work)}`);
    reviews = work.id;
  }
  const opened = coord.openRun({
    program: 'p', title: 't', project: PROJECT, wave: 1, waveOf: 2, claimedBy: 'c',
    ...(cfg.kind === 'review' ? { kind: 'review' as const, reviews } : {}),
  });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
  if (cfg.sessionId !== undefined) {
    seed(home, cfg.sessionId);
    coord.setSession(opened.id, cfg.sessionId);
  }
  const { run, calls } = makeRunner(home, 'demo-quiet-mesa');
  const base = testDeps(home, run);
  const deps: DispatchRunDeps = {
    ...base, coord,
    fleetState: { connected: true, downSince: null, ccdVerbs: cfg.ccdVerbs, rosterFp: null, build: null },
    configDir: (w: string) => configDirFor(base.cfg, w),
  };
  return {
    runId: opened.id, calls,
    dispatch: (route?: unknown) => dispatchRun(deps, opened.id, 'go', undefined, route),
    wsAdds: (): string[][] => calls.filter((c) => c[0] === 'ws-add'),
    events: (): string[] =>
      coord.runEvents(opened.id).map((e) => e.detail).filter((d): d is string => d !== null),
  };
};

describe('dispatch marks the workspace it mints as a child of the run (spec §5.1)', () => {
  it('with child-argv-v1: --child <run id> rides IMMEDIATELY after --no-rc, and nothing is journalled', async () => {
    const h = harness({ ccdVerbs: WITH_CHILD });
    expect(await h.dispatch()).toMatchObject({ ok: true });
    expect(h.wsAdds()).toEqual([
      ['ws-add', '--no-rc', '--child', String(h.runId), PROJECT, '--surface', 'agent', '--actor', `run:${h.runId} dispatch`],
    ]);
    expect(h.events()).not.toContain(OMITTED);
  });

  it('with --route too: the two declarations of WHAT the spawn is lead, then how it RUNS', async () => {
    const h = harness({ ccdVerbs: WITH_CHILD });
    expect(await h.dispatch({ class: 'opus' })).toMatchObject({ ok: true });
    expect(h.wsAdds()).toEqual([
      ['ws-add', '--no-rc', '--child', String(h.runId), '--route', 'class=opus', PROJECT,
       '--surface', 'agent', '--actor', `run:${h.runId} dispatch`],
    ]);
  });

  it('a REVIEW run is dispatched through the same arm, and its workspace is a child too', async () => {
    const h = harness({ ccdVerbs: WITH_CHILD, kind: 'review' });
    expect(await h.dispatch()).toMatchObject({ ok: true });
    expect(h.wsAdds()[0]!.slice(0, 4)).toEqual(['ws-add', '--no-rc', '--child', String(h.runId)]);
  });

  it('without the token: the argv is byte-identical to the pre-wave one, and the omission is journalled once', async () => {
    const h = harness({ ccdVerbs: WITHOUT_CHILD });
    expect(await h.dispatch()).toMatchObject({ ok: true });
    expect(h.wsAdds()).toEqual([
      ['ws-add', '--no-rc', PROJECT, '--surface', 'agent', '--actor', `run:${h.runId} dispatch`],
    ]);
    expect(h.events().filter((d) => d === OMITTED)).toHaveLength(1);
  });

  it('with NO caps list at all (no evidence): refused, exactly as an absent token — never PERMITTED', async () => {
    // `verbSupported` would permit here ("an absent list must never grey out
    // the fleet"). For a FLAG on a verb every box has, that default is the
    // D-410 wedge; `capSupported` is what refuses it.
    const h = harness({ ccdVerbs: null });
    await h.dispatch();
    const wsAdd = h.wsAdds()[0];
    expect(wsAdd, 'no ws-add call recorded').toBeDefined();
    expect(wsAdd).not.toContain('--child');
    expect(h.events()).toContain(OMITTED);
  });

  it('the RESUME arm mints nothing, so it neither sends --child nor journals an omission', async () => {
    const h = harness({ ccdVerbs: WITHOUT_CHILD, sessionId: 'demo-existing' });
    expect(await h.dispatch(), 'the resume arm must really have run').toMatchObject({ ok: true, resumed: true });
    expect(h.wsAdds()).toEqual([]);
    expect(h.events()).not.toContain(OMITTED);
  });
});
