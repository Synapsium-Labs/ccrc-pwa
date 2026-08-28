// program-leverage wave 2 (F2), spec section 4 item 1
// (`docs/superpowers/plans/2026-08-28-program-leverage-wave2-f2.md`).
//
// A dispatch now MEASURES whether the worker it just bound has the ccrc-worker
// skill installed on the home it is running from, and says so on its own
// response. Two properties are load-bearing and each is pinned here:
//
//   ABSENCE-PERMITS — the preflight never refuses. An `absent` dispatch is a
//   real dispatch whose worker will read a brief without its standing protocol;
//   refusing instead would trade a degraded wave for no wave at all.
//
//   ABSENT IS NOT UNMEASURABLE — one is evidence about the fleet, the other an
//   admission about the measurement. A coordinator acts on them differently, so
//   they must never arrive as the same value.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import type { CcdResult } from '../src/lifecycle.js';
import type { CcdArgv } from '../src/ccdargv.js';
import { configDirFor } from '../src/config.js';
import { localIO } from '../src/io.js';
import { degradedReadIO } from './ioDoubles.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';
const NEW_ID = 'demo-quiet-basin';

/** The registry-row field set every dispatch fixture writes. Lifted from
 *  `dispatch-adopt.test.ts`'s `seedRow`, which owns the canonical copy — if that
 *  one drifts, this one is wrong. */
const seedRow = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

interface Cfg {
  /** Plant a real SKILL.md in the wrapper's config dir. */
  installed: boolean;
  /** Force the SKILL.md read to fail (the remote-fleet shape: a dropped round trip). */
  degraded?: boolean;
  /** Model a wrapper this box's roster does not carry — `configDirFor` answers
   *  undefined, so no read is ever issued. */
  unrostered?: boolean;
}

const harness = async (cfg: Cfg) => {
  const home = mkTmp('ccrc-dispatch-skill-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });

  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({
    program: 'program-leverage', title: 'F2', project: PROJECT,
    wave: 1, waveOf: 8, claimedBy: 'ccrc-pwa-coordinator',
  });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);

  const runCcd = async (argv: CcdArgv): Promise<CcdResult> => {
    if (argv[0] === 'ws-add') seedRow(home, NEW_ID);
    return { ok: true, stdout: '', stderr: '', killed: false, signal: null };
  };

  const base = testDeps(home, async () => ({ code: 0, stdout: '', stderr: '' }));
  const conf = base.cfg;

  // The fixture roster maps wrapper `claude` to suffix `.claude`, and NOTHING in
  // the fixture creates that directory — so `present` has to be planted by hand
  // and `absent` is what an untouched fixture home honestly reports.
  if (cfg.installed) {
    const dir = path.join(configDirFor(conf, 'claude')!, 'skills', 'ccrc-worker');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: ccrc-worker\n---\n');
  }

  const io = cfg.degraded === true
    ? degradedReadIO((p) => p.endsWith(path.join('ccrc-worker', 'SKILL.md')))
    : localIO;

  const deps = {
    ...base, io, coord, runCcd,
    configDir: cfg.unrostered === true
      ? (): string | undefined => undefined
      : (w: string): string | undefined => configDirFor(conf, w),
  } as DispatchRunDeps;

  return {
    coord, runId: opened.id,
    dispatch: () => dispatchRun(deps, opened.id, 'go', undefined),
    details: (): (string | null)[] => coord.runEvents(opened.id).map((e) => e.detail),
  };
};

