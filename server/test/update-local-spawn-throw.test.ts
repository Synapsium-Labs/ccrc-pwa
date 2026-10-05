// Fix round 1, item 9 — a SYNCHRONOUS throw from the server-role spawn (the argv builder's RangeError, a relative or
// trailing-slash HOME) is a HALTING `spawn-failed` naming the throw: a fault of this server that will not mend itself. Only
// the throw BEFORE `run` is called halts; a REJECTED promise from the runner — reached only by an error `spawn()` throws
// synchronously inside the runner's executor (E2BIG, ENOMEM, or an invalid argument such as ERR_INVALID_ARG_VALUE — the
// last is not an errno) — stays non-halting transport `other`, the request standing (residue R6, review 176 F2: the
// premise this file pinned before — that a transient spawn errno such as EAGAIN lands there — was wrong; EAGAIN, EMFILE,
// ENFILE, EACCES and ENOENT arrive as the child's `error` event instead, which the bounded runner answers as code 1
// `could not start the launcher (<code>)`, a HALTING `spawn-failed`).
import { describe, expect, it } from 'vitest';
import { runDispatch, localUpdateSpawnFor } from '../src/update/converge.js';
import { boundedUpdateSpawn } from '../src/update/spawn.js';
import { T0, SERVER_ID, TAG, harness, ran, seedServer } from './updateKilledHarness.js';
import { spawnFromRunner } from './updateSpawnFake.js';
import { itLinux } from './platformFixtures.js';

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

  it('a REJECTED promise from the runner — reached only by an error spawn() throws synchronously — stays non-halting transport `other`: idle, the request standing', async () => {
    const h = harness({});
    h.deps.runLocal = () => Promise.reject(Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG', syscall: 'spawn' }));
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({
      nodeId: SERVER_ID, result: 'released', to: 'idle', detail: 'other — spawn E2BIG; the request stands',
    });
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', requestedTag: TAG });
    const next = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(next.plan.gate.haltedBy).toEqual([]);
  });

  // Premise cases (F2's premise, review 176): pin what the REAL runner does, over the REAL contained `boundedUpdateSpawn`.
  // Nothing runs in either case: a missing launcher file never starts, and an argv too large for `execve` never execs.
  it('premise (a): a missing launcher file never starts — the child\'s `error` event answers ENOENT, and runDispatch HALTS the row', async () => {
    const result = await boundedUpdateSpawn('/nonexistent-ccrc-launcher', [], { env: { PATH: '/nonexistent' } });
    expect(result).toEqual({ code: 1, stdout: '', stderr: 'could not start the launcher (ENOENT)', killed: false, pid: null });

    const h = harness({});
    h.deps.runLocal = () => boundedUpdateSpawn('/nonexistent-ccrc-launcher', [], { env: { PATH: '/nonexistent' } });
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'released', to: 'failed' });
    expect((r.outcome as { detail: string }).detail).toBe('spawn-failed — could not start the launcher (ENOENT)');
    const next = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(next.plan.gate.haltedBy).toEqual([SERVER_ID]);
  });

  // PLATFORM-ONLY: stating only what was measured (fix round 1, review 178 F2 — the plan's own Task 4 Step 2
  // contingency). Measured `test-macos 1/2`, run 36552172708: on macOS the promise RESOLVES instead of
  // rejecting, `{ code: 1, stderr: 'could not start the launcher (ENOENT)' }`. The cause was not measured
  // there (wave 9, R7b: the earlier guess about `/usr/bin/true` is dropped, it was never measured), so the case
  // stays Linux-only.
  itLinux('premise (b): only the synchronous arm rejects — a 3 MiB single argument throws E2BIG before anything execs', async () => {
    await expect(boundedUpdateSpawn('/bin/true', ['x'.repeat(3 * 1024 * 1024)], { env: { PATH: '/nonexistent' } }))
      .rejects.toMatchObject({ code: 'E2BIG' });
  });
});
