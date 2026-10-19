// The advance file's format (auto-advance spec §2.1, D13, D21): parse, serialize, backfill, history, failure
// dedup and the pending intent — `shared/model-advance.mjs`'s file half. Pure: nothing here reads or writes a
// file; `deploy/models-op.mjs`'s one writer is measured through its ops (Tasks 5 and 6). Neutral ids only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AdvanceInvalid, HISTORY_CAP, REASON_MAX, backfillAdvance, familyOf, heldBackOf, lastMoveOf, parseAdvance,
  reconcilePending, recordFailure, recordMove, serializeAdvance,
} from '../../shared/model-advance.mjs';
import type { Advance, HandPending, HistoryEntry } from '../../shared/model-advance.mjs';
import { CLASSES } from '../../shared/models.js';
import type { Registry } from '../../shared/models.js';
import { ADVANCE_EXAMPLE, ADV_REGISTRY, ADV_SEEDS, reg } from './fixtures/advanceCases.js';
import { SEEDED } from './fixtures/modelCases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const OP = path.join(REPO, 'deploy', 'models-op.mjs');
const PROBE = path.join(here, 'types', 'ok', 'model-advance.ts');

/** A deep, freely editable copy of the example (`any`: each row below breaks one field of a valid file). */
const example = (): any => JSON.parse(JSON.stringify(ADVANCE_EXAMPLE));
const PENDING: NonNullable<Advance['pending']> = {
  class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma', effortFrom: 'max', effortTo: 'xhigh',
  at: '2026-10-21T14:05:11Z',
};
/** A hand set-class's intent: the fourth class set to an alpha model the first class pinned, which one model, one
 *  class empties. */
const HAND: HandPending = {
  how: 'hand', class: 'fable', from: null, to: 'model-5.6-alpha', emptied: ['haiku'], at: '2026-10-21T14:05:11Z',
};
const entry = (o: Partial<HistoryEntry> = {}): HistoryEntry => ({
  at: '2026-10-21T14:05:11Z', how: 'advance', from: 'model-5.6-gamma', to: 'model-6.1-gamma', ok: true,
  canary: 'passed', ...o,
});
const fresh = (): Advance => backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: null });

