// §1.5. `dispatch.ts` used to return `fleetFailed` the instant `res.ok` was false
// — BEFORE the registry diff that would have discovered the workspace the killed
// `ws-add` had already created, before `coord.setSession`, before the hold. That
// single early return is what turned a slow spawn into an unclaimed workspace and
// a run stuck in `planned` with no `run_events` row at all.
//
// EVERY ARM OF THE GATE IS PINNED HERE OR THE GATE IS NOT PINNED. Adoption
// requires POSITIVE EVIDENCE that the candidate is the one THIS call created, and
// the two gates are what supply it: `cutShort` separates "this call's child was
// cut short in flight" from "ccd refused" (a `die` is exit 1, byte-identical
// without it), and `held` is fail-shut by construction (`registry.ts`: a
// listed-but-unreadable `.hold` reads as HELD) — a workspace a cut-short `ws-add`
// just created never carries one, while a live coordinated worker always does.
//
// §1.7 SPLIT THE FIRST GATE INTO THE TWO HALVES IT ALWAYS WAS. node sets `killed`
// only for a kill IT issued, so an EXTERNAL kill (operator, OOM reaper, systemd
// stopping the unit mid-`ws-add`) arrives `killed:false` with a `signal` — the
// same orphan, previously read as a clean refusal. And "the peer measured
// neither" (an older agent, the transport catch path) became `UNMEASURED` rather
// than collapsing into `false`: three answers, one of which — and only one —
// adopts. Every one of the three is pinned below.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import type { CcdResult } from '../src/lifecycle.js';
import { UNMEASURED } from '../src/exec.js';
import type { CcdArgv } from '../src/ccdargv.js';
import type { CcrcConfig } from '../src/config.js';
import { readRegistry } from '../src/registry.js';
import { localIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';

/** One registry row on disk. Lifted verbatim from `coord-abandon.test.ts`'s
 *  `seed`, plus the two fields this suite varies: `.hold` (present = held) and
 *  `.spawn` (`<epoch-seconds> <rc>`, ccd's own encoding — the FACT the verdict
 *  is derived from, never a word). */
const seedRow = (
  home: string, id: string, opts: { held?: string | null; spawnRc?: number | null } = {},
): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  if (opts.held != null) writeFileSync(path.join(reg, `${id}.hold`), opts.held);
  if (opts.spawnRc != null) {
    writeFileSync(path.join(reg, `${id}.spawn`), `${Math.floor(Date.now() / 1000)} ${opts.spawnRc}`);
  }
};

interface HarnessCfg {
  /** What the `ws-add` call answers. The cut-short measurement is the WHOLE
   *  POINT, and §1.7 made it TWO fields with THREE values each: `killed`
   *  `true`/`false`/`UNMEASURED`, `signal` a name/`null`/`UNMEASURED`. `signal`
   *  defaults to `UNMEASURED` so the pre-§1.7 cases in this file keep meaning
   *  exactly what they meant — "the peer told us about `killed` and nothing
   *  else". */
  ccd: Pick<CcdResult, 'ok' | 'stderr'> & Partial<Pick<CcdResult, 'killed' | 'signal'>>;
  /** Rows that appear in the registry AFTER the `ws-add` call — i.e. what the
   *  killed spawn left behind. Seeded lazily by the `runCcd` double, so the
   *  BEFORE read genuinely does not see them. */
  after?: readonly { id: string; held?: string | null; spawnRc?: number | null }[];
  /** Rows that exist BEFORE the dispatch (a pre-existing worker for the same
   *  project). Seeded eagerly. */
  before?: readonly { id: string; held?: string | null }[];
  /** `false` makes the AFTER read report the registry directory unlistable, so
   *  `readRegistryMeasured` answers `listed: false`. This is the ONE knob that
   *  needs an `io` override rather than a file on disk. */
  afterListed?: boolean;
}

