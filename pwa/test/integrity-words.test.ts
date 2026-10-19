// THE INTEGRITY CENSUS, AS WORDS (D-5104, the audit's F5, data half).
//
// `integrityWords.ts` is the pure model a renderer reads: the fleet store's
// last `divergence` census (or `null`, no frame since this page loaded) in,
// one of three states out. No UI reads it yet — the strip lands with #402's
// `FleetScreen.tsx`, and W2's status bar and inspector after it — so these
// cases are the model's only reader, and they pin the two ways it could lie:
// reading "never measured" as an all-clear, and losing a member it cannot name.
import { describe, expect, it } from 'vitest';
import { DIVERGENCE_KINDS, type Divergence, type DivergenceKind } from '../../shared/api';
import {
  INTEGRITY_WORDS,
  UNKNOWN_DIVERGENCE_WORD,
  integrityView,
  type DivergenceCensus,
} from '../src/fleet/integrityWords';

const AT = Date.UTC(2026, 9, 15, 10, 0, 0);

const member = (kind: DivergenceKind, n: number): Divergence => ({
  kind, id: `lane-a-project-${n}`, path: null, detail: `${kind} on row ${n}`,
});

const census = (items: readonly unknown[], at = AT): DivergenceCensus =>
  ({ items: items as readonly Divergence[], at });

describe('integrityView', () => {
  it('null is unmeasured, never clean', () => {
    const view = integrityView(null, AT);
    expect(view).toEqual({ state: 'unmeasured' });
    expect(view.state).not.toBe('clean');
    // No age either: an age would date a measurement that was never taken.
    expect(view).not.toHaveProperty('age');
  });

  it('an empty census is clean, with its age', () => {
    expect(integrityView(census([]), AT + 90_000)).toEqual({ state: 'clean', age: 90_000 });
    // The moment it lands it is zero seconds old, and still clean.
    expect(integrityView(census([]), AT)).toEqual({ state: 'clean', age: 0 });
  });

  it('groups by kind in DIVERGENCE_KINDS order, with counts', () => {
    // Kind i (in the catalogue's order) appears i + 1 times, and the frame
    // lists them BACKWARDS and interleaved, so neither arrival order nor first
    // appearance can pass for the catalogue's order.
    const items: Divergence[] = [];
    DIVERGENCE_KINDS.forEach((kind, i) => {
      for (let n = 0; n <= i; n++) items.push(member(kind, n));
    });
    items.reverse();
    const view = integrityView(census(items), AT + 3_000);

    expect(view).toEqual({
      state: 'diverged',
      age: 3_000,
      total: items.length,
      groups: DIVERGENCE_KINDS.map((kind, i) => ({
        known: true, kind, count: i + 1, word: INTEGRITY_WORDS[kind],
      })),
    });
  });

  it('a kind with no member is not a group: the census lists what it found', () => {
    const [first, , third] = DIVERGENCE_KINDS;
    if (first === undefined || third === undefined) throw new Error('the catalogue shrank below three kinds');
    const view = integrityView(census([member(third, 1), member(first, 2), member(third, 3)]), AT);
    expect(view).toEqual({
      state: 'diverged',
      age: 0,
      total: 3,
      groups: [
        { known: true, kind: first, count: 1, word: INTEGRITY_WORDS[first] },
        { known: true, kind: third, count: 2, word: INTEGRITY_WORDS[third] },
      ],
    });
  });

  it('an unknown or shapeless member is counted, not dropped', () => {
    const [known] = DIVERGENCE_KINDS;
    if (known === undefined) throw new Error('the catalogue is empty');
    const strangers: unknown[] = [
      { kind: 'from-a-newer-server', id: 'lane-a-project-a', path: null, detail: 'a kind this build never heard of' },
      { kind: 42, id: null, path: null, detail: 'a kind that is not a string' },
      { id: 'lane-a-project-b', path: null, detail: 'no kind at all' },
      null,
      'branch-drift',
    ];
    const view = integrityView(census([member(known, 1), ...strangers]), AT + 1_000);

    expect(view).toEqual({
      state: 'diverged',
      age: 1_000,
      total: 1 + strangers.length,
      groups: [
        { known: true, kind: known, count: 1, word: INTEGRITY_WORDS[known] },
        // After every kind this build can name, never interleaved with them.
        { known: false, count: strangers.length, word: UNKNOWN_DIVERGENCE_WORD },
      ],
    });

    // A census of nothing BUT strangers is still a disagreement this build was
    // told about — never clean because it cannot say which.
    expect(integrityView(census(strangers), AT)).toEqual({
      state: 'diverged',
      age: 0,
      total: strangers.length,
      groups: [{ known: false, count: strangers.length, word: UNKNOWN_DIVERGENCE_WORD }],
    });
  });

  it('every member is counted once: the groups add up to the total', () => {
    const items: unknown[] = [...DIVERGENCE_KINDS.map((k, n) => member(k, n)), { kind: 'later' }, undefined];
    const view = integrityView(census(items), AT);
    if (view.state !== 'diverged') throw new Error(`expected diverged, got ${view.state}`);
    expect(view.total).toBe(items.length);
    expect(view.groups.reduce((sum, g) => sum + g.count, 0)).toBe(view.total);
  });

  it('a clock that stepped back reads the census as new, never as negative age', () => {
    // `Date.now()` is the wall clock: a device whose time is corrected
    // backwards between the frame and the render would otherwise print an age
    // below zero.
    expect(integrityView(census([]), AT - 5_000)).toEqual({ state: 'clean', age: 0 });
    const view = integrityView(census([member('branch-drift', 1)]), AT - 5_000);
    expect(view.state === 'diverged' && view.age).toBe(0);
  });
});

describe('INTEGRITY_WORDS', () => {
  it('every DivergenceKind has a word', () => {
    // Derived from `DIVERGENCE_KINDS`, never a second list: a kind added to
    // `shared/api.ts` is a member here the moment it exists, and the `Record`
    // type makes the model itself a compile error until it has a word.
    expect(Object.keys(INTEGRITY_WORDS).sort()).toEqual([...DIVERGENCE_KINDS].sort());
    for (const kind of DIVERGENCE_KINDS) {
      const word = INTEGRITY_WORDS[kind];
      expect(typeof word, kind).toBe('string');
      expect(word.trim(), kind).toBe(word);
      expect(word.length, kind).toBeGreaterThan(0);
      // A word, not the wire's slug read back: the slug is the server's
      // identifier, and the operator reads the word.
      expect(word, kind).not.toBe(kind);
    }
    // Each word names one kind, and the unknown group's word names none of them.
    const words = [...DIVERGENCE_KINDS.map((k) => INTEGRITY_WORDS[k]), UNKNOWN_DIVERGENCE_WORD];
    expect(new Set(words).size).toBe(words.length);
    expect(UNKNOWN_DIVERGENCE_WORD.trim().length).toBeGreaterThan(0);
  });
});
