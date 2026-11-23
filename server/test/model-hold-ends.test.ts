// server/test/model-hold-ends.test.ts — the one decider of a hold's end (`holdEnds`), the one reader of what a hold waits
// to be passed (`holdFrom`), and the advance file's carriers of both (`hold.from`, `pending.endsHold`), in
// `shared/model-advance.mjs` (programme model-class-advance, follow-up revert-ends-itself). Pure functions only: the
// writers that act on the answer are `models-op-hold-ends.test.ts`'s. Neutral ids only.
import { describe, it, expect } from 'vitest';
import {
  AdvanceInvalid, HOLD_END_WAIT_MS, RETIRE_GAP_MS, RETIRE_GRACE_MS, chooseCandidate, codexHoldEnd, endHold, heldUnobserved,
  holdEndDue, holdEndEntry, holdEndFor, holdEnds, holdFrom, holdReading, observedAt, parseAdvance, reconcilePending,
  refreshRecord, revertHold,
} from '../../shared/model-advance.mjs';
import type { Advance, Choice, ClassAdvance, HistoryEntry } from '../../shared/model-advance.mjs';
import { STEP_CATALOGUE, STEP_REGISTRY, stepAdvance } from './fixtures/advanceCases.js';

const G56 = 'model-5.6-gamma';
const G61 = 'model-6.1-gamma';
const G62 = 'model-6.2-gamma';
const H_AT = '2026-11-16T20:00:00Z';
const cls = (o: Partial<ClassAdvance> = {}): ClassAdvance => ({ family: 'gamma', hold: null, previous: null, history: [], ...o });
const revertEntry = (from: string | null, to: string | null): HistoryEntry =>
  ({ at: H_AT, how: 'revert', from, to, ok: true, canary: 'not-run' });
const T_MS = STEP_CATALOGUE.fetchedAt * 1000;
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const REG = STEP_REGISTRY as never;
const CAT = STEP_CATALOGUE as never;
const choice = (candidate: string | null, reason: 'newer' | 'retired' | 'empty' | null = 'newer', blocked: string | null = null) =>
  ({ candidate, reason, blocked }) as Choice;

describe('holdFrom: what a hold waits to be passed, one reader', () => {
  it('no hold: null', () => {
    expect(holdFrom(cls(), G56)).toBeNull();
  });
  it("the hold's own from wins over the history and the held id", () => {
    expect(holdFrom(cls({ hold: { at: H_AT, by: 'revert', from: G62 }, history: [revertEntry(G61, G56)] }), G56)).toBe(G62);
  });
  it('no from: the newest successful revert entry whose target is the held id names it', () => {
    const older = revertEntry('model-6-gamma', G56);
    expect(holdFrom(cls({ hold: { at: H_AT, by: 'revert' }, history: [older, revertEntry(G61, G56)] }), G56)).toBe(G61);
  });
  const toOther = revertEntry(G62, G61);
  const failed = { ...revertEntry(G62, G56), ok: false };
  it('a revert entry to another id, a failed one, or one with no from is passed over: a hand hold waits on the held id', () => {
    expect(holdFrom(cls({ hold: { at: H_AT, by: 'hand' }, history: [toOther, failed] }), G56)).toBe(G56);
    expect(holdFrom(cls({ hold: { at: H_AT, by: 'hand' }, history: [revertEntry(null, G56)] }), G56)).toBe(G56);
  });
  it('a REVERT hold nothing derives a from for is null, never the held id it would end on (call 469)', () => {
    expect(holdFrom(cls({ hold: { at: H_AT, by: 'revert' }, history: [toOther, failed] }), G56)).toBeNull();
    expect(holdFrom(cls({ hold: { at: H_AT, by: 'revert' }, history: [revertEntry(null, G56)] }), G56)).toBeNull();
    expect(holdFrom(cls({ hold: { at: H_AT, by: 'revert' } }), G56)).toBeNull();
  });
  it('on an Anthropic lane, which records no revert entry, the newest move from the held id names what the Revert left', () => {
    const move = (from: string, to: string, ok = true): HistoryEntry => ({ at: H_AT, how: 'advance', from, to, ok, canary: 'not-run' });
    const c = cls({ family: 'opus', hold: { at: H_AT, by: 'revert', model: 'claude-opus-9-1' },
      history: [move('claude-opus-9-1', 'claude-opus-9-2'), move('claude-opus-9-2', 'claude-opus-9-3'),
        move('claude-opus-9-1', 'claude-opus-9-4', false)] });
    expect(holdFrom(c, 'claude-opus-9-1', 'alias')).toBe('claude-opus-9-2');
    expect(holdFrom(c, 'claude-opus-9-1'), 'the Codex arm reads revert entries only').toBeNull();
    expect(holdFrom(cls({ family: 'opus', hold: { at: H_AT, by: 'revert', model: 'claude-opus-9-1' } }), 'claude-opus-9-1', 'alias'))
      .toBeNull();
  });
  it('a hand hold: the held id, its history never read (call 469: only a Revert\'s hold is derived)', () => {
    expect(holdFrom(cls({ hold: { at: H_AT, by: 'hand' } }), G56)).toBe(G56);
    expect(holdFrom(cls({ hold: { at: H_AT, by: 'hand' }, history: [revertEntry(G61, G56)] }), G56)).toBe(G56);
    const move: HistoryEntry = { at: H_AT, how: 'advance', from: 'claude-opus-9-1', to: 'claude-opus-9-2', ok: true, canary: 'not-run' };
    expect(holdFrom(cls({ family: 'opus', hold: { at: H_AT, by: 'hand', model: 'claude-opus-9-1' }, history: [move] }),
      'claude-opus-9-1', 'alias')).toBe('claude-opus-9-1');
  });
});