const harness = async (cfg: HarnessCfg) => {
  const home = mkTmp('ccrc-dispatch-adopt-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  for (const r of cfg.before ?? []) seedRow(home, r.id, { held: r.held ?? null });

  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({
    program: 'build4', title: 'Fleet controls', project: PROJECT,
    wave: 1, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator',
  });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);

  const calls: string[][] = [];
  const runCcd = async (argv: CcdArgv): Promise<CcdResult> => {
    calls.push([...argv]);
    if (argv[0] === 'ws-add') {
      sawWsAdd = true;
      // The workspace appears NOW, after BEFORE was read — which is exactly
      // what a killed `ws-add` leaves: the pane and the row exist, the caller
      // never saw a success.
      for (const r of cfg.after ?? []) {
        seedRow(home, r.id, { held: r.held ?? null, spawnRc: r.spawnRc ?? null });
      }
      return {
        ok: cfg.ccd.ok, stdout: '', stderr: cfg.ccd.stderr,
        killed: cfg.ccd.killed ?? UNMEASURED,
        signal: cfg.ccd.signal === undefined ? UNMEASURED : cfg.ccd.signal,
      };
    }
    return { ok: true, stdout: '', stderr: '', killed: false, signal: null };
  };

  const base = testDeps(home, async () => ({ code: 0, stdout: '', stderr: '' }));
  // `listed: false` on the AFTER read only — BEFORE must succeed, or the test
  // proves nothing about the asymmetry. `sawWsAdd` flips when the double runs.
  let sawWsAdd = false;
  const io = cfg.afterListed === false
    ? { ...localIO, readdir: async (p: string) => (sawWsAdd ? null : localIO.readdir(p)) }
    : localIO;
  const deps: DispatchRunDeps = { ...base, io, coord, runCcd } as DispatchRunDeps;

  return {
    coord,
    homeDir: home,
    // The real `CcrcConfig` the deps were built from — the last case reads the
    // registry back through it rather than re-deriving `registryDir` by hand.
    cfg: base.cfg as CcrcConfig,
    runId: opened.id,
    ccdCalls: () => calls,
    // The brief is a STRING off the wire and `dispatchRun` validates it itself
    // (`typeof brief !== 'string'` -> `bad-request`, before the pause check and
    // long before any registry read) — an object here refuses every case in this
    // file for a reason none of them are about.
    dispatch: () => dispatchRun(deps, opened.id, 'go', undefined),
    cleanup: () => { rmSync(home, { recursive: true, force: true }); },
  };
};

