// Overlord W1 authority journal plan, Task 6 (PR B, L4): the witness exchange (`coord/overlordAuthorityExchange.ts`). Real authority
// journal and guard over a fixture directory under the per-run temp root, never the live HOME; the agent link and the privacy port
// are fakes. The expected words are written out here, never read from the code the cases judge.
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { MIGRATIONS } from '../src/coord/schema.js';
import { tx } from '../src/coord/tx.js';
import type { OverlordAuthorityMove } from '../src/coord/overlordAuthority.js';
import { OverlordAuthorityJournal, overlordAuthorityFileAt } from '../src/coord/overlordAuthorityJournal.js';
import { OverlordAuthorityGuard, runOverlordAuthorityBoot } from '../src/coord/overlordAuthorityGuard.js';
import { OverlordAuthorityExchange, type ExchangeAnswer } from '../src/coord/overlordAuthorityExchange.js';
import type { WitnessLink, WitnessLinkAnswer } from '../src/coord/overlordAuthorityWitnessLink.js';
import type { HostRelation } from '../src/coord/overlordAuthorityWitness.js';
import { PRIVACY_HEAD_UNWIRED, type PrivacyHeadRead } from '../src/coord/privacyJournalHead.js';
import type { ReadyWitness } from '../../shared/agent-protocol.js';
import type { WitnessTuple } from '../../shared/authorityWitness.js';
import { fakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => removeTmpFixtures());

const find = (needle: string): string => MIGRATIONS.find((sql) => sql.includes(needle))!;
const WIDEN: OverlordAuthorityMove = { kind: 'authority-rung', opKey: 'op-w', from: 'advise', to: 'full' };
const NARROW: OverlordAuthorityMove = { kind: 'authority-rung', opKey: 'op-n', from: 'full', to: 'advise' };
const BOOT = 'boot-now';
const OLD = 'boot-old';
const D = (c: string): string => c.repeat(64);

interface Rig {
  db: DatabaseSync; journal: OverlordAuthorityJournal; guard: OverlordAuthorityGuard; ex: OverlordAuthorityExchange;
  warns: string[]; privacy: { now: PrivacyHeadRead };
  agent: { held: ReadyWitness | undefined; host: HostRelation; sends: WitnessTuple[]; next: (o: WitnessTuple) => Promise<WitnessLinkAnswer> };
  append(m: OverlordAuthorityMove): void;
  offer(): WitnessTuple;
  /** The server's own offer, as a witness from `boot` that holds `over` instead. */
  held(over: Partial<WitnessTuple>, boot?: string): WitnessTuple;
}

function rig(opts: { agent?: boolean } = {}): Rig {
  const dir = mkTmp('ccrc-overlord-exchange-');
  const db = new DatabaseSync(path.join(dir, 'coord.db'));
  for (const n of ['CREATE TABLE overlord_authority_head', 'CREATE TABLE overlord_designation', 'CREATE TABLE overlord_ladder', 'CREATE TABLE decision_rows']) db.exec(find(n));
  let journal!: OverlordAuthorityJournal;
  const port = { healTornTail: () => journal.healTornTail(db), measure: () => journal.measure(db) };
  const guard = new OverlordAuthorityGuard(port);
  journal = new OverlordAuthorityJournal(overlordAuthorityFileAt(dir), { clock: fakeTime({ wallMs: Date.parse('2026-11-16T10:00:00.000Z') }).ports.clock }, guard);
  runOverlordAuthorityBoot(port, guard, () => {});
  const warns: string[] = [];
  const privacy = { now: PRIVACY_HEAD_UNWIRED.read() as PrivacyHeadRead };
  const agent: Rig['agent'] = { held: undefined, host: 'other-host', sends: [], next: async () => ({ kind: 'no-op' }) };
  const link: WitnessLink = { send: (o) => { agent.sends.push(o); return agent.next(o); } };
  const ex = new OverlordAuthorityExchange({
    journal, guard, privacy: { read: () => privacy.now }, boot: BOOT, relationOf: () => agent.host, warn: (l) => warns.push(l),
    agent: opts.agent === false ? null : { held: () => agent.held, link },
  });
  const offer = (): WitnessTuple => {
    const a = ex.exchangeConsole('probe', null);
    if (a.kind !== 'offer') throw new Error(`no offer: ${a.why}`);
    return a.tuple;
  };
  return {
    db, journal, guard, ex, warns, privacy, agent, offer,
    append: (m) => { const a = tx(db, () => journal.appendInTx(db, m)); if (!a.ok) throw new Error(a.detail); },
    held: (over, boot = OLD) => ({ ...offer(), boot, ...over }),
  };
}
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));
const answered = (tuple: WitnessTuple | null): WitnessLinkAnswer => ({ kind: 'answered', answer: { kind: 'held', tuple } });
/** A witness one record ahead of the server's authority journal. */
const ahead = (r: Rig): WitnessTuple => {
  const o = r.offer();
  return { ...o, boot: OLD, epoch: o.epoch + 1, terms: { ...o.terms, authority: o.terms.authority + 1 } };
};