describe('holdEnds, the Codex arm', () => {
  const held = (o: Partial<ClassAdvance['hold'] & object> = {}): ClassAdvance =>
    cls({ hold: { at: H_AT, by: 'revert', from: G61, ...o } });
  it('no hold never ends', () => {
    expect(holdEnds({ arm: 'codex', c: cls(), pin: G56, choice: choice(G62) })).toEqual({ ends: false, why: null, from: null });
  });
  it('a candidate newer than from ends it', () => {
    expect(holdEnds({ arm: 'codex', c: held(), pin: G56, choice: choice(G62) })).toEqual({ ends: true, why: 'newer', from: G61 });
  });
  it('the candidate the Revert left, or one older than it, does not', () => {
    expect(holdEnds({ arm: 'codex', c: held(), pin: G56, choice: choice(G61) })).toEqual({ ends: false, why: null, from: G61 });
    expect(holdEnds({ arm: 'codex', c: held({ from: G62 }), pin: G56, choice: choice(G61) }).ends).toBe(false);
  });
  it('a newer version of another family does not', () => {
    expect(holdEnds({ arm: 'codex', c: held(), pin: G56, choice: choice('model-9-delta') }).ends).toBe(false);
  });
  it('a from that breaks the id grammar never ends on a newer model', () => {
    expect(holdEnds({ arm: 'codex', c: held({ from: 'model-gamma' }), pin: G56, choice: choice(G62) }).ends).toBe(false);
  });
  it('no candidate, or a blocked class, waits', () => {
    expect(holdEnds({ arm: 'codex', c: held(), pin: G56, choice: choice(null, null) }).ends).toBe(false);
    expect(holdEnds({ arm: 'codex', c: held(), pin: G56, choice: choice(G62, null, 'shared-family') }).ends).toBe(false);
  });
  it('a held pin the retire grace has retired ends it, though the fallback is older', () => {
    expect(holdEnds({ arm: 'codex', c: held({ from: G62 }), pin: G61, choice: choice(G56, 'retired') }))
      .toEqual({ ends: true, why: 'retired', from: G62 });
  });
  it('a hand hold ends at the next newer model: its from is the pin', () => {
    expect(holdEnds({ arm: 'codex', c: cls({ hold: { at: H_AT, by: 'hand' } }), pin: G56, choice: choice(G61) }))
      .toEqual({ ends: true, why: 'newer', from: G56 });
  });
  it('a revert hold from an older build reads its from off the history', () => {
    const c = cls({ hold: { at: H_AT, by: 'revert' }, history: [revertEntry(G61, G56)] });
    expect(holdEnds({ arm: 'codex', c, pin: G56, choice: choice(G61) }).ends).toBe(false);
    expect(holdEnds({ arm: 'codex', c, pin: G56, choice: choice(G62) }).ends).toBe(true);
  });
  it('a revert hold nothing derives a from for never ends on a newer model: it carries the candidate as its stamp', () => {
    const bare = cls({ hold: { at: H_AT, by: 'revert' } });
    expect(holdEnds({ arm: 'codex', c: bare, pin: G56, choice: choice(G61) })).toEqual({ ends: false, why: null, from: null, stamp: G61 });
    expect(holdEnds({ arm: 'codex', c: bare, pin: G56, choice: choice(G62) }).ends).toBe(false);
    expect(holdEnds({ arm: 'codex', c: bare, pin: G56, choice: choice(null, null) }))
      .toEqual({ ends: false, why: null, from: null, stamp: null });
  });
  it('a held pin missing past its grace ends it whatever the candidate reason, the model the Revert left included', () => {
    expect(holdEnds({ arm: 'codex', c: held(), pin: G56, choice: choice(G61), retired: true }))
      .toEqual({ ends: true, why: 'retired', from: G61 });
    expect(holdEnds({ arm: 'codex', c: held(), pin: G56, choice: choice(G61), retired: false }).ends).toBe(false);
    expect(holdEnds({ arm: 'codex', c: cls({ hold: { at: H_AT, by: 'revert' } }), pin: G56, choice: choice(G61), retired: true }).ends)
      .toBe(true);
  });
  it('a hold on an empty class with nothing to pass ends at its first candidate', () => {
    expect(holdEnds({ arm: 'codex', c: cls({ hold: { at: H_AT, by: 'hand' } }), pin: null, choice: choice('model-6-delta', 'empty') }))
      .toEqual({ ends: true, why: 'newer', from: null });
  });
});