describe('parseAdvance and serializeAdvance', () => {
  it('the complete example parses, and serializes back byte for byte', () => {
    const text = serializeAdvance(ADVANCE_EXAMPLE);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "classes": {');
    expect(serializeAdvance(parseAdvance(JSON.parse(text)))).toBe(text);
  });

  it("spells the bytes the one writer puts on disk: writeAdvance writes through writeJsonFile (D-5783), whose 2-space JSON and trailing newline these are", () => {
    // `writeJsonFile` stringifies the object itself, so `serializeAdvance` is how a reader or a test spells the
    // file's bytes, and the two must agree: one half measured here, the other read off the writer's one write.
    expect(serializeAdvance(ADVANCE_EXAMPLE)).toBe(`${JSON.stringify(ADVANCE_EXAMPLE, null, 2)}\n`);
    const src = readFileSync(OP, 'utf8');
    const at = src.indexOf('function writeJsonFile(');
    expect(at, 'deploy/models-op.mjs has its one JSON write').toBeGreaterThan(-1);
    expect(src.slice(at, src.indexOf('\n}\n', at)))
      .toContain('writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\\n`, { mode: 0o600 });');
  });

  it("a pending intent parses too: an automatic advance's, and a hand set-class's, `none` and nothing emptied included", () => {
    const a = example();
    a.pending = { ...PENDING };
    expect(parseAdvance(a).pending).toEqual(PENDING);
    a.pending = { ...HAND };
    expect(parseAdvance(a).pending).toEqual(HAND);
    const none = { ...HAND, class: 'opus', from: 'model-5.6-gamma', to: null, emptied: [] };
    a.pending = { ...none };
    expect(parseAdvance(a).pending).toEqual(none);
  });

  it.each([
    ['a top level that is not an object', () => [], ''],
    ['v: 2', (a) => { a.v = 2; }, 'v'],
    ['no classes', (a) => { delete a.classes; }, 'classes'],
    ['a class word that is not one of the four', (a) => { a.classes.turbo = a.classes.haiku; }, 'classes.turbo'],
    ['a missing class', (a) => { delete a.classes.opus; }, 'classes.opus'],
    ['a family containing -', (a) => { a.classes.sonnet.family = 'beta-mini'; }, 'classes.sonnet.family'],
    ['a hold that is not an object', (a) => { a.classes.fable.hold = 'yes'; }, 'classes.fable.hold'],
    ['a hold at a time with no Z', (a) => { a.classes.fable.hold.at = '2026-10-22T08:00:00+00:00'; }, 'classes.fable.hold.at'],
    ['hold.by: pwa', (a) => { a.classes.fable.hold.by = 'pwa'; }, 'classes.fable.hold.by'],
    ['a previous that is a bare id', (a) => { a.classes.opus.previous = 'model-5.6-gamma'; }, 'classes.opus.previous'],
    ['a previous.model that is not an id', (a) => { a.classes.opus.previous.model = 'not an id'; }, 'classes.opus.previous.model'],
    ['a previous.effort that is a number', (a) => { a.classes.opus.previous.effort = 7; }, 'classes.opus.previous.effort'],
    ['a history that is not a list', (a) => { a.classes.haiku.history = {}; }, 'classes.haiku.history'],
    ['11 history entries', (a) => { a.classes.haiku.history = Array.from({ length: 11 }, () => entry()); }, 'classes.haiku.history'],
    ['an entry that is not an object', (a) => { a.classes.opus.history[0] = 'x'; }, 'classes.opus.history[0]'],
    ['an entry at a time with no Z', (a) => { a.classes.opus.history[0].at = '2026-10-21 14:05:11'; }, 'classes.opus.history[0].at'],
    ['how: auto', (a) => { a.classes.opus.history[0].how = 'auto'; }, 'classes.opus.history[0].how'],
    ['a from that is not an id', (a) => { a.classes.opus.history[0].from = 'not an id'; }, 'classes.opus.history[0].from'],
    ['a to that is a number', (a) => { a.classes.opus.history[0].to = 7; }, 'classes.opus.history[0].to'],
    ['an ok that is not a boolean', (a) => { a.classes.opus.history[0].ok = 'true'; }, 'classes.opus.history[0].ok'],
    ['a canary word it does not know', (a) => { a.classes.opus.history[0].canary = 'skipped'; }, 'classes.opus.history[0].canary'],
    ['an effort that is not {from, to}', (a) => { a.classes.opus.history[0].effort = { from: 7 }; }, 'classes.opus.history[0].effort'],
    ['a reason outside printable ASCII', (a) => { a.classes.sonnet.history[0].reason = 'upstream érror'; }, 'classes.sonnet.history[0].reason'],
    ['a reason one character over REASON_MAX', (a) => { a.classes.sonnet.history[0].reason = 'x'.repeat(REASON_MAX + 1); }, 'classes.sonnet.history[0].reason'],
    ['tries on an entry that is not a failed advance', (a) => { a.classes.opus.history[0].tries = 2; }, 'classes.opus.history[0].tries'],
    ['lastAt on an entry that is not a failed advance', (a) => { a.classes.opus.history[0].lastAt = '2026-10-22T12:05:09Z'; }, 'classes.opus.history[0].lastAt'],
    ['a recovered that is not a boolean', (a) => { a.classes.opus.history[0].recovered = 'yes'; }, 'classes.opus.history[0].recovered'],
    ['no pending key at all', (a) => { delete a.pending; }, 'pending'],
    ['a pending class it does not know', (a) => { a.pending = { ...PENDING, class: 'turbo' }; }, 'pending.class'],
    ['a pending from that is not an id', (a) => { a.pending = { ...PENDING, from: 'not an id' }; }, 'pending.from'],
    ['a pending with no to', (a) => { a.pending = { ...PENDING, to: null }; }, 'pending.to'],
    ['a pending effortFrom that is a number', (a) => { a.pending = { ...PENDING, effortFrom: 7 }; }, 'pending.effortFrom'],
    ['a pending effortTo that is a number', (a) => { a.pending = { ...PENDING, effortTo: 7 }; }, 'pending.effortTo'],
    ['a pending at a time with no Z', (a) => { a.pending = { ...PENDING, at: 'now' }; }, 'pending.at'],
    ['a pending how it does not know', (a) => { a.pending = { ...PENDING, how: 'auto' }; }, 'pending.how'],
    ['a hand pending whose to is a number', (a) => { a.pending = { ...HAND, to: 7 }; }, 'pending.to'],
    ['a hand pending with no emptied list', (a) => { a.pending = { ...HAND, emptied: undefined }; }, 'pending.emptied'],
    ['a hand pending that empties a class it does not know', (a) => { a.pending = { ...HAND, emptied: ['turbo'] }; }, 'pending.emptied'],
    ['a hand pending that empties its own class', (a) => { a.pending = { ...HAND, emptied: ['fable'] }; }, 'pending.emptied'],
    ['a hand pending that empties one class twice', (a) => { a.pending = { ...HAND, emptied: ['haiku', 'haiku'] }; }, 'pending.emptied'],
    ['a hand pending to none that empties another class', (a) => { a.pending = { ...HAND, to: null }; }, 'pending.emptied'],
  ] as [string, (a: any) => unknown, string][])('refuses %s, as AdvanceInvalid naming the field', (_why, edit, field) => {
    const a = example();
    const made = edit(a);
    try {
      parseAdvance(made === undefined ? a : made);
      expect.unreachable('parseAdvance accepted it');
    } catch (e) {
      expect(e).toBeInstanceOf(AdvanceInvalid);
      expect((e as AdvanceInvalid).field).toBe(field);
    }
  });

  it('keeps keys this build does not know — at the top level, per class and per entry — through every function', () => {
    const a = example();
    a.note = 'kept';
    a.classes.opus.pinnedBy = 'operator';
    a.classes.opus.history[0].source = 'probe';
    const parsed = parseAdvance(a);
    const back = JSON.parse(serializeAdvance(parsed));
    expect([back.note, back.classes.opus.pinnedBy, back.classes.opus.history[0].source]).toEqual(['kept', 'operator', 'probe']);
    const moved = recordMove(parsed, 'opus', entry({ at: '2026-10-23T09:00:00Z' }));
    expect([moved['note'], moved.classes.opus['pinnedBy'], moved.classes.opus.history[0]!['source']])
      .toEqual(['kept', 'operator', 'probe']);
  });

  it('answers copies: editing what parseAdvance or recordMove returns never edits what they were given', () => {
    const a = example();
    parseAdvance(a).classes.opus.family = 'zeta';
    expect(a.classes.opus.family).toBe('gamma');
    const before = serializeAdvance(ADVANCE_EXAMPLE);
    recordMove(ADVANCE_EXAMPLE, 'opus', entry({ at: '2026-10-23T09:00:00Z' }));
    expect(serializeAdvance(ADVANCE_EXAMPLE)).toBe(before);
  });
});

describe('history', () => {
  it('recordMove appends the newest last and keeps the newest ten', () => {
    let a = fresh();
    for (let i = 0; i < HISTORY_CAP + 2; i += 1) {
      a = recordMove(a, 'opus', entry({ at: `2026-10-${String(10 + i).padStart(2, '0')}T00:00:00Z` }));
    }
    expect(a.classes.opus.history).toHaveLength(HISTORY_CAP);
    expect(a.classes.opus.history[0]!.at).toBe('2026-10-12T00:00:00Z');
    expect(a.classes.opus.history[HISTORY_CAP - 1]!.at).toBe('2026-10-21T00:00:00Z');
    expect(() => parseAdvance(a)).not.toThrow();
  });

  it('a repeated failure of the same move is ONE entry: tries and lastAt move and isNew is false (D-5192)', () => {
    const f = { from: 'model-6-beta', to: 'model-6.1-beta', reason: 'http 500: upstream error' };
    const one = recordFailure(fresh(), 'sonnet', { ...f, at: '2026-10-22T10:05:12Z' });
    const first = { at: '2026-10-22T10:05:12Z', how: 'advance', from: 'model-6-beta', to: 'model-6.1-beta', ok: false,
      canary: 'failed', reason: 'http 500: upstream error', tries: 1, lastAt: '2026-10-22T10:05:12Z' };
    expect(one.isNew).toBe(true);
    expect(one.advance.classes.sonnet.history).toEqual([first]);
    const two = recordFailure(one.advance, 'sonnet', { ...f, at: '2026-10-22T11:05:12Z', reason: 'http 503: busy' });
    expect(two.isNew).toBe(false);
    expect(two.advance.classes.sonnet.history)
      .toEqual([{ ...first, tries: 2, lastAt: '2026-10-22T11:05:12Z', reason: 'http 503: busy' }]);
    const other = recordFailure(two.advance, 'sonnet', { ...f, to: 'model-7-beta', at: '2026-10-22T12:05:12Z' });
    expect(other.isNew, 'a different `to` is a different move').toBe(true);
    expect(other.advance.classes.sonnet.history).toHaveLength(2);
    const after = recordMove(two.advance, 'sonnet', entry({ from: 'model-6-beta', to: 'model-6.1-beta', at: '2026-10-22T13:00:00Z' }));
    expect(recordFailure(after, 'sonnet', { ...f, at: '2026-10-22T14:00:00Z' }).isNew, 'a failure after a success is new').toBe(true);
  });

  it("every failed entry it writes says the canary failed, the one it updates included: a caller whose canary passed says so itself (W2 Task 9's fail)", () => {
    const a = fresh();
    // What W2's `fail` leaves after a failed materialise: a failed advance whose canary passed.
    a.classes.opus.history = [{ at: '2026-10-22T10:05:12Z', how: 'advance', from: 'model-5.6-gamma', to: 'model-6.1-gamma',
      ok: false, canary: 'passed', reason: 'materialise-failed', tries: 1, lastAt: '2026-10-22T10:05:12Z' }];
    const r = recordFailure(a, 'opus', { at: '2026-10-22T11:05:12Z', from: 'model-5.6-gamma', to: 'model-6.1-gamma',
      reason: 'http 500: upstream error' });
    expect(r.isNew).toBe(false);
    expect(r.advance.classes.opus.history).toEqual([{ ...a.classes.opus.history[0], canary: 'failed', tries: 2,
      lastAt: '2026-10-22T11:05:12Z', reason: 'http 500: upstream error' }]);
  });

  it('a reason is kept printable ASCII and at most REASON_MAX characters, so the file it lands in always reads back', () => {
    const r = recordFailure(fresh(), 'opus', { at: '2026-10-22T10:05:12Z', from: 'model-5.6-gamma', to: 'model-6.1-gamma',
      reason: `upstream érror ${'x'.repeat(300)}` });
    const reason = r.advance.classes.opus.history[0]!.reason!;
    expect(reason).toHaveLength(REASON_MAX);
    expect(reason).toMatch(/^[\x20-\x7e]+$/);
    expect(() => parseAdvance(r.advance)).not.toThrow();
  });
});

describe('reconcilePending — the crash gap (D-5188; Review Focus: the crash gap)', () => {
  const withPending = (): Advance => ({ ...fresh(), pending: { ...PENDING } });

  it('a move that landed (the pin is `to`) is recorded as landed, with recovered and previous, and the intent cleared', () => {
    const r = reconcilePending(withPending(), reg({ ...ADV_REGISTRY.classes, opus: 'model-6.1-gamma' }));
    expect(r.recovered).toBe(true);
    expect(r.advance.pending).toBeNull();
    expect(r.advance.classes.opus.previous).toEqual({ model: 'model-5.6-gamma', effort: 'max' });
    expect(r.advance.classes.opus.history).toEqual([{ at: PENDING.at, how: 'advance', from: 'model-5.6-gamma',
      to: 'model-6.1-gamma', ok: true, canary: 'passed', effort: { from: 'max', to: 'xhigh' }, recovered: true }]);
  });

  it('a move that never landed (the pin is still `from`) is dropped: no entry, and previous untouched', () => {
    const r = reconcilePending(withPending(), ADV_REGISTRY);
    expect(r.recovered).toBe(false);
    expect(r.advance.pending).toBeNull();
    expect(r.advance.classes.opus.history).toEqual([]);
    expect(r.advance.classes.opus.previous).toBeNull();
  });

  it('no pending intent: the advance comes back as it was', () => {
    const a = fresh();
    expect(reconcilePending(a, ADV_REGISTRY)).toEqual({ advance: a, recovered: false });
  });
});

describe('reconcilePending — a hand set-class cut short (D-5188; Review Focus: the crash gap, a hand set-class cut short)', () => {
  /** The seeded families, and a `previous` from an earlier automatic advance the hand move must leave alone. */
  const seeded = (): Advance => {
    const a = backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: ADV_SEEDS });
    a.classes.opus.previous = { model: 'model-5-gamma', effort: 'max' };
    return a;
  };
  const withHand = (p: HandPending): Advance => ({ ...seeded(), pending: { ...p, emptied: [...p.emptied] } });
  const handEntry = (from: string | null, to: string | null): HistoryEntry =>
    ({ at: HAND.at, how: 'hand', from, to, ok: true, canary: 'not-run' });
  const pins = (classes: Partial<Registry['classes']>): Registry => reg({ ...ADV_REGISTRY.classes, ...classes });
  const OPUS = { ...HAND, class: 'opus' as const, from: 'model-5.6-gamma', emptied: [] };

  it('a hand move that landed is recorded as hand, with no recovered mark, its family taken from the new pin and previous left alone', () => {
    const r = reconcilePending(withHand({ ...OPUS, to: 'model-6-delta' }), pins({ opus: 'model-6-delta' }));
    expect(r.recovered).toBe(true);
    expect(r.advance.pending).toBeNull();
    expect(r.advance.classes.opus.history).toEqual([handEntry('model-5.6-gamma', 'model-6-delta')]);
    expect(r.advance.classes.opus.family).toBe('delta');
    expect(r.advance.classes.opus.previous).toEqual({ model: 'model-5-gamma', effort: 'max' });
  });

  it.each([
    ['none', null],
    ['a pin that breaks the id grammar', 'vendor-6-alpha-mini'],
  ] as [string, string | null][])('a hand move to %s that landed clears the class\'s family (D-5195)', (_why, to) => {
    const r = reconcilePending(withHand({ ...OPUS, to }), pins({ opus: to }));
    expect(r.advance.classes.opus.history).toEqual([handEntry('model-5.6-gamma', to)]);
    expect(r.advance.classes.opus.family).toBeNull();
  });

  it("the named class whose pin did not move has its family rewritten from that pin and records no move: none on a class already empty", () => {
    const r = reconcilePending(withHand({ ...HAND, from: null, to: null, emptied: [] }), ADV_REGISTRY);
    expect(r.recovered).toBe(true);
    expect(r.advance.classes.fable.family).toBeNull();
    expect(r.advance.classes.fable.history).toEqual([]);
  });

  it('each class one model, one class emptied is recorded too, from the moved model to none, its family cleared; one a later change refilled is left as it is', () => {
    const r = reconcilePending(withHand(HAND), pins({ haiku: null, fable: 'model-5.6-alpha' }));
    expect(r.advance.classes.fable.history).toEqual([handEntry(null, 'model-5.6-alpha')]);
    expect(r.advance.classes.fable.family).toBe('alpha');
    expect(r.advance.classes.haiku.history).toEqual([handEntry('model-5.6-alpha', null)]);
    expect(r.advance.classes.haiku.family).toBeNull();
    const refilled = reconcilePending(withHand(HAND), pins({ haiku: 'model-6.1-alpha', fable: 'model-5.6-alpha' }));
    expect(refilled.advance.classes.haiku).toEqual(seeded().classes.haiku);
  });

  it('a hand move that never landed (the pin is still `from`) is dropped: no entry, and every family and previous as they were', () => {
    const r = reconcilePending(withHand({ ...OPUS, to: null }), ADV_REGISTRY);
    expect(r.recovered).toBe(false);
    expect(r.advance.pending).toBeNull();
    expect(r.advance.classes).toEqual(seeded().classes);
  });
});

