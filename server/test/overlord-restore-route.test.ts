// Overlord W1, authority journal plan Task 8 (PR C): Confirm the restore's two doors (`coord/overlordRoutes.ts`),
// `GET /api/overlord/restore` and `POST /api/overlord/restore/confirm`, over the real `OverlordRestoreState` on the shared fixture
// (`overlordRestoreRig.ts`). The account gate is a stand-in recording what each door asked; with sign-in dark the real gate
// answers `auth-off`, which the auth-gate sweep's FLAG_AWARE list pins for both doors.
import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { registerOverlordRoutes, type OverlordRouteDeps } from '../src/coord/overlordRoutes.js';
import { refuseRoute } from '../src/refuse.js';
import { designationRead, retire, stopDone } from '../src/coord/overlordDesignationStore.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { GEN1, GEN2, NOW, OPERATOR, S1, S2, designateLive, restoreRigHooks, rig, type Rig } from './overlordRestoreRig.js';

restoreRigHooks();

const identity = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) });

type Gate = 'pass' | 'step-up-required' | 'auth-off';
function app(r: Rig | null, gate: Gate, asks: unknown[], stops: string[] = []) {
  const a = Fastify();
  registerOverlordRoutes(a, {
    identity, coord: r === null ? {} : { stopDone: (id: string) => stopDone(r.db, id) }, facts: {}, journal: {},
    serial: async (f: () => unknown) => f(),
    gate: (_req: FastifyRequest, reply: FastifyReply, ask: unknown) => {
      asks.push(ask);
      if (gate === 'pass') return { pass: true, actor: gateActorOf('operator-a', '0123456789abcdef') };
      refuseRoute(reply, gate, { detail: gate });
      return { pass: false };
    },
    body: {
      keepAwake: async () => ({ ok: true, foreign: [] }), writeSet: async () => ({ ok: true }), clearProfile: async () => ({ ok: true }),
      stop: async (id: string) => { stops.push(id); return { ok: true, absent: false }; },
    },
    restore: r === null ? undefined : r.state,
    clock: { wall: () => 1_800_000_000_100 }, entropy: { hex: () => 'abcd', uuid: () => 'u' },
  } as unknown as OverlordRouteDeps);
  return a;
}

describe('GET /api/overlord/restore', () => {
  it('answers the guard\'s state behind the gate with no step-up', async () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    const asks: unknown[] = [];
    const res = await app(r, 'pass', asks).inject({ method: 'GET', url: '/api/overlord/restore' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, authority: { kind: 'rolled-back', cause: 'witness-epoch' } });
    expect(asks).toEqual([{ cap: null }]);
  });

  it('measures a guard left unmeasured by a transient read again before it answers (the guard\'s remeasure contract)', async () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.writerFailed('journal-unreadable');
    expect(r.guard.state().kind).toBe('unmeasured');
    const res = await app(r, 'pass', []).inject({ method: 'GET', url: '/api/overlord/restore' });
    expect(res.json()).toEqual({ ok: true, authority: { kind: 'coherent' } });
  });

  it('with sign-in dark the gate\'s auth-off stands, and with no authority journal the read is unavailable', async () => {
    expect((await app(null, 'auth-off', []).inject({ method: 'GET', url: '/api/overlord/restore' })).statusCode).toBe(501);
    const res = await app(null, 'pass', []).inject({ method: 'GET', url: '/api/overlord/restore' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'unavailable' });
  });
});

describe('POST /api/overlord/restore/confirm', () => {
  it('asks the gate for a step-up; without one it refuses step-up-required, and dark auth-off, writing nothing', async () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    const before = r.lines();
    const asks: unknown[] = [];
    const stepUp = await app(r, 'step-up-required', asks).inject({ method: 'POST', url: '/api/overlord/restore/confirm' });
    expect(stepUp.statusCode).toBe(403);
    expect(stepUp.json()).toMatchObject({ error: 'step-up-required' });
    expect(asks).toEqual([{ cap: null, stepUp: true }]);
    const dark = await app(r, 'auth-off', []).inject({ method: 'POST', url: '/api/overlord/restore/confirm' });
    expect(dark.statusCode).toBe(501);
    expect(r.lines()).toEqual(before);
    expect(r.guard.state().kind).toBe('rolled-back');
  });

  it('confirms behind the step-up, lifts the refusal, and a second call is changed: false', async () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    const a = app(r, 'pass', []);
    const res = await a.inject({ method: 'POST', url: '/api/overlord/restore/confirm' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, changed: true, binding: 'kept', term: 2, restoreGeneration: 1 });
    expect(r.guard.state()).toEqual({ kind: 'coherent' });
    expect((await a.inject({ method: 'POST', url: '/api/overlord/restore/confirm' })).json()).toEqual({ ok: true, changed: false });
    const read = await a.inject({ method: 'GET', url: '/api/overlord/restore' });
    expect(read.json()).toEqual({ ok: true, authority: { kind: 'coherent' } });
  });

  it('a malformed journal refuses journal-unreadable (503) with a fixed sentence, and writes nothing', async () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const { appendFileSync } = await import('node:fs');
    const path = (await import('node:path')).default;
    appendFileSync(path.join(r.dir, 'overlord-authority.jsonl'), 'not a record\n');
    r.restart();
    const before = r.lines();
    const stops: string[] = [];
    const res = await app(r, 'pass', [], stops).inject({ method: 'POST', url: '/api/overlord/restore/confirm' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'journal-unreadable', detail: expect.stringContaining('malformed') });
    expect(r.lines()).toEqual(before);
    expect(stops).toEqual([]);
  });

  it('the bodies a cleared binding names on either side have their owed stops drained once each, as the retire door drains one', async () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const restore = r.snapshot(false);
    expect(retire(r.db, r.journal, { actor: OPERATOR, at: NOW, opKey: 'retire-1' })).toMatchObject({ ok: true });
    designateLive(r, S2, GEN2);
    restore();
    const stops: string[] = [];
    const res = await app(r, 'pass', [], stops).inject({ method: 'POST', url: '/api/overlord/restore/confirm' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, changed: true, binding: 'cleared', newChain: false });
    // S2 is bound by the journal alone (review 3334 F4); S1 by the restored row.
    expect(stops).toEqual([S1, S2]);
    expect(res.json()).toMatchObject({ stopped: [S1, S2], owed: [] });
    const d = designationRead(r.db);
    expect(d.kind).toBe('not-designated');
    expect(d.kind !== 'unmeasured' && d.row?.stopsOwed).toEqual([]);
  });
});
