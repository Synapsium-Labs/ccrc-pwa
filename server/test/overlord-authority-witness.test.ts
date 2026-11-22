// Overlord W1 authority journal plan, Task 5 (PR B, L0 and L1): the witness tuple's parse and keep rule, the authority epoch derived
// from the journals' heads, the witness verdict's seven rows, and the off-volume holders. The expected words are written out here,
// never read from the code the cases judge.
import { describe, expect, it } from 'vitest';
import {
  parseWitnessTuple, witnessKeep, WITNESS_RUNGS, type WitnessHead, type WitnessTuple,
} from '../../shared/authorityWitness.js';
import { RUNGS } from '../../shared/overlord-ladder.js';
import type { AuthorityView } from '../src/coord/overlordAuthority.js';
import {
  authorityEpoch, currentWitnessTuple, offVolumeHeld, witnessVerdict,
  type AuthorityEpoch, type HeldByWitness, type HostRelation, type ServerWitnessFacts, type WitnessHeld, type WitnessVerdict,
} from '../src/coord/overlordAuthorityWitness.js';
import { PRIVACY_HEAD_UNWIRED, type PrivacyHeadRead } from '../src/coord/privacyJournalHead.js';

const D = (c: string): string => c.repeat(64);
const BOOT_NOW = 'boot-now';
const BOOT_OLD = 'boot-old';

function view(over: Partial<AuthorityView> = {}): AuthorityView {
  return {
    designation: null, operatorRung: null, latches: new Map(), accountSet: null, modelClass: null, decisionRows: new Map(),
    lastConfirm: null, ...over,
  };
}
const confirm = (sequence: number, epochAtConfirm: number, privacySequenceAtConfirm: number | null): AuthorityView['lastConfirm'] =>
  ({ sequence, epochAtConfirm, privacySequenceAtConfirm, restoreGeneration: 1 });

const privHead = (sequence: number, digests: Record<number, string> = {}): PrivacyHeadRead => ({
  kind: 'head', sequence, digest: digests[sequence] ?? D('e'), highestMessageId: 9,
  digestAt: (s) => (s === sequence ? (digests[s] ?? D('e')) : (digests[s] ?? null)),
});

/** The authority journal's digests by sequence: record n has digest D(letter n). */
const AUTH_DIGESTS: Record<number, string> = { 1: D('1'), 2: D('2'), 3: D('3') };
function authFacts(seq: number): ServerWitnessFacts['authority'] {
  return { head: seq === 0 ? null : { sequence: seq, digest: AUTH_DIGESTS[seq]! }, digestAt: (s) => (s <= seq ? (AUTH_DIGESTS[s] ?? null) : null) };
}

function facts(over: Partial<ServerWitnessFacts> & { seq?: number } = {}): ServerWitnessFacts {
  const seq = over.seq ?? 2;
  const privacy = over.privacy ?? { kind: 'absent' };
  const v = view();
  return {
    epoch: authorityEpoch(v, seq, privacy), boot: BOOT_NOW, authority: authFacts(seq), privacy, ...over,
  };
}

function tuple(over: Partial<WitnessTuple> = {}): WitnessTuple {
  const base: WitnessTuple = {
    v: 1, epoch: 2, base: 0, terms: { authority: 2, privacy: 'absent', act: 'absent' }, boot: BOOT_OLD,
    authority: { sequence: 2, digest: D('2') }, privacy: 'absent', act: 'absent', highestIds: { restoreGeneration: 0 },
    told: { operatorRung: null, latches: [] },
  };
  return { ...base, ...over };
}
const holds = (t: WitnessTuple): WitnessHeld => ({ kind: 'tuple', tuple: t });
const NOTHING: WitnessHeld = { kind: 'nothing' };