describe('holdEnds, the alias arm', () => {
  const X1 = 'claude-opus-9-1';
  const X2 = 'claude-opus-9-2';
  const X3 = 'claude-opus-9-3';
  const AFTER = '2026-11-17T00:00:00Z';
  const BEFORE = '2026-11-16T12:00:00Z';
  const row = (id: string | null, evidenceAt: string | null = AFTER, o: Record<string, unknown> = {}) =>
    ({ id, evidenceAt, unlaunchable: null, unobserved: false, ...o });
  const held = cls({ family: 'opus', hold: { at: H_AT, by: 'revert', model: X1, from: X2 } });
  it('a third id observed after the hold ends it', () => {
    expect(holdEnds({ arm: 'alias', c: held, row: row(X3) })).toEqual({ ends: true, why: 'alias-moved', from: X2 });
  });
  it('the id the Revert left, or the held id, never ends it', () => {
    expect(holdEnds({ arm: 'alias', c: held, row: row(X2) }).ends).toBe(false);
    expect(holdEnds({ arm: 'alias', c: held, row: row(X1) }).ends).toBe(false);
  });
  it('evidence older than the hold, or none, never ends it (the unobserved rule)', () => {
    expect(holdEnds({ arm: 'alias', c: held, row: row(X3, BEFORE) }).ends).toBe(false);
    expect(holdEnds({ arm: 'alias', c: held, row: row(X3, null) }).ends).toBe(false);
    expect(holdEnds({ arm: 'alias', c: held, row: row(X3, H_AT) }).ends, 'evidence at the hold\'s own second counts').toBe(true);
  });
  it('a row the resolver marked unobserved, one a launch cannot use, one with no id, or no row: never', () => {
    expect(holdEnds({ arm: 'alias', c: held, row: row(X3, AFTER, { unobserved: true }) }).ends).toBe(false);
    expect(holdEnds({ arm: 'alias', c: held, row: row(X3, AFTER, { unlaunchable: { needs: '9.9.9', laneVersion: '1.0.0' } }) }).ends)
      .toBe(false);
    expect(holdEnds({ arm: 'alias', c: held, row: row(null) }).ends).toBe(false);
    expect(holdEnds({ arm: 'alias', c: held, row: null }).ends).toBe(false);
  });
  it('a revert hold nothing derives a from for never ends, a third id included: it carries the alias id as its stamp', () => {
    const bare = cls({ family: 'opus', hold: { at: H_AT, by: 'revert', model: X1 } });
    expect(holdEnds({ arm: 'alias', c: bare, row: row(X2) })).toEqual({ ends: false, why: null, from: null, stamp: X2 });
    expect(holdEnds({ arm: 'alias', c: bare, row: row(X3) })).toEqual({ ends: false, why: null, from: null, stamp: X3 });
    expect(holdEnds({ arm: 'alias', c: bare, row: row(X2, BEFORE) }).stamp, 'older evidence still names the alias').toBe(X2);
    expect(holdEnds({ arm: 'alias', c: bare, row: row(X1) }).stamp).toBeNull();
    expect(holdEnds({ arm: 'alias', c: bare, row: row(null) }).stamp).toBeNull();
    expect(holdEnds({ arm: 'alias', c: bare, row: null }).stamp).toBeNull();
    expect(holdEnds({ arm: 'alias', c: bare, row: row(X2, AFTER, { unlaunchable: { needs: '9.9.9', laneVersion: '1.0.0' } }) }).stamp)
      .toBeNull();
  });
  it('a revert hold an older build wrote reads its from off the newest move from the held id', () => {
    const c = cls({ family: 'opus', hold: { at: H_AT, by: 'revert', model: X1 },
      history: [{ at: BEFORE, how: 'advance', from: X1, to: X2, ok: true, canary: 'not-run' }] });
    expect(holdEnds({ arm: 'alias', c, row: row(X2) })).toEqual({ ends: false, why: null, from: X2 });
    expect(holdEnds({ arm: 'alias', c, row: row(X3) })).toEqual({ ends: true, why: 'alias-moved', from: X2 });
  });
  it('a stamped revert hold ends only on a third id seen after the hold', () => {
    const stamped = cls({ family: 'opus', hold: { at: H_AT, by: 'revert', model: X1, from: X2 } });
    expect(holdEnds({ arm: 'alias', c: stamped, row: row(X2) }).ends).toBe(false);
    expect(holdEnds({ arm: 'alias', c: stamped, row: row(X3) }).ends).toBe(true);
  });
  it('a hand hold waits to pass the held id: another id after the hold ends it', () => {
    const hand = cls({ family: 'opus', hold: { at: H_AT, by: 'hand', model: X1 } });
    expect(holdEnds({ arm: 'alias', c: hand, row: row(X2) })).toEqual({ ends: true, why: 'alias-moved', from: X1 });
  });
  it('heldUnobserved is the resolver\'s rule', () => {
    expect(heldUnobserved(BEFORE, { at: H_AT })).toBe(true);
    expect(heldUnobserved(H_AT, { at: H_AT })).toBe(false);
    expect(heldUnobserved(null, { at: H_AT })).toBe(true);
    expect(heldUnobserved(BEFORE, null)).toBe(false);
  });
});