describe('§1.5 — adoption, and everything that must NOT adopt', () => {
  it('ADOPTS a killed ws-add that created exactly ONE UNHELD workspace', async () => {
    const h = await harness({ ccd: { ok: false, killed: true, stderr: '' },
                              after: [{ id: 'demo-quiet-basin', held: null, spawnRc: 4 }] });
    const out = await h.dispatch();
    expect(out).toMatchObject({ ok: true, adopted: true, sessionId: 'demo-quiet-basin' });
    // The run is BOUND, the hold is PLACED, and the event says where this
    // workspace came from — its presence IS the record that it was adopted.
    expect(h.coord.run(h.runId)?.sessionId).toBe('demo-quiet-basin');
    expect(h.ccdCalls()).toContainEqual(
      expect.arrayContaining(['ws-hold', '--session', 'demo-quiet-basin']));
    expect(h.coord.runEvents(h.runId).map((e) => e.detail)).toContain('spawn-adopted:expired');
  });

  it('returns the spawn verdict so the coordinator knows the pane may not be ready', async () => {
    // `ok` is no longer proof the pane is ready, and that is the whole reason the
    // field exists rather than being inferred at the far end.
    const h = await harness({ ccd: { ok: false, killed: true, stderr: '' },
                              after: [{ id: 'demo-quiet-basin', held: null, spawnRc: 5 }] });
    expect(await h.dispatch()).toMatchObject({ adopted: true, spawnState: 'blocked' });
  });

  it('a CLEAN non-zero exit NEVER adopts, whatever the candidate count', async () => {
    // ccd REFUSED. There is nothing here this call created. BOTH halves measured,
    // both negative — the only shape that means "it really did just refuse".
    const h = await harness({ ccd: { ok: false, killed: false, signal: null, stderr: 'disk floor' },
                              after: [{ id: 'demo-quiet-basin', held: null }] });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'fleetFailed', stderr: 'disk floor' });
    expect(h.ccdCalls().some((a) => a[0] === 'ws-hold')).toBe(false);
  });

  it('an UNMEASURED result from the TRANSPORT catch path never adopts', async () => {
    // `createRunner`'s catch returns `{code:1, stderr: e.message}` with NEITHER
    // half for a dropped socket or a client-side wait expiry. Three facts sit on
    // code 1, not two, and not-adopting is the safe outcome for all three.
    //
    // §1.7: this case reaches the gate as `UNMEASURED`, NOT as `false`. The
    // outcome is deliberately identical — only a literal `true` adopts — but the
    // REASON is now sayable, which is the whole point: "we did not measure" and
    // "we measured, and it was not cut short" are not the same sentence.
    const h = await harness({ ccd: { ok: false, stderr: 'socket closed' },
                              after: [{ id: 'demo-quiet-basin', held: null }] });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'fleetFailed', stderr: 'socket closed' });
    expect(h.ccdCalls().some((a) => a[0] === 'ws-hold')).toBe(false);
  });

  it('ADOPTS on an EXTERNAL kill — killed:false with a SIGNAL is still cut short', async () => {
    // §1.7's reason to exist. An operator `kill`, an OOM reaper or systemd
    // stopping the unit mid-`ws-add` leaves node's `killed` FALSE (node did not
    // do it) and the signal name as the only evidence. The orphan is identical to
    // a deadline kill's: worktree, branch and every registry row written before
    // `_spawn` blocked. Reading only `killed` filed this under "ccd refused" and
    // left the workspace unclaimed.
    const h = await harness({ ccd: { ok: false, killed: false, signal: 'SIGKILL', stderr: '' },
                              after: [{ id: 'demo-quiet-basin', held: null, spawnRc: 4 }] });
    expect(await h.dispatch()).toMatchObject({ ok: true, adopted: true, sessionId: 'demo-quiet-basin' });
    expect(h.ccdCalls()).toContainEqual(
      expect.arrayContaining(['ws-hold', '--session', 'demo-quiet-basin']));
  });

  it('an external kill still needs an UNHELD candidate — the second gate is unchanged', async () => {
    const h = await harness({ ccd: { ok: false, killed: false, signal: 'SIGKILL', stderr: '' },
                              after: [{ id: 'demo-quiet-basin', held: 'program:x wave:1/3' }] });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'fleetFailed', stderr: '' });
    expect(h.ccdCalls().some((a) => a[0] === 'ws-hold')).toBe(false);
  });

  it('a MEASURED signal:null with an UNMEASURED killed never adopts', async () => {
    // The mixed shape `local` mode produces for a plain non-zero exit once
    // `realRunner` reports what it holds. Half-measured is not measured-cut-short,
    // and the gate must not treat "one half says no, the other said nothing" as
    // evidence of anything.
    const h = await harness({ ccd: { ok: false, signal: null, stderr: 'disk floor' },
                              after: [{ id: 'demo-quiet-basin', held: null }] });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'fleetFailed', stderr: 'disk floor' });
  });

  it('ZERO candidates still fails — a kill proves nothing was left behind', async () => {
    const h = await harness({ ccd: { ok: false, killed: true, stderr: '' }, after: [] });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'fleetFailed', stderr: '' });
  });

  it('TWO candidates is still ambiguous-dispatch — nothing claimed on a guess', async () => {
    const h = await harness({ ccd: { ok: false, killed: true, stderr: '' },
                              after: [{ id: 'demo-quiet-basin', held: null },
                                      { id: 'demo-still-cove', held: null }] });
    expect(await h.dispatch()).toEqual(
      { ok: false, kind: 'refused', code: 'ambiguous-dispatch', candidates: 2 });
  });

  it('ONE candidate that ALREADY CARRIES A HOLD refuses — that is a live worker', async () => {
    // Fail-shut by construction: a listed-but-unreadable `.hold` reads as HELD, so
    // "we could not read the hold" lands here too.
    const h = await harness({ ccd: { ok: false, killed: true, stderr: '' },
                              after: [{ id: 'demo-quiet-basin', held: 'program:x wave:1/3' }] });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'fleetFailed', stderr: '' });
    expect(h.ccdCalls().some((a) => a[0] === 'ws-hold')).toBe(false);
  });

  it('the CLEAN success path is untouched and reports adopted: false', async () => {
    const h = await harness({ ccd: { ok: true, killed: false, stderr: '' },
                              after: [{ id: 'demo-quiet-basin', held: null }] });
    expect(await h.dispatch()).toMatchObject({ ok: true, adopted: false });
  });

  it('a degraded AFTER read still refuses registry-unmeasurable on the adoption path', async () => {
    // The AFTER diff answers "is this NEW", and that question must never guess —
    // on the adoption path least of all, because a false-new makes the count 1 and
    // WOULD BE ADOPTED.
    const h = await harness({ ccd: { ok: false, killed: true, stderr: '' }, afterListed: false });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'registry-unmeasurable' });
  });
});