describe('authorityEpoch', () => {
  it('with no Confirm the base is 0 and the terms are the two sequences', () => {
    expect(authorityEpoch(view(), 4, { kind: 'absent' })).toEqual({ total: 4, base: 0, terms: { authority: 4, privacy: 'absent' } });
    expect(authorityEpoch(view(), 4, privHead(3))).toEqual({ total: 7, base: 0, terms: { authority: 4, privacy: 3 } });
    expect(authorityEpoch(view(), 0, { kind: 'absent' })).toEqual({ total: 0, base: 0, terms: { authority: 0, privacy: 'absent' } });
  });
  it('a wired privacy journal with no record is term 0, not absent', () => {
    expect(authorityEpoch(view(), 2, { kind: 'empty' })).toEqual({ total: 2, base: 0, terms: { authority: 2, privacy: 0 } });
  });
  it('after a Confirm the base is its epochAtConfirm and the terms count the records after it', () => {
    const v = view({ lastConfirm: confirm(5, 10, 3) });
    expect(authorityEpoch(v, 7, privHead(5))).toEqual({ total: 14, base: 10, terms: { authority: 2, privacy: 2 } });
    expect(authorityEpoch(v, 5, privHead(3))).toEqual({ total: 10, base: 10, terms: { authority: 0, privacy: 0 } });
    expect(authorityEpoch(v, 6, { kind: 'empty' })).toEqual('unmeasured');          // 0 - 3: negative
    expect(authorityEpoch(v, 6, { kind: 'absent' })).toEqual({ total: 11, base: 10, terms: { authority: 1, privacy: 'absent' } });
  });
  it('a Confirm that recorded no privacy sequence counts every privacy record', () => {
    const v = view({ lastConfirm: confirm(1, 4, null) });
    expect(authorityEpoch(v, 3, privHead(5))).toEqual({ total: 11, base: 4, terms: { authority: 2, privacy: 5 } });
    expect(authorityEpoch(v, 1, { kind: 'empty' })).toEqual({ total: 4, base: 4, terms: { authority: 0, privacy: 0 } });
  });
  it('an unmeasured privacy head makes the epoch unmeasured, never absent', () => {
    expect(authorityEpoch(view(), 2, { kind: 'unmeasured', why: 'unreadable' })).toBe('unmeasured');
  });
  it('a negative term reads unmeasured: a journal shorter than its last Confirm says it was', () => {
    const v = view({ lastConfirm: confirm(5, 10, 3) });
    expect(authorityEpoch(v, 4, { kind: 'absent' })).toBe('unmeasured');
    expect(authorityEpoch(v, 7, privHead(2))).toBe('unmeasured');
    expect(authorityEpoch(v, 5, privHead(2))).toBe('unmeasured');
  });
  it('a sequence that is not a count reads unmeasured', () => {
    expect(authorityEpoch(view(), -1, { kind: 'absent' })).toBe('unmeasured');
    expect(authorityEpoch(view(), 1.5, { kind: 'absent' })).toBe('unmeasured');
    expect(authorityEpoch(view(), Number.NaN, { kind: 'absent' })).toBe('unmeasured');
    expect(authorityEpoch(view(), Number.MAX_SAFE_INTEGER, privHead(1))).toBe('unmeasured');
  });
});

