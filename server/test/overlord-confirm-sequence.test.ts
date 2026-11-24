// Confirm uses the real authority journal and guard; the sequence tables and the rows share the Confirm transaction.
import { describe, expect, it } from 'vitest';
import { insertStart, mintGeneration } from '../src/continuity/continuityStore.js';
import { designatePending, designationRead, retire } from '../src/coord/overlordDesignationStore.js';
import { GEN1, NOW, OPERATOR, S1, S2, confirm, designateLive, headRow, lastEntry, restoreRigHooks, rig, type Rig } from './overlordRestoreRig.js';

restoreRigHooks();

function restoreBeforeRetire(withPending = false): { r: Rig; generationId: number } {
  const r = rig();
  const start = insertStart(r.db, {
    sessionId: S1, reportId: 'report-a', uuid: GEN1, source: 'startup', model: null, rowIncarnation: null, reportedAt: NOW, receivedAt: NOW,
  });
  if (!start.ok) throw new Error('could not record the fixture start');
  const minted = mintGeneration(r.db, {
    identity: S1, sessionId: S1, role: 'worker', term: 0, rowIncarnation: null, startId: start.id, startReportedAt: NOW,
    resumed: false, model: null, lane: 'lane-a', host: null, outcome: 'renewed', mono: 1, proc: 'p', now: NOW,
  }, null, false);
  if (!minted.ok) throw new Error('could not mint the fixture generation');
  designateLive(r, S1, GEN1);
  if (withPending) {
    // The rebind writer is outside PR A; stage its pending columns before taking the fixture snapshot.
    r.db.prepare("UPDATE overlord_designation SET pendingId = ?, pendingKind = 'rebind', pendingSince = ?, pendingDeadlineAt = ?, "
      + 'pendingActor = actor, pendingActorKind = actorKind, pendingActorIssuer = actorIssuer, pendingActorStrength = actorStrength WHERE id = 1')
      .run(S2, NOW, NOW + 60_000);
  }
  const restore = r.snapshot(false);
  expect(retire(r.db, r.journal, { actor: OPERATOR, at: NOW, opKey: 'retire-a' })).toMatchObject({ ok: true, changed: true });
  restore();
  expect(designationRead(r.db)).toMatchObject({ kind: 'designated', sessionId: S1 });
  return { r, generationId: minted.id };
}

const lines = (r: Rig) => r.db.prepare('SELECT kind, id, state, actor, actorKind, at FROM overlord_sequence ORDER BY seq').all();
const generations = (r: Rig) => r.db.prepare('SELECT id, state, outcome, walk, deadlineAt, shadowDeadlineAt FROM continuity_generations ORDER BY id').all();

describe('Confirm stamps the restored designation transaction', () => {
  it('ends the generation and stamps the binding that Confirm clears, at the same time and in that order', () => {
    const { r, generationId } = restoreBeforeRetire();
    const before = lines(r);
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, binding: 'cleared' });
    expect(designationRead(r.db).kind).toBe('not-designated');
    expect(lines(r)).toEqual([...before,
      { kind: 'generation', id: String(generationId), state: 'ended', actor: 'server', actorKind: 'server', at: NOW + 1 },
      { kind: 'designation', id: S1, state: 'retired', actor: OPERATOR.subject, actorKind: OPERATOR.kind, at: NOW + 1 },
    ]);
  });

  it('stamps a cancelled pending attempt as failed before retiring the binding', () => {
    const { r, generationId } = restoreBeforeRetire(true);
    expect(designationRead(r.db)).toMatchObject({ kind: 'designated', row: { pending: { sessionId: S2 } } });
    const before = lines(r);
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, binding: 'cleared' });
    expect(designationRead(r.db)).toMatchObject({ kind: 'not-designated', row: { pending: null, lastAttempt: { sessionId: S2, outcome: 'retired' } } });
    expect(lines(r)).toEqual([...before,
      { kind: 'generation', id: String(generationId), state: 'ended', actor: 'server', actorKind: 'server', at: NOW + 1 },
      { kind: 'designation', id: S2, state: 'failed', actor: OPERATOR.subject, actorKind: OPERATOR.kind, at: NOW + 1 },
      { kind: 'designation', id: S1, state: 'retired', actor: OPERATOR.subject, actorKind: OPERATOR.kind, at: NOW + 1 },
    ]);
  });

  it('stamps a pending-only attempt as retired when Confirm clears it', () => {
    const r = rig();
    expect(designatePending(r.db, r.journal, {
      sessionId: S2, deadlineAt: NOW + 60_000, model: 'opus', accountPools: { pools: [], untagged: false },
      actor: OPERATOR, at: NOW, opKey: 'pending-only',
    })).toEqual({ ok: true, changed: true });
    r.guard.witnessRefused('witness-epoch');
    const before = lines(r);
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, binding: 'cleared' });
    expect(designationRead(r.db)).toMatchObject({ kind: 'not-designated', row: { pending: null, lastAttempt: { sessionId: S2, outcome: 'retired' } } });
    expect(lines(r)).toEqual([...before,
      { kind: 'designation', id: S2, state: 'retired', actor: OPERATOR.subject, actorKind: OPERATOR.kind, at: NOW + 1 },
    ]);
  });

  it('does not stamp a designation retirement when Confirm keeps the binding', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    const before = lines(r);
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, binding: 'kept' });
    expect(lines(r)).toEqual(before);
  });

  it.each([false, true])('a refused Confirm stamp rolls back and fences with pending attempt = %s', (withPending) => {
    const { r } = restoreBeforeRetire(withPending);
    // Match the running-server boundary: the journal is trailing, but the in-memory guard has not seen it yet.
    r.guard.confirmed();
    expect(r.guard.state()).toEqual({ kind: 'coherent' });
    const before = { lines: lines(r), generations: generations(r), designation: designationRead(r.db), head: headRow(r), records: r.lines() };
    r.db.exec(`CREATE TEMP TRIGGER fail_confirm_stamp BEFORE INSERT ON overlord_sequence
      WHEN NEW.kind = 'designation' AND NEW.state = 'retired'
      BEGIN SELECT RAISE(ABORT, 'fixture refuses the retired line'); END`);
    expect(confirm(r)).toMatchObject({ ok: false, refusal: 'journal-unwritable', detail: expect.stringContaining('after the append') });
    expect(lines(r)).toEqual(before.lines);
    expect(generations(r)).toEqual(before.generations);
    expect(designationRead(r.db)).toEqual(before.designation);
    expect(headRow(r)).toEqual(before.head);
    expect(r.lines()).toEqual([...before.records, expect.any(String)]);
    expect(lastEntry(r)).toMatchObject({ kind: 'authority-restore-confirmed', binding: { kind: 'cleared' } });
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'trailing' });
    expect(r.offers).toBe(0);
  });
});