describe('backfillAdvance — the families a lane starts from (§2.2 Seeding)', () => {
  it('each pinned class takes its pin\'s family, and an empty class the seed family it is given', () => {
    const a = backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: ADV_SEEDS });
    expect(Object.fromEntries(CLASSES.map((c) => [c, a.classes[c].family])))
      .toEqual({ haiku: 'alpha', sonnet: 'beta', opus: 'gamma', fable: 'delta' });
    for (const c of CLASSES) expect(a.classes[c]).toEqual({ family: a.classes[c].family, hold: null, previous: null, history: [] });
    expect([a.v, a.pending]).toEqual([1, null]);
  });

  it('a pin that breaks the grammar gives null, seeds or not; with no seeds an empty class gets null', () => {
    expect(backfillAdvance({ registry: reg({ haiku: 'model-x-alpha' }), seedFamilies: ADV_SEEDS }).classes.haiku.family).toBeNull();
    const a = backfillAdvance({ registry: reg({ opus: 'model-5.6-gamma' }), seedFamilies: null });
    expect([a.classes.opus.family, a.classes.fable.family]).toEqual(['gamma', null]);
  });

  it('a seed never overrides a pin', () => {
    const a = backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: { haiku: 'zeta', sonnet: 'zeta', opus: 'zeta', fable: 'zeta' } });
    expect([a.classes.opus.family, a.classes.fable.family]).toEqual(['gamma', 'zeta']);
  });
});