describe('witnessVerdict, row by row', () => {
  it('row 1: a malformed tuple is unmeasured malformed, before every other row', () => {
    expect(witnessVerdict(facts(), { kind: 'malformed' }, 'console')).toEqual({ kind: 'unmeasured', why: 'malformed' });
    expect(witnessVerdict(facts({ epoch: 'unmeasured' }), { kind: 'malformed' }, 'console')).toEqual({ kind: 'unmeasured', why: 'malformed' });
  });
  it('row 2: nothing held is no-witness, before the server facts are read', () => {
    expect(witnessVerdict(facts(), NOTHING, 'console')).toEqual({ kind: 'no-witness' });
    expect(witnessVerdict(facts({ epoch: 'unmeasured' }), NOTHING, 'console')).toEqual({ kind: 'no-witness' });
  });
  it('row 3: the server facts unmeasured', () => {
    expect(witnessVerdict(facts({ epoch: 'unmeasured' }), holds(tuple()), 'console')).toEqual({ kind: 'unmeasured', why: 'journal' });
    expect(witnessVerdict(facts({ authority: 'unmeasured' }), holds(tuple()), 'console')).toEqual({ kind: 'unmeasured', why: 'journal' });
    expect(witnessVerdict(facts({ privacy: { kind: 'unmeasured', why: 'x' }, epoch: 'unmeasured' }), holds(tuple()), 'console'))
      .toEqual({ kind: 'unmeasured', why: 'privacy-head' });
    expect(witnessVerdict(facts({ privacy: { kind: 'unmeasured', why: 'x' } }), holds(tuple()), 'console'))
      .toEqual({ kind: 'unmeasured', why: 'privacy-head' });
  });
  it('row 3 comes before the stale and rolled-back rows', () => {
    expect(witnessVerdict(facts({ epoch: 'unmeasured' }), holds(tuple({ base: 9, epoch: 11 })), 'console')).toEqual({ kind: 'unmeasured', why: 'journal' });
  });
  it('row 4: a base below the server\'s is stale, even when its terms are higher', () => {
    const server = facts({ epoch: { total: 7, base: 5, terms: { authority: 2, privacy: 'absent' } } });
    expect(witnessVerdict(server, holds(tuple({ base: 3, epoch: 10, terms: { authority: 7, privacy: 'absent', act: 'absent' } })), 'console'))
      .toEqual({ kind: 'stale' });
    expect(witnessVerdict(server, holds(tuple({ base: 0, epoch: 2 })), 'console')).toEqual({ kind: 'stale' });
  });
  it('row 5: a base above the server\'s is witness-epoch', () => {
    expect(witnessVerdict(facts(), holds(tuple({ base: 1, epoch: 3 })), 'console')).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
  });
  it('row 5: equal bases and a higher authority term is witness-epoch', () => {
    expect(witnessVerdict(facts(), holds(tuple({ epoch: 3, terms: { authority: 3, privacy: 'absent', act: 'absent' } })), 'console'))
      .toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
  });
  it('row 5: a lower or equal term is not a rollback', () => {
    expect(witnessVerdict(facts(), holds(tuple({ epoch: 1, terms: { authority: 1, privacy: 'absent', act: 'absent' }, authority: null })), 'console'))
      .toEqual({ kind: 'consistent', counts: true });
  });
  it('row 5: a higher privacy term is witness-epoch when the server reads one', () => {
    const server = facts({ privacy: privHead(2) });
    const t = tuple({ epoch: 5, terms: { authority: 2, privacy: 3, act: 'absent' }, privacy: { sequence: 3, digest: D('e') } });
    expect(witnessVerdict(server, holds(t), 'console')).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
  });
  it('build rollback: a witness holding a privacy term is consistent against a server with the privacy head unwired', () => {
    const t = tuple({ epoch: 5, terms: { authority: 2, privacy: 3, act: 'absent' }, privacy: { sequence: 3, digest: D('e') } });
    expect(witnessVerdict(facts({ privacy: PRIVACY_HEAD_UNWIRED.read() }), holds(t), 'console')).toEqual({ kind: 'consistent', counts: true });
  });
  it('build rollback: the same witness against a server reading a lower privacy term refuses witness-epoch', () => {
    const t = tuple({ epoch: 5, terms: { authority: 2, privacy: 3, act: 'absent' }, privacy: { sequence: 3, digest: D('e') } });
    expect(witnessVerdict(facts({ privacy: privHead(1) }), holds(t), 'console')).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
    expect(witnessVerdict(facts({ privacy: { kind: 'empty' } }), holds(t), 'console')).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
  });
  it('a term the witness holds as absent while the server reads it is skipped, not compared as zero', () => {
    const t = tuple({ privacy: 'absent', terms: { authority: 2, privacy: 'absent', act: 'absent' } });
    expect(witnessVerdict(facts({ privacy: privHead(0 + 2) }), holds(t), 'console')).toEqual({ kind: 'consistent', counts: true });
  });
  it('row 5 comes before row 6', () => {
    const t = tuple({ epoch: 3, terms: { authority: 3, privacy: 'absent', act: 'absent' }, authority: { sequence: 3, digest: D('f') } });
    expect(witnessVerdict(facts(), holds(t), 'console')).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
  });
  it('row 6: an authority head the server holds with another digest is witness-heads', () => {
    expect(witnessVerdict(facts(), holds(tuple({ authority: { sequence: 2, digest: D('f') } })), 'console'))
      .toEqual({ kind: 'rolled-back', cause: 'witness-heads' });
    expect(witnessVerdict(facts(), holds(tuple({ authority: { sequence: 1, digest: D('f') } })), 'console'))
      .toEqual({ kind: 'rolled-back', cause: 'witness-heads' });
  });
  it('row 6: an authority head at an earlier sequence the server holds is consistent', () => {
    expect(witnessVerdict(facts(), holds(tuple({ epoch: 1, terms: { authority: 1, privacy: 'absent', act: 'absent' }, authority: { sequence: 1, digest: D('1') } })), 'console'))
      .toEqual({ kind: 'consistent', counts: true });
  });
  it('row 6: a head past the server\'s head, or any head against an empty journal, is witness-heads', () => {
    const past = tuple({ epoch: 2, terms: { authority: 2, privacy: 'absent', act: 'absent' }, authority: { sequence: 3, digest: D('3') } });
    expect(witnessVerdict(facts({ seq: 2 }), holds(past), 'console')).toEqual({ kind: 'rolled-back', cause: 'witness-heads' });
    expect(witnessVerdict(facts({ seq: 0 }), holds(tuple({ epoch: 0, terms: { authority: 0, privacy: 'absent', act: 'absent' } })), 'console'))
      .toEqual({ kind: 'rolled-back', cause: 'witness-heads' });
  });
  it('row 6: a witness with no authority head is not a mismatch', () => {
    expect(witnessVerdict(facts(), holds(tuple({ epoch: 0, terms: { authority: 0, privacy: 'absent', act: 'absent' }, authority: null })), 'console'))
      .toEqual({ kind: 'consistent', counts: true });
  });
  it('row 6: the privacy head is compared when both sides hold one', () => {
    const server = facts({ privacy: privHead(2, { 2: D('a') }) });
    const mk = (digest: string, sequence = 2): WitnessTuple =>
      tuple({ epoch: 4, terms: { authority: 2, privacy: sequence, act: 'absent' }, privacy: { sequence, digest } });
    expect(witnessVerdict(server, holds(mk(D('a'))), 'console')).toEqual({ kind: 'consistent', counts: true });
    expect(witnessVerdict(server, holds(mk(D('b'))), 'console')).toEqual({ kind: 'rolled-back', cause: 'witness-heads' });
    const lower = tuple({ epoch: 3, terms: { authority: 2, privacy: 1, act: 'absent' }, privacy: { sequence: 1, digest: D('c') } });
    expect(witnessVerdict(facts({ privacy: privHead(2, { 1: D('c'), 2: D('a') }) }), holds(lower), 'console')).toEqual({ kind: 'consistent', counts: true });
    expect(witnessVerdict(server, holds(lower), 'console')).toEqual({ kind: 'rolled-back', cause: 'witness-heads' });
  });
  it('row 6: a privacy head the journal could not read at that sequence is unmeasured privacy-head', () => {
    const server = facts({ privacy: { kind: 'head', sequence: 2, digest: D('a'), highestMessageId: null, digestAt: () => 'unmeasured' } });
    const t = tuple({ epoch: 4, terms: { authority: 2, privacy: 2, act: 'absent' }, privacy: { sequence: 2, digest: D('a') } });
    expect(witnessVerdict(server, holds(t), 'console')).toEqual({ kind: 'unmeasured', why: 'privacy-head' });
  });
  it('row 6: a witness holding a privacy head against a wired journal with no record is witness-heads', () => {
    const t = tuple({ epoch: 2, terms: { authority: 2, privacy: 0, act: 'absent' }, privacy: { sequence: 1, digest: D('a') } });
    expect(witnessVerdict(facts({ privacy: { kind: 'empty' } }), holds(t), 'console')).toEqual({ kind: 'rolled-back', cause: 'witness-heads' });
  });
  it('row 6: the privacy head is skipped when either side is absent, and an empty witness holds nothing to contradict', () => {
    const withHead = tuple({ epoch: 4, terms: { authority: 2, privacy: 2, act: 'absent' }, privacy: { sequence: 2, digest: D('d') } });
    expect(witnessVerdict(facts({ privacy: { kind: 'absent' } }), holds(withHead), 'console')).toEqual({ kind: 'consistent', counts: true });
    expect(witnessVerdict(facts({ privacy: privHead(2) }), holds(tuple({ privacy: 'absent' })), 'console')).toEqual({ kind: 'consistent', counts: true });
    const emptyT = tuple({ epoch: 2, terms: { authority: 2, privacy: 0, act: 'absent' }, privacy: 'empty' });
    expect(witnessVerdict(facts({ privacy: privHead(2) }), holds(emptyT), 'console')).toEqual({ kind: 'consistent', counts: true });
    expect(witnessVerdict(facts({ privacy: { kind: 'empty' } }), holds(emptyT), 'console')).toEqual({ kind: 'consistent', counts: true });
  });
  it('row 7: consistent counts only from another host or a console, under another boot', () => {
    const counts = (host: HostRelation, boot = BOOT_OLD): WitnessVerdict => witnessVerdict(facts(), holds(tuple({ boot })), host);
    expect(counts('other-host')).toEqual({ kind: 'consistent', counts: true });
    expect(counts('console')).toEqual({ kind: 'consistent', counts: true });
    expect(counts('same-host')).toEqual({ kind: 'consistent', counts: false });
    expect(counts('unmeasured')).toEqual({ kind: 'consistent', counts: false });
    expect(counts('other-host', BOOT_NOW)).toEqual({ kind: 'consistent', counts: false });
    expect(counts('console', BOOT_NOW)).toEqual({ kind: 'consistent', counts: false });
  });
});

