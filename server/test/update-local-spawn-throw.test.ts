// Fix round 1, item 9 — a SYNCHRONOUS throw from the server-role spawn (the argv builder's RangeError, a relative or
// trailing-slash HOME) is a HALTING `spawn-failed` naming the throw: a fault of this server that will not mend itself. Only
// the throw BEFORE `run` is called halts; a rejected promise from the runner (where a transient spawn error lands) stays
// non-halting transport `other`, the request standing.
import { describe, expect, it } from 'vitest';
import { runDispatch, localUpdateSpawnFor } from '../src/update/converge.js';
import { T0, SERVER_ID, TAG, harness, ran, seedServer } from './updateKilledHarness.js';
import { spawnFromRunner } from './updateSpawnFake.js';

describe('item 9: a SYNCHRONOUS throw from the local spawn halts; a rejected promise does not', () => {
  it.each([['a relative HOME', 'relative/home'], ['a trailing-slash HOME', '/tmp/somewhere/']])(
    '%s: localUpdateSpawnFor throws before anything runs → a halting spawn-failed naming the throw, the row failed', async (_n, badHome) => {
      const h = harness({});
      h.deps.runLocal = localUpdateSpawnFor(badHome);
      seedServer(h);
      const r = ran(await runDispatch(h.deps, T0 + 1000));
      const detail = 'spawn-failed — updateLauncherPath: home must be absolute with no trailing slash';
      expect(r.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'released', to: 'failed' });
      expect((r.outcome as { detail: string }).detail.startsWith(detail)).toBe(true);
      expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'failed', requestedTag: TAG });
      expect(h.store.node(SERVER_ID)!.updateDetail!.startsWith(detail)).toBe(true);
      // It halts: the next plan reads the halted row and moves nobody.
      const next = ran(await runDispatch(h.deps, T0 + 61_000));
      expect(next.plan.gate.haltedBy).toEqual([SERVER_ID]);
      expect(next.outcome).toBeNull();
    });

  it('the throw is not the spawn gate\'s: a following run after a mended HOME spawns (nothing is left in the `spawning` set)', async () => {
    const h = harness({});
    h.deps.runLocal = localUpdateSpawnFor('relative/home');
    seedServer(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    expect(h.store.ackNode(SERVER_ID).ok).toBe(true);   // ack clears the halt AND the request
    expect(h.store.requestNode(SERVER_ID, TAG, 'update', T0 + 2000).ok).toBe(true);
    h.deps.runLocal = spawnFromRunner(async () => ({ code: 0, stdout: '', stderr: '' }), h.home);
    const r = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(r.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
  });

  it('a REJECTED promise from the runner stays non-halting transport `other`: idle, the request standing, the words the runner threw', async () => {
    const h = harness({});
    h.deps.runLocal = () => Promise.reject(new Error('spawn EAGAIN: resource temporarily unavailable'));
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({
      nodeId: SERVER_ID, result: 'released', to: 'idle', detail: 'other — spawn EAGAIN: resource temporarily unavailable; the request stands',
    });
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', requestedTag: TAG });
    const next = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(next.plan.gate.haltedBy).toEqual([]);
  });
});