describe('the wait before the health reading reports an end that has come', () => {
  it('is one refresh plus its slack, RETIRE_GAP_MS', () => {
    expect(HOLD_END_WAIT_MS).toBe(RETIRE_GAP_MS);
  });
  it('is due only once that long has passed since the sighting, and never on a time that does not parse', () => {
    const at = '2026-11-17T00:00:00Z';
    expect(holdEndDue(at, Date.parse(at) + HOLD_END_WAIT_MS - 1000)).toBe(false);
    expect(holdEndDue(at, Date.parse(at) + HOLD_END_WAIT_MS)).toBe(true);
    expect(holdEndDue(null, Date.parse(at) + 10 * HOLD_END_WAIT_MS)).toBe(false);
    expect(holdEndDue('yesterday', Date.parse(at) + 10 * HOLD_END_WAIT_MS)).toBe(false);
  });
});

describe('the advance file carries a hold\'s from and an intent that ends a hold', () => {
  it('parseAdvance reads hold.from as a model id, and refuses anything else', () => {
    const ok = stepAdvance({ opus: { hold: { at: H_AT, by: 'revert', from: G61 } } });
    expect(parseAdvance(ok).classes.opus.hold).toEqual({ at: H_AT, by: 'revert', from: G61 });
    for (const bad of [null, 7, '', 'not an id']) {
      const f = stepAdvance({ opus: { hold: { at: H_AT, by: 'revert', from: bad } } });
      expect(() => parseAdvance(f)).toThrow(AdvanceInvalid);
    }
  });
  it('parseAdvance reads pending.endsHold as true only', () => {
    const p = { class: 'opus', from: G56, to: G62, effortFrom: 'max', effortTo: 'xhigh', at: H_AT };
    expect(parseAdvance(stepAdvance({}, { ...p, endsHold: true })).pending).toMatchObject({ endsHold: true });
    expect(() => parseAdvance(stepAdvance({}, { ...p, endsHold: false }))).toThrow(AdvanceInvalid);
  });
  it('a landed intent that ends a hold clears it with the move it records; one that does not keeps it', () => {
    const registry = { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, opus: G62 } };
    const p = { class: 'opus', from: G56, to: G62, effortFrom: 'max', effortTo: 'xhigh', at: H_AT };
    const hold = { at: H_AT, by: 'revert', from: G61 };
    const ending = parseAdvance(stepAdvance({ opus: { hold } }, { ...p, endsHold: true })) as Advance;
    const r = reconcilePending(ending, registry as never);
    expect(r.recovered).toBe(true);
    expect(r.advance.classes.opus.hold).toBeNull();
    expect(r.advance.classes.opus.history.at(-1)).toMatchObject({ how: 'advance', from: G56, to: G62, recovered: true });
    const plain = parseAdvance(stepAdvance({ opus: { hold } }, p)) as Advance;
    expect(reconcilePending(plain, registry as never).advance.classes.opus.hold).toEqual(hold);
  });
  it('endHold clears a Codex hold alone; an alias hold records releasedAt and drops the release evidence', () => {
    const adv = parseAdvance(stepAdvance({ opus: { hold: { at: H_AT, by: 'revert', from: G61 },
      releasedHold: { model: G56, at: '2026-11-15T00:00:00Z' }, releasedAt: '2026-11-15T00:00:00Z' } })) as Advance;
    const codex = endHold(adv, 'opus', '2026-11-17T06:00:00Z');
    expect(codex.classes.opus.hold).toBeNull();
    expect(codex.classes.opus.releasedAt).toBe('2026-11-15T00:00:00Z');
    expect(adv.classes.opus.hold, 'a copy: the input is untouched').not.toBeNull();
    const alias = endHold(adv, 'opus', '2026-11-17T06:00:00Z', { alias: true });
    expect(alias.classes.opus).toMatchObject({ hold: null, releasedAt: '2026-11-17T06:00:00Z' });
    expect(alias.classes.opus.releasedHold).toBeUndefined();
  });
});