describe('the witness tuple the server offers', () => {
  const auth: WitnessHead = { sequence: 2, digest: D('2') };
  it('carries the epoch, the heads, the generation, the highest message and the told narrowings sorted by cause', () => {
    const v = view({ operatorRung: 'advise', latches: new Map([['unwitnessed-third', 'advise'], ['restore-detected', 'chat']]) });
    const epoch = authorityEpoch(v, 2, privHead(3));
    const got = currentWitnessTuple(v, auth, epoch, privHead(3), BOOT_NOW, 4, 9);
    expect(got).toEqual({
      kind: 'tuple',
      tuple: {
        v: 1, epoch: 5, base: 0, terms: { authority: 2, privacy: 3, act: 'absent' }, boot: BOOT_NOW, authority: auth,
        privacy: { sequence: 3, digest: D('e') }, act: 'absent', highestIds: { restoreGeneration: 4, message: 9 },
        told: { operatorRung: 'advise', latches: [{ cause: 'restore-detected', cap: 'chat' }, { cause: 'unwitnessed-third', cap: 'advise' }] },
      },
    });
  });
  it('words the privacy journal as absent or empty, and omits a message id it does not have', () => {
    const v = view();
    const a = currentWitnessTuple(v, null, authorityEpoch(v, 0, { kind: 'absent' }), { kind: 'absent' }, BOOT_NOW, 0, null);
    expect(a).toMatchObject({ kind: 'tuple', tuple: { privacy: 'absent', authority: null, highestIds: { restoreGeneration: 0 } } });
    expect((a as { tuple: WitnessTuple }).tuple.highestIds).not.toHaveProperty('message');
    const e = currentWitnessTuple(v, auth, authorityEpoch(v, 2, { kind: 'empty' }), { kind: 'empty' }, BOOT_NOW, 0, null);
    expect(e).toMatchObject({ kind: 'tuple', tuple: { privacy: 'empty', terms: { privacy: 0 } } });
  });
  it('offers nothing over an unmeasured epoch or privacy read, or a boot that is not a token', () => {
    const v = view();
    expect(currentWitnessTuple(v, auth, 'unmeasured', { kind: 'absent' }, BOOT_NOW, 0, null)).toEqual({ kind: 'unmeasured', why: 'epoch' });
    const unread: PrivacyHeadRead = { kind: 'unmeasured', why: 'x' };
    expect(currentWitnessTuple(v, auth, authorityEpoch(v, 2, { kind: 'absent' }), unread, BOOT_NOW, 0, null)).toEqual({ kind: 'unmeasured', why: 'privacy-head' });
    expect(currentWitnessTuple(v, auth, authorityEpoch(v, 2, { kind: 'absent' }), { kind: 'absent' }, 'has space', 0, null)).toEqual({ kind: 'unmeasured', why: 'tuple' });
  });
  it('is the tuple the verdict reads consistent against the same facts', () => {
    const v = view();
    const server = facts({ seq: 2 });
    const got = currentWitnessTuple(v, { sequence: 2, digest: D('2') }, server.epoch, server.privacy, BOOT_NOW, 0, null);
    if (got.kind !== 'tuple') throw new Error('no tuple');
    expect(witnessVerdict(server, holds(got.tuple), 'console')).toEqual({ kind: 'consistent', counts: false });
  });
});

