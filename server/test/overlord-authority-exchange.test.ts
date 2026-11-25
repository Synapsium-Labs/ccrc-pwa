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
import { makeIsolationReader, type IsolationReader } from '../src/isolationFacts.js';
import { parseSource, ts } from './scan/parse.js';
import { parsedFile } from './scan/symbols.js';
import type { AgentHostRelation } from '../../shared/isolation.js';
import { PRIVACY_HEAD_UNWIRED, type PrivacyHeadRead } from '../src/coord/privacyJournalHead.js';
import { readReadyWitness, type ReadyWitness } from '../../shared/agent-protocol.js';
import type { WitnessTuple } from '../../shared/authorityWitness.js';
import { WITNESS_RAISE_CEILING } from '../src/coord/overlordAuthorityWitness.js';
import { OverlordRestoreState } from '../src/coord/overlordRestoreState.js';
import { openOperatorModelStore } from '../src/operatorModel/store.js';
import { OPERATOR } from './overlordRestoreRig.js';
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
  agent: { held: ReadyWitness | undefined; host: AgentHostRelation; sends: WitnessTuple[]; next: (o: WitnessTuple) => Promise<WitnessLinkAnswer> };
  append(m: OverlordAuthorityMove): void;
  offer(): WitnessTuple;
  /** The server's own offer, as a witness from `boot` that holds `over` instead. */
  held(over: Partial<WitnessTuple>, boot?: string): WitnessTuple;
}