describe('heldBackOf and lastMoveOf — what doctor and the panel read off one class', () => {
  it('held back: the newest entry is a failed advance whose `to` is still the candidate', () => {
    const s = ADVANCE_EXAMPLE.classes.sonnet;
    expect(heldBackOf(s, 'model-6.1-beta')).toEqual(s.history[0]);
    expect(heldBackOf(s, 'model-7-beta'), 'the candidate moved on (D-5191)').toBeNull();
    expect(heldBackOf(s, null)).toBeNull();
    expect(heldBackOf(ADVANCE_EXAMPLE.classes.opus, 'model-6.1-gamma'), 'its newest entry succeeded').toBeNull();
  });

  it('the last move is the newest entry that succeeded, whatever its kind', () => {
    expect(lastMoveOf(ADVANCE_EXAMPLE.classes.fable)).toEqual(ADVANCE_EXAMPLE.classes.fable.history[1]);
    expect(lastMoveOf(ADVANCE_EXAMPLE.classes.sonnet)).toBeNull();
    expect(lastMoveOf(ADVANCE_EXAMPLE.classes.haiku)).toBeNull();
  });
});

describe('SEED_FAMILIES in deploy/models-op.mjs', () => {
  it("the pinned classes' seed families are derived from SEEDS' own pins, and the empty class's word is the one SEEDS' docstring capitalises", () => {
    const src = readFileSync(OP, 'utf8');
    const at = src.indexOf('const SEED_FAMILIES');
    expect(at, 'SEED_FAMILIES sits below SEEDS').toBeGreaterThan(src.indexOf('const SEEDS = {'));
    const block = src.slice(at, src.indexOf('});', at));
    const pinned = CLASSES.filter((c) => SEEDED.classes[c] !== null);
    const empty = CLASSES.filter((c) => SEEDED.classes[c] === null);
    expect([pinned.length, empty.length]).toEqual([3, 1]);
    for (const c of pinned) {
      expect(block).toContain(`${c}: familyOf(SEEDS.codex.classes.${c}),`);
      expect(familyOf(SEEDED.classes[c]!), `SEEDS' ${c} pin follows the id grammar`).not.toBeNull();
    }
    const word = new RegExp(`^\\s*${empty[0]}: '([a-z][a-z0-9]*)',$`, 'm').exec(block)?.[1];
    expect(word, `SEED_FAMILIES gives ${empty[0]} no literal family`).toBeDefined();
    expect(pinned.map((c) => familyOf(SEEDED.classes[c]!)), 'the empty class must not borrow a pinned family').not.toContain(word);
    const doc = src.slice(src.indexOf('/** What `init` plants per probe kind.'), src.indexOf('const SEEDS = {'));
    expect(doc).toMatch(new RegExp(`\\b${word![0]!.toUpperCase()}${word!.slice(1)}\\b`));
  });

  it('the tsc probe drives the file half too, with no cast', () => {
    const src = readFileSync(PROBE, 'utf8');
    for (const call of ['parseAdvance(', 'serializeAdvance(', 'backfillAdvance(', 'recordMove(', 'recordFailure(',
      'reconcilePending(', 'heldBackOf(', 'lastMoveOf(']) expect(src).toContain(call);
    expect(src).not.toContain(' as ');
  });
});
