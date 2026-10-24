// ARCH-35 (GitHub #556): the order `closeRun`'s gates run in, measured through the function itself.
//
// WRITTEN GREEN ON THE OLD CODE, before `decideClose` existed, so the extraction that follows moves no gate: each row
// builds ONE input that trips two adjacent gates together and names the EARLIER one as the answer, and says what the
// fleet saw (the verbs sent) so a gate that slid past an act turns red too. A pair that no single input can trip
// together is bridged in the row that names it. The decider's own table (`close-decide.test.ts`) repeats the rows
// against `decideClose`; this file keeps them against the whole function, so a reorder in either place turns a row red.
//
// Every fleet here is a fixture HOME with a stub runner: nothing touches a live host.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { closeRun, type CloseRunDeps, type SweepCloseGuard } from '../src/coord/close.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const W = 'demo-quiet-basin';
const CRASHED = 'demo-coord-crashed';
const HEIR = 'demo-coord-heir';
const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function fixture(opts: { failCcd?: boolean; verbs?: string[] } = {}) {
  const home = mkTmp('ccrc-close-order-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    return opts.failCcd ? { code: 1, stdout: '', stderr: 'boom' } : { code: 0, stdout: '', stderr: '' };
  };
  const base = testDeps(home, run);
  const deps: CloseRunDeps = {
    coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
    ...(opts.verbs === undefined ? {} : { fleetState: { ccdVerbs: opts.verbs } as never }),
  };
  const seed = (session: string): void => {
    const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${session}`,
      uuid: `u-${session}`, started: '1', workspace: session, branch: `ws/${session}`, base: 'origin/main' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${session}.${k}`), v);
  };
  /** A work run claimed by the crashed coordinator, dispatched into `W` (no child mark) and working. */
  const working = (over: { wave?: number } = {}): number => {
    const r = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: over.wave ?? 1, waveOf: 3, claimedBy: CRASHED });
    if (!('id' in r)) throw new Error('openRun refused');
    coord.markDispatched(r.id, W, W, `ws/${W}`, false);
    for (const to of ['dispatched', 'working'] as const) expect(coord.advance(r.id, to, 'coordinator').ok).toBe(true);
    seed(W);
    return r.id;
  };
  const planned = (): number => {
    const r = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 3, claimedBy: CRASHED });
    if (!('id' in r)) throw new Error('openRun refused');
    return r.id;
  };
  return { home, reg, coord, deps, calls, working, planned, verbs: () => calls.map((c) => c[0]), seed };
}

const fp = (over: Record<string, unknown> = {}) => ({ branchTip: SHA, prNumber: null, prPhase: 'none', handoffCommit: SHA, ...over });
/** A close body that skips `verifyDone` (D-49): a failed close, with a well-formed fingerprint. */
const failedBody = (over: Record<string, unknown> = {}) => ({ fingerprint: fp(), final: true, state: 'failed', ...over });
const STILL: SweepCloseGuard = { claimedBy: CRASHED, stillCrashed: async () => null };

