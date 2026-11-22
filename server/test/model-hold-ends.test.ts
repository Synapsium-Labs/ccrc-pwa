// server/test/model-hold-ends.test.ts — the one decider of a hold's end (`holdEnds`), the one reader of what a hold waits
// to be passed (`holdFrom`), and the advance file's carriers of both (`hold.from`, `pending.endsHold`), in
// `shared/model-advance.mjs` (programme model-class-advance, follow-up revert-ends-itself). Pure functions only: the
// writers that act on the answer are `models-op-hold-ends.test.ts`'s. Neutral ids only.
import { describe, it, expect } from 'vitest';
import {
  AdvanceInvalid, HOLD_END_WAIT_MS, RETIRE_GAP_MS, endHold, heldUnobserved, holdEndDue, holdEndEntry, holdEndFor, holdEnds,
  holdFrom, holdReading, parseAdvance, reconcilePending, revertHold,
} from '../../shared/model-advance.mjs';
import type { Advance, Choice, ClassAdvance, HistoryEntry } from '../../shared/model-advance.mjs';
import { STEP_REGISTRY, stepAdvance } from './fixtures/advanceCases.js';

const G56 = 'model-5.6-gamma';
const G61 = 'model-6.1-gamma';
const G62 = 'model-6.2-gamma';
const H_AT = '2026-11-16T20:00:00Z';
const cls = (o: Partial<ClassAdvance> = {}): ClassAdvance => ({ family: 'gamma', hold: null, previous: null, history: [], ...o });
const revertEntry = (from: string | null, to: string | null): HistoryEntry =>
  ({ at: H_AT, how: 'revert', from, to, ok: true, canary: 'not-run' });
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
  it('a revert entry to another id, a failed one, or one with no from is passed over: the held id', () => {
    const toOther = revertEntry(G62, G61);
    const failed = { ...revertEntry(G62, G56), ok: false };
    expect(holdFrom(cls({ hold: { at: H_AT, by: 'revert' }, history: [toOther, failed] }), G56)).toBe(G56);
    expect(holdFrom(cls({ hold: { at: H_AT, by: 'revert' }, history: [revertEntry(null, G56)] }), G56)).toBe(G56);
  });
  it('a hand hold with no history: the held id', () => {
    expect(holdFrom(cls({ hold: { at: H_AT, by: 'hand' } }), G56)).toBe(G56);
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
  it('a hand hold, and a revert hold an older build wrote, wait to pass the held id: another id after the hold ends them', () => {
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
  it('holdEndFor: null with no hold; ends only on the candidate the commit was planned on', () => {
    expect(holdEndFor({ c: cls(), pin: G56, choice: choice(G62), to: G62 })).toBeNull();
    expect(holdEndFor({ c: held, pin: G56, choice: choice(G62), to: G62 })).toEqual({ ends: true, why: 'newer', from: G61 });
    expect(holdEndFor({ c: held, pin: G56, choice: choice(G62), to: G61 })).toEqual({ ends: false, why: null, from: G61 });
    expect(holdEndFor({ c: held, pin: G56, choice: choice(G61), to: G61 })?.ends).toBe(false);
  });
  it('holdEndEntry says why a move ended a hold, and nothing for any other move', () => {
    expect(holdEndEntry(null, G56, G62)).toEqual({});
    expect(holdEndEntry({ ends: false, why: null, from: G61 }, G56, G62)).toEqual({});
    expect(holdEndEntry({ ends: true, why: 'newer', from: G61 }, G56, G62)).toEqual({ reason: `the hold ended: ${G62} is newer than ${G61}` });
    expect(holdEndEntry({ ends: true, why: 'retired', from: G62 }, G61, G56))
      .toEqual({ reason: `the hold ended: ${G61} left the catalogue past its grace` });
  });
  it('holdReading answers a waiting row, or a behind row with its sighting and whether it is due', () => {
    const at = '2026-11-17T00:00:00Z';
    expect(holdReading({ c: held, cls: 'opus', pin: G56, choice: choice(G61), sinceAt: at, nowMs: Date.parse(at) }))
      .toEqual({ waiting: { class: 'opus', pin: G56, hold: { at: H_AT, by: 'revert' }, from: G61 } });
    expect(holdReading({ c: held, cls: 'opus', pin: G56, choice: choice(G62), sinceAt: at, nowMs: Date.parse(at) }))
      .toEqual({ behind: { class: 'opus', pin: G56, newer: G62, reason: 'newer', hold: { at: H_AT, by: 'revert' }, from: G61,
        since: at, due: false } });
    expect(holdReading({ c: held, cls: 'opus', pin: G56, choice: choice(G62), sinceAt: at,
      nowMs: Date.parse(at) + HOLD_END_WAIT_MS }).behind?.due).toBe(true);
  });
});