describe('offVolumeHeld', () => {
  const h = (host: HostRelation, epoch: number, boot = BOOT_OLD): HeldByWitness => ({ host, epoch, boot });
  it('a same-host holder alone does not hold it', () => {
    expect(offVolumeHeld(5, [h('same-host', 9)], BOOT_NOW)).toBe('not-yet');
  });
  it('an unmeasured holder alone does not hold it', () => {
    expect(offVolumeHeld(5, [h('unmeasured', 9)], BOOT_NOW)).toBe('not-yet');
  });
  it('a console or an other-host holder at or above the epoch holds it', () => {
    expect(offVolumeHeld(5, [h('console', 5)], BOOT_NOW)).toBe('held');
    expect(offVolumeHeld(5, [h('other-host', 6)], BOOT_NOW)).toBe('held');
    expect(offVolumeHeld(5, [h('same-host', 9), h('console', 7)], BOOT_NOW)).toBe('held');
  });
  it('a holder below the epoch does not hold it, and nobody holds nothing', () => {
    expect(offVolumeHeld(5, [h('console', 4)], BOOT_NOW)).toBe('not-yet');
    expect(offVolumeHeld(5, [], BOOT_NOW)).toBe('not-yet');
  });
  it('a holder under this boot still counts for holding a narrowing', () => {
    expect(offVolumeHeld(5, [h('console', 5, BOOT_NOW)], BOOT_NOW)).toBe('held');
  });
  it('an epoch that is not a count is unmeasured', () => {
    expect(offVolumeHeld(-1, [h('console', 5)], BOOT_NOW)).toBe('unmeasured');
    expect(offVolumeHeld(Number.NaN, [h('console', 5)], BOOT_NOW)).toBe('unmeasured');
    expect(offVolumeHeld(1.5, [], BOOT_NOW)).toBe('unmeasured');
  });
});