describe('closeRun runs its gates in a fixed order (ARCH-35): the request', () => {
  it('a missing run is unknown-run', async () => {
    const f = fixture();
    expect(await closeRun(f.deps, 9999, {}, 'coordinator')).toEqual({ ok: false, kind: 'unknown-run' });
    expect(f.calls).toEqual([]);
  });

  it('an unreadable row answers hold-invalid, ahead of the body (EXCLUSIVE with a missing row)', async () => {
    const f = fixture();
    const stub = { ...f.deps, coord: { run: () => ({ ok: false as const, detail: 'wave: not representable' }) } };
    expect(await closeRun(stub as unknown as CloseRunDeps, 1, { intent: 'abandon', final: true }, 'operator'))
      .toEqual({ ok: false, kind: 'hold-invalid', detail: 'wave: not representable' });
  });

  it('the row, then the mixed abandon shape: a missing run with an abandon-plus-claim body is unknown-run', async () => {
    const f = fixture();
    expect(await closeRun(f.deps, 9999, { intent: 'abandon', final: true }, 'operator')).toEqual({ ok: false, kind: 'unknown-run' });
  });

  it('the mixed abandon shape, then the abandon move: an abandon carrying a claim on a closing run is bad-request', async () => {
    const f = fixture();
    const id = f.working();
    expect(f.coord.advance(id, 'closing', 'coordinator').ok).toBe(true);
    expect(await closeRun(f.deps, id, { intent: 'abandon', state: 'failed' }, 'operator')).toEqual({ ok: false, kind: 'bad-request' });
    expect(f.calls).toEqual([]);
  });

  it('the sweep word with a non-abandon body is bad-request, ahead of the work close’s own gates', async () => {
    const f = fixture();
    const id = f.planned();
    expect(await closeRun(f.deps, id, failedBody(), 'sweep', STILL)).toEqual({ ok: false, kind: 'bad-request' });
  });

  it('a planned run with no session: not-dispatched, ahead of the body (bad-session is EXCLUSIVE with it)', async () => {
    const f = fixture();
    const id = f.planned();
    expect(await closeRun(f.deps, id, {}, 'coordinator')).toEqual({ ok: false, kind: 'refused', code: 'not-dispatched' });
  });

  it('a stored session id that is no registry id: bad-session, ahead of bad-transition and the body', async () => {
    const f = fixture();
    const id = f.planned();
    // `planned` cannot reach `closing`, so a transition gate would trip together with it.
    f.coord.db.prepare("UPDATE runs SET sessionId = 'a/b' WHERE id = ?").run(id);
    expect(await closeRun(f.deps, id, {}, 'coordinator')).toEqual({ ok: false, kind: 'bad-session' });
    expect(f.calls).toEqual([]);
  });

  it('bad-transition, ahead of bad-request: a done run closed again with an invalid body', async () => {
    const f = fixture();
    const id = f.working();
    for (const to of ['closing', 'done'] as const) expect(f.coord.advance(id, to, 'coordinator').ok).toBe(true);
    expect(await closeRun(f.deps, id, {}, 'coordinator')).toEqual({ ok: false, kind: 'bad-transition', from: 'done', to: 'closing' });
    expect(f.calls).toEqual([]);
  });

  it('bad-request on each malformed field, before anything is measured', async () => {
    const f = fixture();
    const id = f.working();
    for (const body of [null, {}, { fingerprint: fp(), final: 'yes' }, { fingerprint: fp(), final: true, state: 'x' },
      { fingerprint: fp(), final: true, archive: 'y' }, { fingerprint: fp({ prNumber: '3' }), final: true },
      { fingerprint: fp({ branchTip: 1 }), final: true }]) {
      expect(await closeRun(f.deps, id, body, 'coordinator'), JSON.stringify(body)).toEqual({ ok: false, kind: 'bad-request' });
    }
    expect(f.calls).toEqual([]);
  });
});