function rig(opts: { agent?: boolean; relationOf?: () => AgentHostRelation } = {}): Rig {
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
    journal, guard, privacy: { read: () => privacy.now }, boot: BOOT, relationOf: opts.relationOf ?? (() => agent.host), warn: (l) => warns.push(l),
    committedRows: () => db.isTransaction ? { kind: 'unmeasured' } : journal.readRows(db),
    agent: opts.agent === false ? null : { held: () => agent.held, link },
  });
  const offer = (): WitnessTuple => {
    const a = ex.exchangeConsole('probe', null);
    if (a.kind !== 'offer') throw new Error(`no offer: ${JSON.stringify(a)}`);
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
    expect(r.agent.sends).toHaveLength(0);
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
  it('does not count a matching tuple from a connected agent whose off-volume relation the Isolation reader cannot prove', async () => {
    const state = { connected: true, hostReport: 'absent', peer: { locality: 'not-local', uid: 'unmeasured' } } as const;
    const isolation = makeIsolationReader('remote', {
      facts: { uid: 1000, initialNamespace: true, overflowUid: 65534, holdings: [] },
      ids: { machine: 'unmeasured', boot: 'unmeasured' },
    }, null, state);
    const relationOf = () => isolation.relationOf(isolation.linkOf(state));
    expect(relationOf()).toBe('unmeasured');
    const r = rig({ relationOf });
    r.append(WIDEN);
    r.agent.held = { kind: 'tuple', tuple: r.held({ told: { operatorRung: 'chat', latches: [] } }) };
    await r.ex.exchangeAgent();
    expect(r.agent.sends).toHaveLength(1);
    expect(r.ex.noWitnessSinceBoot()).toBe('standing');
    expect(r.ex.heldFor(1)).toBe('not-yet');
    expect(r.ex.told()).toEqual({ kind: 'measured', told: null });
  });
  it('reads the current Isolation link for agent holdings instead of returning a constant', async () => {
    // Pin the boot-only composition without starting index.ts against the host. Then exercise the exchange at that port.
    const index = parsedFile('server/src/index.ts');
    const bindings = index.bindings.filter((b) => b.name === 'overlordAuthorityExchange' && b.scopeStart === 0 && b.scopeEnd === index.text.length);
    expect(bindings, 'one top-level authority exchange binding').toHaveLength(1);
    const init = ts.createSourceFile('exchange-init.ts', bindings[0]!.init, ts.ScriptTarget.Latest, true).statements[0];
    const exchange = init && ts.isExpressionStatement(init) ? init.expression : undefined;
    const deps = exchange && ts.isNewExpression(exchange) ? exchange.arguments?.[0] : undefined;
    const relation = deps && ts.isObjectLiteralExpression(deps) ? deps.properties.find((p) => p.name?.getText() === 'relationOf') : undefined;
    const calls = relation && ts.isPropertyAssignment(relation)
      ? parseSource(relation.initializer.getText(), 'exchange-relation.ts').calls : [];
    const read = calls.find((c) => c.callee === 'isolation.relationOf');
    const link = calls.find((c) => c.callee === 'isolation.linkOf' && c.start === read?.argSpans[0]?.start && c.end === read.argSpans[0].end);
    expect(link?.args, 'exchange must read Isolation from the current fleet state').toEqual([{ kind: 'other', text: 'fleetClient.state' }]);

    const state: Parameters<IsolationReader['linkOf']>[0] = {
      connected: true, hostReport: 'absent', peer: { locality: 'not-local', uid: 'unmeasured' }, readySerial: 1,
    };
    const isolation = makeIsolationReader('remote', {
      facts: { uid: 1000, initialNamespace: true, overflowUid: 65534, holdings: [] },
      ids: { machine: 'unmeasured', boot: 'unmeasured' },
    }, null, state);
    // W1 cannot prove an off-volume link. Supply that word only at the fixture's reader port, for this ready observation.
    const reader: IsolationReader = {
      ...isolation,
      relationOf: (link) => link.link === 'ready' && link.readySerial === 1 ? 'other-host' : isolation.relationOf(link),
    };
    const r = rig({ relationOf: () => reader.relationOf(reader.linkOf(state)) });
    try {
      r.append(WIDEN);
      const tuple = r.held({});
      r.agent.held = { kind: 'tuple', tuple };
      await r.ex.exchangeAgent();
      expect(r.ex.heldFor(1)).toBe('held');

      // Same link and tuple, but a fresh ready has no off-volume proof.
      state.readySerial = 2;
      r.agent.held = { kind: 'tuple', tuple };
      await r.ex.exchangeAgent();
      expect(r.ex.heldFor(1)).toBe('not-yet');
    } finally { r.db.close(); }
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
  it('keeps the newer answer over old ready when the op is lost, unsent, malformed or predates the op', async () => {
    const r = rig();
    r.append(WIDEN);
    r.agent.held = { kind: 'tuple', tuple: r.held({}) };
    r.append(NARROW);
    r.agent.next = async () => answered(r.held({}, BOOT));
    await r.ex.exchangeAgent();
    expect(r.ex.heldFor(2)).toBe('held');
    for (const a of [{ kind: 'lost', why: 'timeout' }, { kind: 'unsent' }, { kind: 'malformed' }, { kind: 'predates-op' }] as WitnessLinkAnswer[]) {
      r.agent.next = async () => a;
      await r.ex.exchangeAgent();
      expect(r.ex.heldFor(2), a.kind).toBe('held');
    }
    r.agent.held = { kind: 'nothing' }; // a new ready on a new connection is a new answer
    await r.ex.exchangeAgent();
    expect(r.ex.heldFor(2)).toBe('not-yet');
  });
  it('does not count a matching op answer when the current link no longer has off-volume proof', async () => {
    const r = rig();
    try {
      r.append(WIDEN);
      r.agent.held = { kind: 'nothing' }; // no ready tuple can decide the holding
      r.agent.next = async (offer) => {
        r.agent.host = 'unmeasured';
        return answered({ ...offer, boot: OLD });
      };
      await r.ex.exchangeAgent();
      expect(r.agent.sends).toHaveLength(1);
      expect(r.guard.state()).toEqual({ kind: 'coherent' });
      expect(r.ex.heldFor(1)).toBe('not-yet');
      expect(r.ex.noWitnessSinceBoot()).toBe('standing');
    } finally { r.db.close(); }
  });
  it('discards an op reply from the connection that is no longer ready', async () => {
    const r = rig();
    r.append(WIDEN);
    const obsolete = r.held({ highestIds: { restoreGeneration: 7, message: 9 } });
    r.agent.held = { kind: 'nothing' };
    let respond!: (answer: WitnessLinkAnswer) => void;
    r.agent.next = () => new Promise((resolve) => { respond = resolve; });
    const pending = r.ex.exchangeAgent();
    await flush();
    expect(r.agent.sends).toHaveLength(1);
    r.agent.held = { kind: 'nothing' }; // same word, different ready object
    respond(answered(obsolete));
    await pending;
    expect(r.guard.state()).toEqual({ kind: 'coherent' });
    expect(r.ex.noWitnessSinceBoot()).toBe('standing');
    expect(r.ex.heldFor(1)).toBe('not-yet');
    expect(r.ex.highest()).toEqual({ kind: 'measured', epoch: 0, restoreGeneration: 0 });
    expect(r.ex.witnessHighestIds()).toEqual({ message: null });
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
  it('does not publish a trailing record when the transaction with the appended head rolls back', async () => {
    const r = rig();
    r.append(WIDEN);
    await flush();
    r.agent.held = { kind: 'nothing' };
    r.guard.onAppended(() => r.ex.nudge());
    expect(() => tx(r.db, () => {
      expect(r.journal.appendInTx(r.db, NARROW).ok).toBe(true);
      throw new Error('fixture abort');
    })).toThrow('fixture abort');
    await flush(); await flush();
    expect.soft(r.agent.sends).toEqual([]);
    expect(r.ex.exchangeConsole('dev-a', null).kind).not.toBe('offer');
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
  it('withholds the offer on rollback, leaving the held word as evidence on the next exchange', () => {
    const r = rig();
    r.append(WIDEN);
    r.privacy.now = { kind: 'head', sequence: 5, digest: D('a'), highestMessageId: 5, digestAt: () => D('a') };
    const held = r.held({ epoch: 3, terms: { authority: 2, privacy: 1, act: 'absent' }, privacy: { sequence: 1, digest: D('a') } });
    expect(r.offer().epoch).toBe(6);
    for (const device of ['dev-a', 'dev-b']) {
      expect(r.ex.exchangeConsole(device, JSON.parse(JSON.stringify(held))).kind).not.toBe('offer');
      expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
    }
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
  it('fences the guard when the privacy head becomes unreadable even if the console holds nothing', () => {
    const r = rig();
    r.append(WIDEN);
    r.ex.exchangeConsole('prior', r.held({}));
    expect(r.ex.noWitnessSinceBoot()).toBe('lifted');
    r.privacy.now = { kind: 'unmeasured', why: 'the file is unreadable' };
    expect(r.ex.exchangeConsole('dev-a', null)).toEqual({ kind: 'unmeasured', why: 'epoch' });
    expect(r.guard.state()).toEqual({ kind: 'unmeasured', why: 'privacy-head' });
  });
  it('offers nothing to a source whose held word did not parse', () => {
    const r = rig();
    expect(r.ex.exchangeConsole('dev-a', { junk: 1 }).kind).not.toBe('offer');
    expect(r.guard.state()).toEqual({ kind: 'coherent' });
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
    expect(r.ex.epoch(r.journal.readVerified())).toEqual({ kind: 'unmeasured', why: expect.any(String) });
    expect(r.ex.heldFor(1)).toBe('unmeasured');
  });
});

describe('witnessed counter raises', () => {
  const ceiling = WITNESS_RAISE_CEILING;
  const above = ceiling + 1;
  it.each([
    { name: 'above-limit counters leave the local bounds alone', host: 'same-host', raw: [above, above, above], next: [4, 1, 2] },
    { name: 'at-limit counters raise every bound without stopping publication', host: 'unmeasured', raw: [ceiling, ceiling, ceiling], next: [above, above, above] },
    { name: 'an above-limit counter does not discard eligible neighbours', host: 'same-host', raw: [above, ceiling, 7], next: [4, above, 8] },
  ] as const)('$name ($host)', async ({ host, raw: [epoch, generation, message], next: [nextEpoch, nextGeneration, nextMessage] }) => {
    const r = rig();
    const dir = mkTmp('ccrc-witness-counter-');
    const { db, store } = openOperatorModelStore(path.join(dir, 'operator-model.db'), dir, 1000, r.ex);
    const issue = (at: number): number => {
      const result = store.recordMessage({ at, actor: OPERATOR, sessionId: 'lane-a-project-a', term: 1, text: 'fixture', mark: false, composedKey: null });
      if (!result.ok) throw new Error(`message issuance refused: ${result.error}`);
      const head = store.privacyJournalHead();
      if (head.kind !== 'measured' || head.value === 'empty') throw new Error('no fixture privacy head');
      r.privacy.now = {
        kind: 'head', sequence: head.value.sequence, digest: head.value.digest, highestMessageId: head.value.highestId,
        digestAt: (n) => { const d = store.privacyJournalDigestAt(n); return d.kind === 'unmeasured' ? 'unmeasured' : d.value; },
      };
      return result.value.id;
    };
    try {
      r.db.exec(find('ALTER TABLE overlord_designation ADD COLUMN actorKind'));
      r.append(WIDEN);
      expect(issue(1001)).toBe(1);
      expect(r.ex.epoch(r.journal.readVerified())).toEqual({ kind: 'measured', n: 2 });
      r.agent.host = host;
      r.agent.held = readReadyWitness(r.held({
        base: epoch, epoch, terms: { authority: 0, privacy: 0, act: 'absent' }, highestIds: { restoreGeneration: generation, message },
      }));
      expect(r.agent.held.kind).toBe('tuple');
      await r.ex.exchangeAgent();
      // A higher base still detects rollback. Only the maxima used for numbering change.
      expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
      expect(r.agent.sends).toHaveLength(0);
      expect(r.ex.noWitnessSinceBoot()).toBe('standing');
      expect.soft(issue(1002)).toBe(nextMessage);
      expect(r.ex.epoch(r.journal.readVerified())).toEqual({ kind: 'measured', n: 3 });
      r.agent.held = undefined;
      const restore = new OverlordRestoreState({ db: r.db, journal: r.journal, guard: r.guard, witness: r.ex });
      const confirmed = restore.confirm(OPERATOR, 'op-confirm', 1_800_000_000_000);
      await r.ex.exchangeAgent();
      expect.soft(confirmed).toMatchObject({ ok: true, changed: true, epochAtConfirm: nextEpoch, restoreGeneration: nextGeneration });
      if (!confirmed.ok || !confirmed.changed) return;
      const offered = r.offer();
      expect.soft(offered).toMatchObject({ epoch: nextEpoch, highestIds: { restoreGeneration: nextGeneration, message: nextMessage } });
      expect(r.ex.exchangeConsole('dev-a', offered)).toEqual({ kind: 'offer', tuple: offered });
      expect(r.ex.heldFor(confirmed.sequence)).toBe('held');
      expect(r.guard.state()).toEqual({ kind: 'coherent' });
      if (epoch === ceiling) {
        for (const issued of [offered.epoch, offered.highestIds.restoreGeneration, offered.highestIds.message!]) {
          expect(Number.isSafeInteger(issued)).toBe(true);
          expect(Number.MAX_SAFE_INTEGER - issued).toBeGreaterThanOrEqual(ceiling);
        }
      }
    } finally { db.close(); r.db.close(); }
  });
  it('reports Confirm success but fences again in its follow-up while the agent holds an above-ceiling base', async () => {
    const r = rig();
    try {
      r.db.exec(find('ALTER TABLE overlord_designation ADD COLUMN actorKind'));
      r.append(WIDEN);
      r.agent.held = { kind: 'tuple', tuple: r.held({
        base: above, epoch: above, terms: { authority: 0, privacy: 'absent', act: 'absent' }, highestIds: { restoreGeneration: above },
      }) };
      await r.ex.exchangeAgent();
      expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
      const restore = new OverlordRestoreState({ db: r.db, journal: r.journal, guard: r.guard, witness: r.ex });
      expect(restore.confirm(OPERATOR, 'op-confirm', 1_800_000_000_000)).toMatchObject({
        ok: true, changed: true, epochAtConfirm: 2, restoreGeneration: 1,
      });
      expect(r.guard.state()).toEqual({ kind: 'coherent' });
      await flush(); // Confirm's scheduled pass, with the same ready answer still held
      expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
      expect(r.agent.sends).toHaveLength(0);
      expect(r.ex.noWitnessSinceBoot()).toBe('standing');
    } finally { r.db.close(); }
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
    expect(r.ex.epoch(r.journal.readVerified())).toEqual({ kind: 'measured', n: 1 });
    expect(r.ex.highest()).toEqual({ kind: 'measured', epoch: 0, restoreGeneration: 0 });
    const o = r.offer();
    r.agent.host = 'same-host';
    r.agent.held = { kind: 'tuple', tuple: { ...ahead(r), highestIds: { restoreGeneration: 2 } } };
    await r.ex.exchangeAgent();
    r.ex.exchangeConsole('dev-a', { ...o, boot: OLD, highestIds: { restoreGeneration: 4 } });
    expect(r.ex.highest()).toEqual({ kind: 'measured', epoch: 2, restoreGeneration: 4 });
  });
  it('passes the rollback witness narrowing to the Confirm read, but never uses it for a holding receipt', () => {
    const r = rig();
    r.append(WIDEN);
    r.ex.exchangeConsole('dev-a', r.held({ told: { operatorRung: 'advise', latches: [] } }));
    const told = { operatorRung: 'chat', latches: [{ cause: 'fixture-cap', cap: 'off' }] } as const;
    r.ex.exchangeConsole('dev-b', { ...ahead(r), told });
    expect(r.ex.told()).toEqual({ kind: 'measured', told });
    expect(r.ex.heldFor(2)).toBe('not-yet');
  });
  it('told() is the narrowest over off-volume sources with a usable verdict', async () => {
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
  it('withdraws the earlier boot observation on a rollback', () => {
    const r = rig();
    r.append(WIDEN);
    r.ex.exchangeConsole('dev-a', r.held({}));
    expect(r.ex.noWitnessSinceBoot()).toBe('lifted');
    r.ex.exchangeConsole('dev-b', ahead(r));
    expect(r.ex.noWitnessSinceBoot()).toBe('standing');
  });
  it('does not re-lift boot confidence on a consistent prior-boot answer after a same-boot rollback verdict', () => {
    const r = rig();
    r.append(WIDEN);
    const prior = r.held({});
    r.ex.exchangeConsole('dev-a', prior);
    expect(r.ex.noWitnessSinceBoot()).toBe('lifted');
    r.ex.exchangeConsole('dev-b', { ...ahead(r), boot: BOOT });
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
    expect(r.ex.noWitnessSinceBoot()).toBe('standing');
    expect(r.ex.exchangeConsole('dev-a', prior).kind).toBe('offer');
    expect(r.ex.heldFor(1)).toBe('held');
    expect(r.ex.noWitnessSinceBoot()).toBe('standing');
  });
  it('withdraws the earlier boot observation on Confirm and does not re-lift within that boot', () => {
    const r = rig();
    r.append(WIDEN);
    const t = r.held({});
    r.ex.exchangeConsole('dev-a', t);
    expect(r.ex.noWitnessSinceBoot()).toBe('lifted');
    r.guard.confirmed();
    r.ex.offerNow();
    expect.soft(r.ex.noWitnessSinceBoot()).toBe('standing');
    r.ex.exchangeConsole('dev-b', t);
    expect(r.ex.noWitnessSinceBoot()).toBe('standing');
  });
  it('offerNow() nudges the agent exchange', async () => {
    const r = rig();
    r.agent.held = { kind: 'nothing' };
    r.ex.offerNow();
    await flush(); await flush();
    expect(r.agent.sends).toHaveLength(1);
  });
});