describe('the dispatch preflight measures the worker skill and never refuses', () => {
  it('reports present when the installer has run on that home', async () => {
    const h = await harness({ installed: true });
    expect(await h.dispatch()).toMatchObject({ ok: true, skillState: 'present' });
  });

  it('reports absent, and STILL DISPATCHES, when the home has no skill', async () => {
    // Absence-permits, stated as an assertion: the run advanced, the brief was
    // queued, and the only thing that changed is that the coordinator now knows.
    const h = await harness({ installed: false });
    expect(await h.dispatch()).toMatchObject({
      ok: true, skillState: 'absent', briefQueued: true, sessionId: NEW_ID,
    });
  });

  it('reports unmeasurable, distinctly from absent, when the read FAILED', async () => {
    const h = await harness({ installed: true, degraded: true });
    expect(await h.dispatch()).toMatchObject({ ok: true, skillState: 'unmeasurable' });
  });

  it('reports unmeasurable when this box roster does not carry the wrapper', async () => {
    // `configDirFor` answers undefined for an unrostered wrapper — a deployment
    // gap the roster is read once at boot to fix, not a read that failed and not
    // a skill that is missing. No file was consulted, so `absent` would be a
    // claim about a home nothing ever looked at.
    const h = await harness({ installed: true, unrostered: true });
    expect(await h.dispatch()).toMatchObject({ ok: true, skillState: 'unmeasurable' });
  });

  it('records the measurement on the run trail, on every one of the three answers', async () => {
    // On ALL THREE, not just the interesting two: if the row were written only
    // for absent/unmeasurable, the ABSENCE of a row would mean either `present`
    // or "an older build with no preflight" — a second overloaded null, one
    // layer down from the one this field exists to delete.
    for (const [cfg, expected] of [
      [{ installed: true }, 'skill-preflight:present'],
      [{ installed: false }, 'skill-preflight:absent'],
      [{ installed: true, degraded: true }, 'skill-preflight:unmeasurable'],
    ] as const) {
      const h = await harness(cfg);
      await h.dispatch();
      expect(h.details(), JSON.stringify(cfg)).toContain(expected);
    }
  });

  it('never CALLS the configDir port when there is no wrapper to map', async () => {
    // The resume arm tolerates a session whose registry row is absent from a
    // listable registry — the "honest stale" case it proceeds past on purpose.
    // There is then no wrapper at all, and the preflight must not invent one.
    //
    // Pinning the CALL, not just the answer, is deliberate: today
    // `configDirFor(cfg, '')` happens to miss (no account id can be empty), so
    // a mutant passing `wrapper ?? ''` returns undefined too and is
    // behaviourally equivalent — MEASURED, it survived. What it would stop
    // being is safe the moment `configDirFor` grows any fallback, and
    // `idHomeWrapper` already has one (`roster.upstreamId`) for a neighbouring
    // question. So the invariant is that the port is never consulted about a
    // wrapper we do not have.
    const home = mkTmp('ccrc-dispatch-skill-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({
      program: 'program-leverage', title: 'F2 resume', project: PROJECT,
      wave: 2, waveOf: 8, claimedBy: 'ccrc-pwa-coordinator',
    });
    if (!('id' in opened)) throw new Error('fixture openRun refused');
    // Bind a session that has NO registry row — the resume arm's tolerated case.
    coord.setSession(opened.id, 'demo-ghost-session');

    const base = testDeps(home, async () => ({ code: 0, stdout: '', stderr: '' }));
    const asked: string[] = [];
    const deps = {
      ...base, io: localIO, coord,
      runCcd: async (): Promise<CcdResult> =>
        ({ ok: true, stdout: '', stderr: '', killed: false, signal: null }),
      configDir: (w: string): string | undefined => {
        asked.push(w);
        return configDirFor(base.cfg, w);
      },
    } as DispatchRunDeps;

    const out = await dispatchRun(deps, opened.id, 'go', undefined);
    expect(out).toMatchObject({ ok: true, skillState: 'unmeasurable' });
    expect(asked, 'the preflight asked the roster about a wrapper it never had').toEqual([]);
  });

  it('writes the preflight row with the state the run already rests in', async () => {
    // The row is written AFTER the commit, so its toState is `dispatched` and
    // the push tag it mints (`run-<id>-dispatched`) is the transition row's own.
    // Written BEFORE the commit it would carry `planned` and push a
    // notification naming a state the run has already left —
    // `recordRunEvent`'s own docstring warns about exactly that.
    const h = await harness({ installed: true });
    await h.dispatch();
    const pre = h.coord.runEvents(h.runId).find((e) => e.detail?.startsWith('skill-preflight:'));
    expect(pre, 'no skill-preflight row was written').toBeDefined();
    expect(pre!.toState).toBe('dispatched');
    expect(pre!.fromState).toBe('dispatched');
  });
});