describe('an agent', () => {
  it('whose ready tuple holds a higher epoch puts the guard in rolled-back: witness-epoch', async () => {
    const r = rig();
    r.append(WIDEN);
    r.agent.held = { kind: 'tuple', tuple: ahead(r) };
    await r.ex.exchangeAgent();
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
  });
  it('whose answer to the offer holds a higher epoch does the same', async () => {
    const r = rig();
    r.append(WIDEN);
    r.agent.held = { kind: 'nothing' };
    r.agent.next = async () => answered(ahead(r));
    await r.ex.exchangeAgent();
    expect(r.agent.sends).toHaveLength(1);
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
  });
  it('on the same host, or unmeasured, never lifts noWitnessSinceBoot', async () => {
    for (const host of ['same-host', 'unmeasured'] as const) {
      const r = rig();
      r.append(WIDEN);
      r.agent.host = host;
      r.agent.held = { kind: 'tuple', tuple: r.held({}) };
      await r.ex.exchangeAgent();
      expect(r.guard.state()).toEqual({ kind: 'coherent' });
      expect(r.ex.noWitnessSinceBoot()).toBe('standing');
    }
  });
  it('on another host, from an earlier boot, lifts it', async () => {
    const r = rig();
    r.append(WIDEN);
    r.agent.held = { kind: 'tuple', tuple: r.held({}) };
    await r.ex.exchangeAgent();
    expect(r.ex.noWitnessSinceBoot()).toBe('lifted');
  });
  it('that is older (no field, no op) changes nothing', async () => {
    const r = rig();
    r.append(WIDEN);
    r.agent.held = { kind: 'absent' };
    r.agent.next = async () => ({ kind: 'no-op' });
    await r.ex.exchangeAgent();
    expect(r.guard.state()).toEqual({ kind: 'coherent' });
    expect(r.ex.noWitnessSinceBoot()).toBe('standing');
    expect(r.warns).toEqual([]);
  });
  it('keeps its last answer when the op is lost, unsent, malformed or predates the op', async () => {
    const r = rig();
    r.append(WIDEN);
    r.agent.held = { kind: 'tuple', tuple: r.held({}) };
    for (const a of [{ kind: 'lost', why: 'timeout' }, { kind: 'unsent' }, { kind: 'malformed' }, { kind: 'predates-op' }] as WitnessLinkAnswer[]) {
      r.agent.next = async () => a;
      await r.ex.exchangeAgent();
      expect(r.ex.noWitnessSinceBoot()).toBe('lifted');
    }
  });
  it('answers unmeasured to the op: judged as malformed, one warn line per change, no refusal and no count', async () => {
    const r = rig();
    r.agent.held = { kind: 'nothing' };
    r.agent.next = async () => ({ kind: 'answered', answer: { kind: 'unmeasured', why: 'unreadable' } });
    await r.ex.exchangeAgent();
    await r.ex.exchangeAgent();
    expect(r.warns).toHaveLength(1);
    expect(r.guard.state()).toEqual({ kind: 'coherent' });
    expect(r.ex.noWitnessSinceBoot()).toBe('standing');
  });
  it('in local mode (no agent) exchanges nothing', async () => {
    const r = rig({ agent: false });
    await r.ex.exchangeAgent();
    r.ex.nudge();
    expect(r.agent.sends).toEqual([]);
  });
  it('coalesces: one exchange in flight, and any number of calls during it schedule exactly one more', async () => {
    const r = rig();
    r.agent.held = { kind: 'nothing' };
    const gates: (() => void)[] = [];
    r.agent.next = () => new Promise<WitnessLinkAnswer>((res) => { gates.push(() => res({ kind: 'no-op' })); });
    const first = r.ex.exchangeAgent();
    await flush();
    expect(r.agent.sends).toHaveLength(1);
    r.ex.nudge(); r.ex.nudge(); void r.ex.exchangeAgent();
    await flush();
    expect(r.agent.sends).toHaveLength(1);
    gates[0]!();
    await flush(); await flush();
    expect(r.agent.sends).toHaveLength(2);
    gates[1]!();
    await first;
    await flush();
    expect(r.agent.sends).toHaveLength(2);
  });
  it('never rejects, even when the link throws', async () => {
    const r = rig();
    r.agent.held = { kind: 'nothing' };
    r.agent.next = () => { throw new Error('boom'); };
    await expect(r.ex.exchangeAgent()).resolves.toBeUndefined();
    r.agent.next = async () => ({ kind: 'no-op' });
    await r.ex.exchangeAgent();
    expect(r.agent.sends).toHaveLength(2);
  });
  it('is nudged by the guard\'s appended report (the composition root\'s wiring)', async () => {
    const r = rig();
    r.agent.held = { kind: 'nothing' };
    r.guard.onAppended(() => r.ex.nudge());
    r.append(WIDEN);
    await flush(); await flush();
    expect(r.agent.sends.length).toBeGreaterThanOrEqual(1);
  });
});