describe('the op\'s helpers over the decider', () => {
  const held = cls({ hold: { at: H_AT, by: 'revert', from: G61 } });
  it('revertHold names what the Revert left; a re-run keeps what the hold it replaces waited for; an equal id is left out', () => {
    expect(revertHold(cls(), G61, G56, H_AT)).toEqual({ at: H_AT, by: 'revert', from: G61 });
    expect(revertHold(held, G56, G56, '2026-11-17T00:00:00Z')).toEqual({ at: '2026-11-17T00:00:00Z', by: 'revert', from: G61 });
    expect(revertHold(cls(), G56, G56, H_AT)).toEqual({ at: H_AT, by: 'revert' });
    expect(revertHold(cls(), null, G56, H_AT)).toEqual({ at: H_AT, by: 'revert' });
  });
  const at = { registry: REG, catalogue: CAT, cls: 'opus' as const, nowMs: T_MS };
  it('holdEndFor: null with no hold; ends only on the candidate the commit was planned on', () => {
    expect(holdEndFor({ ...at, c: cls(), choice: choice(G62), to: G62 })).toBeNull();
    expect(holdEndFor({ ...at, c: held, choice: choice(G62), to: G62 })).toEqual({ ends: true, why: 'newer', from: G61 });
    expect(holdEndFor({ ...at, c: held, choice: choice(G62), to: G61 })).toEqual({ ends: false, why: null, from: G61 });
    expect(holdEndFor({ ...at, c: held, choice: choice(G61), to: G61 })?.ends).toBe(false);
  });
  it('holdEndEntry says why a move ended a hold, and nothing for any other move', () => {
    expect(holdEndEntry(null, G56, G62)).toEqual({});
    expect(holdEndEntry({ ends: false, why: null, from: G61 }, G56, G62)).toEqual({});
    expect(holdEndEntry({ ends: true, why: 'newer', from: G61 }, G56, G62)).toEqual({ reason: `the hold ended: ${G62} is newer than ${G61}` });
    expect(holdEndEntry({ ends: true, why: 'retired', from: G62 }, G61, G56))
      .toEqual({ reason: `the hold ended: ${G61} left the catalogue past its grace` });
  });
  it('holdReading answers a waiting row, or a behind row with its sighting and whether it is due', () => {
    const seen = observedAt(STEP_CATALOGUE as never);
    expect(holdReading({ ...at, c: held, choice: choice(G61) }))
      .toEqual({ waiting: { class: 'opus', pin: G56, hold: { at: H_AT, by: 'revert' }, from: G61 } });
    expect(holdReading({ ...at, c: held, choice: choice(G62) }))
      .toEqual({ behind: { class: 'opus', pin: G56, newer: G62, reason: 'newer', hold: { at: H_AT, by: 'revert' }, from: G61,
        since: seen, due: false } });
    expect(holdReading({ ...at, c: held, choice: choice(G62), nowMs: T_MS + HOLD_END_WAIT_MS }).behind?.due).toBe(true);
    expect(holdReading({ ...at, c: cls({ hold: { at: H_AT, by: 'revert' } }), choice: choice(G61) }))
      .toEqual({ waiting: { class: 'opus', pin: G56, hold: { at: H_AT, by: 'revert' }, from: null } });
  });
});