describe('the rung list', () => {
  it('is the ladder\'s, in its order', () => {
    expect(WITNESS_RUNGS).toEqual(['off', 'chat', 'advise', 'full']);
    expect([...WITNESS_RUNGS]).toEqual([...RUNGS]);
  });
});

describe('witnessVerdict over a generated domain', () => {
  type Case = { server: ServerWitnessFacts; held: WitnessHeld; host: HostRelation };
  const hosts: HostRelation[] = ['other-host', 'same-host', 'unmeasured', 'console'];
  const servers: ServerWitnessFacts[] = [];
  for (const base of [0, 1]) for (const a of [0, 1, 2]) for (const priv of ['absent', 'empty', 'head1', 'head2'] as const) {
    const privacy: PrivacyHeadRead = priv === 'absent' ? { kind: 'absent' } : priv === 'empty' ? { kind: 'empty' }
      : privHead(priv === 'head1' ? 1 : 2, { 1: D('a'), 2: D('b') });
    const pt = privacy.kind === 'head' ? privacy.sequence : privacy.kind === 'empty' ? 0 : 'absent';
    servers.push({
      epoch: { total: base + a + (pt === 'absent' ? 0 : pt), base, terms: { authority: a, privacy: pt } }, boot: BOOT_NOW,
      authority: authFacts(a), privacy,
    });
  }
  const tuples: WitnessHeld[] = [NOTHING, { kind: 'malformed' }];
  for (const base of [0, 1, 2]) for (const a of [0, 1, 2, 3]) for (const priv of ['absent', 'empty', 'a1', 'b1', 'a2', 'b2'] as const) {
    for (const auth of ['none', 'good', 'bad'] as const) for (const boot of [BOOT_OLD, BOOT_NOW]) {
      const privacy = priv === 'absent' || priv === 'empty' ? priv : { sequence: Number(priv[1]), digest: priv[0] === 'a' ? D(priv[1] === '1' ? 'a' : 'b') : D('9') };
      const pt = priv === 'absent' ? 'absent' : priv === 'empty' ? 0 : Number(priv[1]);
      tuples.push(holds({
        v: 1, base, epoch: base + a + (pt === 'absent' ? 0 : pt), terms: { authority: a, privacy: pt, act: 'absent' }, boot,
        authority: auth === 'none' || a === 0 ? null : { sequence: a, digest: auth === 'good' ? D(String(a)) : D('f') },
        privacy, act: 'absent', highestIds: { restoreGeneration: 0 }, told: { operatorRung: null, latches: [] },
      }));
    }
  }
  const all: Case[] = [];
  for (const server of servers) for (const held of tuples) for (const host of hosts) all.push({ server, held, host });
  const isRefusal = (v: WitnessVerdict): boolean => v.kind === 'rolled-back' || v.kind === 'stale' || v.kind === 'unmeasured';
  const countsNow = (v: WitnessVerdict): boolean => v.kind === 'consistent' && v.counts;
  const degradations: [string, (c: Case) => Case][] = [
    ['epoch unmeasured', (c) => ({ ...c, server: { ...c.server, epoch: 'unmeasured' } })],
    ['authority unmeasured', (c) => ({ ...c, server: { ...c.server, authority: 'unmeasured' } })],
    ['privacy unmeasured', (c) => ({ ...c, server: { ...c.server, privacy: { kind: 'unmeasured', why: 'x' } } })],
    ['witness holds nothing', (c) => ({ ...c, held: NOTHING })],
    ['witness malformed', (c) => ({ ...c, held: { kind: 'malformed' } })],
    ['host unmeasured', (c) => ({ ...c, host: 'unmeasured' })],
    ['host same-host', (c) => ({ ...c, host: 'same-host' })],
    ['tuple from this boot', (c) => ({ ...c, held: c.held.kind === 'tuple' ? holds({ ...c.held.tuple, boot: BOOT_NOW }) : c.held })],
  ];

  it('is total: every input answers one of the five words, and never throws', () => {
    const words = new Set<string>();
    for (const c of all) words.add(witnessVerdict(c.server, c.held, c.host).kind);
    expect([...words].sort()).toEqual(['consistent', 'no-witness', 'rolled-back', 'stale', 'unmeasured']);
    expect(all.length).toBeGreaterThan(5000);
  });
  it('an unmeasured or missing input never turns a refusal into consistent', () => {
    let refusals = 0;
    for (const c of all) {
      if (!isRefusal(witnessVerdict(c.server, c.held, c.host))) continue;
      refusals++;
      for (const [name, degrade] of degradations) {
        const after = witnessVerdict(...(((d) => [d.server, d.held, d.host] as const)(degrade(c))));
        expect(after.kind, `${name}`).not.toBe('consistent');
      }
    }
    expect(refusals).toBeGreaterThan(1000);
  });
  it('an unmeasured or missing input never makes a non-counting answer count', () => {
    let counting = 0;
    for (const c of all) {
      const before = witnessVerdict(c.server, c.held, c.host);
      for (const [name, degrade] of degradations) {
        const d = degrade(c);
        const after = witnessVerdict(d.server, d.held, d.host);
        if (countsNow(after)) expect(countsNow(before), `${name}`).toBe(true);
      }
      if (countsNow(before)) counting++;
    }
    expect(counting).toBeGreaterThan(100);
  });
  it('counts only from another host or a console under a boot other than this one', () => {
    for (const c of all) {
      const v = witnessVerdict(c.server, c.held, c.host);
      if (!countsNow(v)) continue;
      expect(['other-host', 'console']).toContain(c.host);
      expect(c.held.kind === 'tuple' && c.held.tuple.boot !== BOOT_NOW).toBe(true);
    }
  });
});