describe('a console', () => {
  const asked = (a: ExchangeAnswer): WitnessTuple => { if (a.kind !== 'offer') throw new Error('no offer'); return a.tuple; };
  it('with a tuple from an earlier boot lifts noWitnessSinceBoot; one from this boot does not', () => {
    const r = rig();
    r.append(WIDEN);
    r.ex.exchangeConsole('dev-a', r.held({}, BOOT));
    expect(r.ex.noWitnessSinceBoot()).toBe('standing');
    r.ex.exchangeConsole('dev-a', r.held({}, OLD));
    expect(r.ex.noWitnessSinceBoot()).toBe('lifted');
  });
  it('holding nothing is offered the current tuple and counts for nothing', () => {
    const r = rig();
    r.append(WIDEN);
    const t = asked(r.ex.exchangeConsole('dev-a', null));
    expect(t).toMatchObject({ v: 1, boot: BOOT, epoch: 1, base: 0, authority: { sequence: 1 } });
    expect(r.ex.noWitnessSinceBoot()).toBe('standing');
  });
  it('holding a higher epoch puts the guard in rolled-back and is still offered the tuple', () => {
    const r = rig();
    r.append(WIDEN);
    const a = r.ex.exchangeConsole('dev-a', ahead(r));
    expect(a.kind).toBe('offer');
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
  });
  it('holding another head at a sequence the server holds puts the guard in rolled-back: witness-heads', () => {
    const r = rig();
    r.append(WIDEN);
    r.ex.exchangeConsole('dev-a', r.held({ authority: { sequence: 1, digest: D('f') } }));
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'witness-heads' });
  });
  it('a malformed tuple warns once per change, and neither refuses nor counts', () => {
    const r = rig();
    r.append(WIDEN);
    r.ex.exchangeConsole('dev-a', { junk: 1 });
    r.ex.exchangeConsole('dev-a', { junk: 2 });
    expect(r.warns).toHaveLength(1);
    r.ex.exchangeConsole('dev-a', r.held({}, BOOT));
    r.ex.exchangeConsole('dev-a', { junk: 3 });
    expect(r.warns).toHaveLength(2);
    expect(r.guard.state()).toEqual({ kind: 'coherent' });
    expect(r.ex.noWitnessSinceBoot()).toBe('standing');
  });
  it('is answered unmeasured, with the why, when no offer can be built', () => {
    const r = rig();
    r.privacy.now = { kind: 'unmeasured', why: 'the file is unreadable' };
    expect(r.ex.exchangeConsole('dev-a', null)).toEqual({ kind: 'unmeasured', why: 'epoch' });
  });
  it('keeps at most 64 sources, dropping the oldest', () => {
    const r = rig();
    r.append(WIDEN);
    const t = r.held({}, OLD);
    for (let i = 0; i < 70; i++) r.ex.exchangeConsole(`dev-${i}`, i === 69 ? t : null);
    expect(r.ex.sourceCount()).toBeLessThanOrEqual(64);
    expect(r.ex.noWitnessSinceBoot()).toBe('lifted');
  });
});

describe('an unmeasured privacy head', () => {
  it('puts a coherent guard in unmeasured: privacy-head, never rolled-back, and offers nothing', () => {
    const r = rig();
    r.append(WIDEN);
    const t = r.held({});
    r.privacy.now = { kind: 'unmeasured', why: 'unreadable' };
    r.ex.exchangeConsole('dev-a', t);
    expect(r.guard.state()).toEqual({ kind: 'unmeasured', why: 'privacy-head' });
    expect(r.ex.epoch()).toEqual({ kind: 'unmeasured', why: expect.any(String) });
    expect(r.ex.heldFor(1)).toBe('unmeasured');
  });
});