describe('codexHoldEnd reads the retire grace off the class\'s own record (call 469)', () => {
  // The held pin, model-5.6-gamma, has left the catalogue; the model the Revert left, model-6.1-gamma, is still listed, so
  // the family rule answers it `newer` and never `retired`: only the grace on the pin itself ends the hold.
  const catalogue = { ...STEP_CATALOGUE, models: STEP_CATALOGUE.models.filter((m) => m.id !== G56) } as never;
  const seen = observedAt(catalogue) as string;
  const ask = (runMs: number) => {
    const missing = { model: G56, since: iso(T_MS - runMs), seen };
    const c = cls({ hold: { at: H_AT, by: 'revert', from: G61 }, missing } as never);
    const choice = chooseCandidate({ registry: REG, catalogue, cls: 'opus', family: 'gamma', missing, nowMs: T_MS });
    expect(choice, 'the family rule answers the model the Revert left, newer').toMatchObject({ candidate: G61, reason: 'newer' });
    return codexHoldEnd({ registry: REG, catalogue, cls: 'opus', c, choice, nowMs: T_MS });
  };
  it('the pin gone past the grace, with the model the Revert left listed, ends the hold', () => {
    expect(ask(RETIRE_GRACE_MS)).toEqual({ ends: true, why: 'retired', from: G61 });
  });
  it('inside the grace it stays held', () => {
    expect(ask(RETIRE_GRACE_MS - 3_600_000)).toEqual({ ends: false, why: null, from: G61 });
  });
});

describe('the hourly refresh stamps a revert hold nothing derives a from for (call 469)', () => {
  const rec = (adv: Advance, catalogue: unknown = STEP_CATALOGUE) =>
    refreshRecord(adv, { registry: REG, catalogue: catalogue as never, fallbacks: [], nowMs: T_MS });
  it('records the class\'s candidate as its from, in the same write, and keeps the hold', () => {
    const adv = parseAdvance(stepAdvance({ opus: { hold: { at: H_AT, by: 'revert' } } })) as Advance;
    const r = rec(adv);
    expect(r.changed).toBe(true);
    expect(r.advance.classes.opus.hold).toEqual({ at: H_AT, by: 'revert', from: G61 });
    expect(adv.classes.opus.hold, 'a copy: the input is untouched').toEqual({ at: H_AT, by: 'revert' });
  });
  it('stamps nothing on a hand hold, a revert hold with a from or one its history derives, or from a stale catalogue', () => {
    for (const hold of [{ at: H_AT, by: 'hand' }, { at: H_AT, by: 'revert', from: G62 }]) {
      expect(rec(parseAdvance(stepAdvance({ opus: { hold } })) as Advance).changed).toBe(false);
    }
    const derived = parseAdvance(stepAdvance({ opus: { hold: { at: H_AT, by: 'revert' }, history: [revertEntry(G62, G56)] } }));
    expect(rec(derived as Advance).changed).toBe(false);
    const bare = parseAdvance(stepAdvance({ opus: { hold: { at: H_AT, by: 'revert' } } })) as Advance;
    expect(rec(bare, { ...STEP_CATALOGUE, stale: true }).changed).toBe(false);
  });
});