describe('closeRun’s work close: the measurement, the hold, the ledger, the verb, the act', () => {
  it('doneVerdict, ahead of the sibling read: a claim whose commit is not its tip is refused and mailed back, with no verb', async () => {
    const f = fixture();
    const id = f.working();
    (f.coord as unknown as { openRunsForSession: unknown }).openRunsForSession = () => ({ ok: false, detail: 'siblings' });
    const out = await closeRun(f.deps, id, { fingerprint: fp({ handoffCommit: OTHER_SHA }), final: true }, 'coordinator');
    expect(out).toMatchObject({ ok: false, kind: 'doneVerdict', code: 'no-handoff-commit' });
    expect(f.calls).toEqual([]);
    expect(okRun(f.coord.run(id))!.state).toBe('working');
  });

  it('hold-invalid on the sibling read, ahead of the hold verdict and the ledger', async () => {
    const f = fixture();
    const id = f.working();
    (f.coord as unknown as { openRunsForSession: unknown }).openRunsForSession = () => ({ ok: false, detail: 'siblings: unreadable' });
    expect(await closeRun(f.deps, id, failedBody(), 'coordinator')).toEqual({ ok: false, kind: 'hold-invalid', detail: 'siblings: unreadable' });
    expect(f.calls).toEqual([]);
  });

  it('the hold verdict, ahead of the ledger: an unrepresentable next hold refuses before `.prhistory` is read', async () => {
    const f = fixture();
    const rec = f.coord.reconstruct({
      ledger: { slug: 'bad program', title: 'Recovered', waves: [{ wave: 1, of: 2, handoffCommit: null }] },
      registry: { sessionId: W, project: 'demo', workspace: W, branch: `ws/${W}`, held: 'legacy hold' },
      prHistory: [],
    })[0]!;
    f.seed(W);
    // A non-final close needs a next hold; the reconstructed programme slug cannot spell one. The ledger is a
    // directory, so reading it would refuse `prhistory-unreadable` if the hold gate did not stop it first.
    mkdirSync(path.join(f.reg, `${W}.prhistory`));
    f.coord.db.prepare("UPDATE runs SET state = 'working' WHERE id = ?").run(rec.id);
    const out = await closeRun(f.deps, rec.id, failedBody({ final: false }), 'coordinator');
    expect(out).toMatchObject({ ok: false, kind: 'hold-invalid' });
    expect(f.calls).toEqual([]);
  });

  it('prhistory-unreadable, ahead of the verb check and the fleet act', async () => {
    const f = fixture({ verbs: [] });
    const id = f.working();
    mkdirSync(path.join(f.reg, `${W}.prhistory`));
    expect(await closeRun(f.deps, id, failedBody(), 'coordinator')).toEqual({ ok: false, kind: 'refused', code: 'prhistory-unreadable' });
    expect(f.calls).toEqual([]);
  });

  it('unsupported, ahead of the fleet act: a box that lists no verbs is refused with no call', async () => {
    const f = fixture({ failCcd: true, verbs: [] });
    const id = f.working();
    expect(await closeRun(f.deps, id, failedBody(), 'coordinator')).toEqual({ ok: false, kind: 'unsupported' });
    expect(f.calls).toEqual([]);
  });

  it('fleetFailed leaves the run exactly where it was (D-48): no transition after a refused release', async () => {
    const f = fixture({ failCcd: true });
    const id = f.working();
    expect(await closeRun(f.deps, id, failedBody(), 'coordinator')).toEqual({ ok: false, kind: 'fleetFailed', stderr: 'boom' });
    expect(f.verbs()).toEqual(['ws-release']);
    expect(okRun(f.coord.run(id))!.state).toBe('working');
  });

  it('the acts: a final close releases; a non-final close holds for the next wave; a failed archive close archives', async () => {
    const a = fixture();
    const ida = a.working();
    expect(await closeRun(a.deps, ida, failedBody(), 'coordinator')).toMatchObject({ ok: true, state: 'failed', released: true });
    expect(a.verbs()).toEqual(['ws-release']);
    const b = fixture();
    const idb = b.working();
    expect(await closeRun(b.deps, idb, failedBody({ final: false }), 'coordinator')).toMatchObject({ ok: true, released: false });
    expect(b.verbs()).toEqual(['ws-hold']);
    const c = fixture();
    const idc = c.working();
    expect(await closeRun(c.deps, idc, failedBody({ archive: true }), 'coordinator')).toMatchObject({ ok: true, released: false });
    expect(c.verbs()).toEqual(['ws-archive']);
  });

  it('a sibling on the workspace turns a final release into a hand-over hold with the survivor’s reason', async () => {
    const f = fixture();
    const id = f.working();
    const s = f.coord.openRun({ program: 'q', title: 'q', project: 'demo', wave: 1, waveOf: 2, claimedBy: HEIR });
    if (!('id' in s)) throw new Error('openRun refused');
    f.coord.markDispatched(s.id, W, W, `ws/${W}`, false);
    for (const to of ['dispatched', 'working'] as const) expect(f.coord.advance(s.id, to, 'coordinator').ok).toBe(true);
    expect(await closeRun(f.deps, id, failedBody({ archive: true }), 'coordinator')).toMatchObject({ ok: true, released: false });
    expect(f.verbs(), 'the archive is refused by the sibling, the claim is handed over').toEqual(['ws-hold']);
  });
});

