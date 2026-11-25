// The shared witness tuple's parse and keep rule, as the console uses them (Overlord W1 authority journal plan, Task 5). The module is
// L0 and the PWA bundles it, so this suite imports it by relative path as other pwa tests import `shared/`.
import { describe, expect, it } from 'vitest';
import { parseWitnessTuple, witnessKeep, WITNESS_RUNGS, type WitnessTuple } from '../../shared/authorityWitness';

const D = (c: string): string => c.repeat(64);
const good = (): Record<string, unknown> => ({
  v: 1, epoch: 5, base: 0, terms: { authority: 2, privacy: 3, act: 'absent' }, boot: 'boot-a', authority: { sequence: 2, digest: D('1') },
  privacy: { sequence: 3, digest: D('2') }, act: 'absent', highestIds: { restoreGeneration: 1, message: 7 },
  told: { operatorRung: 'advise', latches: [{ cause: 'restore-detected', cap: 'chat' }, { cause: 'unwitnessed-third', cap: 'advise' }] },
});
const parsed = (raw: unknown): WitnessTuple => {
  const r = parseWitnessTuple(raw);
  if (!r.ok) throw new Error('did not parse');
  return r.tuple;
};
const refused = (raw: unknown): boolean => {
  const r = parseWitnessTuple(raw);
  return !r.ok && r.why === 'malformed';
};
const mutate = (f: (t: Record<string, any>) => void): Record<string, unknown> => { const t = good() as Record<string, any>; f(t); return t; };

describe('parseWitnessTuple', () => {
  it('accepts a whole tuple as given, and through JSON', () => {
    expect(parsed(good())).toEqual(good());
    expect(parsed(JSON.parse(JSON.stringify(good())))).toEqual(good());
  });
  it('accepts the privacy word absent or empty, a null authority head, and no message id', () => {
    expect(parsed(mutate((t) => { t.privacy = 'absent'; t.terms.privacy = 'absent'; t.epoch = 2; }))).toMatchObject({ privacy: 'absent' });
    expect(parsed(mutate((t) => { t.privacy = 'empty'; t.terms.privacy = 0; t.epoch = 2; }))).toMatchObject({ privacy: 'empty' });
    expect(parsed(mutate((t) => { t.authority = null; }))).toMatchObject({ authority: null });
    const noMessage = parsed(mutate((t) => { delete t.highestIds.message; }));
    expect(noMessage.highestIds).toEqual({ restoreGeneration: 1 });
    expect(noMessage.highestIds).not.toHaveProperty('message');
  });
  it('returns a copy, never the raw object', () => {
    const raw = good();
    const t = parsed(raw);
    expect(t).not.toBe(raw);
    expect(t.terms).not.toBe(raw.terms);
  });
  it('refuses a value that is not an object', () => {
    for (const raw of [null, undefined, 1, 'x', [], [good()], true]) expect(refused(raw)).toBe(true);
  });
  it('refuses an unknown key at every level', () => {
    expect(refused(mutate((t) => { t.extra = 1; }))).toBe(true);
    expect(refused(mutate((t) => { t.terms.extra = 1; }))).toBe(true);
    expect(refused(mutate((t) => { t.authority.extra = 1; }))).toBe(true);
    expect(refused(mutate((t) => { t.privacy.extra = 1; }))).toBe(true);
    expect(refused(mutate((t) => { t.highestIds.extra = 1; }))).toBe(true);
    expect(refused(mutate((t) => { t.told.extra = 1; }))).toBe(true);
    expect(refused(mutate((t) => { t.told.latches[0].extra = 1; }))).toBe(true);
  });
  it('refuses a missing required key at every level', () => {
    for (const k of ['v', 'epoch', 'base', 'terms', 'boot', 'authority', 'privacy', 'act', 'highestIds', 'told']) {
      expect(refused(mutate((t) => { delete t[k]; })), k).toBe(true);
    }
    for (const k of ['authority', 'privacy', 'act']) expect(refused(mutate((t) => { delete t.terms[k]; })), `terms.${k}`).toBe(true);
    expect(refused(mutate((t) => { delete t.highestIds.restoreGeneration; }))).toBe(true);
    expect(refused(mutate((t) => { delete t.authority.digest; }))).toBe(true);
    expect(refused(mutate((t) => { delete t.told.latches; }))).toBe(true);
    expect(refused(mutate((t) => { delete t.told.operatorRung; }))).toBe(true);
  });
  it('refuses v other than 1', () => {
    for (const v of [0, 2, '1', null, undefined]) expect(refused(mutate((t) => { t.v = v; }))).toBe(true);
  });
  it('refuses a number that is not a non-negative safe integer', () => {
    for (const n of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '3', null]) {
      expect(refused(mutate((t) => { t.base = n; })), String(n)).toBe(true);
      expect(refused(mutate((t) => { t.terms.authority = n; })), String(n)).toBe(true);
      expect(refused(mutate((t) => { t.highestIds.restoreGeneration = n; })), String(n)).toBe(true);
      expect(refused(mutate((t) => { t.highestIds.message = n; })), String(n)).toBe(true);
    }
  });
  it('refuses a negative term even when the sum still equals the epoch', () => {
    expect(refused(mutate((t) => { t.terms.privacy = -1; t.epoch = 1; }))).toBe(true);
    expect(refused(mutate((t) => { t.terms.authority = -1; t.epoch = 2; }))).toBe(true);
  });
  it('refuses an epoch that is not the base plus the terms, with the privacy term absent counting 0', () => {
    expect(refused(mutate((t) => { t.epoch = 4; }))).toBe(true);
    expect(refused(mutate((t) => { t.epoch = 6; }))).toBe(true);
    expect(refused(mutate((t) => { t.base = 2; }))).toBe(true);
    expect(parsed(mutate((t) => { t.base = 2; t.epoch = 7; })).epoch).toBe(7);
    expect(refused(mutate((t) => { t.privacy = 'absent'; t.terms.privacy = 'absent'; t.epoch = 5; }))).toBe(true);
  });
  it('refuses a head whose sequence is 0 or whose digest is not 64 lowercase hex', () => {
    expect(refused(mutate((t) => { t.authority.sequence = 0; }))).toBe(true);
    for (const d of [D('A'), 'a'.repeat(63), 'a'.repeat(65), D('g'), '', 5, null]) {
      expect(refused(mutate((t) => { t.authority.digest = d; })), String(d)).toBe(true);
      expect(refused(mutate((t) => { t.privacy.digest = d; })), String(d)).toBe(true);
    }
  });
  it('refuses a privacy word that is neither absent, empty nor a head, and an act that is not absent', () => {
    expect(refused(mutate((t) => { t.privacy = 'present'; }))).toBe(true);
    expect(refused(mutate((t) => { t.privacy = null; }))).toBe(true);
    expect(refused(mutate((t) => { t.act = 'present'; }))).toBe(true);
    expect(refused(mutate((t) => { t.act = { sequence: 1, digest: D('1') }; }))).toBe(true);
    expect(refused(mutate((t) => { t.terms.act = 0; }))).toBe(true);
    expect(refused(mutate((t) => { t.terms.privacy = 'empty'; }))).toBe(true);
  });
  it('refuses a boot that is not printable ASCII with no space, 1 to 128 characters', () => {
    for (const b of ['', 'has space', 'tab\t', 'café', 'a'.repeat(129), 7, null]) expect(refused(mutate((t) => { t.boot = b; })), String(b)).toBe(true);
    expect(parsed(mutate((t) => { t.boot = 'a'.repeat(128); })).boot).toHaveLength(128);
  });
  it('refuses told that names an unknown rung, a bad cause, a repeated cause or an unsorted list', () => {
    expect(refused(mutate((t) => { t.told.operatorRung = 'max'; }))).toBe(true);
    expect(refused(mutate((t) => { t.told.latches[0].cap = 'max'; }))).toBe(true);
    expect(refused(mutate((t) => { t.told.latches[0].cause = 'Restore'; }))).toBe(true);
    expect(refused(mutate((t) => { t.told.latches[0].cause = 'a'.repeat(65); }))).toBe(true);
    expect(refused(mutate((t) => { t.told.latches[1].cause = 'restore-detected'; }))).toBe(true);
    expect(refused(mutate((t) => { t.told.latches.reverse(); }))).toBe(true);
    expect(refused(mutate((t) => { t.told.latches = 'none'; }))).toBe(true);
    expect(parsed(mutate((t) => { t.told.operatorRung = null; t.told.latches = []; })).told).toEqual({ operatorRung: null, latches: [] });
    expect(parsed(mutate((t) => { t.told.latches[0].cause = 'a'.repeat(64); t.told.latches[1].cause = 'b'; })).told.latches[0]!.cause).toHaveLength(64);
  });
  it('carries the restore generation and answers nothing partial when it is missing', () => {
    expect(parsed(good()).highestIds.restoreGeneration).toBe(1);
    const r = parseWitnessTuple(mutate((t) => { delete t.highestIds.restoreGeneration; }));
    expect(r).toEqual({ ok: false, why: 'malformed' });
  });
});

