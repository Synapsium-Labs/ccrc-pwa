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
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OVERLORD_AUTHORITY_BASENAME } from '../src/coord/overlordAuthority.js';
import { OverlordRestoreState } from '../src/coord/overlordRestoreState.js';
import type { WitnessTuple } from '../../shared/authorityWitness.js';
import { GEN1, GEN2, NOW, OPERATOR, S1, S2, designateLive, headRow, lastEntry, restoreRigHooks, rig, rung, type Rig } from './overlordRestoreRig.js';

restoreRigHooks();

const identity = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) });
const confirmRoute = (a: ReturnType<typeof app>) => a.inject({ method: 'POST', url: '/api/overlord/restore/confirm' });
const witnessRoute = (a: ReturnType<typeof app>, held: WitnessTuple | null) => a.inject({ method: 'POST', url: '/api/overlord/witness', payload: { held } });
async function offer(a: ReturnType<typeof app>): Promise<WitnessTuple> {
  const res = await witnessRoute(a, null);
  expect(res.statusCode).toBe(200);
  return res.json<{ offer: WitnessTuple }>().offer;
}

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
    restore: r === null ? undefined : new OverlordRestoreState({ db: r.db, journal: r.journal, guard: r.guard, witness: r.exchange }),
    exchange: r?.exchange,
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
    appendFileSync(path.join(r.dir, OVERLORD_AUTHORITY_BASENAME), 'not a record\n');
    r.restart();
    const before = r.lines();
    const stops: string[] = [];
    const res = await app(r, 'pass', [], stops).inject({ method: 'POST', url: '/api/overlord/restore/confirm' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'journal-unreadable', detail: expect.stringContaining('malformed') });
    expect(r.lines()).toEqual(before);
    expect(stops).toEqual([]);
  });

  it('keeps the narrowing told by a witness of a whole-volume rollback and raises the verified bound', async () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    expect(rung(r, 'chat', 'full')).toMatchObject({ ok: true, changed: true });
    const restore = r.snapshot(true);
    expect(rung(r, 'full', 'chat')).toMatchObject({ ok: true, changed: true });
    const held = await offer(app(r, 'pass', []));
    expect(held.told?.operatorRung).toBe('chat');
    restore();
    const a = app(r, 'pass', []);
    expect((await witnessRoute(a, held)).json()).toMatchObject({ error: 'authority-rolled-back', cause: 'witness-epoch' });
    expect(r.exchange.heldFor(held.authority!.sequence)).toBe('not-yet');
    const res = await confirmRoute(a);
    expect(res.statusCode).toBe(200);
    expect.soft(res.json()).toMatchObject({ ok: true, changed: true, epochAtConfirm: held.epoch + 1 });
    expect(lastEntry(r)).toMatchObject({ kind: 'authority-restore-confirmed', operatorRung: 'chat' });
  });

  it('withdraws boot confidence on Confirm, and a prior-boot witness at the new base lifts it only after restart', async () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const a = app(r, 'pass', []);
    const t = await offer(a);
    expect((await witnessRoute(a, { ...t, boot: 'prior-boot' })).statusCode).toBe(200);
    expect(r.exchange.noWitnessSinceBoot()).toBe('lifted');
    r.guard.writerFailed('trailing');
    const res = await confirmRoute(a);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, changed: true, epochAtConfirm: t.epoch + 1 });
    const current = await offer(a);
    expect(current.base).toBeGreaterThan(t.base);
    expect.soft(r.exchange.noWitnessSinceBoot()).toBe('standing');
    expect((await witnessRoute(a, { ...current, boot: 'prior-boot' })).statusCode).toBe(200);
    expect.soft(r.exchange.noWitnessSinceBoot()).toBe('standing');
    r.restart();
    expect((await witnessRoute(app(r, 'pass', []), current)).statusCode).toBe(200);
    expect(r.exchange.noWitnessSinceBoot()).toBe('lifted');
  });

  it('refuses a readable malformed history and keeps its bytes even with a measured high witness', async () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const a = app(r, 'pass', []);
    const t = await offer(a);
    const held = { ...t, epoch: t.epoch + 10, terms: { ...t.terms, authority: t.terms.authority + 10 }, highestIds: { restoreGeneration: 9 } };
    expect((await witnessRoute(a, held)).statusCode).toBe(503);
    expect(r.exchange.highest()).toEqual({ kind: 'measured', epoch: held.epoch, restoreGeneration: 9 });
    const leaf = path.join(r.dir, OVERLORD_AUTHORITY_BASENAME);
    appendFileSync(leaf, 'readable but not a record\n');
    const bytes = readFileSync(leaf);
    const head = headRow(r);
    const res = await confirmRoute(a);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'journal-unreadable', detail: expect.stringContaining('malformed') });
    expect(readFileSync(leaf)).toEqual(bytes);
    expect(headRow(r)).toEqual(head);
  });

  it('leaves an unreadable history unmeasured rather than treating it as malformed or absent', async () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const leaf = path.join(r.dir, OVERLORD_AUTHORITY_BASENAME);
    const bytes = readFileSync(leaf);
    const head = headRow(r);
    r.unreadable = true;
    r.guard.writerFailed('journal-unreadable');
    const a = app(r, 'pass', []);
    const res = await confirmRoute(a);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'journal-unreadable' });
    expect(res.json().detail).not.toContain('malformed');
    expect(r.guard.state()).toEqual({ kind: 'unmeasured', why: 'journal' });
    expect(readFileSync(leaf)).toEqual(bytes);
    expect(headRow(r)).toEqual(head);
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