describe('closeRun’s abandon arm', () => {
  it('bad-transition, ahead of every read: a run already closing', async () => {
    const f = fixture();
    const id = f.working();
    expect(f.coord.advance(id, 'closing', 'coordinator').ok).toBe(true);
    expect(await closeRun(f.deps, id, { intent: 'abandon' }, 'operator')).toEqual({ ok: false, kind: 'bad-transition', from: 'closing', to: 'closing' });
    expect(f.calls).toEqual([]);
  });

  it('a stored id no verb may name: closed failed with no fleet act, one run event, the sweep’s gate first', async () => {
    const f = fixture();
    const id = f.planned();
    f.coord.db.prepare("UPDATE runs SET sessionId = 'a/b' WHERE id = ?").run(id);
    const revived: SweepCloseGuard = { claimedBy: CRASHED, stillCrashed: async () => ({ kind: 'remeasured', why: 'alive' }) };
    expect(await closeRun(f.deps, id, { intent: 'abandon' }, 'sweep', revived))
      .toEqual({ ok: false, kind: 'sweep-stopped', stop: { kind: 'remeasured', why: 'alive' }, fleetAct: null });
    expect(await closeRun(f.deps, id, { intent: 'abandon' }, 'operator'))
      .toEqual({ ok: true, id, state: 'failed', released: false, childReclaim: 'not-queued', childReclaimWhy: 'marker-unreadable' });
    expect(f.coord.runEvents(id).map((e) => e.detail ?? '')).toContain('fleet-act-omitted:bad-session');
    expect(f.calls).toEqual([]);
  });

  it('hold-invalid on the sibling read, ahead of the child gate and the verb', async () => {
    const f = fixture();
    const id = f.working();
    (f.coord as unknown as { openRunsForSession: unknown }).openRunsForSession = () => ({ ok: false, detail: 'siblings: unreadable' });
    expect(await closeRun(f.deps, id, { intent: 'abandon' }, 'operator')).toEqual({ ok: false, kind: 'hold-invalid', detail: 'siblings: unreadable' });
    expect(f.calls).toEqual([]);
  });

  it('unsupported, ahead of the sweep’s gate: a box with no verbs and a revived claimant answers unsupported', async () => {
    const f = fixture({ verbs: [] });
    const id = f.working();
    let asked = 0;
    const revived: SweepCloseGuard = { claimedBy: CRASHED, stillCrashed: async () => { asked += 1; return { kind: 'remeasured', why: 'alive' }; } };
    expect(await closeRun(f.deps, id, { intent: 'abandon' }, 'sweep', revived)).toEqual({ ok: false, kind: 'unsupported' });
    expect(asked).toBe(0);
  });

  it('sweep-stopped, ahead of claimant-changed: a revived claimant that is also no longer the claimant', async () => {
    const f = fixture();
    const id = f.working();
    expect(f.coord.reclaimProgram(id, HEIR, 1, null)).toMatchObject({ ok: true });
    const revived: SweepCloseGuard = { claimedBy: CRASHED, stillCrashed: async () => ({ kind: 'remeasured', why: 'alive' }) };
    expect(await closeRun(f.deps, id, { intent: 'abandon' }, 'sweep', revived))
      .toEqual({ ok: false, kind: 'sweep-stopped', stop: { kind: 'remeasured', why: 'alive' }, fleetAct: null });
    expect(f.calls).toEqual([]);
  });

  it('fleetFailed, ahead of the re-measure after the act: a release that failed never asks it again', async () => {
    const f = fixture({ failCcd: true });
    const id = f.working();
    let asked = 0;
    const guard: SweepCloseGuard = { claimedBy: CRASHED, stillCrashed: async () => { asked += 1; return null; } };
    expect(await closeRun(f.deps, id, { intent: 'abandon' }, 'sweep', guard)).toEqual({ ok: false, kind: 'fleetFailed', stderr: 'boom' });
    expect(asked, 'once, before the act').toBe(1);
    expect(okRun(f.coord.run(id))!.state).toBe('working');
  });

  it('the re-measure after the act, ahead of the commit’s claimant check: both trip, sweep-stopped wins and names the act', async () => {
    const f = fixture();
    const id = f.working();
    let n = 0;
    const guard: SweepCloseGuard = { claimedBy: CRASHED, stillCrashed: async () => {
      n += 1;
      if (n === 1) return null;
      expect(f.coord.reclaimProgram(id, HEIR, 1, null)).toMatchObject({ ok: true });
      return { kind: 'remeasured', why: 'alive' };
    } };
    expect(await closeRun(f.deps, id, { intent: 'abandon' }, 'sweep', guard))
      .toEqual({ ok: false, kind: 'sweep-stopped', stop: { kind: 'remeasured', why: 'alive' }, fleetAct: 'released' });
    expect(okRun(f.coord.run(id))!.state).toBe('working');
  });
});