describe('the reads', () => {
  it('heldFor answers held once a counting console holds the record\'s authority sequence, and not-yet for a same-host holder only', async () => {
    const r = rig();
    r.append(WIDEN);
    r.append(NARROW);
    expect(r.ex.heldFor(2)).toBe('not-yet');
    r.agent.host = 'same-host';
    r.agent.held = { kind: 'tuple', tuple: r.held({}) };
    await r.ex.exchangeAgent();
    expect(r.ex.heldFor(2)).toBe('not-yet');
    r.ex.exchangeConsole('dev-a', r.held({ authority: r.offer().authority }, BOOT));
    expect(r.ex.heldFor(2)).toBe('held');
    expect(r.ex.heldFor(1)).toBe('held');
    expect(r.ex.heldFor(3)).toBe('not-yet');
  });
  it('heldFor compares the authority sequence, not the epoch, so privacy records before it do not matter', () => {
    const r = rig();
    r.append(WIDEN);
    r.privacy.now = {
      kind: 'head', sequence: 5, digest: D('e'), highestMessageId: 9, digestAt: (s) => (s === 5 ? D('e') : null),
    };
    const o = r.offer();
    expect(o.epoch).toBe(6);
    r.ex.exchangeConsole('dev-a', { ...o, boot: OLD });
    expect(r.ex.heldFor(1)).toBe('held');
  });
  it('epoch() is the server\'s total, and highest() is the maximum over every source, any host, 0/0 with none', async () => {
    const r = rig();
    r.append(WIDEN);
    expect(r.ex.epoch()).toEqual({ kind: 'measured', n: 1 });
    expect(r.ex.highest()).toEqual({ kind: 'measured', epoch: 0, restoreGeneration: 0 });
    const o = r.offer();
    r.agent.host = 'same-host';
    r.agent.held = { kind: 'tuple', tuple: { ...ahead(r), highestIds: { restoreGeneration: 2 } } };
    await r.ex.exchangeAgent();
    r.ex.exchangeConsole('dev-a', { ...o, boot: OLD, highestIds: { restoreGeneration: 4 } });
    expect(r.ex.highest()).toEqual({ kind: 'measured', epoch: 2, restoreGeneration: 4 });
  });
  it('told() is the narrowest over the counting, consistent sources only', async () => {
    const r = rig();
    r.append(WIDEN);
    expect(r.ex.told()).toEqual({ kind: 'measured', told: null });
    r.agent.host = 'same-host';
    r.agent.held = { kind: 'tuple', tuple: r.held({ told: { operatorRung: 'off', latches: [{ cause: 'x-cause', cap: 'off' }] } }) };
    await r.ex.exchangeAgent();
    expect(r.ex.told()).toEqual({ kind: 'measured', told: null });
    r.ex.exchangeConsole('dev-a', r.held({ told: { operatorRung: 'advise', latches: [{ cause: 'x-cause', cap: 'full' }, { cause: 'y-cause', cap: 'chat' }] } }));
    r.ex.exchangeConsole('dev-b', r.held({ told: { operatorRung: 'chat', latches: [{ cause: 'x-cause', cap: 'advise' }] } }));
    expect(r.ex.told()).toEqual({
      kind: 'measured', told: { operatorRung: 'chat', latches: [{ cause: 'x-cause', cap: 'advise' }, { cause: 'y-cause', cap: 'chat' }] },
    });
  });
  it('witnessHighestIds() is the highest message id any witness answered with, null with none', () => {
    const r = rig();
    r.append(WIDEN);
    expect(r.ex.witnessHighestIds()).toEqual({ message: null });
    r.ex.exchangeConsole('dev-a', r.held({ highestIds: { restoreGeneration: 0, message: 7 } }));
    r.ex.exchangeConsole('dev-b', r.held({ highestIds: { restoreGeneration: 0, message: 3 } }));
    expect(r.ex.witnessHighestIds()).toEqual({ message: 7 });
  });
  it('offerNow() nudges the agent exchange', async () => {
    const r = rig();
    r.agent.held = { kind: 'nothing' };
    r.ex.offerNow();
    await flush(); await flush();
    expect(r.agent.sends).toHaveLength(1);
  });
});