describe('offVolumeHeld over a generated domain', () => {
  it('only an other-host or console holder at or above the epoch ever holds it, and adding holders never un-holds', () => {
    const hosts: HostRelation[] = ['other-host', 'same-host', 'unmeasured', 'console'];
    const all: HeldByWitness[] = [];
    for (const host of hosts) for (const epoch of [0, 3, 5, 8]) for (const boot of [BOOT_OLD, BOOT_NOW]) all.push({ host, epoch, boot });
    for (const epoch of [0, 4, 5, 9]) {
      for (const a of all) {
        const one = offVolumeHeld(epoch, [a], BOOT_NOW);
        const expected = (a.host === 'other-host' || a.host === 'console') && a.epoch >= epoch ? 'held' : 'not-yet';
        expect(one).toBe(expected);
        for (const b of all) {
          if (one === 'held') expect(offVolumeHeld(epoch, [a, b], BOOT_NOW)).toBe('held');
          if (one === 'not-yet' && offVolumeHeld(epoch, [b], BOOT_NOW) === 'not-yet') expect(offVolumeHeld(epoch, [a, b], BOOT_NOW)).toBe('not-yet');
        }
      }
    }
  });
});

// A type-level reading of `AuthorityEpoch`, so the cases above cannot drift from the exported union.
const _epochShape: AuthorityEpoch = 'unmeasured';
void _epochShape;
void it;
