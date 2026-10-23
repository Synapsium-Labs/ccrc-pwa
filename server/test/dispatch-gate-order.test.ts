// ARCH-22 (GitHub #553): the order `dispatchRun`'s gates run in, measured through the function itself.
//
// WRITTEN GREEN ON THE OLD CODE, before `decideDispatch` existed, so the extraction that follows moves no gate:
// each row builds ONE input that trips two adjacent gates together and names the EARLIER one as the answer. A pair
// that no single input can trip together (the empty brief and the oversize brief; the unreadable row and the missing
// one) is listed in `EXCLUSIVE_PAIRS` with the reason and bridged to the next gate instead. The decider's own table
// (`dispatch-decide.test.ts`) repeats the rows against `decideDispatch`; this file keeps them against the whole
// function, so a reorder in either place turns a row red.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, type DispatchOutcome, type DispatchRunDeps } from '../src/coord/dispatch.js';
import { COORDINATOR_PAUSE_MARKER, MAIL_DISABLED_MARKER } from '../src/coord/rundefs.js';
import type { Runner } from '../src/exec.js';
import { configDirFor } from '../src/config.js';
import { MAIL_BODY_MAX_BYTES } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';

function fixture() {
  const home = mkTmp('ccrc-gate-order-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => { calls.push(args); return { code: 0, stdout: '', stderr: '' }; };
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps: DispatchRunDeps = {
    coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd, tmux: base.tmux, queue: base.queue,
    configDir: (w: string) => configDirFor(base.cfg, w), turnVerdict: async () => 'idle' as const,
  };
  const open = (): number => {
    const o = coord.openRun({ program: 'p', title: 't', project: PROJECT, wave: 1, waveOf: 2, claimedBy: 'c' });
    if (!('id' in o)) throw new Error(`fixture openRun refused: ${JSON.stringify(o)}`);
    return o.id;
  };
  const mark = (name: string): void => writeFileSync(path.join(reg, name), '');
  return { coord, deps, open, calls, mark };
}

const BAD_SESSION = 'a/b';

/** A planned run whose hold cannot be written (a reconstructed row with an unrepresentable programme slug). */
function badHoldRun(f: ReturnType<typeof fixture>): number {
  const rec = f.coord.reconstruct({
    ledger: { slug: 'bad program', title: 'Recovered', waves: [{ wave: 1, of: 1, handoffCommit: null }] },
    registry: { sessionId: 'demo-recovered', project: PROJECT, workspace: 'recovered', branch: 'ws/recovered', held: 'legacy hold' },
    prHistory: [],
  })[0]!;
  f.coord.db.prepare("UPDATE runs SET state = 'planned' WHERE id = ?").run(rec.id);
  return rec.id;
}

describe('dispatchRun runs its gates in a fixed order (ARCH-22)', () => {
  it('a missing run is unknown-run', async () => {
    const f = fixture();
    expect(await dispatchRun(f.deps, 9999, 'go', undefined)).toEqual({ ok: false, kind: 'unknown-run' });
    expect(f.calls).toEqual([]);
  });

  it('unreadable row: EXCLUSIVE with a missing row, answers hold-invalid', async () => {
    const f = fixture();
    const stub = { ...f.deps, coord: { run: () => ({ ok: false as const, detail: 'wave: not representable' }) } };
    expect(await dispatchRun(stub as unknown as DispatchRunDeps, 1, 'go', undefined))
      .toEqual({ ok: false, kind: 'hold-invalid', detail: 'wave: not representable' });
  });

  it('transition, then brief: a dispatched run with an empty brief answers bad-transition', async () => {
    const f = fixture();
    const id = f.open();
    f.coord.db.prepare("UPDATE runs SET state = 'dispatched' WHERE id = ?").run(id);
    expect(await dispatchRun(f.deps, id, '', undefined))
      .toEqual({ ok: false, kind: 'bad-transition', from: 'dispatched', to: 'dispatched' });
  });

  it('brief, then oversize: EXCLUSIVE (an empty brief cannot be over the cap), bridged by a non-string brief and bad items', async () => {
    const f = fixture();
    expect(await dispatchRun(f.deps, f.open(), 42, ['ok', 7])).toEqual({ ok: false, kind: 'bad-request' });
  });

  it('oversize, then items: an oversize brief with bad items answers oversize', async () => {
    const f = fixture();
    const out = await dispatchRun(f.deps, f.open(), 'x'.repeat(MAIL_BODY_MAX_BYTES), [7]);
    expect(out).toMatchObject({ ok: false, kind: 'oversize', limit: MAIL_BODY_MAX_BYTES });
  });

  it('items, then route: bad items with a bad route answer bad-request with no detail', async () => {
    const f = fixture();
    expect(await dispatchRun(f.deps, f.open(), 'go', [7], { nonsense: 'x' })).toEqual({ ok: false, kind: 'bad-request' });
  });

  it('route, then slug: a bad route with a bad slug answers the route detail', async () => {
    const f = fixture();
    const out = await dispatchRun(f.deps, f.open(), 'go', undefined, { nonsense: 'x' }, 'Bad Slug!');
    expect(out).toMatchObject({ ok: false, kind: 'bad-request' });
    expect((out as { detail?: string }).detail).toMatch(/^route: /);
  });

  it('slug, then hold: a bad slug on a run with an invalid hold answers the slug detail', async () => {
    const f = fixture();
    const id = badHoldRun(f);
    f.coord.db.prepare("UPDATE runs SET sessionId = NULL WHERE id = ?").run(id);
    const out = await dispatchRun(f.deps, id, 'go', undefined, undefined, 'Bad Slug!');
    expect(out).toMatchObject({ ok: false, kind: 'bad-request' });
    expect((out as { detail?: string }).detail).toMatch(/^slug: must match /);
  });

  it('hold, then session: a run with an invalid hold and a bad stored session answers hold-invalid', async () => {
    const f = fixture();
    const id = badHoldRun(f);
    f.coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(BAD_SESSION, id);
    expect(await dispatchRun(f.deps, id, 'go', undefined)).toMatchObject({ ok: false, kind: 'hold-invalid' });
  });

  it('session, then pause: a bad stored session with the pause marker answers bad-session', async () => {
    const f = fixture();
    const id = f.open();
    f.coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(BAD_SESSION, id);
    f.mark(COORDINATOR_PAUSE_MARKER);
    expect(await dispatchRun(f.deps, id, 'go', undefined)).toEqual({ ok: false, kind: 'bad-session' });
    expect(f.calls).toEqual([]);
  });

  it('pause, then mail-disabled: both markers answer paused', async () => {
    const f = fixture();
    f.mark(COORDINATOR_PAUSE_MARKER);
    f.mark(MAIL_DISABLED_MARKER);
    expect(await dispatchRun(f.deps, f.open(), 'go', undefined)).toEqual({ ok: false, kind: 'refused', code: 'paused' });
  });

  it('mail-disabled, then caps: the marker with a cap at zero answers mail-disabled', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 0, maxSessionsPerDay: 0 });
    f.mark(MAIL_DISABLED_MARKER);
    expect(await dispatchRun(f.deps, f.open(), 'go', undefined)).toEqual({ ok: false, kind: 'refused', code: 'mail-disabled' });
  });

  it('concurrency cap, then daily cap: both at zero answers cap-concurrency', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 0, maxSessionsPerDay: 0 });
    const out: DispatchOutcome = await dispatchRun(f.deps, f.open(), 'go', undefined);
    expect(out).toMatchObject({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 0, running: 0 });
    expect(f.calls).toEqual([]);
  });

  it('daily cap alone answers cap-daily', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 5, maxSessionsPerDay: 0 });
    expect(await dispatchRun(f.deps, f.open(), 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-daily', limit: 0, used: 0 });
  });
});