describe('witnessKeep', () => {
  const at = (epoch: number, boot: string): WitnessTuple =>
    parsed({ ...good(), epoch, terms: { authority: epoch, privacy: 'absent', act: 'absent' }, privacy: 'absent', boot });
  it('keeps the offer when nothing is held', () => {
    const o = at(3, 'o');
    expect(witnessKeep(null, o)).toBe(o);
  });
  it('takes a higher epoch and never a lower one', () => {
    const held = at(5, 'held');
    expect(witnessKeep(held, at(6, 'offer')).boot).toBe('offer');
    expect(witnessKeep(held, at(4, 'offer'))).toBe(held);
  });
  it('keeps what is held on equal epochs', () => {
    const held = at(5, 'held');
    expect(witnessKeep(held, at(5, 'offer'))).toBe(held);
  });
  it('keeps a higher base even when its total is lower, and never takes a lower base', () => {
    const earlier = at(9, 'earlier');
    const confirmed = parsed({ ...at(1, 'confirmed'), base: 7, epoch: 8 });
    expect(witnessKeep(earlier, confirmed)).toBe(confirmed);
    expect(witnessKeep(confirmed, earlier)).toBe(confirmed);
  });
  it('keeps every measured term against a larger same-base total that loses it', () => {
    const held = parsed(good());
    const worseAuthority = parsed({ ...held, epoch: 6, terms: { ...held.terms, authority: 1, privacy: 5 } });
    const worsePrivacy = parsed({ ...held, epoch: 6, terms: { ...held.terms, authority: 4, privacy: 2 } });
    expect(witnessKeep(held, worseAuthority)).toBe(held);
    expect(witnessKeep(held, worsePrivacy)).toBe(held);
    expect(witnessKeep(held, at(6, 'unwired'))).toBe(held);
    const advances = parsed({ ...held, epoch: 6, terms: { ...held.terms, authority: 3 } });
    expect(witnessKeep(held, advances)).toBe(advances);
  });
});

describe('WITNESS_RUNGS', () => {
  it('lists the four rungs lowest first', () => { expect(WITNESS_RUNGS).toEqual(['off', 'chat', 'advise', 'full']); });
});
