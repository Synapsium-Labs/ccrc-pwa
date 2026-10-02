// `registerCoordRoutes`' handle (workspace lifecycle spec §5.2): the coordination serialiser with the operator abandon
// inside it, handed to a door registered outside `coord/routes.ts`. The archive door's `{programme:'end'}` is its first
// caller.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import Fastify from 'fastify';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const setup = () => {
  const home = mkTmp('ccrc-handle-');
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => { calls.push(args); return { code: 0, stdout: '', stderr: '' }; };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps = { ...testDeps(home, run), coord };
  const app = Fastify();
  const handle = registerCoordRoutes(app, deps, new Bus(), undefined,
    { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null });
  const opened = coord.openRun({ program: 'lifecycle', title: 'T', project: 'demo', wave: 1, waveOf: 2,
    claimedBy: 'demo-coordinator' });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  return { app, handle, coord, calls, id: opened.id };
};

describe('CoordRoutesHandle', () => {
  it('the abandon it hands over closes a run failed, as the OPERATOR — the abandon route\'s own decision', async () => {
    const { app, handle, coord, id } = setup();
    expect(await handle.withAbandon(coord, (abandon) => abandon(id))).toMatchObject({ ok: true, id, state: 'failed' });
    expect(okRun(coord.run(id))!.state).toBe('failed');
    const ev = coord.db.prepare('SELECT causedBy FROM run_events WHERE runId = ? ORDER BY id DESC LIMIT 1').get(id) as
      { causedBy: string };
    expect(ev.causedBy).toBe('operator');
    await app.close();
  });

  it('a run already `closing`, or in a state with no edges, refuses the abandon — and nothing reaches the box', async () => {
    const { app, handle, coord, calls, id } = setup();
    coord.setSession(id, 'demo-worker');
    for (const state of ['closing', 'unknown'] as const) {
      coord.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(state, id);
      expect(await handle.withAbandon(coord, (abandon) => abandon(id)))
        .toEqual({ ok: false, kind: 'bad-transition', from: state, to: 'closing' });
    }
    expect(calls).toEqual([]);
    await app.close();
  });

  it('hands over the arm\'s own pre-read too: what the abandon would refuse from the row alone, asked WITHOUT acting', async () => {
    const { app, handle, coord, calls, id } = setup();
    expect(await handle.withAbandon(coord, async (_abandon, refusalOf) => [refusalOf(id), refusalOf(id + 99)]))
      .toEqual([null, { ok: false, kind: 'unknown-run' }]);
    coord.setSession(id, 'demo-worker');
    coord.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run('closing', id);
    const closing = { ok: false, kind: 'bad-transition', from: 'closing', to: 'closing' };
    // The SAME answer the abandon itself gives — one rule (`abandonMove`), two readers.
    expect(await handle.withAbandon(coord, async (abandon, refusalOf) => [refusalOf(id), await abandon(id)]))
      .toEqual([closing, closing]);
    expect(okRun(coord.run(id))!.state).toBe('closing');
    expect(calls).toEqual([]);
    await app.close();
  });

  it('withAbandon holds the routes\' OWN mutex — an abandon that arrives while it is held waits for it', async () => {
    const { app, handle, coord, id } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const order: string[] = [];
    const held = handle.withAbandon(coord, async () => { order.push('held'); await gate; order.push('released'); });
    const abandoned = app.inject({ method: 'POST', url: `/api/runs/${id}/abandon` })
      .then((r) => { order.push('abandon'); return r; });
    await new Promise((r) => setTimeout(r, 60));
    expect(order).toEqual(['held']);
    release();
    await held;
    expect((await abandoned).json()).toMatchObject({ ok: true, id, state: 'failed' });
    expect(order).toEqual(['held', 'released', 'abandon']);
    await app.close();
  });
});