describe('§1.2 — the OTHER polarity: a ws-add that FAILED CLEANLY inside its budget', () => {
  // THE CASE THE SPEC ORDERS VERIFIED END TO END, and it is not the adoption
  // case. Task 6 gives the settle rc 3/4/5, Task 7 keeps #50's non-zero
  // `ws-add` exit on all three — so a settle that expires INSIDE the agent's
  // 300 s ceiling produces `res.ok === false` with the child exiting NORMALLY:
  // `killed === false` AND `signal === null`, both measured. The gate above
  // refuses. That refusal is CORRECT and stays: a clean non-zero is ccd telling
  // us something, and adopting on it would bind a run to a workspace no evidence
  // ties to this call.
  //
  // THE RULING, so nobody "fixes" this later: DO NOT widen the gate to read
  // `$REG/<id>.spawn` as positive evidence. The spawn fact is written by the
  // settle for ANY spawn on that id, including one from a previous attempt or
  // another process — it says how a spawn ended, never which caller owns it.
  // `cutShort` — abnormal termination of THIS call's child, by either half of
  // the measurement — is the only fact that means "this call's child was cut
  // short", and §1.7 widened it to `signal` precisely because that is the SAME
  // fact, not a second one.
  //
  // What the refusal must NOT be is INVISIBLE, and these tests pin that it is
  // not: the workspace ccd created is claimed, supervised, and carries a spawn
  // fact — so it renders on the fleet screen as an ordinary session with the
  // §1.6b spawn chip lit, and the run's own event trail names it.

  it('refuses, and the workspace it leaves behind is an ORDINARY session, not residue', async () => {
    const h = await harness({ ccd: { ok: false, killed: false, signal: null, stderr: 'ccd: start failed for demo-quiet-basin (spawn rc 4)' },
                              after: [{ id: 'demo-quiet-basin', held: null, spawnRc: 4 }] });
    const out = await h.dispatch();
    expect(out).toMatchObject({ ok: false, kind: 'fleetFailed' });
    // The run stays PLANNED and is bound to nothing — the operator resolves it.
    expect(h.coord.run(h.runId)?.state).toBe('planned');
    expect(h.coord.run(h.runId)?.sessionId).toBeNull();
    // And NO hold was placed on a workspace this run does not own.
    expect(h.ccdCalls().some((a) => a[0] === 'ws-hold')).toBe(false);
  });

  it('records the leftover on the run so it is nameable — this is what stops it being invisible', async () => {
    // Without this row, the operator sees a run stuck in `planned` and a
    // workspace on the fleet screen with no stated relationship between them.
    // The event does not CLAIM the workspace (that would be adoption by
    // another name) — it records what ccd reported and which ids appeared.
    const h = await harness({ ccd: { ok: false, killed: false, signal: null, stderr: 'spawn rc 4' },
                              after: [{ id: 'demo-quiet-basin', held: null, spawnRc: 4 }] });
    await h.dispatch();
    const details = h.coord.runEvents(h.runId).map((e) => e.detail);
    expect(details.some((d) => d?.startsWith('dispatch-refused:'))).toBe(true);
    expect(details.join(' ')).toContain('demo-quiet-basin');
  });

  it('and the leftover is VISIBLE: started, unheld, with a spawn fact the chip reads', async () => {
    // `assembleFleet` (Task 103) puts `started` and `spawnState` on the wire and
    // SessionLine (Task 104) renders `unconfirmed` for rc 4 — so this row is a
    // normal session carrying a quiet warning, not a shape no verb can name.
    // Asserted here on the REGISTRY, because that is what this suite can see;
    // the wire half is pinned in fleet-lifecycle.test.ts and session-line.test.tsx.
    const h = await harness({ ccd: { ok: false, killed: false, signal: null, stderr: 'spawn rc 4' },
                              after: [{ id: 'demo-quiet-basin', held: null, spawnRc: 4 }] });
    await h.dispatch();
    const rows = await readRegistry(localIO, h.cfg);
    const row = rows.find((r) => r.id === 'demo-quiet-basin');
    expect(row?.started).toBe(true);
    expect(row?.held).toBeNull();
    expect(row?.spawn?.rc).toBe(4);
  });
});
